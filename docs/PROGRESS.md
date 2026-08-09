# Switchboard — build progress & resume notes

Read this first if you're picking the project back up. It tracks what's
actually done (verified by tests, not just written), what's in flight, and
the exact next step. The full spec lives in `docs/design.md` — this file is
the status layer on top of it.

## How to resume

```
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
| 5 | Cinemeta genre cache + affinity + "Because you watched" row | ⏳ Not started |
| 6 | Backup job, row-cap pruning, rate-limit hardening, crash-durability test | 🟡 Partially done — row-cap pruning (5000/profile) is live in `WatchEventsRepo.logEvent`; basic per-token rate limiting is live on all profile-mutating routes (`src/lib/rateLimit.js`). Nightly `.backup()` job and an explicit simulated-crash test are **not** done yet. |
| 7 | Deploy (Cloudflare Tunnel or VPS), public HTTPS | ❌ Blocked — needs a real decision + credentials (Pi/Cloudflare account, or a VPS) that only the user can provide. Not attempted. |
| 8 | `/configure` dashboard | ⏳ Not started |
| 9 | GitHub Pages installer | ⏳ Not started |
| 10 | Cross-platform acceptance pass on real devices | ❌ Cannot be done by an agent — needs physical/real Stremio clients (Desktop, Android, iOS Safari, Android TV). |
| 11 | README with trade-offs, MIT license, published repo | 🟡 README exists and states the §1/§4.4 trade-offs; will need one more pass once Phase 8/9 land. |

**Continue-watching caveat (Phase 4):** the "next unwatched episode" label is
a heuristic (`last-watched episode + 1`), not verified against Cinemeta's
actual episode count for that season. Documented as a known simplification,
not a bug — fine for MVP, worth revisiting if it produces obviously wrong
labels (e.g. "S1E14" on a 13-episode season).

## In-flight work (started, not yet landed)

**Structured error logging + weekly rollup** — user-requested mid-session,
not in the original design doc. Exact requirement as given:

> On any unhandled failure (resolver exception, DB write failure, failed
> external call to Cinemeta, etc.), capture a structured record —
> timestamp, component, error type/message/stack, request path, hashed
> household token (never the raw token) — into a local append-only store.
> Weekly, roll these up into a short markdown summary grouped by component
> and error type, so the most frequent failure class is obvious before any
> new feature work starts.

Plan (not yet implemented as of this writing):
- `src/lib/errorLog.js` — `recordError({component, error, requestPath, householdToken})`
  appends one JSON line to `./data/errors.jsonl` (path overridable via
  `SWITCHBOARD_ERROR_LOG_PATH`). Household token is SHA-256 hashed
  (truncated), never stored raw. Never throws itself.
- Wire into `app.setErrorHandler` in `src/app.js` (catches both resolver
  exceptions and synchronous DB-write throws from better-sqlite3 — Fastify
  routes both to the same error handler) and into the `catch` block in
  `src/lib/cinemeta.js`.
- `scripts/weekly-error-rollup.js` — reads the last 7 days of
  `errors.jsonl`, writes `data/error-rollups/<ISO-week>.md` grouped by
  component then error type, counts descending. Exposed as
  `npm run rollup:errors`. Pure functions exported for unit testing.
- Not yet solved: **scheduling** the weekly rollup. No cron/scheduler
  exists in this repo yet — that's naturally tied to Phase 7 deployment
  (e.g. a cron entry or systemd timer next to the tunnel). Flag this when
  Phase 7 happens.

## Next step when resuming

1. Finish the error-logging feature above (implement + test).
2. Re-run `npm run lint && npm test`, then continue to Phase 5 (Cinemeta
   genre affinity + recommendation row) per the phase table.
3. Phases 6 (finish backup job + crash test), 8 (`/configure`), 9
   (GitHub Pages installer) follow in that order.
4. Phase 7 (deploy) and Phase 10 (device acceptance) need a decision/access
   from the user — surface this explicitly rather than guessing when
   reached.

## Decisions made along the way (not fully spelled out in design.md)

- Manifest resources are scoped objects (`{name, types, idPrefixes}`), not
  the bare-string shorthand, so this addon is never queried for meta/streams
  of content it doesn't own.
- Profile switch confirmation page PIN is submitted via a real HTML form
  (`@fastify/formbody`), not a PIN-in-query-string GET, to avoid PINs
  landing in server access logs / browser history.
- Continue-watching and "switch profile" are separate catalogs, one scoped
  to `type: other` (profile switcher) and two entries (`movie`/`series`)
  sharing the id `switchboard-continue-watching` — this is how mixed
  movie/series continue-watching rows are done under the Stremio protocol's
  per-type catalog model.
- `@napi-rs/canvas` and `qrcode` chosen over `canvas`/native alternatives
  specifically because they ship prebuilt binaries (no `node-gyp` build step
  on the deploy target, matching the "fewer moving parts" reliability goal
  in design.md §6/§8).
