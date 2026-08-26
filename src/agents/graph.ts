import { PipelineState, SecurityIssue } from './state';
import { architectNode, coderNode, securityScanNode, codeReviewNode, buildTestNode, debuggerNode, NodeOptions } from './nodes';
import { fallbackSecurityScan } from './fallbackEngine';
import { BuildResult } from './state';

/**
 * CodeForgeOrchestrator — the multi-agent pipeline driver.
 *
 * Pipeline: Architect → for each file { Coder → Security Scan → [Converging fix loop] }
 *           → Build/Test (sandboxed install+build) → [Debugger → Coder repair loop]
 *           → Final build-aware Review.
 *
 * Loop invariants enforced here:
 *  - SECURITY FIX LOOP is converging: it re-fixes a file only while critical
 *    issues remain, budget (`maxIterations`) allows it, AND the previous fix
 *    round measurably reduced the weighted severity of findings. A round that
 *    doesn't improve anything terminates the loop instead of burning quota.
 *  - BUILD REPAIR LOOP is verified: files are only regenerated when another
 *    build will follow, so no repair is ever left unverified by the real
 *    toolchain. An identical error signature across consecutive builds
 *    short-circuits the loop (no-progress guard).
 *  - RETRY ROUNDS ESCALATE: after the first failed attempt, provider selection
 *    prefers keyed cloud models over the free/local ones that already failed.
 */
export class CodeForgeOrchestrator {
  private state: PipelineState;
  private options: NodeOptions;

  constructor(initialState: PipelineState, options: NodeOptions = {}) {
    this.state = { ...initialState };
    this.options = options;
  }

  public getState(): PipelineState {
    return this.state;
  }

  /** Weighted severity of an issue set — lower is better. Used to detect convergence. */
  private static issueWeight(issues: SecurityIssue[]): number {
    return issues.reduce((acc, i) => {
      switch (i.severity) {
        case 'critical': return acc + 8;
        case 'high': return acc + 4;
        case 'medium': return acc + 2;
        case 'low': return acc + 1;
        default: return acc;
      }
    }, 0);
  }

  /** Stable signature of a build failure — identical signatures mean no progress. */
  private static errorSignature(r?: BuildResult): string {
    if (!r) return '';
    const errors = r.errors.length > 0
      ? r.errors.map((e) => e.trim())
      : [r.stderr.trim().split('\n').find(Boolean) || ''].filter(Boolean);
    return [r.phase, r.exitCode ?? 'null', ...errors].join('|').slice(0, 800);
  }

