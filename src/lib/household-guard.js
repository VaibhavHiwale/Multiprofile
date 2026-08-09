import { z } from 'zod';

export const tokenParamSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'invalid household token'),
});

// Resolves req.params.token to a household row, or sends a generic 404 and
// returns null. Malformed and valid-but-unknown tokens get an identical
// response so token guessing can't distinguish the two (design doc §6).
export function resolveHousehold(households, req, reply) {
  const parsed = tokenParamSchema.safeParse(req.params);
  if (!parsed.success) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  const household = households.getHousehold(parsed.data.token);
  if (!household) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  return household;
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
