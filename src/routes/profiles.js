import { z } from 'zod';
import { resolveHousehold, toPublicProfile } from '../lib/household-guard.js';
import { hashPin, verifyPin } from '../lib/pin.js';
import { ProfileNotFoundError, ProfileLimitError } from '../db/households.js';

const nameSchema = z.string().trim().min(1).max(40);
const pinSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits');

const createProfileSchema = z.object({
  name: nameSchema,
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  pin: pinSchema.optional(),
  isKids: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
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

// Applied to mutating routes only; keyed by household token.
function rateLimitPreHandler(app) {
  return async (req, reply) => {
    const { token } = req.params;
    if (token && !app.rateLimiter.check(token)) {
      reply.code(429).send({ error: 'too many requests' });
    }
  };
}

export default async function profilesRoutes(app) {
  const { households } = app;
  const rateLimited = rateLimitPreHandler(app);

  app.get('/:token/profiles', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    return { profiles: households.listProfiles(household.id).map(toPublicProfile(household)) };
  });

  app.post('/:token/profiles', { preHandler: rateLimited }, async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;

    const parsed = createProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request', issues: parsed.error.issues };
    }
    const { name, avatarUrl, pin, isKids } = parsed.data;
    const pinHash = pin ? await hashPin(pin) : null;

    try {
      const profile = households.createProfile(household.id, {
        name,
        avatarUrl: avatarUrl ?? null,
        pinHash,
        isKids: Boolean(isKids),
      });
      reply.code(201);
      return toPublicProfile(household)(profile);
    } catch (err) {
      if (err instanceof ProfileLimitError) {
        reply.code(409);
        return { error: err.message };
      }
      throw err;
    }
  });

  app.patch('/:token/profiles/:profileId', { preHandler: rateLimited }, async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;

    const paramsParsed = profileIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      reply.code(404);
      return { error: 'not found' };
    }
    const bodyParsed = updateProfileSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      reply.code(400);
      return { error: 'invalid request', issues: bodyParsed.error.issues };
    }
    const { name, avatarUrl, pin, isKids } = bodyParsed.data;
    const pinHash = pin === null ? null : pin !== undefined ? await hashPin(pin) : undefined;

    try {
      const profile = households.updateProfile(household.id, paramsParsed.data.profileId, {
        name,
        avatarUrl,
        pinHash,
        isKids,
      });
      return toPublicProfile(household)(profile);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        reply.code(404);
        return { error: 'not found' };
      }
      throw err;
    }
  });

  app.delete('/:token/profiles/:profileId', { preHandler: rateLimited }, async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;

    const paramsParsed = profileIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      households.deleteProfile(household.id, paramsParsed.data.profileId);
      reply.code(204);
      return null;
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        reply.code(404);
        return { error: 'not found' };
      }
      throw err;
    }
  });

  app.post('/:token/profiles/reorder', { preHandler: rateLimited }, async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;

    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request', issues: parsed.error.issues };
    }
    const profiles = households
      .reorderProfiles(household.id, parsed.data.profileIds)
      .map(toPublicProfile(household));
    return { profiles };
  });

  // The atomic switch: single UPDATE inside households.setActiveProfile.
  // PIN-protected profiles require a correct PIN in the body to switch into.
  app.post('/:token/profiles/:profileId/switch', { preHandler: rateLimited }, async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;

    const paramsParsed = profileIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      reply.code(404);
      return { error: 'not found' };
    }
    const profile = households.getProfile(household.id, paramsParsed.data.profileId);
    if (!profile) {
      reply.code(404);
      return { error: 'not found' };
    }

    if (profile.pin_hash) {
      const bodyParsed = switchSchema.safeParse(req.body ?? {});
      const pin = bodyParsed.success ? bodyParsed.data.pin : undefined;
      if (!pin || !(await verifyPin(profile.pin_hash, pin))) {
        reply.code(401);
        return { error: 'pin required or incorrect' };
      }
    }

    households.setActiveProfile(household.id, profile.id);
    return toPublicProfile({ ...household, active_profile_id: profile.id })(profile);
  });
}
