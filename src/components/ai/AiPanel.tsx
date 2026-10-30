import clsx from 'clsx';
import {
  ArrowUp,
  BookOpenText,
  Check,
  Copy,
  FileText,
  Globe,
  History,
  Languages,
  Layers,
  ListChecks,
  MessageSquarePlus,
  NotebookPen,
  Square,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useActiveTab, useActiveWorkspace, useWorkspaceTabs } from '../../hooks.ts';
import { buildContext, researchContext, type BuiltContext } from '../../lib/ai/context.ts';
import { QUICK_ACTIONS, systemPrompt, type ContextSource } from '../../lib/ai/prompts.ts';
import { AiError, PROVIDERS, providerInfo, streamChat } from '../../lib/ai/providers.ts';
import { openLibrary } from '../../lib/pageActions.ts';
import type { ChatMessage, ContextMode, Source } from '../../lib/types.ts';
import { hostOf, isInternal, timeAgo, truncate, uid } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useChats } from '../../store/chats.ts';
import { useLibrary } from '../../store/library.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { useVault } from '../../store/vault.ts';
import { Favicon, IconButton, Menu, Select, Tooltip } from '../ui/index.tsx';

const CONTEXT_OPTIONS: { value: ContextMode; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Share nothing from your browsing' },
  { value: 'page', label: 'Page', hint: 'Share the current page’s text' },
  { value: 'selection', label: 'Selection', hint: 'Share only the text you selected in Reader view' },
  { value: 'tabs', label: 'Tabs', hint: 'Share the pages you pick' },
  { value: 'workspace', label: 'Workspace', hint: 'Share every open tab in this workspace' },
];

