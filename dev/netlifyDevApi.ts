// Vite dev-server plugin that serves Aether's Netlify Functions and Edge
// Functions locally under /api/*, so `npm run dev` works without netlify-cli.
//
// * Routes by each module's exported `config.path` (supports `:param`
//   segments and a trailing `*`), loaded with `server.ssrLoadModule` so edits
//   hot-reload.
// * Converts Node req/res ⇄ Web Request/Response and streams response bodies
//   (needed for the SSE stream of /api/ai).
// * Dev only (`apply: 'serve'`): it has no effect on `vite build`.

import { existsSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';

interface RouteModule {
  default?: (req: Request, context: DevContext) => Response | Promise<Response>;
  config?: { path?: string | string[] };
}

interface DevContext {
  ip: string;
  params: Record<string, string>;
  geo: Record<string, never>;
}

const FUNCTION_DIRS: Array<{ dir: string; ext: RegExp }> = [
  { dir: 'netlify/edge-functions', ext: /\.(m?ts|m?js)$/ },
  { dir: 'netlify/functions', ext: /\.(m?ts|m?js)$/ },
];

/** Matches `/api/sync/:id`-style patterns; returns params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg === '*') return params;
    const part = s[i];
    if (part === undefined) return null;
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(part);
      } catch {
        return null;
      }
    } else if (seg !== part) {
      return null;
    }
  }
  return p.length === s.length ? params : null;
}

function listModules(root: string): string[] {
  const out: string[] = [];
  for (const { dir, ext } of FUNCTION_DIRS) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs, { withFileTypes: true })) {
      // Only top-level files are functions; `_lib/` etc. are helpers.
      if (f.isFile() && ext.test(f.name) && !f.name.startsWith('_') && !f.name.endsWith('.d.ts')) out.push(path.join(abs, f.name));
    }
  }
  return out;
}

async function findRoute(
  server: ViteDevServer,
  pathname: string,
): Promise<{ mod: RouteModule; params: Record<string, string> } | null> {
  for (const file of listModules(server.config.root)) {
    let mod: RouteModule;
    try {
      mod = (await server.ssrLoadModule(file)) as RouteModule;
    } catch (err) {
      server.config.logger.error(`[aether-dev-api] failed to load ${path.basename(file)}: ${(err as Error).message}`);
      continue;
    }
    const paths = mod.config?.path;
    if (!paths || typeof mod.default !== 'function') continue;
    for (const pattern of Array.isArray(paths) ? paths : [paths]) {
      const params = matchPath(pattern, pathname);
      if (params) return { mod, params };
    }
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function toRequest(req: IncomingMessage, body: Buffer | null, signal: AbortSignal): Request {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(':') || v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else headers.set(k, v);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: body && body.length ? new Uint8Array(body) : null,
    signal,
  });
}

async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  const setCookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  } finally {
    res.end();
  }
}

export function netlifyDevApi(): Plugin {
  return {
    name: 'aether-netlify-dev-api',
    apply: 'serve',
    config(_config, { mode }) {
      // Make server-side secrets from .env / .env.local visible to the
      // functions (they read process.env). Existing env vars win.
      const loaded = loadEnv(mode, process.cwd(), '');
      for (const [k, v] of Object.entries(loaded)) if (process.env[k] === undefined) process.env[k] = v;
    },
    configureServer(server) {
      const g = globalThis as { Netlify?: unknown };
      if (!g.Netlify) g.Netlify = { env: { get: (k: string) => process.env[k] } };

      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (!pathname.startsWith('/api/')) return next();
        const aborter = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) aborter.abort();
        });
        try {
          const route = await findRoute(server, pathname);
          if (!route) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'No such API route.', status: 404 } }));
            return;
          }
          const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
          const request = toRequest(req, body, aborter.signal);
          const context: DevContext = { ip: '127.0.0.1', params: route.params, geo: {} };
          const response = await route.mod.default!(request, context);
          await sendResponse(response, res);
        } catch (err) {
          if (aborter.signal.aborted) return;
          server.config.logger.error(`[aether-dev-api] ${(err as Error)?.name ?? 'Error'}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: 'Internal server error.', status: 500 } }));
          } else {
            res.end();
          }
        }
      });
    },
  };
}
