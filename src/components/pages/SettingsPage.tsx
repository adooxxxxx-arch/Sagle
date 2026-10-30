import clsx from 'clsx';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ServerConfig } from '../../../shared/api.ts';
import { getServerConfig } from '../../lib/api.ts';
import { PROVIDERS, providerInfo } from '../../lib/ai/providers.ts';
import { downloadFile } from '../../lib/download.ts';
import { getErrors, subscribeErrors } from '../../lib/errorLog.ts';
import { clearAllLocalData, estimateStorage } from '../../lib/storage.ts';
import { applySnapshot, createSyncId, deleteSync, isValidSyncId, pullSync, pushSync, snapshot, type Snapshot } from '../../lib/sync.ts';
import type { AiProviderId, SearchEngine, ThemePref, ViewMode, ContextMode } from '../../lib/types.ts';
import { formatBytes, isMac, timeAgo } from '../../lib/util.ts';
import { SHORTCUTS, formatKeys } from '../../shortcuts.ts';
import { useBrowser } from '../../store/browser.ts';
import { useSettings } from '../../store/settings.ts';
import { useUi } from '../../store/ui.ts';
import { useVault } from '../../store/vault.ts';
import { Badge, Button, Field, Input, Row, Section, Segmented, Select, Toggle } from '../ui/index.tsx';
import { WORKSPACE_ICONS } from '../browser/Sidebar.tsx';
import { credentiallessSupported } from '../browser/WebView.tsx';

const NAV = [
  ['general', 'General'],
  ['workspaces', 'Workspaces'],
  ['ai', 'AI'],
  ['vault', 'Vault'],
  ['sync', 'Sync'],
  ['data', 'Data'],
  ['shortcuts', 'Shortcuts'],
  ['about', 'About'],
] as const;

export function SettingsPage({ section }: { section: string }) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (section) refs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [section]);
  const anchor = (id: string) => (el: HTMLDivElement | null) => void (refs.current[id] = el);

  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-4 py-6 sm:px-6">
      <nav className="sticky top-6 hidden h-fit w-40 shrink-0 flex-col gap-0.5 md:flex" aria-label="Settings sections">
        <h1 className="mb-3 px-2 text-[20px] font-semibold tracking-[-0.02em]">Settings</h1>
        {NAV.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="rounded-md px-2 py-1.5 text-left text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h1 className="px-1 text-[20px] font-semibold tracking-[-0.02em] md:hidden">Settings</h1>
        <div ref={anchor('general')} className="scroll-mt-4"><General /></div>
        <div ref={anchor('workspaces')} className="scroll-mt-4"><Workspaces /></div>
        <div ref={anchor('ai')} className="scroll-mt-4"><AiSettings /></div>
        <div ref={anchor('vault')} className="scroll-mt-4"><VaultSettings /></div>
        <div ref={anchor('sync')} className="scroll-mt-4"><SyncSettings /></div>
        <div ref={anchor('data')} className="scroll-mt-4"><DataSettings /></div>
        <div ref={anchor('shortcuts')} className="scroll-mt-4"><Shortcuts /></div>
        <div ref={anchor('about')} className="scroll-mt-4"><About /></div>
      </div>
    </div>
  );
}

