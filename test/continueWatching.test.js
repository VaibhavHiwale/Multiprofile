import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { clearCinemetaCache } from '../src/lib/cinemeta.js';

function stubCinemeta(t, responses) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const match = /\/meta\/(movie|series)\/(tt\d+)\.json$/.exec(String(url));
    const key = match ? `${match[1]}:${match[2]}` : null;
    const meta = key ? responses[key] : undefined;
    if (!meta) return { ok: false };
    return { ok: true, json: async () => ({ meta }) };
  });
}

async function setup(app) {
  const householdRes = await app.inject({ method: 'POST', url: '/api/households' });
  const { token } = householdRes.json();
  const profileRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Alice' },
  });
  const profile = profileRes.json();
  await app.inject({ method: 'POST', url: `/${token}/profiles/${profile.id}/switch` });
  return { token, profile };
}

test('requesting streams for a movie logs a watch event; catalog surfaces it', async (t) => {
  clearCinemetaCache();
  stubCinemeta(t, {
    'movie:tt0111161': { name: 'The Shawshank Redemption', poster: 'poster.jpg' },
  });
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());
  const { token } = await setup(app);

  const streamRes = await app.inject({ method: 'GET', url: `/${token}/stream/movie/tt0111161.json` });
  assert.equal(streamRes.statusCode, 200);
  assert.deepEqual(streamRes.json(), { streams: [] });

  const catalogRes = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/movie/switchboard-continue-watching.json`,
  });
  assert.equal(catalogRes.statusCode, 200);
  const { metas } = catalogRes.json();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].id, 'tt0111161');
  assert.equal(metas[0].name, 'The Shawshank Redemption');
});

test('series progress shows the next-episode heuristic label', async (t) => {
  clearCinemetaCache();
  stubCinemeta(t, {
    'series:tt0903747': { name: 'Breaking Bad', poster: 'poster.jpg' },
  });
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());
  const { token } = await setup(app);

  await app.inject({ method: 'GET', url: `/${token}/stream/series/tt0903747:1:3.json` });

  const catalogRes = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/series/switchboard-continue-watching.json`,
  });
  const { metas } = catalogRes.json();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].description, 'Continue: S1E4');
});

test('continue-watching is empty when no profile is active', async (t) => {
  clearCinemetaCache();
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());
  const householdRes = await app.inject({ method: 'POST', url: '/api/households' });
  const { token } = householdRes.json();

  const catalogRes = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/movie/switchboard-continue-watching.json`,
  });
  assert.deepEqual(catalogRes.json(), { metas: [] });
});
