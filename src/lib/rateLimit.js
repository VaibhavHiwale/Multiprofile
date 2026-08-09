// Minimal in-memory fixed-window limiter, keyed by household token. Good
// enough for a single-process deploy (see design doc §6 "Abuse / scraping");
// not intended to survive a multi-instance deployment.
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();

  function check(key) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= max) {
      hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  }

  return { check };
}
