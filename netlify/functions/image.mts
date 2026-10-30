// GET /api/image?url=… — privacy-preserving image proxy for reader view.
// Same SSRF-safe fetch path as /api/page; only image responses are relayed,
// no cookies or referer flow in either direction, so this is not an open proxy.

import type { Config } from '@netlify/functions';
import { LIMITS, allowPrivateNetwork } from './_lib/env.ts';
import { ApiErr, clientIp, errorResponse, json, methodNotAllowed, type FnContext } from './_lib/http.ts';
import { SlidingWindowLimiter } from './_lib/rateLimit.ts';
import { secureFetch } from './_lib/secureFetch.ts';
import { validateTargetUrl } from './_lib/url.ts';

const limiter = new SlidingWindowLimiter(LIMITS.imageFetchesPerMinute);
export const __resetRateLimit = () => limiter.reset();

const IMAGE_TIMEOUT_MS = 10_000;

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(['GET']);
  const ip = clientIp(req, context);
  if (!limiter.take(ip)) {
    return json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many image requests.', status: 429 } },
      429,
      { 'retry-after': String(limiter.retryAfter(ip)) },
    );
  }
  try {
    const raw = new URL(req.url).searchParams.get('url');
    if (!raw) throw new ApiErr('INVALID_URL', 'The url query parameter is required.', 400);
    const target = validateTargetUrl(raw, { allowPrivate: allowPrivateNetwork() });

    let mime = '';
    const result = await secureFetch(target, {
      // The system resolver is used for images: they are fetched in bulk and
      // the SSRF checks are identical regardless of resolver.
      resolver: 'system',
      proxy: null,
      maxBytes: LIMITS.maxImageBytes,
      timeoutMs: IMAGE_TIMEOUT_MS,
      maxRedirects: LIMITS.maxRedirects,
      accept: 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8',
      shouldReadBody: (ct, status) => {
        mime = ct.split(';')[0]!.trim().toLowerCase();
        return status >= 200 && status < 300 && mime.startsWith('image/');
      },
    });

    if (result.status < 200 || result.status >= 300) {
      throw new ApiErr('UPSTREAM_ERROR', `The image server answered with HTTP ${result.status}.`, 502);
    }
    if (!mime.startsWith('image/') || !result.body) {
      throw new ApiErr('UNSUPPORTED_TYPE', 'The URL did not return an image.', 415);
    }
    if (!/^image\/[a-z0-9.+-]+$/.test(mime)) {
      throw new ApiErr('UNSUPPORTED_TYPE', 'The image type is not supported.', 415);
    }

    const headers: Record<string, string> = {
      'content-type': mime,
      'content-length': String(result.body.byteLength),
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      // Neutralizes active content in SVGs (scripts, external loads) if opened directly.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    };
    return new Response(req.method === 'HEAD' ? null : (result.body as Uint8Array<ArrayBuffer>), { status: 200, headers });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: '/api/image',
};
