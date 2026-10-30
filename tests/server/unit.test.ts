import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPrivateAddress, parseIPv4, parseIPv6 } from '../../netlify/functions/_lib/ip.ts';
import { isLocalLikeName, validateTargetUrl } from '../../netlify/functions/_lib/url.ts';
import { isThirdParty, registrableDomain } from '../../netlify/functions/_lib/domains.ts';
import { TRACKER_COUNT, matchTracker } from '../../netlify/functions/_lib/trackers.ts';
import { analyzeEmbed, parseFrameAncestors } from '../../netlify/functions/_lib/embed.ts';
import { parseDdgHtml, parseWikipediaJson, parseBraveJson, runSearch, unwrapDdgHref } from '../../netlify/functions/_lib/search.ts';
import { isSinkholeAnswer, parseDohJson } from '../../netlify/functions/_lib/doh.ts';
import { makeSafeLookup } from '../../netlify/functions/_lib/secureFetch.ts';
import { countWords, decodeBody, extractHtml } from '../../netlify/functions/_lib/reader.ts';
import { ApiErr } from '../../netlify/functions/_lib/http.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('IP classification', () => {
  it('parses IPv4 strictly', () => {
    expect(parseIPv4('1.2.3.4')).toBe(0x01020304);
    expect(parseIPv4('256.1.1.1')).toBeNull();
    expect(parseIPv4('1.2.3')).toBeNull();
    expect(parseIPv4('01x.2.3.4')).toBeNull();
  });

  it('parses IPv6 forms incl. embedded IPv4', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('[2001:db8::1]')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('64:ff9b::10.0.0.1')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 1]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('12345::')).toBeNull();
  });

  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.0.9', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.168.1.1', '198.18.0.1', '198.19.255.255', '224.0.0.1',
    '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.2.1', '203.0.113.9',
  ])('blocks private IPv4 %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '198.20.0.1', '172.15.255.255'])(
    'allows public IPv4 %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it.each([
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:0001::1',
    '::127.0.0.1', '2001:db8::1', '2001::1', 'not-an-ip',
  ])('blocks private/reserved IPv6 %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '2a00:1450::1'])(
    'allows public IPv6 %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('URL validation', () => {
  const v = (u: string) => validateTargetUrl(u, { allowPrivate: false });
  const code = (u: string) => {
    try {
      v(u);
      return 'OK';
    } catch (e) {
      return (e as ApiErr).code;
    }
  };

  it('accepts normal http(s) URLs and strips fragments', () => {
    expect(v('https://example.com/a?b=1#frag').href).toBe('https://example.com/a?b=1');
    expect(code('http://example.com:8080/')).toBe('OK');
    expect(code('https://example.com:8443/')).toBe('OK');
  });

  it('rejects bad schemes, credentials, ports', () => {
    expect(code('ftp://example.com/')).toBe('INVALID_URL');
    expect(code('javascript:alert(1)')).toBe('INVALID_URL');
    expect(code('file:///etc/passwd')).toBe('INVALID_URL');
    expect(code('https://user:pass@example.com/')).toBe('INVALID_URL');
    expect(code('https://example.com:22/')).toBe('INVALID_URL');
    expect(code('http://example.com:6379/')).toBe('INVALID_URL');
    expect(code('not a url')).toBe('INVALID_URL');
  });

  it('blocks private IP literals and local names, including obfuscated forms', () => {
    for (const u of [
      'http://127.0.0.1/', 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://[::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data', 'http://localhost/',
      'http://LOCALHOST./', 'http://foo.localhost/', 'http://printer.local/', 'http://intranet/',
      'http://metadata.google.internal/', 'http://0.0.0.0/', 'http://[fd00::1]/', 'http://10.0.0.1:8080/',
    ]) {
      expect(code(u), u).toBe('BLOCKED_PRIVATE_NETWORK');
    }
  });

  it('local-like name detection', () => {
    expect(isLocalLikeName('localhost')).toBe(true);
    expect(isLocalLikeName('router.home.arpa')).toBe(true);
    expect(isLocalLikeName('nas')).toBe(true);
    expect(isLocalLikeName('example.com')).toBe(false);
    expect(isLocalLikeName('local.example.com')).toBe(false);
  });

  it('escape hatch allows private targets and any port', () => {
    expect(validateTargetUrl('http://127.0.0.1:5555/x', { allowPrivate: true }).port).toBe('5555');
  });
});

