import { PipelineState, LogMessage, AgentFile, SecurityIssue, CodeReviewResult, SyntaxGateResult, DebugPlan, BuildResult } from './state';
import { invokeWithProviderRetry } from './invokeRetry';
import { cleanAndParseJSON } from './llmBuilder';
import { isArchitecturePlan, isSecurityIssueArray, isCodeReviewResult, isDebugPlan } from './validators';
import { ARCHITECT_PROMPT, CODER_PROMPT, SECURITY_SCAN_PROMPT, CODE_REVIEW_PROMPT, DEBUG_PROMPT } from './prompts';
import { fallbackArchitect, fallbackCoder, fallbackSecurityScan, fallbackCodeReview } from './fallbackEngine';
import { runBuildInIsolation } from './buildAgent';
import { BYOKMap } from '../lib/byok';

export interface NodeOptions {
  byokKeys?: BYOKMap;
  envVars?: Record<string, string | undefined>;
  onLog?: (log: LogMessage) => void;
  /** Security issues to fix (used by the fix loop). */
  fixIssues?: SecurityIssue[];
  /** Build-failure repair directive for the target file (Debugger -> Coder). */
  debugDirective?: string;
  /** Marks the single, build-aware project-wide review at the end of the pipeline. */
  finalReview?: boolean;
  /** External abort signal (e.g. client disconnect). */
  signal?: AbortSignal;
}

type Grade = CodeReviewResult['overallGrade'];

function gradeFromScore(score: number): Grade {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Derive an honest per-file grade from its actual SAST findings. */
function deriveFileGrade(issues?: SecurityIssue[]): { grade: string; score: number } {
  const sev = issues || [];
  let score = 92;
  for (const issue of sev) {
    if (issue.severity === 'critical') score -= 25;
    else if (issue.severity === 'high') score -= 15;
    else if (issue.severity === 'medium') score -= 8;
    else score -= 4;
  }
  score = Math.max(40, Math.min(92, score));
  return { grade: gradeFromScore(score), score };
}

// Cap on the reviewer snapshot so large projects don't blow the context window.
const REVIEW_SNAPSHOT_CHARS = 24_000;

/**
 * Build a compact project-context digest for the Coder: per file, the exported
 * symbols and import lines plus a short snippet — far more useful than a raw
 * 200-character slice, and cheap to compute with regexes.
 */
function buildProjectContext(files: Record<string, string>, tree: AgentFile[]): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return '';

  const summaries = entries.map(([path, code]) => {
    const desc = tree.find((f) => f.path === path)?.description || '';
    const exports = extractExports(code);
    const imports = extractImports(code);
    const snippet = code.slice(0, 350);
    return [
      `### ${path}${desc ? ` — ${desc}` : ''}`,
      imports.length ? `Imports: ${imports.join('; ')}` : '',
      exports.length ? `Exports: ${exports.join(', ')}` : '',
      `Snippet:\n${snippet}${code.length > 350 ? '…' : ''}`
    ].filter(Boolean).join('\n');
  });

  return summaries.join('\n\n');
}

function extractImports(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\s+(?:type\s+)?.*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push(m[1] || m[2] || '');
  }
  return out.filter(Boolean);
}

function extractExports(code: string): string[] {
  const out: string[] = [];
  const re = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push(m[1]);
  }
  if (/export\s+default\s/.test(code)) out.push('default');
  return [...new Set(out)];
}

/**
 * Build a bounded, whole-project source snapshot for the Code Reviewer.
 * If the project is huge, include full small files and head-truncate large ones,
 * then say so — the LLM must not silently evaluate an incomplete picture.
 */
function buildCodeSnapshot(files: Record<string, string>): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return '(no files generated yet)';

  let budget = REVIEW_SNAPSHOT_CHARS;
  const parts: string[] = [];
  let truncated = false;

  for (const [path, code] of entries) {
    if (code.length <= budget) {
      parts.push(`\n===== ${path} =====\n${code}`);
      budget -= code.length + path.length + 12;
    } else {
      const head = code.slice(0, Math.min(code.length, Math.max(budget - path.length - 40, 400)));
      parts.push(`\n===== ${path} (truncated) =====\n${head}\n…`);
      truncated = true;
      break;
    }
  }

  if (truncated) {
    parts.push('\n[Note: some files were truncated to fit the context window.]');
  }
  return parts.join('\n');
}

