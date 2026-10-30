import clsx from 'clsx';
import {
  ArrowLeft,
  BookOpenText,
  Bookmark,
  Check,
  Download,
  Eye,
  FolderOpen,
  Highlighter,
  Layers,
  NotebookPen,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadFile } from '../../lib/download.ts';
import type { Tab } from '../../lib/types.ts';
import { displayUrl, formatBytes, slugify, timeAgo, truncate } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { Button, EmptyState, Favicon, IconButton, Input } from '../ui/index.tsx';

type Section = 'reading' | 'bookmarks' | 'notes' | 'collections' | 'highlights' | 'sessions' | 'downloads';

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'reading', label: 'Reading list', icon: <BookOpenText /> },
  { id: 'bookmarks', label: 'Bookmarks', icon: <Bookmark /> },
  { id: 'notes', label: 'Notes', icon: <NotebookPen /> },
  { id: 'collections', label: 'Collections', icon: <Layers /> },
  { id: 'highlights', label: 'Highlights', icon: <Highlighter /> },
  { id: 'sessions', label: 'Sessions', icon: <FolderOpen /> },
  { id: 'downloads', label: 'Downloads', icon: <Download /> },
];

export function LibraryPage({ tab, hash }: { tab: Tab; hash: string }) {
  const [sectionRaw, sub] = hash.split('/');
  const section = (SECTIONS.some((s) => s.id === sectionRaw) ? sectionRaw : 'reading') as Section;
  const navigate = useBrowser((s) => s.navigate);
  const go = (h: string) => navigate(tab.id, `aether://library#${h}`);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-[20px] font-semibold tracking-[-0.02em]">Library</h1>
      <div className="scroll-thin mb-5 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => go(s.id)}
            className={clsx(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors [&>svg]:size-3.5',
              section === s.id ? 'bg-active text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>
      {section === 'reading' && <ReadingList tab={tab} />}
      {section === 'bookmarks' && <Bookmarks tab={tab} />}
      {section === 'notes' && <Notes tab={tab} noteId={sub} go={go} />}
      {section === 'collections' && <Collections tab={tab} collectionId={sub} go={go} />}
      {section === 'highlights' && <Highlights tab={tab} />}
      {section === 'sessions' && <Sessions />}
      {section === 'downloads' && <Downloads />}
    </div>
  );
}

function ItemRow({ url, title, sub, onOpen, actions }: { url: string; title: string; sub?: ReactNode; onOpen: () => void; actions?: ReactNode }) {
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover">
      <Favicon url={url} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px]">{title}</span>
        {sub && <span className="block truncate text-[11.5px] text-fg-3">{sub}</span>}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">{actions}</div>
    </li>
  );
}

