import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHousehold, createProfile, postJson, patchJson } from './helpers.js';

describe('profile CRUD, PIN gate, switch', () => {
  it('create, list, update, reorder, delete a profile', async () => {
    const token = await createHousehold();

    const alice = await createProfile(token, { name: 'Alice' });
    expect(alice.name).toBe('Alice');
    expect(alice.hasPin).toBe(false);
    expect(alice.isActive).toBe(false);

    const bob = await createProfile(token, { name: 'Bob', isKids: true });

    const listRes = await SELF.fetch(url(`/${token}/profiles`));
    expect((await listRes.json()).profiles.length).toBe(2);

    const updateRes = await patchJson(`/${token}/profiles/${alice.id}`, { name: 'Alicia' });
    expect((await updateRes.json()).name).toBe('Alicia');

    const reorderRes = await postJson(`/${token}/profiles/reorder`, {
      profileIds: [bob.id, alice.id],
    });
    const { profiles: reordered } = await reorderRes.json();
    expect(reordered.map((p) => p.id)).toEqual([bob.id, alice.id]);

    const deleteRes = await SELF.fetch(url(`/${token}/profiles/${bob.id}`), { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);

    const finalList = await SELF.fetch(url(`/${token}/profiles`));
    expect((await finalList.json()).profiles.length).toBe(1);
  });

  it('enforces the 12-profile cap over HTTP', async () => {
    const token = await createHousehold();
    for (let i = 0; i < 12; i++) {
      const res = await postJson(`/${token}/profiles`, { name: `P${i}` });
      expect(res.status).toBe(201);
    }
    const overflow = await postJson(`/${token}/profiles`, { name: 'One Too Many' });
    expect(overflow.status).toBe(409);
  });

  it('switch: a PIN-protected profile blocks the wrong PIN and allows the correct one', async () => {
    const token = await createHousehold();
    const kiddo = await createProfile(token, { name: 'Kiddo', isKids: true, pin: '1234' });
    expect(kiddo.hasPin).toBe(true);

    const wrongPin = await postJson(`/${token}/profiles/${kiddo.id}/switch`, { pin: '0000' });
    expect(wrongPin.status).toBe(401);

    const noPin = await postJson(`/${token}/profiles/${kiddo.id}/switch`, {});
    expect(noPin.status).toBe(401);

    const rightPin = await postJson(`/${token}/profiles/${kiddo.id}/switch`, { pin: '1234' });
    expect(rightPin.status).toBe(200);
    expect((await rightPin.json()).isActive).toBe(true);
  });

  it('switch without a PIN succeeds immediately for a non-PIN profile', async () => {
    const token = await createHousehold();
    const alice = await createProfile(token);
    const res = await postJson(`/${token}/profiles/${alice.id}/switch`);
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(true);
  });

  it('an emoji avatar round-trips through create and update', async () => {
    const token = await createHousehold();
    const profile = await createProfile(token, { name: 'Kiddo', avatarUrl: '🦄' });
    expect(profile.avatarUrl).toBe('🦄');

    const updated = await patchJson(`/${token}/profiles/${profile.id}`, { avatarUrl: '🚀' });
    expect((await updated.json()).avatarUrl).toBe('🚀');
  });
});
