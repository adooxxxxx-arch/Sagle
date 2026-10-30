import { useLibrary } from '../store/library.ts';
import { uid } from './util.ts';

/** Trigger a real browser download and record it in Aether's Downloads list. */
export function downloadFile(filename: string, content: string | Blob, mime: string, sourceUrl?: string) {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  useLibrary.getState().addDownload({ id: uid(), filename, mime, size: blob.size, sourceUrl, createdAt: Date.now() });
}
