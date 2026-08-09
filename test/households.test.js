import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import {
  HouseholdsRepo,
  MAX_PROFILES_PER_HOUSEHOLD,
  HouseholdNotFoundError,
  ProfileLimitError,
} from '../src/db/households.js';

function makeRepo() {
  return new HouseholdsRepo(openDatabase(':memory:'));
}

test('createHousehold mints a 128-bit hex token and persists it', () => {
  const repo = makeRepo();
  const token = repo.createHousehold();
  assert.match(token, /^[0-9a-f]{32}$/);
  const household = repo.getHousehold(token);
  assert.equal(household.id, token);
  assert.equal(household.active_profile_id, null);
});

test('createProfile rejects unknown household', () => {
  const repo = makeRepo();
  assert.throws(
    () => repo.createProfile('deadbeef', { name: 'Alice' }),
    HouseholdNotFoundError
  );
});

test('createProfile enforces the 12-profile cap', () => {
  const repo = makeRepo();
  const token = repo.createHousehold();
  for (let i = 0; i < MAX_PROFILES_PER_HOUSEHOLD; i++) {
    repo.createProfile(token, { name: `Profile ${i}` });
  }
  assert.throws(
    () => repo.createProfile(token, { name: 'One Too Many' }),
    ProfileLimitError
  );
});

test('setActiveProfile atomically flips the pointer', () => {
  const repo = makeRepo();
  const token = repo.createHousehold();
  const profile = repo.createProfile(token, { name: 'Alice' });

  const changed = repo.setActiveProfile(token, profile.id);
  assert.equal(changed, true);
  assert.equal(repo.getHousehold(token).active_profile_id, profile.id);

  // Switching to the already-active profile is a no-op (no spurious write).
  const changedAgain = repo.setActiveProfile(token, profile.id);
  assert.equal(changedAgain, false);
});
