import clsx from 'clsx';
import {
  Cookie,
  Database,
  EyeOff,
  Globe2,
  HardDrive,
  History,
  Network,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { DnsResponse, DohResolver } from '../../../shared/api.ts';
import { useActiveWorkspace } from '../../hooks.ts';
import { dnsLookup } from '../../lib/api.ts';
import type { ProxyEntry } from '../../lib/types.ts';
import { uid } from '../../lib/util.ts';
import { useBrowser } from '../../store/browser.ts';
import { useChats } from '../../store/chats.ts';
import { usePages } from '../../store/pages.ts';
import { DEFAULT_PERMISSIONS, useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { useVault } from '../../store/vault.ts';
import { Badge, Button, Field, Input, Modal, Row, Section, Select, Toggle } from '../ui/index.tsx';
import { credentiallessSupported } from '../browser/WebView.tsx';
import { PERMISSION_LABELS, SitePermissionsDialog } from '../browser/SitePermissions.tsx';

export function PrivacyCenter() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 sm:px-6">
      <header className="mb-2 px-1">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em]">
          <ShieldCheck className="size-5 text-accent" /> Privacy center
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-fg-2">
          Everything here is measured, not estimated. When Aether can’t observe something (for example, requests made inside a Live view
          frame), it says so.
        </p>
      </header>
      <IsolationStatus />
      <SessionStats />
      <NetworkSection />
      <ProxySection />
      <PermissionsSection />
      <RetentionSection />
      <Explainer />
    </div>
  );
}

