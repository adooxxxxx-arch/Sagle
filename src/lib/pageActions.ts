import DOMPurify from 'dompurify';
import { usePages } from '../store/pages.ts';
import { useLibrary } from '../store/library.ts';
import { useUi } from '../store/ui.ts';
import { useBrowser } from '../store/browser.ts';
import type { Tab } from './types.ts';
import { downloadFile } from './download.ts';
import { htmlToMarkdown } from './markdown.ts';
import { hostOf, slugify } from './util.ts';
import type { PageResult } from '../../shared/api.ts';

export async function readablePage(url: string): Promise<PageResult | null> {
  const st = await usePages.getState().ensure(url);
  if (st.status === 'ready' && st.data.reader.available) return st.data;
  if (st.status === 'disabled') useUi.getState().toast('Server page analysis is off (Privacy center), so the page text isn’t available.', 'error');
  else if (st.status === 'error') useUi.getState().toast(st.error.error.message, 'error');
  else useUi.getState().toast('This page has no readable text.', 'error');
  return null;
}

export async function saveToReadingList(tab: Tab) {
  const page = await readablePage(tab.url);
  useLibrary.getState().addReading({
    url: tab.url,
    title: page?.meta.title || tab.title,
    excerpt: page?.reader.excerpt ?? '',
    text: page?.reader.text ?? '',
  });
  useUi.getState().toast(page ? 'Saved to reading list (available offline)' : 'Saved link to reading list', 'ok');
}

export async function addPageToCollection(tab: Tab, collectionId: string) {
  const page = await readablePage(tab.url);
  useLibrary.getState().addToCollection(collectionId, {
    url: tab.url,
    title: page?.meta.title || tab.title,
    excerpt: page?.reader.excerpt ?? '',
    text: page?.reader.text,
  });
  useUi.getState().toast('Added to collection', 'ok');
}

export function noteFromPage(tab: Tab) {
  const id = useLibrary.getState().createNote({
    title: tab.title,
    body: `Source: [${tab.title}](${tab.url})\n\n`,
    sourceUrl: tab.url,
    workspaceId: tab.workspaceId,
  });
  openLibrary(`notes/${id}`);
}

export function openLibrary(hash: string) {
  const b = useBrowser.getState();
  const url = `aether://library#${hash}`;
  const existing = b.tabs.find((t) => t.workspaceId === b.activeWorkspaceId && t.url.startsWith('aether://library'));
  if (existing) {
    b.navigate(existing.id, url);
    b.activateTab(existing.id);
  } else b.newTab(url);
}

export async function downloadPage(tab: Tab, format: 'md' | 'html') {
  const page = await readablePage(tab.url);
  if (!page) return;
  const clean = DOMPurify.sanitize(page.reader.html, { FORBID_TAGS: ['style', 'form', 'iframe'], FORBID_ATTR: ['style'] });
  const base = slugify(page.meta.title || hostOf(tab.url));
  if (format === 'md') {
    const md = `# ${page.meta.title}\n\n> Source: ${page.finalUrl}\n> Saved with Aether on ${new Date().toLocaleString()}\n\n${htmlToMarkdown(clean)}\n`;
    downloadFile(`${base}.md`, md, 'text/markdown', tab.url);
  } else {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const html = `<!doctype html><html lang="${esc(page.meta.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.meta.title)}</title><style>body{font:18px/1.7 Georgia,serif;max-width:68ch;margin:3rem auto;padding:0 1rem;color:#1a1a1a}img{max-width:100%;height:auto}a{color:#2f6fe0}pre{overflow:auto;background:#f4f4f5;padding:1rem}</style></head><body><p style="font:13px system-ui;color:#666">Saved from <a href="${esc(page.finalUrl)}">${esc(page.finalUrl)}</a></p><h1>${esc(page.meta.title)}</h1>${clean}</body></html>`;
    downloadFile(`${base}.html`, html, 'text/html', tab.url);
  }
}
