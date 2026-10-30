// GET/PUT/DELETE /api/sync/:id — opaque storage for end-to-end-encrypted sync
// envelopes. The server only ever sees ciphertext, and stores it under
// SHA-256(id) so the raw sync id is never persisted.
//
//   GET    → 200 SyncEnvelope (raw JSON) | 404 NOT_FOUND
//   PUT    → 200 { ok: true, updatedAt }   (body: SyncEnvelope, ≤ SYNC_MAX_BYTES)
//   DELETE → 200 { ok: true }

import type { Config } from '@netlify/functions';
import { SYNC_ID_PATTERN, SYNC_MAX_BYTES } from '../../shared/api.ts';
import { LIMITS } from './_lib/env.ts';
import { ApiErr, clientIp, errorResponse, json, methodNotAllowed, readJsonBody, type FnContext } from './_lib/http.ts';
import { SlidingWindowLimiter } from './_lib/rateLimit.ts';
import { getSyncStore, syncKey, validateEnvelope } from './_lib/syncStore.ts';

const limiter = new SlidingWindowLimiter(LIMITS.syncRequestsPerMinute);
export const __resetRateLimit = () => limiter.reset();

function idFrom(req: Request, context: FnContext): string {
  const fromParams = context.params?.id;
  const id = fromParams ?? decodeURIComponent(new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '');
  if (!SYNC_ID_PATTERN.test(id)) throw new ApiErr('BAD_REQUEST', 'Invalid sync id.', 400);
  return id;
}

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return methodNotAllowed(['GET', 'PUT', 'DELETE']);
  const ip = clientIp(req, context);
  if (!limiter.take(ip)) {
    return json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many sync requests. Please wait a moment.', status: 429 } },
      429,
      { 'retry-after': String(limiter.retryAfter(ip)) },
    );
  }
  try {
    const key = syncKey(idFrom(req, context));
    const store = getSyncStore();

    if (req.method === 'GET') {
      const value = await store.get(key);
      if (value === null) throw new ApiErr('NOT_FOUND', 'No sync data exists for this id.', 404);
      return new Response(value, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }

    if (req.method === 'PUT') {
      const envelope = validateEnvelope(await readJsonBody(req, SYNC_MAX_BYTES));
      await store.set(key, JSON.stringify(envelope));
      return json({ ok: true, updatedAt: envelope.updatedAt });
    }

    await store.delete(key);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: '/api/sync/:id',
};
