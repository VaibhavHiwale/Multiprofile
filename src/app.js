import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HouseholdsRepo } from './db/households.js';
import { WatchEventsRepo } from './db/watchEvents.js';
import { TitleGenreCacheRepo } from './db/titleGenreCache.js';
import { ErrorEventsRepo } from './db/errorEvents.js';
import { buildManifest } from './lib/manifest.js';
import { resolveHousehold, notFound } from './lib/householdGuard.js';
import { checkRateLimit } from './do/rateLimiter.js';
import profilesRoutes from './routes/profiles.js';
import stremioRoutes from './routes/stremio.js';
import switchRoutes from './routes/switch.js';
import configureRoutes from './routes/configure.js';

export function createApp() {
  const app = new Hono();

  // Open CORS is safe here: every endpoint is either public (household
  // creation) or authorizes purely via the opaque token in the URL/body —
  // nothing is cookie/session-based, so there's no cross-origin credential to
  // leak. Needed so the GitHub Pages installer (a different origin) can call
  // POST /api/households (see design.md §9).
  app.use('*', cors({ origin: (origin) => origin ?? '*' }));

  // Per-request repositories bound to this invocation's D1 handle. Workers
  // have no long-lived app object to decorate, so context variables replace
  // Fastify's app.decorate().
  app.use('*', async (c, next) => {
    c.set('households', new HouseholdsRepo(c.env.DB));
    c.set('watchEvents', new WatchEventsRepo(c.env.DB));
    c.set('titleGenreCache', new TitleGenreCacheRepo(c.env.DB));
    c.set('errorEvents', new ErrorEventsRepo(c.env.DB));
    await next();
  });

  // Catches thrown resolver exceptions and D1 write failures alike, and
  // records them to the error_events table (see docs/PROGRESS.md for the
  // observability requirement this satisfies).
  app.onError(async (err, c) => {
    try {
      await new ErrorEventsRepo(c.env.DB).record({
        component: 'http',
        error: err,
        requestPath: new URL(c.req.url).pathname,
        householdToken: c.req.param('token') ?? null,
      });
    } catch {
      // Never let the error logger mask the original failure.
    }
    console.error(err);
    const statusCode =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    return c.json(
      { error: statusCode === 500 ? 'internal error' : err.message },
      statusCode
    );
  });

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Household creation is the only unauthenticated write endpoint: it mints a
  // fresh opaque token and nothing else. No Stremio credential is ever
  // requested here or anywhere else in this service (see design.md §1).
  //
  // Every other mutating route is rate-limited *per household token*
  // (src/routes/profiles.js), but this is the one route that MINTS tokens —
  // an unlimited client could otherwise sidestep every per-token limit by
  // simply generating a fresh token per request, driving unbounded D1 writes
  // and, via the poster cache, unbounded R2 Class A operations (R2 is the one
  // Cloudflare product here that bills from the first byte past its free
  // tier — see docs/PROGRESS.md "Cost & limits"). Rate-limited per client IP
  // instead. 20/hour is generous for real use (creating a handful of
  // households for family/friends) while making mass token-minting
  // impractically slow.
  app.post('/api/households', async (c) => {
    const clientIp = c.req.header('cf-connecting-ip') ?? 'unknown';
    const allowed = await checkRateLimit(c.env, `household-create:${clientIp}`, {
      windowMs: 60 * 60 * 1000,
      max: 20,
    });
    if (!allowed) return c.json({ error: 'too many requests' }, 429);

    const id = await c.get('households').createHousehold();
    return c.json({ token: id }, 201);
  });

  app.get('/:token/manifest.json', async (c) => {
    const household = await resolveHousehold(c);
    if (!household) return notFound(c);
    c.header('Cache-Control', 'no-cache');
    return c.json(buildManifest(household.id));
  });

  app.route('/', profilesRoutes);
  app.route('/', stremioRoutes);
  app.route('/', switchRoutes);
  app.route('/', configureRoutes);

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  return app;
}
