import { describe, it, expect } from 'vitest';
import {
  isArchitecturePlan,
  isSecurityIssueArray,
  isDebugPlan,
  isCodeReviewResult,
  isTechStack
} from './validators';

describe('isTechStack', () => {
  it('accepts a valid stack', () => {
    expect(isTechStack({ frontend: 'React', libraries: ['vite'] })).toBe(true);
  });
  it('accepts an empty object', () => {
    expect(isTechStack({})).toBe(true);
  });
  it('rejects non-string fields', () => {
    expect(isTechStack({ frontend: 123 })).toBe(false);
  });
  it('rejects non-string library entries', () => {
    expect(isTechStack({ libraries: ['ok', 5] })).toBe(false);
  });
  it('rejects non-objects', () => {
    expect(isTechStack(null)).toBe(false);
    expect(isTechStack([1])).toBe(false);
  });
});

describe('isArchitecturePlan', () => {
  const base = { type: 'ts', description: 'd' };
  it('accepts a valid plan', () => {
    expect(isArchitecturePlan({
      stack: {},
      files: [{ ...base, path: 'src/index.ts' }]
    })).toBe(true);
  });
  it('rejects duplicate paths', () => {
    expect(isArchitecturePlan({
      stack: {},
      files: [{ ...base, path: 'a.ts' }, { ...base, path: 'a.ts' }]
    })).toBe(false);
  });
  it('rejects absolute paths', () => {
    expect(isArchitecturePlan({
      stack: {},
      files: [{ ...base, path: '/etc/passwd' }]
    })).toBe(false);
  });
  it('rejects parent traversal', () => {
    expect(isArchitecturePlan({
      stack: {},
      files: [{ ...base, path: '../escape.ts' }]
    })).toBe(false);
  });
  it('rejects empty file lists', () => {
    expect(isArchitecturePlan({ stack: {}, files: [] })).toBe(false);
  });
  it('rejects missing file path or type', () => {
    expect(isArchitecturePlan({ stack: {}, files: [{ path: '', type: 'ts' }] })).toBe(false);
    expect(isArchitecturePlan({ stack: {}, files: [{ path: 'a.ts', type: '' }] })).toBe(false);
  });
  it('allows missing description (LLMs omit it)', () => {
    expect(isArchitecturePlan({ stack: {}, files: [{ path: 'a.ts', type: 'ts' }] })).toBe(true);
  });
});

describe('isSecurityIssueArray', () => {
  it('accepts well-formed issues', () => {
    expect(isSecurityIssueArray([
      { id: '1', severity: 'high', type: 'XSS', message: 'm' }
    ])).toBe(true);
  });
  it('accepts optional line and recommendation', () => {
    expect(isSecurityIssueArray([
      { id: '1', severity: 'low', type: 'T', message: 'm', line: 12, recommendation: 'fix' }
    ])).toBe(true);
  });
  it('rejects invalid severities', () => {
    expect(isSecurityIssueArray([
      { id: '1', severity: 'apocalyptic', type: 'T', message: 'm' }
    ])).toBe(false);
  });
  it('rejects missing required strings', () => {
    expect(isSecurityIssueArray([{ severity: 'low', type: 'T', message: 'm' }])).toBe(false);
    expect(isSecurityIssueArray([{ id: '1', type: 'T', message: 'm' }])).toBe(false);
  });
  it('rejects non-arrays', () => {
    expect(isSecurityIssueArray({})).toBe(false);
  });
});

describe('isDebugPlan', () => {
  it('accepts a valid plan', () => {
    expect(isDebugPlan({ diagnosis: 'bad import', fixDirectives: [{ path: 'a.ts', directive: 'fix it' }] })).toBe(true);
  });
  it('rejects empty diagnosis', () => {
    expect(isDebugPlan({ diagnosis: '  ', fixDirectives: [] })).toBe(false);
  });
  it('rejects malformed directives', () => {
    expect(isDebugPlan({ diagnosis: 'x', fixDirectives: [{ path: 'a.ts' }] })).toBe(false);
    expect(isDebugPlan({ diagnosis: 'x', fixDirectives: 'all of them' })).toBe(false);
  });
});

describe('isCodeReviewResult', () => {
  const valid = {
    overallGrade: 'A',
    overallScore: 92,
    qualityScore: 90,
    securityScore: 95,
    perfScore: 88,
    maintainabilityScore: 91,
    suggestions: ['nice'],
    passed: true
  };
  it('accepts a valid review', () => {
    expect(isCodeReviewResult(valid)).toBe(true);
  });
  it('rejects invalid grades', () => {
    expect(isCodeReviewResult({ ...valid, overallGrade: 'A++' })).toBe(false);
  });
  it('rejects NaN/string scores (the "banana" case)', () => {
    expect(isCodeReviewResult({ ...valid, overallScore: 'banana' })).toBe(false);
    expect(isCodeReviewResult({ ...valid, securityScore: Number.NaN })).toBe(false);
  });
  it('rejects missing passed flag', () => {
    const { passed, ...rest } = valid;
    void passed;
    expect(isCodeReviewResult(rest)).toBe(false);
  });
});
