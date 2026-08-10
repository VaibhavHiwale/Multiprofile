export class TitleGenreCacheRepo {
  constructor(db) {
    this.db = db;
  }

  async get(imdbId) {
    const row = await this.db
      .prepare('SELECT genres, fetched_at FROM title_genre_cache WHERE imdb_id = ?')
      .bind(imdbId)
      .first();
    if (!row) return null;
    return { genres: JSON.parse(row.genres), fetchedAt: row.fetched_at };
  }

  async set(imdbId, genres) {
    await this.db
      .prepare(
        `INSERT INTO title_genre_cache (imdb_id, genres, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(imdb_id) DO UPDATE SET genres = excluded.genres, fetched_at = excluded.fetched_at`
      )
      .bind(imdbId, JSON.stringify(genres), Date.now())
      .run();
  }
}
