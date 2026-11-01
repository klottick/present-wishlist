# Profile photos and multiple gift links

Date: 2026-11-01
Status: Approved by the user on 2026-11-01; implementation in progress.

## Intent and confirmed scope

Make the Lottick family wishlist easier to recognize and shop from. The user
confirmed one person per row, personal photo uploads, multiple shopping links
per gift, and compact preview cards with an ordinary-link fallback.

Keep the existing React/TypeScript frontend, Django API, SQLite database,
green visual styling, and trust-based selection of YAML-managed profiles.
Kadan, Samantha, Nina, Adam, Lydia, Winnie, and Antrim remain configured locally;
their names and photos are not shipped as demo data.

## Approaches

The user accepted the proposed preview-card experience with a plain-link
fallback. The implementation choices below are recommendations, not additional
requirements attributed to the user.

1. **Recommended: self-hosted uploads and metadata previews.** Store small,
   processed profile photos with application data and extract public page
   metadata on demand. This fits the existing single-container deployment and
   needs no paid service, API key, or third-party account.
2. **External preview provider.** A hosted API could provide metadata extraction
   and broader site support, but adds credentials, service dependence, and
   potentially recurring costs. Defer unless real-world link coverage warrants it.
3. **Manual link cards.** Store only URLs and manually entered titles/images.
   This is simpler operationally but does not provide the requested automatic
   preview experience. Keep ordinary URLs as the fallback instead.

## User experience

Both the initial name picker and the family wishlist browser show one person
per row at all screen sizes. Each row contains a small round photo or initials
and the existing name/action. Preserve alphabetical ordering and keyboard
navigation. Retain wishlist navigation and the existing gift-card grid.

Add a small "Profile photo" control to My wishlist. It expands inline to a
file input, selected-file preview, Save photo, Remove photo, and Cancel actions.
People can upload, replace, or remove the currently selected person's photo;
other people's wishlist views have no photo editing controls. Successful changes
update the header, current wishlist, and cached profile catalog. Failed changes
retain the saved photo and explain the problem beside the control.

The gift form shows optional link inputs with Add another link and per-row
Remove actions. Support up to ten links per gift, each at most 2,000 characters.
Start with one blank input for a new gift. Trim values and discard blank rows.
Preserve entered order; reject duplicates after trimming and identify invalid
rows inline. Deleting all links is valid. Saving a gift never waits for preview
fetches. Existing single links appear as the first row when editing.

Each saved gift renders its links as compact cards: optional thumbnail, title,
short description, and readable website hostname. Open the destination in a
new tab. While loading, or when metadata is missing or unavailable, the card
remains a useful clickable hostname/URL. Previews never prevent gift editing,
purchase coordination, or opening a link. Do not scrape prices, run page
JavaScript, embed retailer pages, or replace the user-entered gift name.

## Profile photo storage and API

Implementation recommendation: store the normalized photo bytes and a version
token on FamilyProfile. At seven family members this avoids a separate media
volume and keeps existing SQLite backups sufficient. Do not include image bytes
in profile JSON; add a nullable, versioned same-origin avatar_url instead.

Accept JPEG, PNG, and WebP uploads up to 5 MiB. Use Pillow to decode the actual
image, reject malformed, animated, unsupported, or excessive-pixel inputs, apply
EXIF orientation, center-crop to a 256px square, and re-encode as a bounded JPEG.
Remove original metadata and discard original upload bytes. Transparent inputs
receive a neutral background. SVG is unsupported. Validate before replacing the
saved photo, with bounded request and decoded-image sizes.

Use PUT and DELETE /api/profile/avatar/ for the selected active profile, with
the existing identity and CSRF protections. PUT accepts multipart form data and
returns the updated serialized profile; DELETE clears it and returns that
profile. The API client must let the browser set multipart Content-Type.

GET /api/profiles/<id>/avatar/?v=<version> serves only normalized image bytes for
active profiles, including before identity selection because the name picker
needs them. Use explicit image/jpeg, nosniff, a version-aware ETag, and a finite
cache lifetime. Missing/deactivated avatars return 404 and initials render.
Do not expose filesystem paths or arbitrary uploaded files.

