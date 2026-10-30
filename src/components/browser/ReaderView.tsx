import DOMPurify from 'dompurify';
import { Copy, Highlighter, Languages, MessageSquareText, NotebookPen, Type } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageResult } from '../../../shared/api.ts';
import { imageProxyUrl } from '../../lib/api.ts';
import { QUICK_ACTIONS } from '../../lib/ai/prompts.ts';
import { openLibrary } from '../../lib/pageActions.ts';
import type { Tab } from '../../lib/types.ts';
import { cleanTitle, hostOf } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { IconButton } from '../ui/index.tsx';

function sanitize(html: string, images: 'direct' | 'proxy' | 'block'): string {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer nofollow');
      node.removeAttribute('target');
    }
    if (node.tagName === 'IMG' || node.tagName === 'SOURCE' || node.tagName === 'VIDEO') {
      const src = node.getAttribute('src');
      node.removeAttribute('srcset');
      if (images === 'block' || !src || !/^https?:/i.test(src)) {
        if (node.tagName === 'IMG') node.setAttribute('data-aether-blocked', '');
        node.removeAttribute('src');
      } else if (images === 'proxy' && node.tagName === 'IMG') {
        node.setAttribute('src', imageProxyUrl(src));
      }
      node.setAttribute('referrerpolicy', 'no-referrer');
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
  });
  const out = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math', 'audio'],
    FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'sizes', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
  });
  DOMPurify.removeHook('afterSanitizeAttributes');
  return out.replace(/<img data-aether-blocked=""[^>]*>/g, '');
}

/** Wrap every occurrence-segment of `quote` (first match) in <mark>, across text nodes. */
function applyHighlight(root: HTMLElement, quote: string, id: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = '';
  const starts: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(full.length);
    full += (n as Text).data;
  }
  // Match on whitespace-collapsed text (selection strings insert newlines between blocks),
  // keeping a map back to offsets in the original text.
  let collapsed = '';
  const map: number[] = [];
  for (let i = 0; i < full.length; i++) {
    const ws = /\s/.test(full[i]);
    if (ws && collapsed.endsWith(' ')) continue;
    collapsed += ws ? ' ' : full[i];
    map.push(i);
  }
  const needle = quote.replace(/\s+/g, ' ').trim();
  const at = collapsed.indexOf(needle);
  if (at < 0 || !needle) return;
  const idx = map[at];
  const endOrig = map[at + needle.length - 1] + 1;
  const end = endOrig;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const s = starts[i];
    const e = s + nodes[i].data.length;
    if (e <= idx || s >= end) continue;
    const from = Math.max(idx, s) - s;
    const to = Math.min(end, e) - s;
    const range = document.createRange();
    range.setStart(nodes[i], from);
    range.setEnd(nodes[i], to);
    const mark = document.createElement('mark');
    mark.dataset.aetherHl = id;
    mark.title = 'Highlight — click to remove';
    range.surroundContents(mark);
  }
}

