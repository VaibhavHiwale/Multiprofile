import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { ErrorEventsRepo } from '../src/db/errorEvents.js';
import { buildMarkdown, isoWeekLabel, runWeeklyErrorRollup, ROLLUP_PREFIX } from '../src/lib/rollup.js';

describe('buildMarkdown (pure)', () => {
  it('groups counts by component and error type', () => {
    const now = Date.now();
    const records = [
      { timestamp: new Date(now).toISOString(), component: 'http', errorType: 'TypeError' },
      { timestamp: new Date(now).toISOString(), component: 'http', errorType: 'TypeError' },
      { timestamp: new Date(now).toISOString(), component: 'cinemeta', errorType: 'Error' },
    ];
    const md = buildMarkdown(records, now);
    expect(md).toMatch(/3 error\(s\) recorded/);
    expect(md).toMatch(/\*\*http\*\*: 2/);
    expect(md).toMatch(/\*\*cinemeta\*\*: 1/);
    expect(md).toMatch(/TypeError: 2/);
  });

  it('handles the empty case', () => {
    expect(buildMarkdown([], Date.now())).toMatch(/No errors recorded this week/);
  });
});

describe('runWeeklyErrorRollup (D1 -> R2)', () => {
  it('reads the last 7 days of error_events and writes a dated markdown object to R2', async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const repo = new ErrorEventsRepo(env.DB);

    await repo.record({ component: 'http', error: new Error('recent'), now });
    await repo.record({ component: 'http', error: new Error('stale'), now: eightDaysAgo });

    const { key, recordCount } = await runWeeklyErrorRollup(env, { now });
    expect(recordCount).toBe(1);
    expect(key).toBe(`${ROLLUP_PREFIX}/${isoWeekLabel(new Date(now))}.md`);

    const object = await env.ASSETS_BUCKET.get(key);
    expect(object).not.toBeNull();
    const markdown = await object.text();
    // The rollup is a component/type count summary, not a log dump — it
    // never includes message text, so the count itself is what proves the
    // 8-day-old "stale" record was excluded and the "recent" one wasn't.
    expect(markdown).toMatch(/1 error\(s\) recorded/);
    expect(markdown).toMatch(/\*\*http\*\*: 1/);
  });
});
