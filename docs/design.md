# Switchboard — Stremio Multi-Profile Manager

## 0. Read this before building anything

This document supersedes the earlier draft. It is grounded in the current
Stremio addon protocol (verified against the official stremio-addon-sdk docs
and open platform issues, not assumed from memory), and is honest about
where "better than Netflix" is achievable and where it isn't.

**What you cannot do, and should stop trying to do:** reskin Stremio's own
app chrome, intercept its navigation globally, or guarantee a seamless
auto-return after an in-addon action on every platform. A live, open bug
(Stremio/stremio-bugs#2466, #2484 — macOS v5, wry/winit shell) currently
drops `stremio://` deep links silently on macOS. Any UX that depends on
"tap switch, app automatically jumps back to your library" as the *only*
path will feel broken for a meaningful slice of users through no fault of
your code. Design a manual fallback as the primary path and treat
auto-return as a nice-to-have enhancement layered on top, not the mechanism
itself.

**Where "better than Netflix" is actually true and winnable:**
1. The `/configure` page — full HTML/CSS/JS, your own design, zero Stremio
   constraints. This is the canvas for anything Netflix-grade.
2. Backend intelligence most addons don't bother building: real per-profile
   recommendation logic, resume-position-aware continue-watching, PIN-gated
   kid profiles — see §4.
3. Engineering robustness — most community addons are single-person side
   projects with no tests, no restart policy, no backups. "Fail-proof"
   relative to that bar is a real, achievable, and valuable claim.

## 1. What broke the prior art (PezzHub Profile Manager)

To make Stremio's *native* Continue Watching / Library shelves change per
profile requires authenticating against Stremio's private, undocumented
account-sync API (`api.strem.io`) with a copy of the user's auth key stored
server-side, then rewriting their account library on every switch. This is
a single point of failure baked into the architecture:
- An API Stremio has never publicly documented or committed to
- A stored credential that fully controls the user's account
- Sync races against the official client's own writes, with no documented
  conflict resolution

**Design decision, not up for relitigating mid-build: this addon never
requests, stores, or uses a Stremio account credential.** Continue Watching
is addon-native — built from stream requests this addon itself observes —
not a rewrite of the real account library. That's a real trade-off (this
addon's history starts at install, and won't see anything watched outside
addons it can observe), and it should be stated plainly in the README, not
buried.

## 2. Protocol facts this design relies on (verified, not assumed)

- `manifest.behaviorHints.configurable` + a `/configure` route: standard
  pattern for addons that need user-specific setup and config-in-URL
  installs (household token embedded in the manifest path).
- Catalog `extra` properties (`genre`, `skip`, `search`, each with
  `isRequired`/`options`/`optionsLimit`) — used for pagination and any
  future filtering, not strictly needed for the core switch flow but useful
  for a "search my watch history" catalog later.
- Meta preview objects support `posterShape` (`square` / `poster` /
  `landscape`), `background` (PNG, 500kb max), `logo`, `description`,
  `releaseInfo`, `imdbRating` — enough to make profile cards and
  continue-watching cards look intentional, not default-grid generic.
- `stream.behaviorHints.externalUrl` opens a URL outside the normal player
  flow — this is the switch mechanism (tapping a "switch to {profile}"
  stream item hits an addon endpoint that flips the active profile, then
  serves a small confirmation page).
