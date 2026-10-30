import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from '../lib/storage.ts';
import type {
  ClosedTab,
  GroupColor,
  HistoryItem,
  SavedSession,
  Tab,
  TabGroup,
  ViewMode,
  Workspace,
  WorkspaceIcon,
  WorkspaceSettings,
} from '../lib/types.ts';
import { INTERNAL_TITLES, NEW_TAB_URL, hostOf, isInternal, parseInternal, uid } from '../lib/util.ts';

const MAX_HISTORY = 5000;
const MAX_CLOSED = 25;

const baseSettings: WorkspaceSettings = {
  defaultView: 'auto',
  aiContextDefault: 'page',
  historyEnabled: true,
  isolateCookies: false,
};

function makeWorkspace(name: string, icon: WorkspaceIcon, extra: Partial<Workspace> = {}): Workspace {
  return {
    id: uid(),
    name,
    icon,
    private: false,
    ephemeral: false,
    settings: { ...baseSettings },
    activeTabId: null,
    splitTabId: null,
    createdAt: Date.now(),
    ...extra,
  };
}

function defaultWorkspaces(): Workspace[] {
  return [
    makeWorkspace('Personal', 'user'),
    makeWorkspace('Research', 'flask', { settings: { ...baseSettings, defaultView: 'reader' } }),
    makeWorkspace('Work', 'briefcase'),
    makeWorkspace('Private', 'eye-off', {
      private: true,
      ephemeral: true,
      settings: { defaultView: 'auto', aiContextDefault: 'none', historyEnabled: false, isolateCookies: true },
    }),
  ];
}

export function titleForUrl(url: string): string {
  if (isInternal(url)) {
    const { page, params } = parseInternal(url);
    if (page === 'search' && params.get('q')) return params.get('q')!;
    return INTERNAL_TITLES[page];
  }
  return hostOf(url);
}

function makeTab(workspaceId: string, url: string): Tab {
  return {
    id: uid(),
    workspaceId,
    url,
    title: titleForUrl(url),
    pinned: false,
    groupId: null,
    nav: { entries: [url], index: 0 },
    viewMode: 'auto',
    reloadKey: 0,
    createdAt: Date.now(),
  };
}

interface BrowserState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  tabs: Tab[];
  groups: TabGroup[];
  closed: ClosedTab[];
  history: HistoryItem[];
  sessions: SavedSession[];

  // tabs
  newTab: (url?: string, opts?: { activate?: boolean; workspaceId?: string; afterTabId?: string }) => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  navigate: (tabId: string, url: string) => void;
  back: (tabId: string) => void;
  forward: (tabId: string) => void;
  reload: (tabId: string) => void;
  setTabMeta: (tabId: string, meta: { title?: string; favicon?: string }) => void;
  setViewMode: (tabId: string, mode: ViewMode) => void;
  togglePin: (tabId: string) => void;
  moveTab: (tabId: string, beforeTabId: string | null) => void;
  duplicateTab: (tabId: string) => void;
  reopenClosed: () => void;
  closeOtherTabs: (tabId: string) => void;
  // groups
  createGroup: (tabIds: string[], name?: string) => string;
  updateGroup: (id: string, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>) => void;
  ungroup: (id: string) => void;
  setTabGroup: (tabId: string, groupId: string | null) => void;
  // workspaces
  switchWorkspace: (id: string) => void;
  addWorkspace: (name: string, icon: WorkspaceIcon, opts?: Partial<Pick<Workspace, 'ephemeral' | 'private'>>) => string;
  updateWorkspace: (id: string, patch: Partial<Omit<Workspace, 'settings'>> & { settings?: Partial<WorkspaceSettings> }) => void;
  deleteWorkspace: (id: string) => void;
  setSplit: (workspaceId: string, tabId: string | null) => void;
  // history
  clearHistory: (opts?: { workspaceId?: string; since?: number }) => void;
  deleteHistory: (ids: string[]) => void;
  pruneHistory: (retentionDays: number) => void;
  // sessions
  saveSession: (name: string) => void;
  restoreSession: (id: string) => void;
  deleteSession: (id: string) => void;
  replaceAll: (s: Partial<Pick<BrowserState, 'workspaces' | 'sessions'>>) => void;
}

const initialWorkspaces = defaultWorkspaces();

