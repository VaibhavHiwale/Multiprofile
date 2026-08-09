import Fastify from 'fastify';
import { z } from 'zod';
import { openDatabase } from './db/index.js';
import { HouseholdsRepo } from './db/households.js';
import { buildManifest } from './lib/manifest.js';

const tokenParamSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'invalid household token'),
});

export function buildApp({ dbPath = ':memory:', logger = true } = {}) {
  const db = openDatabase(dbPath);
  const households = new HouseholdsRepo(db);

  const app = Fastify({ logger });

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
    const parsed = tokenParamSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(404);
      return { error: 'not found' };
    }
    const { token } = parsed.data;
    const household = households.getHousehold(token);
    // Identical generic 404 for a malformed vs. a valid-but-unknown token —
    // token guessing shouldn't be able to distinguish the two (see design doc §6).
    if (!household) {
      reply.code(404);
      return { error: 'not found' };
    }
    reply.header('Cache-Control', 'no-cache');
    return buildManifest(token);
  });

  app.decorate('households', households);
  app.decorate('rawDb', db);

  app.addHook('onClose', (instance, done) => {
    db.close();
    done();
  });

  return app;
}
