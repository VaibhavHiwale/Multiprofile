import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { clearCinemetaCache } from '../src/lib/cinemeta.js';

function stubCinemeta(t, { metaByKey = {}, catalogByKey = {} }) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const str = String(url);
    const metaMatch = /\/meta\/(movie|series)\/(tt\d+)\.json$/.exec(str);
    if (metaMatch) {
      const meta = metaByKey[`${metaMatch[1]}:${metaMatch[2]}`];
      return meta ? { ok: true, json: async () => ({ meta }) } : { ok: false };
    }
    const catalogMatch = /\/catalog\/(movie|series)\/top\/genre=([^.]+)\.json$/.exec(str);
    if (catalogMatch) {
      const key = `${catalogMatch[1]}:${decodeURIComponent(catalogMatch[2])}`;
      const metas = catalogByKey[key];
      return metas ? { ok: true, json: async () => ({ metas }) } : { ok: true, json: async () => ({ metas: [] }) };
    }
    return { ok: false };
  });
}

async function setupActiveProfile(app) {
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

test('recommends titles from the profile\'s top genre, excluding already-watched titles', async (t) => {
  clearCinemetaCache();
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());
  const { token } = await setupActiveProfile(app);

  stubCinemeta(t, {
    metaByKey: {
      'movie:tt0111161': { name: 'The Shawshank Redemption', genres: ['Drama'] },
    },
    catalogByKey: {
      'movie:Drama': [
        { id: 'tt0111161', type: 'movie', name: 'The Shawshank Redemption' }, // already watched
        { id: 'tt0068646', type: 'movie', name: 'The Godfather' },
      ],
    },
  });

  await app.inject({ method: 'GET', url: `/${token}/stream/movie/tt0111161.json` });

  const res = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/movie/switchboard-because-you-watched.json`,
  });
  assert.equal(res.statusCode, 200);
  const { metas } = res.json();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].id, 'tt0068646');
});

test('recommendation row is empty with no watch history', async (t) => {
  clearCinemetaCache();
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());
  const { token } = await setupActiveProfile(app);

  const res = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/movie/switchboard-because-you-watched.json`,
  });
  assert.deepEqual(res.json(), { metas: [] });
});
