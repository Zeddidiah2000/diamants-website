// diamants-roster-worker
// Public: GET /api/players, /api/players/:slug, /api/staff, /photos/:key
// Admin (Bearer ADMIN_TOKEN): POST/PUT/DELETE /api/players and /api/staff, photo upload.

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

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const expected = env.ADMIN_TOKEN;
  if (!expected) return new Response('Server missing ADMIN_TOKEN', { status: 500, headers: cors });
  if (auth !== `Bearer ${expected}`) return new Response('Unauthorized', { status: 401, headers: cors });
  return null;
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
  'hometown_city','hometown_state','hometown_country',
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Photos: GET /photos/:key ────────────────────────────────────────────
      if (path.startsWith('/photos/')) {
        const key = decodeURIComponent(path.slice('/photos/'.length));
        if (!key) return new Response('Not found', { status: 404, headers: cors });
        const obj = await env.BUCKET.get(key);
        if (!obj) return new Response('Not found', { status: 404, headers: cors });
        const headers = new Headers({
          'Cache-Control': 'public, max-age=86400',
          ...cors,
        });
        if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
        if (obj.etag) headers.set('ETag', obj.etag);
        return new Response(obj.body, { headers });
      }

      // ── Players ────────────────────────────────────────────────────────────
      // GET /api/players
      if (path === '/api/players' && method === 'GET') {
        const order = `CASE position_group WHEN 'P' THEN 1 WHEN 'C' THEN 2 WHEN 'IF' THEN 3 WHEN 'OF' THEN 4 ELSE 5 END`;
        const { results } = await env.DB.prepare(
          `SELECT * FROM players ORDER BY ${order}, display_order ASC, last_name ASC`
        ).all();
        return json(results);
      }

      // GET /api/players/:slug
      const playerSlugMatch = path.match(/^\/api\/players\/([a-z0-9-]+)$/);
      if (playerSlugMatch && method === 'GET') {
        const slug = playerSlugMatch[1];
        const row = await env.DB.prepare('SELECT * FROM players WHERE slug = ?').bind(slug).first();
        if (!row) return json({ error: 'Not found' }, 404);
        return json(row);
      }

      // POST /api/players  (admin)
      if (path === '/api/players' && method === 'POST') {
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
        const body = await request.json();
        const err = validatePlayer(body); if (err) return json({ error: err }, 400);
        const data = pick(body, PLAYER_COLS);
        const cols = Object.keys(data);
        const placeholders = cols.map(() => '?').join(', ');
        const stmt = env.DB.prepare(
          `INSERT INTO players (${cols.join(', ')}) VALUES (${placeholders})`
        ).bind(...cols.map(c => data[c] ?? null));
        const r = await stmt.run();
        const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(r.meta.last_row_id).first();
        return json(row, 201);
      }

      // PUT /api/players/:id  (admin)
      const playerIdMatch = path.match(/^\/api\/players\/(\d+)$/);
      if (playerIdMatch && method === 'PUT') {
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
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

      // DELETE /api/players/:id  (admin)
      if (playerIdMatch && method === 'DELETE') {
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
        const id = parseInt(playerIdMatch[1]);
        const player = await env.DB.prepare('SELECT photo_key FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Not found' }, 404);
        if (player.photo_key) {
          try { await env.BUCKET.delete(player.photo_key); } catch {}
        }
        await env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      // POST /api/players/:id/photo  (admin) — body = raw image bytes
      const photoUploadMatch = path.match(/^\/api\/players\/(\d+)\/photo$/);
      if (photoUploadMatch && method === 'POST') {
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
        const id = parseInt(photoUploadMatch[1]);
        const contentType = request.headers.get('Content-Type') || '';
        if (!ALLOWED_PHOTO_MIME.has(contentType)) {
          return json({ error: `Unsupported Content-Type: ${contentType}` }, 415);
        }
        const buf = await request.arrayBuffer();
        if (buf.byteLength === 0)               return json({ error: 'Empty body' }, 400);
        if (buf.byteLength > MAX_PHOTO_BYTES)   return json({ error: 'File too large (>5MB)' }, 413);

        const player = await env.DB.prepare('SELECT id, slug, photo_key FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Not found' }, 404);

        const ext  = contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg');
        const key  = `players/${player.slug}.${ext}`;
        await env.BUCKET.put(key, buf, { httpMetadata: { contentType } });

        // delete old photo if extension changed
        if (player.photo_key && player.photo_key !== key) {
          try { await env.BUCKET.delete(player.photo_key); } catch {}
        }
        await env.DB.prepare('UPDATE players SET photo_key = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(key, id).run();
        return json({ ok: true, photo_key: key });
      }

      // ── Staff ──────────────────────────────────────────────────────────────
      if (path === '/api/staff' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM staff ORDER BY display_order ASC, last_name ASC'
        ).all();
        return json(results);
      }

      if (path === '/api/staff' && method === 'POST') {
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
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
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
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
        const unauth = requireAdmin(request, env); if (unauth) return unauth;
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
