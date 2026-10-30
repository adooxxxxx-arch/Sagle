// HTML → reader content, metadata and privacy report.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { PageMeta, PagePrivacyReport, ReaderContent, TrackerHit } from '../../../shared/api.ts';
import { isThirdParty } from './domains.ts';
import { matchTracker } from './trackers.ts';

export const MAX_TEXT_CHARS = 200_000;
const MAX_HTML_CHARS = 1_500_000;

type Doc = Document;

function parseDoc(html: string): Doc {
  return (parseHTML(html) as unknown as { document: Doc }).document;
}

// ---------------------------------------------------------------------------
// Charset decoding

export function sniffCharset(bytes: Uint8Array, contentType: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1];
  return (meta ?? 'utf-8').toLowerCase();
}

export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const label = sniffCharset(bytes, contentType);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// URL helpers

function absolutize(value: string | null, base: string): string | null {
  if (value === null) return null;
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v, base).href;
  } catch {
    return null;
  }
}

function absolutizeSrcset(srcset: string, base: string): string {
  return srcset
    .split(/,\s+/)
    .map((candidate) => {
      const [url, ...desc] = candidate.trim().split(/\s+/);
      if (!url || url.startsWith('data:')) return candidate.trim();
      const abs = absolutize(url, base);
      return abs ? [abs, ...desc].join(' ') : '';
    })
    .filter(Boolean)
    .join(', ');
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function firstSrcsetUrl(srcset: string | null): string | null {
  if (!srcset) return null;
  return srcset.trim().split(/\s+/)[0] ?? null;
}

const URL_ATTRS: Array<[string, string]> = [
  ['a', 'href'], ['area', 'href'], ['img', 'src'], ['img', 'data-src'], ['img', 'data-lazy-src'], ['img', 'data-original'],
  ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'], ['iframe', 'src'],
  ['frame', 'src'], ['embed', 'src'], ['object', 'data'], ['script', 'src'], ['link', 'href'], ['blockquote', 'cite'],
  ['q', 'cite'], ['ins', 'cite'], ['del', 'cite'], ['form', 'action'],
];

export function absolutizeDocument(doc: Doc, base: string): void {
  for (const [tag, attr] of URL_ATTRS) {
    for (const el of doc.querySelectorAll(`${tag}[${attr}]`)) {
      const raw = el.getAttribute(attr);
      if (raw === null || /^\s*(data:|javascript:|mailto:|tel:|#)/i.test(raw)) continue;
      const abs = absolutize(raw, base);
      if (abs) el.setAttribute(attr, abs);
    }
  }
  for (const attr of ['srcset', 'data-srcset']) {
    for (const el of doc.querySelectorAll(`img[${attr}], source[${attr}]`)) {
      el.setAttribute(attr, absolutizeSrcset(el.getAttribute(attr) ?? '', base));
    }
  }
}

/** Resolves the document base URL, honouring a valid http(s) <base href>. */
export function documentBase(doc: Doc, finalUrl: string): string {
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) {
    const abs = absolutize(baseHref, finalUrl);
    if (abs && /^https?:/i.test(abs)) return abs;
  }
  return finalUrl;
}

// ---------------------------------------------------------------------------
// Privacy report (computed on the original document, before stripping)

const RESOURCE_LINK_RELS = new Set([
  'stylesheet', 'preload', 'prefetch', 'preconnect', 'dns-prefetch', 'modulepreload', 'icon', 'shortcut', 'apple-touch-icon', 'manifest', 'prerender',
]);

const RESOURCE_SELECTORS: Array<[selector: string, attr: string, kind: string]> = [
  ['script[src]', 'src', 'script'],
  ['iframe[src]', 'src', 'iframe'],
  ['frame[src]', 'src', 'iframe'],
  ['img[src]', 'src', 'img'],
  ['img[srcset]', 'srcset', 'img'],
  ['link[href]', 'href', 'link'],
  ['source[src]', 'src', 'source'],
  ['source[srcset]', 'srcset', 'source'],
  ['video[src]', 'src', 'video'],
  ['video[poster]', 'poster', 'video'],
  ['audio[src]', 'src', 'audio'],
  ['embed[src]', 'src', 'embed'],
  ['object[data]', 'data', 'object'],
];

const INLINE_HOST_RE = /(?:https?:)?\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/gi;

export function computePrivacy(doc: Doc, pageHost: string): Omit<PagePrivacyReport, 'cookiesReceived' | 'cookiesSent'> {
  const scriptsStripped = doc.querySelectorAll('script').length;
  const trackers = new Map<string, TrackerHit>();
  const thirdParty = new Set<string>();

  const note = (host: string | null, kind: string, countThirdParty = true) => {
    if (!host) return;
    const third = isThirdParty(host, pageHost);
    const t = matchTracker(host);
    if (third && (countThirdParty || t)) thirdParty.add(host);
    if (t && third) {
      const hit = trackers.get(t.domain) ?? { domain: t.domain, category: t.category, company: t.company, kinds: [] };
      if (!hit.kinds.includes(kind)) hit.kinds.push(kind);
      trackers.set(t.domain, hit);
    }
  };

  for (const [selector, attr, kind] of RESOURCE_SELECTORS) {
    for (const el of doc.querySelectorAll(selector)) {
      if (kind === 'link') {
        const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        if (!rels.some((r) => RESOURCE_LINK_RELS.has(r))) continue;
      }
      const v = el.getAttribute(attr);
      note(hostOf(attr.endsWith('srcset') ? firstSrcsetUrl(v) : v), kind);
    }
  }

  // Tracker snippets are usually injected by inline scripts (GA, GTM, pixels)
  // or hidden in <noscript> fallbacks; scan their text for tracker hosts only.
  for (const el of doc.querySelectorAll('script:not([src]), noscript')) {
    const text = (el.textContent ?? '').slice(0, 200_000);
    const kind = el.tagName.toLowerCase() === 'noscript' ? 'noscript' : 'inline-script';
    for (const m of text.matchAll(INLINE_HOST_RE)) {
      const host = m[1]!.toLowerCase();
      if (matchTracker(host)) note(host, kind, false);
    }
  }

  return {
    scriptsStripped,
    trackers: [...trackers.values()].sort((a, b) => a.domain.localeCompare(b.domain)),
    thirdPartyDomains: [...thirdParty].sort().slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Metadata

function metaContent(doc: Doc, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const el =
      doc.querySelector(`meta[property="${key}"]`) ??
      doc.querySelector(`meta[name="${key}"]`) ??
      doc.querySelector(`meta[itemprop="${key}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return undefined;
}

const cap = (s: string | undefined | null, n: number) => {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, n) : undefined;
};

function httpUrl(v: string | undefined | null, base: string): string | undefined {
  const abs = absolutize(v ?? null, base);
  return abs && /^https?:/i.test(abs) ? abs : undefined;
}

export function extractMeta(doc: Doc, finalUrl: string, base: string): PageMeta {
  const url = new URL(finalUrl);
  const title =
    cap(doc.querySelector('title')?.textContent, 500) ??
    cap(metaContent(doc, 'og:title', 'twitter:title'), 500) ??
    cap(doc.querySelector('h1')?.textContent, 500) ??
    url.hostname;

  const iconEl =
    [...doc.querySelectorAll('link[rel][href]')].find((l) =>
      (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('icon'),
    ) ?? doc.querySelector('link[rel="apple-touch-icon"][href]');
  const favicon = httpUrl(iconEl?.getAttribute('href'), base) ?? `${url.origin}/favicon.ico`;

  const author = metaContent(doc, 'author', 'article:author', 'parsely-author', 'sailthru.author', 'twitter:creator');
  const meta: PageMeta = { title, favicon };
  const siteName = cap(metaContent(doc, 'og:site_name', 'application-name'), 200);
  if (siteName) meta.siteName = siteName;
  if (author && !/^https?:\/\//i.test(author)) meta.byline = cap(author, 200);
  const description = cap(metaContent(doc, 'description', 'og:description', 'twitter:description'), 1000);
  if (description) meta.description = description;
  const lang =
    cap(doc.documentElement?.getAttribute('lang'), 35) ??
    cap(doc.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content'), 35);
  if (lang) meta.lang = lang;
  const image = httpUrl(metaContent(doc, 'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'), base);
  if (image) meta.image = image;
  const published =
    metaContent(doc, 'article:published_time', 'datePublished', 'pubdate', 'publish-date', 'date', 'dc.date', 'DC.date.issued') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    undefined;
  const pub = cap(published, 64);
  if (pub) meta.publishedTime = pub;
  return meta;
}

// ---------------------------------------------------------------------------
// Sanitizing (server-side first pass; the client runs DOMPurify again)

const DROP_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea',
  'select', 'option', 'link', 'meta', 'base', 'noscript', 'template', 'svg', 'canvas', 'dialog', 'portal', 'slot',
];
const URL_ATTR_NAMES = new Set(['href', 'src', 'poster', 'cite', 'xlink:href', 'data', 'action', 'formaction', 'background', 'longdesc', 'usemap']);
const DROP_ATTRS = new Set(['style', 'srcdoc', 'formaction', 'action', 'ping', 'background', 'dynsrc', 'lowsrc', 'nonce', 'integrity']);

function safeUrl(value: string, attr: string, tag: string): boolean {
  const v = value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!v) return false;
  if (/^https?:/i.test(v)) return true;
  if (attr === 'href' && /^(mailto:|tel:|#)/i.test(v)) return true;
  if (tag === 'img' && attr === 'src' && /^data:image\/(png|gif|jpe?g|webp|avif);/i.test(v)) return true;
  return false;
}

function isPixel(img: Element): boolean {
  const w = img.getAttribute('width');
  const h = img.getAttribute('height');
  const tiny = (v: string | null) => v !== null && /^\s*[01](px)?\s*$/i.test(v);
  return tiny(w) || tiny(h);
}

/** Strips active content, event handlers, dangerous URLs, tracker images and 1×1 pixels in place. */
export function sanitizeTree(root: Element): void {
  for (const tag of DROP_TAGS) for (const el of [...root.querySelectorAll(tag)]) el.remove();
  for (const el of [...root.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || DROP_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
      } else if (URL_ATTR_NAMES.has(name) && !safeUrl(attr.value, name, tag)) {
        el.removeAttribute(attr.name);
      } else if ((name === 'srcset' || name === 'data-srcset') && /javascript:|vbscript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (tag === 'img') {
      // Promote common lazy-loading attributes when there is no real src.
      const src = el.getAttribute('src');
      if (!src || src.startsWith('data:')) {
        const lazy = el.getAttribute('data-src') ?? el.getAttribute('data-lazy-src') ?? el.getAttribute('data-original');
        if (lazy && /^https?:/i.test(lazy)) el.setAttribute('src', lazy);
      }
      const ds = el.getAttribute('data-srcset');
      if (ds && !el.getAttribute('srcset')) el.setAttribute('srcset', ds);
      const host = hostOf(el.getAttribute('src'));
      if (isPixel(el) || (host && matchTracker(host)) || !el.getAttribute('src')) {
        el.remove();
        continue;
      }
      el.setAttribute('loading', 'lazy');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
    if (tag === 'a' && el.getAttribute('href')) {
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  }
}

// ---------------------------------------------------------------------------
// Text extraction

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'figure', 'figcaption', 'table', 'tr', 'br', 'hr', 'details', 'summary',
]);

/** Plain text with paragraph breaks preserved and other whitespace collapsed. */
export function blockText(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const tag = (node as Element).tagName?.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return;
    const block = tag ? BLOCK_TAGS.has(tag) : false;
    if (block) parts.push('\n\n');
    for (const child of node.childNodes) walk(child);
    if (block) parts.push('\n\n');
  };
  walk(root);
  return parts
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export function countWords(text: string): number {
  const latin = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  // CJK scripts have no spaces; approximate one word per ~2 characters.
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return cjk ? Math.round(cjk / 2) + Math.max(0, latin - cjk) : latin;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------------------------------------------------------------------------
// Entry points

export interface ExtractResult {
  meta: PageMeta;
  reader: ReaderContent;
  privacy: Omit<PagePrivacyReport, 'cookiesReceived' | 'cookiesSent'>;
}

const UNAVAILABLE: ReaderContent = { available: false, html: '', text: '', excerpt: '', wordCount: 0 };

function sanitizeFragment(html: string): { html: string; text: string } {
  const doc = parseDoc(`<!doctype html><html><body><div id="aether-reader-root">${html}</div></body></html>`);
  const root = doc.getElementById('aether-reader-root');
  if (!root) return { html: '', text: '' };
  sanitizeTree(root);
  return { html: root.innerHTML.slice(0, MAX_HTML_CHARS), text: blockText(root) };
}

export function extractHtml(html: string, finalUrl: string, opts: { probeOnly?: boolean } = {}): ExtractResult {
  const pageHost = new URL(finalUrl).hostname.toLowerCase();
  const doc = parseDoc(html);
  const base = documentBase(doc, finalUrl);
  absolutizeDocument(doc, base);

  const privacy = computePrivacy(doc, pageHost);
  const meta = extractMeta(doc, finalUrl, base);

  if (opts.probeOnly) {
    return { meta, privacy, reader: { ...UNAVAILABLE, excerpt: meta.description ?? '' } };
  }

  // Readability mutates its input, so it gets a fresh copy of the document.
  let article: ReturnType<Readability['parse']> = null;
  try {
    const clone = parseDoc(html);
    absolutizeDocument(clone, base);
    article = new Readability(clone, { charThreshold: 250, keepClasses: false }).parse();
  } catch {
    article = null;
  }

  let content = { html: '', text: '' };
  if (article?.content) content = sanitizeFragment(article.content);

  if (content.text.length < 40) {
    // Fallback: the page body minus obvious chrome.
    const body = doc.body;
    if (body) {
      for (const el of [...body.querySelectorAll('nav, header, footer, aside, [role="navigation"], [role="banner"], [aria-hidden="true"]')]) {
        el.remove();
      }
      content = sanitizeFragment(body.innerHTML);
    }
  }

  if (!content.text) return { meta, privacy, reader: { ...UNAVAILABLE, excerpt: meta.description ?? '' } };

  if (article?.byline && !meta.byline) meta.byline = cap(article.byline, 200);
  if (article?.publishedTime && !meta.publishedTime) meta.publishedTime = cap(article.publishedTime, 64);
  if (article?.lang && !meta.lang) meta.lang = cap(article.lang, 35);
  if (article?.siteName && !meta.siteName) meta.siteName = cap(article.siteName, 200);

  const excerpt = cap(article?.excerpt, 500) ?? meta.description?.slice(0, 500) ?? content.text.slice(0, 280);
  return {
    meta,
    privacy,
    reader: { available: true, html: content.html, text: content.text, excerpt, wordCount: countWords(content.text) },
  };
}

export function extractPlainText(text: string): ReaderContent {
  const t = text.replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_CHARS);
  if (!t.trim()) return UNAVAILABLE;
  return {
    available: true,
    html: `<pre>${escapeHtml(t)}</pre>`,
    text: t.trim(),
    excerpt: t.trim().slice(0, 280),
    wordCount: countWords(t),
  };
}

/** A readable title for non-HTML resources: the last path segment, else the host. */
export function titleFromUrl(url: URL): string {
  const seg = url.pathname.split('/').filter(Boolean).pop();
  if (seg) {
    try {
      return decodeURIComponent(seg).slice(0, 300);
    } catch {
      return seg.slice(0, 300);
    }
  }
  return url.hostname;
}