function StatusCard({ icon, title, value, tone = 'neutral', detail }: { icon: ReactNode; title: string; value: string; tone?: 'ok' | 'warn' | 'neutral'; detail: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-[12px] text-fg-2 [&>svg]:size-3.5">
        {icon}
        {title}
      </div>
      <div className={clsx('mt-1.5 text-[14px] font-semibold', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-fg')}>{value}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">{detail}</p>
    </div>
  );
}

function IsolationStatus() {
  const ws = useActiveWorkspace();
  const update = useBrowser((s) => s.updateWorkspace);
  const confirmCloud = useSettings((s) => s.settings.ai.confirmCloudContext);
  return (
    <Section
      title={`Session isolation · ${ws.name}`}
      description="How the current workspace stores data and isolates sites. Change these per workspace."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          icon={<HardDrive />}
          title="Storage"
          value={ws.ephemeral ? 'Memory only' : 'This device'}
          tone={ws.ephemeral ? 'ok' : 'neutral'}
          detail={ws.ephemeral ? 'Tabs, history and chats are erased when you close Aether.' : 'Saved in this browser’s IndexedDB. Never uploaded.'}
        />
        <StatusCard
          icon={<Cookie />}
          title="Live view cookies"
          value={!ws.settings.isolateCookies ? 'Shared' : credentiallessSupported ? 'Isolated' : 'Not supported'}
          tone={ws.settings.isolateCookies && credentiallessSupported ? 'ok' : 'warn'}
          detail={
            credentiallessSupported
              ? 'Isolated frames get a fresh, temporary cookie jar (credentialless iframes).'
              : 'This browser lacks credentialless iframes (Chromium only), so embedded sites use their normal partitioned cookies.'
          }
        />
        <StatusCard
          icon={<History />}
          title="History"
          value={ws.settings.historyEnabled && !ws.private ? 'Recorded' : 'Off'}
          tone={ws.settings.historyEnabled && !ws.private ? 'neutral' : 'ok'}
          detail="Aether’s own history only. Your browser may keep its own record of this site."
        />
        <StatusCard
          icon={<Sparkles />}
          title="AI page access"
          value={ws.private || confirmCloud ? 'Asks first' : 'You choose per message'}
          tone={ws.private || confirmCloud ? 'ok' : 'neutral'}
          detail="Page content goes to an AI provider only when you pick a context other than “None”."
        />
      </div>
      <div className="mt-4">
        <Row title="Record history in this workspace" description={ws.private ? 'Private workspaces never record history.' : undefined}>
          <Toggle
            label="Record history"
            checked={ws.settings.historyEnabled && !ws.private}
            disabled={ws.private}
            onChange={(v) => update(ws.id, { settings: { historyEnabled: v } })}
          />
        </Row>
        <Row
          title="Isolate cookies in Live view"
          description="Loads embedded sites without your existing cookies. You’ll be logged out of sites inside Aether."
        >
          <Toggle
            label="Isolate cookies"
            checked={ws.settings.isolateCookies}
            disabled={!credentiallessSupported}
            onChange={(v) => update(ws.id, { settings: { isolateCookies: v } })}
          />
        </Row>
      </div>
    </Section>
  );
}

function SessionStats() {
  const byUrl = usePages((s) => s.byUrl);
  const rows = useMemo(() => {
    const out = Object.values(byUrl)
      .filter((p) => p.status === 'ready')
      .map((p) => (p as Extract<typeof p, { status: 'ready' }>).data);
    return out;
  }, [byUrl]);
  const trackerDomains = new Set(rows.flatMap((r) => r.privacy.trackers.map((t) => t.domain)));
  const cookies = rows.reduce((n, r) => n + r.privacy.cookiesReceived.length, 0);
  const scripts = rows.reduce((n, r) => n + r.privacy.scriptsStripped, 0);
  const thirdParty = new Set(rows.flatMap((r) => r.privacy.thirdPartyDomains));
  const blocked = Object.values(byUrl).filter((p) => p.status === 'error' && p.error.error.code === 'BLOCKED_MALICIOUS').length;

  return (
    <Section
      title="This session"
      description="Measured from pages Aether’s server analyzed since you opened Aether. Kept in memory only. Live view frames are cross-origin: no web app, Aether included, can see the requests they make."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Pages analyzed" value={rows.length} />
        <Stat label="Tracker domains found" value={trackerDomains.size} />
        <Stat label="Scripts stripped" value={scripts} />
        <Stat label="Cookies discarded" value={cookies} />
        <Stat label="Third-party domains" value={thirdParty.size} />
        <Stat label="Malicious sites blocked" value={blocked} />
      </div>
      {rows.length > 0 ? (
        <div className="scroll-thin mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead className="text-fg-3">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-medium">Site</th>
                <th className="py-1.5 pr-3 font-medium">Trackers</th>
                <th className="py-1.5 pr-3 font-medium">Cookies set</th>
                <th className="py-1.5 pr-3 font-medium">3rd-party</th>
                <th className="py-1.5 pr-3 font-medium">HTTPS</th>
                <th className="py-1.5 font-medium">Embedding</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={r.finalUrl} className="border-b border-line last:border-0">
                  <td className="max-w-[220px] truncate py-1.5 pr-3">{new URL(r.finalUrl).hostname}</td>
                  <td className="py-1.5 pr-3">
                    {r.privacy.trackers.length}
                    {r.privacy.trackers.length > 0 && (
                      <span className="ml-1 text-fg-3">({r.privacy.trackers.slice(0, 2).map((t) => t.company ?? t.domain).join(', ')})</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{r.privacy.cookiesReceived.length}</td>
                  <td className="py-1.5 pr-3">{r.privacy.thirdPartyDomains.length}</td>
                  <td className="py-1.5 pr-3">{r.https ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">no</Badge>}</td>
                  <td className="py-1.5">{r.embed.allowed === true ? 'allowed' : r.embed.allowed === false ? 'forbidden' : 'unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-fg-3">No data yet. Open a few sites and this fills in with what was actually measured.</p>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[18px] font-semibold tabular-nums tracking-[-0.02em]">{value}</div>
      <div className="text-[11px] text-fg-3">{label}</div>
    </div>
  );
}

const RESOLVERS: { value: DohResolver; label: string }[] = [
  { value: 'cloudflare', label: 'Cloudflare (1.1.1.1) · DoH' },
  { value: 'quad9', label: 'Quad9 (9.9.9.9) · DoH, malware-filtering' },
  { value: 'google', label: 'Google Public DNS · DoH' },
  { value: 'system', label: 'Server’s system resolver' },
];

function NetworkSection() {
  const privacy = useSettings((s) => s.settings.privacy);
  const update = useSettings((s) => s.update);
  const clearPages = usePages((s) => s.clear);
  const [name, setName] = useState('example.com');
  const [result, setResult] = useState<DnsResponse | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="Network & server fetching"
      description="These settings control requests Aether’s server makes for you (Reader view, AI page context, search). Live view frames use your own browser, network and DNS."
    >
      <Row
        title="Server page analysis"
        description="Aether’s server fetches each page you open (without cookies) to check its embedding policy and extract reader text. Off: only Live view works and AI can’t read pages. Aether’s server never logs URLs."
      >
        <Toggle
          label="Server page analysis"
          checked={privacy.serverAnalysis}
          onChange={(v) => {
            update((s) => void (s.privacy.serverAnalysis = v));
            clearPages();
          }}
        />
      </Row>
      <Row title="Malicious-domain protection" description="Checks each host against Cloudflare’s malware-blocking resolver (1.1.1.2) before fetching or showing it.">
        <Toggle label="Malicious-domain protection" checked={privacy.safeBrowsing} onChange={(v) => update((s) => void (s.privacy.safeBrowsing = v))} />
      </Row>
      <Row title="DNS for server fetches" description="Encrypted DNS-over-HTTPS resolver used when Aether’s server looks up a site.">
        <Select label="DNS resolver" value={privacy.resolver} options={RESOLVERS} onChange={(v) => update((s) => void (s.privacy.resolver = v))} />
      </Row>
      <Row
        title="Images in Reader view"
        description="Direct: your browser loads images from the site (it sees your IP). Through Aether: the server fetches them (it doesn’t). Blocked: text only."
      >
        <Select
          label="Reader images"
          value={privacy.readerImages}
          options={[
            { value: 'direct', label: 'Direct (no referrer)' },
            { value: 'proxy', label: 'Through Aether' },
            { value: 'block', label: 'Blocked' },
          ]}
          onChange={(v) => update((s) => void (s.privacy.readerImages = v))}
        />
      </Row>
      <div className="mt-3 rounded-lg border border-line bg-surface p-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setResult(await dnsLookup(name.trim(), privacy.resolver));
            setBusy(false);
          }}
        >
          <div className="min-w-[200px] flex-1">
            <Field label="Test a DNS lookup" htmlFor="dns-name">
              <Input id="dns-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !name.trim()} icon={<Globe2 className="size-3.5" />}>
            {busy ? 'Looking up…' : 'Look up'}
          </Button>
        </form>
        {result && (
          <div className="mt-3 text-[12px]">
            {result.ok ? (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{result.resolver}</Badge>
                  {result.dnssecValidated ? <Badge tone="ok">DNSSEC validated</Badge> : <Badge>No DNSSEC</Badge>}
                  {result.safety.checked &&
                    (result.safety.blocked ? <Badge tone="danger">Flagged malicious</Badge> : <Badge tone="ok">Not flagged</Badge>)}
                </div>
                {result.answers.length === 0 && <p className="text-fg-3">No A/AAAA records.</p>}
                {result.answers.map((a, i) => (
                  <div key={i} className="font-mono text-[11.5px] text-fg-2">
                    {a.type} {a.data} <span className="text-fg-3">ttl {a.ttl}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-danger">{result.error.message}</p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function ProxySection() {
  const proxies = useSettings((s) => s.proxies);
  const active = useSettings((s) => s.settings.privacy.activeProxyId);
  const update = useSettings((s) => s.update);
  const remove = useSettings((s) => s.removeProxy);
  const clearPages = usePages((s) => s.clear);
  const [editing, setEditing] = useState<ProxyEntry | 'new' | null>(null);

  return (
    <Section
      title="Proxy profiles"
      description="Route Aether’s server-side fetches (Reader view, AI context, image proxy) through your own HTTP, HTTPS or SOCKS5 proxy. Live view frames always use your browser’s own connection. A proxy changes the IP sites see; it is not a VPN and doesn’t encrypt your device’s traffic."
      actions={
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
          Add proxy
        </Button>
      }
    >
      <Row title="Active proxy" description="Applies to new server fetches.">
        <Select
          label="Active proxy"
          value={active ?? ''}
          options={[{ value: '', label: 'None (direct)' }, ...proxies.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(v) => {
            update((s) => void (s.privacy.activeProxyId = v || null));
            clearPages();
          }}
        />
      </Row>
      {proxies.map((p) => (
        <Row key={p.id} title={p.name} description={`${p.type}://${p.username ? p.username + '@' : ''}${p.host}:${p.port}`}>
          {active === p.id && <Badge tone="accent">active</Badge>}
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              remove(p.id);
              void useVault.getState().set(`proxy:${p.id}`, null).catch(() => {});
            }}
          >
            Remove
          </Button>
        </Row>
      ))}
      {editing && <ProxyEditor entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function ProxyEditor({ entry, onClose }: { entry: ProxyEntry | null; onClose: () => void }) {
  const upsert = useSettings((s) => s.upsertProxy);
  const vaultLocked = useVault((s) => s.locked);
  const toast = useUi((s) => s.toast);
  const [f, setF] = useState({
    name: entry?.name ?? '',
    type: entry?.type ?? ('socks5' as ProxyEntry['type']),
    host: entry?.host ?? '',
    port: String(entry?.port ?? 1080),
    username: entry?.username ?? '',
    password: '',
  });
  const portNum = Number(f.port);
  const valid = f.host.trim() && Number.isInteger(portNum) && portNum > 0 && portNum < 65536;

  const save = async () => {
    const id = entry?.id ?? uid();
    try {
      if (f.password) await useVault.getState().set(`proxy:${id}`, f.password);
    } catch {
      toast('Unlock the vault (Settings → Vault) to save the password.', 'error');
      return;
    }
    upsert({
      id,
      name: f.name.trim() || `${f.type} ${f.host}`,
      type: f.type,
      host: f.host.trim(),
      port: portNum,
      username: f.username.trim() || undefined,
      hasPassword: !!f.password || !!entry?.hasPassword,
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? 'Edit proxy' : 'Add proxy'}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Save proxy
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Name" htmlFor="px-name">
            <Input id="px-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Home SOCKS" />
          </Field>
        </div>
        <Field label="Type">
          <Select
            label="Proxy type"
            value={f.type}
            options={[
              { value: 'socks5', label: 'SOCKS5' },
              { value: 'http', label: 'HTTP' },
              { value: 'https', label: 'HTTPS' },
            ]}
            onChange={(v) => setF({ ...f, type: v })}
          />
        </Field>
        <Field label="Port" htmlFor="px-port">
          <Input id="px-port" inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <Field label="Host" htmlFor="px-host" hint="Must be reachable from the public internet. Private and local addresses are rejected.">
            <Input id="px-host" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="proxy.example.com" />
          </Field>
        </div>
        <Field label="Username (optional)" htmlFor="px-user">
          <Input id="px-user" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={entry?.hasPassword ? 'Password (leave blank to keep)' : 'Password (optional)'} htmlFor="px-pass">
          <Input
            id="px-pass"
            type="password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            autoComplete="new-password"
            disabled={vaultLocked}
          />
        </Field>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">
        The password is stored in your vault on this device. It’s sent to Aether’s server only with each fetch that uses this proxy, and
        never stored or logged there.
      </p>
    </Modal>
  );
}

function PermissionsSection() {
  const site = useSettings((s) => s.sitePermissions);
  const defaults = useSettings((s) => s.settings.defaultPermissions);
  const update = useSettings((s) => s.update);
  const [host, setHost] = useState<string | null>(null);
  const hosts = Object.keys(site).sort();
  return (
    <Section
      title="Site permissions"
      description="Defaults for Live view frames. Powerful features (camera, microphone, location) are off unless you grant them per site, and your browser still asks too."
      actions={
        <Button size="sm" variant="ghost" onClick={() => update((s) => void (s.defaultPermissions = { ...DEFAULT_PERMISSIONS }))}>
          Reset defaults
        </Button>
      }
    >
      <div className="grid gap-x-6 sm:grid-cols-2">
        {PERMISSION_LABELS.map((p) => (
          <label key={p.key} className="flex items-center gap-3 border-t border-line py-2">
            <span className="flex size-6 items-center justify-center text-fg-3 [&>svg]:size-4">{p.icon}</span>
            <span className="flex-1 text-[12.5px]">{p.label}</span>
            <Toggle label={p.label} checked={defaults[p.key]} onChange={(v) => update((s) => void (s.defaultPermissions[p.key] = v))} />
          </label>
        ))}
      </div>
      {hosts.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Sites with custom permissions</h4>
          {hosts.map((h) => (
            <Row key={h} title={h} description={Object.entries(site[h]).map(([k, v]) => `${k}: ${v ? 'on' : 'off'}`).join(' · ')}>
              <Button size="sm" variant="ghost" onClick={() => setHost(h)}>
                Edit
              </Button>
            </Row>
          ))}
        </div>
      )}
      {host && <SitePermissionsDialog host={host} onClose={() => setHost(null)} />}
    </Section>
  );
}

function RetentionSection() {
  const retention = useSettings((s) => s.settings.privacy.historyRetentionDays);
  const update = useSettings((s) => s.update);
  const clearHistory = useBrowser((s) => s.clearHistory);
  const pruneHistory = useBrowser((s) => s.pruneHistory);
  const historyCount = useBrowser((s) => s.history.length);
  const chatCount = useChats((s) => s.chats.length);
  const clearChats = useChats((s) => s.clearChats);
  const clearPages = usePages((s) => s.clear);
  const ask = useUi((s) => s.ask);
  const toast = useUi((s) => s.toast);

  return (
    <Section title="Data retention" description="What Aether keeps on this device, and for how long. Aether’s server keeps nothing between requests, except encrypted sync data if you turn sync on.">
      <Row title="Keep history for" description={`${historyCount} entries stored.`}>
        <Select
          label="History retention"
          value={String(retention)}
          options={[
            { value: '1', label: '1 day' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' },
            { value: '0', label: 'Forever' },
          ]}
          onChange={(v) => {
            update((s) => void (s.privacy.historyRetentionDays = Number(v)));
            pruneHistory(Number(v));
          }}
        />
      </Row>
      <Row title="Clear browsing history" description="All workspaces, plus recently closed tabs.">
        <Button
          size="sm"
          variant="danger"
          icon={<History className="size-3.5" />}
          onClick={async () => {
            if (await ask({ title: 'Clear all history?', body: 'This can’t be undone.', confirmLabel: 'Clear history', danger: true })) {
              clearHistory();
              toast('History cleared', 'ok');
            }
          }}
        >
          Clear history
        </Button>
      </Row>
      <Row title="Clear AI conversations" description={`${chatCount} conversations stored.`}>
        <Button
          size="sm"
          variant="danger"
          icon={<Sparkles className="size-3.5" />}
          onClick={async () => {
            if (await ask({ title: 'Delete all AI conversations?', body: 'This can’t be undone.', confirmLabel: 'Delete conversations', danger: true })) {
              clearChats();
              toast('Conversations deleted', 'ok');
            }
          }}
        >
          Clear chats
        </Button>
      </Row>
      <Row title="Clear page cache" description="Reader text and page reports held in memory for this session.">
        <Button
          size="sm"
          variant="ghost"
          icon={<Database className="size-3.5" />}
          onClick={() => {
            clearPages();
            toast('Page cache cleared', 'ok');
          }}
        >
          Clear cache
        </Button>
      </Row>
      <p className="mt-3 text-[11.5px] text-fg-3">To erase everything, including bookmarks, notes and keys, use Settings → Data → Erase all data.</p>
    </Section>
  );
}

function Explainer() {
  const items: { icon: ReactNode; title: string; body: string }[] = [
    {
      icon: <HardDrive />,
      title: 'Local privacy',
      body: 'What’s stored on your device. Aether keeps your data in this browser and never uploads it. Private workspaces keep nothing at all. Your browser, OS and anyone with access to your device are outside Aether’s control.',
    },
    {
      icon: <Network />,
      title: 'Network privacy',
      body: 'Who can see your traffic. HTTPS hides page contents from your network, but your ISP or Wi-Fi operator can still see which sites you connect to (DNS and the TLS server name), unless you use encrypted DNS and a VPN.',
    },
    {
      icon: <Server />,
      title: 'IP masking (Reader view)',
      body: 'In Reader view, the site sees Aether’s server IP, not yours, and gets no cookies. Aether’s server does see the URL; it doesn’t log it. In Live view, the site sees your real IP, like any normal visit.',
    },
    {
      icon: <Globe2 />,
      title: 'Proxy vs VPN',
      body: 'An Aether proxy profile only reroutes Aether’s server-side fetches. A VPN reroutes and encrypts all traffic from your device. Neither one makes you anonymous: logins, cookies and fingerprinting can still identify you.',
    },
    {
      icon: <EyeOff />,
      title: 'Fingerprinting',
      body: 'Sites can identify a browser from its screen, fonts, GPU and other traits. A web app can’t change your browser’s fingerprint. Reader view avoids it entirely because site scripts never run. For Live view, use a browser with built-in protection (Brave, Firefox, Tor Browser).',
    },
    {
      icon: <ShieldCheck />,
      title: 'What Aether can’t do',
      body: 'Aether runs inside your browser, so it can’t intercept or block requests made by embedded sites, change your device’s DNS, or guarantee anonymity. It tells you which mode you’re in so you always know what’s exposed.',
    },
  ];
  return (
    <Section title="Understanding your privacy" description="Plain-language explanations, without overstated claims.">
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.title} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium [&>svg]:size-4 [&>svg]:text-accent">
              {it.icon}
              {it.title}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fg-2">{it.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
