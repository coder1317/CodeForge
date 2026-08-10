import React, { useState } from 'react';
import { usePipelineStore } from './store/pipelineStore';
import { ProviderStatusBar } from './components/ProviderStatusBar';
import { AgentGraph } from './components/AgentGraph';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { PromptBar } from './components/PromptBar';
import { ReviewPanel } from './components/ReviewPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { SettingsModal } from './components/SettingsModal';
import {
  Code2,
  CheckCircle2,
  History,
  Key,
  Download,
  FolderTree,
  Cpu,
  Menu,
  X
} from 'lucide-react';
import { exportProjectAsZip, downloadBlob } from './lib/exportProject';

export default function App() {
  const {
    activeTab,
    setActiveTab,
    generatedFiles,
    fileTree,
    prompt,
    stack,
    reviewResult
  } = usePipelineStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mobileIdeView, setMobileIdeView] = useState<'files' | 'editor' | 'agents'>('editor');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleDownloadZip = async () => {
    if (Object.keys(generatedFiles).length === 0) return;
    const blob = await exportProjectAsZip({ generatedFiles, prompt, stack, fileTree, reviewResult });
    downloadBlob(blob, `codeforge-${Date.now()}.zip`);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* Top Application Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-3 sm:px-4 py-2 flex items-center justify-between shrink-0 gap-2">
        {/* Brand Logo & Title */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Code2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-black tracking-tight text-white flex items-center gap-1.5">
              CodeForge <span className="text-[10px] sm:text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-800/80 px-1.5 py-0.2 rounded">V2</span>
            </h1>
            <p className="text-[10px] text-slate-400 hidden lg:block">AI-Native Multi-Agent SDE</p>
          </div>
        </div>

        {/* Workspace Navigation Tabs - Desktop & Tablet */}
        <div className="hidden md:flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('editor')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>IDE Workspace</span>
          </button>

          <button
            onClick={() => setActiveTab('review')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeTab === 'review'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Code Review Audit</span>
            {reviewResult && (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] px-1 rounded font-mono font-bold">
                {reviewResult.overallGrade}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
          </button>
        </div>

        {/* Action Header Controls */}
        <div className="hidden sm:flex items-center gap-2">
          {Object.keys(generatedFiles).length > 0 && (
            <button
              onClick={handleDownloadZip}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Export ZIP</span>
            </button>
          )}

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>BYOK Keys</span>
          </button>
        </div>

        {/* Mobile Header Menu Trigger */}
        <div className="flex sm:hidden items-center gap-1.5">
          {Object.keys(generatedFiles).length > 0 && (
            <button
              onClick={handleDownloadZip}
              className="p-1.5 bg-indigo-600 text-white rounded-lg cursor-pointer"
              title="Export ZIP"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Dropdown Navigation Menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden bg-slate-900 border-b border-slate-800 p-3 flex flex-col gap-2 z-40 shrink-0">
          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-medium">
            <button
              onClick={() => { setActiveTab('editor'); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
                activeTab === 'editor' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>IDE</span>
            </button>

            <button
              onClick={() => { setActiveTab('review'); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
                activeTab === 'review' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Audit</span>
            </button>

            <button
              onClick={() => { setActiveTab('history'); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all ${
                activeTab === 'history' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History</span>
            </button>
          </div>

          <button
            onClick={() => { setIsSettingsOpen(true); setMobileMenuOpen(false); }}
            className="flex items-center justify-center gap-2 py-2 bg-slate-800 text-slate-200 border border-slate-700 font-medium text-xs rounded-lg"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            Configure BYOK Provider Keys
          </button>
        </div>
      )}

      {/* Live Provider Pool & Rate-Limit Status Bar */}
      <ProviderStatusBar onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* Main Content Workspace Layout */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'history' ? (
          <HistoryPanel />
        ) : activeTab === 'review' ? (
          <ReviewPanel />
        ) : (
          <div className="h-full flex flex-col lg:grid lg:grid-cols-12 overflow-hidden">
            {/* Mobile / Tablet View Switcher bar (shown under lg screen size) */}
            <div className="lg:hidden bg-slate-900 border-b border-slate-800 p-1.5 flex items-center justify-around shrink-0 text-xs font-medium">
              <button
                onClick={() => setMobileIdeView('files')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                  mobileIdeView === 'files'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Files ({fileTree.length})</span>
              </button>

              <button
                onClick={() => setMobileIdeView('editor')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                  mobileIdeView === 'editor'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Editor & Prompt</span>
              </button>

              <button
                onClick={() => setMobileIdeView('agents')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                  mobileIdeView === 'agents'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Agents & Audit</span>
              </button>
            </div>

            {/* Left Column: File Tree (3 cols on desktop) */}
            <div
              className={`lg:col-span-3 h-full overflow-hidden border-r border-slate-800 ${
                mobileIdeView === 'files' ? 'block flex-1' : 'hidden lg:block'
              }`}
            >
              <FileTree />
            </div>

            {/* Center Column: Monaco Code Editor + Prompt Bar (6 cols on desktop) */}
            <div
              className={`lg:col-span-6 h-full flex flex-col overflow-hidden ${
                mobileIdeView === 'editor' ? 'flex flex-1' : 'hidden lg:flex'
              }`}
            >
              <div className="flex-1 overflow-hidden">
                <CodeEditor />
              </div>
              <PromptBar />
            </div>

            {/* Right Column: Agent Graph & Code Review (3 cols on desktop) */}
            <div
              className={`lg:col-span-3 h-full flex flex-col overflow-hidden bg-slate-900 border-l border-slate-800 p-2 gap-2 ${
                mobileIdeView === 'agents' ? 'flex flex-1 overflow-y-auto' : 'hidden lg:flex'
              }`}
            >
              <div className="shrink-0">
                <AgentGraph />
              </div>
              <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 min-h-[220px]">
                <ReviewPanel />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings / BYOK Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