/**
 * Deterministic syntax gate: parse-check every generated source file with
 * esbuild (transform only — NO execution, NO module resolution). This gives the
 * review an objective PASS/FAIL so the LLM can't rate unparseable code highly.
 * Files that esbuild can't load (markdown, html, env) are skipped.
 */
const CODE_LOADERS: Record<string, 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'json'> = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx',
  '.ts': 'ts', '.tsx': 'tsx', '.css': 'css', '.json': 'json'
};

async function checkProjectSyntax(files: Record<string, string>): Promise<SyntaxGateResult> {
  let esbuild: typeof import('esbuild') | null = null;
  try {
    esbuild = await import('esbuild');
  } catch {
    return { ok: true, checked: 0, errors: ['esbuild unavailable'] };
  }

  const errors: string[] = [];
  let checked = 0;

  for (const [path, code] of Object.entries(files)) {
    const loader = CODE_LOADERS[path.slice(path.lastIndexOf('.'))];
    if (!loader || typeof code !== 'string' || code.trim() === '') continue;
    checked++;
    try {
      await esbuild.transform(code, { loader, logLevel: 'silent' });
    } catch (err) {
      const first = err instanceof Error ? err.message.split('\n')[0] : String(err);
      errors.push(`${path}: ${first.slice(0, 160)}`);
    }
  }

  return { ok: errors.length === 0, checked, errors };
}

/**
 * Extract real source code from a Coder LLM response. Handles strict-JSON,
 * markdown-fenced, and plain-text output — and refuses to let the unparseable
 * JSON wrapper (`{"path": ..., "code": ...}`) leak into generated files.
 */
function extractCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Attempt 1: strict JSON { "code": "..." }
  try {
    const parsed = cleanAndParseJSON<{ code?: string }>(trimmed);
    if (parsed && typeof parsed.code === 'string' && parsed.code.trim() !== '') {
      return parsed.code;
    }
  } catch {
    // fall through to the next attempt
  }

  // Attempt 2: markdown code fences
  const fenced = trimmed.match(/```(?:[a-zA-Z]*)\n?([\s\S]*?)```/);
  if (fenced && fenced[1] && fenced[1].trim() !== '') return fenced[1];

  // Attempt 3: unparseable JSON wrapper -> refuse (never write wrapper to file)
  if (/^\s*\{/.test(trimmed) && /"code"\s*:/.test(trimmed)) return null;

  // Attempt 4: plain text code
  return trimmed;
}

export async function architectNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Architect',
    provider: 'Provider Pool',
    message: `Designing project architecture and file structure for prompt: "${state.prompt.slice(0, 60)}..."`,
    type: 'info'
  };
  options.onLog?.(log);

  try {
    const { content: raw, providerName, model } = await invokeWithProviderRetry({
      taskType: 'architect',
      byokKeys: options.byokKeys,
      envVars: options.envVars,
      systemPrompt: ARCHITECT_PROMPT,
      userPrompt: `User Project Prompt: "${state.prompt}"`
    });

    const parsed = cleanAndParseJSON<{ stack: PipelineState['stack']; files: AgentFile[] }>(raw);

    if (!isArchitecturePlan(parsed)) {
      throw new Error('Architect returned an invalid architecture plan (bad schema, duplicate/absolute paths, or empty file list)');
    }

    const formattedFiles: AgentFile[] = parsed.files.map(f => ({
      ...f,
      status: 'pending'
    }));

    return {
      stack: parsed.stack,
      fileTree: formattedFiles,
      activeAgent: 'Architect',
      activeProvider: providerName,
      activeModel: model,
      pipelineStatus: 'coding',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Architect',
        provider: providerName,
        message: `Architect completed layout. Generated tree with ${formattedFiles.length} files.`,
        type: 'success'
      }]
    };
  } catch (err) {
    console.warn('[ArchitectNode] LLM call failed, employing fallback architect synthesis engine:', err);
    const fallback = fallbackArchitect(state.prompt);
    const formattedFiles: AgentFile[] = fallback.files.map(f => ({
      ...f,
      status: 'pending'
    }));

    return {
      stack: fallback.stack,
      fileTree: formattedFiles,
      activeAgent: 'Architect',
      activeProvider: 'Fallback Engine',
      activeModel: undefined,
      pipelineStatus: 'coding',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Architect',
        provider: 'Fallback Engine',
        message: `Architect synthesis engine fallback created structure with ${formattedFiles.length} files.`,
        type: 'warn'
      }]
    };
  }
}

