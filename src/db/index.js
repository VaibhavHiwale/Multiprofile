import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
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
  pin_hash TEXT,
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
CREATE INDEX IF NOT EXISTS idx_watch_events_profile ON watch_events(profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS title_genre_cache (
  imdb_id TEXT PRIMARY KEY,
  genres TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

export function openDatabase(filePath) {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
