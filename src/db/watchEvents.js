export const MAX_WATCH_EVENTS_PER_PROFILE = 5000;

export class WatchEventsRepo {
  constructor(db) {
    this.db = db;
    this.stmts = {
      // season/episode are nullable, and SQLite's UNIQUE index treats every
      // NULL as distinct — so ON CONFLICT would never dedupe movie rows.
      // Look up with IS (NULL-safe) instead and upsert manually.
      findExisting: db.prepare(
        'SELECT id FROM watch_events WHERE profile_id = ? AND imdb_id = ? AND season IS ? AND episode IS ?'
      ),
      insert: db.prepare(
        `INSERT INTO watch_events (profile_id, content_type, imdb_id, season, episode, updated_at)
         VALUES (@profileId, @contentType, @imdbId, @season, @episode, @updatedAt)`
      ),
      touch: db.prepare('UPDATE watch_events SET updated_at = ?, content_type = ? WHERE id = ?'),
      // Ties on updated_at (same millisecond) are broken by id so exactly
      // one row per imdb_id survives, never two.
      recentDeduped: db.prepare(
        `SELECT we.* FROM watch_events we
         WHERE we.profile_id = ?
           AND we.id = (
             SELECT we2.id FROM watch_events we2
             WHERE we2.profile_id = we.profile_id AND we2.imdb_id = we.imdb_id
             ORDER BY we2.updated_at DESC, we2.id DESC
             LIMIT 1
           )
         ORDER BY we.updated_at DESC, we.id DESC
         LIMIT ?`
      ),
      pruneOldest: db.prepare(
        `DELETE FROM watch_events WHERE profile_id = ? AND id NOT IN (
           SELECT id FROM watch_events WHERE profile_id = ? ORDER BY updated_at DESC LIMIT ?
         )`
      ),
      countForProfile: db.prepare('SELECT COUNT(*) AS n FROM watch_events WHERE profile_id = ?'),
      distinctImdbIds: db.prepare('SELECT DISTINCT imdb_id FROM watch_events WHERE profile_id = ?'),
    };
  }

  logEvent(profileId, { contentType, imdbId, season = null, episode = null }) {
    const now = Date.now();
    const run = this.db.transaction(() => {
      const existing = this.stmts.findExisting.get(profileId, imdbId, season, episode);
      if (existing) {
        this.stmts.touch.run(now, contentType, existing.id);
      } else {
        this.stmts.insert.run({ profileId, contentType, imdbId, season, episode, updatedAt: now });
      }
      this.stmts.pruneOldest.run(profileId, profileId, MAX_WATCH_EVENTS_PER_PROFILE);
    });
    run();
  }

  listRecentDeduped(profileId, limit = 15) {
    return this.stmts.recentDeduped.all(profileId, limit);
  }

  countForProfile(profileId) {
    return this.stmts.countForProfile.get(profileId).n;
  }

  distinctImdbIds(profileId) {
    return new Set(this.stmts.distinctImdbIds.all(profileId).map((row) => row.imdb_id));
  }
}
