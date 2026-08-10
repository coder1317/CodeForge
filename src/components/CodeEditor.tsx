import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { usePipelineStore } from '../store/pipelineStore';
import { FileCode, Copy, Check, ShieldAlert, Sparkles } from 'lucide-react';

export const CodeEditor: React.FC = () => {
  const { selectedFilePath, generatedFiles, fileTree } = usePipelineStore();
  const [copied, setCopied] = useState(false);

  const selectedFile = fileTree.find(f => f.path === selectedFilePath);
  const code = selectedFilePath ? generatedFiles[selectedFilePath] : null;

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLanguage = (path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.md')) return 'markdown';
    return 'plaintext';
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Editor Header Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-mono text-indigo-300">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <span>{selectedFilePath || 'Select a file to inspect'}</span>
        </div>

        {code && (
          <div className="flex items-center gap-3">
            {selectedFile?.securityIssues && selectedFile.securityIssues.length > 0 && (
              <span className="flex items-center gap-1 text-rose-400 bg-rose-950/60 border border-rose-800 px-2 py-0.5 rounded text-[11px] font-mono">
                <ShieldAlert className="w-3.5 h-3.5" />
                {selectedFile.securityIssues.length} SAST Flag(s)
              </span>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-xs border border-slate-700 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
          </div>
        )}
      </div>

      {/* Security Issues Warning Banner */}
      {selectedFile?.securityIssues && selectedFile.securityIssues.length > 0 && (
        <div className="bg-rose-950/40 border-b border-rose-800/80 px-4 py-2 text-xs text-rose-300 flex flex-col gap-1">
          <div className="font-bold flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            Security Scan Findings for {selectedFilePath}:
          </div>
          {selectedFile.securityIssues.map((issue, idx) => (
            <div key={idx} className="pl-5 text-[11px] text-rose-200">
              • <span className="font-semibold">{issue.type}</span>: {issue.message} — <span className="text-rose-300 italic">{issue.recommendation}</span>
            </div>
          ))}
        </div>
      )}

      {/* Monaco Editor Container */}
      <div className="flex-1 relative">
        {code !== null && selectedFilePath ? (
          <Editor
            height="100%"
            path={selectedFilePath}
            language={getLanguage(selectedFilePath)}
            theme="vs-dark"
            value={code}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
              lineNumbers: 'on',
              folding: true
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <Sparkles className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm font-medium text-slate-400">No file selected or generated yet</p>
            <p className="text-xs text-slate-600 mt-1 max-w-sm">
              Type a prompt in the prompt bar below to launch the Architect, Coder, Security Scan, and Code Review agent graph.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
