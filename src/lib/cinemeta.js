import { recordError } from './errorLog.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

async function cachedFetch(cacheKey, requestPath, extractData, fallback) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  let data = fallback;
  try {
    const res = await fetch(`https://v3-cinemeta.strem.io${requestPath}`);
    if (res.ok) {
      data = extractData(await res.json());
    } else {
      await recordError({
        component: 'cinemeta',
        error: new Error(`Cinemeta responded ${res.status}`),
        requestPath,
      });
    }
  } catch (error) {
    await recordError({ component: 'cinemeta', error, requestPath });
  }
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// Public, unauthenticated Cinemeta lookups only — no private/account APIs
// (see design doc §1 and §4.5). In-memory TTL cache avoids refetching the
// same title on every catalog render.
export async function fetchCinemetaMeta(type, imdbId) {
  const requestPath = `/meta/${type}/${imdbId}.json`;
  return cachedFetch(`meta:${type}:${imdbId}`, requestPath, (body) => body?.meta ?? null, null);
}

// Powers the "Because you watched {genre}" row (design doc §4.5) — reads
// only Cinemeta's own public catalog, never anything account-specific.
export async function fetchCinemetaCatalogByGenre(type, genre) {
  const requestPath = `/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`;
  return cachedFetch(`catalog:${type}:${genre}`, requestPath, (body) => body?.metas ?? [], []);
}

export function clearCinemetaCache() {
  cache.clear();
}