  public async *runStream(signal?: AbortSignal): AsyncGenerator<{ event: string; data: Partial<PipelineState> }> {
    const abortError = () => {
      const err = new Error('Generation aborted');
      err.name = 'AbortError';
      return err;
    };
    const checkAbort = () => {
      if (signal?.aborted) throw abortError();
    };
    // All nodes receive the external abort signal so an in-flight LLM call is
    // cancelled immediately instead of waiting out its full timeout.
    const nodeOpts = (extra: Partial<NodeOptions> = {}): NodeOptions => ({ ...this.options, signal, ...extra });

    // 1. Architect Node
    this.state.pipelineStatus = 'architecting';
    this.state.activeAgent = 'Architect';
    yield { event: 'state_update', data: { ...this.state } };

    const architectUpdate = await architectNode(this.state, nodeOpts());
    this.state = { ...this.state, ...architectUpdate };
    yield { event: 'state_update', data: { ...this.state } };

    if (!this.state.fileTree || this.state.fileTree.length === 0) {
      this.state.pipelineStatus = 'failed';
      yield { event: 'state_update', data: { ...this.state } };
      return;
    }

    // Loop through each file in fileTree.
    // Per-file review is deterministic (grade derived from SAST findings); the
    // last file transitions to the 'building' phase, after which the real
    // Build/Test agent runs and a single build-aware final review is produced.
    while (this.state.currentFileIndex < this.state.fileTree.length) {
      checkAbort();

      // maxIterations is a PER-FILE fix budget: reset the counter at the start
      // of each file so one stubborn file can't consume the whole project's
      // repair iterations.
      this.state.iterationCount = 0;

      // 2. Coder Node
      this.state.pipelineStatus = 'coding';
      this.state.activeAgent = 'Coder';
      yield { event: 'state_update', data: { ...this.state } };

      const coderUpdate = await coderNode(this.state, nodeOpts());
      this.state = { ...this.state, ...coderUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // 3. Security Scan Node (+ converging fix loop)
      this.state.pipelineStatus = 'securing';
      this.state.activeAgent = 'Security Scan';
      yield { event: 'state_update', data: { ...this.state } };

      const secUpdate = await securityScanNode(this.state, nodeOpts());
      this.state = { ...this.state, ...secUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // Fix loop: re-generate + re-scan while actionable issues remain, budget
      // is left, and the previous round actually improved things.
      let weight = CodeForgeOrchestrator.issueWeight(
        this.state.fileTree[this.state.currentFileIndex]?.securityIssues || []
      );
      while (
        weight > 0 &&
        this.state.iterationCount < this.state.maxIterations &&
        !signal?.aborted
      ) {
        checkAbort();
        const currentFile = this.state.fileTree[this.state.currentFileIndex];
        const issues = currentFile?.securityIssues || [];
        const criticalOrHigh = issues.filter(
          (i) => i.severity === 'critical' || i.severity === 'high'
        );

        this.state.iterationCount += 1;
        this.state.pipelineStatus = 'coding';
        this.state.activeAgent = 'Coder';
        yield { event: 'state_update', data: { ...this.state } };

        const fixOptions = nodeOpts({ fixIssues: issues });
        const fixUpdate = await coderNode(this.state, fixOptions);
        this.state = { ...this.state, ...fixUpdate, iterationCount: this.state.iterationCount };
        yield { event: 'state_update', data: { ...this.state } };

        this.state.pipelineStatus = 'securing';
        this.state.activeAgent = 'Security Scan';
        yield { event: 'state_update', data: { ...this.state } };

        const reScan = await securityScanNode(this.state, nodeOpts());
        this.state = { ...this.state, ...reScan, iterationCount: this.state.iterationCount };
        yield { event: 'state_update', data: { ...this.state } };

        const reScannedFile = this.state.fileTree[this.state.currentFileIndex];
        const remaining = reScannedFile?.securityIssues?.length || 0;
        const newWeight = CodeForgeOrchestrator.issueWeight(reScannedFile?.securityIssues || []);
        const improved = newWeight < weight;
        weight = newWeight;

        const log: Partial<PipelineState> = {
          logs: [
            ...this.state.logs,
            {
              id: 'log_fix_' + Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              agent: 'Orchestrator',
              provider: 'CodeForge Engine',
              message: criticalOrHigh.length > 0
                ? `Fix round ${this.state.iterationCount}/${this.state.maxIterations}: re-generated ${currentFile.path} after ${criticalOrHigh.length} critical/high finding(s); ${remaining} issue(s) remain${improved ? '' : ', NO improvement — stopping fix loop'}.`
                : `Fix round ${this.state.iterationCount}/${this.state.maxIterations}: re-generated ${currentFile.path} to address ${issues.length} finding(s); ${remaining} issue(s) remain${improved ? '' : ', NO improvement — stopping fix loop'}.`,
              type: remaining === 0 ? 'success' : improved ? 'warn' : 'error'
            }
          ]
        };
        this.state = { ...this.state, ...log };
        yield { event: 'state_update', data: { ...this.state } };

        // Convergence gate: a fix round that didn't reduce weighted severity
        // won't magically succeed if repeated verbatim — stop and move on.
        if (!improved) break;
      }

      // 4. Code Review Node
      checkAbort();
      this.state.pipelineStatus = 'reviewing';
      this.state.activeAgent = 'Code Review';
      yield { event: 'state_update', data: { ...this.state } };

      const reviewUpdate = await codeReviewNode(this.state, nodeOpts());
      this.state = { ...this.state, ...reviewUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // All files reviewed — move on to the Build/Test phase.
      if (this.state.currentFileIndex >= this.state.fileTree.length - 1) break;
    }

    // 5. Build/Test Agent + Debugger -> Coder VERIFIED repair loop.
    // Runs the REAL toolchain (npm install + build + optional test) in an
    // isolated temp dir. On failure: diagnose, repair implicated files, and
    // RE-BUILD. Repairs never happen without a following rebuild, so every
    // generated change is verified before review sees it.
    let lastErrorSig = '';
    while (this.state.buildAttempts < this.state.maxBuildAttempts) {
      checkAbort();

      this.state.pipelineStatus = 'building';
      this.state.activeAgent = 'Build/Test';
      yield { event: 'state_update', data: { ...this.state } };

      const buildUpdate = await buildTestNode(this.state, nodeOpts());
      this.state = { ...this.state, ...buildUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      const buildStatus = this.state.buildResult?.status;
      if (buildStatus !== 'failed') break; // passed or skipped

      // No-progress guard: an identical error signature means the previous
      // repair changed nothing — repeating it just burns quota.
      const sig = CodeForgeOrchestrator.errorSignature(this.state.buildResult);
      if (sig !== '' && sig === lastErrorSig) {
        const stuckLog: Partial<PipelineState> = {
          logs: [
            ...this.state.logs,
            {
              id: 'log_build_stuck_' + Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              agent: 'Orchestrator',
              provider: 'CodeForge Engine',
              message: 'Build produced the SAME errors as the previous round — no progress detected. Stopping the repair loop; final review will reflect the failure.',
              type: 'error'
            }
          ]
        };
        this.state = { ...this.state, ...stuckLog };
        yield { event: 'state_update', data: { ...this.state } };
        break;
      }
      lastErrorSig = sig;

      this.state.buildAttempts += 1;

      // Verified-repair invariant: only regenerate files when another rebuild
      // will follow. Otherwise the final review would judge stale results.
      if (this.state.buildAttempts >= this.state.maxBuildAttempts) {
        const exhaustedLog: Partial<PipelineState> = {
          logs: [
            ...this.state.logs,
            {
              id: 'log_build_exhausted_' + Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              agent: 'Orchestrator',
              provider: 'CodeForge Engine',
              message: `Build still failing after ${this.state.buildAttempts}/${this.state.maxBuildAttempts} attempts — repair budget exhausted. Final review will reflect the build failure.`,
              type: 'error'
            }
          ]
        };
        this.state = { ...this.state, ...exhaustedLog };
        yield { event: 'state_update', data: { ...this.state } };
        break;
      }

      this.state.pipelineStatus = 'debugging';
      this.state.activeAgent = 'Debugger';
      yield { event: 'state_update', data: { ...this.state } };

      // Round ≥2 escalates: prefer keyed cloud providers over what already failed.
      const escalate = this.state.buildAttempts > 1;
      const debugUpdate = await debuggerNode(this.state, nodeOpts({ escalate }));
      this.state = { ...this.state, ...debugUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      const directives = (this.state.debugPlan?.fixDirectives || []).filter((d) =>
        this.state.fileTree.some((f) => f.path === d.path)
      );

      if (directives.length === 0) {
        const giveUp: Partial<PipelineState> = {
          logs: [
            ...this.state.logs,
            {
              id: 'log_build_giveup_' + Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              agent: 'Orchestrator',
              provider: 'CodeForge Engine',
              message: `No actionable fix directive was produced for the build failure. Final review will reflect the build failure.`,
              type: 'error'
            }
          ]
        };
        this.state = { ...this.state, ...giveUp };
        yield { event: 'state_update', data: { ...this.state } };
        break;
      }

      // Re-generate each implicated file from the Debugger's directive.
      for (const d of directives) {
        checkAbort();
        const idx = this.state.fileTree.findIndex((f) => f.path === d.path);
        if (idx === -1) continue;
        this.state.currentFileIndex = idx;
        this.state.pipelineStatus = 'coding';
        this.state.activeAgent = 'Coder';
        yield { event: 'state_update', data: { ...this.state } };

        const fixUpdate = await coderNode(this.state, nodeOpts({ debugDirective: d.directive, escalate }));
        this.state = { ...this.state, ...fixUpdate };
        yield { event: 'state_update', data: { ...this.state } };

        // The repaired file skipped the LLM security re-scan (the build loop is
        // about compilation). Re-run the fast deterministic scan so findings and
        // status reflect the NEW code instead of lingering stale, and so the file
        // isn't left stuck in 'securing' state.
        const repairedPath = this.state.fileTree[idx]?.path;
        const repairedCode = this.state.generatedFiles[repairedPath || ''];
        if (repairedPath && repairedCode) {
          const refreshedIssues = fallbackSecurityScan(repairedPath, repairedCode);
          const tree = [...this.state.fileTree];
          tree[idx] = {
            ...tree[idx],
            code: repairedCode,
            securityIssues: refreshedIssues,
            status: 'completed'
          };
          this.state = { ...this.state, fileTree: tree };
          yield { event: 'state_update', data: { ...this.state } };
        }
      }

      const repairLog: Partial<PipelineState> = {
        logs: [
          ...this.state.logs,
          {
            id: 'log_build_repair_' + Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            agent: 'Orchestrator',
            provider: 'CodeForge Engine',
            message: `Repair round ${this.state.buildAttempts}/${this.state.maxBuildAttempts - 1}: regenerated ${directives.length} file(s) from the Debugger's directives${escalate ? ' (provider escalation ON)' : ''}. Re-building...`,
            type: 'warn'
          }
        ]
      };
      this.state = { ...this.state, ...repairLog };
      yield { event: 'state_update', data: { ...this.state } };
    }

    // 6. Final build-aware Code Review (single LLM review of the whole project).
    this.state.currentFileIndex = Math.max(this.state.currentFileIndex, this.state.fileTree.length - 1);
    checkAbort();
    this.state.pipelineStatus = 'reviewing';
    this.state.activeAgent = 'Code Review';
    yield { event: 'state_update', data: { ...this.state } };

    const finalReview = await codeReviewNode(this.state, nodeOpts({ finalReview: true }));
    this.state = { ...this.state, ...finalReview };
    yield { event: 'state_update', data: { ...this.state } };

    // Final state completion
    this.state.pipelineStatus = 'completed';
    this.state.activeAgent = null;
    yield { event: 'done', data: { ...this.state } };
  }
}
