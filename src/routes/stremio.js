import { Hono } from 'hono';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { resolveHousehold, notFound } from '../lib/householdGuard.js';
import { baseUrl } from '../lib/requestUrl.js';
import { generateProfilePoster } from '../lib/poster.js';
import { fetchCinemetaMeta, fetchCinemetaCatalogByGenre, createFetchBudget } from '../lib/cinemeta.js';
import { parseContentId, isImdbId } from '../lib/contentId.js';
import { computeTopGenres } from '../lib/affinity.js';
import {
  ADDON_NAME,
  PROFILE_ID_PREFIX,
  PROFILES_CATALOG_ID,
  CONTINUE_WATCHING_CATALOG_ID,
  BECAUSE_YOU_WATCHED_CATALOG_ID,
} from '../lib/manifest.js';

const RECOMMENDATION_ROW_LIMIT = 15;
const CONTINUE_WATCHING_ROW_LIMIT = 15;
export const POSTER_PREFIX = 'posters';

async function buildContinueWatchingMeta(row, opts) {
  const cine = await fetchCinemetaMeta(row.content_type, row.imdb_id, opts);
  if (!cine) return null;
  const isSeriesProgress =
    row.content_type === 'series' && row.season != null && row.episode != null;
  return {
    id: row.imdb_id,
    type: row.content_type,
    name: cine.name,
    poster: cine.poster,
    background: cine.background,
    description: isSeriesProgress ? `Continue: S${row.season}E${row.episode + 1}` : cine.description,
  };
}

// "Because you've been watching {genre}" — reads only public Cinemeta
// catalogs, filtered to this profile's own top genres, excluding anything
// already in watch_events (design.md §4.5).
async function buildRecommendationMetas({ profileId, type, watchEvents, titleGenreCache, budget, errors }) {
  const topGenres = await computeTopGenres({ profileId, watchEvents, titleGenreCache, budget, errors });
  if (topGenres.length === 0) return [];

  const alreadyWatched = await watchEvents.distinctImdbIds(profileId);
  const seen = new Set();
  const results = [];
  for (const genre of topGenres) {
    const metas = await fetchCinemetaCatalogByGenre(type, genre, { budget, errors });
    for (const meta of metas) {
      if (alreadyWatched.has(meta.id) || seen.has(meta.id)) continue;
      seen.add(meta.id);
      results.push(meta);
      if (results.length >= RECOMMENDATION_ROW_LIMIT) return results;
    }
  }
  return results;
}

function profileMeta({ profile, household, origin, token }) {
  const isActive = profile.id === household.active_profile_id;
  return {
    id: `${PROFILE_ID_PREFIX}${profile.id}`,
    type: 'other',
    name: isActive ? `${profile.name} ✓` : profile.name,
    poster: `${origin}/${token}/poster/${profile.id}.png`,
    posterShape: 'square',
    description: isActive ? 'Currently active' : 'Tap to switch profile',
  };
}

// Poster rendering (satori layout + resvg rasterisation) is the single most
// CPU-expensive thing this service does, and the Free plan gives 10 ms of CPU
// per request. Keying the R2 object on everything that affects the pixels
// means a profile is rendered once and then served straight out of R2 until
// its name/avatar/badges change. This has no Node-build equivalent — the old
// deploy just re-rendered on every request behind a Cache-Control header.
export function posterCacheKey(profile, isActive) {
  const fingerprint = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([profile.id, profile.name, profile.avatar_url, isActive, Boolean(profile.is_kids)])
      )
    )
  ).slice(0, 16);
  return `${POSTER_PREFIX}/${profile.id}/${fingerprint}.png`;
}

const routes = new Hono();

