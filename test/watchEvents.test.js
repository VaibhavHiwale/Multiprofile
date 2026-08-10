import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { HouseholdsRepo } from '../src/db/households.js';
import { WatchEventsRepo } from '../src/db/watchEvents.js';

function repos() {
  return { households: new HouseholdsRepo(env.DB), watchEvents: new WatchEventsRepo(env.DB) };
}

describe('WatchEventsRepo (D1)', () => {
  it('logEvent dedupes repeated movie events despite NULL season/episode', async () => {
    const { households, watchEvents } = repos();
    const token = await households.createHousehold();
    const profile = await households.createProfile(token, { name: 'Alice' });

    await watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0111161' });
    await watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0111161' });
    await watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0068646' });

    expect(await watchEvents.countForProfile(profile.id)).toBe(2);
    expect((await watchEvents.listRecentDeduped(profile.id, 10)).length).toBe(2);
  });

  it('logEvent updates the same series episode in place, keeping distinct episodes separate', async () => {
    const { households, watchEvents } = repos();
    const token = await households.createHousehold();
    const profile = await households.createProfile(token, { name: 'Alice' });

    await watchEvents.logEvent(profile.id, {
      contentType: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 1,
    });
    await watchEvents.logEvent(profile.id, {
      contentType: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 2,
    });

    // recentDeduped groups by imdb_id, so the series collapses to its single
    // most-recently-touched episode row — never two rows for the same show.
    const recent = await watchEvents.listRecentDeduped(profile.id, 10);
    expect(recent.length).toBe(1);
    expect(recent[0].episode).toBe(2);
  });

  it('distinctImdbIds returns a Set of unique titles', async () => {
    const { households, watchEvents } = repos();
    const token = await households.createHousehold();
    const profile = await households.createProfile(token, { name: 'Alice' });

    await watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0111161' });
    await watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0068646' });

    const ids = await watchEvents.distinctImdbIds(profile.id);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(['tt0068646', 'tt0111161']);
  });
});
