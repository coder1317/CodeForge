import React from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { Network, Code2, ShieldAlert, CheckCircle2, Clock, Cpu, RefreshCw, AlertCircle, Hammer, Bug } from 'lucide-react';

export const AgentGraph: React.FC = () => {
  const {
    pipelineStatus,
    activeAgent,
    activeProvider,
    activeModel,
    fileTree,
    currentFileIndex,
    reviewResult,
    iterationCount,
    maxIterations,
    buildAttempts,
    maxBuildAttempts
  } = usePipelineStore();

  const agents = [
    {
      id: 'Architect',
      name: 'Architect',
      role: 'Stack & Tree Design',
      icon: Network,
      color: 'from-blue-500 to-indigo-600',
      textColor: 'text-blue-400',
      bgColor: 'bg-blue-500/10 border-blue-500/30'
    },
    {
      id: 'Coder',
      name: 'Coder',
      role: 'Code Synthesis',
      icon: Code2,
      color: 'from-amber-500 to-orange-600',
      textColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10 border-amber-500/30'
    },
    {
      id: 'Security Scan',
      name: 'Security Scan',
      role: 'Automated Security Analysis',
      icon: ShieldAlert,
      color: 'from-rose-500 to-pink-600',
      textColor: 'text-rose-400',
      bgColor: 'bg-rose-500/10 border-rose-500/30'
    },
    {
      id: 'Code Review',
      name: 'Code Review',
      role: 'Quality & Scoring',
      icon: CheckCircle2,
      color: 'from-emerald-500 to-teal-600',
      textColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/30'
    },
    {
      id: 'Build/Test',
      name: 'Build/Test',
      role: 'Sandboxed Install & Build',
      icon: Hammer,
      color: 'from-cyan-500 to-sky-600',
      textColor: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10 border-cyan-500/30'
    },
    {
      id: 'Debugger',
      name: 'Debugger',
      role: 'Failure Diagnosis & Repair',
      icon: Bug,
      color: 'from-violet-500 to-purple-600',
      textColor: 'text-violet-400',
      bgColor: 'bg-violet-500/10 border-violet-500/30'
    }
  ];

  const getAgentState = (agentId: string) => {
    if (pipelineStatus === 'idle') return 'idle';
    if (pipelineStatus === 'failed') return 'error';
    if (pipelineStatus === 'completed') return 'completed';

    if (activeAgent === agentId) return 'running';

    const order = ['Architect', 'Coder', 'Security Scan', 'Code Review', 'Build/Test', 'Debugger'];
    const activeIdx = order.indexOf(activeAgent || '');
    const currentIdx = order.indexOf(agentId);

    if (currentIdx < activeIdx) return 'completed';
    return 'pending';
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            CodeForge Multi-Agent Orchestrator
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            pipelineStatus === 'completed'
              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
              : pipelineStatus === 'idle'
              ? 'bg-slate-800 text-slate-400 border-slate-700'
              : pipelineStatus === 'failed'
              ? 'bg-rose-950/60 text-rose-400 border-rose-800'
              : 'bg-indigo-950/60 text-indigo-400 border-indigo-800 animate-pulse'
          }`}>
            Status: {pipelineStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Agents Nodes Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 relative">
        {agents.map((agent, index) => {
          const state = getAgentState(agent.id);
          const Icon = agent.icon;
          const isRunning = state === 'running';
          const isCompleted = state === 'completed';
          const isError = state === 'error';

          return (
            <div
              key={agent.id}
              className={`p-3 rounded-lg border transition-all duration-300 relative flex flex-col justify-between ${
                isRunning
                  ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/40'
                  : isCompleted
                  ? 'bg-slate-900/80 border-slate-700/80 text-slate-300'
                  : isError
                  ? 'bg-rose-950/20 border-rose-800/50 text-rose-300'
                  : 'bg-slate-900/40 border-slate-800/60 opacity-60 text-slate-500'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-md ${agent.bgColor}`}>
                  <Icon className={`w-4 h-4 ${agent.textColor}`} />
                </div>
                <div>
                  {isRunning && (
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  )}
                  {isCompleted && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {isError && (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  {state === 'idle' || state === 'pending' ? (
                    <Clock className="w-3.5 h-3.5 text-slate-600" />
                  ) : null}
                </div>
              </div>

              <div className="mt-2.5">
                <div className="text-xs font-bold text-slate-200">{agent.name}</div>
                <div className="text-[10px] text-slate-400">{agent.role}</div>
              </div>

              {isRunning && (
                <div className="mt-2 pt-2 border-t border-slate-700/60 text-[10px]">
                  <div className="text-indigo-300 font-medium truncate">
                    {activeProvider || 'Selecting Provider...'}
                  </div>
                  {activeModel && (
                    <div className="text-slate-400 font-mono text-[9px] truncate">{activeModel}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pipeline Progress details */}
      {fileTree.length > 0 && (
        <div className="mt-3 pt-2 border-t border-slate-800/80 flex flex-col gap-1.5 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Files Processed:</span>
              <span className="font-mono text-slate-200 font-semibold">
                {Math.min(currentFileIndex + 1, fileTree.length)} / {fileTree.length}
              </span>
            </div>
            {reviewResult && (
              <div className="flex items-center gap-2">
                <span>Overall Review Grade:</span>
                <span className={`px-2 py-0.5 rounded font-bold font-mono text-xs ${
                  reviewResult.overallScore >= 90 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                  reviewResult.overallScore >= 75 ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                  'bg-amber-950 text-amber-400 border border-amber-800'
                }`}>
                  {reviewResult.overallGrade} ({reviewResult.overallScore}/100)
                </span>
              </div>
            )}
          </div>
          {(iterationCount > 0 || buildAttempts > 0) && (
            <div className="flex items-center gap-3 text-[10px]">
              {iterationCount > 0 && maxIterations > 0 && (
                <span className={`px-1.5 py-0.5 rounded border font-medium ${
                  pipelineStatus === 'coding' || pipelineStatus === 'securing'
                    ? 'bg-amber-950/60 text-amber-400 border-amber-800 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  Fix loop: round {iterationCount}/{maxIterations}
                </span>
              )}
              {buildAttempts > 0 && maxBuildAttempts > 0 && (
                <span className={`px-1.5 py-0.5 rounded border font-medium ${
                  pipelineStatus === 'debugging' || (pipelineStatus === 'building' && buildAttempts > 1)
                    ? 'bg-violet-950/60 text-violet-300 border-violet-800 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  Repair rounds: {buildAttempts}/{Math.max(maxBuildAttempts - 1, 0)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
