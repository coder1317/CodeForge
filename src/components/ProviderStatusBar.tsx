import React, { useEffect } from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { PROVIDER_POOL } from '../lib/providers/pool';
import { Key, Cpu, Zap, Shield, Sparkles, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  onOpenSettings: () => void;
}

export const ProviderStatusBar: React.FC<Props> = ({ onOpenSettings }) => {
  const { providerStatuses, ollamaStatus, fetchProviderStatuses, byokKeys } = usePipelineStore();

  useEffect(() => {
    fetchProviderStatuses();
    const interval = setInterval(fetchProviderStatuses, 10000); // refresh every 10 seconds
    return () => clearInterval(interval);
  }, [fetchProviderStatuses]);

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs overflow-x-auto gap-2">
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-semibold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          Providers Pool:
        </span>

        {Object.values(PROVIDER_POOL).map((provider) => {
          const status = providerStatuses[provider.id] || { currentRPM: 0, hasKey: provider.free || false, isRateLimited: false };
          const hasBYOK = Boolean(byokKeys[provider.id as keyof typeof byokKeys]);

          return (
            <div
              key={provider.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-all ${
                status.isRateLimited
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  : hasBYOK
                  ? 'bg-amber-950/30 border-amber-700/50 text-amber-300'
                  : status.hasKey
                  ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                  : 'bg-slate-900/50 border-slate-800 text-slate-500'
              }`}
              title={`${provider.name}: ${status.currentRPM}/${provider.rateLimitRPM} RPM. ${
                hasBYOK ? 'Using BYOK Key' : provider.free ? 'Zero-Key Free' : status.hasKey ? 'System Key Active' : 'No Key Set'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{
                backgroundColor: status.isRateLimited ? '#f43f5e' : hasBYOK ? '#f59e0b' : status.hasKey ? '#10b981' : '#64748b'
              }} />
              <span className="truncate max-w-[85px]">{provider.name}</span>
              {provider.free && (
                <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[9px] px-1 rounded">
                  Free
                </span>
              )}
              {hasBYOK && (
                <Key className="w-3 h-3 text-amber-400" />
              )}
              <span className="text-[10px] text-slate-400 font-mono pl-0.5">
                {status.currentRPM}m
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Ollama Status */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] ${
            ollamaStatus.available
              ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
              : 'bg-slate-800/40 border-slate-800 text-slate-500'
          }`}
          title={ollamaStatus.available ? `Ollama local running. Models: ${ollamaStatus.models.join(', ')}` : 'Ollama local offline'}
        >
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>Ollama</span>
          {ollamaStatus.available ? (
            <span className="text-[10px] text-emerald-400 font-mono">
              {ollamaStatus.latencyMs ? `${ollamaStatus.latencyMs}ms` : 'Ready'}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">Offline</span>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 rounded-md font-medium text-[11px] transition-colors cursor-pointer"
        >
          <Key className="w-3 h-3" />
          BYOK Keys
        </button>
      </div>
    </div>
  );
};
