import { fetchCinemetaMeta } from './cinemeta.js';

const GENRE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // genres don't change; a week is generous
const HISTORY_SAMPLE_SIZE = 200;

async function genresFor(row, titleGenreCache) {
  const cached = titleGenreCache.get(row.imdb_id);
  if (cached && Date.now() - cached.fetchedAt < GENRE_CACHE_TTL_MS) {
    return cached.genres;
  }
  const meta = await fetchCinemetaMeta(row.content_type, row.imdb_id);
  const genres = meta?.genres ?? [];
  titleGenreCache.set(row.imdb_id, genres);
  return genres;
}

// Frequency-count genre affinity from watch history — no ML needed to be
// useful (design doc §4.5).
export async function computeTopGenres({ profileId, watchEvents, titleGenreCache, limit = 3 }) {
  const rows = watchEvents.listRecentDeduped(profileId, HISTORY_SAMPLE_SIZE);
  const counts = new Map();
  for (const row of rows) {
    const genres = await genresFor(row, titleGenreCache);
    for (const genre of genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre]) => genre);
}
