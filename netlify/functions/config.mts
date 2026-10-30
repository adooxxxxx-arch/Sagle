// GET /api/config — which server features are available. Never returns secrets.

import type { Config } from '@netlify/functions';
import type { ServerConfig } from '../../shared/api.ts';
import { APP_VERSION, LIMITS, env } from './_lib/env.ts';
import { json, methodNotAllowed } from './_lib/http.ts';

export function buildServerConfig(): ServerConfig {
  const brave = !!env('BRAVE_SEARCH_API_KEY');
  return {
    version: APP_VERSION,
    ai: {
      nvidia: { available: !!env('NVIDIA_API_KEY'), model: env('AETHER_NVIDIA_MODEL') ?? 'moonshotai/kimi-k3' },
      anthropic: { available: !!env('ANTHROPIC_API_KEY'), model: env('AETHER_ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5' },
    },
    search: { provider: brave ? 'brave' : 'duckduckgo', braveConfigured: brave },
    sync: { available: true },
    limits: {
      pageFetchesPerMinute: LIMITS.pageFetchesPerMinute,
      aiRequestsPerMinute: LIMITS.aiRequestsPerMinute,
      maxPageBytes: LIMITS.maxPageBytes,
    },
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  return json(buildServerConfig());
};

export const config: Config = {
  path: '/api/config',
};
