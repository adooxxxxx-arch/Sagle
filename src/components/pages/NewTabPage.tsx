import { ArrowRight, BookOpenText, EyeOff, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useActiveWorkspace } from '../../hooks.ts';
import { useBrowser } from '../../store/browser.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import type { Tab } from '../../lib/types.ts';
import { displayUrl, resolveInput, timeAgo, truncate } from '../../lib/util.ts';
import { Favicon } from '../ui/index.tsx';
import { Logo } from '../browser/Logo.tsx';

export function NewTabPage({ tab }: { tab: Tab }) {
  const ws = useActiveWorkspace();
  const engine = useSettings((s) => s.settings.searchEngine);
  const navigate = useBrowser((s) => s.navigate);
  const history = useBrowser((s) => s.history);
  const bookmarks = useLibrary((s) => s.bookmarks);
  const reading = useLibrary((s) => s.reading);
  const requestAi = useUi((s) => s.requestAi);
  const [q, setQ] = useState('');

  const recent: { url: string; title: string; visitedAt: number }[] = [];
  const seen = new Set<string>();
  for (const h of history) {
    if (h.workspaceId !== ws.id || seen.has(h.url)) continue;
    seen.add(h.url);
    recent.push(h);
    if (recent.length >= 6) break;
  }
  const unread = reading.filter((r) => !r.read).slice(0, 3);

  const askAi = () => {
    if (!q.trim()) return;
    useSettings.getState().update((s) => void (s.aiPanelOpen = true));
    requestAi({ prompt: q.trim(), context: 'none', research: true });
    setQ('');
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center px-5 pt-[12vh] pb-12">
      <div className="mb-7 flex items-center gap-2.5 anim-rise">
        <Logo className="size-7" />
        <span className="text-[22px] font-semibold tracking-[-0.025em]">Aether</span>
        {ws.private && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg-2">
            <EyeOff className="size-3" /> Private
          </span>
        )}
      </div>

      <form
        className="glass w-full rounded-xl p-1.5 anim-rise"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(tab.id, resolveInput(q, engine));
        }}
      >
        <div className="flex items-center gap-2 px-2">
          <Search className="size-4 shrink-0 text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the web or enter an address"
            aria-label="Search or enter address"
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
          />
          <button
            type="button"
            onClick={askAi}
            disabled={!q.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
            title="Research this with AI, with cited sources"
          >
            <Sparkles className="size-3.5" /> <span className="hidden sm:inline">Research</span>
          </button>
          <button
            type="submit"
            disabled={!q.trim()}
            aria-label="Go"
            className="inline-flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg transition disabled:opacity-40"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
      </form>
      <p className="mt-2.5 text-[11.5px] text-fg-3">
        {ws.private
          ? 'Nothing in this workspace is written to disk. AI won’t read pages without asking.'
          : 'Your data stays in this browser. No account, no telemetry.'}
      </p>

      {bookmarks.length > 0 && (
        <div className="mt-10 grid w-full grid-cols-4 gap-2 sm:grid-cols-6">
          {bookmarks.slice(0, 12).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => navigate(tab.id, b.url)}
              className="glass flex flex-col items-center gap-2 rounded-xl px-2 py-3 transition-colors hover:bg-hover"
              title={b.title}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2">
                <Favicon url={b.url} src={b.favicon} className="size-5" />
              </span>
              <span className="w-full truncate text-center text-[11.5px] text-fg-2">{b.title}</span>
            </button>
          ))}
        </div>
      )}

      {(recent.length > 0 || unread.length > 0) && (
        <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
          {recent.length > 0 && (
            <div className="glass rounded-xl p-3">
              <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Recent</h3>
              {recent.map((h) => (
                <button
                  key={h.url}
                  type="button"
                  onClick={() => navigate(tab.id, h.url)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
                >
                  <Favicon url={h.url} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{h.title}</span>
                  <span className="text-[11px] text-fg-3">{timeAgo(h.visitedAt)}</span>
                </button>
              ))}
            </div>
          )}
          {unread.length > 0 && (
            <div className="glass rounded-xl p-3">
              <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                <BookOpenText className="size-3" /> Reading list
              </h3>
              {unread.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(tab.id, r.url)}
                  className="flex w-full flex-col rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
                >
                  <span className="truncate text-[12.5px]">{r.title}</span>
                  <span className="truncate text-[11.5px] text-fg-3">{truncate(r.excerpt || displayUrl(r.url), 90)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
