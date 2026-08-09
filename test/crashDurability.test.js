import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

// Simulates a crash by never calling the graceful app.close() shutdown path
// — the process (and its OS-level file handle) just disappears, the way a
// real crash or power loss would. WAL mode is what's supposed to make that
// safe (design doc §6, acceptance criteria §10: "Full service restart
// loses zero committed profile switches or watch events").
test('committed writes survive an ungraceful restart (WAL durability)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ meta: null }) }));
  const dir = await mkdtemp(join(tmpdir(), 'switchboard-crash-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const dbPath = join(dir, 'switchboard.db');

  const firstRun = buildApp({ dbPath, logger: false });
  const householdRes = await firstRun.inject({ method: 'POST', url: '/api/households' });
  const { token } = householdRes.json();
  const profileRes = await firstRun.inject({
    method: 'POST',
    url: `/${token}/profiles`,
    payload: { name: 'Alice' },
  });
  const profile = profileRes.json();
  const switchRes = await firstRun.inject({
    method: 'POST',
    url: `/${token}/profiles/${profile.id}/switch`,
  });
  assert.equal(switchRes.statusCode, 200);

  await firstRun.inject({ method: 'GET', url: `/${token}/stream/movie/tt0111161.json` });

  // No firstRun.close() — deliberately skip the graceful shutdown hook to
  // simulate the process dying mid-life rather than exiting cleanly.
  firstRun.rawDb.close(); // release the OS file handle so the second run can open it

  const secondRun = buildApp({ dbPath, logger: false });

  const profilesRes = await secondRun.inject({ method: 'GET', url: `/${token}/profiles` });
  const { profiles } = profilesRes.json();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, 'Alice');
  assert.equal(profiles[0].isActive, true);

  const catalogRes = await secondRun.inject({
    method: 'GET',
    url: `/${token}/catalog/movie/switchboard-continue-watching.json`,
  });
  assert.equal(catalogRes.statusCode, 200);

  await secondRun.close();
});
