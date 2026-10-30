import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, ServerConfig, SyncEnvelope } from '../../shared/api.ts';
import { AI_STREAM_FORMAT_HEADER, SYNC_MAX_BYTES } from '../../shared/api.ts';
import syncHandler, { __resetRateLimit as resetSyncLimit } from '../../netlify/functions/sync.mts';
import { __resetSyncStore, getSyncStore, syncKey } from '../../netlify/functions/_lib/syncStore.ts';
import aiHandler, { __resetRateLimit as resetAiLimit, validateAiRequest, isCrossOrigin } from '../../netlify/edge-functions/ai.ts';
import configHandler from '../../netlify/functions/config.mts';
import searchHandler, { __resetRateLimit as resetSearchLimit } from '../../netlify/functions/search.mts';
import dnsHandler, { validateDnsName } from '../../netlify/functions/dns.mts';
import { matchPath } from '../../dev/netlifyDevApi.ts';
import { postJson } from './helpers.ts';

const ID = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 chars base64url
const envelope: SyncEnvelope = {
  v: 1,
  ciphertext: Buffer.from('encrypted bytes').toString('base64'),
  iv: 'AAECAwQFBgcICQoL',
  salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
  updatedAt: '2026-10-30T12:00:00.000Z',
};

const syncReq = (method: string, id = ID, body?: unknown) =>
  syncHandler(
    new Request(`http://aether.test/api/sync/${id}`, {
      method,
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }),
    { ip: '192.0.2.10', params: { id } },
  );

describe('/api/sync/:id (in-memory fallback)', () => {
  beforeEach(() => {
    __resetSyncStore();
    resetSyncLimit();
  });

  it('uses the in-memory store outside Netlify', () => {
    expect(getSyncStore().kind).toBe('memory');
  });

  it('round-trips PUT → GET → DELETE → 404', async () => {
    const missing = await syncReq('GET');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiError).error.code).toBe('NOT_FOUND');

    const put = await syncReq('PUT', ID, envelope);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, updatedAt: envelope.updatedAt });

    const got = await syncReq('GET');
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect(await got.json()).toEqual(envelope);

    // stored under SHA-256(id), never the raw id
    expect(await getSyncStore().get(ID)).toBeNull();
    expect(await getSyncStore().get(syncKey(ID))).not.toBeNull();
    expect(syncKey(ID)).toMatch(/^[0-9a-f]{64}$/);

    expect((await syncReq('DELETE')).status).toBe(200);
    expect((await syncReq('GET')).status).toBe(404);
  });

  it('strips unknown fields from stored envelopes', async () => {
    await syncReq('PUT', ID, { ...envelope, extra: 'nope' });
    expect(await (await syncReq('GET')).json()).toEqual(envelope);
  });

  it('validates ids and envelopes', async () => {
    expect((await syncReq('GET', 'short')).status).toBe(400);
    expect((await syncReq('GET', 'AbCdEfGhIjKlMnOpQrStU!')).status).toBe(400);
    expect((await syncReq('PUT', ID, { ...envelope, v: 2 })).status).toBe(400);
    expect((await syncReq('PUT', ID, { ...envelope, ciphertext: 'not base64 !' })).status).toBe(400);
    expect((await syncReq('PUT', ID, { ...envelope, updatedAt: 'yesterday' })).status).toBe(400);
    expect((await syncReq('PUT', ID, '{bad json')).status).toBe(400);
    expect((await syncReq('POST', ID, envelope)).status).toBe(405);
  });

  it('rejects payloads over SYNC_MAX_BYTES', async () => {
    const big = { ...envelope, ciphertext: 'A'.repeat(SYNC_MAX_BYTES + 10) };
    const res = await syncReq('PUT', ID, big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as ApiError).error.code).toBe('TOO_LARGE');
  });

  it('rate-limits at 30/min per IP', async () => {
    for (let i = 0; i < 30; i++) await syncReq('GET');
    expect((await syncReq('GET')).status).toBe(429);
  });
});

