import { describe, it, expect } from 'vitest';
import { extractCode, deriveFileGrade } from './nodes';
import { SecurityIssue } from './state';

describe('extractCode', () => {
  it('extracts code from strict JSON wrapper', () => {
    const raw = JSON.stringify({ path: 'a.ts', code: 'const x = 1;' });
    expect(extractCode(raw)).toBe('const x = 1;');
  });

  it('extracts code from markdown-fenced output', () => {
    // Content between fences is returned verbatim (trailing newline included).
    expect(extractCode('```ts\nconst x = 1;\n```')).toBe('const x = 1;\n');
  });

  it('refuses to unwrap an unparseable JSON wrapper (never writes it as code)', () => {
    const raw = '{"path": "a.ts", "code": "broken trailing';
    expect(extractCode(raw)).toBeNull();
  });

  it('returns plain-text code as-is', () => {
    expect(extractCode('function hello() {\n  return "hi";\n}')).toContain('hello');
  });

  it('returns null for empty input', () => {
    expect(extractCode('')).toBeNull();
    expect(extractCode('   ')).toBeNull();
  });

  it('handles fenced code inside a JSON string with newlines', () => {
    const inner = 'line1\nline2';
    const raw = '{"code": "' + inner.replace('\n', '\\n') + '"}';
    expect(extractCode(raw)).toBe(inner);
  });
});

describe('deriveFileGrade', () => {
  const issue = (severity: SecurityIssue['severity']): SecurityIssue => ({
    id: severity,
    severity,
    type: 'test',
    message: 'm',
    recommendation: 'r'
  });

  it('gives top marks to clean files', () => {
    const { grade, score } = deriveFileGrade([]);
    expect(score).toBe(92);
    expect(grade).toBe('A');
  });

  it('penalizes critical issues hardest', () => {
    const { score } = deriveFileGrade([issue('critical')]);
    expect(score).toBeLessThanOrEqual(70);
  });

  it('scores are monotonic in severity', () => {
    const critical = deriveFileGrade([issue('critical')]).score;
    const high = deriveFileGrade([issue('high')]).score;
    const medium = deriveFileGrade([issue('medium')]).score;
    const low = deriveFileGrade([issue('low')]).score;
    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
  });

  it('clamps the floor at 40 even with many critical issues', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...issue('critical'), id: String(i) }));
    expect(deriveFileGrade(many).score).toBe(40);
  });

  it('treats undefined findings as clean', () => {
    expect(deriveFileGrade(undefined).score).toBe(92);
  });
});
