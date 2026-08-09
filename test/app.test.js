import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

function makeApp() {
  return buildApp({ dbPath: ':memory:', logger: false });
}

test('GET /healthz returns ok', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
});

test('POST /api/households creates a household and its manifest is reachable', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const createRes = await app.inject({ method: 'POST', url: '/api/households' });
  assert.equal(createRes.statusCode, 201);
  const { token } = createRes.json();
  assert.match(token, /^[0-9a-f]{32}$/);

  const manifestRes = await app.inject({ method: 'GET', url: `/${token}/manifest.json` });
  assert.equal(manifestRes.statusCode, 200);
  const manifest = manifestRes.json();
  assert.equal(manifest.id, 'org.switchboard.multiprofile');
  assert.equal(manifest.behaviorHints.configurable, true);
});

test('POST /api/households allows cross-origin requests (needed by the GitHub Pages installer)', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/households',
    headers: { origin: 'https://example.github.io' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['access-control-allow-origin'], 'https://example.github.io');
});

test('GET /:token/manifest.json 404s identically for malformed and unknown tokens', async (t) => {
  const app = makeApp();
  t.after(() => app.close());

  const malformed = await app.inject({ method: 'GET', url: '/not-a-token/manifest.json' });
  const unknown = await app.inject({
    method: 'GET',
    url: `/${'a'.repeat(32)}/manifest.json`,
  });

  assert.equal(malformed.statusCode, 404);
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(malformed.json(), unknown.json());
});