describe('/api/ai edge function', () => {
  const AI = 'http://aether.test/api/ai';
  const good = { provider: 'anthropic', system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] };

  beforeEach(() => {
    resetAiLimit();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.AETHER_ANTHROPIC_MODEL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });

  it('returns NOT_CONFIGURED when the provider key is missing', async () => {
    const res = await aiHandler(postJson(AI, good), { ip: '1.2.3.4' });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as ApiError).error.code).toBe('NOT_CONFIGURED');
  });

  it('rejects cross-origin requests with 403', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const res = await aiHandler(postJson(AI, good, { origin: 'https://evil.example' }), { ip: '1.2.3.4' });
    expect(res.status).toBe(403);
    expect(isCrossOrigin(postJson(AI, good, { origin: 'http://aether.test' }))).toBe(false);
    expect(isCrossOrigin(postJson(AI, good, { origin: 'null' }))).toBe(true);
    expect(isCrossOrigin(postJson(AI, good))).toBe(false);
  });

  it('validates the request shape and limits', () => {
    const v = (b: unknown) => {
      try {
        validateAiRequest(b);
        return 'OK';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(v({ ...good, provider: 'openai' })).toMatch(/provider/);
    expect(v({ ...good, messages: [] })).toMatch(/non-empty/);
    expect(v({ ...good, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) })).toMatch(/At most 40/);
    expect(v({ ...good, messages: [{ role: 'user', content: 'x'.repeat(120_001) }] })).toMatch(/120000/);
    expect(v({ ...good, system: 'x'.repeat(40_001) })).toMatch(/system prompt/);
    expect(
      v({ ...good, messages: Array.from({ length: 4 }, () => ({ role: 'user', content: 'x'.repeat(110_000) })) }),
    ).toMatch(/400000/);
    expect(v({ ...good, messages: [{ role: 'system', content: 'x' }] })).toMatch(/role/);
    expect(v({ ...good, messages: [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }] })).toMatch(/first message/);
    expect(v({ ...good, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] })).toMatch(/last message/);
    expect(validateAiRequest({ ...good, maxTokens: 10 }).maxTokens).toBe(256);
    expect(validateAiRequest({ ...good, maxTokens: 100_000 }).maxTokens).toBe(8192);
    expect(validateAiRequest(good).maxTokens).toBe(4096);
    const merged = validateAiRequest({ ...good, messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] });
    expect(merged.messages).toEqual([{ role: 'user', content: 'a\n\nb' }]);
  });

  it('streams Anthropic SSE straight through with the right headers and request shape', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key';
    const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n';
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await aiHandler(postJson(AI, { ...good, maxTokens: 1000 }), { ip: '1.2.3.4' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get(AI_STREAM_FORMAT_HEADER)).toBe('anthropic');
    expect(await res.text()).toBe(sse);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-sonnet-5-5',
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1000,
      stream: true,
    });
  });

  it('forwards NVIDIA requests in OpenAI format', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-secret';
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await aiHandler(postJson(AI, { ...good, provider: 'nvidia' }), { ip: '1.2.3.4' });
    expect(res.headers.get(AI_STREAM_FORMAT_HEADER)).toBe('openai');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer nvapi-secret');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'moonshotai/kimi-k3',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
      ],
      max_tokens: 4096,
      temperature: 0.6,
      stream: true,
    });
  });

  it('maps upstream errors to a sanitized UPSTREAM_ERROR without leaking the key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-leaky';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`{"error":"invalid key sk-ant-leaky ${'x'.repeat(500)}"}`, { status: 401 })),
    );
    const res = await aiHandler(postJson(AI, good), { ip: '1.2.3.4' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe('UPSTREAM_ERROR');
    expect(body.error.message).toMatch(/HTTP 401/);
    expect(body.error.message).not.toContain('sk-ant-leaky');
    expect(body.error.message.length).toBeLessThan(400);
  });

  it('rate-limits at 20/min per IP', async () => {
    for (let i = 0; i < 20; i++) await aiHandler(postJson(AI, good), { ip: '9.9.9.9' });
    expect((await aiHandler(postJson(AI, good), { ip: '9.9.9.9' })).status).toBe(429);
  });
});

