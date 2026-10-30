# Aether — Privacy

Aether is privacy-first. It does not offer anonymity, and it never claims to. This document states exactly what Aether stores, what it sends, and to whom.

## What stays on your device

| Data | Where | Notes |
|---|---|---|
| Workspaces, tabs, groups, sessions, history | IndexedDB (`aether` database) | Ephemeral and private workspaces are filtered out before every write. They exist only in memory. |
| Bookmarks, reading list (with offline text), notes, collections, highlights | IndexedDB | — |
| AI conversations | IndexedDB | Except conversations in ephemeral and private workspaces. |
| API keys, proxy passwords, sync passphrase | Vault in IndexedDB | Optionally encrypted with AES-256-GCM using a passphrase-derived key (PBKDF2-SHA256, 310k iterations). Locked vaults keep plaintext only in memory. |
| Page analyses (reader text, privacy reports) | Memory only | Gone when the tab closes. |
| Error log | Memory only (last 50) | Shown in Settings → About. Never transmitted. |

There is **no account, no analytics, no telemetry, no ad or tracking script**, and no third-party script of any kind. The CSP enforces `script-src 'self'`.

## What leaves your device, and when

| Action | Sent to | What | Retention |
|---|---|---|---|
| Opening a page (server analysis on) | Aether server → the site | The URL. The fetch carries **no cookies, no referer**, and a generic user agent. The site sees Aether's server IP, not yours. | Not logged. Functions never log URLs, queries, page content or IPs. |
| Live view | The site, directly from your browser | Everything a normal visit sends: your IP and the site's cookies (unless cookie isolation is on). Referrer is suppressed. | Up to the site. |
| Aether search | Aether server → Brave Search API / DuckDuckGo / Wikipedia | The query only. Your IP isn't shared with the engine. | Not logged by Aether. |
| Malware check | Aether server → Cloudflare `security.cloudflare-dns.com` | The hostname. | Cloudflare's resolver policy. |
| DNS for server fetches | Aether server → the chosen DoH resolver (Cloudflare, Quad9, Google) | Hostnames. | That resolver's policy. |
| Reader images (setting) | Direct: the image host sees your IP. Through Aether: the server fetches them instead. Blocked: nothing is fetched. | Image URLs | — |
| AI, BYOK provider | Directly from your browser to the provider | Your message plus **only** the context you selected | The provider's policy. |
| AI, "Aether Cloud" provider | Aether edge function → NVIDIA or Anthropic | Your message plus the selected context | Not logged by Aether. The provider's policy applies. |
| AI, Ollama | Your own machine | Everything stays local. | — |
| Encrypted sync (opt-in) | Aether server (Netlify Blobs) | Ciphertext only, under `sha256(sync id)`. Contains no history (unless exported manually), no tabs, no keys, and nothing from private workspaces. | Until you delete it from Settings → Sync. |

### AI context rules
- The assistant sees **nothing** from your browsing unless you choose a context (Page, Selection, Tabs, Workspace, Web research or Collection). The selected context is shown under the input and stamped on every message.
- **Private workspaces** default to "None", and **ask for explicit consent** before any page content goes to a non-local model. The consent lasts for the session only.
- Settings → AI → "Always ask before sharing pages with cloud AI" extends that prompt to every workspace.
- Web page text is passed to models as untrusted data, with instructions to ignore any commands it contains.

## Private and temporary workspaces

| | Private | Temporary | Standard |
|---|---|---|---|
| Tabs, history, chats written to disk | No | No | Yes |
| History recorded | Never | Off by default | Yes (retention configurable, default 90 days) |
| Live view cookies | Isolated (`credentialless` iframes, Chromium) | Configurable | Configurable |
| AI page access | Asks first | Per message | Per message |

When the Aether tab closes, a private session's tabs, history, AI chats, page cache and consent are gone. Aether never wrote them anywhere. **Your browser itself** may still have cached resources or history entries for sites loaded in Live view. Use your browser's own private window if that matters.

`credentialless` iframes are supported in Chromium-based browsers only. Elsewhere, Aether shows "Not supported", and embedded sites use the browser's normal third-party cookie partitioning (Firefox Total Cookie Protection, Safari ITP).

## Understanding the terms (no overstatement)

- **Local privacy** covers what is stored on your device. Aether keeps your data local and lets you erase it (Settings → Data → Erase all data).
- **Network privacy** covers who can observe your traffic. HTTPS hides page contents, but your network operator can still see which hosts you connect to unless you use encrypted DNS and a VPN at the OS level.
- **IP masking:** Reader view, Aether search and the image proxy hide your IP from sites. Live view does not.
- **Proxy profiles** reroute **only Aether's server-side fetches** through your HTTP, HTTPS or SOCKS5 proxy. They are **not a VPN**: they don't touch your device's traffic or Live view. The proxy password is sent to Aether's server only with each fetch that uses it, and is never stored there.
- **Fingerprinting:** a web app can't change your browser's fingerprint. Reader view avoids it because site scripts never run. For Live view, use a browser with fingerprinting protection.
- **Anonymity:** Aether doesn't provide it. Logins, cookies, behavior and fingerprinting can identify you.

## Data retention controls

- History retention: 1, 7, 30, 90 or 365 days, or forever. It's pruned on every start.
- Clear history (last hour, last day, all, or per workspace), clear AI chats, clear page cache.
- Export everything (JSON), import with merge, erase all local data.
- Sync: delete the server copy at any time.

## Server-side retention

Aether's functions are stateless. The only persistent server data is encrypted sync envelopes, which you create explicitly. Hosting-provider infrastructure logs (Netlify request logs: path, status, timing) are outside the application's control. Aether keeps URLs out of request paths for page fetches (they travel in POST bodies). `/api/image` is the exception: it takes the image URL as a query parameter so that `<img>` can use it.