export function AiPanel() {
  const ws = useActiveWorkspace();
  const activeTab = useActiveTab();
  const wsTabs = useWorkspaceTabs(ws.id);
  const ai = useSettings((s) => s.settings.ai);
  const updateSettings = useSettings((s) => s.update);
  const chats = useChats((s) => s.chats);
  const activeChatId = useChats((s) => s.activeChat[ws.id] ?? null);
  const aiRequest = useUi((s) => s.aiRequest);
  const selection = useUi((s) => s.selection);
  const [context, setContext] = useState<ContextMode>(ws.settings.aiContextDefault);
  const [research, setResearch] = useState(false);
  const [pickedTabs, setPickedTabs] = useState<string[]>([]);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [historyMenu, setHistoryMenu] = useState<{ x: number; y: number } | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const wsChats = useMemo(() => chats.filter((c) => c.workspaceId === ws.id), [chats, ws.id]);
  const info = providerInfo(ai.provider);

  useEffect(() => {
    setContext(ws.settings.aiContextDefault);
    setPickedTabs([]);
  }, [ws.id, ws.settings.aiContextDefault]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat?.messages.length, status]);

  const send = useCallback(
    async (prompt: string, opts: { context: ContextMode; research: boolean; collectionId?: string }) => {
      const text = prompt.trim();
      if (!text || busy) return;
      const ui = useUi.getState();
      const settings = useSettings.getState().settings;
      const provider = providerInfo(settings.ai.provider);
      const sharesBrowsing = opts.context !== 'none' || !!opts.collectionId;

      // Explicit consent before private-workspace (or, if configured, any) content goes to a cloud model.
      if (sharesBrowsing && provider.kind !== 'local') {
        const needs = (ws.private && !ui.privateAiConsent[ws.id]) || (settings.ai.confirmCloudContext && !ui.privateAiConsent[`cloud:${ws.id}`]);
        if (needs) {
          const ok = await ui.ask({
            title: ws.private ? 'Share private browsing with AI?' : 'Share page content with AI?',
            body: `Aether will send the ${CONTEXT_OPTIONS.find((c) => c.value === opts.context)?.label.toLowerCase() ?? 'selected'} content to ${provider.label}${provider.kind === 'server' ? ' through Aether’s server' : ' directly from your browser'}.\n\nThis permission lasts until you close Aether.${ws.private ? ' Nothing is saved in this private workspace.' : ''}`,
            confirmLabel: 'Allow for this session',
          });
          if (!ok) return;
          ui.grantPrivateAi(ws.private ? ws.id : `cloud:${ws.id}`);
        }
      }

      let apiKey: string | undefined;
      if (provider.keyName) {
        if (useVault.getState().locked) {
          ui.toast('Unlock your vault in Settings to use your API key.', 'error');
          return;
        }
        apiKey = useVault.getState().get(provider.keyName);
      }

      const chats = useChats.getState();
      const chatId = activeChatId && chats.chats.some((c) => c.id === activeChatId) ? activeChatId : chats.newChat(ws.id);
      const history = (chats.chats.find((c) => c.id === chatId)?.messages ?? [])
        .filter((m) => !m.error && !m.pending && m.content)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setInput('');

      let built: BuiltContext;
      try {
        if (opts.collectionId) {
          const c = useLibrary.getState().collections.find((x) => x.id === opts.collectionId);
          const items = c?.items.slice(0, 12) ?? [];
          const per = Math.floor(60_000 / Math.max(1, items.length));
          built = {
            label: `Collection “${c?.name}” (${items.length} sources)`,
            warnings: [],
            sources: items.map((i, n) => ({ n: n + 1, title: i.title, url: i.url, text: truncate(i.text || i.excerpt, per), note: i.note })),
          };
        } else if (opts.research) {
          built = await researchContext(text, settings.ai.researchSources, setStatus, controller.signal);
        } else {
          setStatus(opts.context === 'none' ? null : 'Reading context…');
          const picked = wsTabs.filter((t) => pickedTabs.includes(t.id));
          built = await buildContext(opts.context, { activeTab, selectedTabs: picked, workspaceTabs: wsTabs });
        }
      } catch (e) {
        setBusy(false);
        setStatus(null);
        ui.toast(e instanceof Error ? e.message : 'Couldn’t prepare context', 'error');
        return;
      }
      built.warnings.forEach((w) => ui.toast(w, 'info'));

      const sources: Source[] = built.sources.map(({ n, title, url }) => ({ n, title, url }));
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, contextLabel: built.label, createdAt: Date.now() };
      const reply: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        sources,
        provider: provider.label,
        model: settings.ai.models[settings.ai.provider] || undefined,
        pending: true,
        createdAt: Date.now(),
      };
      chats.addMessage(chatId, userMsg);
      chats.addMessage(chatId, reply);
      setStatus(opts.research ? `Thinking over ${sources.length} sources…` : 'Thinking…');

      // Batch streamed tokens into ~20 updates/second, so persistence doesn't run on every token.
      let buffer = '';
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!buffer) return;
        useChats.getState().appendDelta(chatId, reply.id, buffer);
        buffer = '';
      };
      try {
        await streamChat({
          provider: settings.ai.provider,
          settings: settings.ai,
          apiKey,
          system: systemPrompt({ sources: built.sources as ContextSource[], extra: built.extra, private: ws.private }),
          messages: [...history, { role: 'user', content: text }],
          signal: controller.signal,
          onDelta: (t) => {
            setStatus(null);
            buffer += t;
            if (!raf) raf = window.setTimeout(flush, 50);
          },
        });
        window.clearTimeout(raf);
        flush();
        useChats.getState().patchMessage(chatId, reply.id, { pending: false });
      } catch (e) {
        window.clearTimeout(raf);
        flush();
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        useChats.getState().patchMessage(chatId, reply.id, {
          pending: false,
          error: aborted ? undefined : e instanceof AiError ? e.message : 'The AI request failed.',
          content: (useChats.getState().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === reply.id)?.content ?? '') + (aborted ? '\n\n*Stopped.*' : ''),
        });
      } finally {
        setBusy(false);
        setStatus(null);
        abortRef.current = null;
      }
    },
    [busy, ws.id, ws.private, activeChatId, wsTabs, pickedTabs, activeTab],
  );

  // Contextual actions elsewhere in Aether (reader selection, new tab "Research", collections).
  const lastNonce = useRef(aiRequest?.nonce ?? 0);
  useEffect(() => {
    if (!aiRequest || aiRequest.nonce === lastNonce.current) return;
    lastNonce.current = aiRequest.nonce;
    setContext(aiRequest.context);
    setResearch(!!aiRequest.research);
    void send(aiRequest.prompt, { context: aiRequest.context, research: !!aiRequest.research, collectionId: aiRequest.collectionId });
  }, [aiRequest, send]);

  const submit = () => void send(input, { context, research });
  const pageAvailable = activeTab && !isInternal(activeTab.url);

  const quick = [
    { icon: <FileText />, label: 'Summarize', prompt: QUICK_ACTIONS.summarize, ctx: 'page' as ContextMode },
    { icon: <Table2 />, label: 'Key facts', prompt: QUICK_ACTIONS.keyPoints, ctx: 'page' as ContextMode },
    { icon: <Languages />, label: `Translate`, prompt: QUICK_ACTIONS.translate(ai.translateTo), ctx: 'page' as ContextMode },
    { icon: <ListChecks />, label: 'Extract data', prompt: QUICK_ACTIONS.extract, ctx: 'page' as ContextMode },
    { icon: <NotebookPen />, label: 'Study notes', prompt: QUICK_ACTIONS.notes, ctx: 'page' as ContextMode },
    { icon: <Layers />, label: 'Compare tabs', prompt: QUICK_ACTIONS.compare, ctx: 'workspace' as ContextMode },
  ];

  const sharingLabel = research
    ? 'Web research: your question is searched, and the top results are read and cited'
    : context === 'none'
      ? 'Nothing from your browsing is shared'
      : context === 'page'
        ? pageAvailable
          ? `Shares the text of ${hostOf(activeTab!.url)}`
          : 'Current tab isn’t a web page'
        : context === 'selection'
          ? selection?.text
            ? `Shares ${selection.text.length} selected characters`
            : 'Select text in Reader view first'
          : context === 'tabs'
            ? `Shares ${pickedTabs.length} picked tab${pickedTabs.length === 1 ? '' : 's'}`
            : `Shares all ${wsTabs.filter((t) => !isInternal(t.url)).length} web tabs in ${ws.name}`;

  return (
    <aside className="glass flex h-full w-full flex-col rounded-xl" aria-label="AI assistant">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        <Select
          label="AI provider"
          value={ai.provider}
          onChange={(v) => updateSettings((s) => void (s.ai.provider = v))}
          options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
          className="h-7 w-auto max-w-[250px] border-transparent bg-transparent text-[12.5px] font-medium"
        />
        <div className="flex-1" />
        <IconButton
          label="Conversations"
          size="sm"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setHistoryMenu({ x: r.left - 180, y: r.bottom + 6 });
          }}
        >
          <History className="size-4" />
        </IconButton>
        <IconButton label="New conversation" size="sm" onClick={() => useChats.getState().setActive(ws.id, null)}>
          <MessageSquarePlus className="size-4" />
        </IconButton>
        <IconButton label="Close assistant" size="sm" onClick={() => updateSettings((s) => void (s.aiPanelOpen = false))}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!chat || chat.messages.length === 0 ? (
          <div className="flex flex-col gap-4 pt-2 anim-fade">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Ask about anything you’re reading</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-2">
                Pick what the assistant may see below. Answers about pages cite their sources.{' '}
                {info.kind === 'local'
                  ? 'This model runs on your device.'
                  : info.kind === 'byok'
                    ? `Requests go straight from your browser to ${info.label.replace(' (your key)', '')}.`
                    : 'Requests go through Aether’s server to the model provider.'}
                {ws.private && ' In this private workspace, nothing is shared until you allow it.'}
              </p>
            </div>
            {pageAvailable && (
              <div className="grid grid-cols-2 gap-1.5">
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setContext(q.ctx);
                      setResearch(false);
                      void send(q.prompt, { context: q.ctx, research: false });
                    }}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-[12px] text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 [&>svg]:size-3.5 [&>svg]:shrink-0"
                  >
                    {q.icon}
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {chat.messages.map((m) => (
              <MessageView key={m.id} m={m} chatId={chat.id} />
            ))}
          </div>
        )}
        {status && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-3 anim-fade" aria-live="polite">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            {status}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="What the assistant can see">
          {CONTEXT_OPTIONS.map((o) => (
            <Tooltip key={o.value} content={o.hint} side="top">
              <button
                type="button"
                role="radio"
                aria-checked={!research && context === o.value}
                onClick={(e) => {
                  setResearch(false);
                  setContext(o.value);
                  if (o.value === 'tabs') {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTabMenu({ x: r.left, y: r.top - 8 - Math.min(wsTabs.length, 8) * 34 });
                  }
                }}
                className={clsx(
                  'h-6 rounded-md px-2 text-[11.5px] transition-colors',
                  !research && context === o.value ? 'bg-active text-fg' : 'text-fg-3 hover:bg-hover hover:text-fg-2',
                )}
              >
                {o.label}
              </button>
            </Tooltip>
          ))}
          <Tooltip content="Search the web and cite sources" side="top">
            <button
              type="button"
              aria-pressed={research}
              onClick={() => setResearch((r) => !r)}
              className={clsx(
                'ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors',
                research ? 'bg-accent-soft text-accent' : 'text-fg-3 hover:bg-hover hover:text-fg-2',
              )}
            >
              <Globe className="size-3" /> Web
            </button>
          </Tooltip>
        </div>
        <p className="mb-1.5 truncate px-1 text-[11px] text-fg-3" title={sharingLabel}>
          {sharingLabel}
        </p>
        <form
          className="flex items-end gap-1.5 rounded-lg border border-line-strong bg-surface p-1.5 focus-within:border-accent/50"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            placeholder={research ? 'What should I research?' : 'Ask anything…'}
            aria-label="Message the assistant"
            className="scroll-thin max-h-40 min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] leading-snug outline-none placeholder:text-fg-3"
          />
          {busy ? (
            <IconButton label="Stop" size="sm" onClick={() => abortRef.current?.abort()} className="bg-active">
              <Square className="size-3.5 fill-current" />
            </IconButton>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim()}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg transition disabled:opacity-35"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </form>
      </div>

      <Menu
        anchor={tabMenu}
        onClose={() => setTabMenu(null)}
        items={wsTabs
          .filter((t) => !isInternal(t.url))
          .map((t) => ({
            label: truncate(t.title, 40),
            icon: pickedTabs.includes(t.id) ? <Check className="text-accent" /> : <Favicon url={t.url} src={t.favicon} />,
            onSelect: () => {
              setPickedTabs((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]));
              setTimeout(() => setTabMenu((m) => m ?? tabMenu), 0);
            },
          }))
          .concat(wsTabs.every((t) => isInternal(t.url)) ? [{ label: 'No web pages open', icon: <BookOpenText />, onSelect: () => {} }] : [])}
      />
      <Menu
        anchor={historyMenu}
        onClose={() => setHistoryMenu(null)}
        items={
          wsChats.length
            ? wsChats.slice(0, 15).flatMap((c) => [
                {
                  label: `${truncate(c.title, 34)} · ${timeAgo(c.updatedAt)}`,
                  icon: c.id === activeChatId ? <Check /> : <History />,
                  onSelect: () => useChats.getState().setActive(ws.id, c.id),
                },
              ]).concat([
                { label: '', separator: true } as never,
                {
                  label: 'Delete current conversation',
                  icon: <Trash2 />,
                  disabled: !chat,
                  onSelect: () => chat && useChats.getState().deleteChat(chat.id),
                } as never,
              ])
            : [{ label: 'No conversations yet', icon: <History />, disabled: true }]
        }
      />
    </aside>
  );
}

