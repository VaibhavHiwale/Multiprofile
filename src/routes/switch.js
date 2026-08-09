import { resolveHousehold } from '../lib/household-guard.js';
import { verifyPin } from '../lib/pin.js';
import { renderPinForm, renderSwitchConfirmation } from '../lib/pages.js';

// This is the page a Stremio client opens (via stream.behaviorHints /
// externalUrl) when a user taps "Switch to {Name}". It is intentionally
// reachable by anyone holding the household's manifest URL — the PIN gate
// here is a parental-convenience control, not an authentication boundary
// (see design doc §4.4).
export default async function switchRoutes(app) {
  const { households } = app;

  app.get('/:token/switch/:profileId', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const profile = households.getProfile(household.id, req.params.profileId);
    if (!profile) {
      reply.code(404).type('text/html');
      return '<h1>Not found</h1>';
    }

    reply.type('text/html');
    if (profile.pin_hash) {
      return renderPinForm({ token: household.id, profileId: profile.id, name: profile.name });
    }
    households.setActiveProfile(household.id, profile.id);
    return renderSwitchConfirmation({ name: profile.name });
  });

  app.post('/:token/switch/:profileId', async (req, reply) => {
    const household = resolveHousehold(households, req, reply);
    if (!household) return;
    const profile = households.getProfile(household.id, req.params.profileId);
    if (!profile) {
      reply.code(404).type('text/html');
      return '<h1>Not found</h1>';
    }

    reply.type('text/html');
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    if (profile.pin_hash && !(await verifyPin(profile.pin_hash, pin))) {
      reply.code(401);
      return renderPinForm({
        token: household.id,
        profileId: profile.id,
        name: profile.name,
        error: 'Incorrect PIN. Try again.',
      });
    }

    households.setActiveProfile(household.id, profile.id);
    return renderSwitchConfirmation({ name: profile.name });
  });
}
