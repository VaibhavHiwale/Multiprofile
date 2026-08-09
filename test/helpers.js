import { SELF } from 'cloudflare:test';
import { expect, vi } from 'vitest';

export const BASE = 'https://multiprofile.test';

export function url(path) {
  return `${BASE}${path}`;
}

export async function createHousehold() {
  const res = await SELF.fetch(url('/api/households'), { method: 'POST' });
  expect(res.status).toBe(201);
  return (await res.json()).token;
}

export async function postJson(path, body, init = {}) {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...init,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function patchJson(path, body) {
  return SELF.fetch(url(path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function createProfile(token, payload = { name: 'Alice' }) {
  const res = await postJson(`/${token}/profiles`, payload);
  expect(res.status).toBe(201);
  return res.json();
}

export async function createHouseholdWithProfile(payload = { name: 'Alice' }) {
  const token = await createHousehold();
  const profile = await createProfile(token, payload);
  return { token, profile };
}

export async function createHouseholdWithActiveProfile(payload = { name: 'Alice' }) {
  const { token, profile } = await createHouseholdWithProfile(payload);
  const res = await postJson(`/${token}/profiles/${profile.id}/switch`);
  expect(res.status).toBe(200);
  return { token, profile };
}

export const PNG_MAGIC = '89504e470d0a1a0a';

export function toHex(bytes, length = 8) {
  return [...new Uint8Array(bytes).subarray(0, length)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Replaces the Node suite's `t.mock.method(globalThis, 'fetch', ...)`.
// Every stub is scoped to one test via vi.stubGlobal + the automatic
// unstubGlobals restore configured in vitest.config.js.
export function stubCinemeta({ metaByKey = {}, catalogByKey = {}, onOther } = {}) {
  const impl = async (input, init) => {
    const str = String(typeof input === 'string' ? input : input.url);

    const metaMatch = /\/meta\/(movie|series)\/(tt\d+)\.json$/.exec(str);
    if (metaMatch) {
      const meta = metaByKey[`${metaMatch[1]}:${metaMatch[2]}`];
      return meta
        ? new Response(JSON.stringify({ meta }), { headers: { 'content-type': 'application/json' } })
        : new Response('not found', { status: 404 });
    }

    const catalogMatch = /\/catalog\/(movie|series)\/top\/genre=([^.]+)\.json$/.exec(str);
    if (catalogMatch) {
      const key = `${catalogMatch[1]}:${decodeURIComponent(catalogMatch[2])}`;
      return new Response(JSON.stringify({ metas: catalogByKey[key] ?? [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (onOther) return onOther(str, init);
    return new Response('not found', { status: 404 });
  };

  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}
