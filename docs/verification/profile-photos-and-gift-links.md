# Profile photos and gift links verification

Date: 2026-11-01
Branch: `feature/profile-photos-links`

## Scope

One person per row in name selection and family browsing; uploaded profile
photos; up to ten ordered gift links; automatic cached metadata cards with
clickable fallbacks. Existing gifts, identities, events and purchases survive
migration. Photos reside in SQLite and are included in database backups.

## Verification performed

- Baseline: 140 backend tests and 92 frontend tests passed.
- New photo/link API tests were run failing before implementation, then passing.
- Migration tests exercise a database at migration 0002 and verify preservation
  of the existing item ID, single URL, and purchase ID after upgrading.
- Preview tests cover extraction, cached success/failure, private/mixed DNS,
  redirect validation, pinned numeric socket destinations, original TLS hostname,
  response bounds, and deadline cancellation after HTTP socket detachment.
- Frontend tests exercise multipart CSRF, photo failure/replacement/removal,
  late identity responses, ordered link editing, error row mapping and card
  fallback behavior.
- Before independent review, `bash scripts/verify.sh` passed: 159 backend tests, 101 frontend tests,
  Django checks, no migration drift, dependency check, lint, production build,
  and desktop (1280×800) / phone (390×844) browser workflows.
- Browser workflows upload a real image, reload it, remove it, save/edit/reload
  multiple URLs, and retain the existing purchase/privacy/session race coverage.
- Manual rendered checks at widths 1280, 390 and 320 showed one person per row,
  working inline photo controls and no horizontal overflow. Real public URLs
  produced titles/descriptions and a thumbnail; failed images remain optional.
- A local image built successfully. The expanded native linux/amd64 container
  smoke passed: compiled assets, CSRF, selected identities, recipient privacy,
  photos and links across replacement/restart, blocked-private-URL fallback,
  fail-closed startup and clean shutdown. No arm64 build/run is claimed.

- Post-review checks passed: 163 backend tests, 102 frontend tests, Django and
  migration checks, dependency consistency, lint and production build. One desktop
  Playwright run timed out; its owned fixture server was cleaned up and both
  desktop/phone projects passed on rerun without application changes (13.7s).
- The final rebuilt linux/amd64 image passed the expanded photo/link persistence
  and fallback smoke test. Its HTTP/TLS fetcher also retrieved a real public page.

## Independent review

A fresh reviewer inspected the complete change. All four findings were fixed:

- Limit preview work to two server slots; duplicate and over-capacity requests
  immediately return useful fallback metadata. Limit browser work to two queued
  fetches, canceling queued requests when no component needs them.
- Discard malformed thumbnail metadata while preserving and caching valid text.
- Publish the TLS socket before its handshake so the deadline can interrupt it.
- Prune the oldest cache rows above 512 entries.

Regression tests were run failing first, then passing. The thumbnail, deadline,
and cache issues were addressed as gaps in the approved fallback, time-bound,
and storage-bound contracts. No review findings remain deferred.

Review boundaries: direct thumbnail requests remain the approved approach;
browsers follow image-host redirects according to their own networking rules.
Live deployment verification is recorded separately below. Backend test discovery
uses the explicit `wishlist` label because root-level unlabeled discovery finds
zero tests.

## Deployment

Pending final review fixes and a fresh verification run. The running installation
has two gifts, one purchase mark and one existing single URL; these must remain
unchanged after migration. Local family YAML and secrets stay outside git.