export async function coderNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const currentFile = state.fileTree[state.currentFileIndex];
  if (!currentFile) {
    return { pipelineStatus: 'reviewing' };
  }

  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Coder',
    provider: 'Provider Pool',
    message: `Generating production code for file [${state.currentFileIndex + 1}/${state.fileTree.length}]: ${currentFile.path}`,
    type: 'info'
  };
  options.onLog?.(log);

  // Update status of file to generating
  const updatedTree = [...state.fileTree];
  updatedTree[state.currentFileIndex] = {
    ...currentFile,
    status: 'generating'
  };

  const existingSummary = buildProjectContext(state.generatedFiles, state.fileTree);

  let userPrompt = CODER_PROMPT
    .replace('{PROMPT}', state.prompt)
    .replace('{STACK}', JSON.stringify(state.stack))
    .replace('{FILE_PATH}', currentFile.path)
    .replace('{FILE_DESC}', currentFile.description)
    .replace('{OTHER_FILES}', existingSummary || 'None yet.');

  // Fix loop: when security found issues in this file, instruct the coder to fix them.
  if (options.fixIssues && options.fixIssues.length > 0) {
    const fixList = options.fixIssues
      .map((iss, i) => `${i + 1}. [${iss.severity}] ${iss.type}: ${iss.message}\n   Fix: ${iss.recommendation}`)
      .join('\n');
    userPrompt += `\n\nIMPORTANT — The security scan of this file found these issues that you MUST fix in your new version:\n${fixList}\nReturn the COMPLETE corrected file.`;
  }

  // Debugger loop: when the Build/Test agent reported this file failing to
  // compile, the coder re-generates it from the Debugger's repair directive.
  if (options.debugDirective) {
    userPrompt += `\n\nIMPORTANT — The Build/Test agent ran the project in a sandbox and this file FAILED to build. Fix it now.\nDebugger directive: ${options.debugDirective}\nReturn the COMPLETE corrected file.`;
  }

  let code: string;
  let providerName = 'Fallback Engine';
  let model: string | undefined;
  let usedTemplateFallback = false;

  try {
    const result = await invokeWithProviderRetry({
      taskType: 'code',
      byokKeys: options.byokKeys,
      envVars: options.envVars,
      systemPrompt: 'You are the Coder agent. Output strict JSON only.',
      userPrompt
    });
    providerName = result.providerName;
    model = result.model;
    const extracted = extractCode(result.content);
    if (extracted !== null) {
      code = extracted;
    } else {
      // LLM succeeded but its output was unusable — be honest about it.
      usedTemplateFallback = true;
      code = fallbackCoder(currentFile.path, state.prompt, state.stack, state.generatedFiles);
    }
  } catch (err) {
    console.warn(`[CoderNode] Code generation failed for ${currentFile.path}, using fallback engine:`, err);
    usedTemplateFallback = true;
    code = fallbackCoder(currentFile.path, state.prompt, state.stack, state.generatedFiles);
  }

  const newGeneratedFiles = { ...state.generatedFiles, [currentFile.path]: code };
  updatedTree[state.currentFileIndex] = {
    ...updatedTree[state.currentFileIndex],
    code,
    status: 'securing'
  };

  const usedFallback = providerName === 'Fallback Engine' || usedTemplateFallback;

  return {
    fileTree: updatedTree,
    generatedFiles: newGeneratedFiles,
    activeAgent: 'Coder',
    activeProvider: providerName,
    activeModel: model,
    pipelineStatus: 'securing',
    logs: [...state.logs, log, {
      id: 'log_' + Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      agent: 'Coder',
      provider: providerName,
      message: usedFallback
        ? `Code synthesis engine fallback generated ${code.split('\n').length} lines for ${currentFile.path}`
        : `Successfully synthesized ${code.split('\n').length} lines of code for ${currentFile.path}`,
      type: usedFallback ? 'warn' : 'success'
    }]
  };
}

