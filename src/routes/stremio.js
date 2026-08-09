import { resolveHousehold } from '../lib/household-guard.js';
import { baseUrl } from '../lib/requestUrl.js';
import { generateProfilePoster } from '../lib/poster.js';
import { fetchCinemetaMeta, fetchCinemetaCatalogByGenre } from '../lib/cinemeta.js';
import { parseContentId, isImdbId } from '../lib/contentId.js';
import { computeTopGenres } from '../lib/affinity.js';

export const PROFILE_ID_PREFIX = 'switchboard:profile:';
const CONTINUE_WATCHING_CATALOG_ID = 'switchboard-continue-watching';
const BECAUSE_YOU_WATCHED_CATALOG_ID = 'switchboard-because-you-watched';
const RECOMMENDATION_ROW_LIMIT = 15;

async function buildContinueWatchingMeta(row) {
  const cine = await fetchCinemetaMeta(row.content_type, row.imdb_id);
  if (!cine) return null;
  const isSeriesProgress = row.content_type === 'series' && row.season != null && row.episode != null;
  return {
    id: row.imdb_id,
    type: row.content_type,
    name: cine.name,
    poster: cine.poster,
    background: cine.background,
    description: isSeriesProgress
      ? `Continue: S${row.season}E${row.episode + 1}`
      : cine.description,
  };
}

// "Because you've been watching {genre}" — reads only public Cinemeta
// catalogs, filtered to this profile's own top genres, excluding anything
// already in watch_events (design doc §4.5).
async function buildRecommendationMetas({ profileId, type, watchEvents, titleGenreCache }) {
  const topGenres = await computeTopGenres({ profileId, watchEvents, titleGenreCache });
  if (topGenres.length === 0) return [];

  const alreadyWatched = watchEvents.distinctImdbIds(profileId);
  const seen = new Set();
  const results = [];
  for (const genre of topGenres) {
    const metas = await fetchCinemetaCatalogByGenre(type, genre);
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

export default async function stremioRoutes(app) {
  const { households, watchEvents, titleGenreCache } = app;

  app.get('/:token/catalog/:type/:catalogId.json', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const { type, catalogId } = req.params;

    if (type === 'other' && catalogId === 'switchboard-profiles') {
      const origin = baseUrl(req);
      const metas = households
        .listProfiles(household.id)
        .map((profile) => profileMeta({ profile, household, origin, token: household.id }));
      // Short cache: the active-profile badge changes on every switch.
      reply.header('Cache-Control', 'max-age=30');
      return { metas };
    }

    if ((type === 'movie' || type === 'series') && catalogId === CONTINUE_WATCHING_CATALOG_ID) {
      if (!household.active_profile_id) {
        return { metas: [] };
      }
      const rows = watchEvents
        .listRecentDeduped(household.active_profile_id, 15)
        .filter((row) => row.content_type === type);
      const metas = (await Promise.all(rows.map(buildContinueWatchingMeta))).filter(Boolean);
      reply.header('Cache-Control', 'max-age=120');
      return { metas };
    }

    if ((type === 'movie' || type === 'series') && catalogId === BECAUSE_YOU_WATCHED_CATALOG_ID) {
      if (!household.active_profile_id) {
        return { metas: [] };
      }
      const metas = await buildRecommendationMetas({
        profileId: household.active_profile_id,
        type,
        watchEvents,
        titleGenreCache,
      });
      reply.header('Cache-Control', 'max-age=300');
      return { metas };
    }

    reply.code(404);
    return { error: 'not found' };
  });

  app.get('/:token/meta/:type/:id.json', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const { type, id } = req.params;
    if (type !== 'other' || !id.startsWith(PROFILE_ID_PREFIX)) {
      reply.code(404);
      return { error: 'not found' };
    }
    const profile = households.getProfile(household.id, id.slice(PROFILE_ID_PREFIX.length));
    if (!profile) {
      reply.code(404);
      return { error: 'not found' };
    }
    const origin = baseUrl(req);
    reply.header('Cache-Control', 'max-age=30');
    return { meta: profileMeta({ profile, household, origin, token: household.id }) };
  });

  app.get('/:token/stream/:type/:id.json', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const { type, id } = req.params;

    if (type === 'other' && id.startsWith(PROFILE_ID_PREFIX)) {
      const profile = households.getProfile(household.id, id.slice(PROFILE_ID_PREFIX.length));
      if (!profile) {
        reply.code(404);
        return { error: 'not found' };
      }
      const origin = baseUrl(req);
      return {
        streams: [
          {
            name: 'Switchboard',
            title: `Switch to ${profile.name}`,
            externalUrl: `${origin}/${household.id}/switch/${profile.id}`,
          },
        ],
      };
    }

    // Observation-only: this addon never returns a playable stream for real
    // content. Requesting streams for a title is the closest observable
    // signal we get that it was opened, so we log it against whichever
    // profile is currently active and return nothing.
    if ((type === 'movie' || type === 'series') && isImdbId(id)) {
      if (household.active_profile_id) {
        const { imdbId, season, episode } = parseContentId(id);
        watchEvents.logEvent(household.active_profile_id, { contentType: type, imdbId, season, episode });
      }
      return { streams: [] };
    }

    reply.code(404);
    return { error: 'not found' };
  });

  app.get('/:token/poster/:profileId.png', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const profile = households.getProfile(household.id, req.params.profileId);
    if (!profile) {
      reply.code(404);
      return { error: 'not found' };
    }
    const png = await generateProfilePoster({
      id: profile.id,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      isActive: profile.id === household.active_profile_id,
      isKids: Boolean(profile.is_kids),
    });
    reply.header('Cache-Control', 'public, max-age=300');
    reply.type('image/png');
    return png;
  });
}
