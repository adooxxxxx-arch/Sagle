# Aether — Architecture

Aether is a **web application** that delivers a browser-like experience from a URL. It is not a browser engine, so it can't do everything Chrome or Firefox can. The architecture starts from what an ordinary website is actually allowed to do.

## 1. Constraints that shaped the design

| Web platform constraint | Consequence | Aether's answer |
|---|---|---|
| Sites send `X-Frame-Options` / CSP `frame-ancestors` and refuse to be framed | Many sites (Google, GitHub, banks, most web apps) can't be shown in an `<iframe>` | The server **probes each page's framing policy** and picks a view per page: **Live** if framing is allowed, **Reader** if not, and **New browser tab** as a last resort. The UI always says which mode is active. |
| Cross-origin frames are opaque (same-origin policy) | A web app can't read an embedded page's DOM, URL changes, selection or network requests | Page text for Reader and AI comes from **Aether's own server-side fetch**, not from the frame. The Privacy center says plainly that requests made inside Live frames can't be observed. |
| A page can't intercept the browser's network stack | No ad blocking, request rewriting or DNS changes inside Live view | Tracker removal, cookie dropping, DoH and proxies apply to **server-side fetches** (Reader, AI context, search, image proxy). Live view relies on the browser's own protections and the frame **sandbox**. |
| Browsers reserve Ctrl/⌘+T, W, N, L | They can't be overridden | Aether's tab shortcuts use Alt/⌥, matched on `event.code`. |
| Server-side fetching is an SSRF risk | A naive "fetch any URL" endpoint is an open proxy into private networks | Fetches use DNS pinning inside the connect hook, private-range blocking on every hop, port limits, size and time caps, rate limits, and return **extracted content only**. It is not a pass-through proxy. |

**Remote browser sessions** (streaming a server-side Chromium) would cover sites that block framing, but they need dedicated browser infrastructure (for example Browserbase, or Cloudflare Browser Rendering with session isolation and per-user quotas). That isn't available in this deployment, so the UI marks it unavailable and falls back to opening a new browser tab.

## 2. System overview