describe('/api/config', () => {
  afterEach(() => {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.AETHER_NVIDIA_MODEL;
  });

  it('reports availability without secrets', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-super-secret';
    process.env.BRAVE_SEARCH_API_KEY = 'brave-secret';
    process.env.AETHER_NVIDIA_MODEL = 'some/model';
    const res = await configHandler(new Request('http://aether.test/api/config'));
    const text = await res.text();
    expect(text).not.toContain('secret');
    const cfg = JSON.parse(text) as ServerConfig;
    expect(cfg.ai.nvidia).toEqual({ available: true, model: 'some/model' });
    expect(cfg.ai.anthropic.available).toBe(false);
    expect(cfg.ai.anthropic.model).toBe('claude-sonnet-5-5');
    expect(cfg.search).toEqual({ provider: 'brave', braveConfigured: true });
    expect(cfg.sync.available).toBe(true);
    expect(cfg.limits).toEqual({ pageFetchesPerMinute: 60, aiRequestsPerMinute: 20, maxPageBytes: 3 * 1024 * 1024 });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('defaults to duckduckgo without a Brave key', async () => {
    const cfg = (await (await configHandler(new Request('http://aether.test/api/config'))).json()) as ServerConfig;
    expect(cfg.search.provider).toBe('duckduckgo');
  });
});

describe('/api/search and /api/dns request validation', () => {
  beforeEach(() => resetSearchLimit());

  it('validates search queries', async () => {
    const S = 'http://aether.test/api/search';
    const ctx = { ip: '5.5.5.5' };
    expect((await searchHandler(postJson(S, { q: '   ' }), ctx)).status).toBe(400);
    expect((await searchHandler(postJson(S, { q: 'x'.repeat(301) }), ctx)).status).toBe(400);
    expect((await searchHandler(postJson(S, { query: 'x' }), ctx)).status).toBe(400);
    expect((await searchHandler(new Request(S), ctx)).status).toBe(405);
  });

  it('rate-limits search at 30/min', async () => {
    const S = 'http://aether.test/api/search';
    for (let i = 0; i < 30; i++) await searchHandler(postJson(S, { q: '' }), { ip: '6.6.6.6' });
    expect((await searchHandler(postJson(S, { q: '' }), { ip: '6.6.6.6' })).status).toBe(429);
  });

  it('validates DNS names', async () => {
    expect(validateDnsName('Example.COM.')).toBe('example.com');
    expect(validateDnsName('https://www.example.org/path')).toBe('www.example.org');
    expect(validateDnsName('bücher.de')).toBe('xn--bcher-kva.de');
    for (const bad of ['', 'localhost', '1.2.3.4', 'a..b', '-bad.com', 'x'.repeat(254) + '.com', 'under score!.com']) {
      expect(() => validateDnsName(bad), bad).toThrow();
    }
    const res = await dnsHandler(new Request('http://aether.test/api/dns?name=example.com&resolver=opendns'), { ip: '7.7.7.7' });
    expect(res.status).toBe(400);
  });
});

describe('dev middleware routing', () => {
  it('matches static and parameterised paths', () => {
    expect(matchPath('/api/page', '/api/page')).toEqual({});
    expect(matchPath('/api/page', '/api/pages')).toBeNull();
    expect(matchPath('/api/sync/:id', '/api/sync/abc')).toEqual({ id: 'abc' });
    expect(matchPath('/api/sync/:id', '/api/sync')).toBeNull();
    expect(matchPath('/api/sync/:id', '/api/sync/a/b')).toBeNull();
    expect(matchPath('/api/*', '/api/x/y')).toEqual({});
  });
});
