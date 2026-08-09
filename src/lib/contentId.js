// Stremio content ids: "tt1234567" for movies, "tt1234567:1:2" for series
// season/episode.
export function parseContentId(id) {
  const [imdbId, seasonStr, episodeStr] = id.split(':');
  return {
    imdbId,
    season: seasonStr !== undefined ? Number(seasonStr) : null,
    episode: episodeStr !== undefined ? Number(episodeStr) : null,
  };
}

export function isImdbId(id) {
  return /^tt\d+/.test(id);
}
