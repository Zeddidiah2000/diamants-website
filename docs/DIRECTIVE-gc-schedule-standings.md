# GameChanger schedule + scores, standings, homepage feeds — 2026-06-17

Built in trust mode. Decision log for review.

## Goal
Make GameChanger the source of truth for schedule/scores/standings (GC per-game scores
live only behind a CORS-locked API), add a standings page, fix the broken homepage
"Prochains matchs" sidebar, and surface team news (Spordle) + the Facebook page.

## New worker: `diamants-gc-worker`
GC is CORS-locked to web.gc.com, so the browser can't call it — this worker proxies/harvests
it. https://diamants-gc-worker.chisholm2000.workers.dev (KV `GC` = `16df0fa1…`, cron `*/10`).
- `GET /api/games` → `{games:[{id,start_ts,home_away,status,our_score,opp_score,opponent_name,opponent_id,has_live_stream}],updated_at}` from `/teams/KzOMwA29XZzU/games`. Score `{team,opponent_team}` maps to our/opp directly (team = us).
- `GET /api/standings` → `{standings:[{name,gp,w,l,pct,rs,ra,diff,streak,is_us,logo_id}]}` from `/organizations/pOB6Vo6Plt6g/standings` joined to `/teams` for names.
- `GET /api/team-logo/:teamId` → 302 to the team's **current** signed GC avatar (GC avatars are signed and expire ~7min; teams are cached <4min so the redirect target is always fresh — no broken logos, no asset mirroring).
- `GET /api/news` → Spordle proxy, **dormant** until two secrets are set (see below).
- Read-through KV cache with **preserve-on-empty**: a transient empty GC fetch never wipes good data. Reads refresh when stale (games 90s, standings 5min); cron keeps it warm.

## calendrier.html — GC source + scores (card look kept)
Switched the data layer from the Spordle proxy to `diamants-gc-worker /api/games`. Same
monthly-grouped card markup. The `.game-meta` now shows, per game:
- **Played** (`completed`/`final`/`forfeit` + score) → `our – opp` with a V/D/N (W/L/T) chip, green/red/navy.
- **Future** → start time (formatted in America/Toronto for any viewer).
- **postponed/cancelled** → Reporté / Annulé.
- **Past with no score** → "Reporté / Rescheduled" (per your rule: no score = it was rescheduled).
- **Live** (in [start, +5h], not completed, has stream/score) → EN DIRECT chip + running score.
Auto-refreshes every 60s for live scores. (GC has no game number / venue, so those dropped.)

## classement.html — new standings page
Fetches `/api/standings`, renders the full LBJEQ table (rank, team+logo, GP/W/L/%, RF/RA/DIFF,
streak), Diamants row highlighted. Bilingual, navy+red, 2-min refresh. Added "Classement" to the
nav on index/calendrier/roster/joueur/classement.

## index.html — homepage
- **Prochains matchs sidebar** was broken by a stray `}` syntax error that threw and killed the
  whole inline script. Rewrote it: fetches GC `/api/games` directly (no more localStorage
  dependency), shows the next 4 upcoming games, or falls back to the last 3 results if the season's
  between games.
- **Facebook**: embedded the official **FB Page Plugin** for facebook.com/diamantsquebec in the
  "Publications récentes" card (live posts + images), and pointed the Social Media Facebook button
  at the real page.
- **News**: wrapped the 3 static cards in `#news-cards`; a loader pulls Spordle news from
  `/api/news` and replaces them **if** items come back — otherwise the static cards stay. (Dormant
  until the two Spordle secrets are set; the FB plugin is the live news/images feed meanwhile.)

## Spordle news — needs 2 values (optional, like the Anthropic key)
The Spordle page is a SPA, so its page UUID + API key aren't fetchable server-side. `/api/news`
returns `{items:[],configured:false}` until both are set on the gc-worker. To enable: open
page.spordle.com/diamants-de-quebec in a browser, DevTools → Network → find the
`api.page.spordle.com/pages/<UUID>/custom-pages` request, copy the `<UUID>` and the `x-api-key`
header, then:
```
cd workers/diamants-gc-worker
printf "%s" "<UUID>"   | npx wrangler secret put SPORDLE_PAGE_ID
printf "%s" "<apikey>" | npx wrangler secret put SPORDLE_PAGE_API_KEY
```
(The response-shape mapping in `/api/news` is a best guess since it's untestable without the key —
may need a tweak once real data flows.)

## Verify on the live site
- `calendrier.html` → played games show scores (V/D/N); future show times.
- `classement.html` → LBJEQ table, Diamants highlighted.
- `index.html` → Prochains matchs populates; Facebook page renders in the sidebar.
