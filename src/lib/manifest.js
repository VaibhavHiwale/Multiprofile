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
    resources: [
      { name: 'catalog', types: ['other', 'movie', 'series'] },
      { name: 'meta', types: ['other'], idPrefixes: ['switchboard:'] },
      { name: 'stream', types: ['other'], idPrefixes: ['switchboard:'] },
      // Registered purely to observe watch activity (see design doc §1/§4.3)
      // — this addon never returns a playable stream itself.
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
    ],
    types: ['other', 'movie', 'series'],
    catalogs: [
      {
        type: 'other',
        id: 'switchboard-profiles',
        name: 'Switch Profile',
        extra: [],
      },
      {
        type: 'movie',
        id: 'switchboard-continue-watching',
        name: 'Continue Watching',
        extra: [],
      },
      {
        type: 'series',
        id: 'switchboard-continue-watching',
        name: 'Continue Watching',
        extra: [],
      },
      {
        type: 'movie',
        id: 'switchboard-because-you-watched',
        name: 'Because You Watched',
        extra: [],
      },
      {
        type: 'series',
        id: 'switchboard-because-you-watched',
        name: 'Because You Watched',
        extra: [],
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: !householdToken,
    },
  };
}
