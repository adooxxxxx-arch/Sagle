import { SYNC_ID_PATTERN, type SyncEnvelope } from '../../shared/api.ts';
import { base64url, open, randomBytes, seal } from './crypto.ts';
import { useBrowser } from '../store/browser.ts';
import { useLibrary } from '../store/library.ts';
import { useSettings } from '../store/settings.ts';
import type { Bookmark, Collection, Highlight, Note, ReadingItem, SavedSession, Settings, SitePermissions, ProxyEntry, Workspace, HistoryItem } from './types.ts';

// End-to-end encrypted sync. The browser encrypts a snapshot with a key derived from the user's
// passphrase (PBKDF2 → AES-256-GCM) and stores only ciphertext on Aether's server under a random
// 128-bit sync id. The server never sees the passphrase or plaintext.

export interface Snapshot {
  v: 1;
  exportedAt: string;
  settings: Omit<Settings, 'sync'>;
  sitePermissions: Record<string, Partial<SitePermissions>>;
  proxies: ProxyEntry[];
  workspaces: Workspace[];
  sessions: SavedSession[];
  bookmarks: Bookmark[];
  reading: ReadingItem[];
  notes: Note[];
  collections: Collection[];
  highlights: Highlight[];
  history?: HistoryItem[];
}

export function createSyncId(): string {
  return base64url(randomBytes(16));
}

export function isValidSyncId(id: string): boolean {
  return SYNC_ID_PATTERN.test(id);
}

export function snapshot(opts: { includeHistory?: boolean } = {}): Snapshot {
  const b = useBrowser.getState();
  const l = useLibrary.getState();
  const s = useSettings.getState();
  const persistent = b.workspaces.filter((w) => !w.ephemeral);
  const ids = new Set(persistent.map((w) => w.id));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sync: _sync, ...settings } = s.settings;
  return {
    v: 1,
    exportedAt: new Date().toISOString(),
    settings,
    sitePermissions: s.sitePermissions,
    proxies: s.proxies,
    workspaces: b.workspaces.map((w) => ({ ...w, activeTabId: null, splitTabId: null })),
    sessions: b.sessions.filter((x) => ids.has(x.workspaceId)),
    bookmarks: l.bookmarks,
    reading: l.reading,
    notes: l.notes,
    collections: l.collections,
    highlights: l.highlights,
    history: opts.includeHistory ? b.history.filter((h) => ids.has(h.workspaceId)) : undefined,
  };
}

function mergeById<T extends { id: string }>(local: T[], remote: T[] = [], stamp: (x: T) => number): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l || stamp(r) > stamp(l)) map.set(r.id, r);
  }
  return [...map.values()].sort((a, b) => stamp(b) - stamp(a));
}

/** Merge a snapshot into local state: newest copy of each item wins; nothing local is deleted. */
export function applySnapshot(snap: Snapshot) {
  if (snap?.v !== 1) throw new Error('Unrecognized data format.');
  const l = useLibrary.getState();
  l.replaceAll({
    bookmarks: mergeById(l.bookmarks, snap.bookmarks, (x) => x.updatedAt ?? x.createdAt),
    reading: mergeById(l.reading, snap.reading, (x) => x.updatedAt ?? x.savedAt),
    notes: mergeById(l.notes, snap.notes, (x) => x.updatedAt),
    collections: mergeById(l.collections, snap.collections, (x) => x.updatedAt),
    highlights: mergeById(l.highlights, snap.highlights, (x) => x.updatedAt ?? x.createdAt),
  });
  const b = useBrowser.getState();
  const known = new Set(b.workspaces.map((w) => w.id));
  b.replaceAll({
    workspaces: [...b.workspaces, ...(snap.workspaces ?? []).filter((w) => !known.has(w.id))],
    sessions: mergeById(b.sessions, snap.sessions, (x) => x.createdAt),
  });
  if (snap.history?.length) {
    const ids = new Set(b.history.map((h) => h.id));
    useBrowser.setState({
      history: [...b.history, ...snap.history.filter((h) => !ids.has(h.id))].sort((x, y) => y.visitedAt - x.visitedAt).slice(0, 5000),
    });
  }
  const s = useSettings.getState();
  s.replaceAll({
    settings: { ...s.settings, ...snap.settings, sync: s.settings.sync, aiPanelOpen: s.settings.aiPanelOpen, sidebarCollapsed: s.settings.sidebarCollapsed },
    sitePermissions: { ...s.sitePermissions, ...snap.sitePermissions },
    proxies: mergeById(s.proxies, snap.proxies, () => 0),
  });
}

export async function pushSync(id: string, passphrase: string): Promise<void> {
  const sealed = await seal(JSON.stringify(snapshot()), passphrase);
  const env: SyncEnvelope = { v: 1, ...sealed, updatedAt: new Date().toISOString() };
  const res = await fetch(`/api/sync/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(env),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(j?.error?.message || `Sync upload failed (${res.status}).`);
  }
}

export async function pullSync(id: string, passphrase: string): Promise<{ updatedAt: string }> {
  const res = await fetch(`/api/sync/${id}`);
  if (res.status === 404) throw new Error('Nothing has been synced with this code yet.');
  if (!res.ok) throw new Error(`Sync download failed (${res.status}).`);
  const env = (await res.json()) as SyncEnvelope;
  let plain: string;
  try {
    plain = await open(env, passphrase);
  } catch {
    throw new Error('Wrong passphrase, or the data was tampered with.');
  }
  applySnapshot(JSON.parse(plain) as Snapshot);
  return { updatedAt: env.updatedAt };
}

export async function deleteSync(id: string): Promise<void> {
  await fetch(`/api/sync/${id}`, { method: 'DELETE' });
}
