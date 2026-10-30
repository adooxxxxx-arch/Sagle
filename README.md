# Aether

**A private, AI-native browser that runs from a link.** No install, no extension, no account.

- **Live view:** real sites embedded in a sandboxed frame, with per-site permissions.
- **Reader view:** pages fetched by Aether's server without your cookies or IP, with scripts and trackers stripped.
- **AI assistant:** sees only the context you choose (page, selection, tabs, workspace, web research) and cites its sources. Use your own Claude, OpenAI or compatible key, a local Ollama model, or the deployment's server key.
- **Workspaces:** Personal, Research, Work and Private (memory-only), plus tab groups, split view, sessions, bookmarks, reading list, notes, collections and highlights.
- **Privacy center:** measured tracker, cookie and third-party reports, malicious-domain blocking, DNS-over-HTTPS, HTTP/SOCKS5 proxy profiles and data-retention controls.
- **Local-first:** everything is stored in your browser. Optional end-to-end-encrypted sync.

Docs: [Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) · [Feature matrix](docs/FEATURE_MATRIX.md) · [Test report](docs/TEST_REPORT.md)

## Deploy (Netlify)

This repo is wired for Netlify (`netlify.toml`): the build is `npm run build`, with functions in `netlify/functions` and the AI edge function in `netlify/edge-functions`.

Optional environment variables (Site configuration → Environment variables):

| Variable | Enables |
|---|---|
| `NVIDIA_API_KEY` (+ `AETHER_NVIDIA_MODEL`, default `moonshotai/kimi-k3`) | "Aether Cloud · NVIDIA" AI provider |
| `ANTHROPIC_API_KEY` (+ `AETHER_ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) | "Aether Cloud · Claude" AI provider |
| `BRAVE_SEARCH_API_KEY` | Brave Search API for Aether search (otherwise DuckDuckGo, then Wikipedia) |

Never set `AETHER_ALLOW_PRIVATE_NETWORK` on a deployment. It's a local-test flag, and it's ignored on Netlify anyway.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — the SPA plus every /api route, no Netlify CLI needed
npm test           # unit + integration tests (server and frontend)
npm run test:e2e   # end-to-end in headless Chromium against local fixtures
npm run build
```
