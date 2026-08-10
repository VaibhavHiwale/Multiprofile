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
});
