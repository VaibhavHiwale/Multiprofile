export class TitleGenreCacheRepo {
  constructor(db) {
    this.stmts = {
      get: db.prepare('SELECT genres, fetched_at FROM title_genre_cache WHERE imdb_id = ?'),
      upsert: db.prepare(
        `INSERT INTO title_genre_cache (imdb_id, genres, fetched_at) VALUES (@imdbId, @genres, @fetchedAt)
         ON CONFLICT(imdb_id) DO UPDATE SET genres = excluded.genres, fetched_at = excluded.fetched_at`
      ),
    };
  }

  get(imdbId) {
    const row = this.stmts.get.get(imdbId);
    if (!row) return null;
    return { genres: JSON.parse(row.genres), fetchedAt: row.fetched_at };
  }

  set(imdbId, genres) {
    this.stmts.upsert.run({ imdbId, genres: JSON.stringify(genres), fetchedAt: Date.now() });
  }
}
