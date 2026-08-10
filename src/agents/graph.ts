import { PipelineState } from './state';
import { architectNode, coderNode, securityScanNode, codeReviewNode, buildTestNode, debuggerNode, NodeOptions } from './nodes';
import { fallbackSecurityScan } from './fallbackEngine';

/**
 * CodeForgeOrchestrator — the multi-agent pipeline driver.
 *
 * (This was originally named `LangGraphOrchestrator` because the project once
 * depended on LangGraph. It is now a purpose-built sequential state machine, so
 * the class is named after the product, not the abandoned framework.)
 *
 * Pipeline: Architect → for each file { Coder → Security Scan → [Fix loop] }
 *           → Build/Test (sandboxed install+build) → [Debugger → Coder repair loop]
 *           → Final build-aware Review.
 *
 * Security fix loop: uses state.iterationCount / state.maxIterations — when the
 * security scan finds issues in a file and iterations remain, the coder is
 * re-invoked with the findings and the file is re-scanned before review.
 *
 * Build repair loop: uses state.buildAttempts / state.maxBuildAttempts — when the
 * real build fails, the Debugger diagnoses the output and the Coder re-generates
 * the implicated files until the build passes or the budget is exhausted.
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

  public async *runStream(signal?: AbortSignal): AsyncGenerator<{ event: string; data: Partial<PipelineState> }> {
    const abortError = () => {
      const err = new Error('Generation aborted');
      err.name = 'AbortError';
      return err;
    };
    const checkAbort = () => {
      if (signal?.aborted) throw abortError();
    };

    // 1. Architect Node
    this.state.pipelineStatus = 'architecting';
    this.state.activeAgent = 'Architect';
    yield { event: 'state_update', data: { ...this.state } };

    const architectUpdate = await architectNode(this.state, this.options);
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
      // repair iterations (it now means "up to N fix rounds per file").
      this.state.iterationCount = 0;

      // 2. Coder Node
      this.state.pipelineStatus = 'coding';
      this.state.activeAgent = 'Coder';
      yield { event: 'state_update', data: { ...this.state } };

      const coderUpdate = await coderNode(this.state, this.options);
      this.state = { ...this.state, ...coderUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // 3. Security Scan Node (+ fix loop)
      this.state.pipelineStatus = 'securing';
      this.state.activeAgent = 'Security Scan';
      yield { event: 'state_update', data: { ...this.state } };

      const secUpdate = await securityScanNode(this.state, this.options);
      this.state = { ...this.state, ...secUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // Fix loop: if the scan found actionable issues and we still have
      // iterations budgeted, have the coder fix them, then re-scan.
      const currentFile = this.state.fileTree[this.state.currentFileIndex];
      const issues = currentFile?.securityIssues || [];
      const criticalOrHigh = issues.filter(
        (i) => i.severity === 'critical' || i.severity === 'high'
      );

      if (issues.length > 0 && this.state.iterationCount < this.state.maxIterations) {
        this.state.iterationCount += 1;
        this.state.pipelineStatus = 'coding';
        this.state.activeAgent = 'Coder';
        yield { event: 'state_update', data: { ...this.state } };

        const fixOptions: NodeOptions = { ...this.options, fixIssues: issues };
        const fixUpdate = await coderNode(this.state, fixOptions);
        this.state = { ...this.state, ...fixUpdate, iterationCount: this.state.iterationCount };
        yield { event: 'state_update', data: { ...this.state } };

        this.state.pipelineStatus = 'securing';
        this.state.activeAgent = 'Security Scan';
        yield { event: 'state_update', data: { ...this.state } };

        const reScan = await securityScanNode(this.state, this.options);
        this.state = { ...this.state, ...reScan, iterationCount: this.state.iterationCount };
        yield { event: 'state_update', data: { ...this.state } };

        const reScannedFile = this.state.fileTree[this.state.currentFileIndex];
        const remaining = reScannedFile?.securityIssues?.length || 0;
        const log: Partial<PipelineState> = {
          logs: [
            ...this.state.logs,
            {
              id: 'log_fix_' + Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              agent: 'Orchestrator',
              provider: 'CodeForge Engine',
              message: criticalOrHigh.length > 0
                ? `Fix loop: re-generated ${currentFile.path} after ${criticalOrHigh.length} critical/high finding(s); ${remaining} issue(s) remain.`
                : `Fix loop: re-generated ${currentFile.path} to address ${issues.length} finding(s); ${remaining} issue(s) remain.`,
              type: remaining > 0 ? 'warn' : 'success'
            }
          ]
        };
        this.state = { ...this.state, ...log };
        yield { event: 'state_update', data: { ...this.state } };
      }

      // 4. Code Review Node
      checkAbort();
      this.state.pipelineStatus = 'reviewing';
      this.state.activeAgent = 'Code Review';
      yield { event: 'state_update', data: { ...this.state } };

      const reviewUpdate = await codeReviewNode(this.state, this.options);
      this.state = { ...this.state, ...reviewUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      // All files reviewed — move on to the Build/Test phase.
      if (this.state.currentFileIndex >= this.state.fileTree.length - 1) break;
    }

    // 5. Build/Test Agent + Debugger -> Coder repair loop.
    // Runs the REAL toolchain (npm install + build + optional test) in an
    // isolated temp dir. On failure, the Debugger diagnoses the output and the
    // Coder re-generates the implicated files; we re-build up to the budget.
    while (this.state.buildAttempts < this.state.maxBuildAttempts) {
      checkAbort();

      this.state.pipelineStatus = 'building';
      this.state.activeAgent = 'Build/Test';
      yield { event: 'state_update', data: { ...this.state } };

      const buildUpdate = await buildTestNode(this.state, { ...this.options, signal });
      this.state = { ...this.state, ...buildUpdate };
      yield { event: 'state_update', data: { ...this.state } };

      const buildStatus = this.state.buildResult?.status;
      if (buildStatus !== 'failed') break; // passed or skipped

      this.state.buildAttempts += 1;
      this.state.pipelineStatus = 'debugging';
      this.state.activeAgent = 'Debugger';
      yield { event: 'state_update', data: { ...this.state } };

      const debugUpdate = await debuggerNode(this.state, { ...this.options, signal });
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
              message: `Build still failing after ${this.state.buildAttempts} repair round(s) and no actionable fix directive was produced. Final review will reflect the build failure.`,
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

        const fixUpdate = await coderNode(this.state, { ...this.options, debugDirective: d.directive, signal });
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
            message: `Repair round ${this.state.buildAttempts}/${this.state.maxBuildAttempts}: regenerated ${directives.length} file(s) from the Debugger's directives. Re-building...`,
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

    const finalReview = await codeReviewNode(this.state, { ...this.options, finalReview: true, signal });
    this.state = { ...this.state, ...finalReview };
    yield { event: 'state_update', data: { ...this.state } };

    // Final state completion
    this.state.pipelineStatus = 'completed';
    this.state.activeAgent = null;
    yield { event: 'done', data: { ...this.state } };
  }
}
