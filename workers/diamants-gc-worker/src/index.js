// diamants-gc-worker
// Proxies/harvests GameChanger (CORS-locked to web.gc.com) into KV for the public site.
//   GET /api/games        -> { games:[...], updated_at }   (schedule + scores + status)
//   GET /api/standings     -> { standings:[...], updated_at }
//   GET /api/team-logo/:id -> 302 to the team's current (signed, ~7min) GC avatar
//   GET /api/news          -> { items:[...], configured } (Spordle; dormant until secrets set)
//   GET /health
// Cron refreshes games+standings+teams into KV with preserve-on-empty so a transient
// empty GC fetch never wipes good data. Reads also refresh when stale.

const GC   = 'https://api.team-manager.gc.com/public';
const ORG  = 'pOB6Vo6Plt6g';   // LBJEQ
const TEAM = 'KzOMwA29XZzU';   // Diamants de Québec

const GAMES_TTL = 90_000;      // near-live during games
const STAND_TTL = 300_000;
const TEAMS_TTL = 240_000;     // < GC signed-avatar lifetime so logo redirects stay valid
const NEWS_TTL  = 15 * 60_000; // Spordle league news (cached — the full feed is ~6MB)
const SPORDLE_SLUG = 'ligue-de-baseball-junior-elite-du-quebec'; // LBJEQ league page (posts often)

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...cors } });

