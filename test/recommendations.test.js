import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHouseholdWithActiveProfile, stubCinemeta } from './helpers.js';

describe('because-you-watched recommendations', () => {
  it('recommends titles from the top genre, excluding already-watched titles', async () => {
    stubCinemeta({
      metaByKey: { 'movie:tt0111161': { name: 'The Shawshank Redemption', genres: ['Drama'] } },
      catalogByKey: {
        'movie:Drama': [
          { id: 'tt0111161', type: 'movie', name: 'The Shawshank Redemption' }, // already watched
          { id: 'tt0068646', type: 'movie', name: 'The Godfather' },
        ],
      },
    });
    const { token } = await createHouseholdWithActiveProfile();

    await SELF.fetch(url(`/${token}/stream/movie/tt0111161.json`));

    const res = await SELF.fetch(
      url(`/${token}/catalog/movie/multiprofile-because-you-watched.json`)
    );
    expect(res.status).toBe(200);
    const { metas } = await res.json();
    expect(metas.length).toBe(1);
    expect(metas[0].id).toBe('tt0068646');
  });

  it('is empty with no watch history', async () => {
    const { token } = await createHouseholdWithActiveProfile();
    const res = await SELF.fetch(
      url(`/${token}/catalog/movie/multiprofile-because-you-watched.json`)
    );
    expect(await res.json()).toEqual({ metas: [] });
  });
});