## Multiple links and compatibility

Add an ordered WishlistItemLink model with item foreign key, URL, and position.
Migrate each existing nonblank WishlistItem.link into its first related link;
preserve items, owner identities, events, purchases, and all existing IDs.

Extend item responses with links: an ordered array of {id, url}. The legacy link
response remains the first URL, or an empty string. New writes use links as an
array of URL strings. Accept legacy link writes as replacement of the entire
list with zero or one URL; reject requests containing both link and links.
Keep the legacy model field synchronized with the first URL for compatibility.

Validate all link changes before saving. Replace link relationships atomically
with the gift update; preserve existing link IDs for unchanged URLs. No network
calls occur inside database write transactions. Ownership and recipient-hidden
purchase serialization continue to apply unchanged.

## Preview extraction and persistence

Use a bounded, shared URL metadata cache in SQLite, keyed by the submitted URL.
Cache title, description, validated thumbnail URL, last attempt, and outcome.
Successful metadata remains fresh for seven days; failed/unsupported results
remain fresh for one hour. Clip text lengths and render as text, never HTML.
Use Open Graph title, description, and image with HTML title/meta-description
fallbacks. Resolve relative metadata URLs against the final page URL.

POST /api/item-links/<id>/preview/ requires an active selected profile and a
link on an active owner's gift. It returns cached data or performs a bounded
fetch. It accepts no arbitrary fetch URL from the request body. Return a normal
fallback result for blocked, inaccessible, or unsupported websites. The client
requests previews asynchronously after cards render, deduplicates requests,
and discards obsolete results after unmount, editing, or identity changes.

Fetch only HTTP/HTTPS pages on standard ports. Reject credentials and nonpublic
IP addresses, including loopback, private, link-local, multicast, and reserved
ranges. Resolve and validate every DNS answer and redirect; connect to the
validated address while preserving Host and TLS certificate verification so DNS
rebinding cannot bypass validation. Disable environment proxies. Allow at most
three redirects, 1 MiB of HTML, and an eight-second overall fetch deadline with
shorter socket timeouts. Do not execute scripts, forward user cookies, or log
URL query strings. Cache failures and collapse concurrent fetches in the
single-process server to limit repeated work.

Thumbnail URLs must pass the same public-address and scheme checks. Initially
load validated public thumbnail URLs directly in the browser with lazy loading
and no-referrer; hide broken images. This means a browser may contact the source
image host when displaying a preview. Do not introduce an arbitrary image proxy.
Thumbnail loading is optional; the title and destination always remain usable.

## Delivery and verification

Add migrations and update locked backend dependencies for Pillow. Keep local
family configuration, secrets, existing volume contents, and unrelated working
tree changes intact. Document photo limits, multiple links, best-effort previews,
outbound metadata requests, and the existing backup process.

Verify migration of existing single links; multi-link validation, ordering,
ownership and legacy writes; image decoding, limits, replacement and removal;
preview cache behavior, redirects, address validation, TLS/Host handling,
bounded responses, and failure fallbacks. Use mocked network responses in tests,
not live retailer calls. Check frontend form actions, upload errors, preview
states, and identity-switch request isolation. Run the backend suite, frontend
tests, lint, production build, and a browser flow at desktop and phone widths.

Build and smoke-test a local image against a disposable database first. Before
applying migrations to the running installation, make a consistent SQLite
backup and retain the current image for recovery. Deploy the tested local image
on the current port with the existing data volume; verify real configuration,
existing gifts, healthy startup, photo persistence, and migrated links. Avoid
creating sample gifts or photos in the family's live database.

## Decisions left to implementation

Choose exact component boundaries, model/cache field names, dependency pin
versions, CSS measurements, and internal fetch abstractions. Preserve existing
styling and accessible controls. No new authentication, user creation, cloud
storage, background queue, paid preview service, gift-image uploads, or live
price/availability tracking are included.
