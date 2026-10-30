import clsx from 'clsx';
import {
  AlertTriangle,
  BookOpenText,
  ChevronDown,
  ChevronUp,
  Cookie,
  ExternalLink,
  EyeOff,
  Info,
  MonitorPlay,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApiError, PageResult } from '../../../shared/api.ts';
import { useBrowser } from '../../store/browser.ts';
import { useFrames } from '../../store/frames.ts';
import { usePages } from '../../store/pages.ts';
import { permissionsFor, useSettings } from '../../store/settings.ts';
import type { Tab, Workspace } from '../../lib/types.ts';
import { cleanTitle, hostOf } from '../../lib/util.ts';
import { Badge, Button } from '../ui/index.tsx';
import { ReaderView } from './ReaderView.tsx';

export const credentiallessSupported =
  typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;

type Effective = 'live' | 'reader' | 'pending' | 'blocked-embed' | 'error';

export function WebView({ tab, visible }: { tab: Tab; visible: boolean }) {
  const ws = useBrowser((s) => s.workspaces.find((w) => w.id === tab.workspaceId))!;
  const page = usePages((s) => s.byUrl[tab.url]);
  const ensure = usePages((s) => s.ensure);
  const setTabMeta = useBrowser((s) => s.setTabMeta);
  const setViewMode = useBrowser((s) => s.setViewMode);
  const serverAnalysis = useSettings((s) => s.settings.privacy.serverAnalysis);
  const lastReload = useRef(tab.reloadKey);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    const force = tab.reloadKey !== lastReload.current;
    lastReload.current = tab.reloadKey;
    void ensure(tab.url, { force });
  }, [tab.url, tab.reloadKey, serverAnalysis, ensure]);

  const data = page?.status === 'ready' ? page.data : null;
  useEffect(() => {
    if (data) setTabMeta(tab.id, { title: cleanTitle(data.meta.title, data.meta.siteName, hostOf(data.finalUrl)) || hostOf(data.finalUrl), favicon: data.meta.favicon });
  }, [data, tab.id, setTabMeta]);

  if (page?.status === 'error' && ['BLOCKED_MALICIOUS', 'BLOCKED_PRIVATE_NETWORK', 'INVALID_URL'].includes(page.error.error.code)) {
    return <BlockedPage tab={tab} error={page.error} />;
  }

  const effective: Effective = (() => {
    if (tab.viewMode === 'live') return 'live';
    if (tab.viewMode === 'reader') return 'reader';
    if (!page || page.status === 'loading') return 'pending';
    if (page.status === 'disabled') return 'live';
    if (page.status === 'error') return 'live';
    const d = page.data;
    if (ws.settings.defaultView === 'reader' && d.reader.available) return 'reader';
    if (d.embed.allowed === false) return d.reader.available ? 'reader' : 'blocked-embed';
    return 'live';
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InfoBar
        tab={tab}
        ws={ws}
        page={page}
        effective={effective}
        showReport={showReport}
        onToggleReport={() => setShowReport((v) => !v)}
        onMode={(m) => setViewMode(tab.id, m)}
      />
      {showReport && data && <PageReport data={data} />}
      <div className="relative min-h-0 flex-1">
        {effective === 'pending' && <LoadingSkeleton />}
        {effective === 'live' && <LiveFrame tab={tab} ws={ws} visible={visible} />}
        {effective === 'reader' &&
          (page?.status === 'ready' ? (
            page.data.reader.available ? (
              <ReaderView tab={tab} data={page.data} />
            ) : (
              <Notice
                icon={<Info />}
                title="Reader view isn’t available for this page"
                body={`It returned ${page.data.contentType || 'non-HTML content'}, which has no article text to extract.`}
                actions={<ModeActions tab={tab} allowLive />}
              />
            )
          ) : page?.status === 'error' ? (
            <Notice
              icon={<AlertTriangle />}
              title="Aether couldn’t fetch this page"
              body={page.error.error.message}
              actions={
                <>
                  <Button icon={<RotateCw className="size-3.5" />} onClick={() => ensure(tab.url, { force: true })}>
                    Try again
                  </Button>
                  <ModeActions tab={tab} allowLive />
                </>
              }
            />
          ) : page?.status === 'disabled' ? (
            <Notice
              icon={<ShieldOff />}
              title="Reader view needs server page analysis"
              body="You turned off server analysis in the Privacy center, so Aether doesn’t fetch pages on your behalf. Reader view and AI page context depend on it."
              actions={
                <>
                  <Button
                    variant="primary"
                    onClick={() => useSettings.getState().update((s) => void (s.privacy.serverAnalysis = true))}
                  >
                    Turn on server analysis
                  </Button>
                  <ModeActions tab={tab} allowLive />
                </>
              }
            />
          ) : (
            <LoadingSkeleton />
          ))}
        {effective === 'blocked-embed' && (
          <Notice
            icon={<ShieldAlert />}
            title={`${hostOf(tab.url)} can’t be shown inside Aether`}
            body={`${data?.embed.reason ?? 'The site forbids embedding.'} It also has no readable article text. Open it in a regular browser tab instead.`}
            actions={<ModeActions tab={tab} />}
          />
        )}
      </div>
    </div>
  );
}

