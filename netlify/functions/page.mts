// POST /api/page — Aether's secure reader / probe fetch.
// Fetches a public web page server-side with SSRF protection, optional
// DoH resolution, optional malicious-domain blocking and an optional user
// proxy, then returns reader content, metadata, embed policy and a privacy
// report. Never logs URLs, contents or client IPs.

import type { Config } from '@netlify/functions';
import type { DohResolver, PageRequest, PageResult, SafetyReport } from '../../shared/api.ts';
import { checkHostSafety, SECURITY_PROVIDER } from './_lib/doh.ts';
import { analyzeEmbed } from './_lib/embed.ts';
import { LIMITS, allowPrivateNetwork } from './_lib/env.ts';
import { ApiErr, clientIp, errorResponse, isRecord, json, methodNotAllowed, readJsonBody, type FnContext } from './_lib/http.ts';
import { ipVersion } from './_lib/ip.ts';
import { SlidingWindowLimiter } from './_lib/rateLimit.ts';
import { decodeBody, extractHtml, extractPlainText, titleFromUrl } from './_lib/reader.ts';
import { secureFetch, validateProxy } from './_lib/secureFetch.ts';
import { normalizeHost, validateTargetUrl } from './_lib/url.ts';

const limiter = new SlidingWindowLimiter(LIMITS.pageFetchesPerMinute);
export const __resetRateLimit = () => limiter.reset();

const RESOLVERS: DohResolver[] = ['cloudflare', 'quad9', 'google', 'system'];