async function gcFetch(path) {
  try {
    const r = await fetch(`${GC}${path}`, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Read-through cache with preserve-on-empty.
async function getCached(env, key, ttlMs, refreshFn) {
  let cached = null;
  try { cached = await env.GC.get(key, 'json'); } catch {}
  if (cached && (Date.now() - cached.ts) < ttlMs) return cached;
  let data = null;
  try { data = await refreshFn(env); } catch {}
  const empty = data == null || (Array.isArray(data) && data.length === 0);
  if (empty && cached && Array.isArray(cached.data) && cached.data.length) return cached; // don't wipe good data
  if (data == null) return cached || { data: [], ts: 0 };
  const out = { data, ts: Date.now() };
  try { await env.GC.put(key, JSON.stringify(out)); } catch {}
  return out;
}

async function refreshTeams() {
  const raw = await gcFetch(`/organizations/${ORG}/teams`);
  if (!Array.isArray(raw)) return null;
  return raw.map(t => ({ id: t.id, name: t.name || '', avatar_image: t.avatar_image || null, record: t.record || null }));
}
const getTeams = (env) => getCached(env, 'teams', TEAMS_TTL, refreshTeams).then(c => c.data || []);

async function refreshGames(env) {
  const raw = await gcFetch(`/teams/${TEAM}/games`);
  if (!Array.isArray(raw)) return null;
  const teams = await getTeams(env);
  const nameToId = {};
  for (const t of teams) if (t.name) nameToId[t.name] = t.id;
  return raw.map(g => {
    const oppName = g.opponent_team && g.opponent_team.name ? g.opponent_team.name : '';
    const s = g.score || null;
    return {
      id:              g.id,
      start_ts:        g.start_ts || null,
      timezone:        g.timezone || 'America/Toronto',
      home_away:       g.home_away || null,
      status:          g.game_status || 'scheduled',
      our_score:       s && typeof s.team === 'number'          ? s.team          : null,
      opp_score:       s && typeof s.opponent_team === 'number' ? s.opponent_team : null,
      opponent_name:   oppName,
      opponent_id:     nameToId[oppName] || null,
      has_live_stream: !!g.has_live_stream,
      has_videos:      !!g.has_videos_available,
    };
  }).sort((a, b) => new Date(a.start_ts || 0) - new Date(b.start_ts || 0));
}

async function refreshStandings(env) {
  const raw = await gcFetch(`/organizations/${ORG}/standings`);
  if (!Array.isArray(raw)) return null;
  const teams = await getTeams(env);
  const byId = {};
  for (const t of teams) byId[t.id] = t;
  const rows = raw.map(s => {
    const o = s.overall || {};
    const w = o.wins || 0, l = o.losses || 0, t = o.ties || 0;
    const st = s.streak || {};
    const t0 = byId[s.team_id] || {};
    return {
      team_id: s.team_id,
      name:    t0.name || s.team_id,
      gp:      w + l + t,
      w, l, t,
      pct:     typeof s.winning_pct === 'number' ? s.winning_pct : 0,
      rs:      s.runs ? s.runs.scored : null,
      ra:      s.runs ? s.runs.allowed : null,
      diff:    s.runs ? s.runs.differential : null,
      streak:  st.count ? `${st.count}${(st.type || '').charAt(0).toUpperCase()}` : '—',
      is_us:   s.team_id === TEAM,
    };
  });
  rows.sort((a, b) => (b.pct - a.pct) || ((b.diff || 0) - (a.diff || 0)));
  return rows;
}

// Spordle league news. The API returns ~3000 items oldest-first (~6MB), so we sort
// newest-first here, keep the top 6, and fetch each article's banner image (the list
// has none — it lives in the detail under page_attachments[*].object_url). Cached by
// the /api/news handler.
const spHeaders = (env) => ({ 'Accept': 'application/json', 'Origin': 'https://page.spordle.com', 'Referer': 'https://page.spordle.com/', 'x-api-key': env.SPORDLE_PAGE_API_KEY });

async function newsImage(env, id, lang) {
  try {
    const r = await fetch(`https://api.page.spordle.com/pages/${env.SPORDLE_PAGE_ID}/custom-pages/${id}?display_lang=${lang}`, { headers: spHeaders(env) });
    if (!r.ok) return null;
    const d = await r.json();
    const atts = d.page_attachments || {};
    for (const k in atts) { const u = atts[k] && atts[k].object_url; if (u) return u; }
  } catch {}
  return null;
}

async function refreshNews(env, lang = 'fr') {
  const r = await fetch(`https://api.page.spordle.com/pages/${env.SPORDLE_PAGE_ID}/custom-pages?display_lang=${lang}&type=NEWS`, { headers: spHeaders(env) });
  if (!r.ok) return null;
  const d = await r.json();
  const arr = Array.isArray(d) ? d : (d.custom_pages || d.data || d.records || []);
  if (!Array.isArray(arr)) return null;
  const top = arr
    .filter(p => p.published_date && (p.is_published === undefined || p.is_published))
    .sort((a, b) => new Date(b.published_date) - new Date(a.published_date))
    .slice(0, 6);
  const items = await Promise.all(top.map(async p => {
    const id = p.custom_page_id || p.id;
    return {
      id,
      title: (p.i18n && p.i18n[lang] && p.i18n[lang].name) || p.name || p.title || '',
      date:  p.published_date || '',
      image: await newsImage(env, id, lang),
      href:  `https://page.spordle.com/${lang}/${SPORDLE_SLUG}/news/${id}`,
    };
  }));
  return items.filter(x => x.title);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/games') {
        const c = await getCached(env, 'games', GAMES_TTL, refreshGames);
        return json({ games: c.data || [], updated_at: c.ts || null });
      }
      if (path === '/api/standings') {
        const c = await getCached(env, 'standings', STAND_TTL, refreshStandings);
        return json({ standings: c.data || [], updated_at: c.ts || null });
      }
      const logo = path.match(/^\/api\/team-logo\/([A-Za-z0-9_-]+)$/);
      if (logo) {
        const teams = await getTeams(env);
        const t = teams.find(x => x.id === logo[1]);
        if (t && t.avatar_image) return Response.redirect(t.avatar_image, 302);
        return new Response('Not found', { status: 404, headers: cors });
      }
      // Image proxy: re-serve a Spordle image with a correct image/* content-type
      // (Spordle serves them as application/octet-stream, which browsers won't always
      // render inline). Cached at our edge. Locked to Spordle hosts (not an open proxy).
      if (path === '/api/img') {
        const u = url.searchParams.get('u');
        if (!u) return new Response('missing u', { status: 400, headers: cors });
        let target;
        try { target = new URL(u); } catch { return new Response('bad u', { status: 400, headers: cors }); }
        const ALLOWED = new Set(['cdn.spordle.com', 'spordle-filestorage-public.s3.ca-central-1.amazonaws.com']);
        if (!ALLOWED.has(target.hostname)) return new Response('forbidden host', { status: 403, headers: cors });
        const cache = caches.default;
        const cacheKey = new Request(request.url);
        let resp = await cache.match(cacheKey);
        if (!resp) {
          let up = await fetch(target.toString());
          if (!up.ok && target.hostname === 'cdn.spordle.com') {
            up = await fetch(target.toString().replace('cdn.spordle.com', 'spordle-filestorage-public.s3.ca-central-1.amazonaws.com'));
          }
          if (!up.ok) return new Response('upstream ' + up.status, { status: 502, headers: cors });
          const ext = (target.pathname.split('.').pop() || '').toLowerCase();
          const ct = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
          resp = new Response(up.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', ...cors } });
          ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        }
        return resp;
      }

      if (path === '/api/news') {
        const lang = (url.searchParams.get('lang') || 'fr').toLowerCase() === 'en' ? 'en' : 'fr';
        if (!env.SPORDLE_PAGE_ID || !env.SPORDLE_PAGE_API_KEY) return json({ items: [], configured: false });
        const key = `news2:${lang}`; // bump when the news item shape changes
        let cached = null;
        try { cached = await env.GC.get(key, 'json'); } catch {}
        if (cached && (Date.now() - cached.ts) < NEWS_TTL) return json({ items: cached.data, configured: true });
        let data = null;
        try { data = await refreshNews(env, lang); } catch {}
        if ((!data || !data.length) && cached) return json({ items: cached.data, configured: true }); // preserve
        if (!data) return json({ items: cached ? cached.data : [], configured: true, error: 'fetch failed' });
        try { await env.GC.put(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
        return json({ items: data, configured: true });
      }
      if (path === '/health' || path === '/') {
        return json({ ok: true, service: 'diamants-gc-worker' });
      }
      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    // Force-refresh by zeroing TTL via direct refresh + preserve-on-empty write.
    ctx.waitUntil((async () => {
      for (const [key, fn] of [['teams', refreshTeams], ['games', refreshGames], ['standings', refreshStandings]]) {
        let data = null;
        try { data = await fn(env); } catch {}
        const empty = data == null || (Array.isArray(data) && data.length === 0);
        if (empty) continue; // preserve existing
        try { await env.GC.put(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
      }
    })());
  },
};