```
                 ┌──────────────────────────── Browser (the user's) ─────────────────────────────┐
                 │  Aether SPA (React 19 + TypeScript + Tailwind v4, Vite)                       │
                 │  ┌───────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
                 │  │ Workspaces│ │ Tabs / groups│ │ Live view    │ │ AI assistant             │ │
                 │  │ & sessions│ │ split view   │ │ <iframe      │ │  context builder         │ │
                 │  └───────────┘ └──────────────┘ │  sandbox     │ │  provider adapters ──────┼─┼──► Anthropic / OpenAI /
                 │  ┌──────────────────────────┐   │  credential- │ │  (BYOK, direct from      │ │    OpenAI-compatible /
                 │  │ Local-first stores       │   │  less>       │ │   the browser)           │ │    Ollama (localhost)
                 │  │ zustand + IndexedDB      │   └──────┬───────┘ └────────────┬─────────────┘ │
                 │  │ vault (AES-GCM optional) │          │ direct               │ /api/ai       │
                 │  └──────────────────────────┘          ▼                      ▼               │
                 └────────────────────────────────── the site ──────── Netlify edge ────────────┘
                                                                              │
          ┌────────────────────────── Netlify (same origin, HTTPS) ───────────┴────────────────────────┐
          │ Static SPA (CDN)          Functions v2 (Node 22)                      Edge function (Deno)   │
          │                           /api/page   secure fetch → reader + report  /api/ai  → NVIDIA NIM  │
          │                           /api/image  image-only privacy proxy                 → Anthropic   │
          │                           /api/search Brave → DuckDuckGo → Wikipedia   (server keys)         │
          │                           /api/dns    DoH + malware check                                    │
          │                           /api/config capabilities (no secrets)                              │
          │                           /api/sync/:id  E2E-encrypted blobs (Netlify Blobs)                 │
          └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Separation of concerns

| Concern | Location |
|---|---|
| Frontend shell, tabs, workspaces, views | `src/components/browser/*`, `src/store/browser.ts` |
| Internal pages (`aether://…`) | `src/components/pages/*` |
| AI orchestration (context, prompts, providers, streaming) | `src/lib/ai/*`, `src/components/ai/AiPanel.tsx`, `netlify/edge-functions/ai.ts` |
| Browsing infrastructure (secure fetch, extraction) | `netlify/functions/page.mts`, `_lib/secureFetch.ts`, `_lib/reader.ts` |
| Proxy infrastructure | `_lib/secureFetch.ts` (undici `ProxyAgent` / `Socks5ProxyAgent`), `src/components/pages/PrivacyCenter.tsx` |
| Privacy engine | `_lib/trackers.ts`, `_lib/embed.ts`, `_lib/doh.ts`, `_lib/ip.ts`, Privacy center UI |
| Authentication | None needed for browsing (no accounts). Sync uses unguessable 128-bit capability codes plus client-side encryption. |
| Persistence | IndexedDB (`src/lib/storage.ts`), vault (`src/store/vault.ts`), Netlify Blobs for encrypted sync only |
| Shared API contract | `shared/api.ts` (imported by both sides) |

## 3. Stack choices

- **Vite + React 19 + TypeScript.** It's a pure client app with a handful of serverless endpoints. Next.js SSR would add a server render path with no benefit: there's no SEO need and all state is local.
- **Tailwind v4 + CSS tokens.** A themeable glass design system (`src/index.css`) with dark and light tokens and reduced-motion support.
- **zustand + IndexedDB** (`idb-keyval`). Small, synchronous selectors and a persist middleware with `partialize`, which filters ephemeral workspaces out before every write.
- **Netlify.** The repo was already connected (deploy previews per PR). It provides Functions v2 (Node, needed for undici, linkedom and Readability), Edge Functions (long-lived AI streaming without the 10s sync-function cap), Blobs (zero-config storage for sync) and native rate limiting.
- **undici 8** for the secure fetcher: custom `connect.lookup` (DNS pinning), native SOCKS5 and HTTP proxy agents.
- **@mozilla/readability + linkedom** for extraction. It's Firefox Reader View's algorithm, run on a lightweight DOM.
- **DOMPurify** on the client re-sanitizes every reader document (defence in depth on top of the server's sanitization).
- **Lucide** icons throughout.

## 4. Key flows

### Opening a URL
1. The address bar resolves input to an `http(s)` URL, an `aether://` page, or a search.
2. `usePages.ensure(url)` → `POST /api/page` with the user's resolver, malware-check and proxy settings (skipped if "Server page analysis" is off).
3. The server validates the URL, runs the malware DoH check in parallel, and fetches with DNS-pinned connections, re-validating each redirect. It then computes the embed policy, extracts reader content, builds the privacy report, and returns JSON.
4. `WebView` decides the view: workspace default → embed policy → reader availability. Live view renders a sandboxed iframe: `allow-same-origin`, plus per-site toggles for `allow-scripts`, `allow-forms` and `allow-popups`, and **never** `allow-top-navigation`, which prevents frame-busting. It also sets a per-site permission delegation (`allow=`), `referrerpolicy=no-referrer`, and `credentialless` in isolated workspaces.

### AI with context
1. The user picks a context: None, Page, Selection, Tabs, Workspace, Web research, or a Collection.
2. Private workspaces (and, optionally, all workspaces) ask for consent before page content goes to a cloud model. Local models skip this.
3. `buildContext` / `researchContext` gather numbered sources from server extraction (search → top N → fetch each). Per-source text is budgeted to roughly 60k characters in total.
4. The system prompt carries the sources as untrusted data with citation rules. The answer streams back, and `[n]` markers are rendered as citation chips linked to the sources.
5. Transport: BYOK providers are called **directly from the browser** (keys never touch Aether's server). The "Aether Cloud" providers go through the edge function using the deployment's server keys, with same-origin and rate-limit checks.

### Encrypted sync
The client builds a snapshot (no history by default, no tabs, no keys, nothing from ephemeral workspaces), derives a key with PBKDF2-SHA256 (310k iterations) and encrypts it with AES-256-GCM. It then `PUT`s the snapshot to `/api/sync/<128-bit id>`, which the server stores under `sha256(id)` in Netlify Blobs. Pulling merges by item id, newest wins, and never deletes.

## 5. Security configuration

- CSP (`netlify.toml`): `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` (Aether itself can't be framed), `frame-src https:` (Live view), `connect-src 'self' https: http://localhost:*` (BYOK and Ollama).
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `COOP: same-origin-allow-popups`, Topics API opt-out.
- No secrets in the frontend bundle. Server keys are read only in functions (`NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY`).
- Rate limits: native Netlify rate limiting on `/api/page`, plus in-function per-IP sliding windows on every endpoint (see `/api/config`).
- The SSRF test flag `AETHER_ALLOW_PRIVATE_NETWORK` is ignored when running on AWS Lambda (Netlify Functions).

## 6. Local development

```bash
npm install
npm run dev          # Vite + all /api/* routes via dev/netlifyDevApi.ts (no Netlify CLI needed)
npm test             # 178 unit + integration tests
npm run test:e2e     # drives the real UI in Chromium against local fixtures
```