export async function securityScanNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const currentFile = state.fileTree[state.currentFileIndex];
  if (!currentFile || !currentFile.code) {
    return { pipelineStatus: 'coding' };
  }

  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Security Scan',
    provider: 'Provider Pool',
    message: `Running SAST OWASP security audit on ${currentFile.path}`,
    type: 'info'
  };
  options.onLog?.(log);

  try {
    const userPrompt = SECURITY_SCAN_PROMPT
      .replace('{FILE_PATH}', currentFile.path)
      .replace('{CODE}', currentFile.code);

    const { content: raw, providerName, model } = await invokeWithProviderRetry({
      taskType: 'security',
      byokKeys: options.byokKeys,
      envVars: options.envVars,
      systemPrompt: 'You are a SAST security scanner. Output strict JSON only.',
      userPrompt
    });

    const parsed = cleanAndParseJSON<{ issues?: SecurityIssue[] }>(raw);
    let issues: SecurityIssue[] = [];
    if (Array.isArray(parsed?.issues) && isSecurityIssueArray(parsed.issues)) {
      issues = parsed.issues;
    } else {
      // Never silently claim "clean" when the scanner returned garbage.
      console.warn(`[SecurityScanNode] Scanner returned malformed findings for ${currentFile.path}, merging heuristic scan.`);
      issues = fallbackSecurityScan(currentFile.path, currentFile.code);
    }

    const updatedTree = [...state.fileTree];
    updatedTree[state.currentFileIndex] = {
      ...updatedTree[state.currentFileIndex],
      securityIssues: issues,
      status: 'reviewing'
    };

    return {
      fileTree: updatedTree,
      activeAgent: 'Security Scan',
      activeProvider: providerName,
      activeModel: model,
      pipelineStatus: 'reviewing',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Security Scan',
        provider: providerName,
        message: `Security Scan completed for ${currentFile.path}. Found ${issues.length} potential issues.`,
        type: issues.length > 0 ? 'warn' : 'success'
      }]
    };
  } catch (err) {
    console.warn(`[SecurityScanNode] Failed for ${currentFile.path}, using fallback scanner:`, err);
    const issues = fallbackSecurityScan(currentFile.path, currentFile.code);

    const updatedTree = [...state.fileTree];
    updatedTree[state.currentFileIndex] = {
      ...updatedTree[state.currentFileIndex],
      securityIssues: issues,
      status: 'reviewing'
    };

    return {
      fileTree: updatedTree,
      activeAgent: 'Security Scan',
      activeProvider: 'Fallback Scanner',
      activeModel: undefined,
      pipelineStatus: 'reviewing',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Security Scan',
        provider: 'Fallback Scanner',
        message: `SAST fallback audit completed for ${currentFile.path}. Found ${issues.length} security flags.`,
        type: 'info'
      }]
    };
  }
}

