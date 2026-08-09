import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { WatchEventsRepo } from '../src/db/watchEvents.js';
import { HouseholdsRepo } from '../src/db/households.js';

function makeRepos() {
  const db = openDatabase(':memory:');
  return { households: new HouseholdsRepo(db), watchEvents: new WatchEventsRepo(db) };
}

test('logEvent dedupes repeated movie events despite NULL season/episode', () => {
  const { households, watchEvents } = makeRepos();
  const token = households.createHousehold();
  const profile = households.createProfile(token, { name: 'Alice' });

  watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0111161' });
  watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0111161' });
  watchEvents.logEvent(profile.id, { contentType: 'movie', imdbId: 'tt0068646' });

  assert.equal(watchEvents.countForProfile(profile.id), 2);
  const recent = watchEvents.listRecentDeduped(profile.id, 10);
  assert.equal(recent.length, 2);
});

test('logEvent dedupes per series episode, keeping distinct episodes', () => {
  const { households, watchEvents } = makeRepos();
  const token = households.createHousehold();
  const profile = households.createProfile(token, { name: 'Alice' });

  watchEvents.logEvent(profile.id, { contentType: 'series', imdbId: 'tt0903747', season: 1, episode: 1 });
  watchEvents.logEvent(profile.id, { contentType: 'series', imdbId: 'tt0903747', season: 1, episode: 2 });

  // recentDeduped groups by imdb_id only, so the series collapses to its
  // single most-recently-touched episode row.
  const recent = watchEvents.listRecentDeduped(profile.id, 10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].episode, 2);
});
