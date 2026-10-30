import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  BookmarkPlus,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Home,
  Layers,
  Lock,
  Menu as MenuIcon,
  MonitorPlay,
  MoreHorizontal,
  NotebookPen,
  PanelLeftOpen,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareSplitHorizontal,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveTab, useActiveWorkspace, useMediaQuery } from '../../hooks.ts';
import { useBrowser } from '../../store/browser.ts';
import { useFrames } from '../../store/frames.ts';
import { useLibrary } from '../../store/library.ts';
import { usePages } from '../../store/pages.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { addPageToCollection, downloadPage, noteFromPage, saveToReadingList } from '../../lib/pageActions.ts';
import { altKey, displayUrl, hostOf, isInternal, resolveInput, searchUrl } from '../../lib/util.ts';
import { Favicon, IconButton, Menu, Segmented, type MenuItem } from '../ui/index.tsx';
import { CollectionPicker } from './CollectionPicker.tsx';
import { SitePermissionsDialog } from './SitePermissions.tsx';

export function Toolbar() {
  const tab = useActiveTab();
  const ws = useActiveWorkspace();
  const b = useBrowser.getState;
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed);
  const aiOpen = useSettings((s) => s.settings.aiPanelOpen);
  const homepage = useSettings((s) => s.settings.homepage);
  const update = useSettings((s) => s.update);
  const setMobileSidebar = useUi((s) => s.setMobileSidebar);
  const desktop = useMediaQuery('(min-width: 768px)');
  const compact = !useMediaQuery('(min-width: 640px)');
  const pageState = usePages((s) => (tab ? s.byUrl[tab.url] : undefined));
  const frameLoading = useFrames((s) => (tab ? s.loading[tab.id] : false));
  const bookmarked = useLibrary((s) => (tab ? s.bookmarks.some((x) => x.url === tab.url) : false));
  const toggleBookmark = useLibrary((s) => s.toggleBookmark);
  const toast = useUi((s) => s.toast);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [perms, setPerms] = useState(false);

  if (!tab) return <div className="glass h-11 rounded-xl" />;
  const web = !isInternal(tab.url);
  const loading = pageState?.status === 'loading' || !!frameLoading;
  const resolvedMode = tab.viewMode === 'auto' ? null : tab.viewMode;
  const embedBlocked = pageState?.status === 'ready' && pageState.data.embed.allowed === false;
  const effective = resolvedMode ?? (embedBlocked || ws.settings.defaultView === 'reader' ? 'reader' : 'live');

  const menuItems: MenuItem[] = [
    { label: 'Save to reading list', icon: <BookOpenText />, disabled: !web, onSelect: () => saveToReadingList(tab) },
    { label: 'Add to collection…', icon: <Layers />, disabled: !web, onSelect: () => setPicker(true) },
    { label: 'New note from page', icon: <NotebookPen />, disabled: !web, onSelect: () => noteFromPage(tab) },
    { separator: true, label: '' },
    { label: 'Download as Markdown', icon: <Download />, disabled: !web, onSelect: () => downloadPage(tab, 'md') },
    { label: 'Download as HTML (reader)', icon: <FileText />, disabled: !web, onSelect: () => downloadPage(tab, 'html') },
    { separator: true, label: '' },
    {
      label: ws.splitTabId ? 'Close split view' : 'Split view',
      icon: <SquareSplitHorizontal />,
      onSelect: () => {
        if (ws.splitTabId) b().setSplit(ws.id, null);
        else {
          const id = b().newTab('aether://newtab', { activate: false, afterTabId: tab.id });
          b().setSplit(ws.id, id);
        }
      },
    },
    { label: 'Site permissions…', icon: <ShieldCheck />, disabled: !web, onSelect: () => setPerms(true) },
    {
      label: 'Open in a new browser tab',
      icon: <ExternalLink />,
      disabled: !web,
      onSelect: () => window.open(tab.url, '_blank', 'noopener,noreferrer'),
    },
  ];

  return (
    <header className="glass relative flex h-11 shrink-0 items-center gap-0.5 rounded-xl px-1.5 sm:gap-1">
      {!desktop ? (
        <IconButton label="Tabs and workspaces" onClick={() => setMobileSidebar(true)}>
          <MenuIcon className="size-4" />
        </IconButton>
      ) : (
        collapsed && (
          <IconButton label="Show sidebar" shortcut={`${altKey}S`} onClick={() => update((s) => void (s.sidebarCollapsed = false))}>
            <PanelLeftOpen className="size-4" />
          </IconButton>
        )
      )}
      <IconButton label="Back" shortcut={`${altKey}[`} disabled={tab.nav.index === 0} onClick={() => b().back(tab.id)}>
        <ArrowLeft className="size-4" />
      </IconButton>
      {!compact && (
        <IconButton
          label="Forward"
          shortcut={`${altKey}]`}
          disabled={tab.nav.index >= tab.nav.entries.length - 1}
          onClick={() => b().forward(tab.id)}
        >
          <ArrowRight className="size-4" />
        </IconButton>
      )}
      {loading ? (
        <IconButton
          label="Stop"
          onClick={() => {
            usePages.getState().cancel(tab.url);
            useFrames.getState().stop(tab.id);
          }}
        >
          <X className="size-4" />
        </IconButton>
      ) : (
        <IconButton label="Reload" shortcut={`${altKey}R`} onClick={() => b().reload(tab.id)}>
          <RotateCw className="size-[15px]" />
        </IconButton>
      )}
      {!compact && (
        <IconButton label="Home" onClick={() => b().navigate(tab.id, homepage)}>
          <Home className="size-4" />
        </IconButton>
      )}

      <AddressBar tabId={tab.id} url={tab.url} favicon={tab.favicon} https={tab.url.startsWith('https:')} />

      {web && !compact && (
        <Segmented
          label="View mode"
          size="sm"
          value={effective}
          onChange={(v) => b().setViewMode(tab.id, v)}
          options={[
            {
              value: 'live',
              label: (
                <>
                  <MonitorPlay className="size-3.5" />
                  <span className="hidden lg:inline">Live</span>
                </>
              ),
              title: embedBlocked ? 'This site blocks embedding' : 'Live view: the real site, embedded',
            },
            {
              value: 'reader',
              label: (
                <>
                  <BookOpenText className="size-3.5" />
                  <span className="hidden lg:inline">Reader</span>
                </>
              ),
              title: 'Reader view: fetched and cleaned by Aether, no scripts or trackers',
            },
          ]}
        />
      )}
      {web && (
        <IconButton
          label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
          shortcut={`${altKey}D`}
          active={bookmarked}
          onClick={() => toast(toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon }) ? 'Bookmarked' : 'Bookmark removed', 'ok')}
        >
          {bookmarked ? <Star className="size-4 fill-current text-accent" /> : <BookmarkPlus className="size-4" />}
        </IconButton>
      )}
      <IconButton
        label="More"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.right - 220, y: r.bottom + 6 });
        }}
      >
        <MoreHorizontal className="size-4" />
      </IconButton>
      <IconButton
        label={aiOpen ? 'Hide AI assistant' : 'AI assistant'}
        shortcut={`${altKey}A`}
        active={aiOpen}
        onClick={() => update((s) => void (s.aiPanelOpen = !s.aiPanelOpen))}
      >
        <Sparkles className="size-4" />
      </IconButton>
      {loading && <div className="progress-bar" aria-hidden />}
      <Menu anchor={menu} items={menuItems} onClose={() => setMenu(null)} />
      <CollectionPicker open={picker} onClose={() => setPicker(false)} onPick={(id) => addPageToCollection(tab, id)} />
      {perms && <SitePermissionsDialog host={hostOf(tab.url)} onClose={() => setPerms(false)} />}
    </header>
  );
}