export async function codeReviewNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const isFinal = options.finalReview === true;

  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Code Review',
    provider: 'Provider Pool',
    message: isFinal
      ? `Evaluating overall software quality, performance, and maintainability across all ${state.fileTree.length} files.`
      : `Reviewing file [${state.currentFileIndex + 1}/${state.fileTree.length}]`,
    type: 'info'
  };
  options.onLog?.(log);

  // Per-file grade is derived from the file's real SAST findings (never fabricated).
  const updatedTree = [...state.fileTree];
  const currentFile = updatedTree[state.currentFileIndex];
  const derived = currentFile ? deriveFileGrade(currentFile.securityIssues) : null;
  if (currentFile && derived) {
    updatedTree[state.currentFileIndex] = {
      ...currentFile,
      status: 'completed',
      reviewGrade: derived.grade,
      reviewScore: derived.score
    };
  }

  if (!isFinal) {
    // Deterministic per-file review — grade comes from the real SAST scan, no
    // LLM call per file. The single final review (finalReview: true) evaluates
    // the whole project against the actual code + build results.
    const isLastFile = state.currentFileIndex >= state.fileTree.length - 1;
    return {
      fileTree: updatedTree,
      activeAgent: 'Code Review',
      activeProvider: 'SAST Findings',
      activeModel: undefined,
      pipelineStatus: isLastFile ? 'building' : 'coding',
      currentFileIndex: isLastFile ? state.currentFileIndex : state.currentFileIndex + 1,
      logs: [
        ...state.logs,
        log,
        {
          id: 'log_' + Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          agent: 'Code Review',
          provider: 'SAST Findings',
          message: `Review stage complete for ${currentFile?.path}. Per-file grade: ${derived?.grade || 'n/a'} (${derived?.score ?? 0}/100).`,
          type: 'info'
        }
      ]
    };
  }

  // Deterministic gates on the FINAL review only: parse-check every generated
  // code file (esbuild, no execution) plus the real Build/Test result, so the
  // review score can't claim "98/100" for code that doesn't even parse or build.
  const buildGate = await checkProjectSyntax(state.generatedFiles).catch(() => ({
    ok: true,
    checked: 0,
    errors: ['syntax check unavailable']
  }));
  const build = state.buildResult;

  try {
    const fileList = state.fileTree.map(f => `${f.path} (${f.description})`).join(', ');
    const allSecIssues = state.fileTree.flatMap(f => f.securityIssues || []);
    const securitySummary = `${allSecIssues.length} total issues found. (${allSecIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length} critical/high)`;

    // Send the reviewer the ACTUAL source code (bounded), not just filenames.
    // A reviewer that only sees file names cannot evaluate implementation quality.
    const projectSnapshot = buildCodeSnapshot(state.generatedFiles);

    const gateLine = buildGate.ok
      ? `Syntax gate: PASS (${buildGate.checked} files parse cleanly)`
      : `Syntax gate: FAIL — ${buildGate.errors.length} error(s), e.g. ${buildGate.errors[0]}`;

    const buildLine = !build
      ? 'Build/Test: not run.'
      : build.status === 'passed'
        ? `Build/Test: PASSED (${build.phase}, ${(build.durationMs / 1000).toFixed(1)}s)`
        : build.status === 'skipped'
          ? `Build/Test: SKIPPED — ${build.stdout}`
          : `Build/Test: FAILED at ${build.phase} (exit ${build.exitCode}) — ${build.errors[0] || build.stderr.slice(0, 200)}`;

    const userPrompt = CODE_REVIEW_PROMPT
      .replace('{FILE_LIST}', fileList)
      .replace('{SECURITY_SUMMARY}', securitySummary)
      .replace('{PROJECT_SNAPSHOT}', projectSnapshot)
      .replace('{BUILD_GATE}', gateLine)
      .replace('{BUILD_RESULT}', buildLine);

    const { content: raw, providerName, model } = await invokeWithProviderRetry({
      taskType: 'review',
      byokKeys: options.byokKeys,
      envVars: options.envVars,
      systemPrompt: 'You are a senior Code Reviewer agent. Output strict JSON only.',
      userPrompt
    });

    const parsed = cleanAndParseJSON<CodeReviewResult>(raw);
    if (!isCodeReviewResult(parsed)) {
      throw new Error('Code Reviewer returned an invalid review result (missing or non-numeric scores)');
    }
    let reviewResult = parsed;

    // Objective gate overrides: if generated code doesn't parse, or the real
    // install/build/test run failed, the project cannot be "passing" regardless
    // of what the LLM says. Cap at 59/F.
    const syntaxFailed = buildGate && !buildGate.ok && buildGate.checked > 0;
    const buildFailed = build?.status === 'failed';
    if (syntaxFailed || buildFailed) {
      reviewResult = {
        ...reviewResult,
        overallScore: Math.min(reviewResult.overallScore, 59),
        overallGrade: 'F',
        passed: false
      };
    }

    return {
      fileTree: updatedTree,
      reviewResult: { ...reviewResult, buildStatus: buildGate },
      activeAgent: 'Code Review',
      activeProvider: providerName,
      activeModel: model,
      pipelineStatus: 'completed',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Code Review',
        provider: providerName,
        message: `Final Code Review finished. Overall Grade: ${reviewResult.overallGrade} (${reviewResult.overallScore}/100)${buildFailed ? ' — build failed, score capped' : ''}`,
        type: buildFailed ? 'warn' : 'success'
      }]
    };
  } catch (err) {
    console.warn('[CodeReviewNode] Review LLM failed, using fallback reviewer:', err);
    let reviewResult = fallbackCodeReview(state.generatedFiles);

    // Apply the same objective gate cap to the fallback reviewer's score.
    const syntaxFailed = buildGate && !buildGate.ok && buildGate.checked > 0;
    const buildFailed = build?.status === 'failed';
    if (syntaxFailed || buildFailed) {
      reviewResult = {
        ...reviewResult,
        overallScore: Math.min(reviewResult.overallScore, 59),
        overallGrade: 'F',
        passed: false
      };
    }

    return {
      fileTree: updatedTree,
      reviewResult: { ...reviewResult, buildStatus: buildGate },
      activeAgent: 'Code Review',
      activeProvider: 'Fallback Reviewer',
      activeModel: undefined,
      pipelineStatus: 'completed',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Code Review',
        provider: 'Fallback Reviewer',
        message: `Code Review engine completed. Final Score: ${reviewResult.overallGrade} (${reviewResult.overallScore}/100)`,
        type: 'info'
      }]
    };
  }
}

