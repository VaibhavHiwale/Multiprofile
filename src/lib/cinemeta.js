import { recordError } from './errorLog.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

// Public, unauthenticated Cinemeta lookups only — no private/account APIs
// (see design doc §1 and §4.5). In-memory TTL cache avoids refetching the
// same title on every catalog render.
export async function fetchCinemetaMeta(type, imdbId) {
  const key = `${type}:${imdbId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  const requestPath = `/meta/${type}/${imdbId}.json`;
  let data = null;
  try {
    const res = await fetch(`https://v3-cinemeta.strem.io${requestPath}`);
    if (res.ok) {
      const body = await res.json();
      data = body?.meta ?? null;
    } else {
      await recordError({
        component: 'cinemeta',
        error: new Error(`Cinemeta responded ${res.status}`),
        requestPath,
      });
    }
  } catch (error) {
    await recordError({ component: 'cinemeta', error, requestPath });
    data = null;
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function clearCinemetaCache() {
  cache.clear();
}
