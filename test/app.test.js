import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { url, createHousehold } from './helpers.js';
import { ADDON_ID } from '../src/lib/manifest.js';

describe('core service', () => {
  it('GET /healthz returns ok', async () => {
    const res = await SELF.fetch(url('/healthz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /api/households creates a household and its manifest is reachable', async () => {
    const token = await createHousehold();
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    const res = await SELF.fetch(url(`/${token}/manifest.json`));
    expect(res.status).toBe(200);
    const manifest = await res.json();
    expect(manifest.id).toBe(ADDON_ID);
    expect(manifest.name).toBe('MultiProfile');
    expect(manifest.behaviorHints.configurable).toBe(true);
    expect(manifest.behaviorHints.configurationRequired).toBe(false);
  });

  it('POST /api/households allows cross-origin requests (needed by the GitHub Pages installer)', async () => {
    const res = await SELF.fetch(url('/api/households'), {
      method: 'POST',
      headers: { origin: 'https://example.github.io' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
  });

  it('GET /:token/manifest.json 404s identically for malformed and unknown tokens', async () => {
    const malformed = await SELF.fetch(url('/not-a-token/manifest.json'));
    const unknown = await SELF.fetch(url(`/${'a'.repeat(32)}/manifest.json`));

    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await malformed.json()).toEqual(await unknown.json());
  });
});
