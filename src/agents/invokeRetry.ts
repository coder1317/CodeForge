import { TaskType, selectProvider, ProviderSelectionResult } from '../lib/providers/selector';
import { rateLimitTracker } from '../lib/providers/rateLimitTracker';
import { refreshOllamaModels } from '../lib/ollamaModels';
import { invokeLLM } from './llmBuilder';
import { BYOKMap } from '../lib/byok';

export interface RetryInvocationParams {
  taskType: TaskType;
  byokKeys?: BYOKMap;
  envVars?: Record<string, string | undefined>;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  /**
   * Escalation mode (retry rounds): prefer keyed cloud providers over the
   * local/free ones that already failed, so round 2 doesn't repeat round 1.
   */
  escalate?: boolean;
}

export interface RetryInvocationResult {
  content: string;
  providerName: string;
  model: string;
}

// Task-specific provider attempt budgets: a slow/failing provider shouldn't
// be allowed to burn the full pool (up to 8 × 150s) on every node.
const TASK_MAX_ATTEMPTS: Record<TaskType, number> = {
  architect: 3,
  fast: 3,
  code: 4,
  security: 3,
  review: 3,
  debug: 3
};

// Cold-start guard: the very first LLM invocation of a process always awaits
// one Ollama model-detection round, even when cloud keys are present.
let ollamaWarmedOnce = false;

/**
 * Try the preferred provider for a task, then automatically fall through the
 * provider pool (by priority order) until one succeeds. Only throws when every
 * available provider has failed — callers then use the deterministic fallback
 * engine, so the pipeline never dies and never silently writes garbage.
 */
export async function invokeWithProviderRetry(params: RetryInvocationParams): Promise<RetryInvocationResult> {
  const { taskType, byokKeys, envVars, systemPrompt, userPrompt, signal, escalate } = params;
  const tried: string[] = [];
  let lastError: unknown = new Error('No provider available');

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error('Generation aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  // Warm the Ollama model cache so the selector knows which local models are
  // actually installed instead of falling back to a model that may not exist.
  // The FIRST invocation of a process always awaits detection (cold-start fix:
  // otherwise the selector can pick a model that isn't installed). After that,
  // TTL-cached refreshes only run when no cloud keys are configured — with keys
  // present, Ollama is usually irrelevant and we skip the per-node check.
  const hasCloudKeys = Boolean(
    byokKeys && Object.values(byokKeys).some((k) => k && k.trim() !== '' && k !== 'unused') ||
    envVars && ['GROQ_API_KEY', 'NVIDIA_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'CHUTES_API_KEY', 'LLM7_API_KEY']
      .some((name) => envVars[name])
  );
  if (!ollamaWarmedOnce) {
    ollamaWarmedOnce = true;
    try {
      await refreshOllamaModels();
    } catch {
      // detection failure is non-fatal; selector will fall back gracefully
    }
  } else if (!hasCloudKeys) {
    try {
      await refreshOllamaModels();
    } catch {
      // detection failure is non-fatal; selector will fall back gracefully
    }
  }

  const maxAttempts = TASK_MAX_ATTEMPTS[taskType] || 4;

  // 429 / rate-limit errors are transient (providers usually include
  // "retry_after"). Back off briefly and retry the SAME provider before
  // falling through the pool, so gateways like llm7 that throttle briefly
  // don't get abandoned for a deterministic fallback.
  const MAX_BACKOFF_RETRIES = 2;
  // Abort-aware sleep: a client disconnect during the wait resolves the
  // promise immediately, so throwIfAborted() below fires without delay.
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  const isRateLimit = (err: unknown) =>
    err instanceof Error && /HTTP\s*429|rate\s*limit|rate_limit/i.test(err.message);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfAborted();
    const selection: ProviderSelectionResult | null = selectProvider(taskType, byokKeys, envVars, tried, escalate);
    if (!selection || tried.includes(selection.provider.id)) break;
    tried.push(selection.provider.id);

    rateLimitTracker.trackRequest(selection.provider.id);

    let backoffRetries = 0;
    while (true) {
      try {
        const content = await invokeLLM({
          provider: selection.provider,
          apiKey: selection.apiKey,
          model: selection.model,
          systemPrompt,
          userPrompt,
          signal
        });
        return { content, providerName: selection.provider.name, model: selection.model };
      } catch (err) {
        if (isRateLimit(err) && backoffRetries < MAX_BACKOFF_RETRIES) {
          backoffRetries++;
          const waitMs = 1500 * backoffRetries; // 1.5s, then 3s
          console.warn(
            `[ProviderRetry] ${selection.provider.name} rate-limited (429), backing off ${waitMs}ms (retry ${backoffRetries}/${MAX_BACKOFF_RETRIES})`
          );
          await sleep(waitMs, signal);
          throwIfAborted();
          continue; // retry same provider
        }
        lastError = err;
        console.warn(
          `[ProviderRetry] ${selection.provider.name} (${selection.model}) failed for ${taskType}, trying next provider:`,
          err instanceof Error ? err.message : err
        );
        break; // move to next provider
      }
    }
  }

  throw lastError;
}
