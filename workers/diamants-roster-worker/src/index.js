// diamants-roster-worker
// Public:  GET /api/players, /api/players/:slug, /api/staff, /photos/:key, /health
// Admin:   POST/PUT/DELETE /api/players[/:id][/photo], same for /api/staff,
//          POST /api/stats/parse (Haiku vision), PUT /api/players/:id/stats
//
// Admin auth ("done right" — no static page password):
//   - Browser admin pages live under diamantsdequebec.ca/admin/ behind Cloudflare
//     Access. They call this worker at diamantsdequebec.ca/admin/api/... (a zone
//     route, see wrangler.toml). CF Access injects a signed JWT in the
//     `Cf-Access-Jwt-Assertion` header, which this worker verifies (signature via
//     JWKS + aud + exp). The workers.dev URL has no such header, so admin writes
//     cannot be reached there — Access cannot be bypassed.
//   - A `Bearer <ADMIN_TOKEN>` is also accepted, for CLI/seed scripts only.

const TEAM_DOMAIN  = 'quebecsports.cloudflareaccess.com';
const ACCESS_AUD   = '74b23be97120ac4fe6191f7278dea789c349e0e913edd2f4e4a82683a3df4b1a';
const ACCESS_CERTS = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;

const POSITION_GROUPS = new Set(['P', 'C', 'IF', 'OF']);
const VALID_BT        = new Set(['R/R', 'R/L', 'L/L', 'L/R', 'S/R', 'S/L', '']);
const VALID_POS_CODES = new Set(['P','C','1B','2B','3B','SS','LF','CF','RF','OF','IF','DH','U']);
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES    = 5 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// ── Cloudflare Access JWT verification ──────────────────────────────────────
let _jwks = null, _jwksAt = 0;
async function getJwks() {
  const now = Date.now();
  if (_jwks && (now - _jwksAt) < 3600_000) return _jwks;
  const r = await fetch(ACCESS_CERTS);
  if (!r.ok) return _jwks || [];
  const j = await r.json();
  _jwks = j.keys || [];
  _jwksAt = now;
  return _jwks;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

async function verifyAccessJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = JSON.parse(b64urlToStr(h));
    const keys = await getJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    const data = new TextEncoder().encode(`${h}.${p}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), data);
    if (!ok) return null;
    const claims = JSON.parse(b64urlToStr(p));
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;
    if (claims.iss && claims.iss !== `https://${TEAM_DOMAIN}`) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(ACCESS_AUD)) return null;
    return { email: claims.email || claims.identity || null };
  } catch {
    return null;
  }
}

async function requireAuth(request, env) {
  // 1. Cloudflare Access JWT (browser admin via diamantsdequebec.ca/admin/...)
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) {
    const claims = await verifyAccessJwt(jwt);
    if (claims) return null;
    return new Response('Unauthorized (invalid Access JWT)', { status: 401, headers: cors });
  }
  // 2. Bearer ADMIN_TOKEN (CLI / seed scripts only)
  const auth = request.headers.get('Authorization') || '';
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return null;
  return new Response('Unauthorized', { status: 401, headers: cors });
}

function validatePlayer(data, { partial = false } = {}) {
  const required = ['slug', 'first_name', 'last_name', 'position_group'];
  if (!partial) {
    for (const k of required) {
      if (!data[k] || String(data[k]).trim() === '') return `Missing required field: ${k}`;
    }
  }
  if (data.position_group != null && !POSITION_GROUPS.has(data.position_group)) {
    return `Invalid position_group: ${data.position_group}`;
  }
  if (data.bats_throws != null && data.bats_throws !== '' && !VALID_BT.has(data.bats_throws)) {
    return `Invalid bats_throws: ${data.bats_throws}`;
  }
  if (data.positions != null && data.positions !== '') {
    for (const code of String(data.positions).split(',')) {
      if (!VALID_POS_CODES.has(code.trim())) return `Invalid position code: ${code}`;
    }
  }
  if (data.weight != null && data.weight !== '') {
    const w = parseInt(data.weight);
    if (isNaN(w) || w < 80 || w > 350) return 'weight must be 80–350 lbs';
  }
  if (data.height_inches != null && data.height_inches !== '') {
    const h = Number(data.height_inches);
    if (!Number.isInteger(h) || h < 48 || h > 96) return 'height_inches must be 48–96';
  }
  if (data.birthdate != null && data.birthdate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(data.birthdate)) {
    return 'birthdate must be YYYY-MM-DD';
  }
  if (data.slug != null && !/^[a-z0-9-]+$/.test(data.slug)) {
    return 'slug must be lowercase a-z, 0-9, hyphen';
  }
  return null;
}

const PLAYER_COLS = [
  'spordle_id','slug','first_name','last_name','number','position_group','positions',
  'bats_throws','height_inches','weight','birthdate',
  'hometown_city','hometown_state','hometown_country','provenance',
  'photo_key','is_captain','is_affiliate','bio_fr','bio_en','display_order',
];

