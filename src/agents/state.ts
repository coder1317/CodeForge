export interface SecurityIssue {
  id: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  type: string;
  message: string;
  recommendation: string;
}

export interface SyntaxGateResult {
  ok: boolean;
  checked: number;
  errors: string[];
}

/** Result of the deterministic Build/Test agent (real install + build in an isolated temp dir). */
export interface BuildResult {
  status: 'passed' | 'failed' | 'skipped';
  /** The phase that determined the outcome. */
  phase: 'install' | 'build' | 'test' | 'none';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errors: string[];
  /** Files implicated by build errors (heuristic). */
  failingFiles: string[];
  durationMs: number;
  command?: string;
}

/** Diagnosis + targeted repair directives produced by the Debugger agent. */
export interface DebugPlan {
  diagnosis: string;
  fixDirectives: { path: string; directive: string }[];
}

export interface CodeReviewResult {
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  overallScore: number; // 0 - 100
  qualityScore: number;
  securityScore: number;
  perfScore: number;
  maintainabilityScore: number;
  suggestions: string[];
  passed: boolean;
  /** Deterministic syntax/parse-check result (esbuild, no execution). */
  buildStatus?: SyntaxGateResult;
}

export interface AgentFile {
  path: string;
  type: string;
  description: string;
  code?: string;
  securityIssues?: SecurityIssue[];
  reviewGrade?: string;
  reviewScore?: number;
  reviewSuggestions?: string[];
  status?: 'pending' | 'generating' | 'securing' | 'reviewing' | 'completed' | 'failed';
}

export interface TechStack {
  frontend?: string;
  backend?: string;
  database?: string;
  auth?: string;
  language?: string;
  libraries?: string[];
}

export interface LogMessage {
  id: string;
  timestamp: string;
  agent: 'Architect' | 'Coder' | 'Security Scan' | 'Code Review' | 'Build/Test' | 'Debugger' | 'Orchestrator';
  provider: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

export interface PipelineState {
  prompt: string;
  stack: TechStack;
  fileTree: AgentFile[];
  generatedFiles: Record<string, string>; // path -> code
  currentFileIndex: number;
  pipelineStatus: 'idle' | 'architecting' | 'coding' | 'securing' | 'reviewing' | 'building' | 'debugging' | 'completed' | 'failed';
  activeAgent: 'Architect' | 'Coder' | 'Security Scan' | 'Code Review' | 'Build/Test' | 'Debugger' | null;
  activeProvider?: string;
  activeModel?: string;
  reviewResult?: CodeReviewResult;
  /** Result of the real Build/Test agent (install + build, sandboxed). */
  buildResult?: BuildResult;
  /** Repair plan from the Debugger agent when a build fails. */
  debugPlan?: DebugPlan;
  logs: LogMessage[];
  iterationCount: number;
  maxIterations: number;
  /** Build-repair rounds consumed so far (bounded by maxBuildAttempts). */
  buildAttempts: number;
  maxBuildAttempts: number;
}

export const initialPipelineState: PipelineState = {
  prompt: '',
  stack: {},
  fileTree: [],
  generatedFiles: {},
  currentFileIndex: 0,
  pipelineStatus: 'idle',
  activeAgent: null,
  logs: [],
  iterationCount: 0,
  maxIterations: 2,
  buildAttempts: 0,
  maxBuildAttempts: 2
};
