# MultiProfile

A Stremio multi-profile manager: household-scoped catalogs so a shared
Stremio install can behave like it has separate profiles — its own
profile switcher, continue-watching, and genre-based recommendations,
plus a proper household dashboard.

Runs entirely on **Cloudflare Workers + D1 + R2** (Hono, Durable Objects
for rate limiting, Cron Triggers for the weekly maintenance job) — a
single-vendor, free-tier-friendly stack with no server to keep alive. See
`docs/PROGRESS.md` for the detailed, up-to-date status, including how this
project got here from an earlier Node.js/Fastify prototype (that build is
preserved on `main`; this Workers rewrite lives on
`cloudflare-workers-migration`).

**Status:** locally verified — `npm run lint` clean, `npm test` passing
(43 tests, run against Cloudflare's local Miniflare simulation, no real
account needed). The real D1 database and R2 bucket have been provisioned
on Cloudflare; final deploy to a public URL and a cross-platform
acceptance pass are what's left. See `docs/PROGRESS.md` for the exact
remaining steps.

## Architectural trade-off (read this first)

This addon **never requests, stores, or uses a Stremio account
credential.** Making Stremio's own native Continue Watching / Library
shelves change per profile would require a copy of the user's private
account auth key stored server-side against an undocumented API — a
single point of failure this project deliberately avoids.

Instead, Continue Watching and recommendations are addon-native: this
addon registers as an observation-only `stream` resource for movies/series
and logs a watch event whenever Stremio asks it for streams on a title,
then returns none. That means history starts at install and won't include
anything watched outside addons this service can see. This is a
deliberate scope limit, not an oversight.

## Kid-profile limitation (also read this first)

PIN-gated kid profiles filter *this addon's own* catalog rows (Continue
Watching, Because You Watched) by Cinemeta genre metadata. They cannot
filter what other installed addons (Torrentio, MediaFusion, etc.)
independently return — this is scoped parental awareness within
MultiProfile's own catalogs, not a device-wide content lock. The
`/configure` dashboard states this explicitly; don't market it as more
than it is.

## Cost & limits

Read `docs/PROGRESS.md`'s "Cost & limits" section before worrying about
this. Short version, verified directly against Cloudflare's pricing pages:
Workers and D1 on the Free plan cannot bill overages at all — they just
reject requests past the free tier. R2 is the only product here that can
actually charge money, and this codebase's R2 usage is structurally
bounded (at most two cached poster images per profile, ever, plus one tiny
markdown file a week).

## Running locally

```sh
npm install
npm test          # runs entirely against a local Miniflare simulation
npm run dev        # wrangler dev --local
```

No environment variables or Cloudflare account are needed for the above.
Deploying for real needs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
and the real resource IDs filled into `wrangler.toml` — see
`docs/PROGRESS.md` for the exact steps.

## What's here

- **Household + profiles**: opaque 128-bit token per household, up to 12
  profiles, argon2id-hashed PINs (WASM, `@noble/hashes` — Workers has no
  native-binary support), atomic active-profile switch.
- **In-Stremio profile switcher**: a generated poster per profile
  (`@cf-wasm/satori` + `@cf-wasm/resvg`, emoji or initials), reached via a
  "Switch to {Name}" stream item that opens a confirmation page — PIN
  gate, an auto-attempted `stremio://board` deep link, and an
  always-visible manual fallback button (the deep link is known to
  silently fail on some platforms/clients).
- **Continue Watching**: deduped to one row per title, with a "next
  episode" heuristic for series (not verified against actual episode
  counts — a documented simplification).
- **Because You Watched**: frequency-count genre affinity from watch
  history, querying Cinemeta's own public catalogs — no account data, no ML.
- **`/configure` dashboard**: profile grid, emoji avatar picker,
  drag-to-reorder, per-profile stats, manifest URL + QR code + one-tap
  Stremio deep link.
- **`docs/index.html`**: a static GitHub Pages installer — enter your
  deployed service URL once, get a manifest URL + QR code with zero manual
  editing. Needs GitHub Pages enabled on this repo (Settings → Pages →
  Deploy from branch → `main` / `/docs`) to actually go live; not enabled
  yet.
- **Reliability**: D1 (point-in-time recovery built in — no custom backup
  job needed), per-IP and per-household-token rate limiting via a Durable
  Object, watch-event row-cap pruning, and structured D1-backed error
  logging with a Cron-Trigger-driven weekly markdown rollup to R2.

## Not here yet

- **Live deployment.** D1 and R2 are provisioned on the real account;
  `wrangler deploy` to a public URL hasn't happened yet. See
  `docs/PROGRESS.md` for the exact remaining steps.
- **Cross-platform acceptance** on real Stremio clients — Desktop,
  Android, iOS Safari, Android TV.

## License

MIT
