// Environment helpers for the Node functions.

/**
 * !!! TESTING ESCAPE HATCH — NEVER SET THIS ON NETLIFY !!!
 *
 * `AETHER_ALLOW_PRIVATE_NETWORK=1` disables the SSRF protections of the
 * server-side fetcher: private/loopback/link-local addresses become reachable
 * and any port is allowed. It exists ONLY so the automated tests can fetch
 * fixture servers on 127.0.0.1. Setting it on a deployed site would let anyone
 * use /api/page and /api/image to reach internal services (including cloud
 * metadata endpoints such as 169.254.169.254).
 *
 * Defence in depth: the flag is ignored when running inside AWS Lambda (where
 * Netlify Functions execute), so a mistaken dashboard setting does not take
 * effect in production. The default (unset) is safe.
 */
export function allowPrivateNetwork(): boolean {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return process.env.AETHER_ALLOW_PRIVATE_NETWORK === '1';
}

export function env(name: string): string | undefined {
  const fromNetlify = (globalThis as { Netlify?: { env?: { get(k: string): string | undefined } } }).Netlify?.env?.get(
    name,
  );
  const v = fromNetlify ?? process.env[name];
  return v === '' ? undefined : v;
}

export const APP_VERSION = '0.1.0';

export const USER_AGENT = 'Mozilla/5.0 (compatible; AetherReader/0.1; +https://github.com/adooxxxxx-arch/Sagle)';

export const LIMITS = {
  pageFetchesPerMinute: 60,
  imageFetchesPerMinute: 600,
  searchesPerMinute: 30,
  dnsLookupsPerMinute: 60,
  syncRequestsPerMinute: 30,
  aiRequestsPerMinute: 20,
  maxPageBytes: 3 * 1024 * 1024,
  maxImageBytes: 5 * 1024 * 1024,
  fetchTimeoutMs: 8000,
  maxRedirects: 5,
} as const;
