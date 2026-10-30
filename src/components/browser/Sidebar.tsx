import clsx from 'clsx';
import {
  BookOpen,
  Bookmark,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  EyeOff,
  FlaskConical,
  FolderPlus,
  Globe,
  Heart,
  History,
  Library,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Shield,
  SquareSplitHorizontal,
  Star,
  Trash2,
  User,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useActiveWorkspace, useWorkspaceTabs } from '../../hooks.ts';
import { useBrowser } from '../../store/browser.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import type { GroupColor, Tab, TabGroup, WorkspaceIcon } from '../../lib/types.ts';
import { altKey, isInternal, modKey } from '../../lib/util.ts';
import { Button, Favicon, Field, IconButton, Input, Menu, Modal, Toggle, type MenuItem } from '../ui/index.tsx';
import { Logo } from './Logo.tsx';

export const WORKSPACE_ICONS: Record<WorkspaceIcon, LucideIcon> = {
  user: User,
  flask: FlaskConical,
  briefcase: Briefcase,
  'eye-off': EyeOff,
  code: Code2,
  book: BookOpen,
  globe: Globe,
  star: Star,
  heart: Heart,
  zap: Zap,
};

export const GROUP_COLORS: Record<GroupColor, string> = {
  slate: '#8b95a7',
  blue: '#6ea8fe',
  teal: '#4fd1c5',
  green: '#68d391',
  yellow: '#e8c468',
  red: '#f2828a',
  pink: '#f0a6ca',
};

