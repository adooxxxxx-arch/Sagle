import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useBrowser, ensureActiveTab } from './store/browser.ts';
import { useChats } from './store/chats.ts';
import { useLibrary } from './store/library.ts';
import { useSettings } from './store/settings.ts';
import { useVault } from './store/vault.ts';
import type { Tab, Workspace } from './lib/types.ts';

const persisted = [useBrowser, useSettings, useLibrary, useChats] as const;

export function useHydration(): boolean {
  const [ready, setReady] = useState(() => persisted.every((s) => s.persist.hasHydrated()));
  useEffect(() => {
    let cancelled = false;
    const done = async () => {
      await Promise.all(
        persisted.map(
          (s) =>
            new Promise<void>((resolve) => {
              if (s.persist.hasHydrated()) resolve();
              else {
                const unsub = s.persist.onFinishHydration(() => {
                  unsub();
                  resolve();
                });
              }
            }),
        ),
      );
      await useVault.getState().load();
      if (cancelled) return;
      ensureActiveTab();
      useBrowser.getState().pruneHistory(useSettings.getState().settings.privacy.historyRetentionDays);
      setReady(true);
    };
    void done();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function useResolvedTheme(): 'dark' | 'light' {
  const pref = useSettings((s) => s.settings.theme);
  const systemDark = useSyncExternalStore(
    (cb) => {
      darkQuery?.addEventListener('change', cb);
      return () => darkQuery?.removeEventListener('change', cb);
    },
    () => darkQuery?.matches ?? true,
  );
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0e14' : '#e9edf3');
  }, [theme]);
}

export function useActiveWorkspace(): Workspace {
  return useBrowser((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0]);
}

export function useWorkspaceTabs(workspaceId: string): Tab[] {
  const tabs = useBrowser((s) => s.tabs);
  return useMemo(() => tabs.filter((t) => t.workspaceId === workspaceId), [tabs, workspaceId]);
}

export function useActiveTab(): Tab | null {
  return useBrowser((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return s.tabs.find((t) => t.id === ws?.activeTabId) ?? null;
  });
}

export function useMediaQuery(q: string): boolean {
  const mq = useMemo(() => window.matchMedia(q), [q]);
  return useSyncExternalStore(
    (cb) => {
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => mq.matches,
  );
}
