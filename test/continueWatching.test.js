import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHouseholdWithActiveProfile, stubCinemeta } from './helpers.js';

describe('continue-watching catalog', () => {
  it('requesting streams for a movie logs a watch event; the catalog surfaces it', async () => {
    stubCinemeta({
      metaByKey: { 'movie:tt0111161': { name: 'The Shawshank Redemption', poster: 'poster.jpg' } },
    });
    const { token } = await createHouseholdWithActiveProfile();

    const streamRes = await SELF.fetch(url(`/${token}/stream/movie/tt0111161.json`));
    expect(streamRes.status).toBe(200);
    expect(await streamRes.json()).toEqual({ streams: [] });

    const catalogRes = await SELF.fetch(
      url(`/${token}/catalog/movie/multiprofile-continue-watching.json`)
    );
    expect(catalogRes.status).toBe(200);
    const { metas } = await catalogRes.json();
    expect(metas.length).toBe(1);
    expect(metas[0].id).toBe('tt0111161');
    expect(metas[0].name).toBe('The Shawshank Redemption');
  });

  it('series progress shows the next-episode heuristic label', async () => {
    stubCinemeta({ metaByKey: { 'series:tt0903747': { name: 'Breaking Bad', poster: 'p.jpg' } } });
    const { token } = await createHouseholdWithActiveProfile();

    await SELF.fetch(url(`/${token}/stream/series/tt0903747:1:3.json`));

    const catalogRes = await SELF.fetch(
      url(`/${token}/catalog/series/multiprofile-continue-watching.json`)
    );
    const { metas } = await catalogRes.json();
    expect(metas.length).toBe(1);
    expect(metas[0].description).toBe('Continue: S1E4');
  });

  it('is empty when no profile is active', async () => {
    const householdRes = await SELF.fetch(url('/api/households'), { method: 'POST' });
    const { token } = await householdRes.json();

    const catalogRes = await SELF.fetch(
      url(`/${token}/catalog/movie/multiprofile-continue-watching.json`)
    );
    expect(await catalogRes.json()).toEqual({ metas: [] });
  });
});
