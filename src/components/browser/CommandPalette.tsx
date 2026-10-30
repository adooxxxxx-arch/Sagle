import clsx from 'clsx';
import {
  BookOpenText,
  Bookmark,
  CornerDownLeft,
  EyeOff,
  Globe,
  History,
  Library,
  Moon,
  NotebookPen,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Sparkles,
  SquareSplitHorizontal,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useResolvedTheme } from '../../hooks.ts';
import { openLibrary } from '../../lib/pageActions.ts';
import { displayUrl, resolveInput, searchUrl } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { Favicon } from '../ui/index.tsx';

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  if (!open) return null;
  return <Palette onClose={() => setOpen(false)} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const tabs = useBrowser((s) => s.tabs);
  const workspaces = useBrowser((s) => s.workspaces);
  const activeWs = useBrowser((s) => s.activeWorkspaceId);
  const history = useBrowser((s) => s.history);
  const bookmarks = useLibrary((s) => s.bookmarks);
  const engine = useSettings((s) => s.settings.searchEngine);
  const theme = useResolvedTheme();

  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const b = useBrowser.getState();
    const lower = q.trim().toLowerCase();
    const match = (...s: string[]) => !lower || s.some((x) => x.toLowerCase().includes(lower));
    const activeTab = () => {
      const ws = b.workspaces.find((w) => w.id === b.activeWorkspaceId);
      return b.tabs.find((t) => t.id === ws?.activeTabId);
    };
    const openUrl = (url: string) => {
      const t = activeTab();
      if (t && t.url === 'aether://newtab') b.navigate(t.id, url);
      else b.newTab(url);
    };
    const out: Item[] = [];
    if (lower) {
      const target = resolveInput(q, engine);
      const isSearch = target === searchUrl(q.trim(), engine);
      out.push({
        id: 'go',
        group: 'Go',
        label: isSearch ? `Search “${q.trim()}”` : `Open ${displayUrl(target)}`,
        icon: isSearch ? <Search /> : <Globe />,
        run: () => openUrl(target),
      });
      out.push({
        id: 'research',
        group: 'Go',
        label: `Research “${q.trim()}” with AI`,
        sub: 'Searches the web and cites sources',
        icon: <Sparkles />,
        run: () => {
          useSettings.getState().update((s) => void (s.aiPanelOpen = true));
          useUi.getState().requestAi({ prompt: q.trim(), context: 'none', research: true });
        },
      });
    }
    for (const t of tabs) {
      if (t.workspaceId !== activeWs || !match(t.title, t.url)) continue;
      out.push({ id: 't' + t.id, group: 'Open tabs', label: t.title, sub: displayUrl(t.url), icon: <Favicon url={t.url} src={t.favicon} />, run: () => b.activateTab(t.id) });
    }
    const commands: Omit<Item, 'group'>[] = [
      { id: 'new', label: 'New tab', icon: <Plus />, run: () => b.newTab() },
      { id: 'reopen', label: 'Reopen closed tab', icon: <RotateCcw />, run: () => b.reopenClosed() },
      { id: 'ai', label: 'Toggle AI assistant', icon: <Sparkles />, run: () => useSettings.getState().update((s) => void (s.aiPanelOpen = !s.aiPanelOpen)) },
      {
        id: 'split',
        label: 'Split view with a new tab',
        icon: <SquareSplitHorizontal />,
        run: () => {
          const t = activeTab();
          if (!t) return;
          const id = b.newTab('aether://newtab', { activate: false, afterTabId: t.id });
          b.setSplit(t.workspaceId, id);
        },
      },
      {
        id: 'reader',
        label: 'Toggle Reader view',
        icon: <BookOpenText />,
        run: () => {
          const t = activeTab();
          if (t) b.setViewMode(t.id, t.viewMode === 'reader' ? 'live' : 'reader');
        },
      },
      { id: 'privacy', label: 'Privacy center', icon: <Shield />, run: () => b.newTab('aether://privacy') },
      { id: 'settings', label: 'Settings', icon: <Settings />, run: () => b.newTab('aether://settings') },
      { id: 'history', label: 'History', icon: <History />, run: () => b.newTab('aether://history') },
      { id: 'library', label: 'Library', icon: <Library />, run: () => openLibrary('reading') },
      { id: 'note', label: 'New note', icon: <NotebookPen />, run: () => openLibrary(`notes/${useLibrary.getState().createNote({ workspaceId: b.activeWorkspaceId })}`) },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <Sun /> : <Moon />,
        run: () => useSettings.getState().update((s) => void (s.theme = theme === 'dark' ? 'light' : 'dark')),
      },
      { id: 'sidebar', label: 'Toggle sidebar', icon: <PanelLeft />, run: () => useSettings.getState().update((s) => void (s.sidebarCollapsed = !s.sidebarCollapsed)) },
      ...workspaces
        .filter((w) => w.id !== activeWs)
        .map((w) => ({ id: 'ws' + w.id, label: `Switch to ${w.name}`, icon: w.private ? <EyeOff /> : <PanelLeft />, run: () => b.switchWorkspace(w.id) })),
    ];
    const matched = commands.filter((c) => match(c.label)).map((c) => ({ ...c, group: 'Commands' }));
    // A query that names a command ("settings", "new tab") should run it, not search the web.
    if (lower && matched.some((c) => c.label.toLowerCase().startsWith(lower))) out.unshift(...matched);
    else out.push(...matched);
    if (lower) {
      for (const bm of bookmarks.filter((x) => match(x.title, x.url)).slice(0, 5)) {
        out.push({ id: 'b' + bm.id, group: 'Bookmarks', label: bm.title, sub: displayUrl(bm.url), icon: <Bookmark />, run: () => openUrl(bm.url) });
      }
      const seen = new Set<string>();
      for (const h of history) {
        if (seen.size >= 6) break;
        if (h.workspaceId !== activeWs || seen.has(h.url) || !match(h.title, h.url)) continue;
        seen.add(h.url);
        out.push({ id: 'h' + h.id, group: 'History', label: h.title, sub: displayUrl(h.url), icon: <History />, run: () => openUrl(h.url) });
      }
    }
    return out;
  }, [q, tabs, workspaces, activeWs, history, bookmarks, engine, theme]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (it?: Item) => {
    if (!it) return;
    onClose();
    it.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-3 pt-[10vh] anim-fade">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="glass-strong relative flex max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl anim-rise">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search className="size-4 text-fg-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[sel]);
              } else if (e.key === 'Escape') onClose();
            }}
            placeholder="Search, open a site, or run a command"
            aria-label="Command"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-3"
          />
        </div>
        <div ref={list} className="scroll-thin overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-fg-3">No matches</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  data-index={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(it)}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', i === sel ? 'bg-active' : '')}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-fg-2 [&>svg]:size-4">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{it.label}</span>
                  {it.sub && <span className="max-w-[40%] truncate text-[11.5px] text-fg-3">{it.sub}</span>}
                  {i === sel && <CornerDownLeft className="size-3.5 text-fg-3" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
