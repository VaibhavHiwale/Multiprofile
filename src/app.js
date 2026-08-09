import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { openDatabase } from './db/index.js';
import { HouseholdsRepo } from './db/households.js';
import { WatchEventsRepo } from './db/watchEvents.js';
import { TitleGenreCacheRepo } from './db/titleGenreCache.js';
import { buildManifest } from './lib/manifest.js';
import { resolveHousehold } from './lib/household-guard.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { recordError } from './lib/errorLog.js';
import profilesRoutes from './routes/profiles.js';
import stremioRoutes from './routes/stremio.js';
import switchRoutes from './routes/switch.js';

export function buildApp({ dbPath = ':memory:', logger = true } = {}) {
  const db = openDatabase(dbPath);
  const households = new HouseholdsRepo(db);
  const watchEvents = new WatchEventsRepo(db);
  const titleGenreCache = new TitleGenreCacheRepo(db);

  const app = Fastify({ logger });
  app.register(formbody);

  app.decorate('households', households);
  app.decorate('watchEvents', watchEvents);
  app.decorate('titleGenreCache', titleGenreCache);
  app.decorate('rawDb', db);
  app.decorate('rateLimiter', createRateLimiter());

  // Catches both thrown resolver exceptions and synchronous DB-write
  // failures (better-sqlite3 throws synchronously; Fastify routes both
  // to this same handler) — see docs/PROGRESS.md for the observability
  // requirement this satisfies.
  app.setErrorHandler(async (err, req, reply) => {
    await recordError({
      component: 'http',
      error: err,
      requestPath: req.url,
      householdToken: req.params?.token,
    });
    req.log.error(err);
    const statusCode =
      Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    reply.code(statusCode).send({ error: statusCode === 500 ? 'internal error' : err.message });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Household creation is the only unauthenticated write endpoint: it mints
  // a fresh opaque token and nothing else. No Stremio credential is ever
  // requested here or anywhere else in this service (see design doc §1).
  app.post('/api/households', async (_req, reply) => {
    const id = households.createHousehold();
    reply.code(201);
    return { token: id };
  });

  app.get('/:token/manifest.json', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    reply.header('Cache-Control', 'no-cache');
    return buildManifest(household.id);
  });

  app.register(profilesRoutes);
  app.register(stremioRoutes);
  app.register(switchRoutes);

  app.addHook('onClose', (instance, done) => {
    db.close();
    done();
  });

  return app;
}
