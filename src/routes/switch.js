import { Hono } from 'hono';
import { resolveHousehold, notFound, notFoundHtml } from '../lib/householdGuard.js';
import { verifyPin } from '../lib/pin.js';
import { renderPinForm, renderSwitchConfirmation } from '../lib/pages.js';

// This is the page a Stremio client opens (via stream.behaviorHints /
// externalUrl) when a user taps "Switch to {Name}". It is intentionally
// reachable by anyone holding the household's manifest URL — the PIN gate here
// is a parental-convenience control, not an authentication boundary (see
// design.md §4.4).
const routes = new Hono();

routes.get('/:token/switch/:profileId', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const households = c.get('households');
  const profile = await households.getProfile(household.id, c.req.param('profileId'));
  if (!profile) return notFoundHtml(c);

  if (profile.pin_hash) {
    return c.html(
      renderPinForm({ token: household.id, profileId: profile.id, name: profile.name })
    );
  }
  await households.setActiveProfile(household.id, profile.id);
  return c.html(renderSwitchConfirmation({ name: profile.name }));
});

routes.post('/:token/switch/:profileId', async (c) => {
  const household = await resolveHousehold(c);
  if (!household) return notFound(c);

  const households = c.get('households');
  const profile = await households.getProfile(household.id, c.req.param('profileId'));
  if (!profile) return notFoundHtml(c);

  // Hono parses application/x-www-form-urlencoded natively — no @fastify/formbody
  // equivalent needed.
  let pin = '';
  try {
    const body = await c.req.parseBody();
    pin = typeof body?.pin === 'string' ? body.pin : '';
  } catch {
    pin = '';
  }

  if (profile.pin_hash && !(await verifyPin(profile.pin_hash, pin))) {
    return c.html(
      renderPinForm({
        token: household.id,
        profileId: profile.id,
        name: profile.name,
        error: 'Incorrect PIN. Try again.',
      }),
      401
    );
  }

  await households.setActiveProfile(household.id, profile.id);
  return c.html(renderSwitchConfirmation({ name: profile.name }));
});

export default routes;
