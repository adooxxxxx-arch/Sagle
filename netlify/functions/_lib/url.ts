// Target URL validation for the server-side fetcher.

import { ApiErr } from './http.ts';
import { ipVersion, isPrivateAddress } from './ip.ts';

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);
export const MAX_URL_LENGTH = 4096;

const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'private',
  'home.arpa',
  'in-addr.arpa',
  'ip6.arpa',
  'test',
  'invalid',
  'example',
  'onion',
];

/** Strips IPv6 brackets and a trailing dot, lowercases. */
export function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * Names that must never be fetched regardless of what DNS says: localhost,
 * mDNS/intranet suffixes, special-use TLDs and single-label names (which a
 * system resolver could expand via search domains into internal hosts).
 */
export function isLocalLikeName(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (!h) return true;
  if (ipVersion(h)) return false;
  if (!h.includes('.')) return true;
  return LOCAL_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

export function isValidHostname(h: string): boolean {
  if (h.length < 1 || h.length > 253) return false;
  return h.split('.').every((label) => /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/i.test(label));
}

export interface ValidateOptions {
  allowPrivate: boolean;
}

/**
 * Parses and validates a target URL: http(s) only, no credentials, a
 * conservative port allow-list, and IP-literal / local-name checks (IP
 * literals never reach the DNS lookup hook, so they are checked here).
 */
export function validateTargetUrl(raw: string, opts: ValidateOptions): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new ApiErr('INVALID_URL', 'A URL is required.', 400);
  if (raw.length > MAX_URL_LENGTH) throw new ApiErr('INVALID_URL', 'URL is too long.', 400);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiErr('INVALID_URL', 'That is not a valid URL.', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiErr('INVALID_URL', 'Only http and https URLs can be fetched.', 400);
  }
  if (url.username || url.password) {
    throw new ApiErr('INVALID_URL', 'URLs with embedded credentials are not allowed.', 400);
  }
  const host = normalizeHost(url.hostname);
  if (!host) throw new ApiErr('INVALID_URL', 'URL has no host.', 400);
  if (!opts.allowPrivate) {
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!ALLOWED_PORTS.has(port)) {
      throw new ApiErr('INVALID_URL', 'Only ports 80, 443, 8080 and 8443 are allowed.', 400);
    }
  }
  const version = ipVersion(host);
  if (version) {
    if (!opts.allowPrivate && isPrivateAddress(host)) {
      throw new ApiErr('BLOCKED_PRIVATE_NETWORK', 'Requests to private or reserved network addresses are blocked.', 403);
    }
  } else {
    if (!isValidHostname(host)) throw new ApiErr('INVALID_URL', 'URL host name is not valid.', 400);
    if (!opts.allowPrivate && isLocalLikeName(host)) {
      throw new ApiErr('BLOCKED_PRIVATE_NETWORK', 'Requests to local or internal host names are blocked.', 403);
    }
  }
  url.hash = '';
  return url;
}
