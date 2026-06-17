# Stats pipeline + admin foundation — 2026-06-17

Built in trust mode while Jay stepped away. This is the decision log for review.

## Goal
Scout-facing player stats (modeled on capitalesdequebec.com — lean roster, stat-rich
player pages), backed by our own D1/R2 worker. GameChanger per-player stats are NOT on
the public API, so stats are entered by uploading a GC **screenshot** that Claude Haiku
vision parses; a human confirms before it's saved.

## What shipped this session
1. **Cloudflare Access (Zero Trust) admin gate** — app "Diamants Admin" protects
   `diamantsdequebec.ca/admin` (all `/admin/*`), policy allows `jay@canonniers.ca` via
   One-time PIN. No page passwords, no static tokens in HTML. (Set up via CF API.)
2. **Worker (`diamants-roster-worker`) — "done right" auth.** Admin endpoints now accept a
   **Cloudflare Access JWT** (`Cf-Access-Jwt-Assertion`, verified against the team JWKS +
   `aud` + `exp`) OR a `Bearer ADMIN_TOKEN` (CLI/seed only). Reached from the browser via the
   new zone route `diamantsdequebec.ca/admin/api/*` (Access-protected, so CF injects the JWT).
   The workers.dev URL keeps serving **public reads** only — admin writes can't be reached
   there because no JWT is present.
3. **D1 migration 002** — added `players.stats_json` (year-keyed
   `{"2026":{"batting":{…},"pitching":{…}}}`) and `players.provenance` (cégep/université/
   prior team — the 18–22 junior-élite "where they came from").
4. **Haiku vision endpoint** `POST /admin/api/stats/parse` — raw image in → `claude-haiku-4-5`
   → `{stat_type, season, columns, rows:[{name,number,stats}]}`. Returns 503 until the
   `ANTHROPIC_API_KEY` secret is set.
5. **`PUT /admin/api/players/:id/stats`** — merges one season's batting/pitching into stats_json.
6. **`admin/stats.html`** — upload screenshot → review parsed table → auto-match each row to a
   roster player (by number, then name) → confirm → commit. Human-in-the-loop by design.
7. **`joueur.html`** — public Capitales-style profile (`?slug=`): hero photo + number + name +
   position, bio grid (B/T, height, weight, age, hometown, school/team), scout "top stats"
   pills, and batting/pitching tables from the latest season in stats_json. Bilingual.
8. **`roster.html`** — player names now link to `joueur.html?slug=`.
9. Deleted the 26 stale `playerpage/player-*.html` files (superseded; were unlinked).

## Key decisions
- **Worker validates the Access JWT itself** rather than trusting the edge alone — otherwise the
  workers.dev URL would be an unauthenticated bypass. ADMIN_TOKEN kept only for CLI/seeding.
- **Admin pages under `/admin/` folder** so one Access app covers all current + future admin pages.
- **No structured-output schema on the Haiku call** — GC stat columns vary by view, so we parse
  free-form JSON (strong prompt + JSON.parse) and let the human fix anything in the review step.
- **Stats are screenshot-driven, not live** — GC public API has no per-player stats (confirmed).

## You must do ONE thing for stats parsing to work
Set the Anthropic key as a worker secret (the page shows a clear 503 until then):
```
cd workers/diamants-roster-worker
printf "%s" "$(cat .anthropic-key.txt)" | NODE_OPTIONS=--use-system-ca npx wrangler secret put ANTHROPIC_API_KEY
```
(Drop the key into `workers/diamants-roster-worker/.anthropic-key.txt` — gitignored.)

## Verify on the live site
- `diamantsdequebec.ca/roster.html` → click a name → `joueur.html?slug=…` profile loads.
- `diamantsdequebec.ca/admin/stats.html` → Access email-PIN challenge → upload a GC screenshot.

## Deferred (documented, not built this session)
- **Standings page** (`classement.html`) from GC `/organizations/pOB6Vo6Plt6g/standings` via a new
  `diamants-standings-worker` (KV + cron + preserveOnEmpty).
- **Schedule → GameChanger** — migrate `calendrier.html` off the Spordle proxy to GC
  `/teams/KzOMwA29XZzU/games`.
- **`admin-roster.html`** CRUD + photo upload (roster editing); `admin.html` hub.
Each is a sizable feature; shipped the stats slice clean rather than half-landing several.
