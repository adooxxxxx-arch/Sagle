// Contract between the Aether frontend (src/) and the Netlify backend (netlify/).
// Keep this file dependency-free: it is imported by both sides.

export type DohResolver = 'cloudflare' | 'quad9' | 'google' | 'system';

export interface ProxyProfile {
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface PageRequest {
  url: string;
  /** Resolver used for the server-side fetch's DNS lookups. */
  resolver?: DohResolver;
  /** Check the host against a malware-filtering resolver before fetching. */
  safeBrowsing?: boolean;
  /** Optional user-supplied upstream proxy for this server-side fetch. */
  proxy?: ProxyProfile | null;
  /** Skip readability extraction (probe embedding + metadata only). */
  probeOnly?: boolean;
}

export interface EmbedInfo {
  /** Whether the page's own headers permit framing it inside Aether. */
  allowed: boolean | 'unknown';
  reason: string;
  xFrameOptions?: string;
  frameAncestors?: string;
}

export interface PageMeta {
  title: string;
  siteName?: string;
  byline?: string;
  description?: string;
  lang?: string;
  favicon?: string;
  image?: string;
  publishedTime?: string;
}

export interface ReaderContent {
  available: boolean;
  /** Readability HTML. Untrusted: the client sanitizes it again with DOMPurify. */
  html: string;
  text: string;
  excerpt: string;
  wordCount: number;
}

export type TrackerCategory = 'advertising' | 'analytics' | 'social' | 'fingerprinting' | 'tag-manager' | 'session-replay' | 'other';

export interface TrackerHit {
  domain: string;
  category: TrackerCategory;
  company?: string;
  /** Element types where this domain was referenced in the page HTML. */
  kinds: string[];
}

export interface PagePrivacyReport {
  /** <script> elements removed by Aether's reader pipeline. */
  scriptsStripped: number;
  /** Known tracker domains referenced by the page HTML (never loaded by reader view). */
  trackers: TrackerHit[];
  /** Distinct third-party hostnames referenced by the page HTML. */
  thirdPartyDomains: string[];
  /** Cookie names the site tried to set on Aether's server fetch. All are discarded. */
  cookiesReceived: string[];
  /** Always 0: the server fetch never sends cookies. */
  cookiesSent: 0;
}

export interface NetworkReport {
  resolver: DohResolver;
  dohUsed: boolean;
  /** DoH failed and the system resolver was used instead. */
  dohFallback: boolean;
  resolvedIp?: string;
  proxy: { type: ProxyProfile['type']; host: string; port: number } | null;
  tls: boolean;
  timingMs: number;
}

export interface SafetyReport {
  checked: boolean;
  blocked: boolean;
  provider?: string;
  detail?: string;
}

export interface PageResult {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  redirects: string[];
  https: boolean;
  embed: EmbedInfo;
  meta: PageMeta;
  reader: ReaderContent;
  privacy: PagePrivacyReport;
  network: NetworkReport;
  safety: SafetyReport;
}

export type ApiErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_PRIVATE_NETWORK'
  | 'BLOCKED_MALICIOUS'
  | 'DNS_FAILED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED'
  | 'PROXY_ERROR'
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'INTERNAL';

export interface ApiError {
  ok: false;
  error: { code: ApiErrorCode; message: string; status?: number };
  safety?: SafetyReport;
  finalUrl?: string;
}

export type PageResponse = PageResult | ApiError;

export interface SearchRequest {
  q: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  ok: true;
  provider: 'brave' | 'duckduckgo' | 'wikipedia';
  query: string;
  results: SearchResultItem[];
  notice?: string;
}

export type SearchResponse = SearchResult | ApiError;

export interface DnsAnswer {
  type: string;
  data: string;
  ttl: number;
}

export interface DnsResult {
  ok: true;
  name: string;
  resolver: DohResolver;
  answers: DnsAnswer[];
  /** DNSSEC "authenticated data" flag reported by the resolver. */
  dnssecValidated: boolean;
  safety: SafetyReport;
}

export type DnsResponse = DnsResult | ApiError;

export type ServerAiProvider = 'nvidia' | 'anthropic';

export interface ServerConfig {
  version: string;
  ai: Record<ServerAiProvider, { available: boolean; model: string }>;
  search: { provider: SearchResult['provider']; braveConfigured: boolean };
  sync: { available: boolean };
  limits: { pageFetchesPerMinute: number; aiRequestsPerMinute: number; maxPageBytes: number };
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ServerAiRequest {
  provider: ServerAiProvider;
  system: string;
  messages: AiChatMessage[];
  maxTokens?: number;
}

/** Response header telling the client which SSE dialect /api/ai streams back. */
export const AI_STREAM_FORMAT_HEADER = 'x-aether-stream-format';
export type AiStreamFormat = 'openai' | 'anthropic';

export interface SyncEnvelope {
  v: 1;
  /** base64 AES-GCM ciphertext. The server never sees plaintext or the passphrase. */
  ciphertext: string;
  iv: string;
  salt: string;
  updatedAt: string;
}

export const SYNC_MAX_BYTES = 2 * 1024 * 1024;
/** Sync ids are 16 random bytes, base64url-encoded without padding. */
export const SYNC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
