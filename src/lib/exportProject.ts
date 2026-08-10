import JSZip from 'jszip';
import { AgentFile, CodeReviewResult, TechStack } from '../agents/state';

export interface ZipExportParams {
  generatedFiles: Record<string, string>;
  prompt: string;
  stack: TechStack;
  fileTree: AgentFile[];
  reviewResult?: CodeReviewResult;
  fileName?: string;
}

/**
 * Package generated files + metadata into a downloadable ZIP blob.
 * Single source of truth for export (used by App.tsx and FileTree.tsx).
 */
export async function exportProjectAsZip({
  generatedFiles,
  prompt,
  stack,
  fileTree,
  reviewResult,
  fileName
}: ZipExportParams): Promise<Blob> {
  const zip = new JSZip();

  Object.entries(generatedFiles).forEach(([filePath, code]) => {
    zip.file(filePath, code);
  });

  const metadata = {
    generator: 'CodeForge V2 Multi-Agent Engine',
    generatedAt: new Date().toISOString(),
    prompt,
    stack,
    fileTree,
    reviewResult
  };
  zip.file('codeforge.json', JSON.stringify(metadata, null, 2));

  return zip.generateAsync({ type: 'blob' });
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
