# Build Your Country

TikTok nation-building experiment: **1 follower = 1 citizen. The community decides everything.**

This repo is the creator's operating system — not the content itself.

- `docs/rules.md` — public rules (polls, comments, ownership thresholds, elections, wars)
- `docs/world-bible.md` — locked geography & style canon
- `docs/content-playbook.md` — episode formula, 30-day plan, risks
- `state/` — country state + public ledger of polls, events, citizens
- `tools/nation.mjs` — CLI: `npm run nation -- status | poll open | poll close | citizen add | episode`

## Daily loop
1. `npm run nation -- followers <n>` → snapshot population
2. `npm run nation -- poll close <id> "<winner>" "A=..,B=.."` (screenshot to `evidence/`)
3. `npm run nation -- day` then `npm run nation -- poll open "<question>" "A|B|C"`
4. `npm run nation -- episode` → script brief → produce → post
