import { fetchCinemetaMeta, createFetchBudget } from './cinemeta.js';

const GENRE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // genres don't change; a week is generous

// Was 200 in the Node build. Lowered because each uncached title costs one
// Cinemeta subrequest and the Free plan allows 50 per invocation; 40 recent
// titles is still a representative affinity sample, and everything already in
// title_genre_cache is free regardless. See docs/PROGRESS.md.
export const HISTORY_SAMPLE_SIZE = 40;

async function genresFor(row, titleGenreCache, opts) {
  const cached = await titleGenreCache.get(row.imdb_id);
  if (cached && Date.now() - cached.fetchedAt < GENRE_CACHE_TTL_MS) {
    return cached.genres;
  }
  const meta = await fetchCinemetaMeta(row.content_type, row.imdb_id, opts);
  const genres = meta?.genres ?? [];
  await titleGenreCache.set(row.imdb_id, genres);
  return genres;
}

// Frequency-count genre affinity from watch history — no ML needed to be
// useful (design.md §4.5).
export async function computeTopGenres({
  profileId,
  watchEvents,
  titleGenreCache,
  limit = 3,
  budget = createFetchBudget(),
  errors,
}) {
  const rows = await watchEvents.listRecentDeduped(profileId, HISTORY_SAMPLE_SIZE);
  const counts = new Map();
  for (const row of rows) {
    const genres = await genresFor(row, titleGenreCache, { budget, errors });
    for (const genre of genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre]) => genre);
}
