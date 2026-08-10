// Static parts of the manifest. Per-household values are filled in
// per-request so the manifest URL can embed the household token while the
// addon identity itself stays stable.
const ADDON_VERSION = '1.0.0';

export const ADDON_NAME = 'MultiProfile';
export const ADDON_ID = 'org.multiprofile.stremio';

// Internal id namespace. Renamed from `switchboard:` along with the addon
// (the Node build's working title was Switchboard). Catalog ids match, so a
// household re-installing after the rename gets a clean, consistent manifest.
export const ID_NAMESPACE = 'multiprofile:';
export const PROFILE_ID_PREFIX = `${ID_NAMESPACE}profile:`;
export const PROFILES_CATALOG_ID = 'multiprofile-profiles';
export const CONTINUE_WATCHING_CATALOG_ID = 'multiprofile-continue-watching';
export const BECAUSE_YOU_WATCHED_CATALOG_ID = 'multiprofile-because-you-watched';

export function buildManifest(householdToken) {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description:
      'Multi-profile switching for Stremio households. Continue Watching and ' +
      'recommendations are built from what this addon observes itself — it ' +
      'never requests or stores your Stremio account credentials.',
    // Scoped resource objects, not the bare-string shorthand, so this addon is
    // never queried for meta/streams of content it doesn't own.
    resources: [
      { name: 'catalog', types: ['other', 'movie', 'series'] },
      { name: 'meta', types: ['other'], idPrefixes: [ID_NAMESPACE] },
      { name: 'stream', types: ['other'], idPrefixes: [ID_NAMESPACE] },
      // Registered purely to observe watch activity (see design.md §1/§4.3)
      // — this addon never returns a playable stream itself.
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
    ],
    types: ['other', 'movie', 'series'],
    // Continue Watching and Because You Watched are each two catalog entries
    // sharing one id (movie + series) rather than one mixed-type catalog —
    // that's how mixed rows work under Stremio's per-type catalog model.
    catalogs: [
      { type: 'other', id: PROFILES_CATALOG_ID, name: 'Switch Profile', extra: [] },
      { type: 'movie', id: CONTINUE_WATCHING_CATALOG_ID, name: 'Continue Watching', extra: [] },
      { type: 'series', id: CONTINUE_WATCHING_CATALOG_ID, name: 'Continue Watching', extra: [] },
      { type: 'movie', id: BECAUSE_YOU_WATCHED_CATALOG_ID, name: 'Because You Watched', extra: [] },
      { type: 'series', id: BECAUSE_YOU_WATCHED_CATALOG_ID, name: 'Because You Watched', extra: [] },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: !householdToken,
    },
  };
}
