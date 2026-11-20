# Profile Photos and Gift Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add profile photos, single-row people lists, multiple gift links, and automatic preview cards to the running wishlist.

**Architecture:** Extend the Django domain models and API, preserving legacy single-link callers. Store small normalized avatars and cached metadata in SQLite. Extend existing React features and deploy a tested local container with a database backup.

**Tech Stack:** Django, DRF, Pillow, Python standard-library HTTP/TLS, React, TypeScript, Vite, Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-11-01-profile-photos-and-gift-links-design.md`

## Global Constraints

- Preserve selected-profile ownership, CSRF enforcement, recipient-hidden purchase information, existing gifts, and local family configuration.
- Accept JPEG/PNG/WebP avatars up to 5 MiB; normalize to a 256px square JPEG and discard original metadata.
- Support at most ten ordered HTTP/HTTPS links per gift, each at most 2,000 characters; reject duplicates after trimming.
- Preview retrieval must not block gift saving or hold a database write transaction during network operations.
- Successful previews cache for seven days; failures for one hour; maximum three redirects, 1 MiB HTML, eight-second overall deadline.
- Keep the existing styling, SQLite persistence, single-container runtime, and current port.

## Review Focus

- Switching identities during photo/preview requests must not apply stale results; covered in Task 3.
- Malformed and excessive-pixel images must preserve the saved photo; covered in Task 1.
- Redirects, mixed public/private DNS answers, and TLS connection pinning must not reach internal services; covered in Task 2.
- Editing an old single-link gift must preserve purchases and migrate its link; covered in Task 1.
- Unreachable previews and broken thumbnails must leave usable links at phone widths; covered in Tasks 2 and 3.

### Task 1: Persistent photos and ordered gift links

**Files:** Modify `backend/wishlist/models.py`, `serialization.py`, `selectors.py`, `services/items.py`, `api/urls.py`, `api/middleware.py`, `backend/requirements.in`, `requirements.txt`. Create `services/avatars.py`, `api/avatars.py`, a migration, `tests/test_avatars.py`, `tests/test_links.py`.

**Interfaces:** Profiles add nullable `avatar_url`; avatar PUT/DELETE at `/api/profile/avatar/` returns Profile. Public normalized JPEG GET at `/api/profiles/<id>/avatar/`. Items add `links: [{id, url}]`; writes accept `links: string[]` or legacy `link: string`, never both. Preserve IDs for unchanged URLs.

- [x] Write API tests asserting upload/replace/remove, JPEG dimensions/metadata, invalid/animated/oversized images, active-profile boundaries, CSRF, and public image reads.
- [x] Write ordered-link tests asserting trimming, zero/ten/eleven links, duplicates, per-row errors, legacy writes, atomic validation, owner-only editing, stable IDs, and purchase preservation. Add a migration test using historical models to verify the old URL becomes the first link.
- [x] Run `.venv/bin/python backend/manage.py test wishlist.tests.test_avatars wishlist.tests.test_links --settings=project.test_settings` and confirm failure because endpoints and links are absent.
- [x] Add avatar fields and WishlistItemLink, migration, normalization and API serving, link validation/replacement and response prefetching; add Pillow with a verified compatible pin.
- [x] Run the targeted tests and existing catalog/identity/item/purchase suites; update exact profile-shape expectations for additive avatar_url.
- [x] Commit the tested persistent photo/link implementation.

### Task 2: Safe, cached metadata extraction

**Files:** Create `services/public_http.py`, `services/previews.py`, `api/previews.py`, `tests/test_previews.py`. Modify `models.py`, `api/urls.py`; create cache migration.

**Interfaces:** `fetch_html(url: str) -> tuple[str, str]` returns final URL and HTML, with `UnsafeURL`/`FetchError` failures. `preview_for_link(link) -> dict` returns `{title, description, image_url, site_name, url, status}`. POST `/api/item-links/<id>/preview/` requires selected identity and an active owner.

- [x] Write mocked-network tests for OG/HTML metadata extraction, relative URLs, bounded text, cached successes/failures, missing identity, archived owners, and inaccessible sites.
- [x] Write transport tests rejecting unsafe schemes, credentials, nonstandard ports, private/mixed DNS, redirect-to-private, oversized responses; verify pinned address, original Host, verified TLS name, and time budget behavior.
- [x] Run `.venv/bin/python backend/manage.py test wishlist.tests.test_previews --settings=project.test_settings` and observe missing-feature failures.
- [x] Implement validated DNS-pinned connections, bounded reads/redirects/deadlines, HTML parsing, public thumbnail validation, persistent cache, concurrent request collapse, and endpoint without network calls inside write transactions.
- [x] Run the targeted suite and backend suite; commit.

### Task 3: People rows, photo editor, multi-link forms and cards

**Files:** Modify `frontend/src/api/{types,client}.ts`, `features/identity/{IdentityProvider,NamePicker}.tsx`, `features/items/ItemForm.tsx`, `features/wishlists/{GiftCard,WishlistPage}.tsx`, `components/AppHeader.tsx`, `App.tsx`, `styles.css`, relevant tests and fixtures. Create `components/Avatar.tsx`, `features/identity/ProfilePhotoEditor.tsx`, `features/wishlists/LinkPreview.tsx` and focused tests.

**Interfaces:** Upload client uses FormData and CSRF without forcing JSON Content-Type. Identity context supplies `updateProfile(profile, expectedGeneration)` to refresh local photo/catalog without resetting draft forms. ItemInput uses `links: string[]`, retaining optional legacy input for compatibility. Preview requests deduplicate and abort/ignore obsolete identities.

- [x] Write tests exercising photo selection/save/remove/errors, stale response rejection, multipart headers, Add another link/Remove, zero links, editing existing URLs, inline errors, preview loading/fallback and safe destination rendering.
- [x] Run `npm --prefix frontend test` and observe failures for missing UI behavior.
- [x] Read Impeccable craft-floor, inspect the existing rendered UI, then implement shared avatars, one-row people selectors, inline photo editor, ordered inputs and asynchronous metadata cards.
- [x] Run `npm --prefix frontend test`, `npm --prefix frontend run lint`, and `npm --prefix frontend run build`; adapt existing form tests to links arrays and add deterministic preview endpoint fixtures.
- [x] Commit the tested UI changes.

### Task 4: Integrated verification, documentation and deployment

**Files:** Extend `frontend/e2e/family-wishlist.spec.ts` or create a focused spec; update `README.md`, `docs/configuration.md`, and verification evidence. Update the local (untracked) Compose override only for selecting the built image.

**Interfaces:** A disposable SQLite database and fixture family config support all browser writes. Local image uses existing Dockerfile and production entrypoint. Live deployment retains the original volume and config.

- [x] Add and run an integrated browser flow for one-row people selection, photo upload/removal, multi-link save/edit, preview fallback, and purchase behavior at desktop/phone widths; observe failures before finishing any missing integration code.
- [x] Run full backend/frontend verification, lint/build, migration drift check, and build a local Docker image. Smoke-test startup/migration and image persistence against a disposable volume.
- [x] Run one independent whole-change code review; fix important findings with regression tests and rerun the affected checks plus full suite.
- [x] Document behavior and actual verification results; commit completed source changes. Leave the feature branch reviewable and do not push or merge.
- [x] Back up live SQLite consistently, record current image, point the local Compose override at the tested image, recreate with existing volume, and verify health, family names, existing item/link counts, and image endpoints without adding live sample data.
- [x] Record deployment and backup locations, then report the live URL and material preview limitations.
