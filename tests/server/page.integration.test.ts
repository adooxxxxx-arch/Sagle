import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiError, PageResult } from '../../shared/api.ts';
import pageHandler, { __resetRateLimit as resetPageLimit, config as pageConfig } from '../../netlify/functions/page.mts';
import imageHandler, { __resetRateLimit as resetImageLimit } from '../../netlify/functions/image.mts';
import { deadPort, postJson, startFixture, startHttpProxy, startSocks5, type Fixture } from './helpers.ts';

const API = 'http://aether.test/api/page';
const ctx = { ip: '203.0.113.50' };

async function callPage(body: Record<string, unknown>, context: { ip?: string } = ctx) {
  const res = await pageHandler(postJson(API, { resolver: 'system', safeBrowsing: false, ...body }), context);
  const json = (await res.json()) as PageResult | ApiError;
  return { res, json };
}

function expectError(json: PageResult | ApiError, code: string) {
  expect(json.ok, JSON.stringify(json).slice(0, 300)).toBe(false);
  expect((json as ApiError).error.code).toBe(code);
}

let fx: Fixture;

beforeAll(async () => {
  fx = await startFixture();
});
afterAll(async () => {
  await fx.close();
});
beforeEach(() => {
  resetPageLimit();
  resetImageLimit();
});

