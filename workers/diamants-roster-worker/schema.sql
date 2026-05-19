-- diamants-db schema v1
-- Single team (no team_category column). Position groups are
-- LANCEURS (P) / RECEVEUR (C) / AVANT-CHAMP (IF) / VOLTIGEURS (OF).

CREATE TABLE IF NOT EXISTS players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spordle_id      INTEGER UNIQUE,
  slug            TEXT    UNIQUE NOT NULL,
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  number          TEXT,
  position_group  TEXT    NOT NULL CHECK(position_group IN ('P','C','IF','OF')),
  positions       TEXT,
  bats_throws     TEXT,
  height_inches   INTEGER,
  weight          INTEGER,
  birthdate       TEXT,
  hometown_city   TEXT,
  hometown_state  TEXT,
  hometown_country TEXT,
  photo_key       TEXT,
  is_captain      INTEGER DEFAULT 0,
  is_affiliate    INTEGER DEFAULT 0,
  bio_fr          TEXT,
  bio_en          TEXT,
  display_order   INTEGER DEFAULT 0,
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_players_slug           ON players(slug);
CREATE INDEX IF NOT EXISTS idx_players_position_group ON players(position_group, display_order, last_name);
CREATE INDEX IF NOT EXISTS idx_players_spordle_id     ON players(spordle_id);

CREATE TABLE IF NOT EXISTS staff (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spordle_id      INTEGER UNIQUE,
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  role_fr         TEXT    NOT NULL,
  role_en         TEXT    NOT NULL,
  photo_key       TEXT,
  bio_fr          TEXT,
  bio_en          TEXT,
  display_order   INTEGER DEFAULT 0,
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_spordle_id ON staff(spordle_id);
