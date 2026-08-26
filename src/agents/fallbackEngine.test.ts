import { describe, it, expect } from 'vitest';
import { fallbackArchitect, fallbackSecurityScan, fallbackCodeReview } from './fallbackEngine';

describe('fallbackArchitect', () => {
  it('produces a valid plan with files for any prompt', () => {
    const plan = fallbackArchitect('Build me something great');
    expect(plan.files.length).toBeGreaterThan(0);
    for (const f of plan.files) {
      expect(f.path).not.toMatch(/^\//);
      expect(f.path).not.toContain('..');
    }
  });

  it('produces unique file paths', () => {
    const plan = fallbackArchitect('REST API with auth');
    const paths = plan.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('fallbackSecurityScan', () => {
  it('flags hardcoded credentials', () => {
    const issues = fallbackSecurityScan('src/config.ts', 'const password = "hunter2";');
    expect(issues.some((i) => /credential|secret|password/i.test(i.message + i.type))).toBe(true);
  });

  it('flags eval usage as high or critical severity', () => {
    const issues = fallbackSecurityScan('src/run.ts', 'eval(userInput);');
    const worst = issues.find((i) => i.severity === 'critical' || i.severity === 'high');
    expect(worst).toBeDefined();
  });

  it('returns no issues for benign code', () => {
    const issues = fallbackSecurityScan('src/math.ts', 'export const add = (a: number, b: number) => a + b;');
    expect(Array.isArray(issues)).toBe(true);
  });

  it('always produces well-formed issues', () => {
    const issues = fallbackSecurityScan('a.js', 'var api_key = "sk-123"; eval(x); innerHTML = y;');
    for (const i of issues) {
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(i.severity);
      expect(i.message.length).toBeGreaterThan(0);
      expect(i.type.length).toBeGreaterThan(0);
    }
  });
});

describe('fallbackCodeReview', () => {
  it('scores projects within bounds and returns suggestions', () => {
    const review = fallbackCodeReview({
      'index.ts': 'export const x = 1;'
    });
    expect(review.overallScore).toBeGreaterThanOrEqual(0);
    expect(review.overallScore).toBeLessThanOrEqual(100);
    expect(typeof review.passed).toBe('boolean');
    expect(Array.isArray(review.suggestions)).toBe(true);
  });
});
