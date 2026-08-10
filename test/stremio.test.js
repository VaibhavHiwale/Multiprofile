import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHouseholdWithProfile, PNG_MAGIC, toHex } from './helpers.js';
import { PROFILE_ID_PREFIX } from '../src/lib/manifest.js';

describe('stremio catalog/meta/stream/poster', () => {
  it('catalog lists one meta card per profile with a poster URL', async () => {
    const { token, profile } = await createHouseholdWithProfile();

    const res = await SELF.fetch(url(`/${token}/catalog/movie/multiprofile-profiles.json`));
    expect(res.status).toBe(200);
    const { metas } = await res.json();
    expect(metas.length).toBe(1);
    expect(metas[0].id).toBe(`${PROFILE_ID_PREFIX}${profile.id}`);
    expect(metas[0].posterShape).toBe('square');
    expect(metas[0].poster).toMatch(new RegExp(`/${token}/poster/${profile.id}`));
  });

  it('an unknown catalog id 404s', async () => {
    const { token } = await createHouseholdWithProfile();
    const res = await SELF.fetch(url(`/${token}/catalog/movie/bogus.json`));
    expect(res.status).toBe(404);
  });

  it('meta and stream resolve a profile-switch id', async () => {
    const { token, profile } = await createHouseholdWithProfile();
    const id = `${PROFILE_ID_PREFIX}${profile.id}`;

    const metaRes = await SELF.fetch(url(`/${token}/meta/movie/${id}.json`));
    expect(metaRes.status).toBe(200);
    expect((await metaRes.json()).meta.id).toBe(id);

    const streamRes = await SELF.fetch(url(`/${token}/stream/movie/${id}.json`));
    expect(streamRes.status).toBe(200);
    const { streams } = await streamRes.json();
    expect(streams.length).toBe(1);
    expect(streams[0].externalUrl).toMatch(new RegExp(`/${token}/switch/${profile.id}$`));
  });

  it('the poster route returns a PNG', async () => {
    const { token, profile } = await createHouseholdWithProfile();
    const res = await SELF.fetch(url(`/${token}/poster/${profile.id}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(toHex(await res.arrayBuffer())).toBe(PNG_MAGIC);
  });

  it('an emoji-avatar profile still renders a valid PNG poster', async () => {
    const { token, profile } = await createHouseholdWithProfile({ name: 'Kiddo', avatarUrl: '🦄' });
    const res = await SELF.fetch(url(`/${token}/poster/${profile.id}`));
    expect(res.status).toBe(200);
    expect(toHex(await res.arrayBuffer())).toBe(PNG_MAGIC);
  });
});
