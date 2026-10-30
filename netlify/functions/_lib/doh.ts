// DNS-over-HTTPS (JSON API) client plus system-resolver fallback.

import { promises as dns } from 'node:dns';
import type { DnsAnswer, DohResolver, SafetyReport } from '../../../shared/api.ts';
import { ApiErr, isRecord } from './http.ts';

export const DOH_ENDPOINTS: Record<Exclude<DohResolver, 'system'>, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  quad9: 'https://dns.quad9.net:5053/dns-query',
  google: 'https://dns.google/resolve',
};

/** Cloudflare's malware-blocking resolver (1.1.1.2). */
export const SECURITY_DOH_ENDPOINT = 'https://security.cloudflare-dns.com/dns-query';
export const SECURITY_PROVIDER = 'Cloudflare for Families (malware blocking)';

const DOH_TIMEOUT_MS = 3000;

export const RR_TYPES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  46: 'RRSIG',
  65: 'HTTPS',
};

export interface DohJson {
  status: number;
  ad: boolean;
  answers: DnsAnswer[];
  comments: string[];
}

/** Parses the Google/Cloudflare-style DNS JSON format. Throws on malformed input. */
export function parseDohJson(data: unknown): DohJson {
  if (!isRecord(data) || typeof data.Status !== 'number') throw new Error('Malformed DoH response');
  const answers: DnsAnswer[] = [];
  if (Array.isArray(data.Answer)) {
    for (const a of data.Answer) {
      if (!isRecord(a) || typeof a.type !== 'number' || typeof a.data !== 'string') continue;
      answers.push({
        type: RR_TYPES[a.type] ?? `TYPE${a.type}`,
        data: a.type === 5 ? a.data.replace(/\.$/, '') : a.data,
        ttl: typeof a.TTL === 'number' ? a.TTL : 0,
      });
    }
  }
  const comments: string[] = [];
  const c = data.Comment;
  if (typeof c === 'string') comments.push(c);
  else if (Array.isArray(c)) for (const x of c) if (typeof x === 'string') comments.push(x);
  return { status: data.Status, ad: data.AD === true, answers, comments };
}

export async function dohQuery(
  endpoint: string,
  name: string,
  type: 'A' | 'AAAA',
  signal?: AbortSignal,
): Promise<DohJson> {
  const url = new URL(endpoint);
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  const timeout = AbortSignal.timeout(DOH_TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 64 * 1024) throw new Error('DoH response too large');
  return parseDohJson(JSON.parse(text));
}

export interface ResolvedHost {
  addresses: Array<{ address: string; family: 4 | 6 }>;
  dohUsed: boolean;
  dohFallback: boolean;
  ad: boolean;
}

async function systemResolve(host: string): Promise<ResolvedHost['addresses']> {
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      throw new ApiErr('DNS_FAILED', 'The domain name could not be resolved.', 502);
    }
    throw new ApiErr('DNS_FAILED', 'DNS lookup failed.', 502);
  }
}

/**
 * Resolves `host` to A/AAAA addresses using the chosen DoH resolver, falling
 * back to the system resolver if DoH is unreachable (reported as dohFallback).
 * An NXDOMAIN answer from DoH is authoritative and is not retried.
 */
export async function resolveHost(host: string, resolver: DohResolver, signal?: AbortSignal): Promise<ResolvedHost> {
  if (resolver === 'system') {
    return { addresses: await systemResolve(host), dohUsed: false, dohFallback: false, ad: false };
  }
  const endpoint = DOH_ENDPOINTS[resolver];
  const results = await Promise.allSettled([dohQuery(endpoint, host, 'A', signal), dohQuery(endpoint, host, 'AAAA', signal)]);
  const ok = results.filter((r): r is PromiseFulfilledResult<DohJson> => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    if (signal?.aborted) throw signal.reason;
    return { addresses: await systemResolve(host), dohUsed: false, dohFallback: true, ad: false };
  }
  if (ok.some((r) => r.status === 3)) {
    throw new ApiErr('DNS_FAILED', 'The domain name does not exist.', 502);
  }
  const addresses: ResolvedHost['addresses'] = [];
  for (const r of ok) {
    for (const a of r.answers) {
      if (a.type === 'A') addresses.push({ address: a.data, family: 4 });
      else if (a.type === 'AAAA') addresses.push({ address: a.data, family: 6 });
    }
  }
  if (!addresses.length) {
    if (ok.every((r) => r.status !== 0)) {
      // SERVFAIL etc. from the resolver: try the system resolver.
      return { addresses: await systemResolve(host), dohUsed: false, dohFallback: true, ad: false };
    }
    throw new ApiErr('DNS_FAILED', 'The domain name has no address records.', 502);
  }
  // IPv4 first: serverless runtimes commonly lack IPv6 egress.
  addresses.sort((a, b) => a.family - b.family);
  return { addresses, dohUsed: true, dohFallback: false, ad: ok.every((r) => r.ad) };
}

/** Classifies a security-resolver answer: sinkhole addresses mean "blocked". */
export function isSinkholeAnswer(r: DohJson): boolean {
  return r.answers.some(
    (a) => (a.type === 'A' && a.data === '0.0.0.0') || (a.type === 'AAAA' && (a.data === '::' || a.data === '0:0:0:0:0:0:0:0')),
  );
}

/**
 * Checks `host` against Cloudflare's malware-filtering resolver. A failure of
 * the check itself yields `checked: false` rather than an error.
 */
export async function checkHostSafety(host: string, signal?: AbortSignal): Promise<SafetyReport> {
  try {
    const results = await Promise.allSettled([
      dohQuery(SECURITY_DOH_ENDPOINT, host, 'A', signal),
      dohQuery(SECURITY_DOH_ENDPOINT, host, 'AAAA', signal),
    ]);
    const ok = results.filter((r): r is PromiseFulfilledResult<DohJson> => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) {
      return { checked: false, blocked: false, provider: SECURITY_PROVIDER, detail: 'The safety resolver could not be reached.' };
    }
    if (ok.some(isSinkholeAnswer)) {
      return {
        checked: true,
        blocked: true,
        provider: SECURITY_PROVIDER,
        detail: `${host} is listed as malicious (malware or phishing).`,
      };
    }
    return { checked: true, blocked: false, provider: SECURITY_PROVIDER };
  } catch {
    return { checked: false, blocked: false, provider: SECURITY_PROVIDER, detail: 'The safety check failed.' };
  }
}
