import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHousehold, createHouseholdWithActiveProfile, toHex } from './helpers.js';

describe('/configure dashboard, stats, QR', () => {
  it('renders for a known household and 404s for an unknown one', async () => {
    const token = await createHousehold();

    const ok = await SELF.fetch(url(`/${token}/configure`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/text\/html/);
    expect(await ok.text()).toMatch(/MultiProfile/);

    const missing = await SELF.fetch(url(`/${'a'.repeat(32)}/configure`));
    expect(missing.status).toBe(404);
  });

  it('qrcode.png returns a PNG', async () => {
    const token = await createHousehold();
    const res = await SELF.fetch(url(`/${token}/qrcode.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(toHex(await res.arrayBuffer())).toBe('89504e470d0a1a0a');
  });

  it('stats reports distinct titles watched per profile', async () => {
    const { token, profile } = await createHouseholdWithActiveProfile();

    await SELF.fetch(url(`/${token}/stream/movie/tt0111161.json`));
    await SELF.fetch(url(`/${token}/stream/movie/tt0068646.json`));

    const statsRes = await SELF.fetch(url(`/${token}/stats`));
    expect(statsRes.status).toBe(200);
    const { stats } = await statsRes.json();
    expect(stats.length).toBe(1);
    expect(stats[0].profileId).toBe(profile.id);
    expect(stats[0].titlesWatched).toBe(2);
  });
});
