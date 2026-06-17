-- diamants-db migration 002 — 2026-06-17
-- Adds scout-facing stats + provenance to players.
--   stats_json : year-keyed JSON, e.g. {"2026": {"batting": {...}, "pitching": {...}}}
--                populated from GameChanger screenshots via admin/stats.html (Haiku vision).
--   provenance : free text — cégep / université / programme / prior team (LBJEQ junior-élite
--                players are 18–22; this is the "where they came from" scouts look for).
ALTER TABLE players ADD COLUMN stats_json TEXT;
ALTER TABLE players ADD COLUMN provenance TEXT;