describe('/api/page with the test escape hatch', () => {
  beforeEach(() => {
    process.env.AETHER_ALLOW_PRIVATE_NETWORK = '1';
  });
  afterEach(() => {
    delete process.env.AETHER_ALLOW_PRIVATE_NETWORK;
  });

  it('extracts an article with metadata, privacy report and embed info', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/article` });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = json as PageResult;
    expect(page.ok).toBe(true);
    expect(page.status).toBe(200);
    expect(page.finalUrl).toBe(`${fx.origin}/article`);
    expect(page.https).toBe(false);
    expect(page.redirects).toEqual([]);

    // meta
    expect(page.meta.title).toBe('Fixture Article Title');
    expect(page.meta.siteName).toBe('Fixture Times');
    expect(page.meta.byline).toBe('Ada Lovelace');
    expect(page.meta.description).toBe('A fixture article for Aether tests.');
    expect(page.meta.lang).toBe('en-GB');
    expect(page.meta.favicon).toBe(`${fx.origin}/static/icon.png`);
    expect(page.meta.image).toBe(`${fx.origin}/images/cover.jpg`);
    expect(page.meta.publishedTime).toBe('2026-10-01T12:00:00Z');

    // reader
    expect(page.reader.available).toBe(true);
    expect(page.reader.text).toContain('Aether is a privacy-first browser.');
    expect(page.reader.text).not.toMatch(/\s{3,}/);
    expect(page.reader.wordCount).toBeGreaterThan(200);
    expect(page.reader.excerpt.length).toBeGreaterThan(0);
    const html = page.reader.html;
    expect(html).toContain(`href="${fx.origin}/related/story"`);
    expect(html).toContain(`src="${fx.origin}/images/photo.jpg"`);
    expect(html).toContain(`${fx.origin}/images/photo-2x.jpg 2x`);
    expect(html).not.toMatch(/<script|<style|<iframe|<form|<input|javascript:|onclick|onerror/i);
    expect(html).not.toContain('facebook.com/tr');
    expect(html).not.toContain('pixel.gif');
    expect(html).not.toContain('quantserve');

    // privacy
    expect(page.privacy.scriptsStripped).toBe(4);
    expect(page.privacy.cookiesSent).toBe(0);
    expect(page.privacy.cookiesReceived.sort()).toEqual(['session', 'tracking_id']);
    const trackers = Object.fromEntries(page.privacy.trackers.map((t) => [t.domain, t]));
    expect(trackers['googletagmanager.com']?.category).toBe('tag-manager');
    expect(trackers['googletagmanager.com']?.kinds).toContain('script');
    expect(trackers['facebook.net']?.company).toBe('Meta');
    expect(trackers['hotjar.com']?.kinds).toContain('inline-script');
    expect(trackers['segment.com']?.kinds).toContain('link');
    expect(trackers['facebook.com']?.kinds).toEqual(expect.arrayContaining(['img']));
    expect(trackers['quantserve.com']?.category).toBe('analytics');
    expect(page.privacy.thirdPartyDomains).toEqual(
      expect.arrayContaining(['www.googletagmanager.com', 'connect.facebook.net', 'fonts.googleapis.com', 'www.youtube.com']),
    );
    expect(page.privacy.thirdPartyDomains).not.toContain('127.0.0.1');

    // embed (X-Frame-Options: SAMEORIGIN)
    expect(page.embed.allowed).toBe(false);
    expect(page.embed.xFrameOptions).toBe('SAMEORIGIN');
    expect(page.embed.reason).toMatch(/SAMEORIGIN/);

    // network + safety
    expect(page.network).toMatchObject({ resolver: 'system', dohUsed: false, dohFallback: false, proxy: null, tls: false });
    expect(page.network.timingMs).toBeGreaterThanOrEqual(0);
    expect(page.safety).toEqual({ checked: false, blocked: false, detail: 'Malicious-site blocking is turned off.' });
  });

  it('sends no cookies or referer and a generic UA', async () => {
    fx.seenHeaders.length = 0;
    await callPage({ url: `${fx.origin}/echo-headers` });
    const h = fx.seenHeaders[0]!;
    expect(h.cookie).toBeUndefined();
    expect(h.referer).toBeUndefined();
    expect(h['user-agent']).toMatch(/AetherReader/);
    expect(h.accept).toMatch(/text\/html/);
    expect(h['accept-language']).toMatch(/en/);
  });

  it('follows and records a redirect chain, collecting cookies across hops', async () => {
    const { json } = await callPage({ url: `${fx.origin}/r1` });
    const page = json as PageResult;
    expect(page.ok).toBe(true);
    expect(page.requestedUrl).toBe(`${fx.origin}/r1`);
    expect(page.finalUrl).toBe(`${fx.origin}/article`);
    expect(page.redirects).toEqual([`${fx.origin}/r1`, `${fx.origin}/r2`]);
    expect(page.privacy.cookiesReceived.sort()).toEqual(['hop1', 'session', 'tracking_id']);
  });

  it('stops after 5 redirects', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/loop` });
    expect(res.status).toBe(502);
    expectError(json, 'UPSTREAM_ERROR');
    expect((json as ApiError).error.message).toMatch(/redirects/);
  });

  it('re-validates every redirect hop', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/to-ftp` });
    expect(res.status).toBe(400);
    expectError(json, 'INVALID_URL');
  });

  it('handles gzip-encoded responses', async () => {
    const { json } = await callPage({ url: `${fx.origin}/gzip` });
    expect((json as PageResult).reader.text).toContain('Aether is a privacy-first browser.');
  });

  it('reports CSP frame-ancestors * as embeddable', async () => {
    const { json } = await callPage({ url: `${fx.origin}/csp-article`, probeOnly: true });
    const page = json as PageResult;
    expect(page.embed).toMatchObject({ allowed: true, frameAncestors: '*' });
    // probeOnly: metadata + privacy but no reader content
    expect(page.reader.available).toBe(false);
    expect(page.reader.html).toBe('');
    expect(page.meta.title).toBe('Fixture Article Title');
    expect(page.privacy.trackers.length).toBeGreaterThan(0);
  });

  it('rejects oversized bodies (streamed) with TOO_LARGE', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/big` });
    expect(res.status).toBe(413);
    expectError(json, 'TOO_LARGE');
  });

  it('rejects oversized bodies (declared content-length) with TOO_LARGE', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/big-declared` });
    expect(res.status).toBe(413);
    expectError(json, 'TOO_LARGE');
  });

  it('returns non-HTML resources without reader content', async () => {
    const { json } = await callPage({ url: `${fx.origin}/doc.pdf` });
    const page = json as PageResult;
    expect(page.ok).toBe(true);
    expect(page.contentType).toBe('application/pdf');
    expect(page.reader.available).toBe(false);
    expect(page.meta.title).toBe('doc.pdf');
    expect(page.privacy.scriptsStripped).toBe(0);
  });

  it('renders text/plain as reader content', async () => {
    const { json } = await callPage({ url: `${fx.origin}/notes.txt` });
    const page = json as PageResult;
    expect(page.reader.available).toBe(true);
    expect(page.reader.html).toBe('<pre>Plain notes.\n\nSecond paragraph of notes.</pre>');
  });

  it('passes through upstream 404 status', async () => {
    const { json } = await callPage({ url: `${fx.origin}/nope` });
    expect((json as PageResult).status).toBe(404);
  });

  it('maps connection refused to UPSTREAM_ERROR', async () => {
    const port = await deadPort();
    const { res, json } = await callPage({ url: `http://127.0.0.1:${port}/` });
    expect(res.status).toBe(502);
    expectError(json, 'UPSTREAM_ERROR');
  });

  it('times out slow sites with TIMEOUT', { timeout: 20_000 }, async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/slow` });
    expect(res.status).toBe(504);
    expectError(json, 'TIMEOUT');
  });

  it('fetches through an HTTP proxy with basic auth', async () => {
    const proxy = await startHttpProxy(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`);
    try {
      const { json } = await callPage({
        url: `${fx.origin}/article`,
        proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username: 'alice', password: 's3cret' },
      });
      const page = json as PageResult;
      expect(page.ok, JSON.stringify(json).slice(0, 300)).toBe(true);
      expect(page.reader.available).toBe(true);
      expect(page.network.proxy).toEqual({ type: 'http', host: '127.0.0.1', port: proxy.port });
      expect(JSON.stringify(page.network)).not.toContain('s3cret');
      expect(proxy.requests.map((r) => r.url)).toContain(`${fx.origin}/article`);
    } finally {
      await proxy.close();
    }
  });

  it('fetches through a SOCKS5 proxy with user/pass auth (remote DNS)', async () => {
    const socks = await startSocks5({ user: 'bob', pass: 'pw' });
    try {
      const { json } = await callPage({
        url: `http://localhost:${fx.port}/article`,
        proxy: { type: 'socks5', host: '127.0.0.1', port: socks.port, username: 'bob', password: 'pw' },
      });
      const page = json as PageResult;
      expect(page.ok, JSON.stringify(json).slice(0, 300)).toBe(true);
      expect(page.meta.title).toBe('Fixture Article Title');
      expect(page.network.proxy).toEqual({ type: 'socks5', host: '127.0.0.1', port: socks.port });
      expect(socks.connects).toContainEqual({ host: 'localhost', port: fx.port, user: 'bob' });
    } finally {
      await socks.close();
    }
  });

  it('reports PROXY_ERROR when the proxy is unreachable', async () => {
    const port = await deadPort();
    for (const type of ['http', 'socks5'] as const) {
      const { res, json } = await callPage({ url: `${fx.origin}/article`, proxy: { type, host: '127.0.0.1', port } });
      expect(res.status).toBe(502);
      expectError(json, 'PROXY_ERROR');
    }
  });

  it('validates the proxy profile', async () => {
    const { res, json } = await callPage({ url: `${fx.origin}/article`, proxy: { type: 'ftp', host: 'x', port: 1 } });
    expect(res.status).toBe(400);
    expectError(json, 'BAD_REQUEST');
  });
});