function parseRequest(body: unknown): Required<Omit<PageRequest, 'proxy'>> & { proxy: PageRequest['proxy'] } {
  if (!isRecord(body)) throw new ApiErr('BAD_REQUEST', 'Request body must be a JSON object.', 400);
  const { url, resolver, safeBrowsing, proxy, probeOnly } = body;
  if (typeof url !== 'string') throw new ApiErr('INVALID_URL', 'url must be a string.', 400);
  if (resolver !== undefined && !RESOLVERS.includes(resolver as DohResolver)) {
    throw new ApiErr('BAD_REQUEST', 'resolver must be one of cloudflare, quad9, google, system.', 400);
  }
  if (safeBrowsing !== undefined && typeof safeBrowsing !== 'boolean') {
    throw new ApiErr('BAD_REQUEST', 'safeBrowsing must be a boolean.', 400);
  }
  if (probeOnly !== undefined && typeof probeOnly !== 'boolean') {
    throw new ApiErr('BAD_REQUEST', 'probeOnly must be a boolean.', 400);
  }
  return {
    url,
    resolver: (resolver as DohResolver | undefined) ?? 'cloudflare',
    safeBrowsing: safeBrowsing ?? true,
    proxy: validateProxy(proxy),
    probeOnly: probeOnly ?? false,
  };
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

function mimeOf(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/** Tracks malicious-domain checks for every host in the redirect chain. */
class SafetyTracker {
  private readonly checks = new Map<string, Promise<SafetyReport>>();
  constructor(private readonly enabled: boolean) {}

  start(url: URL): void {
    if (!this.enabled) return;
    const host = normalizeHost(url.hostname);
    if (this.checks.has(host)) return;
    if (ipVersion(host)) {
      this.checks.set(
        host,
        Promise.resolve({ checked: false, blocked: false, provider: SECURITY_PROVIDER, detail: 'IP addresses cannot be checked against the domain blocklist.' }),
      );
      return;
    }
    this.checks.set(host, checkHostSafety(host));
  }

  async result(): Promise<SafetyReport> {
    if (!this.enabled) return { checked: false, blocked: false, detail: 'Malicious-site blocking is turned off.' };
    const reports = await Promise.all(this.checks.values());
    const blocked = reports.find((r) => r.blocked);
    if (blocked) return blocked;
    const unchecked = reports.find((r) => !r.checked);
    return {
      checked: !unchecked,
      blocked: false,
      provider: SECURITY_PROVIDER,
      ...(unchecked?.detail ? { detail: unchecked.detail } : {}),
    };
  }
}

function blockedResponse(safety: SafetyReport, finalUrl?: string): Response {
  const err = new ApiErr('BLOCKED_MALICIOUS', safety.detail ?? 'This site is listed as malicious.', 403);
  err.safety = safety;
  if (finalUrl) err.finalUrl = finalUrl;
  return errorResponse(err);
}

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const ip = clientIp(req, context);
  if (!limiter.take(ip)) {
    return json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many page requests. Please wait a moment.', status: 429 } },
      429,
      { 'retry-after': String(limiter.retryAfter(ip)) },
    );
  }

  let safety: SafetyTracker | undefined;
  try {
    const input = parseRequest(await readJsonBody(req));
    const target = validateTargetUrl(input.url, { allowPrivate: allowPrivateNetwork() });
    safety = new SafetyTracker(input.safeBrowsing);
    const tracker = safety;

    let detectedMime = '';
    const result = await secureFetch(target, {
      resolver: input.resolver,
      proxy: input.proxy,
      maxBytes: LIMITS.maxPageBytes,
      timeoutMs: LIMITS.fetchTimeoutMs,
      maxRedirects: LIMITS.maxRedirects,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      shouldReadBody: (ct) => {
        detectedMime = mimeOf(ct);
        return HTML_TYPES.has(detectedMime) || detectedMime === 'text/plain' || detectedMime === '';
      },
      onHop: (url) => tracker.start(url),
    });

    // Never return content for a blocked host, even if the fetch succeeded first.
    const safetyReport = await tracker.result();
    if (safetyReport.blocked) return blockedResponse(safetyReport, result.finalUrl.href);

    const finalUrl = result.finalUrl.href;
    let html: string | null = null;
    let plain: string | null = null;
    if (result.body) {
      const decoded = decodeBody(result.body, result.contentType);
      if (HTML_TYPES.has(detectedMime) || (detectedMime === '' && /^\s*</.test(decoded))) html = decoded;
      else if (detectedMime === 'text/plain' || detectedMime === '') plain = decoded;
    }

    const base = {
      ok: true as const,
      requestedUrl: target.href,
      finalUrl,
      status: result.status,
      contentType: result.contentType,
      redirects: result.redirects,
      https: result.finalUrl.protocol === 'https:',
      embed: analyzeEmbed(result.headers),
      network: result.network,
      safety: safetyReport,
    };
    const cookies = { cookiesReceived: result.cookies, cookiesSent: 0 as const };

    let page: PageResult;
    if (html !== null) {
      const extracted = extractHtml(html, finalUrl, { probeOnly: input.probeOnly });
      page = { ...base, meta: extracted.meta, reader: extracted.reader, privacy: { ...extracted.privacy, ...cookies } };
    } else {
      const reader =
        plain !== null && !input.probeOnly
          ? extractPlainText(plain)
          : { available: false, html: '', text: '', excerpt: '', wordCount: 0 };
      page = {
        ...base,
        meta: { title: titleFromUrl(result.finalUrl), favicon: `${result.finalUrl.origin}/favicon.ico` },
        reader,
        privacy: { scriptsStripped: 0, trackers: [], thirdPartyDomains: [], ...cookies },
      };
    }
    return json(page);
  } catch (err) {
    // If the fetch failed but the domain is known-malicious, say so.
    if (safety && err instanceof ApiErr && err.code !== 'BAD_REQUEST' && err.code !== 'INVALID_URL') {
      const report = await safety.result().catch(() => undefined);
      if (report?.blocked) return blockedResponse(report, err.finalUrl);
      if (report) err.safety ??= report;
    }
    return errorResponse(err);
  }
};

// Literal values only: Netlify reads this export statically at deploy time.
export const config: Config = {
  path: '/api/page',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
