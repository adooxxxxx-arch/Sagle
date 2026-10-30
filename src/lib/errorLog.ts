// Local-only error log. Aether has no remote telemetry: errors are kept in memory
// (last 50) so the user can inspect them in Settings → About, and nothing else.

export interface LoggedError {
  message: string;
  source?: string;
  at: number;
}

const entries: LoggedError[] = [];
const listeners = new Set<() => void>();

export function logError(message: string, source?: string) {
  entries.unshift({ message: message.slice(0, 500), source, at: Date.now() });
  entries.length = Math.min(entries.length, 50);
  listeners.forEach((l) => l());
}

export function getErrors(): LoggedError[] {
  return entries;
}

export function subscribeErrors(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function installErrorLog() {
  window.addEventListener('error', (e) => logError(e.message || 'Unknown error', 'window'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    logError(r instanceof Error ? r.message : String(r), 'promise');
  });
}
