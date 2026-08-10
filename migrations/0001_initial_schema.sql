-- MultiProfile initial schema.
--
-- households / profiles / watch_events / title_genre_cache are transcribed
-- verbatim from docs/design.md §5 (the Node/better-sqlite3 build used the
-- identical DDL). D1 is SQLite-compatible, so nothing had to change except
-- the WAL/synchronous pragmas, which D1 manages itself.

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  active_profile_id TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  pin_hash TEXT,              -- nullable; argon2id if set
  is_kids INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(household_id, name)
);

CREATE TABLE IF NOT EXISTS watch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(profile_id, imdb_id, season, episode)
);

CREATE INDEX IF NOT EXISTS idx_watch_events_profile
  ON watch_events(profile_id, updated_at DESC);

-- SQLite treats every NULL as distinct, so the UNIQUE constraint above never
-- fires for movies (season/episode NULL). The Node build worked around that
-- with a read-then-write inside a better-sqlite3 transaction; D1 has no
-- interactive transactions, so we make the constraint NULL-safe instead and
-- upsert in a single atomic statement (see src/db/watchEvents.js).
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_events_identity
  ON watch_events(profile_id, imdb_id, COALESCE(season, -1), COALESCE(episode, -1));

CREATE TABLE IF NOT EXISTS title_genre_cache (   -- avoid refetching Cinemeta per view
  imdb_id TEXT PRIMARY KEY,
  genres TEXT NOT NULL,            -- JSON array
  fetched_at INTEGER NOT NULL
);

-- Replaces the fs.appendFile ./data/errors.jsonl log. Same fields, one row
-- per record. household_token_hash is a SHA-256 prefix; the raw household
-- token is NEVER written here.
CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,       -- epoch ms
  component TEXT NOT NULL,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  request_path TEXT,
  household_token_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_events_timestamp
  ON error_events(timestamp DESC);
