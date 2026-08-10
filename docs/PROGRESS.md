# MultiProfile (formerly Switchboard) — build progress & resume notes

Read this first if you're picking the project back up. It tracks what's
actually done (verified by tests, not just written), what's in flight, and
the exact next step. The full spec lives in `docs/design.md` — this file is
the status layer on top of it.

## ⚠️ Current state as of the Cloudflare Workers migration (read this first)

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

**Status: the local build is now verified working.** `npm run lint` is
clean and `npm test` passes **42/42 tests** (exceeding the Node build's 40)
across 12 test files, covering: households/profiles repo + HTTP CRUD, PIN
gate + atomic switch, the profile-switcher catalog/meta/stream/poster
routes, the switch confirmation page (PIN form, wrong/right PIN), watch-event
logging + dedupe (including the NULL-safe season/episode upsert), continue-
watching, because-you-watched recommendations, D1-backed error logging +
the R2-backed weekly rollup, the `/configure` dashboard + stats + QR code,
and the rate-limiter Durable Object (both directly and end-to-end via a
429 on a mutating route). **Nothing has been deployed to a real Cloudflare
account** — all of this runs against Miniflare's local simulation of
D1/R2/Durable Objects, which needs no credentials.

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

### What's left before this can go live

Real Cloudflare credentials (API token + account ID) have been provided by
the project owner and verified present as `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` user-level environment variables on the dev
machine. **Nothing has been provisioned or deployed with them yet.** Next:

1. `wrangler d1 create multiprofile-db` → paste the printed database_id
   over `REPLACE_ME_WITH_REAL_D1_DATABASE_ID` in `wrangler.toml`.
2. `wrangler r2 bucket create multiprofile-assets`.
3. Apply the schema to the real (not local) D1 database:
   `wrangler d1 migrations apply multiprofile-db --remote`.
4. `wrangler dev` as a final local sanity check against the real bindings.
5. `wrangler deploy` → publishes to `multiprofile.<account-subdomain>.workers.dev`.
6. Smoke-test the live URL directly (create a household, create a profile,
   check the poster renders, check the switch flow) before treating it as
   production-ready.
7. Only after that: merge `cloudflare-workers-migration` into `main` with
   the project owner's explicit sign-off, point `docs/index.html` (the
   GitHub Pages installer) at the live URL, and update this file's phase
   table to reflect the Workers stack as the primary deployment.

Do **not** merge into `main` before step 6. `main`'s Node.js build remains
the last fully-shipped state of this project until the Workers version is
proven live.

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
