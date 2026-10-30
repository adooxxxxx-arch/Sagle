import type { PageResult } from '../../../shared/api.ts';
import { search } from '../api.ts';
import type { ContextMode, Tab } from '../types.ts';
import { isInternal, truncate } from '../util.ts';
import { usePages } from '../../store/pages.ts';
import { useUi } from '../../store/ui.ts';
import type { ContextSource } from './prompts.ts';

const TOTAL_BUDGET = 60_000;

async function pageFor(url: string): Promise<PageResult | null> {
  const st = await usePages.getState().ensure(url);
  return st.status === 'ready' ? st.data : null;
}

function budgeted(sources: ContextSource[]): ContextSource[] {
  if (!sources.length) return sources;
  const per = Math.max(2_000, Math.floor(TOTAL_BUDGET / sources.length));
  return sources.map((s) => ({ ...s, text: truncate(s.text, per) }));
}

export interface BuiltContext {
  sources: ContextSource[];
  extra?: string;
  label: string;
  warnings: string[];
}

export async function buildContext(
  mode: ContextMode,
  opts: { activeTab: Tab | null; selectedTabs: Tab[]; workspaceTabs: Tab[] },
): Promise<BuiltContext> {
  const warnings: string[] = [];
  if (mode === 'none') return { sources: [], label: 'No browsing context', warnings };

  if (mode === 'selection') {
    const sel = useUi.getState().selection;
    if (!sel?.text) {
      warnings.push('No text is selected. Select text in Reader view first.');
      return { sources: [], label: 'Selection (empty)', warnings };
    }
    return {
      sources: [{ n: 1, title: 'Selected text', url: sel.url, text: sel.text }],
      label: `Selected text (${sel.text.length} chars)`,
      warnings,
    };
  }

  const tabs =
    mode === 'page' ? (opts.activeTab ? [opts.activeTab] : []) : mode === 'tabs' ? opts.selectedTabs : opts.workspaceTabs;
  const web = tabs.filter((t) => !isInternal(t.url));
  if (!web.length) {
    warnings.push(mode === 'page' ? 'The current tab is not a web page.' : 'No web pages to share.');
    return { sources: [], label: 'No pages', warnings };
  }

  // Workspace mode with many tabs: full text of up to 8, titles for the rest.
  const full = mode === 'workspace' ? web.slice(0, 8) : web.slice(0, 10);
  const results = await Promise.all(full.map((t) => pageFor(t.url)));
  const sources: ContextSource[] = [];
  full.forEach((t, i) => {
    const page = results[i];
    if (page?.reader.available && page.reader.text) {
      sources.push({ n: sources.length + 1, title: page.meta.title || t.title, url: page.finalUrl, text: page.reader.text });
    } else {
      warnings.push(`Couldn’t read “${truncate(t.title, 40)}” — ${page ? 'no readable text' : 'fetch failed or server analysis is off'}.`);
    }
  });
  let extra: string | undefined;
  if (mode === 'workspace' && web.length > full.length) {
    extra = 'Other open tabs (titles only):\n' + web.slice(full.length).map((t) => `- ${t.title} — ${t.url}`).join('\n');
  }
  const label =
    mode === 'page'
      ? `Current page`
      : mode === 'tabs'
        ? `${sources.length} selected tab${sources.length === 1 ? '' : 's'}`
        : `Workspace (${web.length} tabs)`;
  return { sources: budgeted(sources), extra, label, warnings };
}

export async function researchContext(
  query: string,
  count: number,
  onProgress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<BuiltContext> {
  onProgress('Searching the web…');
  const res = await search(query, signal);
  if (!res.ok) throw new Error(res.error.message);
  const picks = res.results.slice(0, count);
  if (!picks.length) return { sources: [], label: 'Web research (no results)', warnings: ['Search returned no results.'] };
  let done = 0;
  onProgress(`Reading ${picks.length} sources…`);
  const pages = await Promise.all(
    picks.map(async (r) => {
      const p = await pageFor(r.url);
      done++;
      onProgress(`Read ${done}/${picks.length} sources…`);
      return p;
    }),
  );
  const warnings: string[] = [];
  const sources: ContextSource[] = picks.map((r, i) => {
    const p = pages[i];
    if (p?.reader.available && p.reader.text) {
      return { n: i + 1, title: p.meta.title || r.title, url: p.finalUrl, text: p.reader.text };
    }
    warnings.push(`Only the search snippet was available for “${truncate(r.title, 40)}”.`);
    return { n: i + 1, title: r.title, url: r.url, text: r.snippet, note: 'Search snippet only; full page could not be fetched.' };
  });
  return {
    sources: budgeted(sources),
    label: `Web research · ${res.provider} · ${sources.length} sources`,
    warnings,
    extra: res.notice ? `Search note: ${res.notice}` : undefined,
  };
}