export function Sidebar({ mobile }: { mobile?: boolean }) {
  const ws = useActiveWorkspace();
  const tabs = useWorkspaceTabs(ws.id);
  const groups = useBrowser((s) => s.groups);
  const newTab = useBrowser((s) => s.newTab);
  const closedCount = useBrowser((s) => s.closed.length);
  const reopenClosed = useBrowser((s) => s.reopenClosed);
  const updateSettings = useSettings((s) => s.update);
  const setPalette = useUi((s) => s.setPalette);
  const setMobileSidebar = useUi((s) => s.setMobileSidebar);
  const focusAddress = useUi((s) => s.focusAddress);

  const pinned = tabs.filter((t) => t.pinned);
  const wsGroups = groups.filter((g) => g.workspaceId === ws.id);
  const loose = tabs.filter((t) => !t.pinned && !t.groupId);

  const openInternal = (url: string) => {
    const st = useBrowser.getState();
    const existing = st.tabs.find((t) => t.workspaceId === ws.id && t.url.split('#')[0] === url.split('#')[0]);
    if (existing) {
      if (existing.url !== url) st.navigate(existing.id, url);
      st.activateTab(existing.id);
    } else newTab(url);
    if (mobile) setMobileSidebar(false);
  };

  return (
    <aside
      className={clsx('glass flex h-full shrink-0 flex-col rounded-xl', mobile ? 'w-[min(86vw,300px)]' : 'w-[248px]')}
      aria-label="Tabs and workspaces"
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Logo className="size-[18px]" />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Aether</span>
        <div className="flex-1" />
        <IconButton
          label={mobile ? 'Close sidebar' : 'Collapse sidebar'}
          shortcut={`${altKey}S`}
          size="sm"
          onClick={() => (mobile ? setMobileSidebar(false) : updateSettings((s) => void (s.sidebarCollapsed = true)))}
        >
          {mobile ? <X className="size-4" /> : <PanelLeftClose className="size-4" />}
        </IconButton>
      </div>

      <WorkspaceSwitcher />

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => {
            setPalette(true);
            if (mobile) setMobileSidebar(false);
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or command</span>
          <kbd>{modKey}K</kbd>
        </button>
      </div>

      {pinned.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 px-2 pb-2">
          {pinned.map((t) => (
            <PinnedTile key={t.id} tab={t} active={t.id === ws.activeTabId} onActivate={() => mobile && setMobileSidebar(false)} />
          ))}
        </div>
      )}

      <div className="mx-3 h-px bg-line" />

      <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-2" aria-label="Open tabs">
        <button
          type="button"
          onClick={() => {
            newTab();
            focusAddress();
            if (mobile) setMobileSidebar(false);
          }}
          className="mb-1 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[12.5px] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        >
          <Plus className="size-4" />
          <span className="flex-1 text-left">New tab</span>
          <kbd>{altKey}T</kbd>
        </button>

        {wsGroups.map((g) => (
          <GroupBlock key={g.id} group={g} tabs={tabs.filter((t) => t.groupId === g.id)} activeId={ws.activeTabId} mobile={mobile} />
        ))}
        <TabList tabs={loose} activeId={ws.activeTabId} mobile={mobile} />

        {closedCount > 0 && (
          <button
            type="button"
            onClick={reopenClosed}
            className="mt-1 flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[12px] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
          >
            <RotateCcw className="size-3.5" />
            Reopen closed tab
          </button>
        )}
      </nav>

      {ws.private && (
        <div className="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[11.5px] text-fg-2">
          <EyeOff className="mt-px size-3.5 shrink-0 text-accent" />
          <span>Private workspace: kept in memory only and erased when you close Aether.</span>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
        <IconButton label="Library" tooltipSide="top" onClick={() => openInternal('aether://library')}>
          <Library className="size-4" />
        </IconButton>
        <IconButton label="Bookmarks" tooltipSide="top" onClick={() => openInternal('aether://library#bookmarks')}>
          <Bookmark className="size-4" />
        </IconButton>
        <IconButton label="History" tooltipSide="top" onClick={() => openInternal('aether://history')}>
          <History className="size-4" />
        </IconButton>
        <IconButton label="Privacy center" shortcut={`${altKey}P`} tooltipSide="top" onClick={() => openInternal('aether://privacy')}>
          <Shield className="size-4" />
        </IconButton>
        <IconButton label="Settings" tooltipSide="top" onClick={() => openInternal('aether://settings')}>
          <SettingsIcon className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}

function WorkspaceSwitcher() {
  const workspaces = useBrowser((s) => s.workspaces);
  const activeId = useBrowser((s) => s.activeWorkspaceId);
  const switchWorkspace = useBrowser((s) => s.switchWorkspace);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const deleteWorkspace = useBrowser((s) => s.deleteWorkspace);
  const ask = useUi((s) => s.ask);
  const active = workspaces.find((w) => w.id === activeId);

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Workspaces">
        {workspaces.map((w) => {
          const Icon = WORKSPACE_ICONS[w.icon] ?? Globe;
          const on = w.id === activeId;
          return (
            <button
              key={w.id}
              role="tab"
              aria-selected={on}
              title={w.name}
              type="button"
              onClick={() => switchWorkspace(w.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: w.id });
              }}
              className={clsx(
                'flex h-7 flex-1 items-center justify-center rounded-md transition-colors duration-150',
                on ? 'bg-active text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2 hover:bg-hover',
              )}
            >
              <Icon className="size-[15px]" strokeWidth={on ? 2 : 1.75} />
            </button>
          );
        })}
        <button
          type="button"
          aria-label="New workspace"
          title="New workspace"
          onClick={() => setEditing('new')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg-2"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {active && (
        <button
          type="button"
          onClick={() => setEditing(active.id)}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11.5px] text-fg-3 hover:text-fg-2"
        >
          <span className="truncate font-medium text-fg-2">{active.name}</span>
          {active.private ? <span>· private</span> : active.ephemeral ? <span>· temporary</span> : null}
          <Pencil className="ml-auto size-3 opacity-60" />
        </button>
      )}
      <Menu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          { label: 'Edit workspace', icon: <Pencil />, onSelect: () => menu && setEditing(menu.id) },
          {
            label: 'Delete workspace',
            icon: <Trash2 />,
            danger: true,
            disabled: workspaces.length <= 1,
            onSelect: async () => {
              const w = workspaces.find((x) => x.id === menu?.id);
              if (!w) return;
              const ok = await ask({
                title: `Delete “${w.name}”?`,
                body: 'Its tabs, groups, history and saved sessions will be removed. Bookmarks and notes are kept.',
                confirmLabel: 'Delete workspace',
                danger: true,
              });
              if (ok) deleteWorkspace(w.id);
            },
          },
        ]}
      />
      {editing && <WorkspaceEditor id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WorkspaceEditor({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const ws = useBrowser((s) => s.workspaces.find((w) => w.id === id));
  const addWorkspace = useBrowser((s) => s.addWorkspace);
  const updateWorkspace = useBrowser((s) => s.updateWorkspace);
  const [name, setName] = useState(ws?.name ?? '');
  const [icon, setIcon] = useState<WorkspaceIcon>(ws?.icon ?? 'globe');
  const [ephemeral, setEphemeral] = useState(ws?.ephemeral ?? false);
  const [priv, setPriv] = useState(ws?.private ?? false);
  const isNew = id === 'new';

  const save = () => {
    const n = name.trim() || 'Workspace';
    if (isNew) addWorkspace(n, icon, { ephemeral: ephemeral || priv, private: priv });
    else updateWorkspace(id, { name: n, icon });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New workspace' : 'Edit workspace'}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {isNew ? 'Create workspace' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" htmlFor="ws-name">
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Side project" data-autofocus />
        </Field>
        <Field label="Icon">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(WORKSPACE_ICONS) as WorkspaceIcon[]).map((k) => {
              const Icon = WORKSPACE_ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  aria-pressed={icon === k}
                  onClick={() => setIcon(k)}
                  className={clsx(
                    'flex size-8 items-center justify-center rounded-md border transition-colors',
                    icon === k ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line text-fg-2 hover:bg-hover',
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </Field>
        {isNew ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-[12.5px]">Private workspace</span>
                <span className="block text-[11.5px] text-fg-3">Memory only, no history, isolated cookies where supported, AI asks before reading pages.</span>
              </span>
              <Toggle checked={priv} onChange={setPriv} label="Private workspace" />
            </label>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-[12.5px]">Temporary</span>
                <span className="block text-[11.5px] text-fg-3">Tabs, history and chats are never written to disk.</span>
              </span>
              <Toggle checked={ephemeral || priv} disabled={priv} onChange={setEphemeral} label="Temporary workspace" />
            </label>
          </div>
        ) : (
          <p className="text-[12px] text-fg-3">
            Browsing behavior for this workspace (default view, history, cookie isolation, AI context) is in Settings → Workspaces.
          </p>
        )}
      </form>
    </Modal>
  );
}

function useTabMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null);
  const st = useBrowser.getState;
  const groups = useBrowser((s) => s.groups);
  const toggleBookmark = useLibrary((s) => s.toggleBookmark);
  const toast = useUi((s) => s.toast);
  const items: MenuItem[] = menu
    ? (() => {
        const t = menu.tab;
        const wsGroups = groups.filter((g) => g.workspaceId === t.workspaceId && g.id !== t.groupId);
        return [
          { label: t.pinned ? 'Unpin tab' : 'Pin tab', icon: t.pinned ? <PinOff /> : <Pin />, onSelect: () => st().togglePin(t.id) },
          { label: 'Duplicate', icon: <Copy />, onSelect: () => st().duplicateTab(t.id) },
          {
            label: 'Open in split view',
            icon: <SquareSplitHorizontal />,
            onSelect: () => {
              const ws = st().workspaces.find((w) => w.id === t.workspaceId);
              if (ws?.activeTabId === t.id) return;
              st().setSplit(t.workspaceId, t.id);
            },
          },
          {
            label: 'Bookmark',
            icon: <Bookmark />,
            disabled: isInternal(t.url),
            onSelect: () => toast(toggleBookmark({ url: t.url, title: t.title, favicon: t.favicon }) ? 'Bookmarked' : 'Bookmark removed', 'ok'),
          },
          { separator: true, label: '' },
          { label: 'New group with tab', icon: <FolderPlus />, onSelect: () => st().createGroup([t.id]) },
          ...wsGroups.map((g) => ({ label: `Move to “${g.name}”`, icon: <span className="size-2 rounded-full" style={{ background: GROUP_COLORS[g.color] }} />, onSelect: () => st().setTabGroup(t.id, g.id) })),
          ...(t.groupId ? [{ label: 'Remove from group', icon: <XCircle />, onSelect: () => st().setTabGroup(t.id, null) }] : []),
          { separator: true, label: '' },
          { label: 'Close other tabs', icon: <XCircle />, onSelect: () => st().closeOtherTabs(t.id) },
          { label: 'Close tab', icon: <X />, shortcut: `${altKey}W`, onSelect: () => st().closeTab(t.id) },
        ];
      })()
    : [];
  return { menu, setMenu, items };
}

function TabList({ tabs, activeId, mobile }: { tabs: Tab[]; activeId: string | null; mobile?: boolean }) {
  const { menu, setMenu, items } = useTabMenu();
  return (
    <ul className="flex flex-col gap-px">
      {tabs.map((t) => (
        <TabRow key={t.id} tab={t} active={t.id === activeId} onMenu={(x, y) => setMenu({ x, y, tab: t })} mobile={mobile} />
      ))}
      <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />
    </ul>
  );
}

function TabRow({ tab, active, onMenu, mobile }: { tab: Tab; active: boolean; onMenu: (x: number, y: number) => void; mobile?: boolean }) {
  const activate = useBrowser((s) => s.activateTab);
  const close = useBrowser((s) => s.closeTab);
  const moveTab = useBrowser((s) => s.moveTab);
  const setTabGroup = useBrowser((s) => s.setTabGroup);
  const splitId = useBrowser((s) => s.workspaces.find((w) => w.id === tab.workspaceId)?.splitTabId);
  const setMobileSidebar = useUi((s) => s.setMobileSidebar);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('application/x-aether-tab');
    if (!id || id === tab.id) return;
    moveTab(id, tab.id);
    setTabGroup(id, tab.groupId);
  };

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-aether-tab', tab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-aether-tab')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={clsx('group relative', over && 'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded before:bg-accent')}
    >
      <div
        role="button"
        tabIndex={0}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          activate(tab.id);
          if (mobile) setMobileSidebar(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(tab.id);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) close(tab.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        }}
        className={clsx(
          'flex h-8 w-full cursor-default items-center gap-2.5 rounded-md pl-2 pr-1 text-[12.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/60',
          active ? 'bg-active text-fg shadow-[inset_0_1px_0_var(--glass-highlight)]' : 'text-fg-2 hover:bg-hover hover:text-fg',
        )}
      >
        <Favicon url={tab.url} src={tab.favicon} />
        <span className="flex-1 truncate">{tab.title}</span>
        {splitId === tab.id && <SquareSplitHorizontal className="size-3.5 text-accent" aria-label="In split view" />}
        <button
          type="button"
          aria-label={`Close ${tab.title}`}
          onClick={(e) => {
            e.stopPropagation();
            close(tab.id);
          }}
          className={clsx(
            'flex size-6 items-center justify-center rounded text-fg-3 hover:bg-active hover:text-fg',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
            mobile && 'opacity-100',
          )}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function PinnedTile({ tab, active, onActivate }: { tab: Tab; active: boolean; onActivate: () => void }) {
  const activate = useBrowser((s) => s.activateTab);
  const { menu, setMenu, items } = useTabMenu();
  return (
    <>
      <button
        type="button"
        title={tab.title}
        aria-label={`Pinned: ${tab.title}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          activate(tab.id);
          onActivate();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, tab });
        }}
        className={clsx(
          'flex h-10 items-center justify-center rounded-lg border transition-colors duration-150',
          active ? 'border-line-strong bg-active' : 'border-line bg-surface hover:bg-hover',
        )}
      >
        <Favicon url={tab.url} src={tab.favicon} />
      </button>
      <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />
    </>
  );
}

function GroupBlock({ group, tabs, activeId, mobile }: { group: TabGroup; tabs: Tab[]; activeId: string | null; mobile?: boolean }) {
  const updateGroup = useBrowser((s) => s.updateGroup);
  const ungroup = useBrowser((s) => s.ungroup);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const color = GROUP_COLORS[group.color];
  const colorItems = useMemo(
    () =>
      (Object.keys(GROUP_COLORS) as GroupColor[]).map((c) => ({
        label: c[0].toUpperCase() + c.slice(1),
        icon: <span className="size-2.5 rounded-full" style={{ background: GROUP_COLORS[c] }} />,
        onSelect: () => updateGroup(group.id, { color: c }),
      })),
    [group.id, updateGroup],
  );

  return (
    <div className="mb-1">
      <div
        className="group flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] font-medium text-fg-2 hover:bg-hover"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          aria-expanded={!group.collapsed}
          onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}
          className="flex size-5 items-center justify-center rounded text-fg-3"
        >
          {group.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <span className="size-2 rounded-full" style={{ background: color }} />
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              updateGroup(group.id, { name: name.trim() || 'Group' });
              setRenaming(false);
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                updateGroup(group.id, { name: name.trim() || 'Group' });
                setRenaming(false);
              }}
              aria-label="Group name"
              className="h-6 w-full rounded border border-line-strong bg-surface px-1.5 text-[11.5px] text-fg outline-none"
            />
          </form>
        ) : (
          <span className="flex-1 truncate" onDoubleClick={() => setRenaming(true)}>
            {group.name}
          </span>
        )}
        <span className="text-fg-3">{tabs.length}</span>
      </div>
      {!group.collapsed && (
        <div className="ml-3 border-l pl-1" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
          <TabList tabs={tabs} activeId={activeId} mobile={mobile} />
        </div>
      )}
      <Menu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          { label: 'Rename group', icon: <Pencil />, onSelect: () => setRenaming(true) },
          { separator: true, label: '' },
          ...colorItems,
          { separator: true, label: '' },
          { label: 'Ungroup tabs', icon: <XCircle />, onSelect: () => ungroup(group.id) },
          {
            label: 'Close group',
            icon: <Trash2 />,
            danger: true,
            onSelect: () => tabs.forEach((t) => useBrowser.getState().closeTab(t.id)),
          },
        ]}
      />
    </div>
  );
}