const CITE = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

function withCitations(content: string, sources: Source[] | undefined): string {
  if (!sources?.length) return content;
  const valid = new Set(sources.map((s) => s.n));
  return content.replace(CITE, (match, nums: string) => {
    const list = nums.split(',').map((x) => Number(x.trim()));
    if (!list.every((n) => valid.has(n))) return match;
    return list.map((n) => `[${n}](aether-cite:${n})`).join('');
  });
}

const MessageView = memo(function MessageView({ m, chatId }: { m: ChatMessage; chatId: string }) {
  const toast = useUi((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const openSource = (url: string) => useBrowser.getState().newTab(url);

  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[90%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-2 px-3 py-2 text-[13px] leading-relaxed">{m.content}</div>
        {m.contextLabel && <span className="text-[10.5px] text-fg-3">Context: {m.contextLabel}</span>}
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-2">
      {m.content ? (
        <div className="md text-fg">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => (url.startsWith('aether-cite:') ? url : defaultUrlTransform(url))}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith('aether-cite:')) {
                  const n = Number(href.slice(12));
                  const src = m.sources?.find((s) => s.n === n);
                  return (
                    <a
                      href={src?.url}
                      className="cite"
                      title={src ? `${src.title} — ${src.url}` : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        if (src) openSource(src.url);
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href && /^https?:/.test(href)) openSource(href);
                    }}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {withCitations(m.content, m.sources)}
          </ReactMarkdown>
        </div>
      ) : m.pending ? (
        <div className="flex flex-col gap-1.5">
          <div className="skeleton h-3 w-11/12" />
          <div className="skeleton h-3 w-9/12" />
        </div>
      ) : null}
      {m.error && (
        <div className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {m.error}
          {/key|API|401|403/i.test(m.error) && (
            <button type="button" className="ml-1 underline" onClick={() => useBrowser.getState().newTab('aether://settings#ai')}>
              Open AI settings
            </button>
          )}
        </div>
      )}
      {m.sources && m.sources.length > 0 && !m.pending && (
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">Sources</span>
          {m.sources.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => openSource(s.url)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] text-fg-2 hover:bg-hover hover:text-fg"
            >
              <span className="cite !m-0 shrink-0" style={{ fontSize: '10px' }}>
                {s.n}
              </span>
              <Favicon url={s.url} className="size-3.5" />
              <span className="truncate">{s.title}</span>
            </button>
          ))}
        </div>
      )}
      {!m.pending && m.content && (
        <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <IconButton
            label={copied ? 'Copied' : 'Copy'}
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(m.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </IconButton>
          <IconButton
            label="Save as note"
            size="sm"
            onClick={() => {
              const sources = m.sources?.length ? `\n\n**Sources**\n${m.sources.map((s) => `${s.n}. [${s.title}](${s.url})`).join('\n')}` : '';
              const chat = useChats.getState().chats.find((c) => c.id === chatId);
              const id = useLibrary.getState().createNote({
                title: chat?.title ?? 'AI answer',
                body: m.content + sources,
                workspaceId: chat?.workspaceId ?? null,
              });
              toast('Saved to notes', 'ok', { label: 'Open', run: () => openLibrary(`notes/${id}`) });
            }}
          >
            <NotebookPen className="size-3.5" />
          </IconButton>
          {m.provider && <span className="ml-1 truncate text-[10.5px] text-fg-3">{m.provider}{m.model ? ` · ${m.model}` : ''}</span>}
        </div>
      )}
    </div>
  );
});