function ModeActions({ tab, allowLive }: { tab: Tab; allowLive?: boolean }) {
  const setViewMode = useBrowser((s) => s.setViewMode);
  return (
    <>
      {allowLive && (
        <Button variant="ghost" icon={<MonitorPlay className="size-3.5" />} onClick={() => setViewMode(tab.id, 'live')}>
          Try Live view
        </Button>
      )}
      <Button variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}>
        Open in new browser tab
      </Button>
    </>
  );
}

function InfoBar({
  tab,
  ws,
  page,
  effective,
  showReport,
  onToggleReport,
  onMode,
}: {
  tab: Tab;
  ws: Workspace;
  page: ReturnType<typeof usePages.getState>['byUrl'][string] | undefined;
  effective: Effective;
  showReport: boolean;
  onToggleReport: () => void;
  onMode: (m: 'live' | 'reader') => void;
}) {
  const data = page?.status === 'ready' ? page.data : null;
  const perms = permissionsFor(hostOf(tab.url));
  useSettings((s) => s.sitePermissions);
  let icon: ReactNode = <MonitorPlay />;
  let text: ReactNode = '';
  let tone: 'neutral' | 'warn' = 'neutral';

  if (effective === 'pending') {
    icon = <ShieldCheck />;
    text = 'Checking the site’s security and embedding policy…';
  } else if (effective === 'reader') {
    icon = <BookOpenText />;
    const fallback = tab.viewMode === 'auto' && data?.embed.allowed === false;
    text = (
      <>
        <span className="text-fg">Reader view</span>
        {fallback && ' (this site blocks embedding)'} · fetched without your cookies or IP
        {data && (
          <>
            {' '}
            · {data.privacy.scriptsStripped} scripts, {data.privacy.trackers.length} trackers not loaded
          </>
        )}
      </>
    );
  } else if (effective === 'live') {
    const verified = data?.embed.allowed === true;
    const forcedBlocked = data?.embed.allowed === false;
    tone = forcedBlocked || !verified ? 'warn' : 'neutral';
    text = forcedBlocked ? (
      <>
        <span className="text-fg">Live view</span> · this site forbids embedding ({data?.embed.reason}). It will likely stay blank.
      </>
    ) : verified ? (
      <>
        <span className="text-fg">Live view</span> · the real site, embedded from {hostOf(tab.url)}. Its scripts and cookies run in your browser.
      </>
    ) : (
      <>
        <span className="text-fg">Live view</span> ·{' '}
        {page?.status === 'error'
          ? `Aether couldn’t analyze this page (${page.error.error.message})`
          : 'embedding not verified (server analysis off)'}
        . If it stays blank, the site blocks embedding.
      </>
    );
  } else if (effective === 'blocked-embed') {
    icon = <ShieldAlert />;
    tone = 'warn';
    text = 'This site refuses to be embedded and has no reader text.';
  }

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1 text-[11.5px] text-fg-2">
      <span className={clsx('flex size-3.5 shrink-0 [&>svg]:size-3.5', tone === 'warn' ? 'text-warn' : 'text-fg-3')}>{icon}</span>
      <span className="min-w-0 flex-1 leading-snug">{text}</span>
      {effective === 'live' && (
        <span className="flex items-center gap-1">
          {ws.settings.isolateCookies && credentiallessSupported && (
            <Badge tone="accent">
              <Cookie className="size-3" /> isolated cookies
            </Badge>
          )}
          {ws.private && (
            <Badge tone="accent">
              <EyeOff className="size-3" /> private
            </Badge>
          )}
          {!perms.javascript && <Badge tone="warn">JS off</Badge>}
        </span>
      )}
      {data && (
        <button type="button" onClick={onToggleReport} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-2 hover:bg-hover hover:text-fg">
          Page report {showReport ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      )}
      {(effective === 'live' || effective === 'reader') && (
        <button
          type="button"
          onClick={() => onMode(effective === 'live' ? 'reader' : 'live')}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft"
        >
          {effective === 'live' ? 'Reader view' : 'Live view'}
        </button>
      )}
      <button
        type="button"
        onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-2 hover:bg-hover hover:text-fg"
      >
        New browser tab <ExternalLink className="size-3" />
      </button>
    </div>
  );
}