routes.get('/:token/catalog/:type/:catalogId', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const type = c.req.param('type');
  const catalogId = c.req.param('catalogId').replace(/\.json$/, '');
  const watchEvents = c.get('watchEvents');
  const errors = c.get('errorEvents');
  const budget = createFetchBudget();

  if (type === 'other' && catalogId === PROFILES_CATALOG_ID) {
    const origin = baseUrl(c);
    const profiles = await c.get('households').listProfiles(household.id);
    const metas = profiles.map((profile) =>
      profileMeta({ profile, household, origin, token: household.id })
    );
    // Short cache: the active-profile badge changes on every switch.
    c.header('Cache-Control', 'max-age=30');
    return c.json({ metas });
  }

  if ((type === 'movie' || type === 'series') && catalogId === CONTINUE_WATCHING_CATALOG_ID) {
    if (!household.active_profile_id) return c.json({ metas: [] });
    const rows = (
      await watchEvents.listRecentDeduped(household.active_profile_id, CONTINUE_WATCHING_ROW_LIMIT)
    ).filter((row) => row.content_type === type);
    const metas = (
      await Promise.all(rows.map((row) => buildContinueWatchingMeta(row, { budget, errors })))
    ).filter(Boolean);
    c.header('Cache-Control', 'max-age=120');
    return c.json({ metas });
  }

  if ((type === 'movie' || type === 'series') && catalogId === BECAUSE_YOU_WATCHED_CATALOG_ID) {
    if (!household.active_profile_id) return c.json({ metas: [] });
    const metas = await buildRecommendationMetas({
      profileId: household.active_profile_id,
      type,
      watchEvents,
      titleGenreCache: c.get('titleGenreCache'),
      budget,
      errors,
    });
    c.header('Cache-Control', 'max-age=300');
    return c.json({ metas });
  }

  return notFound(c);
});

routes.get('/:token/meta/:type/:id', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const type = c.req.param('type');
  const id = c.req.param('id').replace(/\.json$/, '');
  if (type !== 'other' || !id.startsWith(PROFILE_ID_PREFIX)) return notFound(c);

  const profile = await c
    .get('households')
    .getProfile(household.id, id.slice(PROFILE_ID_PREFIX.length));
  if (!profile) return notFound(c);

  c.header('Cache-Control', 'max-age=30');
  return c.json({
    meta: profileMeta({ profile, household, origin: baseUrl(c), token: household.id }),
  });
});

routes.get('/:token/stream/:type/:id', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const type = c.req.param('type');
  const id = c.req.param('id').replace(/\.json$/, '');

  if (type === 'other' && id.startsWith(PROFILE_ID_PREFIX)) {
    const profile = await c
      .get('households')
      .getProfile(household.id, id.slice(PROFILE_ID_PREFIX.length));
    if (!profile) return notFound(c);
    const origin = baseUrl(c);
    return c.json({
      streams: [
        {
          name: ADDON_NAME,
          title: `Switch to ${profile.name}`,
          externalUrl: `${origin}/${household.id}/switch/${profile.id}`,
        },
      ],
    });
  }

  // Observation-only: this addon never returns a playable stream for real
  // content. Requesting streams for a title is the closest observable signal
  // we get that it was opened, so we log it against whichever profile is
  // currently active and return nothing.
  if ((type === 'movie' || type === 'series') && isImdbId(id)) {
    if (household.active_profile_id) {
      const { imdbId, season, episode } = parseContentId(id);
      await c
        .get('watchEvents')
        .logEvent(household.active_profile_id, { contentType: type, imdbId, season, episode });
    }
    return c.json({ streams: [] });
  }

  return notFound(c);
});

routes.get('/:token/poster/:profileId', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const profileId = c.req.param('profileId').replace(/\.png$/, '');
  const profile = await c.get('households').getProfile(household.id, profileId);
  if (!profile) return notFound(c);

  const isActive = profile.id === household.active_profile_id;
  const key = posterCacheKey(profile, isActive);
  const bucket = c.env.ASSETS_BUCKET;

  const cached = bucket ? await bucket.get(key) : null;
  const png = cached
    ? new Uint8Array(await cached.arrayBuffer())
    : await generateProfilePoster({
        id: profile.id,
        name: profile.name,
        avatarUrl: profile.avatar_url,
        isActive,
        isKids: Boolean(profile.is_kids),
      });

  if (!cached && bucket) {
    // Don't make the client wait on the write-behind.
    c.executionCtx.waitUntil(
      bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } })
    );
  }

  c.header('Cache-Control', 'public, max-age=300');
  c.header('Content-Type', 'image/png');
  return c.body(png);
});

export default routes;
