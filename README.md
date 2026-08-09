# Switchboard

A Stremio multi-profile manager: household-scoped catalogs so a shared
Stremio install can behave like it has separate profiles.

**Status: early. This is Phase 1 of the build (see `docs/design.md`) —**
**core service scaffolding only.** Manifest generation, household
creation, and the SQLite schema are in place; profile switching, the
configure dashboard, and recommendations are not yet built.

## Architectural trade-off (read this first)

This addon **never requests, stores, or uses a Stremio account
credential.** Making Stremio's own native Continue Watching / Library
shelves change per profile would require a copy of the user's private
account auth key stored server-side against an undocumented API — a
single point of failure this project deliberately avoids.

Instead, Continue Watching and recommendations will be addon-native,
built only from stream requests this addon itself observes. That means
history starts at install and won't include anything watched outside
addons this service can see. This is a deliberate scope limit, not an
oversight.

## Running locally

```
npm install
npm test
npm run dev
```

Environment variables:
- `PORT` (default `3000`)
- `HOST` (default `0.0.0.0`)
- `SWITCHBOARD_DB_PATH` (default `./data/switchboard.db`)

## Endpoints so far

- `GET /healthz`
- `POST /api/households` — mints a new opaque household token
- `GET /:token/manifest.json` — Stremio addon manifest for that household

## License

MIT
