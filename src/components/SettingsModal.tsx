import React, { useState } from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { Key, Shield, X, Save, Trash2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { PROVIDER_POOL } from '../lib/providers/pool';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { byokKeys, setByokKey } = usePipelineStore();
  const [localKeys, setLocalKeys] = useState(byokKeys);
  const [savedMessage, setSavedMessage] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    Object.entries(localKeys).forEach(([providerId, key]) => {
      setByokKey(providerId as keyof typeof byokKeys, typeof key === 'string' ? key : '');
    });
    setSavedMessage(true);
    setTimeout(() => {
      setSavedMessage(false);
      onClose();
    }, 1200);
  };

  const handleClear = () => {
    setLocalKeys({});
    Object.keys(byokKeys).forEach((k) => {
      setByokKey(k as keyof typeof byokKeys, '');
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
            <Key className="w-4 h-4 text-amber-400" />
            Bring Your Own Keys (BYOK) & Provider Settings
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-indigo-950/40 border-b border-indigo-800/60 p-3 text-xs text-indigo-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            BYOK keys are stored strictly in your browser&apos;s <span className="font-mono text-indigo-300 font-semibold">localStorage</span>.
            They take precedence over default free providers. If no keys are provided, CodeForge V2 runs automatically using zero-key cloud inference and Ollama offline fallbacks.
          </div>
        </div>

        {/* Modal Body / Provider Key Inputs */}
        <div className="p-4 overflow-y-auto space-y-3.5 flex-1 text-xs">
          {Object.values(PROVIDER_POOL)
            .filter((p) => p.requiresKey)
            .map((provider) => (
              <div key={provider.id} className="space-y-1 bg-slate-950/60 border border-slate-800/80 p-3 rounded-xl">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-2">
                    {provider.name} Key
                    <span className="text-[10px] text-slate-400 font-mono font-normal">
                      ({provider.envVarName})
                    </span>
                  </label>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                    {provider.badge}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{provider.description}</p>
                <input
                  type="password"
                  value={localKeys[provider.id as keyof typeof localKeys] || ''}
                  onChange={(e) =>
                    setLocalKeys({ ...localKeys, [provider.id]: e.target.value })
                  }
                  placeholder={`Enter your ${provider.name} API key...`}
                  className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 outline-none font-mono"
                />
              </div>
            ))}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium text-xs transition-colors cursor-pointer border border-slate-700"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            Clear Keys
          </button>

          <div className="flex items-center gap-2">
            {savedMessage && (
              <span className="text-emerald-400 text-xs flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Keys Saved!
              </span>
            )}
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
            >
              <Save className="w-3.5 h-3.5" />
              Save BYOK Keys
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
