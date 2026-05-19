#!/usr/bin/env node
/**
 * Build seed.sql for diamants-db.
 *
 * Inputs (read at run-time):
 *   - The 26 current static playerpage/player-*.html files for hand-entered
 *     fields (B/T, height, weight, birthdate, hometown, photo reference).
 *   - Spordle /sp/members live data for jersey numbers, spordle_id, and the
 *     authoritative coach list.
 *
 * Output: workers/diamants-roster-worker/scripts/seed.sql
 *
 * Run: node scripts/build-seed.js  (from the worker directory)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT      = resolve(here, '..', '..', '..');
const PLAYERPAGE_DIR = resolve(REPO_ROOT, 'playerpage');
const PHOTO_DIR      = resolve(REPO_ROOT, 'playerphotos');
const OUT_FILE       = resolve(here, 'seed.sql');

// ── The authoritative 23-player roster from the 2026 official photo ──────────
// position_group: P (LANCEURS) / C (RECEVEUR) / IF (AVANT-CHAMP) / OF (VOLTIGEURS)
// slug:           lastname, with -firstinitial suffix for duplicates
// static_html:    filename in playerpage/ to scrape for hand-entered fields, or null if new
const PLAYERS = [
  // LANCEURS
  { slug: 'nasrallah',     first: 'Adam',          last: 'Nasrallah',      group: 'P',  static: 'player-nasrallah.html' },
  { slug: 'dionne-a',      first: 'Alexandre',     last: 'Dionne',         group: 'P',  static: 'player-dionne-a.html' },
  { slug: 'lambert',       first: 'Christopher',   last: 'Lambert',        group: 'P',  static: 'player-lambert.html' },
  { slug: 'lapointe',      first: 'Élliot',        last: 'Lapointe',       group: 'P',  static: null }, // new — no static file
  { slug: 'laplante',      first: 'Gabriel',       last: 'Laplante',       group: 'P',  static: 'player-laplante.html' },
  { slug: 'dionne-j',      first: 'Jérémy',        last: 'Dionne',         group: 'P',  static: 'player-dionne-j.html' },
  { slug: 'maranda',       first: 'Loïc',          last: 'Maranda',        group: 'P',  static: 'player-maranda.html' },
  { slug: 'gagnon',        first: 'Myka',          last: 'Gagnon',         group: 'P',  static: 'player-gagnon.html' },
  { slug: 'jacques',       first: 'Pierre-Luc',    last: 'Jacques',        group: 'P',  static: 'player-jacques.html' },
  { slug: 'tremblay',      first: 'Victor',        last: 'Tremblay',       group: 'P',  static: 'player-tremblay.html' },
  { slug: 'stpierre',      first: 'William',       last: 'St-Pierre',      group: 'P',  static: 'player-stpierre.html' },
  // RECEVEUR
  { slug: 'masse-l',       first: 'Loïc',          last: 'Massé',          group: 'C',  static: 'player-masse-l.html' },
  // AVANT-CHAMP
  { slug: 'parent',        first: 'Antoine',       last: 'Parent',         group: 'IF', static: 'player-parent.html' },
  { slug: 'masse-c',       first: 'Cédric',        last: 'Massé',          group: 'IF', static: 'player-masse-c.html' },
  { slug: 'lamontagne',    first: 'Édouard',       last: 'Lamontagne',     group: 'IF', static: 'player-lamontagne.html' },
  { slug: 'chisholm',      first: 'Liam',          last: 'Chisholm',       group: 'IF', static: 'player-chisholm.html' },
  { slug: 'fontaine',      first: 'Mathieu',       last: 'Fontaine',       group: 'IF', static: 'player-fontaine.html' },
  { slug: 'lavertu',       first: 'Mickaël',       last: 'Lavertu',        group: 'IF', static: 'player-lavertu.html' },
  // VOLTIGEURS
  { slug: 'emond',         first: 'Alexis',        last: 'Émond',          group: 'OF', static: 'player-emond.html' },
  { slug: 'ruel',          first: 'Cédric',        last: 'Ruel',           group: 'OF', static: 'player-ruel.html' },
  { slug: 'verge-bernard', first: 'Francis',       last: 'Verge-Bernard',  group: 'OF', static: 'player-verge-bernard.html' },
  { slug: 'bouvry',        first: 'Renaud',        last: 'Bouvry',         group: 'OF', static: 'player-bouvry.html' },
  { slug: 'houde',         first: 'Zachari',       last: 'Houde',          group: 'OF', static: 'player-houde.html' },
];

// ── Authoritative staff from Spordle (override the current static page) ──────
const STAFF = [
  { first: 'Raphaël',         last: 'Prémont',   role_fr: 'Entraîneur chef',     role_en: 'Head Coach',       order: 1 },
  { first: 'Charles-Antoine', last: 'Pépin',     role_fr: 'Entraîneur adjoint',  role_en: 'Assistant Coach',  order: 2 },
  { first: 'Olivier',         last: 'Mailloux',  role_fr: 'Entraîneur adjoint',  role_en: 'Assistant Coach',  order: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────

const FR_MONTHS = { 'janv':1,'févr':2,'mars':3,'avr':4,'mai':5,'juin':6,'juil':7,'août':8,'sept':9,'oct':10,'nov':11,'déc':12 };

function parseHeightInches(s) {
  if (!s) return null;
  // formats observed: "6-02", "6-2", "5-09", "5-11", "6-00", "6-0", "—"
  const m = s.match(/^(\d)[-\s]?(\d{1,2})$/);
  if (!m) return null;
  const feet = parseInt(m[1]);
  const inch = parseInt(m[2]);
  return feet * 12 + inch;
}

function parseBirthdateFr(s) {
  if (!s) return null;
  // formats observed: "22 oct. 2008", "5 mai 2007", etc.
  const m = s.match(/^(\d{1,2})\s+([a-zé]+)\.?\s+(\d{4})$/i);
  if (!m) return null;
  const day = parseInt(m[1]);
  const monKey = m[2].toLowerCase().slice(0, 4).replace(/\.$/, '');
  // try increasing prefix lengths
  let month = null;
  for (let len = 2; len <= 4 && !month; len++) {
    const k = m[2].toLowerCase().slice(0, len);
    if (FR_MONTHS[k]) month = FR_MONTHS[k];
  }
  if (!month) return null;
  const year = parseInt(m[3]);
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function extractFromStaticHtml(html) {
  const out = {};

  // Position (first <span class="pos-badge">XXX</span> inside hero or first profile-row)
  const posMatch = html.match(/<span class="pos-badge">([^<]+)<\/span>/);
  if (posMatch) out.positions = posMatch[1].trim();

  // Helper: find the value following a given label
  function findValueByLabelFr(labelFr) {
    // Tolerate optional style="…" or other attrs on <span class="p-value">.
    const re = new RegExp(`<span class="fr-text">${labelFr}</span>[^]*?<span class="p-value"[^>]*>([^]*?)</span>`, 'i');
    const m = html.match(re);
    if (!m) return null;
    // strip nested <span class="fr-text">…</span><span class="en-text">…</span> if present
    let v = m[1];
    const inner = v.match(/<span class="fr-text">([^<]+)<\/span>/);
    if (inner) return inner[1].trim();
    return v.replace(/<[^>]+>/g, '').trim();
  }

  // B/T like "D/D (R/R)" — prefer the (R/R) part; otherwise translate French G/D.
  const FR_BT = { D: 'R', G: 'L', A: 'S' }; // Droit/Gauche/Ambidextre
  const bt = findValueByLabelFr('Frappe/Lance');
  if (bt) {
    const en = bt.match(/\(([LRS])\/([LRS])\)/);
    if (en) {
      out.bats_throws = `${en[1]}/${en[2]}`;
    } else {
      const fr = bt.match(/([DGA])\/([DGA])/);
      if (fr && FR_BT[fr[1]] && FR_BT[fr[2]]) {
        out.bats_throws = `${FR_BT[fr[1]]}/${FR_BT[fr[2]]}`;
      }
    }
  }

  const ht = findValueByLabelFr('Grandeur');
  if (ht && ht !== '—') out.height_inches = parseHeightInches(ht);

  const wt = findValueByLabelFr('Poids');
  if (wt && wt !== '—') {
    const m = wt.match(/(\d+)/);
    if (m) out.weight = parseInt(m[1]);
  }

  const birth = findValueByLabelFr('Naissance');
  if (birth && birth !== '—') {
    const iso = parseBirthdateFr(birth);
    if (iso) out.birthdate = iso;
  }

  const town = findValueByLabelFr('Provenance');
  if (town && town !== '—') {
    const m = town.match(/^([^,]+?)(?:,\s*([A-Z]{2}))?$/);
    if (m) {
      out.hometown_city = m[1].trim();
      if (m[2]) out.hometown_state = m[2].trim();
    }
  }

  const country = findValueByLabelFr('Pays');
  if (country && country !== '—') out.hometown_country = country.trim();

  // Photo: <img src="playerphotos/pXXXX.jpg"
  const photoMatch = html.match(/src="playerphotos\/(p\d+\.(?:jpg|png|webp))"/);
  if (photoMatch) out.photo_filename = photoMatch[1];

  return out;
}

// SQL string escape
function q(v) {
  if (v == null || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Build Spordle lookup ─────────────────────────────────────────────────────
async function fetchSpordleMembers() {
  const filter = encodeURIComponent(JSON.stringify({ where: { teamId: 156484 } }));
  const url    = `https://pub-api.play.spordle.com/api/sp/members?filter=${filter}`;
  const resp   = await fetch(url, {
    headers: {
      'Accept':          'application/json',
      'Accept-Language': 'fr,en',
      'Authorization':   'API-Key f08ed9064e3cdc382e6abb305ff543d0150fb52f',
      'Origin':          'https://page.spordle.com',
      'Referer':         'https://page.spordle.com/',
      'User-Agent':      'Mozilla/5.0',
      'X-Page-Type':     'LEAGUE',
    },
  });
  if (!resp.ok) throw new Error(`Spordle members ${resp.status}`);
  return resp.json();
}

function nameKey(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching Spordle members for teamId 156484…`);
  const members = await fetchSpordleMembers();
  console.log(`  → ${members.length} members`);

  const memberByName = new Map();
  for (const m of members) {
    const key = nameKey(m.participant.firstName + m.participant.lastName);
    memberByName.set(key, m);
  }

  const lines = [];
  lines.push('-- Auto-generated by build-seed.js. Do not edit by hand.');
  lines.push('-- Re-run the script to refresh from Spordle + static playerpage scraping.');
  lines.push('');
  lines.push('DELETE FROM players;');
  lines.push('DELETE FROM staff;');
  lines.push('');

  let displayOrder = 0;
  for (const p of PLAYERS) {
    displayOrder += 1;
    const data = {
      slug:           p.slug,
      first_name:     p.first,
      last_name:      p.last,
      position_group: p.group,
      display_order:  displayOrder,
    };

    // Spordle match
    const mKey = nameKey(p.first + p.last);
    const member = memberByName.get(mKey);
    if (member) {
      data.spordle_id = member.id;
      if (member.number != null) data.number = String(member.number);
      if (member.isCaptain)      data.is_captain = 1;
      if (member.isAffiliate)    data.is_affiliate = 1;
    } else {
      console.warn(`  ⚠ No Spordle match for ${p.first} ${p.last}`);
    }

    // Static HTML scrape
    if (p.static) {
      const path = resolve(PLAYERPAGE_DIR, p.static);
      if (existsSync(path)) {
        const html = readFileSync(path, 'utf8');
        const scraped = extractFromStaticHtml(html);
        Object.assign(data, scraped);
      } else {
        console.warn(`  ⚠ Static file missing: ${p.static}`);
      }
    }

    // The original playerphotos/ dir was deleted, so photo_key would point at
    // nonexistent R2 objects. Skip until photos are uploaded via admin.
    delete data.photo_filename;
    delete data.photo_key;

    const cols = Object.keys(data);
    const vals = cols.map(c => q(data[c]));
    lines.push(`INSERT INTO players (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
  }

  lines.push('');

  for (const s of STAFF) {
    const data = {
      first_name:    s.first,
      last_name:     s.last,
      role_fr:       s.role_fr,
      role_en:       s.role_en,
      display_order: s.order,
    };
    // Try to match Spordle staff (no jersey number)
    const mKey = nameKey(s.first + s.last);
    const member = memberByName.get(mKey);
    if (member) data.spordle_id = member.id;

    const cols = Object.keys(data);
    const vals = cols.map(c => q(data[c]));
    lines.push(`INSERT INTO staff (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
  }

  writeFileSync(OUT_FILE, lines.join('\n') + '\n');
  console.log(`\nWrote ${lines.length} lines → ${OUT_FILE}`);

  // Photo migration once skipped — the original playerphotos/ directory was
  // removed. New photos will be uploaded directly via the admin page.
}

main().catch(err => { console.error(err); process.exit(1); });
