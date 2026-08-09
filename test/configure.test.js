import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

function makeApp() {
  return buildApp({ dbPath: ':memory:', logger: false });
}

async function createHousehold(app) {
  const res = await app.inject({ method: 'POST', url: '/api/households' });
  return res.json().token;
}

test('configure page renders for a known household and 404s for an unknown one', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const ok = await app.inject({ method: 'GET', url: `/${token}/configure` });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-type'], /text\/html/);
  assert.match(ok.payload, /Switchboard/);

  const missing = await app.inject({ method: 'GET', url: `/${'a'.repeat(32)}/configure` });
  assert.equal(missing.statusCode, 404);
});

test('qrcode.png returns a PNG encoding the manifest URL', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const res = await app.inject({ method: 'GET', url: `/${token}/qrcode.png` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.rawPayload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('stats reports distinct titles watched per profile', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const profileRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Alice' },
  });
  const profile = profileRes.json();
  await app.inject({ method: 'POST', url: `/${token}/profiles/${profile.id}/switch` });

  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ meta: null }) }));
  await app.inject({ method: 'GET', url: `/${token}/stream/movie/tt0111161.json` });
  await app.inject({ method: 'GET', url: `/${token}/stream/movie/tt0068646.json` });

  const statsRes = await app.inject({ method: 'GET', url: `/${token}/stats` });
  assert.equal(statsRes.statusCode, 200);
  const { stats } = statsRes.json();
  assert.equal(stats.length, 1);
  assert.equal(stats[0].profileId, profile.id);
  assert.equal(stats[0].titlesWatched, 2);
});

test('an emoji avatar renders as the poster glyph', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const profileRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Kiddo', avatarUrl: '🦄' },
  });
  const profile = profileRes.json();
  assert.equal(profile.avatarUrl, '🦄');

  const posterRes = await app.inject({ method: 'GET', url: `/${token}/poster/${profile.id}.png` });
  assert.equal(posterRes.statusCode, 200);
  assert.equal(posterRes.headers['content-type'], 'image/png');
});