describe('/api/page SSRF protection (default, no escape hatch)', () => {
  beforeEach(() => {
    delete process.env.AETHER_ALLOW_PRIVATE_NETWORK;
  });

  it.each([
    () => `http://127.0.0.1:${fx.port}/article`,
    () => 'http://127.0.0.1/',
    () => 'http://localhost/',
    () => 'http://[::1]/',
    () => 'http://169.254.169.254/latest/meta-data/',
    () => 'http://[::ffff:169.254.169.254]/',
    () => 'http://0x7f.1/',
    () => 'http://10.0.0.1/',
    () => 'http://metadata.google.internal/',
  ])('blocks %#', async (u) => {
    const url = u();
    const { res, json } = await callPage({ url });
    if (url.includes(`:${fx.port}`)) {
      // Non-standard ports are rejected even before the address check.
      expect(['BLOCKED_PRIVATE_NETWORK', 'INVALID_URL']).toContain((json as ApiError).error.code);
    } else {
      expect(res.status).toBe(403);
      expectError(json, 'BLOCKED_PRIVATE_NETWORK');
    }
  });

  it('blocks http://127.0.0.1:<port>/ specifically with BLOCKED_PRIVATE_NETWORK when the port is allowed', async () => {
    const { res, json } = await callPage({ url: 'http://127.0.0.1:8080/' });
    expect(res.status).toBe(403);
    expectError(json, 'BLOCKED_PRIVATE_NETWORK');
  });

  it('refuses a proxy on a private address', async () => {
    const { res, json } = await callPage({
      url: 'https://example.com/',
      proxy: { type: 'http', host: '127.0.0.1', port: 3128 },
    });
    expect(res.status).toBe(403);
    expectError(json, 'BLOCKED_PRIVATE_NETWORK');
  });

  it('refuses a proxy named localhost', async () => {
    const { json } = await callPage({ url: 'https://example.com/', proxy: { type: 'socks5', host: 'localhost', port: 1080 } });
    expectError(json, 'BLOCKED_PRIVATE_NETWORK');
  });

  it('ignores the escape hatch inside AWS Lambda', async () => {
    process.env.AETHER_ALLOW_PRIVATE_NETWORK = '1';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'page';
    try {
      const { json } = await callPage({ url: 'http://127.0.0.1/' });
      expectError(json, 'BLOCKED_PRIVATE_NETWORK');
    } finally {
      delete process.env.AETHER_ALLOW_PRIVATE_NETWORK;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    }
  });
});