function General() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <Section title="General">
      <Row title="Appearance">
        <Segmented<ThemePref>
          label="Theme"
          value={s.theme}
          onChange={(v) => update((x) => void (x.theme = v))}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </Row>
      <Row
        title="Search engine"
        description="Aether search runs on Aether’s server, so the engine never sees your IP. Other engines open as regular web pages."
      >
        <Select<SearchEngine>
          label="Search engine"
          value={s.searchEngine}
          onChange={(v) => update((x) => void (x.searchEngine = v))}
          options={[
            { value: 'aether', label: 'Aether (private)' },
            { value: 'duckduckgo', label: 'DuckDuckGo' },
            { value: 'brave', label: 'Brave Search' },
            { value: 'startpage', label: 'Startpage' },
            { value: 'google', label: 'Google' },
          ]}
        />
      </Row>
      <Row title="Home page" description="Where the Home button goes.">
        <Input
          aria-label="Home page"
          className="w-64"
          value={s.homepage}
          onChange={(e) => update((x) => void (x.homepage = e.target.value || 'aether://newtab'))}
        />
      </Row>
      <Row title="Reader font">
        <Segmented
          label="Reader font"
          value={s.readerFont}
          onChange={(v) => update((x) => void (x.readerFont = v))}
          options={[
            { value: 'serif', label: 'Serif' },
            { value: 'sans', label: 'Sans' },
          ]}
        />
      </Row>
    </Section>
  );
}

