import { PROVIDER_POOL, LLMProviderConfig } from './pool';
import { rateLimitTracker } from './rateLimitTracker';
import { BYOKMap } from '../byok';
import { getBestOllamaModel } from '../ollamaModels';

export type TaskType = 'fast' | 'code' | 'security' | 'review' | 'architect' | 'debug';

export interface ProviderSelectionResult {
  provider: LLMProviderConfig;
  apiKey?: string;
  isBYOK: boolean;
  model: string;
  reason: string;
}

// Preferred priority order per task type.
// Local Ollama runs first (privacy-first, zero-key), then keyed cloud
// providers, with the zero-key llm7 gateway as the final last-resort backup.
const TASK_PREFERENCES: Record<TaskType, string[]> = {
  architect: ['ollama', 'groq', 'cerebras', 'google', 'nvidia', 'mistral', 'chutes', 'llm7'],
  fast: ['ollama', 'groq', 'cerebras', 'google', 'nvidia', 'mistral', 'chutes', 'llm7'],
  code: ['ollama', 'mistral', 'google', 'groq', 'nvidia', 'cerebras', 'chutes', 'llm7'],
  security: ['ollama', 'google', 'nvidia', 'groq', 'mistral', 'cerebras', 'chutes', 'llm7'],
  review: ['ollama', 'groq', 'mistral', 'cerebras', 'google', 'nvidia', 'chutes', 'llm7'],
  debug: ['ollama', 'google', 'nvidia', 'groq', 'mistral', 'cerebras', 'chutes', 'llm7']
};

// Placeholder key accepted by zero-key gateways (llm7.io). Using a fixed
// placeholder prevents real API keys from being leaked to third-party free
// endpoints when no key is required.
export const ZERO_KEY = 'unused';

/** Resolve the API key a provider would use right now (BYOK first, then env). */
function resolveKey(
  provider: LLMProviderConfig,
  byokKeys: BYOKMap,
  envVars: Record<string, string | undefined>
): string | undefined {
  const byokKey = byokKeys[provider.id as keyof BYOKMap];
  if (byokKey && byokKey.trim() !== '') return byokKey.trim();
  if (provider.envVarName && envVars[provider.envVarName]) return envVars[provider.envVarName];
  return undefined;
}

export function selectProvider(
  taskType: TaskType,
  byokKeys: BYOKMap = {},
  envVars: Record<string, string | undefined> = {},
  excludeIds: string[] = [],
  escalate = false
): ProviderSelectionResult | null {
  let preferences = TASK_PREFERENCES[taskType] || TASK_PREFERENCES.code;

  // Escalation mode (used on retry rounds after a failure): put providers that
  // actually have keys available FIRST, so round 2 doesn't just re-ask the same
  // local/free model that already failed. Relative order is preserved otherwise.
  if (escalate) {
    const keyed = preferences.filter((id) => {
      const p = PROVIDER_POOL[id];
      return Boolean(p && resolveKey(p, byokKeys, envVars));
    });
    const rest = preferences.filter((id) => !keyed.includes(id));
    preferences = [...keyed, ...rest];
  }

  for (const providerId of preferences) {
    if (excludeIds.includes(providerId)) continue;

    const provider = PROVIDER_POOL[providerId];
    if (!provider) continue;

    // Check rate limits
    if (rateLimitTracker.isRateLimited(provider.id, provider.rateLimitRPM)) {
      console.warn(`[Selector] Provider ${provider.name} is rate-limited (${rateLimitTracker.getRPM(provider.id)} RPM). Skipping.`);
      continue;
    }

    // Check key availability
    const apiKey = resolveKey(provider, byokKeys, envVars);
    const isBYOK = Boolean(
      byokKeys[providerId as keyof BYOKMap] && byokKeys[providerId as keyof BYOKMap]?.trim() !== ''
    );

    // Free / zero-key provider handling (Ollama or LLM7)
    if (!provider.requiresKey || provider.free) {
      return {
        provider,
        apiKey: apiKey || ZERO_KEY,
        isBYOK,
        model: provider.id === 'ollama' ? getBestOllamaModel() : provider.defaultModel,
        reason: `Selected free/zero-key provider ${provider.name} for ${taskType}`
      };
    }

    // If key exists for key-required provider
    if (apiKey) {
      return {
        provider,
        apiKey,
        isBYOK,
        model: provider.defaultModel,
        reason: `Selected priority provider ${provider.name} using ${isBYOK ? 'BYOK' : 'System Key'} for ${taskType}`
      };
    }
  }

  // Last-resort fallback to LLM7 zero-key provider (unless already tried or cooling down)
  const fallback = PROVIDER_POOL.llm7;
  if (
    !excludeIds.includes(fallback.id) &&
    !rateLimitTracker.isRateLimited(fallback.id, fallback.rateLimitRPM)
  ) {
    return {
      provider: fallback,
      apiKey: ZERO_KEY,
      isBYOK: false,
      model: fallback.defaultModel,
      reason: `Fallback to default zero-key provider ${fallback.name} for ${taskType}`
    };
  }

  return null;
}
