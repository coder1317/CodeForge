import { describe, it, expect } from 'vitest';
import { cleanAndParseJSON } from './llmBuilder';

describe('cleanAndParseJSON', () => {
  it('parses plain JSON objects', () => {
    expect(cleanAndParseJSON<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses plain JSON arrays', () => {
    expect(cleanAndParseJSON<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"code": "x = 1"}\n```';
    expect(cleanAndParseJSON<{ code: string }>(raw)).toEqual({ code: 'x = 1' });
  });

  it('extracts JSON embedded in prose', () => {
    const raw = 'Here is your result:\n{"score": 42}\nHope that helps!';
    expect(cleanAndParseJSON<{ score: number }>(raw)).toEqual({ score: 42 });
  });

  it('ignores braces inside string literals when matching', () => {
    const raw = 'prefix {"text": "a } b { c", "n": 1} suffix';
    expect(cleanAndParseJSON<{ text: string; n: number }>(raw)).toEqual({ text: 'a } b { c', n: 1 });
  });

  it('handles escaped quotes inside strings', () => {
    const raw = '{"say": "he said \\"}\\" loudly"}';
    expect(cleanAndParseJSON<{ say: string }>(raw).say).toBe('he said "}" loudly');
  });

  it('prefers the first balanced chunk over later ones', () => {
    const raw = '{"which": "first"} {"which": "second"}';
    expect(cleanAndParseJSON<{ which: string }>(raw)).toEqual({ which: 'first' });
  });

  it('falls back to the last parseable chunk when the first is broken', () => {
    const raw = '{broken json here} {"ok": true}';
    expect(cleanAndParseJSON<{ ok: boolean }>(raw)).toEqual({ ok: true });
  });

  it('handles nested structures with mixed brackets', () => {
    const raw = '```json\n{"items": [{"a": [1, 2]}, {"b": {}}], "t": "]}" }\n```';
    const parsed = cleanAndParseJSON<{ items: unknown[]; t: string }>(raw);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.t).toBe(']}');
  });

  it('throws on input with no valid JSON', () => {
    expect(() => cleanAndParseJSON('no json at all')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => cleanAndParseJSON('   ')).toThrow();
  });
});