function wsOf(st: BrowserState, id: string) {
  return st.workspaces.find((w) => w.id === id);
}

function recordHistory(st: BrowserState, tab: Tab, url: string): HistoryItem[] {
  const ws = wsOf(st, tab.workspaceId);
  if (!ws || !ws.settings.historyEnabled || ws.private || isInternal(url)) return st.history;
  const last = st.history[0];
  if (last && last.url === url && last.workspaceId === ws.id && Date.now() - last.visitedAt < 60_000) return st.history;
  const item: HistoryItem = { id: uid(), workspaceId: ws.id, url, title: titleForUrl(url), visitedAt: Date.now() };
  return [item, ...st.history].slice(0, MAX_HISTORY);
}

export const useBrowser = create<BrowserState>()(
  persist(
    (set, get) => ({
      workspaces: initialWorkspaces,
      activeWorkspaceId: initialWorkspaces[0].id,
      tabs: [],
      groups: [],
      closed: [],
      history: [],
      sessions: [],

      newTab: (url = NEW_TAB_URL, opts = {}) => {
        const st = get();
        const workspaceId = opts.workspaceId ?? st.activeWorkspaceId;
        const tab = makeTab(workspaceId, url);
        set((s) => {
          const tabs = [...s.tabs];
          const anchor = opts.afterTabId ? tabs.findIndex((t) => t.id === opts.afterTabId) : -1;
          if (anchor >= 0) tabs.splice(anchor + 1, 0, tab);
          else tabs.push(tab);
          const workspaces =
            opts.activate === false
              ? s.workspaces
              : s.workspaces.map((w) => (w.id === workspaceId ? { ...w, activeTabId: tab.id } : w));
          return { tabs, workspaces, history: recordHistory({ ...s, tabs }, tab, url) };
        });
        return tab.id;
      },

      closeTab: (id) => {
        const st = get();
        const tab = st.tabs.find((t) => t.id === id);
        if (!tab) return;
        const ws = wsOf(st, tab.workspaceId);
        const siblings = st.tabs.filter((t) => t.workspaceId === tab.workspaceId);
        const idx = siblings.findIndex((t) => t.id === id);
        const remaining = siblings.filter((t) => t.id !== id);
        let nextActive = ws?.activeTabId ?? null;
        if (nextActive === id) nextActive = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
        set((s) => ({
          tabs: s.tabs.filter((t) => t.id !== id),
          closed: ws?.ephemeral ? s.closed : [{ tab, closedAt: Date.now() }, ...s.closed].slice(0, MAX_CLOSED),
          workspaces: s.workspaces.map((w) =>
            w.id === tab.workspaceId
              ? { ...w, activeTabId: nextActive, splitTabId: w.splitTabId === id ? null : w.splitTabId }
              : w,
          ),
        }));
        if (remaining.length === 0) get().newTab(NEW_TAB_URL, { workspaceId: tab.workspaceId });
      },

      activateTab: (id) => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        set((s) => ({
          activeWorkspaceId: tab.workspaceId,
          workspaces: s.workspaces.map((w) =>
            w.id === tab.workspaceId ? { ...w, activeTabId: id, splitTabId: w.splitTabId === id ? null : w.splitTabId } : w,
          ),
        }));
      },

      navigate: (tabId, url) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab) return s;
          if (tab.url === url) return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, reloadKey: t.reloadKey + 1 } : t)) };
          const entries = [...tab.nav.entries.slice(0, tab.nav.index + 1), url].slice(-50);
          const next: Tab = {
            ...tab,
            url,
            title: titleForUrl(url),
            favicon: undefined,
            viewMode: tab.viewMode === 'live' || tab.viewMode === 'reader' ? 'auto' : tab.viewMode,
            nav: { entries, index: entries.length - 1 },
          };
          return { tabs: s.tabs.map((t) => (t.id === tabId ? next : t)), history: recordHistory(s, tab, url) };
        }),

      back: (tabId) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId || t.nav.index === 0) return t;
            const index = t.nav.index - 1;
            const url = t.nav.entries[index];
            return { ...t, url, title: titleForUrl(url), favicon: undefined, nav: { ...t.nav, index } };
          }),
        })),

      forward: (tabId) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId || t.nav.index >= t.nav.entries.length - 1) return t;
            const index = t.nav.index + 1;
            const url = t.nav.entries[index];
            return { ...t, url, title: titleForUrl(url), favicon: undefined, nav: { ...t.nav, index } };
          }),
        })),

      reload: (tabId) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, reloadKey: t.reloadKey + 1 } : t)) })),

      setTabMeta: (tabId, meta) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab) return s;
          const history =
            meta.title && s.history[0]?.url === tab.url ? [{ ...s.history[0], title: meta.title }, ...s.history.slice(1)] : s.history;
          return {
            tabs: s.tabs.map((t) =>
              t.id === tabId ? { ...t, title: meta.title || t.title, favicon: meta.favicon ?? t.favicon } : t,
            ),
            history,
          };
        }),

      setViewMode: (tabId, viewMode) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, viewMode } : t)) })),

      togglePin: (tabId) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned, groupId: null } : t)) })),

      moveTab: (tabId, beforeTabId) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab || tabId === beforeTabId) return s;
          const rest = s.tabs.filter((t) => t.id !== tabId);
          const at = beforeTabId ? rest.findIndex((t) => t.id === beforeTabId) : rest.length;
          rest.splice(at < 0 ? rest.length : at, 0, tab);
          return { tabs: rest };
        }),

      duplicateTab: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (tab) get().newTab(tab.url, { workspaceId: tab.workspaceId, afterTabId: tab.id });
      },

      reopenClosed: () => {
        const st = get();
        const entry = st.closed.find((c) => st.workspaces.some((w) => w.id === c.tab.workspaceId));
        if (!entry) return;
        const tab: Tab = { ...entry.tab, id: uid(), reloadKey: 0 };
        set((s) => ({
          closed: s.closed.filter((c) => c !== entry),
          tabs: [...s.tabs, tab],
          activeWorkspaceId: tab.workspaceId,
          workspaces: s.workspaces.map((w) => (w.id === tab.workspaceId ? { ...w, activeTabId: tab.id } : w)),
        }));
      },

      closeOtherTabs: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        get()
          .tabs.filter((t) => t.workspaceId === tab.workspaceId && t.id !== tabId && !t.pinned)
          .forEach((t) => get().closeTab(t.id));
      },

      createGroup: (tabIds, name = 'New group') => {
        const st = get();
        const first = st.tabs.find((t) => t.id === tabIds[0]);
        const colors: GroupColor[] = ['blue', 'teal', 'green', 'yellow', 'pink', 'red', 'slate'];
        const group: TabGroup = {
          id: uid(),
          workspaceId: first?.workspaceId ?? st.activeWorkspaceId,
          name,
          color: colors[st.groups.length % colors.length],
          collapsed: false,
        };
        set((s) => ({
          groups: [...s.groups, group],
          tabs: s.tabs.map((t) => (tabIds.includes(t.id) ? { ...t, groupId: group.id, pinned: false } : t)),
        }));
        return group.id;
      },

      updateGroup: (id, patch) => set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),

      ungroup: (id) =>
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== id),
          tabs: s.tabs.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)),
        })),

      setTabGroup: (tabId, groupId) =>
        set((s) => {
          const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, groupId, pinned: groupId ? false : t.pinned } : t));
          const used = new Set(tabs.map((t) => t.groupId));
          return { tabs, groups: s.groups.filter((g) => used.has(g.id)) };
        }),

      switchWorkspace: (id) => {
        if (!wsOf(get(), id)) return;
        set({ activeWorkspaceId: id });
        const hasTabs = get().tabs.some((t) => t.workspaceId === id);
        if (!hasTabs) get().newTab(NEW_TAB_URL, { workspaceId: id });
      },

      addWorkspace: (name, icon, opts = {}) => {
        const ws = makeWorkspace(name, icon, {
          ...opts,
          settings: opts.private
            ? { defaultView: 'auto', aiContextDefault: 'none', historyEnabled: false, isolateCookies: true }
            : { ...baseSettings, historyEnabled: !opts.ephemeral },
        });
        set((s) => ({ workspaces: [...s.workspaces, ws] }));
        get().switchWorkspace(ws.id);
        return ws.id;
      },

      updateWorkspace: (id, patch) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === id ? { ...w, ...patch, settings: { ...w.settings, ...patch.settings } } : w,
          ),
        })),

      deleteWorkspace: (id) => {
        const st = get();
        if (st.workspaces.length <= 1) return;
        const remaining = st.workspaces.filter((w) => w.id !== id);
        set((s) => ({
          workspaces: remaining,
          tabs: s.tabs.filter((t) => t.workspaceId !== id),
          groups: s.groups.filter((g) => g.workspaceId !== id),
          history: s.history.filter((h) => h.workspaceId !== id),
          sessions: s.sessions.filter((x) => x.workspaceId !== id),
          closed: s.closed.filter((c) => c.tab.workspaceId !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? remaining[0].id : s.activeWorkspaceId,
        }));
        get().switchWorkspace(get().activeWorkspaceId);
      },

      setSplit: (workspaceId, tabId) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, splitTabId: tabId } : w)) })),

      clearHistory: (opts = {}) =>
        set((s) => ({
          history: s.history.filter((h) => {
            if (opts.workspaceId && h.workspaceId !== opts.workspaceId) return true;
            if (opts.since && h.visitedAt < opts.since) return true;
            return false;
          }),
          closed: opts.workspaceId || opts.since ? s.closed : [],
        })),

      deleteHistory: (ids) => set((s) => ({ history: s.history.filter((h) => !ids.includes(h.id)) })),

      pruneHistory: (days) => {
        if (!days) return;
        const cutoff = Date.now() - days * 86_400_000;
        set((s) => ({ history: s.history.filter((h) => h.visitedAt >= cutoff) }));
      },

      saveSession: (name) => {
        const st = get();
        const tabs = st.tabs
          .filter((t) => t.workspaceId === st.activeWorkspaceId)
          .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned }));
        const session: SavedSession = { id: uid(), name, workspaceId: st.activeWorkspaceId, tabs, createdAt: Date.now() };
        set((s) => ({ sessions: [session, ...s.sessions] }));
      },

      restoreSession: (id) => {
        const st = get();
        const session = st.sessions.find((x) => x.id === id);
        if (!session) return;
        const workspaceId = wsOf(st, session.workspaceId) ? session.workspaceId : st.activeWorkspaceId;
        const created = session.tabs.map((t) => ({ ...makeTab(workspaceId, t.url), title: t.title, pinned: t.pinned }));
        if (!created.length) return;
        set((s) => ({
          tabs: [...s.tabs, ...created],
          activeWorkspaceId: workspaceId,
          workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, activeTabId: created[0].id } : w)),
        }));
      },

      deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),

      replaceAll: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    {
      name: 'aether-browser',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // Ephemeral (incl. private) workspaces never touch disk: their tabs, groups, history,
      // closed tabs and sessions are filtered out before every write.
      partialize: (s) => {
        const ephemeral = new Set(s.workspaces.filter((w) => w.ephemeral).map((w) => w.id));
        return {
          workspaces: s.workspaces.map((w) => (w.ephemeral ? { ...w, activeTabId: null, splitTabId: null } : w)),
          activeWorkspaceId: ephemeral.has(s.activeWorkspaceId)
            ? (s.workspaces.find((w) => !w.ephemeral)?.id ?? s.activeWorkspaceId)
            : s.activeWorkspaceId,
          tabs: s.tabs.filter((t) => !ephemeral.has(t.workspaceId)),
          groups: s.groups.filter((g) => !ephemeral.has(g.workspaceId)),
          closed: s.closed.filter((c) => !ephemeral.has(c.tab.workspaceId)),
          history: s.history.filter((h) => !ephemeral.has(h.workspaceId)),
          sessions: s.sessions.filter((x) => !ephemeral.has(x.workspaceId)),
        };
      },
    },
  ),
);

/** Ensure every workspace that is about to be shown has at least one tab. */
export function ensureActiveTab() {
  const st = useBrowser.getState();
  const ws = st.workspaces.find((w) => w.id === st.activeWorkspaceId) ?? st.workspaces[0];
  if (!ws) return;
  if (ws.id !== st.activeWorkspaceId) useBrowser.setState({ activeWorkspaceId: ws.id });
  const tabs = st.tabs.filter((t) => t.workspaceId === ws.id);
  if (tabs.length === 0) st.newTab(NEW_TAB_URL, { workspaceId: ws.id });
  else if (!ws.activeTabId || !tabs.some((t) => t.id === ws.activeTabId)) st.activateTab(tabs[0].id);
}
