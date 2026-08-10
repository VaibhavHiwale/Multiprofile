# MultiProfile (formerly Switchboard) — build progress & resume notes

Read this first if you're picking the project back up. It tracks what's
actually done (verified by tests, not just written), what's in flight, and
the exact next step. The full spec lives in `docs/design.md` — this file is
the status layer on top of it.

## Real-device finding: `type: 'other'` doesn't work for actionable cards

First cross-platform test (Stremio Desktop, 2026-08-10) found a real bug
neither the design doc, the protocol spec, nor local testing could have
caught: the profile-switcher catalog/meta/stream were declared as
`type: 'other'`. The catalog rendered fine on the Board ("Switch Profile -
Other" row, cards visible), but tapping a profile card opened the detail
page and then showed Stremio's own green **"Install addons"** button
instead of the addon's actual "Switch to {name}" stream/`externalUrl`
action — regardless of what the addon's `/stream` endpoint returned
(verified: the live API's raw JSON response was correct and well-formed).

Root cause (best-supported theory, since Stremio's client-side rendering
logic isn't part of the published protocol spec): `type: 'other'` is
effectively reserved by the Stremio client for **meta-addon catalogs** — an
addon whose catalog lists *other addons* to install — so opening any
`type: 'other'` meta's stream list shows Stremio's built-in addon-catalog
UI instead of the addon's own response. This is undocumented behavior, not
a bug in this codebase, but it made the entire profile-switcher
non-functional despite every layer of automated testing passing.

**Fix:** changed the profile-switcher catalog/meta/stream from
`type: 'other'` to `type: 'movie'` — the type every real-world Stremio
addon uses for this "actionable card with an externalUrl stream" pattern.
`src/lib/manifest.js`, `src/routes/stremio.js`, and their tests were
updated; verified against the live API after redeploying (manifest now
advertises `types: ['movie', 'series']` only, catalog/meta/stream all
respond correctly under `/movie/`). **Awaiting the project owner
re-testing on Stremio Desktop to confirm the fix actually renders a
tappable "Switch to {name}" action** — I can verify the server-side
contract but not the client's rendering, which is exactly what broke here
the first time.

## Cost & limits (read this if you're worried about being charged)

Verified directly against Cloudflare's pricing pages, not assumed:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/).

**The short version: Workers and D1, on the Free plan, cannot bill you at
all — they just stop serving requests if you exceed the free tier. R2 is
the only product here that can actually charge money, and only past a
free allowance generous enough that normal household use won't come close.**

### Why Workers/D1 are structurally safe on the Free plan

Overage *pricing* for D1 (rows read/written past the free tier) and Workers
(requests past 100K/day) is explicitly a **Workers Paid plan** ($5/mo
baseline) feature. On the Workers **Free** plan — which this project is on
unless someone deliberately upgrades it — there is no metered billing path
for these at all. Exceeding the free tier just means requests start
failing (D1 queries error, Worker invocations get rejected) rather than an
invisible charge appearing. Free-plan limits, for reference:

| Product | Free tier | What happens past it (Free plan) |
|---|---|---|
| Workers | 100,000 requests/day | Requests get rejected |
| D1 | 5 GB storage, 5M rows read/day, 100K rows written/day | Queries error |

A household-scale addon (a few people checking Stremio a few times a day)
uses a vanishingly small fraction of these — the numbers above are sized
for real production traffic, not a family's viewing habits.

### R2 — the one product that can actually cost money

R2 bills from the first byte past its free tier regardless of Workers
plan, which is why Cloudflare required a card on file just to enable it.
Free tier, then overage rate once exceeded:

| | Free / month | Overage rate |
|---|---|---|
| Storage | 10 GB-month | $0.015 / GB-month |
| Class A ops (writes/lists) | 1,000,000 | $4.50 / million |
| Class B ops (reads) | 10,000,000 | $0.36 / million |
| Egress | Unlimited, always free | — |

Cloudflare rounds usage up to the next whole billing unit (e.g.
1,000,001 ops bills as 2 million).

**Where this codebase actually touches R2**, and why it's bounded:

- `src/routes/stremio.js`'s poster route (`GET /:token/poster/:profileId`):
  one Class B read per request (cache check), and — critically — a Class A
  write **only on a cache miss**. The R2 object key is a content hash of
  `(profile id, name, avatar_url, isActive, is_kids)`
  (`posterCacheKey`), so each profile has **at most 2 stable cached
  variants** (active/inactive) that, once rendered, are reused forever
  until the profile's name/avatar/kids-flag actually changes. This is not
  "one write per request" — it's bounded by how often profiles are edited,
  which is rare.
- The weekly Cron Trigger rollup (`src/lib/rollup.js`): one Class A write,
  once a week. Negligible.
- Storage: generated poster PNGs and rollup markdown files are tiny (a few
  KB each); 10 GB free is enormous headroom at this scale.

**The one real gap this surfaced, and the fix applied:** `POST
/api/households` was completely unrate-limited. Every *other* mutating
route is rate-limited per household token (`src/routes/profiles.js`), but
an attacker could sidestep every one of those limits by simply minting a
fresh token per request — unbounded token creation → unbounded profiles →
unbounded D1 writes and, via the poster cache-miss path, unbounded R2
Class A operations. Fixed in `src/app.js`: household creation is now
rate-limited to 20/hour **per client IP** (via `cf-connecting-ip`, reusing
the same `RateLimiter` Durable Object), tested in
`test/rateLimiter.test.js`. 20/hour comfortably covers real use (creating
households for family/friends) while making mass token-minting
impractically slow.

### What to actually do about it

Code-level guardrails reduce *how* the free tier could be exceeded, but the
authoritative, zero-maintenance safety net is Cloudflare's own usage
tracking, not anything this app can self-meter reliably.

**Done:** a `billing_budget_alert` notification policy was created via
Cloudflare's Alerting API (`POST /accounts/{id}/alerting/v3/policies`,
policy id `896bba521aee46188459cf19eee2abc2`) — fires an email to the
account owner the moment cumulative usage-based charges reach **$1** in a
billing period. Verified active via a follow-up GET on the policy. $1 is
about as tight a threshold as makes sense (low enough to catch anything
unexpected almost immediately, high enough to not trip on rounding). This
is the authoritative, Cloudflare-side signal — not an in-app estimate.

## ✅ Cloudflare Workers migration: deployed, live, and merged into `main`

Everything below the next section describes the **Node.js/Fastify build**,
which is complete, tested (40 tests), and lives on `main`. **`main` is
untouched and still reflects that working Node.js state.**

A migration to **Cloudflare Workers + D1 + R2** (Hono replacing Fastify, D1
replacing better-sqlite3, `@noble/hashes` argon2id replacing native
`argon2`, `@cf-wasm/satori`+`@cf-wasm/resvg` replacing `@napi-rs/canvas`,
Durable Objects replacing the in-memory rate limiter, Cron Triggers
replacing `setInterval`, D1's point-in-time recovery replacing the custom
backup job) is on the `cloudflare-workers-migration` branch, pushed to
`origin`.

**Status: locally verified AND deployed live.** `npm run lint` clean,
`npm test` passes **43/43 tests** (exceeding the Node build's 40) across 12
test files — households/profiles repo + HTTP CRUD, PIN gate + atomic
switch, the profile-switcher catalog/meta/stream/poster routes, the switch
confirmation page (PIN form, wrong/right PIN), watch-event logging +
dedupe (including the NULL-safe season/episode upsert), continue-watching,
because-you-watched recommendations, D1-backed error logging + the
R2-backed weekly rollup, the `/configure` dashboard + stats + QR code, and
the rate-limiter Durable Object (direct, end-to-end on profile mutations,
and end-to-end on household creation).

**Live URL: `https://multiprofile.vaibhavhiwale.workers.dev`** — real D1
database (`multiprofile-db`) and R2 bucket (`multiprofile-assets`)
provisioned on the project owner's Cloudflare account, schema migration
applied to the remote database, `wrangler deploy` succeeded, and a full
smoke test against the live URL passed: household creation, profile
creation (including an emoji avatar verified to round-trip correctly as
real UTF-8 — an initial curl-based check showed `??` instead of the emoji,
traced to Git Bash's shell mangling a literal emoji typed on the command
line, *not* a server bug; confirmed by re-testing with Node's `fetch`,
which bypasses the shell entirely), poster PNG generation, the
profile-switcher catalog, the switch confirmation page, the `/configure`
dashboard, and the QR code endpoint all returned correct responses from
the real deployment.

**Also done, with the project owner's explicit go-ahead ("automatically do
all the things that make this addon a success and not cost me money"):**
smoke-test data cleared from the live D1 database and (best-effort) R2 —
`wrangler r2 object list` doesn't exist as a command, so any stray poster
objects from smoke testing weren't individually swept, but they're a
handful of KB-sized PNGs, negligible against the 10 GB free tier;
`cloudflare-workers-migration` merged into `main` (lint clean, 43/43
passing post-merge) and pushed; GitHub Pages enabled for `main`/`docs` via
the GitHub REST API (reusing the git credential already trusted for pushes
— no new credential requested) — live at
`https://vaibhavhiwale.github.io/Multiprofile/`, confirmed serving the
correct rebranded content; `docs/index.html` now defaults to the live
Workers URL; the Cloudflare billing-budget alert described in "Cost &
limits" above.

**Deliberately NOT done, and explained to the project owner rather than
either silently skipping or silently doing:** submitting to
stremio-addons.net. That directory is actively browsed by strangers
looking for addons to install — different risk profile than a Pages URL
existing quietly. design.md itself gates this on being "stable and tested
across platforms" first (Tier B), which the still-outstanding
cross-platform pass below is. Also: submission requires logging into
their site, which isn't a credential I have or should be given.

**Only remaining item: the cross-platform acceptance pass on real Stremio
clients** (Desktop, Android, iOS Safari, Android TV) — cannot be done by
an agent, needs physical devices.

### How this got here (context if you're confused by the history)

1. A background agent wrote most of this code, but was terminated mid-task
   by the Claude account's monthly spend limit before running a single
   test — and everything it had written was sitting **uncommitted**. It was
   committed as a WIP safety-checkpoint commit (`git log` on this branch)
   purely to prevent loss, not as a "this works" milestone.
2. At that point `npm test` failed before running a single test: Miniflare
   couldn't resolve `unicode-trie/swap`, a transitive dependency of
   satori's line-breaking (`linebreak`) package. Diagnosis: `swap.js` is
   genuinely pure JS with zero Node APIs — the failure was Vite's SSR dep
   optimizer not pre-bundling deep transitive CJS dependencies it wasn't
   explicitly told about (a documented
   [Cloudflare Workers Vitest known-issue](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#module-resolution)).
   Fixed by listing every problem package explicitly in
   `vitest.config.js`'s `deps.optimizer.ssr.include` — first `unicode-trie`
   itself, then (as each subsequent failure surfaced one at a time)
   `postcss-value-parser` and satori's other direct dependencies, and
   finally the exact deep-subpath specifier `qrcode/lib/core/qrcode.js`
   that `src/lib/qrcode.js` actually imports (the bare `qrcode` package
   name in the include list wasn't enough — Vite needs the literal
   specifier used in code for deep subpath imports).
3. With module resolution fixed, the app booted but had almost no test
   coverage (`test/app.test.js` only — the rest of the original 40 Node
   tests had been deleted and not yet replaced). All 12 test files above
   were then written and verified against the real implementation.
4. Also fixed along the way: `eslint.config.js` still listed Node globals
   instead of Workers/`workerd` globals; `src/lib/errorLog.js` was dead
   code orphaned by the D1-backed `src/db/errorEvents.js` replacement
   (deleted); `assets/fonts/LICENSE.txt` was referenced by a comment in
   `src/lib/fonts.js` but didn't exist (added — Roboto is Apache-2.0 and
   is redistributed in this repo as a font asset for poster generation).

### What's left

Everything except one item is done — see "Provisioning/deploy log" and the
"Also done" paragraph above for the full list (D1, R2, deploy, smoke test,
data cleanup, merge to `main`, GitHub Pages, installer defaulting to the
live URL, billing alert).

1. **Cross-platform acceptance pass** on real Stremio clients (Desktop,
   Android, iOS Safari, Android TV) — cannot be done by an agent, needs
   physical/real devices. Install `https://multiprofile.vaibhavhiwale.workers.dev/<token>/manifest.json`
   (get a token from the installer at
   `https://vaibhavhiwale.github.io/Multiprofile/`) on each platform,
   confirm the PIN gate blocks a wrong PIN, and confirm the switch
   confirmation page's manual fallback works on macOS specifically (the
   `stremio://board` deep-link auto-return is known broken there upstream
   — don't chase that bug, just confirm the fallback button works).
2. Only after that: consider submitting to stremio-addons.net (see the
   note above on why this is intentionally not done yet).

### Provisioning/deploy log (for reference)

- `wrangler d1 create multiprofile-db` → database id
  `276f251f-ef25-44b4-b5d8-884bd815e040`, filled into `wrangler.toml`.
- `wrangler d1 migrations apply multiprofile-db --remote` → applied
  `0001_initial_schema.sql`, all 5 tables confirmed present via
  `wrangler d1 execute ... --command "SELECT name FROM sqlite_master..."`.
- `wrangler r2 bucket create multiprofile-assets` → required enabling R2
  through the dashboard first (a one-time, per-account manual step;
  `wrangler`/API tokens cannot do this on their own — R2 has its own
  terms-of-service acceptance flow).
- `wrangler deploy` → required registering a `workers.dev` subdomain
  through the dashboard first (same category of one-time manual step).
  The account subdomain (`vaibhavhiwale`) is **account-wide, not
  per-project** — every future Worker on this account automatically gets
  `<worker-name>.vaibhavhiwale.workers.dev` with no further setup.
- Deployed URL: `https://multiprofile.vaibhavhiwale.workers.dev`. Took a
  couple of minutes after the first successful deploy for DNS/TLS to
  actually route (expected — Cloudflare's own deploy output says as much).
- Full smoke test against the live URL passed (see above).

## How to resume

```sh
cd "c:\Users\Deepak Suradkar\OneDrive\development\multiprofile"
npm install
npm run lint
npm test
npm run dev        # starts the service on :3000
```

Repo: https://github.com/VaibhavHiwale/Multiprofile (pushed, `main` branch).
Git identity for this repo: `VaibhavHiwale <vaibhavhiwale@outlook.com>`
(repo-local `git config`, not global).

## Status by design-doc phase (§11)

| Phase | What it is | Status |
|---|---|---|
| 1 | Core service: manifest, household creation, WAL schema, healthz, CI | ✅ Done, pushed |
| 2 | Profile CRUD, PIN hashing (argon2id), atomic switch, resolver tests | ✅ Done |
| 3 | Profile-switcher catalog, generated posters (`@napi-rs/canvas`), switch confirmation page (deep-link attempt + manual fallback) | ✅ Done |
| 4 | Watch-event logging (observation-only `stream` resource for `tt*` ids), deduped continue-watching catalog | ✅ Done (see caveat below) |
| 5 | Cinemeta genre cache + affinity + "Because you watched" row | ✅ Done |
| 6 | Backup job, row-cap pruning, rate-limit hardening, crash-durability test | ✅ Done — nightly `.backup()` + `VACUUM` (`src/lib/backup.js`, scheduled from `server.js`, not from `buildApp` so tests stay side-effect-free), row-cap pruning (5000/profile), per-token rate limiting, and an explicit test that rebuilds the app against a real file DB after skipping the graceful shutdown hook to prove WAL durability. |
| 7 | Deploy (Cloudflare Tunnel or VPS), public HTTPS | ❌ Blocked — needs a real decision + credentials (Pi/Cloudflare account, or a VPS) that only the user can provide. Not attempted. |
| 8 | `/configure` dashboard | ✅ Done — profile grid, emoji avatar picker, drag-to-reorder, per-profile stats, manifest URL + QR + deep link. |
| 9 | GitHub Pages installer | ✅ Built (`docs/index.html`) — **not live**: GitHub Pages isn't enabled on the repo yet (Settings → Pages → Deploy from branch → `main` / `/docs`), and it needs a deployed backend URL (Phase 7) to actually create households against. |
| 10 | Cross-platform acceptance pass on real devices | ❌ Cannot be done by an agent — needs physical/real Stremio clients (Desktop, Android, iOS Safari, Android TV). |
| 11 | README with trade-offs, MIT license, published repo | ✅ Done — README covers the §1 no-credential trade-off and §4.4 kid-profile scope limit, lists what's built vs. not, MIT licensed, pushed. |

**Continue-watching caveat (Phase 4):** the "next unwatched episode" label is
a heuristic (`last-watched episode + 1`), not verified against Cinemeta's
actual episode count for that season. Documented as a known simplification,
not a bug — fine for MVP, worth revisiting if it produces obviously wrong
labels (e.g. "S1E14" on a 13-episode season).

**Stats caveat (Phase 8):** the dashboard's per-profile stat is "distinct
titles watched," not "hours watched" as design.md §4.1 describes — this MVP
has no per-title runtime signal to compute actual watch-time from. Noted in
`src/routes/configure.js`, not silently overclaimed.

All 40 tests pass (`npm test`), covering: households, profiles, stremio
catalog/meta/stream/poster, switch confirmation + PIN gate,
continue-watching, recommendations, backup/maintenance, crash durability,
configure dashboard/stats/QR, error logging, and the weekly rollup script.

## Structured error logging + weekly rollup (done)

User-requested mid-session, not in the original design doc. Implemented as
specified: `src/lib/errorLog.js` appends one JSON line per failure
(timestamp, component, error type/message/stack, request path, SHA-256-
hashed household token — never raw) to `./data/errors.jsonl`
(`SWITCHBOARD_ERROR_LOG_PATH` to override), wired into `app.setErrorHandler`
in `src/app.js` (catches both resolver exceptions and synchronous
better-sqlite3 write failures) and into `src/lib/cinemeta.js`'s and
`src/lib/backup.js`'s catch paths. `npm run rollup:errors`
(`scripts/weekly-error-rollup.js`) summarizes the trailing 7 days into
`data/error-rollups/<ISO-week>.md`, grouped by component then error type,
counts descending.

**Not yet solved: scheduling.** Nothing in this repo triggers the rollup on
a cadence — that's naturally tied to Phase 7 deployment (e.g. a cron entry
or systemd timer next to the tunnel). Flag this when Phase 7 happens.

## What's actually left

Everything code-shaped is done. What remains needs the user, not more
code:

1. **Phase 7 — deploy.** Pick Cloudflare Tunnel (Pi 5) vs. a VPS/Fly.io
   (design.md §7 lays out the trade-off), get the actual
   credentials/access, stand it up, verify HTTPS from outside the home
   network.
2. **Enable GitHub Pages** on the repo (Settings → Pages → `main` / `/docs`)
   so `docs/index.html` actually resolves.
3. **Phase 10 — cross-platform acceptance** once something is deployed:
   install the same manifest URL, unmodified, on Stremio Desktop, Android,
   iOS Safari, and Android TV; confirm the PIN gate blocks a wrong PIN;
   confirm the switch confirmation page's manual fallback works on macOS
   (deep-link auto-return is known broken there upstream — don't chase
   that bug, just confirm the fallback button works).
4. Optional hardening if this goes into real use: schedule
   `npm run rollup:errors` (see above), and consider whether the in-memory
   rate limiter (`src/lib/rateLimit.js`) needs to become distributed if the
   service ever runs as more than one process.

## Decisions made along the way (not fully spelled out in design.md)

- Manifest resources are scoped objects (`{name, types, idPrefixes}`), not
  the bare-string shorthand, so this addon is never queried for meta/streams
  of content it doesn't own.
- Profile switch confirmation page PIN is submitted via a real HTML form
  (`@fastify/formbody`), not a PIN-in-query-string GET, to avoid PINs
  landing in server access logs / browser history.
- Continue-watching and "because you watched" are each two manifest catalog
  entries sharing one id (`movie` + `series`), rather than one mixed-type
  catalog — this is how mixed movie/series rows work under the Stremio
  protocol's per-type catalog model.
- `@napi-rs/canvas` and `qrcode` chosen over `canvas`/native alternatives
  specifically because they ship prebuilt binaries (no `node-gyp` build step
  on the deploy target, matching the "fewer moving parts" reliability goal
  in design.md §6/§8).
- The `avatar_url` column (design.md §5) stores either a short emoji glyph
  (from the `/configure` picker, rendered directly onto the generated
  poster) or a URL, despite the name — Stremio never fetches it directly,
  only this addon's own poster generator reads it. Full image-upload
  avatars (with client-side cropping, per design.md §4.1) are not
  implemented; emoji-only is the documented MVP scope.
- CORS is wide open (`origin: true`) on the whole service. Safe here
  specifically because every endpoint authorizes via an opaque token in the
  URL/body, never a cookie/session — there's no cross-origin credential to
  leak. Needed so `docs/index.html` (a different origin once on GitHub
  Pages) can call `POST /api/households`.
- Nightly maintenance (`scheduleNightlyMaintenance`) is wired from
  `server.js`, not from `buildApp()` in `src/app.js` — keeps `buildApp`
  (used by every test) free of background timers and side effects.
