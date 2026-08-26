import { describe, it, expect } from 'vitest';
import { extractIssues } from './buildAgent';

describe('extractIssues', () => {
  it('pulls error lines from build output', () => {
    const out = [
      'some noise line',
      'ERROR in src/app.ts: Type "string" is not assignable',
      'more noise'
    ].join('\n');
    const { errors } = extractIssues('', out);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('not assignable');
  });

  it('identifies implicated files from error lines', () => {
    const out = 'error TS2307: Cannot find module ./missing in src/components/Button.tsx';
    const { failingFiles } = extractIssues(out, '');
    expect(failingFiles).toContain('src/components/Button.tsx');
  });

  it('peeks at the next line when the error line has no file', () => {
    const stderr = ['Module not found:', '  ./lib/util.js from src/main.js'].join('\n');
    const { failingFiles } = extractIssues(stderr, '');
    expect(failingFiles.length).toBeGreaterThan(0);
  });

  it('caps the number of collected errors', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Error: problem ${i} in file${i}.ts`);
    const { errors } = extractIssues(lines.join('\n'), '');
    expect(errors.length).toBeLessThanOrEqual(12);
  });

  it('ignores very long lines (stack dumps)', () => {
    const longLine = `Error: ${'x'.repeat(500)}`;
    const { errors } = extractIssues(longLine, '');
    expect(errors.length).toBe(0);
  });

  it('returns empty arrays for clean output', () => {
    const { errors, failingFiles } = extractIssues('built successfully\n', '');
    expect(errors).toEqual([]);
    expect(failingFiles).toEqual([]);
  });
});
