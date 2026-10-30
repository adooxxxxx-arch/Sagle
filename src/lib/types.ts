import type { DohResolver, ProxyProfile } from '../../shared/api.ts';

export type ViewMode = 'auto' | 'live' | 'reader';
export type ContextMode = 'none' | 'page' | 'selection' | 'tabs' | 'workspace';
export type ThemePref = 'system' | 'dark' | 'light';
export type SearchEngine = 'aether' | 'duckduckgo' | 'brave' | 'startpage' | 'google';
export type WorkspaceIcon = 'user' | 'flask' | 'briefcase' | 'eye-off' | 'code' | 'book' | 'globe' | 'star' | 'heart' | 'zap';

export interface WorkspaceSettings {
  defaultView: ViewMode;
  aiContextDefault: ContextMode;
  historyEnabled: boolean;
  /** Load live views with `<iframe credentialless>` (ephemeral cookie jar, Chromium only). */
  isolateCookies: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  icon: WorkspaceIcon;
  /** Private: memory-only, no history, credentialless live views, AI context requires consent. */
  private: boolean;
  /** Ephemeral: nothing about this workspace's tabs, history or chats is written to disk. */
  ephemeral: boolean;
  settings: WorkspaceSettings;
  activeTabId: string | null;
  splitTabId: string | null;
  createdAt: number;
}

export interface Tab {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  favicon?: string;
  pinned: boolean;
  groupId: string | null;
  nav: { entries: string[]; index: number };
  viewMode: ViewMode;
  /** Bumped on reload so the view re-mounts and data refetches. */
  reloadKey: number;
  createdAt: number;
}

export interface TabGroup {
  id: string;
  workspaceId: string;
  name: string;
  color: GroupColor;
  collapsed: boolean;
}

export type GroupColor = 'slate' | 'blue' | 'teal' | 'green' | 'yellow' | 'red' | 'pink';

export interface ClosedTab {
  tab: Tab;
  closedAt: number;
}

export interface HistoryItem {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface SavedSession {
  id: string;
  name: string;
  workspaceId: string;
  tabs: { url: string; title: string; pinned: boolean }[];
  createdAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  folder: string;
  favicon?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingItem {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  /** Offline snapshot of the reader text, so it stays readable without refetching. */
  text: string;
  read: boolean;
  savedAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  sourceUrl?: string;
  workspaceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  text?: string;
  note?: string;
  addedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  items: CollectionItem[];
  createdAt: number;
  updatedAt: number;
}

export interface Highlight {
  id: string;
  url: string;
  quote: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadRecord {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sourceUrl?: string;
  createdAt: number;
}

export interface SitePermissions {
  javascript: boolean;
  popups: boolean;
  forms: boolean;
  camera: boolean;
  microphone: boolean;
  geolocation: boolean;
  fullscreen: boolean;
  clipboard: boolean;
}

export interface ProxyEntry extends Omit<ProxyProfile, 'password'> {
  id: string;
  name: string;
  /** Password lives in the vault under `proxy:<id>`. */
  hasPassword: boolean;
}

export type AiProviderId = 'aether-nvidia' | 'aether-anthropic' | 'anthropic' | 'openai' | 'compatible' | 'ollama';

export interface AiSettings {
  provider: AiProviderId;
  models: Record<AiProviderId, string>;
  compatibleBaseUrl: string;
  ollamaBaseUrl: string;
  translateTo: string;
  /** Ask before sending page content to any non-local provider (always on in private workspaces). */
  confirmCloudContext: boolean;
  researchSources: number;
}

export interface PrivacySettings {
  /** Let the Aether server fetch pages to check embeddability and power Reader/AI. */
  serverAnalysis: boolean;
  safeBrowsing: boolean;
  resolver: DohResolver;
  readerImages: 'direct' | 'proxy' | 'block';
  activeProxyId: string | null;
  historyRetentionDays: number;
}

export interface Settings {
  theme: ThemePref;
  searchEngine: SearchEngine;
  homepage: string;
  readerFont: 'serif' | 'sans';
  sidebarCollapsed: boolean;
  aiPanelOpen: boolean;
  privacy: PrivacySettings;
  ai: AiSettings;
  defaultPermissions: SitePermissions;
  sync: { id: string | null; lastPushedAt: number | null; lastPulledAt: number | null };
}

export interface Source {
  n: number;
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** What the user chose to share for this turn — shown on the message for transparency. */
  contextLabel?: string;
  sources?: Source[];
  provider?: string;
  model?: string;
  error?: string;
  pending?: boolean;
  createdAt: number;
}

export interface Chat {
  id: string;
  workspaceId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