function Workspaces() {
  const workspaces = useBrowser((s) => s.workspaces);
  const update = useBrowser((s) => s.updateWorkspace);
  return (
    <Section title="Workspaces" description="Each workspace has its own tabs, history and AI conversations, and its own browsing defaults.">
      <div className="flex flex-col gap-3">
        {workspaces.map((w) => {
          const Icon = WORKSPACE_ICONS[w.icon];
          return (
            <div key={w.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 flex items-center gap-2">
                <Icon className="size-4 text-fg-2" />
                <span className="text-[13px] font-medium">{w.name}</span>
                {w.private && <Badge tone="accent">private</Badge>}
                {w.ephemeral && !w.private && <Badge>temporary</Badge>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Default view">
                  <Select<ViewMode>
                    label="Default view"
                    value={w.settings.defaultView}
                    onChange={(v) => update(w.id, { settings: { defaultView: v } })}
                    options={[
                      { value: 'auto', label: 'Auto (Live if the site allows it)' },
                      { value: 'reader', label: 'Reader first' },
                      { value: 'live', label: 'Always Live' },
                    ]}
                  />
                </Field>
                <Field label="Default AI context">
                  <Select<ContextMode>
                    label="Default AI context"
                    value={w.settings.aiContextDefault}
                    onChange={(v) => update(w.id, { settings: { aiContextDefault: v } })}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'page', label: 'Current page' },
                      { value: 'selection', label: 'Selected text' },
                      { value: 'workspace', label: 'Whole workspace' },
                    ]}
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
                <label className="flex items-center gap-2">
                  <Toggle
                    label="Record history"
                    checked={w.settings.historyEnabled && !w.private}
                    disabled={w.private}
                    onChange={(v) => update(w.id, { settings: { historyEnabled: v } })}
                  />
                  Record history
                </label>
                <label className="flex items-center gap-2">
                  <Toggle
                    label="Isolate cookies"
                    checked={w.settings.isolateCookies}
                    disabled={!credentiallessSupported}
                    onChange={(v) => update(w.id, { settings: { isolateCookies: v } })}
                  />
                  Isolate Live view cookies{!credentiallessSupported && ' (not supported in this browser)'}
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function AiSettings() {
  const ai = useSettings((s) => s.settings.ai);
  const update = useSettings((s) => s.update);
  const [config, setConfig] = useState<ServerConfig | null | undefined>(undefined);
  useEffect(() => {
    void getServerConfig().then(setConfig);
  }, []);
  const info = providerInfo(ai.provider);
  const serverModel =
    ai.provider === 'aether-nvidia' ? config?.ai.nvidia : ai.provider === 'aether-anthropic' ? config?.ai.anthropic : undefined;

  return (
    <Section
      title="AI"
      description="Choose who runs the model. Aether only sends what you pick in the assistant’s context selector, and private workspaces always ask first."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => {
          const serverAvail = p.id === 'aether-nvidia' ? config?.ai.nvidia.available : p.id === 'aether-anthropic' ? config?.ai.anthropic.available : undefined;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={ai.provider === p.id}
              onClick={() => update((s) => void (s.ai.provider = p.id))}
              className={clsx(
                'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                ai.provider === p.id ? 'border-accent/50 bg-accent-soft' : 'border-line bg-surface hover:bg-hover',
              )}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-medium">
                {p.label}
                {p.kind === 'server' && config !== undefined && (
                  <Badge tone={serverAvail ? 'ok' : 'neutral'}>{serverAvail ? 'available' : 'not configured'}</Badge>
                )}
                {p.kind === 'local' && <Badge tone="ok">on-device</Badge>}
              </span>
              <span className="text-[11.5px] leading-relaxed text-fg-3">{p.description}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {info.kind === 'server' && (
          <p className="text-[12px] text-fg-2">
            {serverModel?.available
              ? `Model: ${serverModel.model} (set by this deployment).`
              : 'This deployment has no server key for this provider. Its owner can add one in the hosting environment variables, or choose a provider that uses your own key.'}
          </p>
        )}
        {info.kind === 'byok' && <ApiKeyField name={info.keyName!} label={`${info.label} API key`} />}
        {(info.kind === 'byok' || info.kind === 'local') && (
          <Field label="Model" htmlFor="ai-model" hint={info.id === 'ollama' ? 'Any model you’ve pulled, e.g. llama3.2, qwen2.5, mistral.' : undefined}>
            <Input
              id="ai-model"
              value={ai.models[ai.provider]}
              onChange={(e) => update((s) => void (s.ai.models[ai.provider as AiProviderId] = e.target.value))}
              placeholder={info.id === 'anthropic' ? 'claude-sonnet-5-5' : info.id === 'openai' ? 'gpt-5' : 'model name'}
            />
          </Field>
        )}
        {info.id === 'compatible' && (
          <Field label="Base URL" htmlFor="ai-base" hint="Must support CORS for browser requests and the /chat/completions streaming API.">
            <Input id="ai-base" value={ai.compatibleBaseUrl} onChange={(e) => update((s) => void (s.ai.compatibleBaseUrl = e.target.value))} />
          </Field>
        )}
        {info.id === 'ollama' && (
          <Field
            label="Ollama URL"
            htmlFor="ai-ollama"
            hint={
              <>
                Start Ollama with <code className="font-mono">OLLAMA_ORIGINS={location.origin}</code> so this site may call it. Works in
                Chromium and Firefox; Safari blocks HTTPS pages from calling localhost.
              </>
            }
          >
            <Input id="ai-ollama" value={ai.ollamaBaseUrl} onChange={(e) => update((s) => void (s.ai.ollamaBaseUrl = e.target.value))} />
          </Field>
        )}
      </div>

      <div className="mt-4">
        <Row title="Translate into" description="Target language for translate actions.">
          <Input aria-label="Translation language" className="w-44" value={ai.translateTo} onChange={(e) => update((s) => void (s.ai.translateTo = e.target.value))} />
        </Row>
        <Row title="Research depth" description="How many web sources AI research reads.">
          <Select
            label="Research sources"
            value={String(ai.researchSources)}
            onChange={(v) => update((s) => void (s.ai.researchSources = Number(v)))}
            options={['3', '5', '8'].map((v) => ({ value: v, label: `${v} sources` }))}
          />
        </Row>
        <Row title="Always ask before sharing pages with cloud AI" description="Private workspaces always ask. Local models never need to.">
          <Toggle label="Confirm cloud context" checked={ai.confirmCloudContext} onChange={(v) => update((s) => void (s.ai.confirmCloudContext = v))} />
        </Row>
      </div>
    </Section>
  );
}

function ApiKeyField({ name, label }: { name: string; label: string }) {
  const stored = useVault((s) => s.secrets[name]);
  const locked = useVault((s) => s.locked);
  const mode = useVault((s) => s.mode);
  const toast = useUi((s) => s.toast);
  const [value, setValue] = useState('');
  if (locked) {
    return <p className="text-[12px] text-warn">Unlock your vault (below) to view or change API keys.</p>;
  }
  return (
    <Field
      label={label}
      htmlFor={`key-${name}`}
      hint={`Stored in your vault on this device${mode === 'encrypted' ? ', encrypted' : ''}. Sent only to the provider, straight from your browser.`}
    >
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await useVault.getState().set(name, value.trim() || null);
          setValue('');
          toast(value.trim() ? 'Key saved' : 'Key removed', 'ok');
        }}
      >
        <Input
          id={`key-${name}`}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={stored ? `•••••••• ${stored.slice(-4)}` : 'Paste your API key'}
        />
        <Button type="submit" disabled={!value.trim()}>
          Save
        </Button>
        {stored && (
          <Button
            variant="ghost"
            onClick={async () => {
              await useVault.getState().set(name, null);
              toast('Key removed', 'ok');
            }}
          >
            Remove
          </Button>
        )}
      </form>
    </Field>
  );
}

function VaultSettings() {
  const { mode, locked } = useVault();
  const toast = useUi((s) => s.toast);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  return (
    <Section
      title="Vault"
      description="API keys, proxy passwords and your sync passphrase. They never go to Aether’s server for storage. Encrypt the vault to protect them from anyone with access to this browser profile."
      actions={<Badge tone={mode === 'encrypted' ? 'ok' : 'neutral'}>{mode === 'encrypted' ? (locked ? 'encrypted · locked' : 'encrypted · unlocked') : 'stored on device'}</Badge>}
    >
      {mode === 'device' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pass.length < 8 || pass !== pass2) return;
            await useVault.getState().enableEncryption(pass);
            setPass('');
            setPass2('');
            toast('Vault encrypted', 'ok');
          }}
        >
          <div className="min-w-[180px] flex-1">
            <Field label="New vault passphrase" htmlFor="v1" hint="At least 8 characters. If you forget it, the vault can’t be recovered.">
              <Input id="v1" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
          </div>
          <div className="min-w-[180px] flex-1">
            <Field label="Confirm passphrase" htmlFor="v2">
              <Input id="v2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary" icon={<Lock className="size-3.5" />} disabled={pass.length < 8 || pass !== pass2} className="mb-[22px]">
            Encrypt vault
          </Button>
        </form>
      )}
      {mode === 'encrypted' && locked && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await useVault.getState().unlock(pass);
            setPass('');
            toast(ok ? 'Vault unlocked for this session' : 'Wrong passphrase', ok ? 'ok' : 'error');
          }}
        >
          <div className="min-w-[200px] flex-1">
            <Field label="Vault passphrase" htmlFor="vu">
              <Input id="vu" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary" icon={<Unlock className="size-3.5" />} disabled={!pass}>
            Unlock
          </Button>
        </form>
      )}
      {mode === 'encrypted' && !locked && (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Lock className="size-3.5" />} onClick={() => useVault.getState().lock()}>
            Lock now
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await useVault.getState().disableEncryption();
              toast('Vault decrypted', 'ok');
            }}
          >
            Remove encryption
          </Button>
        </div>
      )}
    </Section>
  );
}

