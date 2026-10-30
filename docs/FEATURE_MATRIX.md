# Aether — Feature Matrix

**Legend**
- ✅ Functional: implemented end to end and covered by automated tests.
- 🟢 Functional, not yet verified against live third-party services: the code path is real and tested against mocks or fixtures (the build sandbox has no internet).
- 🟡 Partial: works, with a stated limitation.
- ⛔ Unavailable: the platform or infrastructure doesn't allow it. The UI says so.

## Browsing

| Feature | Status | Notes |
|---|---|---|
| Address bar (URL / search / `aether://`) with suggestions from tabs, bookmarks and history | ✅ | |
| Back / forward / reload / stop / home | 🟡 | Works for navigation Aether controls (address bar, reader links, search results). Link clicks *inside* a Live view frame aren't visible to Aether, because cross-origin frames are opaque. |
| Live view (embedded site) | ✅ | Sandboxed iframe with per-site JS, forms and popups toggles, permission delegation, `no-referrer`, and frame-busting blocked. |
| Embedding-policy detection (`X-Frame-Options`, CSP `frame-ancestors`) | ✅ | Server-side, before rendering. |
| Reader view (server-extracted, scripts and trackers stripped) | ✅ | Mozilla Readability; DOMPurify on the client. |
| Automatic fallback: Live → Reader → new browser tab | ✅ | The mode is always labelled in the info bar. |
| Open in a regular browser tab | ✅ | `noopener,noreferrer`. |
| Remote browser sessions | ⛔ | Needs dedicated browser infrastructure that isn't part of this deployment. |
| Multiple tabs, pinned tabs, drag reordering | ✅ | |
| Tab groups (named, colored, collapsible) | ✅ | |
| Recently closed tabs / reopen | ✅ | |
| Background tabs stay alive | ✅ | The last 6 tabs stay mounted, preserving Live view state. |
| Split view | ✅ | Desktop widths (≥900px). |
| Saved sessions (save / restore open tabs) | ✅ | |
| Command palette (⌘/Ctrl+K) | ✅ | |
| Keyboard shortcuts | ✅ | Alt/⌥-based for tab actions, because browsers reserve Ctrl/⌘+T, W and L. |
| Aether search (private, server-side) | 🟢 | Brave Search API if `BRAVE_SEARCH_API_KEY` is set. Otherwise DuckDuckGo HTML, which may present a bot check, then Wikipedia as a fallback, with a notice. |
| Other search engines (DuckDuckGo, Brave, Startpage, Google) | 🟡 | Open as web pages; many of them block framing, which leads to Reader or a new tab. |
| Downloads | 🟡 | Aether exports (page → Markdown/HTML, notes, highlights, backups) are real downloads and listed in Library. Live view downloads are handled by the browser (`allow-downloads`). |

## Workspaces

| Feature | Status | Notes |
|---|---|---|
| Personal, Research, Work, Private + custom workspaces | ✅ | |
| Separate tabs, groups, history, chats and sessions per workspace | ✅ | |
| Per-workspace settings (default view, AI context, history, cookie isolation) | ✅ | |
| Private workspace (memory only, no history, consent before AI) | ✅ | Verified by e2e: nothing written to IndexedDB. |
| Temporary workspaces | ✅ | |
| Cookie isolation in Live view (`credentialless`) | 🟡 | Chromium only. Reported as unsupported elsewhere. |

## Productivity & research

| Feature | Status | Notes |
|---|---|---|
| Bookmarks (toggle, rename, filter, speed dial on new tab) | ✅ | |
| Reading list with offline text snapshot | ✅ | |
| Notes (Markdown, preview, export, AI reorganize) | ✅ | |
| Collections (add pages, open all, export, AI synthesis with citations) | ✅ | |
| Highlights in Reader view (persisted, re-applied, exportable) | ✅ | Reader view only. Live frames are cross-origin. |
| Page annotations: quote to note from a selection | ✅ | |
| History (search, per-workspace, delete entries, clear ranges, retention) | ✅ | |
| Export / import all data (JSON) | ✅ | |
| End-to-end-encrypted sync | 🟢 | AES-256-GCM client-side, Netlify Blobs storage. Round-trip tested with the in-memory store. |

