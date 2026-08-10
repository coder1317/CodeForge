import { LLMProviderConfig } from '../lib/providers/pool';
import { rateLimitTracker } from '../lib/providers/rateLimitTracker';

export interface LLMInvocationParams {
  provider: LLMProviderConfig;
  apiKey?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Optional external abort (e.g. client disconnected). Merged with the timeout. */
  signal?: AbortSignal;
}

// Hard cap per LLM call — a runaway response must never OOM the server.
const REQUEST_TIMEOUT_MS = 150_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_5XX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke an OpenAI-compatible chat-completions endpoint via plain fetch.
 * (Previously used the LangChain/openai SDK, whose bundled SDK version rejects
 * the zero-key placeholder and would crash the server on large responses.)
 * The interface is identical, so callers (nodes, retry chain) are unchanged.
 */
export async function invokeLLM(params: LLMInvocationParams): Promise<string> {
  const { provider, apiKey, model, systemPrompt, userPrompt, signal: externalSignal } = params;

  // Zero-key providers pass a fixed placeholder; keyed providers pass their real key.
  const effectiveKey = apiKey || process.env.OPENAI_API_KEY || 'unused';

  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 4096
  };

  let lastError: unknown = new Error('LLM invocation failed');

  // Transient 5xx responses get a couple of internal retries with backoff.
  // HTTP 429 instead records a cooldown and fails fast so the provider retry
  // chain can skip the rate-limited provider instead of hammering it.
  for (let attempt = 0; attempt <= MAX_5XX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Merge the external (client-disconnect) signal with our timeout signal so
    // an aborted client cancels the in-flight fetch immediately. Guard against
    // the race where the signal is ALREADY aborted before the listener attaches.
    const onExternalAbort = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastError = new Error(`[${provider.name}] HTTP ${res.status}: ${body.slice(0, 300)}`);
        if (res.status === 429) {
          // Back off this provider for the requested duration (bounded).
          let retryAfter = 60;
          try {
            const headerVal = Number(res.headers.get('retry-after'));
            if (Number.isFinite(headerVal) && headerVal > 0) retryAfter = headerVal;
          } catch {
            // ignore malformed header
          }
          rateLimitTracker.setCooldown(provider.id, Math.min(retryAfter, 3600) * 1000);
          throw lastError;
        }
        if (res.status >= 500 && attempt < MAX_5XX_RETRIES) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      // Stream-read the body with a byte cap to avoid OOM from runaway responses.
      const reader = res.body?.getReader();
      let total = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => {});
            throw new Error(`[${provider.name}] Response exceeded ${MAX_RESPONSE_BYTES} bytes; aborted.`);
          }
          chunks.push(value);
        }
      }

      const rawText = Buffer.concat(chunks).toString('utf-8');
      const parsed = JSON.parse(rawText) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error(`[${provider.name}] No content in completion response`);
      }
      return content;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(`[${provider.name}] Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      } else {
        lastError = err;
      }
      // Any other error: let the caller's provider retry chain handle it.
      throw lastError;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError;
}

/**
 * Safely parse JSON output from LLM.
 *
 * Strategy (more robust than the old greedy regex, which could grab the wrong
 * braces when a model wrapped JSON in prose or embedded `{...}` inside strings):
 *  1. try to parse the whole trimmed response directly;
 *  2. strip a markdown code fence, then try again;
 *  3. brace-match the FIRST top-level JSON object/array (tracking string
 *     literals so braces inside strings are not counted);
 *  4. as a last resort, try to parse the LAST brace-balanced chunk.
 */
export function cleanAndParseJSON<T>(rawText: string): T {
  const attempts: string[] = [];
  let cleaned = rawText.trim();
  attempts.push(cleaned);

  // Strip markdown triple backticks
  if (cleaned.startsWith('```')) {
    const fenced = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    attempts.push(fenced);
    cleaned = fenced;
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // keep trying
    }
  }

  // Brace-match the first top-level JSON structure.
  const first = extractFirstBalanced(cleaned);
  if (first) {
    try {
      return JSON.parse(first) as T;
    } catch {
      // fall through
    }
  }

  // Last-chance: extract every balanced chunk and try the last one.
  const chunks = extractAllBalanced(cleaned);
  if (chunks.length > 0) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(chunks[i]) as T;
      } catch {
        // keep trying earlier chunks
      }
    }
  }

  throw new Error('cleanAndParseJSON: no valid JSON found in LLM response');
}

/** Find the first top-level JSON object or array, ignoring braces inside strings. */
function extractFirstBalanced(text: string): string | null {
  const startIdx = firstJsonStart(text);
  if (startIdx === -1) return null;
  const endIdx = findBalancedEnd(text, startIdx);
  if (endIdx === -1) return null;
  return text.slice(startIdx, endIdx + 1);
}

/** Extract every brace-balanced JSON chunk in order. */
function extractAllBalanced(text: string): string[] {
  const chunks: string[] = [];
  let idx = 0;
  while (idx < text.length) {
    const start = firstJsonStart(text.slice(idx));
    if (start === -1) break;
    const absStart = idx + start;
    const end = findBalancedEnd(text, absStart);
    if (end === -1) break;
    chunks.push(text.slice(absStart, end + 1));
    idx = end + 1;
  }
  return chunks;
}

/** Index of the first '{' or '[' in the text, or -1. */
function firstJsonStart(text: string): number {
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

/**
 * Walk from a '{' / '[' to its matching closer, honoring "..." string escapes
 * so braces inside string literals are ignored. Returns the closing index or -1.
 */
function findBalancedEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
