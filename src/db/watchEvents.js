export const MAX_WATCH_EVENTS_PER_PROFILE = 5000;

export class WatchEventsRepo {
  constructor(db) {
    this.db = db;
  }

  // The Node build did find-then-insert-or-touch inside a better-sqlite3
  // transaction, because SQLite's UNIQUE(profile_id, imdb_id, season, episode)
  // never fires for movies (NULL season/episode are all distinct). D1 has no
  // interactive transactions, so migration 0001 adds a NULL-safe unique index
  // on COALESCE(season,-1)/COALESCE(episode,-1) and this becomes a single
  // atomic UPSERT — strictly better than the original read-modify-write.
  //
  // The prune runs in the same batch (one implicit transaction).
  async logEvent(profileId, { contentType, imdbId, season = null, episode = null }) {
    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO watch_events (profile_id, content_type, imdb_id, season, episode, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, imdb_id, COALESCE(season, -1), COALESCE(episode, -1))
           DO UPDATE SET updated_at = excluded.updated_at, content_type = excluded.content_type`
        )
        .bind(profileId, contentType, imdbId, season, episode, now),
      this.db
        .prepare(
          `DELETE FROM watch_events WHERE profile_id = ? AND id NOT IN (
             SELECT id FROM watch_events WHERE profile_id = ? ORDER BY updated_at DESC LIMIT ?
           )`
        )
        .bind(profileId, profileId, MAX_WATCH_EVENTS_PER_PROFILE),
    ]);
  }

  // Ties on updated_at (same millisecond) are broken by id so exactly one row
  // per imdb_id survives, never two.
  async listRecentDeduped(profileId, limit = 15) {
    const { results } = await this.db
      .prepare(
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
      )
      .bind(profileId, limit)
      .all();
    return results ?? [];
  }

  async countForProfile(profileId) {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM watch_events WHERE profile_id = ?')
      .bind(profileId)
      .first();
    return row?.n ?? 0;
  }

  async distinctImdbIds(profileId) {
    const { results } = await this.db
      .prepare('SELECT DISTINCT imdb_id FROM watch_events WHERE profile_id = ?')
      .bind(profileId)
      .all();
    return new Set((results ?? []).map((row) => row.imdb_id));
  }
}
