import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from '../lib/storage.ts';
import type { ProxyEntry, Settings, SitePermissions } from '../lib/types.ts';

export const DEFAULT_PERMISSIONS: SitePermissions = {
  javascript: true,
  popups: true,
  forms: true,
  camera: false,
  microphone: false,
  geolocation: false,
  fullscreen: true,
  clipboard: false,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  searchEngine: 'aether',
  homepage: 'aether://newtab',
  readerFont: 'serif',
  sidebarCollapsed: false,
  aiPanelOpen: false,
  privacy: {
    serverAnalysis: true,
    safeBrowsing: true,
    resolver: 'cloudflare',
    readerImages: 'direct',
    activeProxyId: null,
    historyRetentionDays: 90,
  },
  ai: {
    provider: 'aether-nvidia',
    models: {
      'aether-nvidia': '',
      'aether-anthropic': '',
      anthropic: 'claude-sonnet-5-5',
      openai: 'gpt-5',
      compatible: '',
      ollama: 'llama3.2',
    },
    compatibleBaseUrl: 'https://openrouter.ai/api/v1',
    ollamaBaseUrl: 'http://localhost:11434',
    translateTo: 'English',
    confirmCloudContext: false,
    researchSources: 5,
  },
  defaultPermissions: DEFAULT_PERMISSIONS,
  sync: { id: null, lastPushedAt: null, lastPulledAt: null },
};

interface SettingsState {
  settings: Settings;
  /** Per-host overrides of defaultPermissions (host without www.). */
  sitePermissions: Record<string, Partial<SitePermissions>>;
  proxies: ProxyEntry[];
  update: (fn: (s: Settings) => void) => void;
  setSitePermission: (host: string, patch: Partial<SitePermissions>) => void;
  resetSitePermissions: (host: string) => void;
  upsertProxy: (p: ProxyEntry) => void;
  removeProxy: (id: string) => void;
  replaceAll: (s: Partial<Pick<SettingsState, 'settings' | 'sitePermissions' | 'proxies'>>) => void;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: clone(DEFAULT_SETTINGS),
      sitePermissions: {},
      proxies: [],
      update: (fn) =>
        set((st) => {
          const next = clone(st.settings);
          fn(next);
          return { settings: next };
        }),
      setSitePermission: (host, patch) =>
        set((st) => ({ sitePermissions: { ...st.sitePermissions, [host]: { ...st.sitePermissions[host], ...patch } } })),
      resetSitePermissions: (host) =>
        set((st) => {
          const next = { ...st.sitePermissions };
          delete next[host];
          return { sitePermissions: next };
        }),
      upsertProxy: (p) =>
        set((st) => ({
          proxies: st.proxies.some((x) => x.id === p.id) ? st.proxies.map((x) => (x.id === p.id ? p : x)) : [...st.proxies, p],
        })),
      removeProxy: (id) =>
        set((st) => ({
          proxies: st.proxies.filter((p) => p.id !== id),
          settings:
            st.settings.privacy.activeProxyId === id
              ? { ...st.settings, privacy: { ...st.settings.privacy, activeProxyId: null } }
              : st.settings,
        })),
      replaceAll: (s) => set((st) => ({ ...st, ...s })),
    }),
    {
      name: 'aether-settings',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ settings: s.settings, sitePermissions: s.sitePermissions, proxies: s.proxies }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<SettingsState>;
        const settings = { ...DEFAULT_SETTINGS, ...p.settings } as Settings;
        settings.privacy = { ...DEFAULT_SETTINGS.privacy, ...p.settings?.privacy };
        settings.ai = { ...DEFAULT_SETTINGS.ai, ...p.settings?.ai, models: { ...DEFAULT_SETTINGS.ai.models, ...p.settings?.ai?.models } };
        settings.defaultPermissions = { ...DEFAULT_PERMISSIONS, ...p.settings?.defaultPermissions };
        settings.sync = { ...DEFAULT_SETTINGS.sync, ...p.settings?.sync };
        return { ...current, settings, sitePermissions: p.sitePermissions ?? {}, proxies: p.proxies ?? [] };
      },
    },
  ),
);

export function permissionsFor(host: string): SitePermissions {
  const st = useSettings.getState();
  return { ...st.settings.defaultPermissions, ...st.sitePermissions[host] };
}