## AI

| Feature | Status | Notes |
|---|---|---|
| Sidebar assistant with streaming | ✅ | |
| Explicit context selector (None, Page, Selection, Tabs, Workspace, Web, Collection) | ✅ | Verified: "None" sends no page text. |
| Summarize, key facts, translate, extract tables, study notes, compare tabs | ✅ | Quick actions. |
| Explain or translate selected text | ✅ | Selection works in Reader view. |
| Web research with numbered sources and citations | 🟢 | Search → read top N → cited answer. Depends on live search availability. |
| Citation chips linked to sources | ✅ | |
| Private-workspace consent gate | ✅ | Verified: no request without consent. |
| Provider: your Claude key (direct from browser) | 🟢 | Uses Anthropic's browser-access header. |
| Provider: your OpenAI key | 🟢 | |
| Provider: OpenAI-compatible endpoint | ✅ | Verified e2e against a streaming fixture. |
| Provider: local Ollama | 🟡 | Requires `OLLAMA_ORIGINS`. Blocked by Safari (no HTTPS → localhost calls). |
| Provider: Aether Cloud (NVIDIA NIM, server key) | 🟢 | Available when `NVIDIA_API_KEY` is set on the deployment. |
| Provider: Aether Cloud (Claude, server key) | 🟢 | Available when `ANTHROPIC_API_KEY` is set. |
| Save answers as notes | ✅ | |

## Privacy & network

| Feature | Status | Notes |
|---|---|---|
| Privacy center with measured stats (trackers, scripts, cookies, third parties, malicious blocks) | ✅ | Measured from server analyses. Live view frame requests are labelled not observable. |
| Per-page report (TLS, resolver, IP, proxy, redirects, embedding, trackers, cookies) | ✅ | |
| Tracker detection (~200 known domains, categorized) | ✅ | Not loaded in Reader view. |
| Third-party cookie handling | 🟡 | Server fetches never send or keep cookies. Live view: isolation via `credentialless` (Chromium), otherwise the browser's partitioning. |
| Malicious-domain protection | 🟢 | Cloudflare 1.1.1.2 malware resolver checked before fetching or showing a page. |
| DNS-over-HTTPS for server fetches (Cloudflare, Quad9, Google) + DNS test tool with DNSSEC flag | 🟢 | Falls back to the system resolver if DoH fails, and reports it. Can't change your device's DNS. |
| Proxy profiles: HTTP / HTTPS / SOCKS5 with auth | ✅ | Applies to server-side fetches only. The proxy host must be public. Tested against local HTTP and SOCKS5 proxies. |
| Open-proxy prevention / SSRF protection | ✅ | DNS pinning, private ranges, ports, redirects, size and time caps, rate limits. |
| Site permissions (JS, popups, forms, camera, mic, location, fullscreen, clipboard) | ✅ | Enforced through the iframe sandbox and `allow` attribute. |
| HTTPS indicator / insecure warning | ✅ | |
| Fingerprinting protection | ⛔ for Live view / ✅ for Reader | A web app can't alter the browser fingerprint. Site scripts never run in Reader view. |
| Network-wide tracker blocking in Live view | ⛔ | Web apps can't intercept another origin's requests. |
| VPN / anonymity | ⛔ | Not claimed. |

## Platform

| Feature | Status | Notes |
|---|---|---|
| Install-free, opens from an HTTPS URL | ✅ | Netlify. See TEST_REPORT.md for the deployment check. |
| Dark and light themes (+ follows system) | ✅ | |
| Responsive (desktop, tablet, mobile drawer, overlay assistant) | ✅ | Verified at 390px: no horizontal overflow. |
| Encrypted credential vault | ✅ | |
| No telemetry; local error log | ✅ | |
| Reduced-motion support | ✅ | |
