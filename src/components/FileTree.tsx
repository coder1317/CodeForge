import React from 'react';
import { usePipelineStore } from '../store/pipelineStore';
import { FileCode, ShieldAlert, CheckCircle2, Download, FileText, RefreshCw } from 'lucide-react';
import { exportProjectAsZip, downloadBlob } from '../lib/exportProject';

export const FileTree: React.FC = () => {
  const { fileTree, selectedFilePath, setSelectedFile, generatedFiles, prompt, stack, reviewResult } = usePipelineStore();

  const handleDownloadZip = async () => {
    if (Object.keys(generatedFiles).length === 0) return;
    const blob = await exportProjectAsZip({ generatedFiles, prompt, stack, fileTree, reviewResult });
    downloadBlob(blob, `codeforge-${Date.now()}.zip`);
  };

  const getFileIcon = (path: string) => {
    if (path.endsWith('.json') || path.endsWith('.config.js')) return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    if (path.endsWith('.md')) return <FileText className="w-3.5 h-3.5 text-blue-400" />;
    return <FileCode className="w-3.5 h-3.5 text-indigo-400" />;
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 border-r border-slate-800 text-slate-300">
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Explorer ({fileTree.length})
          </h3>
        </div>
        {Object.keys(generatedFiles).length > 0 && (
          <button
            onClick={handleDownloadZip}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors cursor-pointer"
            title="Download ZIP archive with metadata"
          >
            <Download className="w-3 h-3" />
            Export ZIP
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {fileTree.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-xs italic">
            No project files generated yet. Enter a prompt to run the multi-agent pipeline.
          </div>
        ) : (
          fileTree.map((file) => {
            const isSelected = selectedFilePath === file.path;
            const hasCode = Boolean(generatedFiles[file.path]);
            const secIssuesCount = file.securityIssues?.length || 0;

            return (
              <div
                key={file.path}
                onClick={() => setSelectedFile(file.path)}
                className={`p-2 rounded-lg text-xs cursor-pointer flex items-center justify-between border transition-all ${
                  isSelected
                    ? 'bg-indigo-950/60 border-indigo-600/80 text-white font-medium'
                    : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-800/60 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  {getFileIcon(file.path)}
                  <span className="truncate font-mono">{file.path}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Status Indicator */}
                  {file.status === 'generating' && (
                    <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                  )}
                  {file.status === 'securing' && (
                    <ShieldAlert className="w-3 h-3 text-rose-400 animate-pulse" />
                  )}
                  {file.status === 'completed' && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  )}

                  {/* Security issues badge */}
                  {secIssuesCount > 0 && (
                    <span className="bg-rose-950 text-rose-400 border border-rose-800 text-[10px] px-1 rounded font-mono">
                      {secIssuesCount} sec
                    </span>
                  )}

                  {/* Review Score badge */}
                  {file.reviewGrade && (
                    <span className="bg-slate-800 text-emerald-400 border border-slate-700 text-[10px] px-1 rounded font-mono font-bold">
                      {file.reviewGrade}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Tech Stack Summary Footer */}
      {fileTree.length > 0 && stack && (
        <div className="p-3 border-t border-slate-800/80 text-[11px] bg-slate-950/50">
          <div className="text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">
            Tech Stack:
          </div>
          <div className="flex flex-wrap gap-1">
            {stack.frontend && (
              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 font-mono text-[10px]">
                {stack.frontend}
              </span>
            )}
            {stack.backend && (
              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 font-mono text-[10px]">
                {stack.backend}
              </span>
            )}
            {stack.auth && (
              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 font-mono text-[10px]">
                {stack.auth}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
