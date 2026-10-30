import type { SearchEngine } from './types.ts';

export function uid(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export const INTERNAL_PREFIX = 'aether://';
export const NEW_TAB_URL = 'aether://newtab';

export type InternalPage = 'newtab' | 'search' | 'privacy' | 'settings' | 'history' | 'library' | 'about';

export function isInternal(url: string): boolean {
  return url.startsWith(INTERNAL_PREFIX);
}

export function parseInternal(url: string): { page: InternalPage; params: URLSearchParams; hash: string } {
  const rest = url.slice(INTERNAL_PREFIX.length);
  const [pathAndQuery, hash = ''] = rest.split('#');
  const [path, query = ''] = pathAndQuery.split('?');
  const known: InternalPage[] = ['newtab', 'search', 'privacy', 'settings', 'history', 'library', 'about'];
  const page = (known.includes(path as InternalPage) ? path : 'newtab') as InternalPage;
  return { page, params: new URLSearchParams(query), hash };
}

export const INTERNAL_TITLES: Record<InternalPage, string> = {
  newtab: 'New Tab',
  search: 'Search',
  privacy: 'Privacy Center',
  settings: 'Settings',
  history: 'History',
  library: 'Library',
  about: 'About Aether',
};

const ENGINE_URLS: Record<Exclude<SearchEngine, 'aether'>, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
  google: 'https://www.google.com/search?q=',
};

export function searchUrl(q: string, engine: SearchEngine): string {
  if (engine === 'aether') return `aether://search?q=${encodeURIComponent(q)}`;
  return ENGINE_URLS[engine] + encodeURIComponent(q);
}

/** Turn whatever the user typed in the address bar into a URL (http(s), aether://) or a search. */
export function resolveInput(raw: string, engine: SearchEngine): string {
  const input = raw.trim();
  if (!input) return NEW_TAB_URL;
  if (/^aether:\/\//i.test(input)) return input.toLowerCase().startsWith('aether://') ? input : 'aether://' + input.slice(9);
  if (/^https?:\/\//i.test(input)) {
    try {
      return new URL(input).toString();
    } catch {
      return searchUrl(input, engine);
    }
  }
  if (/\s/.test(input)) return searchUrl(input, engine);
  // Bare host, optionally with port/path: example.com, sub.example.co.uk/path, localhost:3000
  const hostLike = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i;
  if (hostLike.test(input)) {
    try {
      return new URL('https://' + input).toString();
    } catch {
      /* fall through */
    }
  }
  return searchUrl(input, engine);
}

export function hostOf(url: string): string {
  if (isInternal(url)) return 'aether';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function displayUrl(url: string): string {
  if (isInternal(url)) return url;
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return u.host.replace(/^www\./, '') + path + u.search;
  } catch {
    return url;
  }
}

export function faviconFor(url: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const o = originOf(url);
  return o && o.startsWith('http') ? `${o}/favicon.ico` : undefined;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Strip a trailing " | Site Name" / " - Site Name" that duplicates the site name. */
export function cleanTitle(title: string, siteName?: string, host?: string): string {
  const t = title.trim();
  const m = t.match(/^(.{8,}?)\s+[|·•–—-]\s+([^|·•–—-]{2,60})$/);
  if (!m) return t;
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffix = squash(m[2]);
  const names = [siteName, host?.replace(/^www\./, '').split('.')[0]].filter(Boolean).map((x) => squash(x!)).filter(Boolean);
  return names.some((n) => suffix.includes(n) || n.includes(suffix)) ? m[1].trim() : t;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'aether'
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
export const altKey = isMac ? '⌥' : 'Alt';
