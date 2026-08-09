import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

function makeApp() {
  return buildApp({ dbPath: ':memory:', logger: false });
}

async function createHouseholdWithProfile(app, payload = { name: 'Alice' }) {
  const householdRes = await app.inject({ method: 'POST', url: '/api/households' });
  const { token } = householdRes.json();
  const profileRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload,
  });
  return { token, profile: profileRes.json() };
}

test('catalog lists one meta card per profile with a poster URL', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token, profile } = await createHouseholdWithProfile(app);

  const res = await app.inject({
    method: 'GET',
    url: `/${token}/catalog/other/switchboard-profiles.json`,
  });
  assert.equal(res.statusCode, 200);
  const { metas } = res.json();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].id, `switchboard:profile:${profile.id}`);
  assert.equal(metas[0].posterShape, 'square');
  assert.match(metas[0].poster, new RegExp(`/${token}/poster/${profile.id}\\.png$`));
});

test('unknown catalog id 404s', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token } = await createHouseholdWithProfile(app);

  const res = await app.inject({ method: 'GET', url: `/${token}/catalog/other/bogus.json` });
  assert.equal(res.statusCode, 404);
});

test('meta and stream resolve a profile switch id', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token, profile } = await createHouseholdWithProfile(app);
  const id = `switchboard:profile:${profile.id}`;

  const metaRes = await app.inject({ method: 'GET', url: `/${token}/meta/other/${id}.json` });
  assert.equal(metaRes.statusCode, 200);
  assert.equal(metaRes.json().meta.id, id);

  const streamRes = await app.inject({ method: 'GET', url: `/${token}/stream/other/${id}.json` });
  assert.equal(streamRes.statusCode, 200);
  const { streams } = streamRes.json();
  assert.equal(streams.length, 1);
  assert.match(streams[0].externalUrl, new RegExp(`/${token}/switch/${profile.id}$`));
});

test('poster route returns a PNG', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token, profile } = await createHouseholdWithProfile(app);

  const res = await app.inject({ method: 'GET', url: `/${token}/poster/${profile.id}.png` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  // PNG magic bytes
  assert.equal(res.rawPayload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('switch confirmation page switches immediately when no PIN is set', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token, profile } = await createHouseholdWithProfile(app);

  const res = await app.inject({ method: 'GET', url: `/${token}/switch/${profile.id}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.payload, /Switched to Alice/);
  assert.match(res.payload, /stremio:\/\/board/);

  const listRes = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  assert.equal(listRes.json().profiles[0].isActive, true);
});

test('switch confirmation page requires a PIN and blocks the wrong one', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const { token, profile } = await createHouseholdWithProfile(app, {
    name: 'Kiddo',
    isKids: true,
    pin: '4242',
  });

  const getRes = await app.inject({ method: 'GET', url: `/${token}/switch/${profile.id}` });
  assert.match(getRes.payload, /Enter PIN/);

  const wrongPost = await app.inject({
    method: 'POST',
    url: `/${token}/switch/${profile.id}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'pin=0000',
  });
  assert.equal(wrongPost.statusCode, 401);
  assert.match(wrongPost.payload, /Incorrect PIN/);

  const listAfterWrong = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  assert.equal(listAfterWrong.json().profiles[0].isActive, false);

  const rightPost = await app.inject({
    method: 'POST',
    url: `/${token}/switch/${profile.id}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'pin=4242',
  });
  assert.equal(rightPost.statusCode, 200);
  assert.match(rightPost.payload, /Switched to Kiddo/);

  const listAfterRight = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  assert.equal(listAfterRight.json().profiles[0].isActive, true);
});
