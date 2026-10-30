// SSRF-safe server-side fetcher used by /api/page and /api/image.
//
// Guarantees:
//  * every hop (initial URL + each redirect) is re-validated: scheme, port,
//    credentials, IP literals, local-like names;
//  * DNS resolution happens inside undici's `connect.lookup` hook, and the
//    addresses it validates are exactly the ones the socket connects to, so a
//    DNS-rebinding answer cannot slip a private address in after the check;
//  * proxies must themselves resolve to public addresses (no pivoting into
//    private networks through a user-supplied proxy);
//  * total time and decompressed body size are capped;
//  * no cookies, no referer are ever sent.

import type { LookupAddress, LookupOptions } from 'node:dns';
import { Agent, ProxyAgent, Socks5ProxyAgent, buildConnector, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { DohResolver, NetworkReport, ProxyProfile } from '../../../shared/api.ts';
import { resolveHost, type ResolvedHost } from './doh.ts';
import { USER_AGENT, allowPrivateNetwork } from './env.ts';
import { ApiErr, isRecord } from './http.ts';
import { ipVersion, isPrivateAddress } from './ip.ts';
import { isLocalLikeName, isValidHostname, normalizeHost, validateTargetUrl } from './url.ts';

export interface SecureFetchOptions {
  resolver: DohResolver;
  proxy?: ProxyProfile | null;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  accept: string;
  /** Decide from the final response whether its body is needed. */
  shouldReadBody: (contentType: string, status: number) => boolean;
  /** Called with every URL about to be requested (initial + redirect hops). */
  onHop?: (url: URL) => void;
}

export interface SecureFetchResult {
  finalUrl: URL;
  status: number;
  headers: Headers;
  contentType: string;
  body: Uint8Array | null;
  /** URLs that answered with a redirect, in order (the final URL is not included). */
  redirects: string[];
  /** Names of cookies the site tried to set across all hops (all discarded). */
  cookies: string[];
  network: NetworkReport;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const blockedPrivate = () =>
  new ApiErr('BLOCKED_PRIVATE_NETWORK', 'Requests to private or reserved network addresses are blocked.', 403);

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type LookupFn = (hostname: string, options: LookupOptions | number | undefined, callback: LookupCallback) => void;

interface LookupState {
  dohUsed: boolean;
  dohFallback: boolean;
  resolvedIp?: string;
}

/**
 * Builds a `lookup` function suitable for net/tls `connect` options that
 * resolves via `resolver` and rejects private addresses. Handles both the
 * single-address and `options.all` (array) callback forms.
 */
export function makeSafeLookup(
  resolver: DohResolver,
  state: LookupState,
  signal: AbortSignal,
  allowPrivate: boolean,
  blockedError: () => ApiErr = blockedPrivate,
): LookupFn {
  const cache = new Map<string, Promise<ResolvedHost>>();
  const resolveSafe = async (hostname: string): Promise<ResolvedHost['addresses']> => {
    const host = normalizeHost(hostname);
    const v = ipVersion(host);
    if (v) {
      if (!allowPrivate && isPrivateAddress(host)) throw blockedError();
      return [{ address: host, family: v }];
    }
    if (!allowPrivate && isLocalLikeName(host)) throw blockedError();
    let p = cache.get(host);
    if (!p) {
      p = resolveHost(host, resolver, signal);
      cache.set(host, p);
    }
    const r = await p;
    if (r.dohUsed) state.dohUsed = true;
    if (r.dohFallback) state.dohFallback = true;
    // Fail closed: if ANY answer is private the host is refused.
    if (!allowPrivate && r.addresses.some((a) => isPrivateAddress(a.address))) throw blockedError();
    return r.addresses;
  };

  return (hostname, options, callback) => {
    const opts: LookupOptions = typeof options === 'number' ? { family: options } : (options ?? {});
    resolveSafe(hostname).then(
      (addrs) => {
        const fam = opts.family === 4 || opts.family === 6 ? opts.family : opts.family === 'IPv4' ? 4 : opts.family === 'IPv6' ? 6 : 0;
        const list = fam ? addrs.filter((a) => a.family === fam) : addrs;
        if (!list.length) {
          const e: NodeJS.ErrnoException = new Error('No address for requested family');
          e.code = 'ENOTFOUND';
          callback(e, opts.all ? [] : '', 0);
          return;
        }
        state.resolvedIp = list[0]!.address;
        if (opts.all) callback(null, list.map((a) => ({ address: a.address, family: a.family })));
        else callback(null, list[0]!.address, list[0]!.family);
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, opts.all ? [] : '', 0),
    );
  };
}

/** Validates the user-supplied proxy profile shape. */
export function validateProxy(p: unknown): ProxyProfile | null {
  if (p === undefined || p === null) return null;
  if (!isRecord(p)) throw new ApiErr('BAD_REQUEST', 'proxy must be an object.', 400);
  const { type, host, port, username, password } = p;
  if (type !== 'http' && type !== 'https' && type !== 'socks5') {
    throw new ApiErr('BAD_REQUEST', 'proxy.type must be http, https or socks5.', 400);
  }
  if (typeof host !== 'string' || !host.trim()) throw new ApiErr('BAD_REQUEST', 'proxy.host is required.', 400);
  const h = normalizeHost(host.trim());
  if (!ipVersion(h) && !isValidHostname(h)) throw new ApiErr('BAD_REQUEST', 'proxy.host is not a valid host name.', 400);
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiErr('BAD_REQUEST', 'proxy.port must be an integer between 1 and 65535.', 400);
  }
  if (username !== undefined && (typeof username !== 'string' || username.length > 256)) {
    throw new ApiErr('BAD_REQUEST', 'proxy.username is invalid.', 400);
  }
  if (password !== undefined && (typeof password !== 'string' || password.length > 256)) {
    throw new ApiErr('BAD_REQUEST', 'proxy.password is invalid.', 400);
  }
  return {
    type,
    host: h,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

function hostForUrl(h: string): string {
  return ipVersion(h) === 6 ? `[${h}]` : h;
}

const proxyBlocked = () =>
  new ApiErr('BLOCKED_PRIVATE_NETWORK', 'The proxy host is a private or reserved address, which is not allowed.', 403);

function buildDispatcher(
  opts: SecureFetchOptions,
  state: LookupState,
  signal: AbortSignal,
  allowPrivate: boolean,
): Dispatcher {
  const connectTimeout = Math.min(opts.timeoutMs, 6000);
  const proxy = opts.proxy;
  if (!proxy) {
    return new Agent({
      connect: { lookup: makeSafeLookup(opts.resolver, state, signal, allowPrivate), timeout: connectTimeout },
    });
  }

  // The proxy host itself must be public. IP literals never reach `lookup`,
  // so check them here; names are checked inside the lookup hook.
  if (!allowPrivate) {
    if (ipVersion(proxy.host) ? isPrivateAddress(proxy.host) : isLocalLikeName(proxy.host)) throw proxyBlocked();
  }
  const proxyLookup = makeSafeLookup(opts.resolver, state, signal, allowPrivate, proxyBlocked);

  if (proxy.type === 'socks5') {
    return new Socks5ProxyAgent(`socks5://${hostForUrl(proxy.host)}:${proxy.port}`, {
      ...(proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : {}),
      connect: buildConnector({ lookup: proxyLookup, timeout: connectTimeout } as buildConnector.BuildOptions),
    });
  }
  const token = proxy.username
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}`
    : undefined;
  return new ProxyAgent({
    uri: `${proxy.type}://${hostForUrl(proxy.host)}:${proxy.port}`,
    ...(token ? { token } : {}),
    // undici builds the proxy-side connector from `proxyTls` for both http and
    // https proxies, so the lookup hook applies to the proxy connection.
    proxyTls: { lookup: proxyLookup, timeout: connectTimeout } as buildConnector.BuildOptions,
  });
}

function errorChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  const queue: unknown[] = [err];
  while (queue.length && out.length < 20) {
    const e = queue.shift();
    if (e === undefined || e === null) continue;
    out.push(e);
    if (e instanceof AggregateError) queue.push(...e.errors);
    if (typeof e === 'object' && 'cause' in e) queue.push((e as { cause?: unknown }).cause);
  }
  return out;
}

export function mapFetchError(err: unknown, signal: AbortSignal, viaProxy: boolean): ApiErr {
  const chain = errorChain(err);
  const direct = chain.find((e): e is ApiErr => e instanceof ApiErr);
  if (direct) return direct;
  if (signal.aborted && signal.reason instanceof ApiErr) return signal.reason;
  const codes = chain
    .map((e) => (typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''))
    .filter(Boolean);
  const names = chain.map((e) => (e instanceof Error ? e.name : ''));
  const has = (...c: string[]) => codes.some((x) => c.includes(x));
  if (has('UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT') || names.includes('TimeoutError')) {
    return new ApiErr(viaProxy ? 'PROXY_ERROR' : 'TIMEOUT', viaProxy ? 'The proxy timed out.' : 'The site took too long to respond.', viaProxy ? 502 : 504);
  }
  if (viaProxy) {
    return new ApiErr('PROXY_ERROR', 'The proxy could not be reached or refused the connection.', 502);
  }
  if (has('ENOTFOUND', 'EAI_AGAIN', 'ENODATA')) {
    return new ApiErr('DNS_FAILED', 'The domain name could not be resolved.', 502);
  }
  if (codes.some((c) => c.includes('CERT') || c.startsWith('ERR_TLS') || c.startsWith('ERR_SSL') || c === 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
    return new ApiErr('UPSTREAM_ERROR', 'The site presented an invalid TLS certificate.', 502);
  }
  if (has('ECONNREFUSED')) return new ApiErr('UPSTREAM_ERROR', 'The site refused the connection.', 502);
  if (has('ECONNRESET', 'UND_ERR_SOCKET')) return new ApiErr('UPSTREAM_ERROR', 'The connection to the site was reset.', 502);
  return new ApiErr('UPSTREAM_ERROR', 'Could not fetch the page from the site.', 502);
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number, abort: () => void): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      abort();
      await reader.cancel().catch(() => {});
      throw new ApiErr('TOO_LARGE', `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function cookieNames(setCookies: string[]): string[] {
  const out: string[] = [];
  for (const c of setCookies) {
    const eq = c.indexOf('=');
    const name = (eq === -1 ? c : c.slice(0, eq)).trim().slice(0, 100);
    if (name) out.push(name);
  }
  return out;
}

export async function secureFetch(startUrl: URL, opts: SecureFetchOptions): Promise<SecureFetchResult> {
  const started = Date.now();
  const allowPrivate = allowPrivateNetwork();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ApiErr('TIMEOUT', 'The site took too long to respond.', 504)),
    opts.timeoutMs,
  );
  const state: LookupState = { dohUsed: false, dohFallback: false };
  let dispatcher: Dispatcher | undefined;
  const redirects: string[] = [];
  const cookies = new Set<string>();
  let current = startUrl;

  try {
    dispatcher = buildDispatcher(opts, state, controller.signal, allowPrivate);
    for (let hop = 0; ; hop++) {
      opts.onHop?.(current);
      const res = await undiciFetch(current, {
        dispatcher,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept,
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      for (const name of cookieNames(res.headers.getSetCookie())) {
        if (cookies.size < 100) cookies.add(name);
      }

      const location = res.headers.get('location');
      if (REDIRECT_STATUSES.has(res.status) && location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= opts.maxRedirects) {
          throw new ApiErr('UPSTREAM_ERROR', `Too many redirects (more than ${opts.maxRedirects}).`, 502);
        }
        let nextRaw: string;
        try {
          nextRaw = new URL(location, current).href;
        } catch {
          throw new ApiErr('UPSTREAM_ERROR', 'The site sent an invalid redirect.', 502);
        }
        const next = validateTargetUrl(nextRaw, { allowPrivate });
        redirects.push(current.href);
        current = next;
        continue;
      }

      const contentType = res.headers.get('content-type') ?? '';
      let body: Uint8Array | null = null;
      if (opts.shouldReadBody(contentType, res.status) && res.body) {
        const declared = Number(res.headers.get('content-length') ?? '');
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          controller.abort();
          throw new ApiErr('TOO_LARGE', `The response is larger than ${Math.round(opts.maxBytes / 1024 / 1024)} MB.`, 413);
        }
        body = await readCapped(res.body as ReadableStream<Uint8Array>, opts.maxBytes, () => controller.abort());
      } else {
        await res.body?.cancel().catch(() => {});
      }

      return {
        finalUrl: current,
        status: res.status,
        headers: res.headers as unknown as Headers,
        contentType,
        body,
        redirects,
        cookies: [...cookies],
        network: {
          resolver: opts.resolver,
          dohUsed: state.dohUsed,
          dohFallback: state.dohFallback,
          ...(state.resolvedIp && !opts.proxy ? { resolvedIp: state.resolvedIp } : {}),
          proxy: opts.proxy ? { type: opts.proxy.type, host: opts.proxy.host, port: opts.proxy.port } : null,
          tls: current.protocol === 'https:',
          timingMs: Date.now() - started,
        },
      };
    }
  } catch (err) {
    const mapped = mapFetchError(err, controller.signal, !!opts.proxy);
    if (redirects.length) mapped.finalUrl ??= current.href;
    throw mapped;
  } finally {
    clearTimeout(timer);
    if (dispatcher) dispatcher.destroy().catch(() => {});
  }
}
