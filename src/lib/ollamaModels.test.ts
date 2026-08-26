import { describe, it, expect } from 'vitest';
import { pickBestInstalledModel, OLLAMA_FALLBACK_MODEL } from './ollamaModels';

describe('pickBestInstalledModel', () => {
  it('returns the static fallback when nothing is installed', () => {
    expect(pickBestInstalledModel([])).toBe(OLLAMA_FALLBACK_MODEL);
  });

  it('prefers granite4.1:3b when installed', () => {
    expect(pickBestInstalledModel(['qwen2.5:3b', 'granite4.1:3b-q4_K_M'])).toMatch(/^granite4\.1:3b/);
  });

  it('prefix-matches tagged variants of preferred models', () => {
    expect(pickBestInstalledModel(['phi4-mini:latest', 'unrelated-model'])).toMatch(/^phi4-mini/);
  });

  it('falls back to ANY installed model when no preferred one matches', () => {
    // Cold-start fix: a real but non-preferred model beats pointing at a
    // nonexistent fallback.
    expect(pickBestInstalledModel(['tinyllama:1b'])).toBe('tinyllama:1b');
  });

  it('respects preference order across families', () => {
    expect(
      pickBestInstalledModel(['qwen3:1.7b', 'qwen2.5-coder:7b'])
    ).toMatch(/^qwen2\.5-coder/);
  });
});
