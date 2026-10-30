// GET /api/dns?name=&resolver= — A/AAAA lookup through the chosen resolver,
// with DNSSEC (AD flag) status and a malicious-domain check.

import { promises as dnsPromises } from 'node:dns';
import type { Config } from '@netlify/functions';
import type { DnsAnswer, DnsResult, DohResolver } from '../../shared/api.ts';
import { DOH_ENDPOINTS, checkHostSafety, dohQuery, type DohJson } from './_lib/doh.ts';
import { LIMITS } from './_lib/env.ts';
import { ApiErr, clientIp, errorResponse, json, methodNotAllowed, type FnContext } from './_lib/http.ts';
import { ipVersion } from './_lib/ip.ts';
import { SlidingWindowLimiter } from './_lib/rateLimit.ts';
import { isValidHostname, normalizeHost } from './_lib/url.ts';

const limiter = new SlidingWindowLimiter(LIMITS.dnsLookupsPerMinute);
export const __resetRateLimit = () => limiter.reset();

const RESOLVERS: DohResolver[] = ['cloudflare', 'quad9', 'google', 'system'];

export function validateDnsName(raw: string | null): string {
  if (!raw) throw new ApiErr('BAD_REQUEST', 'The name query parameter is required.', 400);
  let name = raw.trim();
  // Accept a pasted URL and take its host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(name)) {
    try {
      name = new URL(name).hostname;
    } catch {
      throw new ApiErr('BAD_REQUEST', 'The name is not a valid host name.', 400);
    }
  }
  name = normalizeHost(name);
  if (ipVersion(name)) throw new ApiErr('BAD_REQUEST', 'Enter a domain name, not an IP address.', 400);
  try {
    name = new URL(`http://${name}/`).hostname; // IDN → punycode
  } catch {
    throw new ApiErr('BAD_REQUEST', 'The name is not a valid host name.', 400);
  }
  if (name.length > 253 || !isValidHostname(name) || !name.includes('.')) {
    throw new ApiErr('BAD_REQUEST', 'The name is not a valid public domain name.', 400);
  }
  return name;
}

async function systemLookup(name: string): Promise<DnsAnswer[]> {
  const [v4, v6] = await Promise.allSettled([
    dnsPromises.resolve4(name, { ttl: true }),
    dnsPromises.resolve6(name, { ttl: true }),
  ]);
  const answers: DnsAnswer[] = [];
  if (v4.status === 'fulfilled') for (const a of v4.value) answers.push({ type: 'A', data: a.address, ttl: a.ttl });
  if (v6.status === 'fulfilled') for (const a of v6.value) answers.push({ type: 'AAAA', data: a.address, ttl: a.ttl });
  if (!answers.length) {
    const codes = [v4, v6].map((r) => (r.status === 'rejected' ? (r.reason as NodeJS.ErrnoException).code : 'OK'));
    if (codes.every((c) => c === 'ENOTFOUND')) throw new ApiErr('DNS_FAILED', 'The domain does not exist.', 404);
    if (codes.some((c) => c !== 'ENODATA' && c !== 'ENOTFOUND' && c !== 'OK')) {
      throw new ApiErr('DNS_FAILED', 'The system resolver could not answer.', 502);
    }
  }
  return answers;
}

async function dohLookup(name: string, resolver: Exclude<DohResolver, 'system'>): Promise<{ answers: DnsAnswer[]; ad: boolean }> {
  const endpoint = DOH_ENDPOINTS[resolver];
  const settled = await Promise.allSettled([dohQuery(endpoint, name, 'A'), dohQuery(endpoint, name, 'AAAA')]);
  const ok = settled.filter((r): r is PromiseFulfilledResult<DohJson> => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw new ApiErr('DNS_FAILED', 'The DNS-over-HTTPS resolver could not be reached.', 502);
  if (ok.some((r) => r.status === 3)) throw new ApiErr('DNS_FAILED', 'The domain does not exist.', 404);
  if (ok.every((r) => r.status !== 0)) throw new ApiErr('DNS_FAILED', 'The resolver failed to answer (SERVFAIL).', 502);
  const seen = new Set<string>();
  const answers: DnsAnswer[] = [];
  for (const r of ok) {
    for (const a of r.answers) {
      const key = `${a.type}|${a.data}`;
      if (seen.has(key)) continue;
      seen.add(key);
      answers.push(a);
    }
  }
  return { answers, ad: ok.every((r) => r.ad) };
}

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const ip = clientIp(req, context);
  if (!limiter.take(ip)) {
    return json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many DNS lookups. Please wait a moment.', status: 429 } },
      429,
      { 'retry-after': String(limiter.retryAfter(ip)) },
    );
  }
  try {
    const params = new URL(req.url).searchParams;
    const name = validateDnsName(params.get('name'));
    const resolverParam = params.get('resolver') ?? 'cloudflare';
    if (!RESOLVERS.includes(resolverParam as DohResolver)) {
      throw new ApiErr('BAD_REQUEST', 'resolver must be one of cloudflare, quad9, google, system.', 400);
    }
    const resolver = resolverParam as DohResolver;
    const safetyPromise = checkHostSafety(name);
    const lookup =
      resolver === 'system'
        ? systemLookup(name).then((answers) => ({ answers, ad: false }))
        : dohLookup(name, resolver);
    const [{ answers, ad }, safety] = await Promise.all([lookup, safetyPromise]);
    const result: DnsResult = { ok: true, name, resolver, answers, dnssecValidated: ad, safety };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: '/api/dns',
};
