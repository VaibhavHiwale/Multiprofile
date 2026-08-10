import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  HouseholdsRepo,
  MAX_PROFILES_PER_HOUSEHOLD,
  HouseholdNotFoundError,
  ProfileLimitError,
} from '../src/db/households.js';

function repo() {
  return new HouseholdsRepo(env.DB);
}

describe('HouseholdsRepo (D1)', () => {
  it('createHousehold mints a 128-bit hex token and persists it', async () => {
    const token = await repo().createHousehold();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const household = await repo().getHousehold(token);
    expect(household.id).toBe(token);
    expect(household.active_profile_id).toBeNull();
  });

  it('createProfile rejects an unknown household', async () => {
    await expect(repo().createProfile('deadbeef', { name: 'Alice' })).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
  });

  it('createProfile enforces the 12-profile cap', async () => {
    const r = repo();
    const token = await r.createHousehold();
    for (let i = 0; i < MAX_PROFILES_PER_HOUSEHOLD; i++) {
      await r.createProfile(token, { name: `Profile ${i}` });
    }
    await expect(r.createProfile(token, { name: 'One Too Many' })).rejects.toBeInstanceOf(
      ProfileLimitError
    );
  });

  it('setActiveProfile atomically flips the pointer and is a no-op when already active', async () => {
    const r = repo();
    const token = await r.createHousehold();
    const profile = await r.createProfile(token, { name: 'Alice' });

    expect(await r.setActiveProfile(token, profile.id)).toBe(true);
    expect((await r.getHousehold(token)).active_profile_id).toBe(profile.id);

    expect(await r.setActiveProfile(token, profile.id)).toBe(false);
  });

  it('reorderProfiles applies a full ordering atomically', async () => {
    const r = repo();
    const token = await r.createHousehold();
    const alice = await r.createProfile(token, { name: 'Alice' });
    const bob = await r.createProfile(token, { name: 'Bob' });

    const reordered = await r.reorderProfiles(token, [bob.id, alice.id]);
    expect(reordered.map((p) => p.id)).toEqual([bob.id, alice.id]);
  });

  it('deleteProfile clears active_profile_id if the deleted profile was active', async () => {
    const r = repo();
    const token = await r.createHousehold();
    const profile = await r.createProfile(token, { name: 'Alice' });
    await r.setActiveProfile(token, profile.id);

    await r.deleteProfile(token, profile.id);
    expect((await r.getHousehold(token)).active_profile_id).toBeNull();
  });
});
