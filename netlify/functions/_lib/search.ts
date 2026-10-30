// Web search providers: Brave Search API → DuckDuckGo HTML → Wikipedia.
// These are fixed public hosts, so a plain fetch with timeout is used.

import { parseHTML } from 'linkedom';
import type { SearchResult, SearchResultItem } from '../../../shared/api.ts';
import { USER_AGENT } from './env.ts';
import { collapseWhitespace, fetchWithTimeout, isRecord, stripHtml } from './http.ts';

export const MAX_RESULTS = 10;
export const MAX_QUERY_CHARS = 300;
const SEARCH_TIMEOUT_MS = 6000;

export class SearchProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

function cleanUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Brave

export function parseBraveJson(data: unknown): SearchResultItem[] {
  if (!isRecord(data) || !isRecord(data.web) || !Array.isArray(data.web.results)) return [];
  const out: SearchResultItem[] = [];
  for (const r of data.web.results) {
    if (!isRecord(r) || typeof r.url !== 'string') continue;
    const url = cleanUrl(r.url);
    if (!url) continue;
    out.push({
      title: stripHtml(typeof r.title === 'string' ? r.title : url).slice(0, 300),
      url,
      snippet: stripHtml(typeof r.description === 'string' ? r.description : '').slice(0, 500),
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export async function braveSearch(q: string, key: string): Promise<SearchResultItem[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(MAX_RESULTS));
  const res = await fetchWithTimeout(url, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    headers: { accept: 'application/json', 'x-subscription-token': key },
  });
  if (!res.ok) throw new SearchProviderError(`Brave Search returned HTTP ${res.status}`);
  return parseBraveJson(await res.json());
}

// ---------------------------------------------------------------- DuckDuckGo

/** Unwraps DuckDuckGo's `//duckduckgo.com/l/?uddg=<encoded>` redirect links. */
export function unwrapDdgHref(href: string): string | null {
  let h = href.trim();
  if (h.startsWith('//')) h = 'https:' + h;
  else if (h.startsWith('/')) h = 'https://duckduckgo.com' + h;
  let u: URL;
  try {
    u = new URL(h);
  } catch {
    return null;
  }
  if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
    if (u.pathname === '/l/' || u.pathname === '/l') {
      const target = u.searchParams.get('uddg');
      return target ? cleanUrl(target) : null;
    }
    return null; // ads (/y.js) and internal links
  }
  return cleanUrl(u.href);
}

export interface DdgParseResult {
  results: SearchResultItem[];
  challenge: boolean;
}

export function parseDdgHtml(html: string): DdgParseResult {
  const { document } = parseHTML(html) as unknown as { document: Document };
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll('.result')) {
    const cls = ` ${el.getAttribute('class') ?? ''} `;
    if (cls.includes(' result--ad ') || cls.includes(' result--ad--small ')) continue;
    const a = el.querySelector('.result__a');
    const href = a?.getAttribute('href');
    if (!a || !href) continue;
    const url = unwrapDdgHref(href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: collapseWhitespace(a.textContent ?? '').slice(0, 300) || url,
      url,
      snippet: collapseWhitespace(el.querySelector('.result__snippet')?.textContent ?? '').slice(0, 500),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  const challenge =
    !results.length &&
    (/anomaly-modal|challenge-form|bots use DuckDuckGo too|Unfortunately, bots/i.test(html) ||
      !!document.querySelector('form#challenge-form, .anomaly-modal__modal'));
  return { results, challenge };
}

export async function ddgSearch(q: string): Promise<DdgParseResult> {
  const res = await fetchWithTimeout('https://html.duckduckgo.com/html/', {
    method: 'POST',
    timeoutMs: SEARCH_TIMEOUT_MS,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({ q, b: '' }).toString(),
  });
  if (!res.ok) throw new SearchProviderError(`DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();
  return parseDdgHtml(html.slice(0, 2_000_000));
}

// ---------------------------------------------------------------- Wikipedia

export function parseWikipediaJson(data: unknown): SearchResultItem[] {
  if (!isRecord(data) || !isRecord(data.query) || !Array.isArray(data.query.search)) return [];
  const out: SearchResultItem[] = [];
  for (const r of data.query.search) {
    if (!isRecord(r) || typeof r.title !== 'string') continue;
    out.push({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: stripHtml(typeof r.snippet === 'string' ? r.snippet : '').slice(0, 500),
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export async function wikipediaSearch(q: string): Promise<SearchResultItem[]> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: q,
    format: 'json',
    srlimit: String(MAX_RESULTS),
    utf8: '1',
  }).toString();
  const res = await fetchWithTimeout(url, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new SearchProviderError(`Wikipedia returned HTTP ${res.status}`);
  return parseWikipediaJson(await res.json());
}

// ---------------------------------------------------------------- Orchestration

export interface SearchDeps {
  brave: typeof braveSearch;
  ddg: typeof ddgSearch;
  wikipedia: typeof wikipediaSearch;
}

const defaultDeps: SearchDeps = { brave: braveSearch, ddg: ddgSearch, wikipedia: wikipediaSearch };

/** Runs the provider chain. Throws SearchProviderError only if every provider failed. */
export async function runSearch(q: string, braveKey: string | undefined, deps: SearchDeps = defaultDeps): Promise<SearchResult> {
  const notices: string[] = [];
  if (braveKey) {
    try {
      const results = await deps.brave(q, braveKey);
      return { ok: true, provider: 'brave', query: q, results };
    } catch {
      notices.push('Brave Search was unavailable');
    }
  }
  let ddgFailure = 'DuckDuckGo was unavailable';
  try {
    const ddg = await deps.ddg(q);
    if (ddg.results.length) {
      return {
        ok: true,
        provider: 'duckduckgo',
        query: q,
        results: ddg.results,
        ...(notices.length ? { notice: `${notices.join('; ')}, so DuckDuckGo results are shown.` } : {}),
      };
    }
    ddgFailure = ddg.challenge ? 'DuckDuckGo asked for a bot check' : 'DuckDuckGo returned no results';
  } catch {
    // keep default message
  }
  notices.push(ddgFailure);
  try {
    const results = await deps.wikipedia(q);
    return {
      ok: true,
      provider: 'wikipedia',
      query: q,
      results,
      notice: `${notices.join('; ')}, so results from Wikipedia are shown instead.`,
    };
  } catch {
    throw new SearchProviderError('All search providers are unavailable right now.');
  }
}