/**
 * Build/Test Node — runs the REAL toolchain (install + build + test) on the
 * generated project inside a fresh temp dir. Never executes generated code on
 * the host. Failures feed the Debugger -> Coder repair loop.
 */
export async function buildTestNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Build/Test',
    provider: 'Sandbox Runner',
    message: 'Installing dependencies and running the build in an isolated sandbox (generated code is never executed on the host).',
    type: 'info'
  };
  options.onLog?.(log);

  let result: BuildResult;
  try {
    result = await runBuildInIsolation(state.generatedFiles, options.signal);
  } catch (err) {
    // runBuildInIsolation handles its own failures; this is a last-resort guard.
    console.warn('[BuildTestNode] Build runner error:', err);
    result = {
      status: 'failed',
      phase: 'none',
      exitCode: null,
      stdout: '',
      stderr: '',
      errors: [err instanceof Error ? err.message : String(err)],
      failingFiles: [],
      durationMs: 0
    };
  }

  const duration = (result.durationMs / 1000).toFixed(1);
  let message: string;
  let type: 'success' | 'info' | 'error';
  if (result.status === 'passed') {
    message = result.phase === 'build'
      ? `Build/Test passed: dependencies installed and \`build\` succeeded (${duration}s).`
      : result.phase === 'test'
        ? `Build/Test passed: dependencies installed and \`test\` succeeded (${duration}s).`
        : `Build/Test passed: dependencies installed cleanly (${duration}s).`;
    type = 'success';
  } else if (result.status === 'skipped') {
    message = `Build/Test skipped: ${result.stdout}`;
    type = 'info';
  } else {
    message = `Build/Test failed at ${result.phase}: ${result.errors[0] || result.stderr.split('\n').find(Boolean) || 'unknown error'}`;
    type = 'error';
  }

  return {
    buildResult: result,
    activeAgent: 'Build/Test',
    activeProvider: 'Sandbox Runner',
    activeModel: undefined,
    pipelineStatus: result.status === 'failed' ? 'debugging' : 'reviewing',
    logs: [...state.logs, log, {
      id: 'log_' + Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      agent: 'Build/Test',
      provider: 'Sandbox Runner',
      message,
      type
    }]
  };
}

/**
 * Debugger Node — diagnoses a failed build from the real toolchain output and
 * produces targeted repair directives for the Coder. Falls back to a heuristic
 * that maps common error patterns to directives when the LLM is unavailable.
 */
