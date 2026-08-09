# Switchboard

A Stremio multi-profile manager: household-scoped catalogs so a shared
Stremio install can behave like it has separate profiles — its own
profile switcher, continue-watching, and genre-based recommendations,
plus a proper household dashboard.

**Status:** the application is functionally complete and tested
(Phases 1–6, 8–9 of `docs/design.md`; 40 passing tests). What's left is
not code: **it isn't deployed anywhere yet** (Phase 7 needs a real
Cloudflare Tunnel or VPS target and credentials only a human can provide),
and it hasn't been through a cross-platform acceptance pass on real
Stremio clients (Phase 10). See `docs/PROGRESS.md` for the detailed,
up-to-date phase-by-phase status and resume notes.

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
Switchboard's own catalogs, not a device-wide content lock. The
`/configure` dashboard states this explicitly; don't market it as more
than it is.

## Running locally

```sh
npm install
npm test
npm run dev
```

Environment variables (all optional):

- `PORT` (default `3000`), `HOST` (default `0.0.0.0`)
- `SWITCHBOARD_DB_PATH` (default `./data/switchboard.db`)
- `SWITCHBOARD_BACKUP_PATH` (default `./data/backups/switchboard-backup.db`) —
  nightly `.backup()` + `VACUUM` target
- `SWITCHBOARD_ERROR_LOG_PATH` (default `./data/errors.jsonl`) — structured
  failure log; roll it up with `npm run rollup:errors`

## What's here

- **Household + profiles**: opaque 128-bit token per household, up to 12
  profiles, argon2id-hashed PINs, atomic active-profile switch.
- **In-Stremio profile switcher**: a generated poster per profile
  (`@napi-rs/canvas`, emoji or initials), reached via a "Switch to {Name}"
  stream item that opens a confirmation page — PIN gate, an auto-attempted
  `stremio://board` deep link, and an always-visible manual fallback button
  (the deep link is known to silently fail on some platforms/clients).
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
- **Reliability**: WAL-mode SQLite, nightly backup + VACUUM, per-token
  rate limiting, watch-event row-cap pruning, a crash-durability test that
  verifies an ungraceful restart loses no committed writes, and structured
  error logging with a weekly markdown rollup (`npm run rollup:errors`).

## Not here yet

- **Deployment.** No Cloudflare Tunnel / VPS has been set up. See
  `docs/design.md` §7 for the two options; this needs a decision plus
  actual infrastructure access.
- **Cross-platform acceptance** (`docs/design.md` §10) on real Stremio
  clients — Desktop, Android, iOS Safari, Android TV.

## License

MIT
