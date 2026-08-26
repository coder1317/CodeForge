// Auto-detect the best model currently installed in local Ollama, so the
// provider pool never points at a model that isn't actually there.

// Root Ollama URL (health/detection endpoints sit outside /v1).
const OLLAMA_ROOT =
  typeof process !== 'undefined' && process.env?.OLLAMA_BASE_URL
    ? process.env.OLLAMA_BASE_URL.replace(/\/v1$/, '')
    : 'http://localhost:11434';

const OLLAMA_TAGS_URL = OLLAMA_ROOT + '/api/tags';

// Preferred models, in order of preference. Granite 4.1 3B is the configured
// default local model (fast on CPU-only machines); the others remain as
// automatic fallbacks when Granite isn't installed. Prefix-matched against
// installed model names so tags like "granite4.1:3b-q4_K_M" also match.
// NOTE: 7B+ models (e.g. qwen2.5:7b, gpt-oss:20b-cloud) are intentionally
// excluded — too slow for local code generation.
const PREFERRED_MODELS = [
  'granite4.1:3b',
  'qwen2.5-coder',
  'qwen2.5:3b',
  'phi4-mini',
  'qwen3:1.7b',
  'qwen3:4b',
  'qwen3.5:4b'
];

// Static fallback if Ollama is offline or detection hasn't run yet.
export const OLLAMA_FALLBACK_MODEL = 'granite4.1:3b';

const CACHE_TTL_MS = 60_000;

let cachedModels: string[] | null = null;
let fetchedAt = 0;
let inflight: Promise<string[]> | null = null;

async function fetchOllamaModels(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return Array.isArray(data.models) ? data.models.map((m) => m.name || '') : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Refresh the cached list of installed Ollama models (deduplicated). */
export function refreshOllamaModels(force = false): Promise<string[]> {
  if (inflight) return inflight;
  if (!force && cachedModels && Date.now() - fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedModels);
  }
  inflight = fetchOllamaModels()
    .then((models) => {
      cachedModels = models;
      fetchedAt = Date.now();
      return models;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Pure selection logic: pick the best installed model from a list of tags.
 * Prefix-matched against preferred models; falls back to the first installed
 * model (any real model beats pointing at one that doesn't exist), then to
 * the static fallback only when nothing is installed.
 */
export function pickBestInstalledModel(models: string[]): string {
  if (models.length === 0) return OLLAMA_FALLBACK_MODEL;
  for (const preferred of PREFERRED_MODELS) {
    const hit = models.find((name) => name.startsWith(preferred));
    if (hit) return hit;
  }
  return models[0];
}

/**
 * Best installed Ollama model for code generation.
 * Sync read (safe for the provider selector); kicks off a refresh when stale.
 */
export function getBestOllamaModel(): string {
  if (!cachedModels || Date.now() - fetchedAt > CACHE_TTL_MS) {
    refreshOllamaModels().catch(() => {});
  }
  if (cachedModels && cachedModels.length > 0) {
    return pickBestInstalledModel(cachedModels);
  }
  return OLLAMA_FALLBACK_MODEL;
}