describe('/api/page request handling', () => {
  it('rejects non-POST', async () => {
    const res = await pageHandler(new Request(API), ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('rejects bad bodies', async () => {
    const bad = await pageHandler(new Request(API, { method: 'POST', body: '{nope' }), ctx);
    expect(bad.status).toBe(400);
    const { json } = await callPage({ url: 'https://example.com', resolver: 'opendns' });
    expectError(json, 'BAD_REQUEST');
    const { json: j2 } = await callPage({ url: 42 });
    expectError(j2, 'INVALID_URL');
  });

  it('rate-limits at 60 requests per minute per IP', async () => {
    const context = { ip: '198.51.100.7' };
    for (let i = 0; i < 60; i++) {
      const res = await pageHandler(postJson(API, { url: 'ftp://x' }), context);
      expect(res.status).toBe(400);
    }
    const res = await pageHandler(postJson(API, { url: 'ftp://x' }), context);
    expect(res.status).toBe(429);
    expect(((await res.json()) as ApiError).error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // other IPs are unaffected
    expect((await pageHandler(postJson(API, { url: 'ftp://x' }), { ip: '198.51.100.8' })).status).toBe(400);
  });

  it('declares the Netlify route and native rate limit', () => {
    expect(pageConfig).toEqual({ path: '/api/page', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } });
  });
});

describe('/api/image', () => {
  const img = (url: string) => imageHandler(new Request(`http://aether.test/api/image?url=${encodeURIComponent(url)}`), ctx);

  beforeEach(() => {
    process.env.AETHER_ALLOW_PRIVATE_NETWORK = '1';
  });
  afterEach(() => {
    delete process.env.AETHER_ALLOW_PRIVATE_NETWORK;
  });

  it('proxies images with safe headers and no cookies', async () => {
    const res = await img(`${fx.origin}/img.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('serves SVG with a locked-down CSP', async () => {
    const res = await img(`${fx.origin}/img.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'; style-src 'unsafe-inline'/);
    expect(res.headers.get('content-disposition')).toBe('inline');
  });

  it('refuses non-images (not an open proxy)', async () => {
    const res = await img(`${fx.origin}/article`);
    expect(res.status).toBe(415);
    expect(((await res.json()) as ApiError).error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses images over 5 MB', async () => {
    const res = await img(`${fx.origin}/big.png`);
    expect(res.status).toBe(413);
  });

  it('reports upstream errors', async () => {
    const res = await img(`${fx.origin}/missing.png`);
    expect(res.status).toBe(502);
  });

  it('applies SSRF protection without the escape hatch', async () => {
    delete process.env.AETHER_ALLOW_PRIVATE_NETWORK;
    const res = await img('http://169.254.169.254/latest/meta-data/iam.png');
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiError).error.code).toBe('BLOCKED_PRIVATE_NETWORK');
    const res2 = await img('http://localhost/x.png');
    expect(res2.status).toBe(403);
  });

  it('requires a url and GET', async () => {
    expect((await imageHandler(new Request('http://aether.test/api/image'), ctx)).status).toBe(400);
    expect((await imageHandler(new Request('http://aether.test/api/image?url=x', { method: 'POST' }), ctx)).status).toBe(405);
  });
});