- `stremio://board` and `stremio://detail/{type}/{id}` deep links can jump
  back into Stremio's own UI — use as a "return to library" convenience
  button on the confirmation page, **never as the only way back**, given
  the macOS deep-link bug above (and inconsistent support noted across
  platforms in Stremio/stremio-bugs#1475).
- Catalog/meta handlers support per-response cache-control hints
  (`cacheMaxAge`, `staleRevalidate`, `staleError`) — use short cache on the
  profile-switcher catalog (state changes) and longer cache on
  continue-watching (cheap to recompute, but no need to hammer the DB).

## 3. Core architecture

```
Stremio client (any platform)
        │  HTTPS
        ▼
Manifest + catalog/meta/stream resources  ─┐
        │                                   │  single service,
        ▼                                   │  single deploy
Profile-aware resolvers                     │
        │                                   │
        ▼                                   │
SQLite (WAL) — households, profiles,        │
watch_events, active_profile pointer        │
```

- Single always-on internet-facing service (not a local-only companion —
  this addon must be reachable from anywhere, unlike a home-network-only
  media tool).
- Identity: opaque 128-bit household token in the manifest URL path
  (`/:token/manifest.json`), no Stremio login involved at any point.
- Switch mechanic: tapping a profile card flips `active_profile_id` for
  that household token server-side via a single atomic UPDATE. All
  subsequent catalog/meta/stream calls for that token are scoped to the new
  active profile. No reinstall, no new URL.

## 4. Feature design — where the "exceptional" ambition actually lives

### 4.1 The `/configure` household dashboard (your real canvas)
- Profile grid with custom avatar picker (emoji or uploaded image, cropped
  client-side), live preview matching how the poster card will render in
  Stremio
- Drag-to-reorder profiles
- Per-profile PIN toggle (see §4.4)
- Per-profile stats: hours watched, top genres, current streak — computed
  from `watch_events` joined against genre data fetched once per title from
  Cinemeta and cached locally (never re-fetched per view)
- One-tap copy of manifest URL + QR code for TV/other-device installs
  (scanning a QR code to install on a TV is a genuinely better setup
  experience than typing a URL on a remote)
- This page can be as visually ambitious as you want — it's the one surface
  with zero Stremio protocol constraints

### 4.2 Profile-switcher catalog row (in-Stremio)
- One meta card per profile: custom poster (avatar + name overlay,
  generated server-side as PNG, cached), `posterShape: "square"` to read as
  a profile picker rather than a content grid
- Active profile marked clearly (e.g. a subtle badge baked into the
  generated poster)
- Tapping opens the meta detail view with a single stream item labeled
  "Switch to {Name}" using `externalUrl` → tiny HTML confirmation page →
  offers **both** an auto-redirect attempt via `stremio://board` **and** a
  plain "Tap here to return to your library" button, since the deep link
  cannot be trusted alone (§2)

### 4.3 Continue Watching, done properly
Naive "most recent stream request" continue-watching is worse than
Netflix's. Do better:
- Dedupe series to the single next unwatched episode, not one row per
  watched episode (mirrors how Netflix/Prime present series progress)
- Weight ordering by recency **and** exclude items already effectively
  finished (if you can infer near-completion from repeated requests near
  the end of a runtime, deprioritize rather than keep resurfacing it)
- Cap at a sane row length (10–15), oldest silently aged out

### 4.4 Kid profiles — scoped honestly
- PIN required to switch *into* a PIN-protected profile (hashed with
  argon2/bcrypt, never stored plain)
- This addon's own generated rows (continue-watching, recommendations) can
  exclude titles whose Cinemeta genre metadata flags mature content
- **State this limitation explicitly in the README and the dashboard UI**:
  this cannot filter what *other* installed content addons (Torrentio,
  MediaFusion, etc.) independently return. It is scoped parental awareness
  within this addon's own catalogs, not a device-wide content lock. Don't
  let this get marketed as more than it is — that's the kind of overclaim
  that erodes trust in an open-source project fast.

### 4.5 Lightweight personalization — the feature that actually beats the original
- After N watch events, compute a simple genre-affinity vector per profile
  from Cinemeta metadata on watched titles (no ML needed — frequency counts
  are enough to be useful)
- Surface a "Because {Profile} has been watching {genre}" catalog row by
  querying Cinemeta's own catalogs filtered to top-affinity genres,
  excluding anything already in watch_events
- This is legitimate: it reads only public Cinemeta metadata, computes
  entirely from data this addon itself observed, and touches no other
  service's private API

## 5. Data model (SQLite, WAL mode)

```sql
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  active_profile_id TEXT
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  pin_hash TEXT,              -- nullable; argon2id if set
  is_kids INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(household_id, name)
);

CREATE TABLE watch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  imdb_id TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(profile_id, imdb_id, season, episode)
);
CREATE INDEX idx_watch_events_profile ON watch_events(profile_id, updated_at DESC);

CREATE TABLE title_genre_cache (   -- avoid refetching Cinemeta per view
  imdb_id TEXT PRIMARY KEY,
  genres TEXT NOT NULL,            -- JSON array
  fetched_at INTEGER NOT NULL
);
```

Max 12 profiles per household. All writes via prepared statements only.
`journal_mode = WAL`, `synchronous = NORMAL`.

## 6. Fail-proof engineering checklist

| Concern | Requirement |
|---|---|
| Process crash | systemd or Docker `restart: always`; `/healthz` endpoint |
| Power loss / corruption mid-write | WAL mode; profile switch is one atomic UPDATE |
| Backend temporarily unreachable | Other installed addons unaffected — this addon degrades to an empty/error row only, never a client-side crash |
| Token guessing | 128-bit random tokens; identical generic 404 for invalid vs. nonexistent |
| Disk fill | Nightly VACUUM; watch_events capped per profile (e.g. 5,000 rows, oldest pruned) |
| No public HTTPS story | Non-negotiable from day one — see §7 |
| Silent data loss | Nightly SQLite `.backup` API dump (not a raw copy of a live WAL file) to a second location |
| Bad input | Every endpoint validated with a schema library (e.g. zod) — reject malformed profile names, oversized avatars, invalid tokens with clear 4xx, never trust client input into SQL |
| Abuse / scraping | Basic per-token rate limiting on switch and write endpoints |
| Silent regressions | Unit tests per resolver (manifest/catalog/meta/stream), integration test hitting the real HTTP endpoints, CI on every push (GitHub Actions: lint + test) before merge |
| Unknown-unknowns in prod | Structured logging (request id, household token hash — never the raw token — status, latency); a plain-text `/metrics` line count is enough, no need for a full observability stack |

## 7. Deployment

- Docker container, SQLite db on the Pi 5's USB SSD (not the SD card)
- Public HTTPS via Cloudflare Tunnel (`cloudflared`) — stable HTTPS
  hostname, no port-forwarding, Pi stays off the open internet directly
- Alternative if household members' daily use shouldn't depend on home
  network uptime: a small always-on VPS or Fly.io free tier, same
  container and SQLite file, HTTPS out of the box. Decide this before
  Phase 6 — it's a real availability trade-off, not a deployment detail.

## 8. Tech stack

- Node.js + Fastify (lighter than Express, built-in schema validation
  hooks pair well with the input-validation requirement above)
- `better-sqlite3` (synchronous, simplest correct WAL usage)
- `zod` for request validation
- `argon2` for PIN hashing
- Configure page: plain HTML/CSS/vanilla JS or a minimal bundler — fewer
  dependencies is itself a reliability property for a project meant to
  keep running unattended for years
- No heavy frontend framework needed; this isn't a SPA, it's a handful of
  server-rendered or lightly-hydrated pages

## 9. Distribution

- Tier A: static GitHub Pages installer — "Create household" → manifest URL
  + QR code + deep link, zero manual URL editing
- Tier B: optional listing on stremio-addons.net once stable and tested
  across platforms

## 10. Acceptance criteria (per phase, non-negotiable)

Same manifest URL, unmodified, must work on: Stremio Desktop, Android,
Safari/iPhone, and Android TV. Additionally:
- PIN-gated profile switch tested and confirmed blocking on wrong PIN
- Switch confirmation page tested with deep-link auto-return **and** the
  manual fallback button, on at least Windows, Android, and iOS (macOS
  deep-link auto-return is known broken upstream — confirm the manual
  fallback works there instead, don't chase the platform bug)
- Full service restart (simulated crash) loses zero committed profile
  switches or watch events

## 11. Build phases

1. Core service: manifest, household creation, SQLite schema + WAL,
   healthcheck, CI skeleton (lint + empty test passing)
2. Profile CRUD, PIN hashing, switch mechanic + atomic active-profile
   update, unit tests for the resolvers
3. Profile-switcher catalog row with generated avatar posters, switch
   confirmation page (deep-link attempt + manual fallback)
4. Watch-event logging, deduped continue-watching catalog
5. Cinemeta genre cache + affinity computation + "Because you watched"
   recommendation row
6. Backup job, row-cap pruning, rate limiting, restart policy proven via
   simulated crash test
7. Cloudflare Tunnel (or VPS) deploy, HTTPS verified from an external
   network, not just home wifi
8. `/configure` dashboard: avatar picker, drag reorder, stats, QR code
9. GitHub Pages installer page
10. Cross-platform acceptance pass (§10)
11. README documenting the architectural trade-offs in §1 and §4.4 plainly,
    MIT license, repo published