function SyncSettings() {
  const sync = useSettings((s) => s.settings.sync);
  const update = useSettings((s) => s.update);
  const vaultLocked = useVault((s) => s.locked);
  const savedPass = useVault((s) => s.secrets['sync:passphrase']);
  const toast = useUi((s) => s.toast);
  const ask = useUi((s) => s.ask);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const passphrase = savedPass || pass;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Encrypted sync"
      description="Optional. Bookmarks, notes, collections, reading list, workspaces and settings are encrypted in your browser (AES-256-GCM) before upload. Aether’s server stores only ciphertext under a random sync code. No account needed. History, open tabs, API keys and private workspaces are never synced."
    >
      {!sync.id ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => update((s) => void (s.sync.id = createSyncId()))}>
              Create a sync code
            </Button>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (isValidSyncId(code.trim())) update((s) => void (s.sync.id = code.trim()));
              else toast('That isn’t a valid sync code.', 'error');
            }}
          >
            <div className="min-w-[220px] flex-1">
              <Field label="…or connect to an existing code" htmlFor="sync-code">
                <Input id="sync-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="22-character sync code" className="font-mono" />
              </Field>
            </div>
            <Button type="submit" disabled={!code.trim()}>
              Connect
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Sync code" hint="Use this code and the same passphrase on another device. Anyone with both can read your synced data.">
            <div className="flex gap-2">
              <Input readOnly value={sync.id} className="font-mono" aria-label="Sync code" />
              <Button
                icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(sync.id!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </Field>
          {!savedPass && (
            <Field label="Sync passphrase" htmlFor="sync-pass" hint="Never leaves this device. Choose something strong: it’s the only thing protecting your synced data.">
              <div className="flex gap-2">
                <Input id="sync-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                <Button
                  variant="ghost"
                  disabled={pass.length < 8 || vaultLocked}
                  onClick={async () => {
                    await useVault.getState().set('sync:passphrase', pass);
                    setPass('');
                    toast('Passphrase saved in vault', 'ok');
                  }}
                >
                  Remember
                </Button>
              </div>
            </Field>
          )}
          {savedPass && (
            <p className="flex items-center gap-2 text-[12px] text-fg-2">
              <KeyRound className="size-3.5 text-ok" /> Passphrase remembered in your vault.{' '}
              <button type="button" className="text-accent" onClick={() => void useVault.getState().set('sync:passphrase', null)}>
                Forget
              </button>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<Upload className="size-3.5" />}
              disabled={!!busy || passphrase.length < 8}
              onClick={() =>
                run('push', async () => {
                  await pushSync(sync.id!, passphrase);
                  update((s) => void (s.sync.lastPushedAt = Date.now()));
                  toast('Encrypted snapshot uploaded', 'ok');
                })
              }
            >
              {busy === 'push' ? 'Uploading…' : 'Upload from this device'}
            </Button>
            <Button
              icon={<RefreshCw className="size-3.5" />}
              disabled={!!busy || passphrase.length < 8}
              onClick={() =>
                run('pull', async () => {
                  await pullSync(sync.id!, passphrase);
                  update((s) => void (s.sync.lastPulledAt = Date.now()));
                  toast('Merged synced data into this device', 'ok');
                })
              }
            >
              {busy === 'pull' ? 'Downloading…' : 'Download & merge'}
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              disabled={!!busy}
              onClick={async () => {
                if (!(await ask({ title: 'Delete synced data?', body: 'Removes the encrypted copy from Aether’s server and disconnects this device. Local data stays.', confirmLabel: 'Delete synced copy', danger: true }))) return;
                await run('delete', async () => {
                  await deleteSync(sync.id!);
                  update((s) => void (s.sync = { id: null, lastPulledAt: null, lastPushedAt: null }));
                });
              }}
            >
              Delete & disconnect
            </Button>
          </div>
          <p className="text-[11.5px] text-fg-3">
            {sync.lastPushedAt ? `Last upload ${timeAgo(sync.lastPushedAt)}. ` : ''}
            {sync.lastPulledAt ? `Last download ${timeAgo(sync.lastPulledAt)}.` : ''}
            {passphrase.length > 0 && passphrase.length < 8 && ' Passphrase must be at least 8 characters.'}
          </p>
        </div>
      )}
    </Section>
  );
}

