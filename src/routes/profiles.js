import { Hono } from 'hono';
import { z } from 'zod';
import { resolveHousehold, notFound, toPublicProfile } from '../lib/householdGuard.js';
import { hashPin, verifyPin } from '../lib/pin.js';
import { checkRateLimit } from '../do/rateLimiter.js';
import { ProfileNotFoundError, ProfileLimitError } from '../db/households.js';

const nameSchema = z.string().trim().min(1).max(40);
const pinSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits');
// Either a short emoji glyph (rendered on the generated poster, see
// lib/poster.js) or a full URL — stored as-is in the fixed `avatar_url` column
// from design.md §5, whichever the /configure picker sent.
const avatarSchema = z.string().min(1).max(2048);

const createProfileSchema = z.object({
  name: nameSchema,
  avatarUrl: avatarSchema.nullable().optional(),
  pin: pinSchema.optional(),
  isKids: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  avatarUrl: avatarSchema.nullable().optional(),
  pin: z.union([pinSchema, z.null()]).optional(), // string sets it, null clears it
  isKids: z.boolean().optional(),
});

const reorderSchema = z.object({
  profileIds: z.array(z.string().uuid()).min(1),
});

const switchSchema = z.object({
  pin: z.string().optional(),
});

const profileIdParamSchema = z.object({
  profileId: z.string().uuid(),
});

// A missing/!JSON body is treated as {} rather than a 500 — POST .../switch
// on a PIN-less profile is legitimately body-less.
export async function readJsonBody(c) {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    return {};
  }
}

// Applied to mutating routes only; keyed by household token, backed by the
// RateLimiter Durable Object.
async function rateLimited(c, next) {
  const token = c.req.param('token');
  if (token && !(await checkRateLimit(c.env, token))) {
    return c.json({ error: 'too many requests' }, 429);
  }
  return next();
}

const routes = new Hono();

routes.get('/:token/profiles', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);
  const profiles = await c.get('households').listProfiles(household.id);
  return c.json({ profiles: profiles.map(toPublicProfile(household)) });
});

routes.post('/:token/profiles', rateLimited, async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const parsed = createProfileSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) {
    return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
  }
  const { name, avatarUrl, pin, isKids } = parsed.data;
  const pinHash = pin ? await hashPin(pin) : null;

  try {
    const profile = await c.get('households').createProfile(household.id, {
      name,
      avatarUrl: avatarUrl ?? null,
      pinHash,
      isKids: Boolean(isKids),
    });
    return c.json(toPublicProfile(household)(profile), 201);
  } catch (err) {
    if (err instanceof ProfileLimitError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

routes.patch('/:token/profiles/:profileId', rateLimited, async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const paramsParsed = profileIdParamSchema.safeParse({ profileId: c.req.param('profileId') });
  if (!paramsParsed.success) return notFound(c);

  const bodyParsed = updateProfileSchema.safeParse(await readJsonBody(c));
  if (!bodyParsed.success) {
    return c.json({ error: 'invalid request', issues: bodyParsed.error.issues }, 400);
  }
  const { name, avatarUrl, pin, isKids } = bodyParsed.data;
  const pinHash = pin === null ? null : pin !== undefined ? await hashPin(pin) : undefined;

  try {
    const profile = await c.get('households').updateProfile(household.id, paramsParsed.data.profileId, {
      name,
      avatarUrl,
      pinHash,
      isKids,
    });
    return c.json(toPublicProfile(household)(profile));
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return notFound(c);
    throw err;
  }
});

routes.delete('/:token/profiles/:profileId', rateLimited, async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const paramsParsed = profileIdParamSchema.safeParse({ profileId: c.req.param('profileId') });
  if (!paramsParsed.success) return notFound(c);

  try {
    await c.get('households').deleteProfile(household.id, paramsParsed.data.profileId);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return notFound(c);
    throw err;
  }
});

routes.post('/:token/profiles/reorder', rateLimited, async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const parsed = reorderSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) {
    return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
  }
  const rows = await c.get('households').reorderProfiles(household.id, parsed.data.profileIds);
  return c.json({ profiles: rows.map(toPublicProfile(household)) });
});

// The atomic switch: a single UPDATE inside households.setActiveProfile.
// PIN-protected profiles require a correct PIN in the body to switch into.
routes.post('/:token/profiles/:profileId/switch', rateLimited, async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const paramsParsed = profileIdParamSchema.safeParse({ profileId: c.req.param('profileId') });
  if (!paramsParsed.success) return notFound(c);

  const households = c.get('households');
  const profile = await households.getProfile(household.id, paramsParsed.data.profileId);
  if (!profile) return notFound(c);

  if (profile.pin_hash) {
    const bodyParsed = switchSchema.safeParse(await readJsonBody(c));
    const pin = bodyParsed.success ? bodyParsed.data.pin : undefined;
    if (!pin || !(await verifyPin(profile.pin_hash, pin))) {
      return c.json({ error: 'pin required or incorrect' }, 401);
    }
  }

  await households.setActiveProfile(household.id, profile.id);
  return c.json(toPublicProfile({ ...household, active_profile_id: profile.id })(profile));
});

export default routes;
