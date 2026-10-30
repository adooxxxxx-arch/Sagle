# Aether — Test Report

Date: 2026-10-30 · Commit: see the PR head · Environment: Node 22, Chromium (Playwright), Linux.

## Summary

| Suite | Command | Result |
|---|---|---|
| TypeScript (app + server) | `npx tsc -b` | ✅ 0 errors |
| Server unit + integration | `npx vitest run tests/server` | ✅ 166 / 166 |
| Frontend unit | `npx vitest run tests/unit` | ✅ 12 / 12 |
| End-to-end (real UI in Chromium) | `npm run test:e2e` | ✅ 13 / 13 |
| Production build | `npm run build` | ✅ (≈195 KB JS gzip) |
| Function bundling (esbuild, node22 ESM) | see backend notes | ✅ all 6 functions + edge function |
| Netlify deploy preview | GitHub status `netlify/…/deploy-preview` | see "Deployment" below |

## What the end-to-end suite proves

These tests drive the real app through a browser, against a local HTTP fixture site and a fake OpenAI-compatible streaming endpoint (`tests/e2e/fixtures.mjs`).

1. **Boot:** the app hydrates from IndexedDB and shows the new tab page.
2. **Embedding-blocked site → Reader view:** a page sending `X-Frame-Options: DENY` opens in Reader automatically and the info bar explains why. The text is extracted, the nav boilerplate is removed, there are no `<script>` elements and no `on*` handlers, and the page's inline script never ran.
3. **Measured privacy report:** it shows 3 trackers (Google Tag Manager, Meta, Quantcast pixel) and 2 cookies the site tried to set, all discarded.
4. **Highlights:** a selection, then Highlight, produces a persisted `<mark>`.
5. **Live view:** an embeddable page renders in an iframe with `sandbox` (scripts allowed, **no** `allow-top-navigation`) and `referrerpolicy=no-referrer`, and its content loads.
6. **Navigation and shortcuts:** Back works, and Alt+D bookmarks the page.
7. **AI with page context:** the API key and model are configured through Settings. The answer streams in with a table and citation chips. The provider received the key from the browser (`Bearer …`), the page text arrived as source `[1]`, and the page's scripts weren't in the context.
8. **Context "None":** no page text is sent.
9. **Privacy center:** shows the measured counts.
10. **Private workspace:** sharing page content triggers a consent dialog, and cancelling sends **no** request.
11. **Persistence:** after a reload, Personal tabs are restored. Private tabs, history and chats were **never written** to IndexedDB (checked by reading the database directly).
12. **Light theme and mobile (390px):** they render with no horizontal overflow, and the mobile drawer opens.
13. **No uncaught errors** in the console.

Screenshots are saved to `test-results/` when you run the suite.

## Server tests (highlights)

- **SSRF:** private, loopback, link-local, CGNAT and multicast ranges (IPv4 and IPv6, including mapped and NAT64 forms and obfuscated literals like `0x7f.1`) are blocked. `127.0.0.1`, `localhost`, `[::1]` and `169.254.169.254` are refused with `BLOCKED_PRIVATE_NETWORK`. Private proxy hosts are refused. The `lookup` hook handles both callback forms.
- **Fetch pipeline:** redirect chains (cookies collected on every hop), the 5-redirect cap, gzip, the size cap (streamed and declared), non-HTML content, timeouts, and HTTP and SOCKS5 proxies with authentication against local proxies.
- **Parsing:** `X-Frame-Options` and `frame-ancestors`, eTLD+1 and third-party detection, tracker matching, DuckDuckGo HTML (link unwrapping, ad skipping, bot-check detection), Brave and Wikipedia, DoH JSON.
- **Sync** round-trip; **AI edge function** validation (NOT_CONFIGURED, cross-origin 403, size limits, key redaction, streamed pass-through against a mock upstream); config; dev router.

## Not verifiable in the build environment

The build sandbox has no general internet access, so these were tested against mocks or fixtures only and need checking on the live deployment:

- Real DoH resolvers and the Cloudflare malware resolver.
- Live DuckDuckGo markup and bot-checks, the Brave API, and Wikipedia.
- The real NVIDIA NIM and Anthropic streaming APIs.
- Netlify Blobs, Netlify native rate limiting, and the Deno edge runtime.
- Browser-direct calls to api.anthropic.com and api.openai.com, and Ollama.

## Deployment

| Check | Result |
|---|---|
| Netlify build (npm ci, `tsc -b`, `vite build`) | ✅ GitHub status `netlify/sprightly-taffy-f53eff/deploy-preview` = **"Deploy Preview ready!"** for commit `b3da405` |
| Netlify bundled all Functions + the Edge Function | ✅ A bundling failure would have failed that deploy |
| Public HTTPS URL | **https://deploy-preview-1--sprightly-taffy-f53eff.netlify.app** (preview). After merge: **https://sprightly-taffy-f53eff.netlify.app** |
| Runtime smoke test of the live URL | ⚠️ **Not performed by the builder.** The build sandbox's network policy blocks `*.netlify.app` (DNS and CONNECT refused), so no request reached the live site from here. |

### Manual smoke test for the live URL (2 minutes)
1. Open the URL. The new tab page should appear.
2. Visit `<url>/api/config`. It should return JSON (not the app's HTML), which proves `/api/*` routes to the functions. `ai.nvidia.available` shows whether `NVIDIA_API_KEY` is set.
3. Type `en.wikipedia.org/wiki/Glass` in the address bar. It should open in Live view (Wikipedia allows framing). Then type `github.com`, which blocks framing; it should fall back to Reader view or offer a new browser tab.
4. Open the Privacy center and test a DNS lookup of `example.com` (this checks live DoH).
5. Open the AI panel, set the context to Page, and click Summarize. This needs a server key or your own key (Settings → AI).
