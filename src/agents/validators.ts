// Lightweight runtime validators for LLM outputs.
//
// TypeScript generics like `cleanAndParseJSON<T>` do NOT validate runtime data —
// an LLM can return `{ overallScore: "banana" }` and TS will pretend it's a
// number. These guards shape-check parsed JSON before the pipeline trusts it.

import { AgentFile, CodeReviewResult, DebugPlan, SecurityIssue, TechStack } from './state';

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function isTechStack(x: unknown): x is TechStack {
  if (!isObj(x)) return false;
  for (const k of ['frontend', 'backend', 'database', 'auth', 'language']) {
    if (x[k] !== undefined && !isStr(x[k])) return false;
  }
  if (x.libraries !== undefined && (!Array.isArray(x.libraries) || x.libraries.some((l) => !isStr(l)))) {
    return false;
  }
  return true;
}

/** Validate an architecture plan: stack + a sane, unique file list. */
export function isArchitecturePlan(x: unknown): x is { stack: TechStack; files: AgentFile[] } {
  if (!isObj(x) || !isTechStack(x.stack) || !Array.isArray(x.files)) return false;
  const seen = new Set<string>();
  for (const f of x.files) {
    if (!isObj(f)) return false;
    if (!isStr(f.path) || f.path.trim() === '') return false;
    if (!isStr(f.type) || f.type.trim() === '') return false;
    // description is optional — LLMs omit it often; don't force a fallback over it.
    if (f.description !== undefined && !isStr(f.description)) return false;
    // Sanity checks: no duplicates, no absolute paths, no parent traversal
    if (seen.has(f.path)) return false;
    if (f.path.startsWith('/') || f.path.includes('..')) return false;
    seen.add(f.path);
  }
  return seen.size > 0;
}

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

export function isSecurityIssueArray(x: unknown): x is SecurityIssue[] {
  if (!Array.isArray(x)) return false;
  return x.every((issue) => {
    if (!isObj(issue)) return false;
    if (!isStr(issue.id) || !isStr(issue.message) || !isStr(issue.type)) return false;
    if (!isStr(issue.severity) || !SEVERITIES.has(issue.severity)) return false;
    if (issue.line !== undefined && !isFiniteNum(issue.line)) return false;
    if (issue.recommendation !== undefined && !isStr(issue.recommendation)) return false;
    return true;
  });
}

const GRADES = new Set(['A+', 'A', 'B', 'C', 'D', 'F']);

export function isDebugPlan(x: unknown): x is DebugPlan {
  if (!isObj(x)) return false;
  if (!isStr(x.diagnosis) || x.diagnosis.trim() === '') return false;
  if (!Array.isArray(x.fixDirectives)) return false;
  return x.fixDirectives.every((d) => {
    if (!isObj(d)) return false;
    if (!isStr(d.path) || d.path.trim() === '') return false;
    if (!isStr(d.directive) || d.directive.trim() === '') return false;
    return true;
  });
}

export function isCodeReviewResult(x: unknown): x is CodeReviewResult {
  if (!isObj(x)) return false;
  if (!isStr(x.overallGrade) || !GRADES.has(x.overallGrade)) return false;
  for (const k of ['overallScore', 'qualityScore', 'securityScore', 'perfScore', 'maintainabilityScore']) {
    if (!isFiniteNum(x[k])) return false;
  }
  if (!Array.isArray(x.suggestions) || x.suggestions.some((s) => !isStr(s))) return false;
  if (typeof x.passed !== 'boolean') return false;
  return true;
}
