// POST /api/ai — server-side AI ("Aether Cloud") streaming proxy.
// Runs on Netlify Edge (Deno). Uses only web-standard APIs so it also runs
// under Node for local dev and tests. Keys come from Netlify env and are
// never returned or logged; request contents are never logged.

import type { Config, Context } from '@netlify/edge-functions';
import { AI_STREAM_FORMAT_HEADER } from '../../shared/api.ts';
import type { AiChatMessage, AiStreamFormat, ApiError, ApiErrorCode, ServerAiProvider } from '../../shared/api.ts';

type EnvGetter = { env?: { get(k: string): string | undefined } };
const env = (k: string): string | undefined => {
  const v =
    (globalThis as { Netlify?: EnvGetter }).Netlify?.env?.get(k) ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k];
  return v ? v : undefined;
};

export const AI_LIMITS = {
  maxMessages: 40,
  maxMessageChars: 120_000,
  maxSystemChars: 40_000,
  maxTotalChars: 400_000,
  minTokens: 256,
  maxTokens: 8192,
  defaultTokens: 4096,
  requestsPerMinute: 20,
  maxBodyBytes: 2 * 1024 * 1024,
} as const;

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const PROVIDERS: Record<ServerAiProvider, { keyEnv: string; modelEnv: string; defaultModel: string }> = {
  nvidia: { keyEnv: 'NVIDIA_API_KEY', modelEnv: 'AETHER_NVIDIA_MODEL', defaultModel: 'moonshotai/kimi-k3' },
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'AETHER_ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-5-5' },
};

// ---- best-effort per-isolate rate limit
const hits = new Map<string, number[]>();
function rateLimited(ip: string, now = Date.now()): boolean {
  const cutoff = now - 60_000;
  const list = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (list.length >= AI_LIMITS.requestsPerMinute) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.length || v[v.length - 1]! <= cutoff) hits.delete(k);
  }
  return false;
}
export const __resetRateLimit = () => hits.clear();

function jsonError(code: ApiErrorCode, message: string, status: number, headers: Record<string, string> = {}): Response {
  const body: ApiError = { ok: false, error: { code, message, status } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = 'BAD_REQUEST',
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ValidatedAiRequest {
  provider: ServerAiProvider;
  system: string;
  messages: AiChatMessage[];
  maxTokens: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates and normalizes a ServerAiRequest (merges consecutive same-role turns). */
export function validateAiRequest(body: unknown): ValidatedAiRequest {
  if (!isObj(body)) throw new ValidationError('Request body must be a JSON object.');
  const { provider, system, messages, maxTokens } = body;
  if (provider !== 'nvidia' && provider !== 'anthropic') throw new ValidationError('provider must be "nvidia" or "anthropic".');
  if (system !== undefined && typeof system !== 'string') throw new ValidationError('system must be a string.');
  const sys = (system as string | undefined) ?? '';
  if (sys.length > AI_LIMITS.maxSystemChars) {
    throw new ValidationError(`The system prompt exceeds ${AI_LIMITS.maxSystemChars} characters.`, 'TOO_LARGE', 413);
  }
  if (!Array.isArray(messages) || messages.length === 0) throw new ValidationError('messages must be a non-empty array.');
  if (messages.length > AI_LIMITS.maxMessages) {
    throw new ValidationError(`At most ${AI_LIMITS.maxMessages} messages are allowed.`, 'TOO_LARGE', 413);
  }
  let total = sys.length;
  const merged: AiChatMessage[] = [];
  for (const m of messages) {
    if (!isObj(m) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new ValidationError('Each message needs role "user" or "assistant" and string content.');
    }
    if (m.content.length > AI_LIMITS.maxMessageChars) {
      throw new ValidationError(`A message exceeds ${AI_LIMITS.maxMessageChars} characters.`, 'TOO_LARGE', 413);
    }
    total += m.content.length;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  if (total > AI_LIMITS.maxTotalChars) {
    throw new ValidationError(`The conversation exceeds ${AI_LIMITS.maxTotalChars} characters in total.`, 'TOO_LARGE', 413);
  }
  if (merged[0]!.role !== 'user') throw new ValidationError('The first message must come from the user.');
  if (merged[merged.length - 1]!.role !== 'user') throw new ValidationError('The last message must come from the user.');
  let mt: number = AI_LIMITS.defaultTokens;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) throw new ValidationError('maxTokens must be a number.');
    mt = Math.min(AI_LIMITS.maxTokens, Math.max(AI_LIMITS.minTokens, Math.round(maxTokens)));
  }
  return { provider, system: sys, messages: merged, maxTokens: mt };
}

/** Rejects browser requests whose Origin is a different host than this site. */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true; // "null" or garbage origins
  }
}

function sanitizeUpstreamError(text: string, key: string): string {
  let t = text.slice(0, 300);
  if (key) t = t.split(key).join('[redacted]');
  return t.replace(/(sk-ant-|nvapi-)[A-Za-z0-9_-]+/g, '[redacted]').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export default async (req: Request, context?: Pick<Context, 'ip'>): Promise<Response> => {
  if (req.method !== 'POST') return jsonError('BAD_REQUEST', 'Method not allowed. Use POST.', 405, { allow: 'POST' });
  if (isCrossOrigin(req)) return jsonError('BAD_REQUEST', 'Cross-origin requests are not allowed.', 403);

  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (rateLimited(ip)) {
    return jsonError('RATE_LIMITED', 'Too many AI requests. Please wait a moment.', 429, { 'retry-after': '60' });
  }

  let parsed: ValidatedAiRequest;
  try {
    const declared = Number(req.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > AI_LIMITS.maxBodyBytes) {
      throw new ValidationError('Request body is too large.', 'TOO_LARGE', 413);
    }
    const text = await req.text();
    if (text.length > AI_LIMITS.maxBodyBytes) throw new ValidationError('Request body is too large.', 'TOO_LARGE', 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError('Request body is not valid JSON.');
    }
    parsed = validateAiRequest(body);
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(err.code, err.message, err.status);
    return jsonError('BAD_REQUEST', 'Could not read the request.', 400);
  }

  const spec = PROVIDERS[parsed.provider];
  const key = env(spec.keyEnv);
  if (!key) {
    return jsonError('NOT_CONFIGURED', `The ${parsed.provider} provider is not configured on this server.`, 503);
  }
  const model = env(spec.modelEnv) ?? spec.defaultModel;

  let upstream: Response;
  let format: AiStreamFormat;
  try {
    if (parsed.provider === 'nvidia') {
      format = 'openai';
      upstream = await fetch(NVIDIA_URL, {
        method: 'POST',
        signal: req.signal,
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(parsed.system ? [{ role: 'system', content: parsed.system }] : []),
            ...parsed.messages,
          ],
          max_tokens: parsed.maxTokens,
          temperature: 0.6,
          stream: true,
        }),
      });
    } else {
      format = 'anthropic';
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: req.signal,
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          ...(parsed.system ? { system: parsed.system } : {}),
          messages: parsed.messages,
          max_tokens: parsed.maxTokens,
          stream: true,
        }),
      });
    }
  } catch {
    return jsonError('UPSTREAM_ERROR', `Could not reach the ${parsed.provider} API.`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = sanitizeUpstreamError(await upstream.text().catch(() => ''), key);
    return jsonError('UPSTREAM_ERROR', `The ${parsed.provider} API returned HTTP ${upstream.status}${detail ? `: ${detail}` : ''}`, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      [AI_STREAM_FORMAT_HEADER]: format,
    },
  });
};

export const config: Config = {
  path: '/api/ai',
};