function DataSettings() {
  const toast = useUi((s) => s.toast);
  const ask = useUi((s) => s.ask);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof estimateStorage>>>(null);
  const [withHistory, setWithHistory] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void estimateStorage().then(setStorage);
  }, []);
  return (
    <Section title="Data" description="Everything Aether stores lives in this browser. Export it, move it, or erase it.">
      <Row title="Storage used" description={storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} available to this site.` : 'Not reported by this browser.'}>
        {storage?.persisted ? (
          <Badge tone="ok">persistent</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ok = await navigator.storage?.persist?.();
              toast(ok ? 'Storage marked persistent' : 'The browser declined persistent storage', ok ? 'ok' : 'info');
              setStorage(await estimateStorage());
            }}
          >
            Request persistence
          </Button>
        )}
      </Row>
      <Row title="Export data" description="A JSON file with bookmarks, notes, collections, reading list, workspaces and settings (no API keys).">
        <label className="flex items-center gap-2 text-[12px] text-fg-2">
          <Toggle label="Include history" checked={withHistory} onChange={setWithHistory} /> history
        </label>
        <Button
          size="sm"
          icon={<Download className="size-3.5" />}
          onClick={() => downloadFile(`aether-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot({ includeHistory: withHistory }), null, 2), 'application/json')}
        >
          Export
        </Button>
      </Row>
      <Row title="Import data" description="Merges an Aether export into this device. Newer copies of each item win; nothing is deleted.">
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              applySnapshot(JSON.parse(await f.text()) as Snapshot);
              toast('Import complete', 'ok');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Import failed', 'error');
            }
          }}
        />
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => file.current?.click()}>
          Import
        </Button>
      </Row>
      <Row title="Erase all data" description="Deletes everything Aether stored in this browser: workspaces, history, library, chats, settings and the vault.">
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="size-3.5" />}
          onClick={async () => {
            if (!(await ask({ title: 'Erase all Aether data?', body: 'Everything on this device will be permanently deleted. Synced copies on the server aren’t affected.', confirmLabel: 'Erase everything', danger: true }))) return;
            await clearAllLocalData();
            location.reload();
          }}
        >
          Erase all data
        </Button>
      </Row>
    </Section>
  );
}

