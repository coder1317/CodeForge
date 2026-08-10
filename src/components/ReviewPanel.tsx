import React from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { CheckCircle2, ShieldAlert, Zap, Layers, Sparkles, AlertTriangle, FileCode, Hammer, XCircle, Rocket, Bug } from 'lucide-react';

export const ReviewPanel: React.FC = () => {
  const { reviewResult, fileTree, buildResult } = usePipelineStore();

  const allSecurityIssues = fileTree.flatMap((f) =>
    (f.securityIssues || []).map((issue) => ({ ...issue, filePath: f.path }))
  );

  if (!reviewResult) {
    return (
      <div className="h-full bg-slate-900 border-l border-slate-800 p-4 text-slate-400 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-10 h-10 text-slate-700 mb-2" />
        <p className="text-xs font-medium text-slate-400">Code Review Audit Pending</p>
        <p className="text-[11px] text-slate-600 mt-1 max-w-xs">
          Run the multi-agent pipeline to generate code, run automated security analysis, and receive a quality review.
        </p>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 bg-emerald-500';
    if (score >= 75) return 'text-blue-400 bg-blue-500';
    if (score >= 60) return 'text-amber-400 bg-amber-500';
    return 'text-rose-400 bg-rose-500';
  };

  return (
    <div className="h-full bg-slate-900 border-l border-slate-800 p-4 text-slate-200 overflow-y-auto space-y-4 text-xs">
      {/* Header Grade Card */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-md">
        <div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Code Review Grade
          </div>
          <div className="text-2xl font-black text-slate-100 flex items-center gap-2 mt-1">
            <span>Score: {reviewResult.overallScore}/100</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {reviewResult.passed ? 'Passed Automated Review Gates' : 'Review Gates Flagged Issues'}
          </p>
        </div>

        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg border ${
          reviewResult.overallScore >= 90
            ? 'bg-emerald-950 text-emerald-400 border-emerald-700 shadow-emerald-950/50'
            : reviewResult.overallScore >= 75
            ? 'bg-blue-950 text-blue-400 border-blue-700 shadow-blue-950/50'
            : 'bg-amber-950 text-amber-400 border-amber-700 shadow-amber-950/50'
        }`}>
          {reviewResult.overallGrade}
        </div>
      </div>

      {/* 4 Score Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Quality
            </span>
            <span className="font-mono font-bold">{reviewResult.qualityScore}%</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${getScoreColor(reviewResult.qualityScore).split(' ')[1]}`}
              style={{ width: `${reviewResult.qualityScore}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> Security
            </span>
            <span className="font-mono font-bold">{reviewResult.securityScore}%</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${getScoreColor(reviewResult.securityScore).split(' ')[1]}`}
              style={{ width: `${reviewResult.securityScore}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Performance
            </span>
            <span className="font-mono font-bold">{reviewResult.perfScore}%</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${getScoreColor(reviewResult.perfScore).split(' ')[1]}`}
              style={{ width: `${reviewResult.perfScore}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-lg">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-cyan-400" /> Maintainability
            </span>
            <span className="font-mono font-bold">{reviewResult.maintainabilityScore}%</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${getScoreColor(reviewResult.maintainabilityScore).split(' ')[1]}`}
              style={{ width: `${reviewResult.maintainabilityScore}%` }}
            />
          </div>
        </div>
      </div>

      {/* Build Gate Section (deterministic syntax check) */}
      {reviewResult.buildStatus && (
        <div className={`bg-slate-950 border rounded-xl p-3 space-y-2 ${
          reviewResult.buildStatus.ok ? 'border-emerald-800' : 'border-rose-800'
        }`}>
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className={`font-bold text-slate-200 flex items-center gap-1.5 ${
              reviewResult.buildStatus.ok ? 'text-emerald-300' : 'text-rose-300'
            }`}>
              <Hammer className="w-4 h-4" /> Build Gate
            </span>
            {reviewResult.buildStatus.ok ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                PASS
              </span>
            ) : (
              <span className="bg-rose-950 text-rose-400 border border-rose-800 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                FAIL
              </span>
            )}
          </div>

          {reviewResult.buildStatus.ok ? (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 py-1">
              <CheckCircle2 className="w-4 h-4" />
              {reviewResult.buildStatus.checked > 0
                ? `${reviewResult.buildStatus.checked} source file(s) parse cleanly (deterministic syntax check).`
                : 'Syntax check unavailable (no parseable source files).'}
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              <div className="text-[11px] text-rose-300 flex items-center gap-1.5 py-1">
                <XCircle className="w-4 h-4 shrink-0" />
                Generated code failed the syntax check — scores were capped.
              </div>
              {reviewResult.buildStatus.errors.slice(0, 5).map((err, idx) => (
                <div key={idx} className="p-2 bg-slate-900 border border-rose-900/60 rounded text-[10px] font-mono text-rose-200/90 leading-relaxed">
                  {err}
                </div>
              ))}
              {reviewResult.buildStatus.errors.length > 5 && (
                <div className="text-[10px] text-slate-500">… and {reviewResult.buildStatus.errors.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Build & Test Section (real install + build in sandbox) */}
      {buildResult && (
        <div className={`bg-slate-950 border rounded-xl p-3 space-y-2 ${
          buildResult.status === 'passed'
            ? 'border-emerald-800'
            : buildResult.status === 'failed'
            ? 'border-rose-800'
            : 'border-slate-700'
        }`}>
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className={`font-bold text-slate-200 flex items-center gap-1.5 ${
              buildResult.status === 'passed' ? 'text-emerald-300'
              : buildResult.status === 'failed' ? 'text-rose-300'
              : 'text-slate-400'
            }`}>
              <Rocket className="w-4 h-4" /> Build & Test
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              buildResult.status === 'passed'
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                : buildResult.status === 'failed'
                ? 'bg-rose-950 text-rose-400 border-rose-800'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              {buildResult.status.toUpperCase()}
            </span>
          </div>

          {buildResult.status === 'passed' ? (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 py-1">
              <CheckCircle2 className="w-4 h-4" />
              {buildResult.phase === 'build'
                ? `Dependencies installed and \`build\` succeeded in ${(buildResult.durationMs / 1000).toFixed(1)}s (isolated sandbox).`
                : buildResult.phase === 'test'
                ? `Dependencies installed and \`test\` succeeded in ${(buildResult.durationMs / 1000).toFixed(1)}s (isolated sandbox).`
                : `Dependencies installed cleanly in ${(buildResult.durationMs / 1000).toFixed(1)}s (isolated sandbox).`}
            </div>
          ) : buildResult.status === 'skipped' ? (
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 py-1">
              <FileCode className="w-4 h-4 shrink-0" />
              {buildResult.stdout}
            </div>
          ) : (
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              <div className="text-[11px] text-rose-300 flex items-center gap-1.5 py-1">
                <Bug className="w-4 h-4 shrink-0" />
                Real build failed at <span className="font-mono font-bold">{buildResult.phase}</span>
                {buildResult.exitCode !== null && <> (exit {buildResult.exitCode})</>}
                {' '}— scores were capped.
              </div>
              {buildResult.failingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {buildResult.failingFiles.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 bg-rose-950/60 border border-rose-800/70 rounded font-mono text-[9px] text-rose-300">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {buildResult.errors.slice(0, 5).map((err, idx) => (
                <div key={idx} className="p-2 bg-slate-900 border border-rose-900/60 rounded text-[10px] font-mono text-rose-200/90 leading-relaxed break-all">
                  {err}
                </div>
              ))}
              {buildResult.errors.length > 5 && (
                <div className="text-[10px] text-slate-500">… and {buildResult.errors.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Security Issues Section */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="font-bold text-slate-200 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Automated Security Analysis
          </span>
          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">
            {allSecurityIssues.length} Findings
          </span>
        </div>

        {allSecurityIssues.length === 0 ? (
          <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 py-1">
            <CheckCircle2 className="w-4 h-4" />
            No security findings detected by automated analysis.
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {allSecurityIssues.map((issue, idx) => (
              <div key={idx} className="p-2 bg-slate-900 border border-slate-800 rounded text-[11px] space-y-1">
                <div className="flex items-center justify-between font-mono font-semibold text-rose-300">
                  <span className="truncate">{issue.filePath}</span>
                  <span className="uppercase text-[9px] px-1 bg-rose-950 border border-rose-800 rounded">
                    {issue.severity}
                  </span>
                </div>
                <div className="text-slate-300">{issue.message}</div>
                <div className="text-slate-400 italic text-[10px]">{issue.recommendation}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviewer Actionable Suggestions */}
      {reviewResult.suggestions && reviewResult.suggestions.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
          <div className="font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-2">
            <Sparkles className="w-4 h-4 text-amber-400" /> Actionable Recommendations
          </div>
          <ul className="space-y-1.5 list-disc pl-4 text-slate-300">
            {reviewResult.suggestions.map((suggestion, idx) => (
              <li key={idx} className="text-[11px] leading-relaxed">
                {suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
