// Allow overriding the Ollama endpoint (e.g. remote/Ollama on another host).
const OLLAMA_BASE_URL =
  typeof process !== 'undefined' && process.env?.OLLAMA_BASE_URL
    ? process.env.OLLAMA_BASE_URL.replace(/\/v1$/, '') + '/v1'
    : 'http://localhost:11434/v1';

export interface LLMProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  rateLimitRPM: number;
  requiresKey: boolean;
  envVarName?: string;
  free?: boolean;
  description: string;
  badge: string;
}

export const PROVIDER_POOL: Record<string, LLMProviderConfig> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama3-8b-8192', 'mixtral-8x7b-32768'],
    defaultModel: 'llama-3.3-70b-versatile',
    rateLimitRPM: 30,
    requiresKey: true,
    envVarName: 'GROQ_API_KEY',
    description: 'Ultra-fast LPU inference engine for structural planning & code review.',
    badge: 'Fastest'
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.1-70b-instruct', 'mistralai/mistral-large-2-instruct'],
    defaultModel: 'meta/llama-3.1-70b-instruct',
    rateLimitRPM: 40,
    requiresKey: true,
    envVarName: 'NVIDIA_API_KEY',
    description: 'Enterprise GPU cloud for deep security analysis & code synthesis.',
    badge: 'Enterprise'
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama3.1-70b', 'llama3.1-8b'],
    defaultModel: 'llama3.1-70b',
    rateLimitRPM: 60,
    requiresKey: true,
    envVarName: 'CEREBRAS_API_KEY',
    description: 'Wafer-scale engine with high token generation throughput.',
    badge: 'High Speed'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral Codestral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['codestral-latest', 'mistral-large-latest', 'open-codestral-mamba'],
    defaultModel: 'codestral-latest',
    rateLimitRPM: 30,
    requiresKey: true,
    envVarName: 'MISTRAL_API_KEY',
    description: 'State-of-the-art specialized code generation LLM.',
    badge: 'Code Expert'
  },
  google: {
    id: 'google',
    name: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    rateLimitRPM: 60,
    requiresKey: true,
    envVarName: 'GEMINI_API_KEY',
    description: 'Multi-modal Gemini reasoning engine for code architecture & SAST.',
    badge: 'Google AI'
  },
  llm7: {
    id: 'llm7',
    name: 'LLM7.io',
    baseUrl: 'https://api.llm7.io/v1',
    models: ['fast', 'default', 'codestral-latest'],
    defaultModel: 'fast',
    rateLimitRPM: 120,
    requiresKey: false,
    free: true,
    // Optional key: when LLM7_API_KEY is set it is sent as the Bearer token
    // (higher quota / premium routing). Zero-key mode still works without it.
    envVarName: 'LLM7_API_KEY',
    description: 'Cloud inference API with a working zero-key gateway; optional LLM7_API_KEY for authenticated quota.',
    badge: 'Zero-Key Free'
  },
  chutes: {
    id: 'chutes',
    name: 'Chutes.ai',
    baseUrl: 'https://chutes.ai/v1',
    models: ['chutes-code-7b', 'chutes-fast'],
    defaultModel: 'chutes-code-7b',
    rateLimitRPM: 60,
    requiresKey: true,
    envVarName: 'CHUTES_API_KEY',
    description: 'Decentralized AI execution layer for code synthesis.',
    badge: 'Decentralized'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: OLLAMA_BASE_URL,
    models: ['granite4.1:3b', 'qwen2.5:3b', 'phi4-mini', 'qwen3:1.7b'],
    defaultModel: 'granite4.1:3b',
    rateLimitRPM: 999,
    requiresKey: false,
    free: true,
    description: 'Local offline LLM execution fallback. Privacy-first local engine.',
    badge: 'Local Offline'
  }
};