export function ReaderView({ tab, data }: { tab: Tab; data: PageResult }) {
  const images = useSettings((s) => s.settings.privacy.readerImages);
  const font = useSettings((s) => s.settings.readerFont);
  const update = useSettings((s) => s.update);
  const highlights = useLibrary((s) => s.highlights);
  const addHighlight = useLibrary((s) => s.addHighlight);
  const removeHighlight = useLibrary((s) => s.removeHighlight);
  const setSelection = useUi((s) => s.setSelection);
  const requestAi = useUi((s) => s.requestAi);
  const toast = useUi((s) => s.toast);
  const translateTo = useSettings((s) => s.settings.ai.translateTo);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; text: string } | null>(null);

  const html = useMemo(() => sanitize(data.reader.html, images), [data.reader.html, images]);
  const pageHighlights = useMemo(() => highlights.filter((h) => h.url === tab.url), [highlights, tab.url]);

  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    el.innerHTML = html;
    for (const h of pageHighlights) {
      try {
        applyHighlight(el, h.quote, h.id);
      } catch {
        /* quote no longer matches the page */
      }
    }
  }, [html, pageHighlights]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [data.finalUrl]);

  const openAi = () => useSettings.getState().update((s) => void (s.aiPanelOpen = true));

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mark = target.closest('mark[data-aether-hl]') as HTMLElement | null;
    if (mark) {
      const id = mark.dataset.aetherHl!;
      toast('Remove this highlight?', 'info', { label: 'Remove', run: () => removeHighlight(id) });
      return;
    }
    const a = target.closest('a') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const el = content.current?.querySelector(`[name="${CSS.escape(href.slice(1))}"]`);
      el?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    let url: string;
    try {
      url = new URL(href, data.finalUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(url)) return;
    const b = useBrowser.getState();
    if (e.metaKey || e.ctrlKey || e.button === 1) b.newTab(url, { activate: false, afterTabId: tab.id, workspaceId: tab.workspaceId });
    else b.navigate(tab.id, url);
  };

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || !text || !content.current?.contains(sel.anchorNode)) {
      setBubble(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = scroller.current!.getBoundingClientRect();
    setBubble({
      x: Math.min(Math.max(rect.left + rect.width / 2 - host.left, 120), host.width - 120),
      y: rect.top - host.top + scroller.current!.scrollTop - 44,
      text,
    });
    setSelection({ text: text.slice(0, 20_000), url: tab.url, at: Date.now() });
  };

  const readMin = Math.max(1, Math.round(data.reader.wordCount / 230));

  return (
    <div ref={scroller} className="scroll-thin absolute inset-0 overflow-y-auto bg-[var(--page)]/40" onMouseUp={onMouseUp}>
      <div className="relative px-5 py-8 sm:px-8 sm:py-12">
        <div className="absolute right-3 top-3">
          <IconButton
            label={font === 'serif' ? 'Switch to sans-serif' : 'Switch to serif'}
            size="sm"
            onClick={() => update((s) => void (s.readerFont = s.readerFont === 'serif' ? 'sans' : 'serif'))}
          >
            <Type className="size-4" />
          </IconButton>
        </div>
        <article className="reader" data-font={font} lang={data.meta.lang}>
          <p className="mb-3 font-sans text-[12.5px] text-fg-3">
            {data.meta.siteName || hostOf(data.finalUrl)}
            {data.meta.byline && <> · {data.meta.byline}</>} · {readMin} min read
          </p>
          <h1 className="!mt-0 !text-[1.9em] !leading-tight">{cleanTitle(data.meta.title, data.meta.siteName, hostOf(data.finalUrl))}</h1>
          <div ref={content} onClick={onClick} onAuxClick={onClick} />
          <hr />
          <p className="font-sans text-[12px] text-fg-3">
            Reader view of{' '}
            <a href={data.finalUrl} onClick={(e) => e.preventDefault()}>
              {data.finalUrl}
            </a>
            . Extracted by Aether; layout, scripts and ads removed.
          </p>
        </article>
        {bubble && (
          <div
            className="glass-strong absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-1 anim-fade"
            style={{ left: bubble.x, top: Math.max(bubble.y, 4) }}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <IconButton
              label="Explain with AI"
              size="sm"
              onClick={() => {
                openAi();
                requestAi({ prompt: QUICK_ACTIONS.explain, context: 'selection' });
                setBubble(null);
              }}
            >
              <MessageSquareText className="size-4" />
            </IconButton>
            <IconButton
              label={`Translate to ${translateTo}`}
              size="sm"
              onClick={() => {
                openAi();
                requestAi({ prompt: QUICK_ACTIONS.translate(translateTo), context: 'selection' });
                setBubble(null);
              }}
            >
              <Languages className="size-4" />
            </IconButton>
            <IconButton
              label="Highlight"
              size="sm"
              onClick={() => {
                addHighlight({ url: tab.url, quote: bubble.text.slice(0, 2000) });
                window.getSelection()?.removeAllRanges();
                setBubble(null);
              }}
            >
              <Highlighter className="size-4" />
            </IconButton>
            <IconButton
              label="Add to a new note"
              size="sm"
              onClick={() => {
                const id = useLibrary.getState().createNote({
                  title: data.meta.title,
                  body: `> ${bubble.text.replace(/\n+/g, '\n> ')}\n\n— [${data.meta.title}](${data.finalUrl})\n\n`,
                  sourceUrl: data.finalUrl,
                  workspaceId: tab.workspaceId,
                });
                setBubble(null);
                toast('Saved to a new note', 'ok', { label: 'Open', run: () => openLibrary(`notes/${id}`) });
              }}
            >
              <NotebookPen className="size-4" />
            </IconButton>
            <IconButton
              label="Copy"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(bubble.text).then(() => toast('Copied', 'ok'));
                setBubble(null);
              }}
            >
              <Copy className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
