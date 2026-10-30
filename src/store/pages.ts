import { create } from 'zustand';
import type { ApiError, PageResult, ProxyProfile } from '../../shared/api.ts';
import { fetchPage } from '../lib/api.ts';
import { useSettings } from './settings.ts';
import { useVault } from './vault.ts';

// Runtime-only cache of server page analyses (reader content, embed policy, privacy report).
// Never persisted: page content stays in memory for the lifetime of this browser tab.

export type PageState =
  | { status: 'loading'; startedAt: number }
  | { status: 'ready'; data: PageResult; fetchedAt: number }
  | { status: 'error'; error: ApiError; fetchedAt: number }
  | { status: 'disabled' };

const TTL = 5 * 60_000;
const inflight = new Map<string, { promise: Promise<PageState>; controller: AbortController }>();

interface PagesState {
  byUrl: Record<string, PageState>;
  ensure: (url: string, opts?: { force?: boolean }) => Promise<PageState>;
  cancel: (url: string) => void;
  clear: () => void;
}

export function activeProxy(): ProxyProfile | null {
  const { settings, proxies } = useSettings.getState();
  const entry = proxies.find((p) => p.id === settings.privacy.activeProxyId);
  if (!entry) return null;
  const password = entry.hasPassword ? useVault.getState().get(`proxy:${entry.id}`) : undefined;
  return { type: entry.type, host: entry.host, port: entry.port, username: entry.username || undefined, password };
}

export const usePages = create<PagesState>()((set, get) => ({
  byUrl: {},
  ensure: async (url, opts = {}) => {
    const { privacy } = useSettings.getState().settings;
    if (!privacy.serverAnalysis) {
      const st: PageState = { status: 'disabled' };
      set((s) => ({ byUrl: { ...s.byUrl, [url]: st } }));
      return st;
    }
    const existing = get().byUrl[url];
    if (!opts.force && existing) {
      if (existing.status === 'loading') {
        const f = inflight.get(url);
        if (f) return f.promise;
      } else if (existing.status !== 'disabled' && Date.now() - existing.fetchedAt < TTL) {
        return existing;
      }
    }
    inflight.get(url)?.controller.abort();
    const controller = new AbortController();
    set((s) => ({ byUrl: { ...s.byUrl, [url]: { status: 'loading', startedAt: Date.now() } } }));
    const promise = fetchPage(
      { url, resolver: privacy.resolver, safeBrowsing: privacy.safeBrowsing, proxy: activeProxy() },
      controller.signal,
    ).then((res) => {
      const st: PageState = res.ok
        ? { status: 'ready', data: res, fetchedAt: Date.now() }
        : { status: 'error', error: res, fetchedAt: Date.now() };
      if (inflight.get(url)?.controller === controller) {
        inflight.delete(url);
        set((s) => ({ byUrl: { ...s.byUrl, [url]: st } }));
      }
      return st;
    });
    inflight.set(url, { promise, controller });
    return promise;
  },
  cancel: (url) => {
    const f = inflight.get(url);
    if (!f) return;
    f.controller.abort();
    inflight.delete(url);
    set((s) => {
      const next = { ...s.byUrl };
      delete next[url];
      return { byUrl: next };
    });
  },
  clear: () => {
    inflight.forEach((f) => f.controller.abort());
    inflight.clear();
    set({ byUrl: {} });
  },
}));
