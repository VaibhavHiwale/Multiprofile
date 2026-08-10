import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHouseholdWithProfile } from './helpers.js';

describe('switch confirmation page', () => {
  it('switches immediately and shows a manual (not automatic) deep-link button when no PIN is set', async () => {
    const { token, profile } = await createHouseholdWithProfile({ name: 'Alice' });

    const res = await SELF.fetch(url(`/${token}/switch/${profile.id}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Switched to Alice/);
    expect(html).toMatch(/stremio:\/\/board/);
    expect(html).toMatch(/Try returning to Stremio/);
    // No auto-redirect: a Stremio build was found (2026-08-10, real-device
    // testing) that mishandles an unprompted stremio://board navigation as
    // an addon-install request, throwing a visible error on every switch.
    expect(html).not.toMatch(/setTimeout/);

    const listRes = await SELF.fetch(url(`/${token}/profiles`));
    expect((await listRes.json()).profiles[0].isActive).toBe(true);
  });

  it('requires a PIN and blocks the wrong one before switching', async () => {
    const { token, profile } = await createHouseholdWithProfile({
      name: 'Kiddo',
      isKids: true,
      pin: '4242',
    });

    const getRes = await SELF.fetch(url(`/${token}/switch/${profile.id}`));
    expect(await getRes.text()).toMatch(/Enter PIN/);

    const wrongPost = await SELF.fetch(url(`/${token}/switch/${profile.id}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=0000',
    });
    expect(wrongPost.status).toBe(401);
    expect(await wrongPost.text()).toMatch(/Incorrect PIN/);

    const listAfterWrong = await SELF.fetch(url(`/${token}/profiles`));
    expect((await listAfterWrong.json()).profiles[0].isActive).toBe(false);

    const rightPost = await SELF.fetch(url(`/${token}/switch/${profile.id}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=4242',
    });
    expect(rightPost.status).toBe(200);
    expect(await rightPost.text()).toMatch(/Switched to Kiddo/);

    const listAfterRight = await SELF.fetch(url(`/${token}/profiles`));
    expect((await listAfterRight.json()).profiles[0].isActive).toBe(true);
  });

  it('404s (HTML) for an unknown profile id', async () => {
    const token = (await (await SELF.fetch(url('/api/households'), { method: 'POST' })).json())
      .token;
    const res = await SELF.fetch(url(`/${token}/switch/00000000-0000-0000-0000-000000000000`));
    expect(res.status).toBe(404);
  });
});