function Shortcuts() {
  return (
    <Section title="Keyboard shortcuts" description="Browsers keep Ctrl/⌘+T, W and L for themselves, so Aether’s tab shortcuts use Alt/⌥.">
      <div className="grid gap-x-8 sm:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between border-t border-line py-2 text-[12.5px]">
            <span className="text-fg-2">{s.action}</span>
            <kbd>{formatKeys(s.keys, isMac)}</kbd>
          </div>
        ))}
      </div>
    </Section>
  );
}

function About() {
  const errors = useSyncExternalStore(subscribeErrors, getErrors);
  const [config, setConfig] = useState<ServerConfig | null | undefined>(undefined);
  useEffect(() => {
    void getServerConfig().then(setConfig);
  }, []);
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-4 border-t border-line py-2 text-[12.5px] first:border-t-0">
      <span className="text-fg-3">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
  return (
    <Section title="About Aether" description="A private, AI-native browser that runs from a link. No telemetry: errors are only logged locally, below.">
      {row('Server API', config === undefined ? 'checking…' : config ? <Badge tone="ok">online · v{config.version}</Badge> : <Badge tone="danger">unreachable</Badge>)}
      {config && row('Search provider', config.search.provider)}
      {config && row('Rate limits', `${config.limits.pageFetchesPerMinute} page fetches/min · ${config.limits.aiRequestsPerMinute} AI requests/min`)}
      {row('Credentialless iframes', credentiallessSupported ? 'supported' : 'not supported in this browser')}
      <h4 className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Local error log ({errors.length})</h4>
      {errors.length === 0 ? (
        <p className="text-[12px] text-fg-3">No errors this session.</p>
      ) : (
        <div className="scroll-thin max-h-48 overflow-y-auto font-mono text-[11px] text-fg-2">
          {errors.map((e, i) => (
            <div key={i} className="border-t border-line py-1">
              {new Date(e.at).toLocaleTimeString()} [{e.source}] {e.message}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
