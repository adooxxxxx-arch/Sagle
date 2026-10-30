import { History as HistoryIcon, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useActiveWorkspace } from '../../hooks.ts';
import type { Tab } from '../../lib/types.ts';
import { dayLabel, displayUrl } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useUi } from '../../store/ui.ts';
import { Button, EmptyState, Favicon, IconButton, Input, Segmented } from '../ui/index.tsx';

export function HistoryPage({ tab }: { tab: Tab }) {
  const ws = useActiveWorkspace();
  const history = useBrowser((s) => s.history);
  const workspaces = useBrowser((s) => s.workspaces);
  const navigate = useBrowser((s) => s.navigate);
  const deleteHistory = useBrowser((s) => s.deleteHistory);
  const clearHistory = useBrowser((s) => s.clearHistory);
  const ask = useUi((s) => s.ask);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'workspace' | 'all'>('workspace');

  const groups = useMemo(() => {
    const lower = q.toLowerCase();
    const items = history.filter(
      (h) => (scope === 'all' || h.workspaceId === ws.id) && (!q || h.title.toLowerCase().includes(lower) || h.url.toLowerCase().includes(lower)),
    );
    const out: { day: string; items: typeof items }[] = [];
    for (const h of items.slice(0, 1000)) {
      const day = dayLabel(h.visitedAt);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(h);
    }
    return out;
  }, [history, q, scope, ws.id]);

  const clear = async (sinceMs: number | null, label: string) => {
    const ok = await ask({ title: `Clear ${label}?`, body: 'This can’t be undone.', confirmLabel: 'Clear', danger: true });
    if (ok) clearHistory({ workspaceId: scope === 'workspace' ? ws.id : undefined, since: sinceMs ? Date.now() - sinceMs : undefined });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[20px] font-semibold tracking-[-0.02em]">History</h1>
        <Segmented
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'workspace', label: ws.name },
            { value: 'all', label: 'All workspaces' },
          ]}
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history" aria-label="Search history" className="pl-8" />
        </div>
        <Button variant="ghost" onClick={() => clear(3_600_000, 'the last hour')}>
          Last hour
        </Button>
        <Button variant="ghost" onClick={() => clear(86_400_000, 'the last 24 hours')}>
          Last day
        </Button>
        <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => clear(null, 'all history')}>
          Clear all
        </Button>
      </div>
      {ws.private && scope === 'workspace' && <p className="mb-3 text-[12px] text-fg-3">Private workspaces never record history.</p>}
      {groups.length === 0 ? (
        <EmptyState icon={<HistoryIcon />} title={q ? 'No matches' : 'No history yet'} body={q ? undefined : 'Pages you visit appear here. History stays on this device.'} />
      ) : (
        groups.map((g) => (
          <section key={g.day} className="mb-4">
            <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{g.day}</h2>
            <ul className="glass rounded-xl p-1">
              {g.items.map((h) => (
                <li key={h.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                  <span className="w-12 shrink-0 text-[11px] tabular-nums text-fg-3">
                    {new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Favicon url={h.url} />
                  <button type="button" onClick={() => navigate(tab.id, h.url)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[12.5px]">{h.title}</span>
                    <span className="block truncate text-[11px] text-fg-3">
                      {displayUrl(h.url)}
                      {scope === 'all' && ` · ${workspaces.find((w) => w.id === h.workspaceId)?.name ?? ''}`}
                    </span>
                  </button>
                  <IconButton label="Delete from history" size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => deleteHistory([h.id])}>
                    <X className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
