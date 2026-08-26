import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildResult } from './state';

/**
 * Build/Test Agent — runs the REAL build toolchain on generated projects.
 *
 * Safety model (generated code is untrusted):
 *  - Files are copied into a fresh temp dir (never executed in the host repo).
 *  - `npm install` runs with `--ignore-scripts`, so arbitrary postinstall
 *    payloads in dependencies never execute. (Vite/esbuild/tailwind ship their
 *    binaries as optional platform packages, so no scripts are required.)
 *  - Every command has a hard timeout and the whole process group is killed.
 *  - The temp dir is deleted afterwards (keep with CODEFORGE_KEEP_BUILD_DIR=1).
 *  - Toggle off entirely with CODEFORGE_BUILD_AGENT=off.
 */

const OUTPUT_CAP = 60_000; // chars of stdout/stderr kept per command

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: '1', NO_COLOR: '1' }
      });
    } catch (err) {
      finish({
        exitCode: null,
        stdout,
        stderr: `Failed to start ${cmd}: ${err instanceof Error ? err.message : String(err)}`,
        timedOut: false,
        killed: false
      });
      return;
    }

    const killTree = () => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, opts.timeoutMs);

    const onAbort = () => {
      timedOut = false;
      killTree();
    };

    child.stdout?.on('data', (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-OUTPUT_CAP);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-OUTPUT_CAP);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      finish({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.slice(-OUTPUT_CAP),
        timedOut,
        killed: false
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      finish({ exitCode: code, stdout, stderr, timedOut, killed: opts.signal?.aborted === true });
    });

    if (opts.signal?.aborted) {
      onAbort();
    } else {
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

const ERROR_RE = /(?:error|failed|✗|Error:|Module not found|Cannot find|Can't resolve|SyntaxError|Transform failed|Failed to compile|error TS\d+|is not exported|does not provide an export)/i;
const FILE_RE = /([\w@./-]+\.(?:tsx?|jsx?|js|mjs|cjs|css|json|html))/i;

/** Pull concise, actionable error lines + implicated file paths out of command output. */
export function extractIssues(stdout: string, stderr: string): { errors: string[]; failingFiles: string[] } {
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split('\n');
  const errors: string[] = [];
  const failingFiles: string[] = [];
  const seenFiles = new Set<string>();

  for (let i = 0; i < lines.length && errors.length < 12; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 300) continue;
    if (ERROR_RE.test(line)) {
      errors.push(line.slice(0, 240));
      // The error line often references the failing file; if not, peek the next line.
      for (const l of [line, lines[i + 1] || '']) {
        const m = l.match(FILE_RE);
        if (m && !seenFiles.has(m[1])) {
          seenFiles.add(m[1]);
          failingFiles.push(m[1]);
          if (failingFiles.length >= 6) break;
        }
      }
    }
  }

  return { errors: errors.slice(0, 12), failingFiles: failingFiles.slice(0, 6) };
}

function detectPackageManager(): 'npm' | 'bun' {
  const override = process.env.CODEFORGE_PACKAGE_MANAGER;
  if (override === 'npm' || override === 'bun') return override;
  // Default to npm: generated READMEs/docs assume npm, and npm is universally
  // present. Set CODEFORGE_PACKAGE_MANAGER=bun to use bun's faster installer.
  // (If npm is genuinely missing, runCommand surfaces the spawn ENOENT as a
  // structured install failure — no dead branch needed.)
  return 'npm';
}

function skipped(phase: BuildResult['phase'], note: string): BuildResult {
  return {
    status: 'skipped',
    phase,
    exitCode: null,
    stdout: note,
    stderr: '',
    errors: [],
    failingFiles: [],
    durationMs: 0
  };
}

/**
 * Copy generated files into a fresh temp dir, install dependencies, and run the
 * project's build (and test, if defined) with hard timeouts. Never touches the
 * host project. Returns a structured BuildResult.
 */
export async function runBuildInIsolation(
  generatedFiles: Record<string, string>,
  signal?: AbortSignal
): Promise<BuildResult> {
  const started = Date.now();

  if (process.env.CODEFORGE_BUILD_AGENT === 'off') {
    return skipped('none', 'Build agent disabled (CODEFORGE_BUILD_AGENT=off).');
  }

  const entries = Object.entries(generatedFiles);
  if (entries.length === 0) return skipped('none', 'No files generated — nothing to build.');

  const hasPackageJson = entries.some(([p]) => p === 'package.json');
  if (!hasPackageJson) {
    return skipped('none', 'No package.json — nothing to install or build (plain static project).');
  }

  // --- Isolate: fresh temp dir, copy files in ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-build-'));
  try {
    for (const [filePath, code] of entries) {
      if (typeof code !== 'string') continue;
      // Containment: never let a generated file path escape the sandbox
      // (absolute paths or ../ traversal) — defense in depth beyond the
      // architect-stage path validation.
      const resolved = path.resolve(dir, filePath);
      if (!resolved.startsWith(dir + path.sep)) {
        console.warn(`[BuildAgent] Skipping file path that escapes the sandbox: ${filePath}`);
        continue;
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, code);
    }

    const pm = detectPackageManager();

    const installTimeout = Number(process.env.CODEFORGE_INSTALL_TIMEOUT_MS) || 240_000;
    const buildTimeout = Number(process.env.CODEFORGE_BUILD_TIMEOUT_MS) || 180_000;

    // --- Install (no scripts — generated deps never run arbitrary postinstall code) ---
    // NOTE: no --prefer-offline for npm — it resolves against stale cached
    // manifests and produces false ETARGET failures (observed with caniuse-lite).
    const installArgs =
      pm === 'npm'
        ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'];

    const install = await runCommand(pm, installArgs, { cwd: dir, timeoutMs: installTimeout, signal });
    const installTail = (install.stdout || '').trim().split('\n').slice(-4).join('\n');

    if (install.timedOut || install.killed) {
      return {
        status: 'failed',
        phase: 'install',
        exitCode: install.exitCode,
        stdout: install.stdout,
        stderr: install.stderr + (install.timedOut ? `\n[install timed out after ${installTimeout}ms]` : '\n[install aborted]'),
        errors: [install.timedOut ? `Dependency install timed out (${installTimeout}ms).` : 'Dependency install aborted.'],
        failingFiles: ['package.json'],
        durationMs: Date.now() - started,
        command: `${pm} install`
      };
    }
    if (install.exitCode !== 0) {
      const { errors, failingFiles } = extractIssues(install.stdout, install.stderr);
      return {
        status: 'failed',
        phase: 'install',
        exitCode: install.exitCode,
        stdout: install.stdout,
        stderr: install.stderr,
        errors: errors.length ? errors : [installTail || 'npm install failed.'],
        failingFiles: failingFiles.length ? failingFiles : ['package.json'],
        durationMs: Date.now() - started,
        command: `${pm} install`
      };
    }

    // --- Read scripts so we run what the project actually declares ---
    let scripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
    } catch {
      return {
        status: 'failed',
        phase: 'build',
        exitCode: 1,
        stdout: '',
        stderr: 'package.json is not valid JSON — the project cannot be built.',
        errors: ['package.json is not valid JSON.'],
        failingFiles: ['package.json'],
        durationMs: Date.now() - started
      };
    }

    // --- Build ---
    let buildOutput = '';
    if (typeof scripts.build === 'string' && scripts.build.trim() !== '') {
      const build = await runCommand(pm, ['run', 'build'], { cwd: dir, timeoutMs: buildTimeout, signal });
      buildOutput = build.stdout;
      if (build.timedOut || build.killed) {
        return {
          status: 'failed',
          phase: 'build',
          exitCode: build.exitCode,
          stdout: build.stdout,
          stderr: build.stderr + (build.timedOut ? `\n[build timed out after ${buildTimeout}ms]` : '\n[build aborted]'),
          errors: [build.timedOut ? `Build timed out (${buildTimeout}ms).` : 'Build aborted.'],
          failingFiles: [],
          durationMs: Date.now() - started,
          command: `${pm} run build`
        };
      }
      if (build.exitCode !== 0) {
        const { errors, failingFiles } = extractIssues(build.stdout, build.stderr);
        return {
          status: 'failed',
          phase: 'build',
          exitCode: build.exitCode,
          stdout: build.stdout,
          stderr: build.stderr,
          errors: errors.length
            ? errors
            : [(build.stdout || build.stderr || '').trim().split('\n').slice(-3).join(' | ') || 'Build failed.'],
          failingFiles,
          durationMs: Date.now() - started,
          command: `${pm} run build`
        };
      }
    }

    // --- Test (only if the project declares one) ---
    if (typeof scripts.test === 'string' && scripts.test.trim() !== '') {
      const test = await runCommand(pm, ['run', 'test'], { cwd: dir, timeoutMs: buildTimeout, signal });
      if (test.timedOut || test.killed) {
        return {
          status: 'failed',
          phase: 'test',
          exitCode: test.exitCode,
          stdout: test.stdout,
          stderr: test.stderr + (test.timedOut ? `\n[test timed out after ${buildTimeout}ms]` : '\n[test aborted]'),
          errors: [test.timedOut ? `Tests timed out (${buildTimeout}ms).` : 'Tests aborted.'],
          failingFiles: [],
          durationMs: Date.now() - started,
          command: `${pm} run test`
        };
      }
      if (test.exitCode !== 0) {
        const { errors, failingFiles } = extractIssues(test.stdout, test.stderr);
        return {
          status: 'failed',
          phase: 'test',
          exitCode: test.exitCode,
          stdout: test.stdout,
          stderr: test.stderr,
          errors: errors.length ? errors : ['Test script failed.'],
          failingFiles,
          durationMs: Date.now() - started,
          command: `${pm} run test`
        };
      }
    }

    // --- Success ---
    const phase: BuildResult['phase'] = typeof scripts.build === 'string' && scripts.build.trim()
      ? 'build'
      : typeof scripts.test === 'string' && scripts.test.trim()
        ? 'test'
        : 'none';
    return {
      status: 'passed',
      phase,
      exitCode: 0,
      stdout: (buildOutput || installTail).trim(),
      stderr: '',
      errors: [],
      failingFiles: [],
      durationMs: Date.now() - started,
      command: phase === 'build' ? `${pm} run build` : phase === 'test' ? `${pm} run test` : `${pm} install`
    };
  } finally {
    // Always clean up the sandbox unless the user asked to keep it for inspection.
    const keep = process.env.CODEFORGE_KEEP_BUILD_DIR === '1';
    if (keep) {
      // The path is surfaced in the server logs for inspection.
      console.warn(`[BuildAgent] Keeping build sandbox at ${dir} (CODEFORGE_KEEP_BUILD_DIR=1).`);
    } else {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}
