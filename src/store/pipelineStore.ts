import { create } from 'zustand';
import { PipelineState, initialPipelineState, AgentFile, SecurityIssue, CodeReviewResult, LogMessage, BuildResult } from '../agents/state';
import { BYOKMap, loadBYOK, saveBYOK } from '../lib/byok';

export interface ProjectHistoryItem {
  id: string;
  timestamp: string;
  prompt: string;
  stack: PipelineState['stack'];
  generatedFiles: Record<string, string>;
  fileTree: AgentFile[];
  reviewResult?: CodeReviewResult;
  buildResult?: BuildResult;
}

// ---- Bounded localStorage persistence for history ----
// Generated projects can be large, so we cap the number of stored items and
// try/catch quota failures (storage full -> drop persistence gracefully).
const HISTORY_STORAGE_KEY = 'codeforge_v2_history';
const HISTORY_MAX_ITEMS = 3;

function loadHistory(): ProjectHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function persistHistory(history: ProjectHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_MAX_ITEMS)));
  } catch {
    // Quota exceeded (large projects) — history stays in-memory only.
  }
}

interface PipelineStore extends PipelineState {
  selectedFilePath: string | null;
  byokKeys: BYOKMap;
  history: ProjectHistoryItem[];
  activeTab: 'editor' | 'review' | 'logs' | 'history';
  providerStatuses: Record<string, { currentRPM: number; hasKey: boolean; isRateLimited: boolean }>;
  ollamaStatus: { available: boolean; models: string[]; latencyMs?: number };

  setPrompt: (prompt: string) => void;
  setSelectedFile: (path: string | null) => void;
  setByokKey: (providerId: keyof BYOKMap, key: string) => void;
  setActiveTab: (tab: 'editor' | 'review' | 'logs' | 'history') => void;
  resetPipeline: () => void;
  startGeneration: () => Promise<void>;
  fetchProviderStatuses: () => Promise<void>;
  loadHistoryItem: (item: ProjectHistoryItem) => void;
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  ...initialPipelineState,
  selectedFilePath: null,
  byokKeys: loadBYOK(),
  history: loadHistory(),
  activeTab: 'editor',
  providerStatuses: {},
  ollamaStatus: { available: false, models: [] },

  setPrompt: (prompt) => set({ prompt }),

  setSelectedFile: (selectedFilePath) => set({ selectedFilePath }),

  setByokKey: (providerId, key) => {
    const updated = { ...get().byokKeys, [providerId]: key };
    saveBYOK(updated);
    set({ byokKeys: updated });
  },

  setActiveTab: (activeTab) => set({ activeTab }),

  resetPipeline: () => set({ ...initialPipelineState, prompt: get().prompt }),

  fetchProviderStatuses: async () => {
    try {
      const res = await fetch('/api/providers/status');
      if (res.ok) {
        const data = await res.json();
        const statusesMap: Record<string, { currentRPM: number; hasKey: boolean; isRateLimited: boolean }> = {};
        if (Array.isArray(data.providers)) {
          data.providers.forEach((p: { id: string; currentRPM: number; hasKey: boolean; isRateLimited: boolean }) => {
            statusesMap[p.id] = {
              currentRPM: p.currentRPM,
              hasKey: p.hasKey,
              isRateLimited: p.isRateLimited
            };
          });
        }
        set({
          providerStatuses: statusesMap,
          ollamaStatus: data.ollama || { available: false, models: [] }
        });
      }
    } catch (err) {
      console.warn('Failed to fetch provider status:', err);
    }
  },

  startGeneration: async () => {
    const { prompt, byokKeys, fetchProviderStatuses } = get();
    if (!prompt.trim()) return;

    set({
      pipelineStatus: 'architecting',
      activeAgent: 'Architect',
      logs: [
        {
          id: 'log_start',
          timestamp: new Date().toLocaleTimeString(),
          agent: 'Orchestrator',
          provider: 'CodeForge Engine',
          message: `Starting generation pipeline for: "${prompt.slice(0, 70)}..."`,
          type: 'info'
        }
      ],
      generatedFiles: {},
      fileTree: [],
      selectedFilePath: null,
      reviewResult: undefined,
      currentFileIndex: 0
    });

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, byokKeys })
      });

      if (!response.ok || !response.body) {
        throw new Error(`Generation failed with HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          const eventMatch = line.match(/^event:\s*(.+)$/m);
          const dataMatch = line.match(/^data:\s*(.+)$/m);

          const event = eventMatch ? eventMatch[1].trim() : 'message';
          const data = dataMatch ? JSON.parse(dataMatch[1]) : {};

          if (event === 'log') {
            set((state) => ({ logs: [...state.logs, data as LogMessage] }));
          } else if (event === 'state_update') {
            const updated = data as Partial<PipelineState>;
            set((state) => {
              const newState = { ...state, ...updated };
              // Auto-select first file when available
              if (!newState.selectedFilePath && newState.fileTree.length > 0) {
                newState.selectedFilePath = newState.fileTree[0].path;
              }
              return newState;
            });
          } else if (event === 'done') {
            const finalState = data as PipelineState;
            const historyItem: ProjectHistoryItem = {
              id: 'proj_' + Date.now(),
              timestamp: new Date().toLocaleString(),
              prompt: finalState.prompt,
              stack: finalState.stack,
              generatedFiles: finalState.generatedFiles,
              fileTree: finalState.fileTree,
              reviewResult: finalState.reviewResult,
              buildResult: finalState.buildResult
            };

            const newHistory = [historyItem, ...get().history].slice(0, HISTORY_MAX_ITEMS);
            persistHistory(newHistory);
            set((state) => ({
              ...finalState,
              pipelineStatus: 'completed',
              activeAgent: null,
              history: newHistory
            }));
            fetchProviderStatuses();
          }
        }
      }
    } catch (err: unknown) {
      console.error('SSE Stream error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      set((state) => ({
        pipelineStatus: 'failed',
        activeAgent: null,
        logs: [
          ...state.logs,
          {
            id: 'log_err_' + Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            agent: 'Orchestrator',
            provider: 'Error Handler',
            message: `Pipeline encountered an error: ${errMsg}`,
            type: 'error'
          }
        ]
      }));
    }
  },

  loadHistoryItem: (item) => {
    set({
      prompt: item.prompt,
      stack: item.stack,
      generatedFiles: item.generatedFiles,
      fileTree: item.fileTree,
      reviewResult: item.reviewResult,
      buildResult: item.buildResult,
      selectedFilePath: item.fileTree.length > 0 ? item.fileTree[0].path : null,
      pipelineStatus: 'completed',
      activeAgent: null
    });
  }
}));
