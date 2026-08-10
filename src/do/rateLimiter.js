import { DurableObject } from 'cloudflare:workers';

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 30;

// Replaces src/lib/rateLimit.js (an in-memory Map inside a single Node
// process). Workers are stateless per-isolate and run in many edge locations
// at once, so a Map would neither persist nor coordinate.
//
// One Durable Object instance per household token (via getByName(token))
// gives exactly one authoritative counter per token, globally. The window
// algorithm is a straight port of the Node limiter — timestamps inside the
// trailing window, rejected once the count reaches `max` — so the observable
// semantics (30 mutating requests per 60 s per token) are unchanged.
//
// Counters live in instance memory rather than ctx.storage on purpose: if
// Cloudflare evicts an idle DO the window resets, which fails *open* for an
// abuse control that already tolerates process restarts in the Node build.
// Persisting every hit would add a storage write to every profile mutation for
// no real security gain.
export class RateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.hits = [];
  }

  async check({ windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX } = {}) {
    const now = Date.now();
    const windowStart = now - windowMs;
    this.hits = this.hits.filter((t) => t > windowStart);
    if (this.hits.length >= max) {
      return { allowed: false, remaining: 0 };
    }
    this.hits.push(now);
    return { allowed: true, remaining: max - this.hits.length };
  }

  // Test/ops affordance: drop the window without waiting it out.
  async reset() {
    this.hits = [];
  }
}

// Thin helper so routes don't have to know about DO plumbing. Falls open if
// the binding is missing (e.g. a stripped-down local config) rather than
// locking every mutation out.
export async function checkRateLimit(env, token, options) {
  if (!env?.RATE_LIMITER || !token) return true;
  const stub = env.RATE_LIMITER.getByName(token);
  const { allowed } = await stub.check(options ?? {});
  return allowed;
}
