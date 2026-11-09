# The Rules (publish these pinned + on a website/bio link)

Credibility is the product. Rules are fixed BEFORE they are needed.

## Citizens
- 1 follower = 1 citizen. Population = follower count at each day's snapshot (logged in `state/ledger.json`).
- Followers fluctuate: population can shrink. That is a feature (emigration/crisis storylines), not a bug.
- Named citizens: anyone can claim a name in the registry by commenting `CITIZEN` on the pinned video. Only named citizens can hold office/own projects.

## Polls (one official poll per episode)
- Poll closes 20h after posting. Results are screenshotted at close with timestamp; screenshot stored in `evidence/` and shown in the next episode.
- Winner implemented in next episode. No re-runs. No overrides. Ties: 2nd poll (6h, tied options only); still tied → coin-flip on camera.
- Admin veto only for: TikTok policy violations, hateful/illegal content, impossible geography. Veto is logged publicly with the reason; next-highest option wins.

## Comments = proposals (scaled thresholds)
Likes needed scale with the stage so early followers aren't locked out:

| Stage | Population | Official proposal | Own a project | Admin rights |
|---|---|---|---|---|
| 1 | <1k | 25 likes | 50 | 100 |
| 2 | 1k–10k | 100 | 250 | 500 |
| 3 | 10k–100k | 500 | 1,500 | 3,000 |
| 4 | 100k+ | 1,000 | 5,000 | 10,000 |

- Likes counted at poll close, same moment as the screenshot.
- Likes buy *influence and proposals*. Offices come ONLY from elections.
- Big-ticket proposals (stadium, war, nukes, spaceport) always need a community poll AND treasury funds.

## Elections
- Nomination: comment `RUN` (named citizens only). Top 3 by likes advance.
- Vote: official poll, plurality. Term: 14 days (game time = real time). Removal: recall poll at 60%.

## Wars & hard content
- War requires a citizen poll with a stated cause, costs in treasury, and a defined win condition.
- Fictional nations only. No real countries, real people, real ethnic/religious targets.

## Records
- Every poll, event, and title is appended to `state/ledger.json` and published as a public archive.
- Citizen names are engraved permanently (buildings/streets) via `titles` in the registry.
