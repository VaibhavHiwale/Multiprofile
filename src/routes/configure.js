import { Hono } from 'hono';
import { resolveHousehold, notFound } from '../lib/householdGuard.js';
import { baseUrl } from '../lib/requestUrl.js';
import { generateManifestQrPng } from '../lib/qrcode.js';
import { computeTopGenres } from '../lib/affinity.js';
import { createFetchBudget } from '../lib/cinemeta.js';
import { renderConfigurePage } from '../lib/configurePage.js';

const routes = new Hono();

routes.get('/:token/configure', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);
  return c.html(renderConfigurePage());
});

routes.get('/:token/qrcode.png', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);
  const manifestUrl = `${baseUrl(c)}/${household.id}/manifest.json`;
  const png = await generateManifestQrPng(manifestUrl);
  c.header('Cache-Control', 'public, max-age=3600');
  c.header('Content-Type', 'image/png');
  return c.body(png);
});

// Powers the per-profile stat line on the /configure dashboard.
// "Titles watched" is a count of distinct imdb_ids, not true watch-time — this
// addon has no reliable runtime/progress signal (design.md §4.1 calls for
// "hours watched"; that would need per-title runtime data this MVP doesn't
// fetch, so it's approximated as a title count instead).
routes.get('/:token/stats', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const watchEvents = c.get('watchEvents');
  const titleGenreCache = c.get('titleGenreCache');
  const errors = c.get('errorEvents');
  // One shared budget across all profiles: the Free plan's 50-subrequest cap
  // is per invocation, not per profile.
  const budget = createFetchBudget();

  const profiles = await c.get('households').listProfiles(household.id);
  const stats = [];
  for (const profile of profiles) {
    const topGenres = await computeTopGenres({
      profileId: profile.id,
      watchEvents,
      titleGenreCache,
      limit: 1,
      budget,
      errors,
    });
    stats.push({
      profileId: profile.id,
      titlesWatched: (await watchEvents.distinctImdbIds(profile.id)).size,
      topGenre: topGenres[0] ?? null,
    });
  }

  c.header('Cache-Control', 'max-age=60');
  return c.json({ stats });
});

export default routes;
