// Static parts of the manifest. Per-household values (id, name) are filled
// in per-request so the manifest URL can embed the household token while
// the addon identity itself stays stable.
const ADDON_VERSION = '0.1.0';

export function buildManifest(householdToken) {
  return {
    id: 'org.switchboard.multiprofile',
    version: ADDON_VERSION,
    name: 'Switchboard',
    description:
      'Multi-profile switching for Stremio households. Continue Watching and ' +
      'recommendations are built from what this addon observes itself — it ' +
      'never requests or stores your Stremio account credentials.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['other', 'movie', 'series'],
    catalogs: [
      {
        type: 'other',
        id: 'switchboard-profiles',
        name: 'Switch Profile',
        extra: [],
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: !householdToken,
    },
  };
}
