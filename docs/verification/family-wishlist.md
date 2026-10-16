# Family wishlist verification evidence

**Current controller status (2026-10-16):** the follow-up repository review
resolved the outstanding UI findings and added their regression coverage.
Verification passed: 92 backend tests, 81 frontend tests, lint/build/checks,
both browser viewports, and six additional browser stability runs. See the
[current review report](repo-review-2026-10-16.md) and
[resolved findings](outstanding-issues.md).

The remaining sections are historical evidence from the 2026-10-15
implementation and its original final fix wave; their counts describe that
revision rather than the latest repository review.

Final coordinated fix-wave verification evidence, updated 2026-10-15. The initial fixed-port harness correctly refused occupied port 5174 rather than borrowing an unrelated Vite server. Following the controller's ruling, the fixture allocates fresh unused loopback ports for each viewport and passes only that exact frontend origin to Django. This update adds deterministic I1–I4 and M1–M2 regressions plus the CSRF write matrix; the earlier Task 12 counts are superseded by the fresh final counts below.

## Environment

- Python 3.14.4; Django 5.2.18; Django REST Framework 3.18.3; PyYAML 6.0.3
- Node v24.21.0; Vite 8.3.4; Vitest 5.0.5; Playwright 1.64.1
- Playwright Chromium was already cached: Chrome for Testing 156.0.8078.4 (`chromium-1248`); no browser reinstall was performed.
- Existing frontend dependency tree was present. `@playwright/test` was added to the frontend package/lock files.

## Commands and results

Final command: `bash scripts/verify.sh` (full run; no checks skipped or suppressed).

| Command | Result |
| --- | --- |
| `.venv/bin/python backend/manage.py test wishlist --settings=project.test_settings --keepdb` | PASS — 91 tests, 0 failures/errors |
| `.venv/bin/python backend/manage.py check --settings=project.test_settings` | PASS — no issues |
| `.venv/bin/python backend/manage.py makemigrations --check --dry-run --settings=project.test_settings` | PASS — no changes detected |
| `.venv/bin/python -m pip check` | PASS — no broken requirements |
| `npm --prefix frontend test` | PASS — 10 files, 79 tests |
| `npm --prefix frontend run lint` | PASS |
| `npm --prefix frontend run build` | PASS — Vite production build |
| `npm --prefix frontend run test:e2e` | PASS — 2 tests: desktop 1280×800 and phone 390×844, one fresh isolated server/config/database per run |
| `bash scripts/verify.sh` | PASS — exits 0 after every configured check |

The unrelated process on 5174 was not reused or terminated. The e2e supervisor runs in its own detached process group; its tracked Django/Vite children inherit that group. Each child handle is registered immediately, readiness failures stop the just-started child, and teardown signals the supervisor, waits up to 30 seconds for its bounded child cleanup, then kills and verifies termination of only the supervisor's private group if graceful cleanup times out or exits unsuccessfully. It never targets a port owner or external process. Per-run YAML/SQLite under `/tmp/opencode` is removed after cleanup. Django receives `WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN=http://127.0.0.1:<allocated-port>`; settings accept only an exact HTTP origin on `127.0.0.1` or `localhost`, with a valid explicit port, and add no wildcard. The setting is covered by tests.

## Final coordinated fix wave — RED/GREEN regressions

The RED entries are pre-fix evidence from the coordinated wave. The isolated diagnostic probes intentionally report the broken product state; a zero exit from those probes is not a passing-product result.

| Finding | RED evidence before fix | GREEN evidence after fix |
| --- | --- | --- |
| I1 — session-write ordering | `node /tmp/opencode/family-wishlist-final-identity-probe.mjs` reproduced the race: the UI showed Alex while a fresh session GET showed Sam; after refresh, Robin's buyer mark appeared on Alex's own gift. | `npm --prefix frontend run test:e2e` — 2 passed (desktop and phone). The held PUT/DELETE regression keeps the gate closed, prevents focus checks/selections from overtaking writes, reconciles the final server session, and verifies owner-facing purchase data stays private. |
| I2 — modal focus after rendered revalidation | `node /tmp/opencode/family-wishlist-final-focus-probe.mjs` held the same-profile session response through two rendered frames; focus was `BODY` after release and Escape left the dialog open. | `npm --prefix frontend run test:e2e` — 2 passed; `DeleteItemDialog.test.tsx` also covers same-profile revalidation. The browser test asserts hidden-state `BODY`, then focus inside the restored dialog, Escape, and return to the recreated logical trigger. |
| I3 — configured event key `all` | `.venv/bin/python backend/manage.py test wishlist.tests.test_item_reads --settings=project.test_settings --keepdb` failed on the three new active/inactive/unconfigured `all` cases: active `all` returned other events, and inactive or missing `all` was accepted. | The same focused command now passes all 13 tests. Omitted `event` alone means all events; active configured `all` filters correctly, and inactive/unconfigured keys return 400. |
| I4 — refreshed catalog and open filter/draft | `node /tmp/opencode/family-wishlist-final-archive-probe.mjs` reproduced both mismatches: the Birthday filter displayed All events but still requested `event=birthday` and got 400; the form displayed Anything but saved the archived Birthday ID while preserving notes. | `npm --prefix frontend run test:e2e` — 2 passed. With Birthday removed from the isolated YAML and the server restarted, the retained draft shows its archived assignment, notes survive, the request omits the invalid filter, and save payload/visible assignment agree. |
| M1 — repeat-purchase label | `npm --prefix frontend test -- --run src/features/wishlists/GiftCard.test.tsx` failed the new owner-card assertion because the shared card did not announce repeat-purchase allowance. | Included in `npm --prefix frontend test -- --run src/features/identity/IdentityProvider.test.tsx src/features/items/DeleteItemDialog.test.tsx src/features/items/ItemForm.test.tsx src/features/wishlists/EventFilter.test.tsx src/features/wishlists/GiftCard.test.tsx src/features/wishlists/WishlistPage.test.tsx` — 6 files, 57 tests passed. |
| M2 — configured “All events” label | `npm --prefix frontend test -- --run src/features/wishlists/EventFilter.test.tsx` failed the new collision assertion because the configured label was indistinguishable from the synthetic filter. | Same focused frontend command — 6 files, 57 tests passed; the configured value is labeled “All events (configured occasion)” without restricting YAML. |