export async function debuggerNode(state: PipelineState, options: NodeOptions = {}): Promise<Partial<PipelineState>> {
  const build = state.buildResult;
  const log: LogMessage = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toLocaleTimeString(),
    agent: 'Debugger',
    provider: 'Provider Pool',
    message: `Diagnosing build failure (repair round ${state.buildAttempts + 1}/${state.maxBuildAttempts})...`,
    type: 'info'
  };
  options.onLog?.(log);

  try {
    const buildOutput = build
      ? `Phase: ${build.phase}\nExit code: ${build.exitCode}\nFailing files: ${build.failingFiles.join(', ') || 'unknown'}\nErrors:\n${(build.errors.join('\n') || build.stderr || build.stdout).slice(0, 6000)}`
      : 'No build result available.';

    const userPrompt = DEBUG_PROMPT
      .replace('{BUILD_OUTPUT}', buildOutput)
      .replace('{PROJECT_SNAPSHOT}', buildCodeSnapshot(state.generatedFiles));

    const { content, providerName, model } = await invokeWithProviderRetry({
      taskType: 'debug',
      byokKeys: options.byokKeys,
      envVars: options.envVars,
      systemPrompt: 'You are the Debugger agent. Output strict JSON only.',
      userPrompt
    });

    const parsed = cleanAndParseJSON<DebugPlan>(content);
    if (!isDebugPlan(parsed)) {
      throw new Error('Debugger returned an invalid plan (missing diagnosis or directives)');
    }

    return {
      debugPlan: parsed,
      activeAgent: 'Debugger',
      activeProvider: providerName,
      activeModel: model,
      pipelineStatus: 'coding',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Debugger',
        provider: providerName,
        message: `Debugger diagnosed: ${parsed.diagnosis} (${parsed.fixDirectives.length} file(s) to fix).`,
        type: parsed.fixDirectives.length > 0 ? 'warn' : 'info'
      }]
    };
  } catch (err) {
    console.warn('[DebuggerNode] Debug LLM failed, using heuristic debugger:', err);
    const plan = fallbackDebugPlan(build);
    return {
      debugPlan: plan,
      activeAgent: 'Debugger',
      activeProvider: 'Heuristic Debugger',
      activeModel: undefined,
      pipelineStatus: 'coding',
      logs: [...state.logs, log, {
        id: 'log_' + Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        agent: 'Debugger',
        provider: 'Heuristic Debugger',
        message: `Heuristic debugger: ${plan.diagnosis} (${plan.fixDirectives.length} file(s) to fix).`,
        type: plan.fixDirectives.length > 0 ? 'warn' : 'info'
      }]
    };
  }
}

/** Deterministic debugger: maps common build-error patterns to repair directives. */
function fallbackDebugPlan(build?: BuildResult): DebugPlan {
  if (!build) return { diagnosis: 'No build output to diagnose.', fixDirectives: [] };

  const firstError = build.errors[0] || build.stderr.trim().split('\n').find(Boolean) || 'build failed';
  const diagnosis = `Build failed at ${build.phase} (exit ${build.exitCode}): ${firstError.slice(0, 200)}`;

  const combined = `${build.stderr}\n${build.stdout}`;
  const rules: Array<{ re: RegExp; directive: string }> = [
    { re: /Module not found|Cannot find module|Can't resolve|Unable to resolve|Failed to resolve/i, directive: 'Add the missing import, or install and declare the missing dependency referenced by the error.' },
    { re: /SyntaxError|Unexpected token|Unexpected end|Transform failed|Missing semicolon|Unterminated/i, directive: 'Fix the syntax error near the line reported in the build output.' },
    { re: /Cannot find name|is not defined|No variable named/i, directive: 'Define or import the referenced name/variable before it is used.' },
    { re: /is not a function|TypeError|Cannot read properties/i, directive: 'Fix the runtime type error — only call/read values after verifying their shape.' },
    { re: /is not assignable|does not exist on type|Property .* does not exist/i, directive: 'Align this file with the declared types and public API of the modules it uses.' },
    { re: /ERESOLVE|ETARGET|ENOTFOUND|404 Not Found|No matching version/i, directive: 'Fix package.json dependency versions to valid, resolvable ranges.' }
  ];
  const hit = rules.find((r) => r.re.test(combined));

  const fixDirectives = build.failingFiles.map((file) => ({
    path: file,
    directive: hit
      ? `${hit.directive} Reported error: ${firstError.slice(0, 160)}`
      : `Fix the errors reported for this file in the build output. Reported error: ${firstError.slice(0, 160)}`
  }));

  return { diagnosis, fixDirectives };
}
