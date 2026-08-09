import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// vitest-pool-workers gives every test file its own isolated D1/R2/DO storage
// and undoes writes between tests, so the schema is applied once per file in
// the outer beforeAll frame. TEST_MIGRATIONS is injected by vitest.config.js,
// which reads migrations/ on the Node side (workerd has no filesystem).
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