CSRF write-matrix coverage: `.venv/bin/python backend/manage.py test wishlist.tests.test_item_writes.ItemWriteTests.test_every_unsafe_api_write_requires_csrf_and_leaves_state_unchanged --settings=project.test_settings --keepdb` — 1 passed. The existing protection was already functioning, so this was promoted to regression coverage without changing authentication behavior; the test checks missing-token rejection, no-store JSON, and unchanged session/item/purchase state.

The full browser command was also run independently before `bash scripts/verify.sh`: `npm --prefix frontend run test:e2e` — 2 passed (10.8s). Inside the full verification run it passed again (2 passed, 10.9s).

## Startup tests — RED/GREEN

- RED command: `.venv/bin/python backend/manage.py test wishlist.tests.test_startup --settings=project.test_settings` before `scripts/dev_backend.py` existed.
- RED result: 3 expected `FileNotFoundError` errors for `/home/klottick/repos/present-wishlist/scripts/dev_backend.py`.
- GREEN command: same startup test command after implementing launcher.
- GREEN result at initial launcher implementation: 3 tests passed. The continuation adds coverage for environment defaults with CLI precedence, migration failure preventing sync/server, and server failure propagation; the current startup module passes 6 tests total.
- For the continuation's launcher change, the environment-default regression was run RED first: it observed the repository path instead of the configured `FAMILY_CONFIG_PATH`. After using environment paths as parser defaults, all 6 startup tests passed.
- Added real-child E2E supervisor regressions: backend readiness failure leaves no live child, and cleanup attempts every tracked handle even if one stop raises. These tests were added after the lifecycle change; no historical RED run is claimed for them.
- CSRF origin config RED: two settings tests initially failed to import the missing `build_csrf_trusted_origins` helper. GREEN: 3 settings tests passed, including acceptance of only the exact loopback origin and rejection of wildcard, external, HTTPS, and path-bearing values.

## Other regression/self-review evidence

- Added two database-backed `TransactionTestCase` checks for owner/buyer profile `PROTECT` and assigned-event `PROTECT`; `.venv/bin/python backend/manage.py test wishlist.tests.test_models --settings=project.test_settings --keepdb` passed all 6 model tests.
- Initial live scenario failures exposed selector assumptions: form event selection collided with the occasion filter; actions and event-label assertions are now scoped to the named form/gift card. The restart branch was fixed to re-run migrations and YAML sync before serving again; the live renamed/removed event assertions prove the config update is applied while IDs and the remaining buyer mark persist.
- Purchase success is asserted via durable API/UI state rather than a transient notice that may be cleared by shared-tab identity revalidation. Delete dialog focus after same-profile revalidation is asserted on the dialog; after Escape the browser returns focus to that gift's delete control.
- Expected browser HTTP failures are checked by exact response status and endpoint: one 409 for the ordinary purchase conflict, one 503 and one 403 for the deletion error/revalidation path. Matching Chromium “Failed to load resource” console entries are accounted for only against those exact response allowances. Uncaught page errors and all other console errors still fail the test.
- Live result at both viewports: owner create/edit/delete; Birthday filtering includes Anything and excludes Christmas; owner API purchase-field omission and no buyer/current-mark disclosure after Sam/Robin have marked and the owner view/API are refreshed; actual competing-buyer conflict; repeatable multi-buyer marks/own undo; reload persistence; member label rename under stable `sam` key, with profile ID/session and gift/event/purchase references preserved through restart; keyboard dialog pending/error handling; same-profile blur/focus revalidation hides stale authenticated content and preserves the in-progress item draft; zero horizontal overflow; zero uncaught page errors; and zero unexpected console errors.
- Self-review: launcher fallbacks derive from the script/repository path rather than caller cwd, with environment overrides and CLI precedence; subprocesses use argument arrays and `sys.executable`; invalid config does not launch any command; test/e2e YAML and SQLite are isolated; per-run server processes are owned and cleaned; ports are dynamically allocated and checked on loopback; dynamic CSRF trust is exact-origin-only; README covers labels/keys, archives, Anything, purchases, shared tabs, future-account boundary, and trust limitations.
- At the original handoff, whole-change/controller acceptance was still pending. That status is superseded by the follow-up repository review linked above; this historical record does not claim production/deployment readiness.
