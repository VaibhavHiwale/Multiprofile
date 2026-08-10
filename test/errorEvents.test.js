import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { ErrorEventsRepo, hashToken } from '../src/db/errorEvents.js';
import { createApp } from '../src/app.js';

describe('ErrorEventsRepo (D1)', () => {
  it('hashToken never returns the raw token', () => {
    const token = 'a'.repeat(32);
    const hash = hashToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('record persists one structured row with a hashed token, never the raw one', async () => {
    const repo = new ErrorEventsRepo(env.DB);
    const token = 'b'.repeat(32);

    await repo.record({
      component: 'test',
      error: new Error('boom'),
      requestPath: '/x/y',
      householdToken: token,
    });

    const rows = await repo.listSince(0);
    const row = rows.find((r) => r.message === 'boom');
    expect(row.component).toBe('test');
    expect(row.error_type).toBe('Error');
    expect(row.request_path).toBe('/x/y');
    expect(row.household_token_hash).toBe(hashToken(token));
    expect(row.household_token_hash).not.toBe(token);
  });

  it('an unhandled resolver exception is captured via the global error handler', async () => {
    // Uses createApp() + Hono's own app.request() (analogous to Fastify's
    // .inject()) rather than SELF.fetch, so a throwing route can be
    // registered for this test alone without going through the deployed
    // default export in src/index.js.
    const app = createApp();
    app.get('/:token/boom-test', () => {
      throw new Error('deliberate failure');
    });

    const token = 'd'.repeat(32);
    const res = await app.request(`/${token}/boom-test`, {}, env);
    expect(res.status).toBe(500);

    const rows = await new ErrorEventsRepo(env.DB).listSince(0);
    const row = rows.find((r) => r.message === 'deliberate failure');
    expect(row.component).toBe('http');
    expect(row.request_path).toMatch(/\/boom-test$/);
    expect(row.household_token_hash).toBe(hashToken(token));
  });
});
