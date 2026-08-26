import React, { useState } from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { Send, Sparkles, Terminal, ChevronUp, ChevronDown, Square } from 'lucide-react';

export const PromptBar: React.FC = () => {
  const { prompt, setPrompt, startGeneration, cancelGeneration, pipelineStatus, logs } = usePipelineStore();
  const [showLogs, setShowLogs] = useState(false);

  const isRunning = pipelineStatus !== 'idle' && pipelineStatus !== 'completed' && pipelineStatus !== 'failed';

  const PRESET_PROMPTS = [
    'Build a REST API with Express and JWT auth',
    'Create a Task Management Kanban app with React and Tailwind',
    'Build a secure Node.js microservice with SAST security rules'
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isRunning) return;
    startGeneration();
  };

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-3 flex flex-col gap-2">
      {/* Streaming Log Drawer Toggle */}
      {logs.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full px-3 py-1.5 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 bg-slate-900/80 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-mono text-[11px]">
                {isRunning ? 'Agent Execution Streaming Logs...' : `Logs (${logs.length} entries)`}
              </span>
            </div>
            {showLogs ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {showLogs && (
            <div className="max-h-36 overflow-y-auto p-2.5 font-mono text-[11px] space-y-1 bg-slate-950 text-slate-300">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 border-b border-slate-900 pb-1">
                  <span className="text-slate-500 text-[10px] shrink-0">{log.timestamp}</span>
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                    log.agent === 'Architect' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                    log.agent === 'Coder' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                    log.agent === 'Security Scan' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                    log.agent === 'Code Review' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {log.agent}
                  </span>
                  <span className="text-slate-400 text-[10px] shrink-0">[{log.provider}]</span>
                  <span className={`flex-1 ${
                    log.type === 'error' ? 'text-rose-400' : log.type === 'warn' ? 'text-amber-300' : 'text-slate-200'
                  }`}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preset prompt pills */}
      <div className="flex items-center gap-2 overflow-x-auto text-xs py-0.5">
        <span className="text-slate-500 text-[11px] flex items-center gap-1 shrink-0">
          <Sparkles className="w-3 h-3 text-amber-400" />
          Presets:
        </span>
        {PRESET_PROMPTS.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setPrompt(preset)}
            className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer border border-slate-700/60"
          >
            {preset}
          </button>
        ))}
      </div>

      {/* Main Prompt Form */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe software to build (e.g. 'Build a REST API with Express and JWT auth')..."
            disabled={isRunning}
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none transition-all disabled:opacity-50"
          />
        </div>

        {isRunning ? (
          <button
            type="button"
            onClick={cancelGeneration}
            title="Stop the agent pipeline (partial results are kept)"
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-semibold text-xs rounded-lg transition-all shadow-md shadow-rose-600/20 cursor-pointer shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!prompt.trim()}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-all shadow-md shadow-indigo-600/20 cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>Run <span className="hidden sm:inline">Agent Pipeline</span><span className="sm:hidden">Pipeline</span></span>
          </button>
        )}
      </form>
    </div>
  );
};
