import { z } from 'zod';

export const tokenParamSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'invalid household token'),
});

export const NOT_FOUND_BODY = { error: 'not found' };

// Resolves the :token path param to a household row, or returns null after
// stashing a generic 404 on the context. Malformed and valid-but-unknown
// tokens get an identical response so token guessing can't distinguish the two
// (design.md §6).
//
// Hono has no reply object to mutate, so callers do:
//   const household = await resolveHousehold(c);
//   if (!household) return notFound(c);
export async function resolveHousehold(c) {
  const parsed = tokenParamSchema.safeParse({ token: c.req.param('token') });
  if (!parsed.success) return null;
  return (await c.get('households').getHousehold(parsed.data.token)) ?? null;
}

export function notFound(c) {
  return c.json(NOT_FOUND_BODY, 404);
}

export function notFoundHtml(c) {
  return c.html('<h1>Not found</h1>', 404);
}

export function toPublicProfile(household) {
  return (row) => ({
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    isKids: Boolean(row.is_kids),
    hasPin: Boolean(row.pin_hash),
    sortOrder: row.sort_order,
    isActive: row.id === household.active_profile_id,
  });
}
