const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

// Cloudflare's Free plan allows 50 subrequests per invocation (Paid: 10,000).
// The Node build had no such ceiling, so `computeTopGenres` happily issued one
// Cinemeta lookup per uncached title across a 200-row history sample. On
// Workers that would blow the limit and fail the whole request, so every
// resolver now runs under an explicit fetch budget. Documented in
// docs/PROGRESS.md rather than left as a silent behaviour change.
export const DEFAULT_FETCH_BUDGET = 20;

export function createFetchBudget(limit = DEFAULT_FETCH_BUDGET) {
  let remaining = limit;
  return {
    get remaining() {
      return remaining;
    },
    take() {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
}

async function cachedFetch({ cacheKey, requestPath, extractData, fallback, budget, errors }) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  if (budget && !budget.take()) {
    // Out of subrequest budget for this invocation: degrade to the fallback
    // rather than throwing. A short catalog row beats a 500.
    return fallback;
  }
  let data = fallback;
  try {
    const res = await fetch(`https://v3-cinemeta.strem.io${requestPath}`);
    if (res.ok) {
      data = extractData(await res.json());
    } else {
      await errors?.record({
        component: 'cinemeta',
        error: new Error(`Cinemeta responded ${res.status}`),
        requestPath,
      });
    }
  } catch (error) {
    await errors?.record({ component: 'cinemeta', error, requestPath });
  }
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// Public, unauthenticated Cinemeta lookups only — no private/account APIs (see
// design.md §1 and §4.5). The in-memory TTL cache is per-isolate on Workers
// rather than per-process; it still collapses repeat lookups within a hot
// isolate, and the durable layer is the title_genre_cache D1 table.
export async function fetchCinemetaMeta(type, imdbId, opts = {}) {
  const requestPath = `/meta/${type}/${imdbId}.json`;
  return cachedFetch({
    cacheKey: `meta:${type}:${imdbId}`,
    requestPath,
    extractData: (body) => body?.meta ?? null,
    fallback: null,
    ...opts,
  });
}

// Powers the "Because you watched {genre}" row (design.md §4.5) — reads only
// Cinemeta's own public catalog, never anything account-specific.
export async function fetchCinemetaCatalogByGenre(type, genre, opts = {}) {
  const requestPath = `/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`;
  return cachedFetch({
    cacheKey: `catalog:${type}:${genre}`,
    requestPath,
    extractData: (body) => body?.metas ?? [],
    fallback: [],
    ...opts,
  });
}

export function clearCinemetaCache() {
  cache.clear();
}
