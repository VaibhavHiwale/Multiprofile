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

test('create, list, update, reorder, delete a profile', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const createRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Alice' },
  });
  assert.equal(createRes.statusCode, 201);
  const alice = createRes.json();
  assert.equal(alice.name, 'Alice');
  assert.equal(alice.hasPin, false);
  assert.equal(alice.isActive, false);

  const bobRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Bob', isKids: true },
  });
  const bob = bobRes.json();

  const listRes = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  assert.equal(listRes.json().profiles.length, 2);

  const updateRes = await app.inject({
    method: 'PATCH',
    url: `/${token}/profiles/${alice.id}`,
    payload: { name: 'Alicia' },
  });
  assert.equal(updateRes.json().name, 'Alicia');

  const reorderRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles/reorder`,
    payload: { profileIds: [bob.id, alice.id] },
  });
  const [first, second] = reorderRes.json().profiles;
  assert.equal(first.id, bob.id);
  assert.equal(second.id, alice.id);

  const deleteRes = await app.inject({ method: 'DELETE', url: `/${token}/profiles/${bob.id}` });
  assert.equal(deleteRes.statusCode, 204);

  const finalList = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  assert.equal(finalList.json().profiles.length, 1);
});

test('createProfile enforces the household profile cap over HTTP', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  for (let i = 0; i < 12; i++) {
    const res = await app.inject({
      method: 'POST',
      url: `/${token}/profiles`,
      payload: { name: `P${i}` },
    });
    assert.equal(res.statusCode, 201);
  }
  const overflow = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'One Too Many' },
  });
  assert.equal(overflow.statusCode, 409);
});

test('switch: PIN-protected profile blocks wrong PIN and allows the correct one', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const createRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Kiddo', isKids: true, pin: '1234' },
  });
  const kiddo = createRes.json();
  assert.equal(kiddo.hasPin, true);

  const wrongPin = await app.inject({
    method: 'POST',
    url: `/${token}/profiles/${kiddo.id}/switch`,
    payload: { pin: '0000' },
  });
  assert.equal(wrongPin.statusCode, 401);

  const noPin = await app.inject({
    method: 'POST',
    url: `/${token}/profiles/${kiddo.id}/switch`,
    payload: {},
  });
  assert.equal(noPin.statusCode, 401);

  const rightPin = await app.inject({
    method: 'POST',
    url: `/${token}/profiles/${kiddo.id}/switch`,
    payload: { pin: '1234' },
  });
  assert.equal(rightPin.statusCode, 200);
  assert.equal(rightPin.json().isActive, true);

  const listRes = await app.inject({ method: 'GET', url: `/${token}/profiles` });
  const active = listRes.json().profiles.find((p) => p.id === kiddo.id);
  assert.equal(active.isActive, true);
});

test('switch without a PIN succeeds immediately for a non-PIN profile', async (t) => {
  const app = makeApp();
  t.after(() => app.close());
  const token = await createHousehold(app);

  const createRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Alice' },
  });
  const alice = createRes.json();

  const switchRes = await app.inject({
    method: 'POST',
    url: `/${token}/profiles/${alice.id}/switch`,
  });
  assert.equal(switchRes.statusCode, 200);
  assert.equal(switchRes.json().isActive, true);
});
