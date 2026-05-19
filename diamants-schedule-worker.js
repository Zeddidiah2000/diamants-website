/**
 * diamants-schedule-worker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cloudflare Worker — serves the Diamants de Québec 2026 season schedule as JSON.
 *
 * PURPOSE:
 *   First-time visitors on diffusion.html or index.html may not have the
 *   schedule cached in localStorage yet (that cache is written by calendrier.html).
 *   This worker guarantees there is always something to show.
 *
 * DEPLOY:
 *   1. Go to dash.cloudflare.com → Workers & Pages → Create
 *   2. Paste this entire file into the editor
 *   3. Save & Deploy
 *   4. Copy the worker URL (e.g. https://diamants-schedule.YOURNAME.workers.dev)
 *   5. Paste it into SCHEDULE_WORKER_URL in both diffusion.html and index.html
 *
 * UPDATE:
 *   At the start of each new season, update the SCHEDULE array below to match
 *   the new PointStreak schedule from calendrier.html. That's the only change
 *   needed — deploy again and it's live within seconds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── LOGO MAP (Spordle CDN) ────────────────────────────────────────────────────
const LOGOS = {
  CH:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a46-1d60-6c7e-9485-06d601f3edb2/logos/1ede0a46-1d44-66e6-a8c4-06d601f3edb2.jpg',
  TR:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0aa1-2605-6518-a672-0e01086684f6/logos/1ede0aa1-25c9-62e8-8559-0e01086684f6.png',
  JQ:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a93-14b0-6fd2-ac76-06d601f3edb2/logos/1ede0a93-1496-634e-a61e-06d601f3edb2.png',
  GA:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a67-6a99-6fec-802e-0e01086684f6/logos/1ede0a67-6a69-696e-93bc-0e01086684f6.png',
  CO:  'https://d1omh11ncsvj0s.cloudfront.net/organizations/1edafc6f-b2a8-68dc-b0ed-02ac0c1f3f60/logos/1edafc6f-b2af-6f4c-96af-02ac0c1f3f60.png',
  MTL: 'https://d1omh11ncsvj0s.cloudfront.net/teams/1eed580e-aff8-6daa-ae05-023a08e3ca6c/logos/1eed580e-afad-6e36-a94e-023a08e3ca6c.png',
  LV:  'https://d1omh11ncsvj0s.cloudfront.net/organizations/1edafc6f-acce-6812-bf7e-02ac0c1f3f60/logos/1edafc6f-acd7-687c-b917-02ac0c1f3f60.png',
  LO:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1efdfde5-90ca-6928-9af7-0e84eb09d6ad/logos/1efdfde5-9075-6734-aade-0e84eb09d6ad.jpg',
  LS:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1eed5805-3347-6058-971e-023a08e3ca6c/logos/1eed5805-3321-6682-abd5-023a08e3ca6c.png',
  RE:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a8b-0ca6-652e-aa91-06d601f3edb2/logos/1ede0a8b-0c8f-6040-9e2a-06d601f3edb2.png',
  SE:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a9b-3ac7-6b5a-b06d-06d601f3edb2/logos/1ede0a9b-3aaa-6db6-9752-06d601f3edb2.png',
  GR:  'https://d1omh11ncsvj0s.cloudfront.net/teams/1ede0a60-87f6-6448-9e16-0e01086684f6/logos/1ede0a60-87b4-6412-bc4e-0e01086684f6.png',
};

// ── MONTH → 0-indexed month number (year 2026) ──────────────────────────────
const MONTH_TO_NUM = { Mai: 4, Jun: 5, Jul: 6, Aoû: 7 };

// ── RAW SCHEDULE (keep in sync with calendrier.html) ─────────────────────────
// [day, dayFr, dayEn, monthFr, monthEn, isHome, opp, oppKey, venue, time, div, num, dh]
const RAW = [
  ['15','Ven','Fri','Mai','May', true, 'Charlesbourg','CH','Stade Canac','19h30','Est','001',null],
  ['19','Mar','Tue','Mai','May', false,'Charlesbourg','CH','Henri Casault','19h30','Est','016',null],
  ['20','Mer','Wed','Mai','May', true, 'Trois-Rivières','TR','Stade Canac','19h30','Est','018',null],
  ['21','Jeu','Thu','Mai','May', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','022',null],
  ['23','Sam','Sat','Mai','May', true, 'Gatineau','GA','Stade Canac','16h00','Ouest/Est','025','1'],
  ['23','Sam','Sat','Mai','May', true, 'Gatineau','GA','Stade Canac','19h00','Ouest/Est','029','2'],
  ['24','Dim','Sun','Mai','May', true, 'Coaticook','CO','Stade Canac','13h00','Centre/Est','034','1'],
  ['24','Dim','Sun','Mai','May', true, 'Coaticook','CO','Stade Canac','16h00','Centre/Est','036','2'],
  ['30','Sam','Sat','Mai','May', true, 'Montréal','MTL','Stade Canac','16h00','Ouest/Est','059','1'],
  ['30','Sam','Sat','Mai','May', true, 'Montréal','MTL','Stade Canac','19h00','Ouest/Est','061','2'],
  ['31','Dim','Sun','Mai','May', true, 'Laval','LV','Stade Canac','13h00','Ouest/Est','052','1'],
  ['31','Dim','Sun','Mai','May', true, 'Laval','LV','Stade Canac','16h00','Ouest/Est','057','2'],
  ['3','Mer','Wed','Jun','Jun', false,'Jonquière','JQ','R. Desmeules','19h30','Est','068',null],
  ['4','Jeu','Thu','Jun','Jun', false,'Charlesbourg','CH','Henri Casault','19h30','Est','072',null],
  ['9','Mar','Tue','Jun','Jun', true, 'Charlesbourg','CH','Stade Canac','19h30','Est','088',null],
  ['10','Mer','Wed','Jun','Jun', false,'Jonquière','JQ','R. Desmeules','19h30','Est','092',null],
  ['11','Jeu','Thu','Jun','Jun', true, 'Jonquière','JQ','Stade Canac','19h30','Est','096',null],
  ['15','Lun','Mon','Jun','Jun', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','111',null],
  ['20','Sam','Sat','Jun','Jun', true, 'St-Eustache','SE','Stade Canac','16h00','Ouest/Est','125','1'],
  ['20','Sam','Sat','Jun','Jun', true, 'St-Eustache','SE','Stade Canac','19h00','Ouest/Est','128','2'],
  ['21','Dim','Sun','Jun','Jun', true, 'Repentigny','RE','Stade Canac','13h00','Ouest/Est','132','1'],
  ['21','Dim','Sun','Jun','Jun', true, 'Repentigny','RE','Stade Canac','16h00','Ouest/Est','136','2'],
  ['23','Mar','Tue','Jun','Jun', false,'Charlesbourg','CH','Henri Casault','19h30','Est','143',null],
  ['24','Mer','Wed','Jun','Jun', false,'Jonquière','JQ','R. Desmeules','19h30','Est','196',null],
  ['27','Sam','Sat','Jun','Jun', false,'Longueuil','LO','Paul Pratt','16h00','Est/Centre','155','1'],
  ['27','Sam','Sat','Jun','Jun', false,'Longueuil','LO','Paul Pratt','19h00','Est/Centre','158','2'],
  ['28','Dim','Sun','Jun','Jun', false,'LaSalle','LS','Stade Éloi Viau','14h00','Est/Centre','205','1'],
  ['28','Dim','Sun','Jun','Jun', false,'LaSalle','LS','Stade Éloi Viau','17h00','Est/Centre','208','2'],
  ['1','Mer','Wed','Jul','Jul', true, 'Jonquière','JQ','Stade Canac','19h30','Est','169',null],
  ['6','Lun','Mon','Jul','Jul', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','295',null],
  ['9','Jeu','Thu','Jul','Jul', false,'Charlesbourg','CH','Henri Casault','19h30','Est','200',null],
  ['13','Lun','Mon','Jul','Jul', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','215',null],
  ['14','Mar','Tue','Jul','Jul', true, 'Trois-Rivières','TR','Stade Canac','19h30','Est','216',null],
  ['15','Mer','Wed','Jul','Jul', true, 'Jonquière','JQ','Stade Canac','19h30','Est','219',null],
  ['16','Jeu','Thu','Jul','Jul', true, 'Charlesbourg','CH','Stade Canac','19h30','Est','225',null],
  ['19','Dim','Sun','Jul','Jul', false,'Granby','GR','N. Fontaine','14h00','Est/Centre','235','1'],
  ['19','Dim','Sun','Jul','Jul', false,'Granby','GR','N. Fontaine','17h00','Est/Centre','237','2'],
  ['21','Mar','Tue','Jul','Jul', true, 'Charlesbourg','CH','Stade Canac','19h30','Est','239',null],
  ['22','Mer','Wed','Jul','Jul', true, 'Trois-Rivières','TR','Stade Canac','19h30','Est','243',null],
  ['23','Jeu','Thu','Jul','Jul', true, 'Jonquière','JQ','Stade Canac','19h30','Est','248',null],
  ['27','Lun','Mon','Jul','Jul', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','262',null],
  ['29','Mer','Wed','Jul','Jul', true, 'Trois-Rivières','TR','Stade Canac','19h30','Est','268',null],
  ['30','Jeu','Thu','Jul','Jul', true, 'Charlesbourg','CH','Stade Canac','19h30','Est','271',null],
  ['2','Dim','Sun','Aoû','Aug', true, '16U','CH','Henri Casault','14h00','Sud/Est','286',null],
  ['3','Lun','Mon','Aoû','Aug', false,'Trois-Rivières','TR','Stade de T-R','19h30','Est','290',null],
  ['4','Mar','Tue','Aoû','Aug', false,'Jonquière','JQ','R. Desmeules','19h30','Est','292',null],
  ['5','Mer','Wed','Aoû','Aug', true, 'Trois-Rivières','TR','Stade Canac','19h30','Est','298',null],
  ['6','Jeu','Thu','Aoû','Aug', false,'Charlesbourg','CH','Henri Casault','19h30','Est','303',null],
  ['12','Mer','Wed','Aoû','Aug', false,'Jonquière','JQ','R. Desmeules','19h30','Est','319',null],
];

// ── BUILD structured game objects ─────────────────────────────────────────────
function buildGames() {
  return RAW.map(g => {
    const [day, dayFr, dayEn, mFr, mEn, isHome, opp, oppKey, venue, time, div, num, dh] = g;
    const mo = MONTH_TO_NUM[mFr];
    const d  = new Date(2026, mo, parseInt(day));
    const tp = time.match(/(\d+)h(\d+)/);
    if (tp) d.setHours(parseInt(tp[1]), parseInt(tp[2]), 0, 0);
    return {
      date:    d.toISOString(),
      day, dayFr, dayEn, mFr, mEn,
      isHome, opp, oppKey,
      venue, time, div, num, dh,
      logoUrl: LOGOS[oppKey] || null,
    };
  });
}

// ── WORKER HANDLER ────────────────────────────────────────────────────────────
export default {
  async fetch(request) {
    // Allow CORS from the Diamants website
    const headers = {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'public, max-age=3600', // cache for 1 hour at edge
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    const games = buildGames();
    return new Response(JSON.stringify(games), { headers });
  },
};
