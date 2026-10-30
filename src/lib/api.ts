import type {
  ApiError,
  DnsResponse,
  PageRequest,
  PageResponse,
  SearchResponse,
  ServerConfig,
} from '../../shared/api.ts';

async function asJson<T>(res: Response): Promise<T | ApiError> {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    return {
      ok: false,
      error: {
        code: res.status === 404 ? 'NOT_FOUND' : 'INTERNAL',
        message:
          res.status === 404
            ? 'The Aether server API is not reachable from this deployment.'
            : `Unexpected server response (${res.status}).`,
        status: res.status,
      },
    };
  }
  return (await res.json()) as T | ApiError;
}

function networkError(e: unknown): ApiError {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { ok: false, error: { code: 'TIMEOUT', message: 'Request cancelled.' } };
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'Could not reach the Aether server. Check your connection.' } };
}

export async function fetchPage(req: PageRequest, signal?: AbortSignal): Promise<PageResponse> {
  try {
    const res = await fetch('/api/page', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    return (await asJson<PageResponse>(res)) as PageResponse;
  } catch (e) {
    return networkError(e);
  }
}

export async function search(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q }),
      signal,
    });
    return (await asJson<SearchResponse>(res)) as SearchResponse;
  } catch (e) {
    return networkError(e);
  }
}

export async function dnsLookup(name: string, resolver: string): Promise<DnsResponse> {
  try {
    const res = await fetch(`/api/dns?name=${encodeURIComponent(name)}&resolver=${encodeURIComponent(resolver)}`);
    return (await asJson<DnsResponse>(res)) as DnsResponse;
  } catch (e) {
    return networkError(e);
  }
}

let configPromise: Promise<ServerConfig | null> | null = null;
export function getServerConfig(force = false): Promise<ServerConfig | null> {
  if (!configPromise || force) {
    configPromise = fetch('/api/config')
      .then(async (r) => {
        const j = await asJson<ServerConfig>(r);
        return j && 'version' in j ? j : null;
      })
      .catch(() => null);
  }
  return configPromise;
}

export function imageProxyUrl(src: string): string {
  return `/api/image?url=${encodeURIComponent(src)}`;
}
