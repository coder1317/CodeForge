export interface BYOKMap {
  groq?: string;
  nvidia?: string;
  cerebras?: string;
  mistral?: string;
  google?: string;
  chutes?: string;
  customEndpoint?: string;
  customKey?: string;
}

const STORAGE_KEY = 'codeforge_v2_byok_keys';

export function loadBYOK(): BYOKMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Failed to parse BYOK keys:', e);
    return {};
  }
}

export function saveBYOK(keys: BYOKMap): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (e) {
    console.error('Failed to save BYOK keys:', e);
  }
}

export function clearBYOK(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear BYOK keys:', e);
  }
}
