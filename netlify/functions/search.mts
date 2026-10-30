// POST /api/search — privacy-preserving web search (Brave → DuckDuckGo → Wikipedia).

import type { Config } from '@netlify/functions';
import { LIMITS, env } from './_lib/env.ts';
import { ApiErr, clientIp, errorResponse, isRecord, json, methodNotAllowed, readJsonBody, type FnContext } from './_lib/http.ts';
import { SlidingWindowLimiter } from './_lib/rateLimit.ts';
import { MAX_QUERY_CHARS, SearchProviderError, runSearch } from './_lib/search.ts';

const limiter = new SlidingWindowLimiter(LIMITS.searchesPerMinute);
export const __resetRateLimit = () => limiter.reset();

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const ip = clientIp(req, context);
  if (!limiter.take(ip)) {
    return json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many searches. Please wait a moment.', status: 429 } },
      429,
      { 'retry-after': String(limiter.retryAfter(ip)) },
    );
  }
  try {
    const body = await readJsonBody(req, 4096);
    if (!isRecord(body) || typeof body.q !== 'string') throw new ApiErr('BAD_REQUEST', 'q must be a string.', 400);
    const q = body.q.replace(/\s+/g, ' ').trim();
    if (!q) throw new ApiErr('BAD_REQUEST', 'The search query is empty.', 400);
    if (q.length > MAX_QUERY_CHARS) throw new ApiErr('BAD_REQUEST', `The search query is longer than ${MAX_QUERY_CHARS} characters.`, 400);
    try {
      return json(await runSearch(q, env('BRAVE_SEARCH_API_KEY')));
    } catch (err) {
      if (err instanceof SearchProviderError) throw new ApiErr('UPSTREAM_ERROR', err.message, 502);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: '/api/search',
};
