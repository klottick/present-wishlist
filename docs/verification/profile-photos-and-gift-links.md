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

Deployed locally on 2026-11-01 at `http://localhost:8080` using
`present-wishlist-local:photos-links-20261101`. The container is healthy and serves the
compiled photo editor and multi-link UI. The local Compose override selects this
image and retains the existing host port and data volume.

The original core tables were hashed before upgrading and checked afterward:
two gifts, one purchase mark, profile/event identities and all original core
values are unchanged. The one existing single URL became an ordered link.
The live family branding and seven configured names were checked through the
public APIs; a live phone-width browser check confirmed one person per row and
the profile-photo control. No sample gift or photo was added to live data.

Before startup migrations, the app was stopped briefly and SQLite's backup API
created a consistent private snapshot. The backup passed `PRAGMA integrity_check`.
The backup directory also contains the previous image identity and local config
files for recovery:

`/home/klottick/.local/state/present-wishlist/backups/20261101T161216Z-before-photos-links`

Family YAML, the local Compose override, database snapshots and secrets remain
outside git. Source changes are retained on `feature/profile-photos-links`;
nothing was pushed or merged into main.

The final complete `bash scripts/verify.sh` run passed after the isolated
Playwright retry: 163 backend tests, 102 frontend tests, both browser viewport
projects (13.2s), dependency checks, lint and build. The final linux/amd64 image
also passed the container persistence/CSRF/privacy smoke. No findings remain
unfixed; external preview coverage remains best effort.

## Amazon image regression fix — 2026-11-01

A configured Amazon product returned a page larger than 1 MiB and omitted
Open Graph image metadata. The previous fetcher discarded the whole page when
it exceeded the body limit, and the extractor did not recognize the named
product image. This reproduced the user's missing-image report.

The fetcher now returns only the first 1 MiB for parsing, including when the
advertised Content-Length is larger. It never downloads beyond that bound.
The parser retains Open Graph priority and falls back to explicitly named
product images (`landingImage`, `imgBlkFront`, `ebooksImgBlkFront`), trying the
high-resolution attribute and then the normal source. Every candidate keeps
the existing public-address validation; arbitrary page images are not selected.

Regression tests were observed failing and then passing. All 167 backend tests
passed. The rebuilt linux/amd64 image passed the container persistence, CSRF,
privacy and preview fallback smoke. An independent read-only review approved
the narrow fix without Critical or Important findings; it additionally checked
truncated HTML parsing, including incomplete tags and script content. Its
optional suggestion to add another incomplete-tag fixture was not needed for
the validated fix.

Deployed image: `present-wishlist-local:amazon-images-20261101`. The affected
cached failure was cleared, and the existing live product card loaded a visible
image with natural dimensions 1134×1500 in the browser. The source URL and all
core data remained unchanged. No sample gift or photo was created.

The first deployment attempt automatically rolled back because its cache-refresh
command lacked the backend working directory. The corrected deployment and
cache refresh completed successfully. A fresh consistent database backup and
previous image/configuration are stored privately at:

`/home/klottick/.local/state/present-wishlist/backups/20261101T170322Z-before-amazon-image-fix`