interface Suggestion {
  kind: 'go' | 'search' | 'tab' | 'bookmark' | 'history';
  label: string;
  sub: string;
  url: string;
  tabId?: string;
}

function AddressBar({ tabId, url, favicon, https }: { tabId: string; url: string; favicon?: string; https: boolean }) {
  const [value, setValue] = useState(url);
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const focusNonce = useUi((s) => s.addressFocusNonce);
  const engine = useSettings((s) => s.settings.searchEngine);
  const tabs = useBrowser((s) => s.tabs);
  const history = useBrowser((s) => s.history);
  const activeWs = useBrowser((s) => s.activeWorkspaceId);
  const bookmarks = useLibrary((s) => s.bookmarks);
  const pageState = usePages((s) => s.byUrl[url]);

  useEffect(() => {
    if (!focused) setValue(url);
  }, [url, focused]);
  useEffect(() => {
    if (focusNonce) {
      input.current?.focus();
      input.current?.select();
    }
  }, [focusNonce]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = value.trim();
    if (!focused || !q || q === url) return [];
    const target = resolveInput(q, engine);
    const lower = q.toLowerCase();
    const isSearch = target === searchUrl(q, engine);
    const out: Suggestion[] = [
      isSearch
        ? { kind: 'search', label: q, sub: engine === 'aether' ? 'Search with Aether' : `Search ${engine}`, url: target }
        : { kind: 'go', label: target, sub: 'Go to address', url: target },
    ];
    const seen = new Set([target]);
    const match = (s: string) => s.toLowerCase().includes(lower);
    for (const t of tabs) {
      if (t.workspaceId !== activeWs || t.id === tabId || seen.has(t.url)) continue;
      if (match(t.title) || match(t.url)) {
        out.push({ kind: 'tab', label: t.title, sub: 'Switch to tab', url: t.url, tabId: t.id });
        seen.add(t.url);
      }
    }
    for (const bm of bookmarks) {
      if (out.length > 7) break;
      if (!seen.has(bm.url) && (match(bm.title) || match(bm.url))) {
        out.push({ kind: 'bookmark', label: bm.title, sub: displayUrl(bm.url), url: bm.url });
        seen.add(bm.url);
      }
    }
    for (const h of history) {
      if (out.length > 8) break;
      if (h.workspaceId === activeWs && !seen.has(h.url) && (match(h.title) || match(h.url))) {
        out.push({ kind: 'history', label: h.title, sub: displayUrl(h.url), url: h.url });
        seen.add(h.url);
      }
    }
    return out;
  }, [value, focused, url, engine, tabs, bookmarks, history, activeWs, tabId]);

  useEffect(() => setSel(0), [value]);

  const go = (s?: Suggestion) => {
    const b = useBrowser.getState();
    if (s?.tabId) b.activateTab(s.tabId);
    else b.navigate(tabId, s ? s.url : resolveInput(value, engine));
    input.current?.blur();
  };

  const internal = isInternal(url);
  const blockedMalicious = pageState?.status === 'error' && pageState.error.error.code === 'BLOCKED_MALICIOUS';
  const SecIcon = internal ? null : blockedMalicious ? ShieldAlert : https ? Lock : ShieldAlert;
  const secLabel = internal ? 'Aether page' : blockedMalicious ? 'Blocked: flagged as malicious' : https ? 'Secure connection (HTTPS)' : 'Not secure (HTTP)';

  return (
    <div className="relative mx-1 min-w-0 flex-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(suggestions[sel]);
        }}
        className={clsx(
          'flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-colors duration-150',
          focused ? 'border-accent/50 bg-surface-2' : 'border-transparent bg-surface hover:bg-hover',
        )}
      >
        {focused ? (
          <Search className="size-3.5 shrink-0 text-fg-3" />
        ) : internal ? (
          <Globe className="size-3.5 shrink-0 text-accent" />
        ) : (
          <span title={secLabel} aria-label={secLabel} className="flex shrink-0">
            {SecIcon && <SecIcon className={clsx('size-3.5', https && !blockedMalicious ? 'text-fg-3' : 'text-warn')} />}
          </span>
        )}
        {!focused && !internal && <Favicon url={url} src={favicon} className="hidden sm:block" />}
        <input
          ref={input}
          value={focused ? value : displayUrl(url)}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            setValue(url === 'aether://newtab' ? '' : url);
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault();
              setSel((s) => (s + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault();
              setSel((s) => (s - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Escape') {
              setValue(url);
              input.current?.blur();
            }
          }}
          aria-label="Address and search bar"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          placeholder="Search or enter address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </form>
      {suggestions.length > 0 && (
        <ul role="listbox" className="glass-strong absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg p-1 anim-fade">
          {suggestions.map((s, i) => (
            <li key={s.kind + s.url} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(s);
                }}
                onMouseEnter={() => setSel(i)}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                  i === sel ? 'bg-active' : 'hover:bg-hover',
                )}
              >
                {s.kind === 'search' ? (
                  <Search className="size-4 text-fg-3" />
                ) : s.kind === 'go' ? (
                  <Globe className="size-4 text-fg-3" />
                ) : (
                  <Favicon url={s.url} />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.label}</span>
                <span className="max-w-[45%] truncate text-[11.5px] text-fg-3">{s.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