function PageReport({ data }: { data: PageResult }) {
  const p = data.privacy;
  const n = data.network;
  return (
    <div className="scroll-thin max-h-[40%] shrink-0 overflow-y-auto border-b border-line bg-surface px-4 py-3 text-[12px] anim-fade">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ReportCol title="Connection">
          <KV k="Protocol" v={data.https ? 'HTTPS (TLS)' : 'HTTP — not encrypted'} warn={!data.https} />
          <KV k="Status" v={String(data.status)} />
          <KV k="Resolver" v={n.dohUsed ? `${n.resolver} (DNS-over-HTTPS)` : n.dohFallback ? 'system (DoH failed)' : 'system'} />
          {n.resolvedIp && <KV k="Server IP" v={n.resolvedIp} />}
          <KV k="Proxy" v={n.proxy ? `${n.proxy.type}://${n.proxy.host}:${n.proxy.port}` : 'none'} />
          <KV k="Fetched in" v={`${n.timingMs} ms`} />
          {data.redirects.length > 0 && <KV k="Redirects" v={String(data.redirects.length)} />}
        </ReportCol>
        <ReportCol title="Safety">
          <KV
            k="Malware check"
            v={data.safety.checked ? (data.safety.blocked ? 'Flagged' : 'Not flagged') : 'Not checked'}
            warn={data.safety.blocked}
          />
          {data.safety.provider && <KV k="Checked by" v={data.safety.provider} />}
          <KV k="Embedding" v={data.embed.allowed === true ? 'Allowed' : data.embed.allowed === false ? 'Forbidden' : 'Unknown'} />
          <p className="text-fg-3">{data.embed.reason}</p>
        </ReportCol>
        <ReportCol title={`Trackers referenced (${p.trackers.length})`}>
          {p.trackers.length === 0 && <p className="text-fg-3">None from Aether’s tracker list.</p>}
          {p.trackers.slice(0, 12).map((t) => (
            <div key={t.domain} className="flex justify-between gap-2">
              <span className="truncate">{t.company ?? t.domain}</span>
              <span className="text-fg-3">{t.category}</span>
            </div>
          ))}
          <p className="text-fg-3">Not loaded in Reader view. Live view loads whatever the site includes.</p>
        </ReportCol>
        <ReportCol title="Cookies & third parties">
          <KV k="Cookies the site set" v={String(p.cookiesReceived.length)} />
          {p.cookiesReceived.length > 0 && <p className="truncate text-fg-3">{p.cookiesReceived.slice(0, 6).join(', ')}</p>}
          <KV k="Cookies Aether sent" v="0" />
          <KV k="Third-party domains" v={String(p.thirdPartyDomains.length)} />
          {p.thirdPartyDomains.length > 0 && <p className="text-fg-3">{p.thirdPartyDomains.slice(0, 8).join(', ')}</p>}
        </ReportCol>
      </div>
    </div>
  );
}

function ReportCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{title}</h4>
      {children}
    </div>
  );
}

function KV({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-3">{k}</span>
      <span className={clsx('truncate text-right', warn ? 'text-warn' : 'text-fg')}>{v}</span>
    </div>
  );
}