describe('safe lookup hook', () => {
  const run = (host: string, options: object, allowPrivate = false) =>
    new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) => {
      const lookup = makeSafeLookup('system', { dohUsed: false, dohFallback: false }, new AbortController().signal, allowPrivate);
      lookup(host, options as never, (err, address, family) => resolve({ err, address, family }));
    });

  it('rejects localhost names with BLOCKED_PRIVATE_NETWORK (single and all forms)', async () => {
    const single = await run('localhost', {});
    expect((single.err as ApiErr).code).toBe('BLOCKED_PRIVATE_NETWORK');
    const all = await run('localhost', { all: true });
    expect((all.err as ApiErr).code).toBe('BLOCKED_PRIVATE_NETWORK');
    expect(all.address).toEqual([]);
  });

  it('returns array form for options.all and string form otherwise', async () => {
    const all = await run('localhost', { all: true }, true);
    expect(all.err).toBeNull();
    expect(Array.isArray(all.address)).toBe(true);
    expect((all.address as Array<{ address: string }>).length).toBeGreaterThan(0);
    const single = await run('localhost', { family: 4 }, true);
    expect(single.err).toBeNull();
    expect(single.address).toBe('127.0.0.1');
    expect(single.family).toBe(4);
  });
});

describe('registrable domains', () => {
  it.each([
    ['www.example.com', 'example.com'],
    ['a.b.example.co.uk', 'example.co.uk'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['www.abc.net.au', 'abc.net.au'],
    ['shop.example.com.au', 'example.com.au'],
    ['www.yahoo.co.jp', 'yahoo.co.jp'],
    ['user.github.io', 'user.github.io'],
    ['a.user.github.io', 'user.github.io'],
    ['my-site.netlify.app', 'my-site.netlify.app'],
    ['x.vercel.app', 'x.vercel.app'],
    ['proj.pages.dev', 'proj.pages.dev'],
    ['app.herokuapp.com', 'app.herokuapp.com'],
    ['example.com.br', 'example.com.br'],
    ['www.gov.uk', 'www.gov.uk'],
    ['localhost', 'localhost'],
    ['93.184.216.34', '93.184.216.34'],
  ])('%s → %s', (host, want) => expect(registrableDomain(host)).toBe(want));

  it('third-party detection', () => {
    expect(isThirdParty('cdn.example.com', 'www.example.com')).toBe(false);
    expect(isThirdParty('www.google-analytics.com', 'www.example.com')).toBe(true);
    expect(isThirdParty('alice.github.io', 'bob.github.io')).toBe(true);
    expect(isThirdParty('static.bbc.co.uk', 'www.bbc.co.uk')).toBe(false);
  });
});

describe('tracker matching', () => {
  it('has a substantial list', () => expect(TRACKER_COUNT).toBeGreaterThanOrEqual(150));
  it('matches subdomains by suffix', () => {
    expect(matchTracker('www.google-analytics.com')?.domain).toBe('google-analytics.com');
    expect(matchTracker('stats.g.doubleclick.net')?.category).toBe('advertising');
    expect(matchTracker('static.hotjar.com')?.category).toBe('session-replay');
    expect(matchTracker('cdn.segment.com')?.company).toBe('Segment');
    expect(matchTracker('bat.bing.com')?.company).toBe('Microsoft');
  });
  it('prefers the most specific entry and aggregates same-company subdomains', () => {
    expect(matchTracker('analytics.tiktok.com')?.domain).toBe('analytics.tiktok.com');
    expect(matchTracker('platform.twitter.com')?.category).toBe('social');
    expect(matchTracker('analytics.twitter.com')?.category).toBe('advertising');
    expect(matchTracker('connect.facebook.net')?.domain).toBe('facebook.net');
    expect(matchTracker('www.facebook.com')?.category).toBe('social');
    expect(matchTracker('static.hotjar.com')?.domain).toBe('hotjar.com');
  });
  it('does not match lookalikes or non-trackers', () => {
    expect(matchTracker('notgoogle-analytics.com')).toBeNull();
    expect(matchTracker('example.com')).toBeNull();
    expect(matchTracker('sentry.io')).toBeNull();
    expect(matchTracker('bing.com')).toBeNull();
  });
});

describe('embed analysis', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('no headers → allowed', () => expect(analyzeEmbed(h({})).allowed).toBe(true));
  it('XFO DENY / SAMEORIGIN → not allowed', () => {
    expect(analyzeEmbed(h({ 'x-frame-options': 'DENY' })).allowed).toBe(false);
    expect(analyzeEmbed(h({ 'x-frame-options': 'sameorigin' })).allowed).toBe(false);
    expect(analyzeEmbed(h({ 'x-frame-options': 'SAMEORIGIN' })).xFrameOptions).toBe('SAMEORIGIN');
  });
  it('XFO ALLOW-FROM is ignored', () => expect(analyzeEmbed(h({ 'x-frame-options': 'ALLOW-FROM https://a.com' })).allowed).toBe(true));
  it('frame-ancestors parsing', () => {
    expect(parseFrameAncestors("default-src 'self'; frame-ancestors 'none'")).toEqual([["'none'"]]);
    expect(parseFrameAncestors("frame-ancestors https://a.com https://b.com; script-src 'self'")).toEqual([
      ['https://a.com', 'https://b.com'],
    ]);
    expect(parseFrameAncestors("script-src 'self'")).toEqual([]);
  });
  it.each([
    ["frame-ancestors 'none'", false],
    ["frame-ancestors 'self'", false],
    ["frame-ancestors 'self' https://partner.example", false],
    ['frame-ancestors *', true],
    ['frame-ancestors https:', true],
    ["frame-ancestors 'self' https://*", true],
    ["default-src 'self'", true],
  ] as const)('CSP %s → %s', (csp, allowed) => {
    expect(analyzeEmbed(h({ 'content-security-policy': csp })).allowed).toBe(allowed);
  });
  it('CSP frame-ancestors overrides XFO', () => {
    const info = analyzeEmbed(h({ 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' }));
    expect(info.allowed).toBe(true);
    expect(info.frameAncestors).toBe('*');
  });
  it('multiple CSP policies must all allow', () => {
    expect(analyzeEmbed(h({ 'content-security-policy': "frame-ancestors *, frame-ancestors 'none'" })).allowed).toBe(false);
  });
});

describe('DuckDuckGo parsing', () => {
  it('unwraps uddg links', () => {
    expect(unwrapDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=abc')).toBe('https://example.com/a?b=1');
    expect(unwrapDdgHref('https://duckduckgo.com/y.js?ad_domain=x.com')).toBeNull();
    expect(unwrapDdgHref('https://plain.example.org/')).toBe('https://plain.example.org/');
    expect(unwrapDdgHref('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)')).toBeNull();
  });

  it('parses a realistic results page, skipping ads', () => {
    const { results, challenge } = parseDdgHtml(fixture('ddg.html'));
    expect(challenge).toBe(false);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: 'Rust Programming Language',
      url: 'https://www.rust-lang.org/',
      snippet: 'A language empowering everyone to build reliable and efficient software.',
    });
    expect(results[1]!.url).toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)');
    expect(results.some((r) => r.url.includes('ad.example'))).toBe(false);
  });

  it('detects the bot challenge page', () => {
    const html = '<html><body><div class="anomaly-modal__modal"><form id="challenge-form"></form></div></body></html>';
    expect(parseDdgHtml(html)).toEqual({ results: [], challenge: true });
  });
});

describe('other search providers', () => {
  it('parses Wikipedia JSON', () => {
    const r = parseWikipediaJson({
      query: { search: [{ title: 'Rust (programming language)', snippet: '<span class="searchmatch">Rust</span> is a &quot;language&quot;' }] },
    });
    expect(r).toEqual([
      {
        title: 'Rust (programming language)',
        url: 'https://en.wikipedia.org/wiki/Rust_(programming_language)',
        snippet: 'Rust is a "language"',
      },
    ]);
  });

  it('parses Brave JSON', () => {
    const r = parseBraveJson({ web: { results: [{ title: 'A <strong>b</strong>', url: 'https://a.com/', description: 'x &amp; y' }, { url: 'ftp://x' }] } });
    expect(r).toEqual([{ title: 'A b', url: 'https://a.com/', snippet: 'x & y' }]);
  });

  it('falls back DDG → Wikipedia with a notice', async () => {
    const res = await runSearch('rust', undefined, {
      brave: async () => [],
      ddg: async () => ({ results: [], challenge: true }),
      wikipedia: async () => [{ title: 'Rust', url: 'https://en.wikipedia.org/wiki/Rust', snippet: '' }],
    });
    expect(res.provider).toBe('wikipedia');
    expect(res.notice).toMatch(/bot check/);
  });

  it('uses Brave when a key is configured, falling back to DDG on failure', async () => {
    const deps = {
      brave: async () => {
        throw new Error('down');
      },
      ddg: async () => ({ results: [{ title: 't', url: 'https://t.com/', snippet: '' }], challenge: false }),
      wikipedia: async () => [],
    };
    const res = await runSearch('q', 'key', deps);
    expect(res.provider).toBe('duckduckgo');
    expect(res.notice).toMatch(/Brave/);
  });
});

describe('DoH JSON parsing', () => {
  it('parses answers, CNAMEs and the AD flag', () => {
    const r = parseDohJson({
      Status: 0,
      TC: false,
      RD: true,
      RA: true,
      AD: true,
      CD: false,
      Question: [{ name: 'www.example.com.', type: 1 }],
      Answer: [
        { name: 'www.example.com.', type: 5, TTL: 300, data: 'example.com.' },
        { name: 'example.com.', type: 1, TTL: 3600, data: '93.184.216.34' },
        { name: 'example.com.', type: 28, TTL: 3600, data: '2606:2800:220:1:248:1893:25c8:1946' },
      ],
    });
    expect(r.status).toBe(0);
    expect(r.ad).toBe(true);
    expect(r.answers).toEqual([
      { type: 'CNAME', data: 'example.com', ttl: 300 },
      { type: 'A', data: '93.184.216.34', ttl: 3600 },
      { type: 'AAAA', data: '2606:2800:220:1:248:1893:25c8:1946', ttl: 3600 },
    ]);
  });

  it('handles NXDOMAIN and malformed input', () => {
    expect(parseDohJson({ Status: 3, AD: false, Authority: [] }).answers).toEqual([]);
    expect(() => parseDohJson({ nope: 1 })).toThrow();
    expect(() => parseDohJson(null)).toThrow();
  });

  it('recognises sinkhole answers from the security resolver', () => {
    expect(isSinkholeAnswer(parseDohJson({ Status: 0, Answer: [{ type: 1, TTL: 60, data: '0.0.0.0' }] }))).toBe(true);
    expect(isSinkholeAnswer(parseDohJson({ Status: 0, Answer: [{ type: 28, TTL: 60, data: '::' }] }))).toBe(true);
    expect(isSinkholeAnswer(parseDohJson({ Status: 0, Answer: [{ type: 1, TTL: 60, data: '1.2.3.4' }] }))).toBe(false);
  });
});

describe('reader helpers', () => {
  it('decodes legacy charsets from meta tags', () => {
    const bytes = Buffer.concat([Buffer.from('<meta charset="windows-1252"><p>caf'), Buffer.from([0xe9]), Buffer.from('</p>')]);
    expect(decodeBody(bytes, 'text/html')).toContain('café');
  });
  it('counts words', () => {
    expect(countWords('Hello, world — it’s fine.')).toBe(4);
  });
  it('sanitizes javascript: links and event handlers', () => {
    const html = `<html><head><title>T</title></head><body><article><h1>T</h1>${'<p>Lorem ipsum dolor sit amet consectetur. </p>'.repeat(30)}
      <p><a href="javascript:alert(1)" onclick="x()">bad</a> <img src="/a.png" onerror="x()"></p></article></body></html>`;
    const r = extractHtml(html, 'https://site.example/post');
    expect(r.reader.available).toBe(true);
    expect(r.reader.html).not.toMatch(/javascript:|onclick|onerror/i);
    expect(r.reader.html).toContain('https://site.example/a.png');
  });
});
