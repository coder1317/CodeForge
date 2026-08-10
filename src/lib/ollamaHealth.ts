export interface OllamaHealthStatus {
  available: boolean;
  models: string[];
  latencyMs?: number;
  error?: string;
}

const DEFAULT_OLLAMA_ROOT =
  typeof process !== 'undefined' && process.env?.OLLAMA_BASE_URL
    ? process.env.OLLAMA_BASE_URL.replace(/\/v1$/, '')
    : 'http://localhost:11434';

export async function checkOllamaHealth(baseUrl = DEFAULT_OLLAMA_ROOT): Promise<OllamaHealthStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2 sec timeout for quick check

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { available: false, models: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models.map((m: { name?: string }) => m.name || '') : [];
    
    return {
      available: true,
      models,
      latencyMs: Date.now() - start
    };
  } catch (err: unknown) {
    return {
      available: false,
      models: [],
      error: err instanceof Error ? err.message : 'Offline'
    };
  }
}