function LiveFrame({ tab, ws, visible }: { tab: Tab; ws: Workspace; visible: boolean }) {
  const host = hostOf(tab.url);
  useSettings((s) => s.sitePermissions[host]);
  useSettings((s) => s.settings.defaultPermissions);
  const perms = permissionsFor(host);
  const setLoading = useFrames((s) => s.setLoading);
  const stoppedAt = useFrames((s) => s.stopped[tab.id] ?? 0);
  const [mountedAt, setMountedAt] = useState(() => Date.now());
  const [slow, setSlow] = useState(false);

  const sandbox = [
    'allow-same-origin',
    perms.javascript && 'allow-scripts',
    perms.forms && 'allow-forms',
    perms.popups && 'allow-popups allow-popups-to-escape-sandbox',
    'allow-downloads',
    'allow-presentation',
    'allow-modals',
  ]
    .filter(Boolean)
    .join(' ');
  const allow = [
    perms.camera && 'camera',
    perms.microphone && 'microphone',
    perms.geolocation && 'geolocation',
    perms.fullscreen && 'fullscreen',
    perms.clipboard && 'clipboard-write',
    'autoplay',
    'picture-in-picture',
    'encrypted-media',
  ]
    .filter(Boolean)
    .join('; ');
  const isolate = ws.settings.isolateCookies && credentiallessSupported;
  const frameKey = `${tab.url}|${tab.reloadKey}|${sandbox}|${allow}|${isolate}`;

  useEffect(() => {
    setMountedAt(Date.now());
    setSlow(false);
    setLoading(tab.id, true);
    const t = window.setTimeout(() => setSlow(true), 12_000);
    return () => {
      window.clearTimeout(t);
      setLoading(tab.id, false);
    };
  }, [frameKey, tab.id, setLoading]);

  if (stoppedAt > mountedAt) {
    return (
      <Notice
        icon={<Info />}
        title="Loading stopped"
        body="You stopped this page. Reload to try again."
        actions={
          <Button icon={<RotateCw className="size-3.5" />} onClick={() => useBrowser.getState().reload(tab.id)}>
            Reload
          </Button>
        }
      />
    );
  }

  const extra = isolate ? ({ credentialless: '' } as Record<string, string>) : {};
  return (
    <>
      <iframe
        key={frameKey}
        title={tab.title}
        src={tab.url}
        sandbox={sandbox}
        allow={allow}
        referrerPolicy="no-referrer"
        loading={visible ? 'eager' : 'lazy'}
        onLoad={() => {
          setLoading(tab.id, false);
          setSlow(false);
        }}
        className="absolute inset-0 size-full border-0 bg-[var(--page)]"
        {...extra}
      />
      {slow && (
        <div className="glass-strong absolute bottom-3 left-1/2 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-lg px-3 py-2 text-[12px] anim-rise">
          <span className="text-fg-2">Still loading. Some sites block embedding without saying so.</span>
          <Button size="sm" variant="ghost" onClick={() => useBrowser.getState().setViewMode(tab.id, 'reader')}>
            Reader
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}>
            New tab
          </Button>
        </div>
      )}
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-12" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-3 w-28" />
      <div className="skeleton h-7 w-4/5" />
      <div className="skeleton mt-4 h-3 w-full" />
      <div className="skeleton h-3 w-11/12" />
      <div className="skeleton h-3 w-10/12" />
      <div className="skeleton h-3 w-9/12" />
    </div>
  );
}

export function Notice({ icon, title, body, actions }: { icon: ReactNode; title: string; body: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center anim-rise">
        <div className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-fg-2 [&>svg]:size-5">{icon}</div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-[12.5px] leading-relaxed text-fg-2">{body}</p>
        {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function BlockedPage({ tab, error }: { tab: Tab; error: ApiError }) {
  const back = useBrowser((s) => s.back);
  const code = error.error.code;
  const title =
    code === 'BLOCKED_MALICIOUS'
      ? 'Aether blocked a dangerous site'
      : code === 'BLOCKED_PRIVATE_NETWORK'
        ? 'Private network address blocked'
        : 'This address isn’t valid';
  const body =
    code === 'BLOCKED_MALICIOUS'
      ? `${hostOf(tab.url)} is flagged as malware or phishing by ${error.safety?.provider ?? 'Aether’s malicious-domain filter'}. Aether didn’t load it.`
      : code === 'BLOCKED_PRIVATE_NETWORK'
        ? 'Aether’s server won’t fetch addresses on private or local networks. That protects the server and your network from request-forgery attacks.'
        : error.error.message;
  return (
    <Notice
      icon={<ShieldAlert className="text-danger" />}
      title={title}
      body={body}
      actions={
        <>
          <Button variant="primary" disabled={tab.nav.index === 0} onClick={() => back(tab.id)}>
            Go back
          </Button>
          {code === 'BLOCKED_PRIVATE_NETWORK' && (
            <Button variant="ghost" onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}>
              Open in new browser tab
            </Button>
          )}
        </>
      }
    />
  );
}
