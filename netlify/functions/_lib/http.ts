// Shared HTTP helpers for Aether's Netlify Functions.
// Privacy rule for the whole backend: never log URLs, queries, page contents,
// IP addresses or keys. Errors are reported to the client, not to logs.

import type { ApiError, ApiErrorCode, SafetyReport } from '../../../shared/api.ts';

export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/** An error that maps directly to an `ApiError` response. */
export class ApiErr extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  safety?: SafetyReport;
  finalUrl?: string;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiErr';
    this.code = code;
    this.status = status;
  }
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export function errorBody(code: ApiErrorCode, message: string, status: number): ApiError {
  return { ok: false, error: { code, message, status } };
}

export function apiError(code: ApiErrorCode, message: string, status: number, extra: Partial<ApiError> = {}): Response {
  return json({ ...errorBody(code, message, status), ...extra }, status);
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(errorBody('BAD_REQUEST', `Method not allowed. Use ${allowed.join(', ')}.`, 405), 405, {
    allow: allowed.join(', '),
  });
}

/** Converts any thrown value into an `ApiError` response without leaking internals. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiErr) {
    const extra: Partial<ApiError> = {};
    if (err.safety) extra.safety = err.safety;
    if (err.finalUrl) extra.finalUrl = err.finalUrl;
    return json({ ...errorBody(err.code, err.message, err.status), ...extra }, err.status);
  }
  // Only the error class name is logged: messages can contain URLs.
  console.error('[aether] internal error', err instanceof Error ? err.name : typeof err);
  return json(errorBody('INTERNAL', 'Internal server error.', 500), 500);
}

/** Minimal shape of the Netlify context we rely on (works with the dev shim). */
export interface FnContext {
  ip?: string;
  params?: Record<string, string>;
}

export function clientIp(req: Request, context?: FnContext): string {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Reads a request body as text, refusing anything larger than `maxBytes`. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiErr('TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`, 413);
  }
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiErr('TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`, 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await readBodyText(req, maxBytes);
  if (!text) throw new ApiErr('BAD_REQUEST', 'Request body must be JSON.', 400);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiErr('BAD_REQUEST', 'Request body is not valid JSON.', 400);
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** fetch() with a hard timeout, for fixed public API hosts (search, DoH). */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 6000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetch(input, { ...rest, signal: combined, redirect: rest.redirect ?? 'follow' });
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower.startsWith('#x')) {
      const cp = parseInt(lower.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (lower.startsWith('#')) {
      const cp = parseInt(lower.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITY_MAP[lower] ?? m;
  });
}

export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
