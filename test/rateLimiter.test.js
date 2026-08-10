import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHouseholdWithProfile } from './helpers.js';
import { RATE_LIMIT_MAX } from '../src/do/rateLimiter.js';

describe('RateLimiter Durable Object', () => {
  it('allows up to the window max, then rejects, then reset() clears it', async () => {
    const stub = env.RATE_LIMITER.getByName(`test-token-${crypto.randomUUID()}`);

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const { allowed } = await stub.check();
      expect(allowed).toBe(true);
    }
    const { allowed: rejected } = await stub.check();
    expect(rejected).toBe(false);

    await stub.reset();
    const { allowed: afterReset } = await stub.check();
    expect(afterReset).toBe(true);
  });

  it('is enforced end-to-end on a mutating route (429 past the limit)', async () => {
    const { token, profile } = await createHouseholdWithProfile();

    let sawTooManyRequests = false;
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      const res = await SELF.fetch(url(`/${token}/profiles/${profile.id}/switch`), {
        method: 'POST',
      });
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
    }
    expect(sawTooManyRequests).toBe(true);
  });

  it('household creation is rate-limited per client IP, independently of the token-based limiter', async () => {
    // Explicit cf-connecting-ip headers keep this test's bucket isolated from
    // every other test in the suite (which all share the "unknown" bucket
    // when Miniflare doesn't set the header) and from each other.
    const ipA = { headers: { 'cf-connecting-ip': `1.2.3.${crypto.randomUUID().slice(0, 2)}` } };
    const ipB = { headers: { 'cf-connecting-ip': `9.9.9.${crypto.randomUUID().slice(0, 2)}` } };

    let sawTooManyRequests = false;
    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch(url('/api/households'), { method: 'POST', ...ipA });
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
      expect(res.status).toBe(201);
    }
    expect(sawTooManyRequests).toBe(true);

    // A different client IP has its own, unaffected counter.
    const otherIpRes = await SELF.fetch(url('/api/households'), { method: 'POST', ...ipB });
    expect(otherIpRes.status).toBe(201);
  });
});
