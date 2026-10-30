import { AlertTriangle, ExternalLink, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SearchResponse } from '../../../shared/api.ts';
import { search } from '../../lib/api.ts';
import type { Tab } from '../../lib/types.ts';
import { displayUrl } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { Badge, Button, Favicon } from '../ui/index.tsx';

const ENGINES = [
  { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=' },
  { label: 'Google', url: 'https://www.google.com/search?q=' },
];

export function SearchPage({ tab, query }: { tab: Tab; query: string }) {
  const [state, setState] = useState<{ q: string; res: SearchResponse | null }>({ q: '', res: null });
  const [q, setQ] = useState(query);
  const navigate = useBrowser((s) => s.navigate);
  const newTab = useBrowser((s) => s.newTab);
  const requestAi = useUi((s) => s.requestAi);

  useEffect(() => {
    setQ(query);
    if (!query) return;
    const ctrl = new AbortController();
    setState({ q: query, res: null });
    void search(query, ctrl.signal).then((res) => {
      if (!ctrl.signal.aborted) setState({ q: query, res });
    });
    return () => ctrl.abort();
  }, [query, tab.reloadKey]);

  const res = state.q === query ? state.res : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <form
        className="glass flex items-center gap-2 rounded-xl px-3 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(tab.id, `aether://search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="size-4 text-fg-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search query"
          className="h-10 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles className="size-3.5" />}
          onClick={() => {
            useSettings.getState().update((s) => void (s.aiPanelOpen = true));
            requestAi({ prompt: query, context: 'none', research: true });
          }}
        >
          Research with AI
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-3">
        <span>Also search:</span>
        {ENGINES.map((e) => (
          <button
            key={e.label}
            type="button"
            onClick={() => newTab(e.url + encodeURIComponent(query), { afterTabId: tab.id })}
            className="rounded-md px-1.5 py-0.5 text-fg-2 hover:bg-hover hover:text-fg"
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-1">
        {!res &&
          query &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 px-3 py-3">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-full" />
            </div>
          ))}
        {res && !res.ok && (
          <div className="glass flex items-start gap-3 rounded-xl p-4 text-[12.5px]">
            <AlertTriangle className="mt-0.5 size-4 text-warn" />
            <div>
              <p className="font-medium">Search failed</p>
              <p className="mt-0.5 text-fg-2">{res.error.message}</p>
            </div>
          </div>
        )}
        {res?.ok && (
          <>
            <div className="mb-1 flex items-center gap-2 px-3 text-[11.5px] text-fg-3">
              <span>
                {res.results.length} results via <Badge>{res.provider}</Badge>, fetched by Aether’s server (your IP isn’t shared with the engine)
              </span>
            </div>
            {res.notice && <p className="px-3 pb-2 text-[11.5px] text-warn">{res.notice}</p>}
            {res.results.length === 0 && <p className="px-3 py-6 text-[13px] text-fg-2">No results.</p>}
            {res.results.map((r) => (
              <article key={r.url} className="group rounded-xl px-3 py-3 transition-colors hover:bg-hover">
                <div className="flex items-center gap-2 text-[11.5px] text-fg-3">
                  <Favicon url={r.url} className="size-3.5" />
                  <span className="truncate">{displayUrl(r.url)}</span>
                  <button
                    type="button"
                    aria-label="Open in new Aether tab"
                    onClick={() => newTab(r.url, { activate: false, afterTabId: tab.id })}
                    className="ml-auto rounded p-0.5 opacity-0 hover:bg-active group-hover:opacity-100"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                </div>
                <a
                  href={r.url}
                  onClick={(e) => {
                    e.preventDefault();
                    if (e.metaKey || e.ctrlKey) newTab(r.url, { activate: false, afterTabId: tab.id });
                    else navigate(tab.id, r.url);
                  }}
                  className="mt-1 block text-[15px] font-medium text-accent hover:underline"
                >
                  {r.title}
                </a>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{r.snippet}</p>
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