function ReadingList({ tab }: { tab: Tab }) {
  const reading = useLibrary((s) => s.reading);
  const setRead = useLibrary((s) => s.setRead);
  const remove = useLibrary((s) => s.removeReading);
  const navigate = useBrowser((s) => s.navigate);
  const [offline, setOffline] = useState<string | null>(null);
  const item = reading.find((r) => r.id === offline);
  if (item) {
    return (
      <div className="glass rounded-xl px-5 py-6 sm:px-8">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => setOffline(null)}>
          Back
        </Button>
        <article className="reader mt-4" data-font={useSettings.getState().settings.readerFont}>
          <p className="font-sans text-[12px] text-fg-3">Offline copy · saved {timeAgo(item.savedAt)} · {displayUrl(item.url)}</p>
          <h1 className="!mt-2">{item.title}</h1>
          {item.text.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </article>
      </div>
    );
  }
  if (!reading.length) return <EmptyState icon={<BookOpenText />} title="Your reading list is empty" body="Save pages from the ⋯ menu. Aether keeps an offline copy of the text." />;
  return (
    <ul className="glass flex flex-col rounded-xl p-1">
      {reading.map((r) => (
        <ItemRow
          key={r.id}
          url={r.url}
          title={r.title}
          sub={<span className={clsx(r.read && 'line-through')}>{truncate(r.excerpt || displayUrl(r.url), 120)}</span>}
          onOpen={() => {
            setRead(r.id, true);
            navigate(tab.id, r.url);
          }}
          actions={
            <>
              {r.text && (
                <IconButton label="Read offline copy" size="sm" onClick={() => setOffline(r.id)}>
                  <Eye className="size-3.5" />
                </IconButton>
              )}
              <IconButton label={r.read ? 'Mark unread' : 'Mark read'} size="sm" onClick={() => setRead(r.id, !r.read)}>
                <Check className="size-3.5" />
              </IconButton>
              <IconButton label="Remove" size="sm" onClick={() => remove(r.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </>
          }
        />
      ))}
    </ul>
  );
}

function Bookmarks({ tab }: { tab: Tab }) {
  const bookmarks = useLibrary((s) => s.bookmarks);
  const remove = useLibrary((s) => s.removeBookmark);
  const updateBookmark = useLibrary((s) => s.updateBookmark);
  const navigate = useBrowser((s) => s.navigate);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const shown = bookmarks.filter((b) => !q || (b.title + b.url).toLowerCase().includes(q.toLowerCase()));
  if (!bookmarks.length) return <EmptyState icon={<Bookmark />} title="No bookmarks yet" body="Bookmark a page with the star in the toolbar." />;
  return (
    <>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter bookmarks" aria-label="Filter bookmarks" className="mb-3 max-w-sm" />
      <ul className="glass flex flex-col rounded-xl p-1">
        {shown.map((b) =>
          editing === b.id ? (
            <li key={b.id} className="flex gap-2 p-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Bookmark title" autoFocus />
              <Button
                onClick={() => {
                  updateBookmark(b.id, { title: title.trim() || b.title });
                  setEditing(null);
                }}
              >
                Save
              </Button>
            </li>
          ) : (
            <ItemRow
              key={b.id}
              url={b.url}
              title={b.title}
              sub={displayUrl(b.url)}
              onOpen={() => navigate(tab.id, b.url)}
              actions={
                <>
                  <IconButton
                    label="Rename"
                    size="sm"
                    onClick={() => {
                      setEditing(b.id);
                      setTitle(b.title);
                    }}
                  >
                    <PenLine className="size-3.5" />
                  </IconButton>
                  <IconButton label="Delete bookmark" size="sm" onClick={() => remove(b.id)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </>
              }
            />
          ),
        )}
      </ul>
    </>
  );
}

function Notes({ tab, noteId, go }: { tab: Tab; noteId?: string; go: (h: string) => void }) {
  const notes = useLibrary((s) => s.notes);
  const createNote = useLibrary((s) => s.createNote);
  const updateNote = useLibrary((s) => s.updateNote);
  const removeNote = useLibrary((s) => s.removeNote);
  const requestAi = useUi((s) => s.requestAi);
  const ask = useUi((s) => s.ask);
  const [preview, setPreview] = useState(false);
  const note = notes.find((n) => n.id === noteId) ?? null;

  const list = (
    <div className="flex flex-col gap-1">
      <Button
        variant="primary"
        icon={<Plus className="size-3.5" />}
        onClick={() => go(`notes/${createNote({ workspaceId: tab.workspaceId })}`)}
        className="mb-2"
      >
        New note
      </Button>
      {notes.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => go(`notes/${n.id}`)}
          className={clsx('rounded-lg px-2.5 py-2 text-left', n.id === note?.id ? 'bg-active' : 'hover:bg-hover')}
        >
          <span className="block truncate text-[12.5px] font-medium">{n.title || 'Untitled'}</span>
          <span className="block truncate text-[11px] text-fg-3">
            {timeAgo(n.updatedAt)} · {truncate(n.body.replace(/[#>*_`[\]()]/g, ''), 50) || 'Empty'}
          </span>
        </button>
      ))}
    </div>
  );

  if (!note) {
    return (
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        {list}
        <EmptyState icon={<NotebookPen />} title={notes.length ? 'Select a note' : 'No notes yet'} body="Notes are Markdown, stay on this device, and can be exported anytime." />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <div className="hidden md:block">{list}</div>
      <div className="glass flex min-h-[60vh] flex-col rounded-xl">
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <IconButton label="All notes" size="sm" className="md:hidden" onClick={() => go('notes')}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <input
            value={note.title}
            onChange={(e) => updateNote(note.id, { title: e.target.value })}
            aria-label="Note title"
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
          />
          <IconButton label={preview ? 'Edit' : 'Preview'} size="sm" active={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? <PenLine className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
          <IconButton
            label="Organize with AI"
            size="sm"
            onClick={() => {
              useSettings.getState().update((s) => void (s.aiPanelOpen = true));
              requestAi({
                prompt: `Reorganize these notes into clear sections with headings and bullets. Keep every fact and link.\n\n---\n${note.body}`,
                context: 'none',
              });
            }}
          >
            <Sparkles className="size-4" />
          </IconButton>
          <IconButton label="Export as Markdown" size="sm" onClick={() => downloadFile(`${slugify(note.title)}.md`, `# ${note.title}\n\n${note.body}\n`, 'text/markdown')}>
            <Save className="size-4" />
          </IconButton>
          <IconButton
            label="Delete note"
            size="sm"
            onClick={async () => {
              if (await ask({ title: 'Delete this note?', body: note.title, confirmLabel: 'Delete note', danger: true })) {
                removeNote(note.id);
                go('notes');
              }
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
        {preview ? (
          <div className="md scroll-thin flex-1 overflow-y-auto px-5 py-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body || '*Empty note*'}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={note.body}
            onChange={(e) => updateNote(note.id, { body: e.target.value })}
            aria-label="Note body (Markdown)"
            placeholder="Write in Markdown…"
            className="scroll-thin min-h-[50vh] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed outline-none placeholder:text-fg-3"
          />
        )}
      </div>
    </div>
  );
}

function Collections({ tab, collectionId, go }: { tab: Tab; collectionId?: string; go: (h: string) => void }) {
  const collections = useLibrary((s) => s.collections);
  const create = useLibrary((s) => s.createCollection);
  const rename = useLibrary((s) => s.renameCollection);
  const remove = useLibrary((s) => s.removeCollection);
  const removeItem = useLibrary((s) => s.removeFromCollection);
  const navigate = useBrowser((s) => s.navigate);
  const newTab = useBrowser((s) => s.newTab);
  const requestAi = useUi((s) => s.requestAi);
  const ask = useUi((s) => s.ask);
  const [name, setName] = useState('');
  const c = collections.find((x) => x.id === collectionId);

  if (c) {
    const exportMd = () => {
      const md = `# ${c.name}\n\n${c.items.map((i) => `- [${i.title}](${i.url})${i.excerpt ? `\n  ${i.excerpt}` : ''}${i.note ? `\n  > ${i.note}` : ''}`).join('\n')}\n`;
      downloadFile(`${slugify(c.name)}.md`, md, 'text/markdown');
    };
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <IconButton label="All collections" onClick={() => go('collections')}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <input
            value={c.name}
            onChange={(e) => rename(c.id, e.target.value)}
            aria-label="Collection name"
            className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none"
          />
          <Button
            size="sm"
            icon={<Sparkles className="size-3.5" />}
            disabled={!c.items.length}
            onClick={() => {
              useSettings.getState().update((s) => void (s.aiPanelOpen = true));
              requestAi({
                prompt: 'Synthesize these research sources: the main findings, where they agree and disagree, and open questions. Cite every claim.',
                context: 'none',
                collectionId: c.id,
              });
            }}
          >
            Synthesize with AI
          </Button>
          <Button size="sm" variant="ghost" disabled={!c.items.length} onClick={() => c.items.forEach((i) => newTab(i.url, { activate: false }))}>
            Open all
          </Button>
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={exportMd}>
            Export
          </Button>
          <IconButton
            label="Delete collection"
            onClick={async () => {
              if (await ask({ title: `Delete “${c.name}”?`, body: 'Its saved items are removed too.', confirmLabel: 'Delete collection', danger: true })) {
                remove(c.id);
                go('collections');
              }
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
        {c.items.length === 0 ? (
          <EmptyState icon={<Layers />} title="Empty collection" body="Add pages from the ⋯ menu in the toolbar." />
        ) : (
          <ul className="glass flex flex-col rounded-xl p-1">
            {c.items.map((i) => (
              <ItemRow
                key={i.id}
                url={i.url}
                title={i.title}
                sub={truncate(i.excerpt || displayUrl(i.url), 140)}
                onOpen={() => navigate(tab.id, i.url)}
                actions={
                  <IconButton label="Remove from collection" size="sm" onClick={() => removeItem(c.id, i.id)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                }
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            go(`collections/${create(name.trim())}`);
            setName('');
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New research collection" aria-label="New collection name" />
        <Button type="submit" icon={<Plus className="size-3.5" />} disabled={!name.trim()}>
          Create
        </Button>
      </form>
      {collections.length === 0 ? (
        <EmptyState icon={<Layers />} title="No collections yet" body="Group sources for a research project, then have the AI synthesize them with citations." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((x) => (
            <button key={x.id} type="button" onClick={() => go(`collections/${x.id}`)} className="glass rounded-xl p-3 text-left transition-colors hover:bg-hover">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <Layers className="size-4 text-fg-3" />
                <span className="truncate">{x.name}</span>
              </div>
              <p className="mt-1 text-[11.5px] text-fg-3">
                {x.items.length} items · updated {timeAgo(x.updatedAt)}
              </p>
              <div className="mt-2 flex -space-x-1">
                {x.items.slice(0, 6).map((i) => (
                  <span key={i.id} className="rounded-full border border-line bg-surface-2 p-0.5">
                    <Favicon url={i.url} className="size-3.5" />
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Highlights({ tab }: { tab: Tab }) {
  const highlights = useLibrary((s) => s.highlights);
  const remove = useLibrary((s) => s.removeHighlight);
  const navigate = useBrowser((s) => s.navigate);
  const byUrl = useMemo(() => {
    const m = new Map<string, typeof highlights>();
    for (const h of highlights) m.set(h.url, [...(m.get(h.url) ?? []), h]);
    return [...m.entries()];
  }, [highlights]);
  if (!highlights.length) return <EmptyState icon={<Highlighter />} title="No highlights yet" body="Select text in Reader view and choose Highlight." />;
  const exportAll = () => {
    const md = byUrl.map(([url, hs]) => `## ${displayUrl(url)}\n${url}\n\n${hs.map((h) => `> ${h.quote}`).join('\n\n')}`).join('\n\n');
    downloadFile('aether-highlights.md', `# Highlights\n\n${md}\n`, 'text/markdown');
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={exportAll}>
          Export all as Markdown
        </Button>
      </div>
      {byUrl.map(([url, hs]) => (
        <div key={url} className="glass rounded-xl p-3">
          <button type="button" onClick={() => navigate(tab.id, url)} className="mb-2 flex items-center gap-2 text-[12.5px] font-medium hover:text-accent">
            <Favicon url={url} /> {displayUrl(url)}
          </button>
          {hs.map((h) => (
            <div key={h.id} className="group flex items-start gap-2 border-t border-line py-2">
              <blockquote className="flex-1 border-l-2 border-warn/60 pl-3 text-[12.5px] leading-relaxed text-fg-2">{h.quote}</blockquote>
              <IconButton label="Delete highlight" size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove(h.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Sessions() {
  const sessions = useBrowser((s) => s.sessions);
  const workspaces = useBrowser((s) => s.workspaces);
  const save = useBrowser((s) => s.saveSession);
  const restore = useBrowser((s) => s.restoreSession);
  const remove = useBrowser((s) => s.deleteSession);
  const active = useBrowser((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState('');
  return (
    <div>
      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(name.trim() || `${active?.name} · ${new Date().toLocaleString()}`);
          setName('');
          toast(active?.ephemeral ? 'Saved (kept in memory: this workspace is temporary)' : 'Session saved', 'ok');
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Save open tabs in ${active?.name}`} aria-label="Session name" />
        <Button type="submit" icon={<Save className="size-3.5" />}>
          Save session
        </Button>
      </form>
      {sessions.length === 0 ? (
        <EmptyState icon={<FolderOpen />} title="No saved sessions" body="Save the open tabs of a workspace and restore them later." />
      ) : (
        <ul className="glass flex flex-col rounded-xl p-1">
          {sessions.map((s) => (
            <li key={s.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover">
              <FolderOpen className="size-4 text-fg-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{s.name}</div>
                <div className="truncate text-[11.5px] text-fg-3">
                  {s.tabs.length} tabs · {workspaces.find((w) => w.id === s.workspaceId)?.name ?? 'deleted workspace'} · {timeAgo(s.createdAt)}
                </div>
              </div>
              <Button size="sm" onClick={() => restore(s.id)}>
                Restore
              </Button>
              <IconButton label="Delete session" size="sm" onClick={() => remove(s.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Downloads() {
  const downloads = useLibrary((s) => s.downloads);
  const clear = useLibrary((s) => s.clearDownloads);
  return (
    <div>
      <p className="mb-3 text-[12px] text-fg-3">
        Files Aether created (page exports, notes, backups). Files downloaded from inside Live view are handled by your browser’s own
        downloads.
      </p>
      {downloads.length === 0 ? (
        <EmptyState icon={<Download />} title="No downloads yet" />
      ) : (
        <>
          <ul className="glass flex flex-col rounded-xl p-1">
            {downloads.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <Download className="size-4 text-fg-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{d.filename}</div>
                  <div className="truncate text-[11.5px] text-fg-3">
                    {formatBytes(d.size)} · {timeAgo(d.createdAt)}
                    {d.sourceUrl && ` · ${displayUrl(d.sourceUrl)}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={clear}>
            Clear list
          </Button>
        </>
      )}
    </div>
  );
}