const STAFF_COLS = [
  'spordle_id','first_name','last_name','role_fr','role_en','photo_key','bio_fr','bio_en','display_order',
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

// ── Haiku vision: parse a GameChanger stats screenshot into JSON ────────────
const STATS_PROMPT = `You are extracting baseball statistics from a GameChanger app screenshot of a TEAM stats table (one row per player).
Return ONLY a JSON object — no prose, no markdown code fences.
Shape:
{
  "stat_type": "batting" | "pitching" | "unknown",
  "season": "<4-digit year if visible, else empty string>",
  "columns": ["<stat column abbreviations exactly as shown, e.g. AVG, OBP, OPS, HR, RBI, ERA, IP, WHIP>"],
  "rows": [
    { "name": "<player full name as shown>", "number": "<jersey number or empty>", "stats": { "<COLUMN>": "<value exactly as shown>", ... } }
  ]
}
Use the exact column abbreviations and values shown. Keep all values as strings. If a cell is blank, use "".`;

function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function extractJson(t) {
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return (a >= 0 && b >= a) ? t.slice(a, b + 1) : t;
}
async function parseStatsWithHaiku(b64, mediaType, env) {
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: STATS_PROMPT },
      ],
    }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(extractJson(text));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url    = new URL(request.url);
    const method = request.method;
    // Requests reaching the worker via the Access-protected zone route arrive as
    // /admin/api/... — strip the /admin prefix so routing is identical to workers.dev.
    let path = url.pathname;
    if (path.startsWith('/admin/')) path = path.slice('/admin'.length);

    try {
      // ── Photos: GET /photos/:key ────────────────────────────────────────────
      if (path.startsWith('/photos/')) {
        const key = decodeURIComponent(path.slice('/photos/'.length));
        if (!key) return new Response('Not found', { status: 404, headers: cors });
        const obj = await env.BUCKET.get(key);
        if (!obj) return new Response('Not found', { status: 404, headers: cors });
        const headers = new Headers({ 'Cache-Control': 'public, max-age=86400', ...cors });
        if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
        if (obj.etag) headers.set('ETag', obj.etag);
        return new Response(obj.body, { headers });
      }

      // ── Players ──────────────────────────────────────────────────────────────
      if (path === '/api/players' && method === 'GET') {
        const order = `CASE position_group WHEN 'P' THEN 1 WHEN 'C' THEN 2 WHEN 'IF' THEN 3 WHEN 'OF' THEN 4 ELSE 5 END`;
        const { results } = await env.DB.prepare(
          `SELECT * FROM players ORDER BY ${order}, display_order ASC, last_name ASC`
        ).all();
        return json(results);
      }

      const playerSlugMatch = path.match(/^\/api\/players\/([a-z0-9-]+)$/);
      if (playerSlugMatch && method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM players WHERE slug = ?').bind(playerSlugMatch[1]).first();
        if (!row) return json({ error: 'Not found' }, 404);
        return json(row);
      }

      if (path === '/api/players' && method === 'POST') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const body = await request.json();
        const err = validatePlayer(body); if (err) return json({ error: err }, 400);
        const data = pick(body, PLAYER_COLS);
        const cols = Object.keys(data);
        const placeholders = cols.map(() => '?').join(', ');
        const r = await env.DB.prepare(
          `INSERT INTO players (${cols.join(', ')}) VALUES (${placeholders})`
        ).bind(...cols.map(c => data[c] ?? null)).run();
        const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(r.meta.last_row_id).first();
        return json(row, 201);
      }

      // PUT /api/players/:id/stats  (admin) — merge stats_json for one season
      const statsMatch = path.match(/^\/api\/players\/(\d+)\/stats$/);
      if (statsMatch && method === 'PUT') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(statsMatch[1]);
        const body = await request.json();
        const season = String(body.season || '').trim();
        if (!/^\d{4}$/.test(season)) return json({ error: 'season must be a 4-digit year' }, 400);
        const player = await env.DB.prepare('SELECT stats_json FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Not found' }, 404);
        let stats = {};
        try { stats = player.stats_json ? JSON.parse(player.stats_json) : {}; } catch { stats = {}; }
        // Column-level merge: a new upload adds/updates columns without wiping
        // ones from a previous screenshot. Blank cells don't clobber existing values.
        const mergeStat = (prev, next) => {
          const out = { ...(prev || {}) };
          for (const [k, v] of Object.entries(next || {})) {
            if (v !== '' && v != null) out[k] = v;
          }
          return out;
        };
        stats[season] = stats[season] || {};
        if (body.batting  && typeof body.batting  === 'object') stats[season].batting  = mergeStat(stats[season].batting,  body.batting);
        if (body.pitching && typeof body.pitching === 'object') stats[season].pitching = mergeStat(stats[season].pitching, body.pitching);
        await env.DB.prepare("UPDATE players SET stats_json = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(JSON.stringify(stats), id).run();
        const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
        return json(row);
      }

      const playerIdMatch = path.match(/^\/api\/players\/(\d+)$/);
      if (playerIdMatch && method === 'PUT') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(playerIdMatch[1]);
        const body = await request.json();
        const err = validatePlayer(body, { partial: true }); if (err) return json({ error: err }, 400);
        const data = pick(body, PLAYER_COLS);
        const cols = Object.keys(data);
        if (cols.length === 0) return json({ error: 'Nothing to update' }, 400);
        const setClause = cols.map(c => `${c} = ?`).join(', ');
        await env.DB.prepare(
          `UPDATE players SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
        ).bind(...cols.map(c => data[c] ?? null), id).run();
        const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Not found' }, 404);
        return json(row);
      }

      if (playerIdMatch && method === 'DELETE') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(playerIdMatch[1]);
        const player = await env.DB.prepare('SELECT photo_key FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Not found' }, 404);
        if (player.photo_key) { try { await env.BUCKET.delete(player.photo_key); } catch {} }
        await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      // POST /api/players/:id/photo  (admin) — body = raw image bytes
      const photoUploadMatch = path.match(/^\/api\/players\/(\d+)\/photo$/);
      if (photoUploadMatch && method === 'POST') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(photoUploadMatch[1]);
        const contentType = request.headers.get('Content-Type') || '';
        if (!ALLOWED_PHOTO_MIME.has(contentType)) return json({ error: `Unsupported Content-Type: ${contentType}` }, 415);
        const buf = await request.arrayBuffer();
        if (buf.byteLength === 0)             return json({ error: 'Empty body' }, 400);
        if (buf.byteLength > MAX_PHOTO_BYTES) return json({ error: 'File too large (>5MB)' }, 413);
        const player = await env.DB.prepare('SELECT id, slug, photo_key FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Not found' }, 404);
        const ext = contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg');
        const key = `players/${player.slug}.${ext}`;
        await env.BUCKET.put(key, buf, { httpMetadata: { contentType } });
        if (player.photo_key && player.photo_key !== key) {
          try { await env.BUCKET.delete(player.photo_key); } catch {}
        }
        await env.DB.prepare("UPDATE players SET photo_key = ?, updated_at = datetime('now') WHERE id = ?").bind(key, id).run();
        return json({ ok: true, photo_key: key });
      }

      // ── Stats parsing: POST /api/stats/parse  (admin) — body = raw image bytes
      if (path === '/api/stats/parse' && method === 'POST') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured on the worker' }, 503);
        const ct = request.headers.get('Content-Type') || '';
        if (!ALLOWED_PHOTO_MIME.has(ct)) return json({ error: `Unsupported image type: ${ct}` }, 415);
        const buf = await request.arrayBuffer();
        if (buf.byteLength === 0)             return json({ error: 'Empty body' }, 400);
        if (buf.byteLength > MAX_PHOTO_BYTES) return json({ error: 'Image too large (>5MB)' }, 413);
        try {
          const parsed = await parseStatsWithHaiku(bytesToB64(new Uint8Array(buf)), ct, env);
          return json(parsed);
        } catch (e) {
          return json({ error: `Parse failed: ${e.message || String(e)}` }, 502);
        }
      }

      // ── Staff ──────────────────────────────────────────────────────────────
      if (path === '/api/staff' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM staff ORDER BY display_order ASC, last_name ASC'
        ).all();
        return json(results);
      }

      if (path === '/api/staff' && method === 'POST') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const body = await request.json();
        const data = pick(body, STAFF_COLS);
        if (!data.first_name || !data.last_name || !data.role_fr || !data.role_en) {
          return json({ error: 'first_name, last_name, role_fr, role_en required' }, 400);
        }
        const cols = Object.keys(data);
        const placeholders = cols.map(() => '?').join(', ');
        const r = await env.DB.prepare(
          `INSERT INTO staff (${cols.join(', ')}) VALUES (${placeholders})`
        ).bind(...cols.map(c => data[c] ?? null)).run();
        const row = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(r.meta.last_row_id).first();
        return json(row, 201);
      }

      const staffIdMatch = path.match(/^\/api\/staff\/(\d+)$/);
      if (staffIdMatch && method === 'PUT') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(staffIdMatch[1]);
        const body = await request.json();
        const data = pick(body, STAFF_COLS);
        const cols = Object.keys(data);
        if (cols.length === 0) return json({ error: 'Nothing to update' }, 400);
        const setClause = cols.map(c => `${c} = ?`).join(', ');
        await env.DB.prepare(
          `UPDATE staff SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
        ).bind(...cols.map(c => data[c] ?? null), id).run();
        const row = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Not found' }, 404);
        return json(row);
      }

      if (staffIdMatch && method === 'DELETE') {
        const unauth = await requireAuth(request, env); if (unauth) return unauth;
        const id = parseInt(staffIdMatch[1]);
        await env.DB.prepare('DELETE FROM staff WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      // ── Health ─────────────────────────────────────────────────────────────
      if (path === '/health' || path === '/') {
        return json({ ok: true, service: 'diamants-roster-worker' });
      }

      return json({ error: 'Not found', path }, 404);

    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },
};
