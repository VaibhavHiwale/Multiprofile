import { resolveHousehold } from '../lib/household-guard.js';
import { baseUrl } from '../lib/requestUrl.js';
import { generateManifestQrPng } from '../lib/qrcode.js';
import { computeTopGenres } from '../lib/affinity.js';
import { renderConfigurePage } from '../lib/configurePage.js';

export default async function configureRoutes(app) {
  const { households, watchEvents, titleGenreCache } = app;

  app.get('/:token/configure', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    reply.type('text/html');
    return renderConfigurePage();
  });

  app.get('/:token/qrcode.png', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const manifestUrl = `${baseUrl(req)}/${household.id}/manifest.json`;
    const png = await generateManifestQrPng(manifestUrl);
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.type('image/png');
    return png;
  });

  // Powers the per-profile stat line on the /configure dashboard.
  // "Titles watched" is a count of distinct imdb_ids, not true watch-time —
  // this addon has no reliable runtime/progress signal (design doc §4.1
  // calls for "hours watched"; that would need per-title runtime data this
  // MVP doesn't fetch, so it's approximated as a title count instead).
  app.get('/:token/stats', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const profiles = households.listProfiles(household.id);
    const stats = await Promise.all(
      profiles.map(async (profile) => {
        const topGenres = await computeTopGenres({
          profileId: profile.id,
          watchEvents,
          titleGenreCache,
          limit: 1,
        });
        return {
          profileId: profile.id,
          titlesWatched: watchEvents.distinctImdbIds(profile.id).size,
          topGenre: topGenres[0] ?? null,
        };
      })
    );
    reply.header('Cache-Control', 'max-age=60');
    return { stats };
  });
}
