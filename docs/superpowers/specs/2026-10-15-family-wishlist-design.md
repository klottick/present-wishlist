# Family wishlist design

Date: 2026-10-15
Revision: YAML-managed members and events added following conversational approval.
Status: Approved by the user and implemented. Current review and verification
status is recorded in `docs/verification/repo-review-2026-10-16.md`.

## 1. Intent and success criteria

Build a phone-friendly web app that makes family gift giving easy. Family
members choose their name, maintain a wishlist, browse other people's lists,
and record purchases to help avoid unwanted duplicates without spoiling gifts.

The user explicitly prioritizes ease of use over authentication for the first
version, requests a React frontend and Django backend for flexibility, and
wants room for individual login accounts later. Hosting and access restrictions
are deferred.

The first version succeeds when:

- A family member can select their configured name without credentials.
- Available members and events come exclusively from a YAML configuration file.
- They can add, edit, and remove their own gift ideas.
- They can browse another person's wishlist and mark an item purchased.
- Everyone except the recipient can see the buyers of an item.
- A buyer can undo their own purchase mark, but not someone else's.
- Items optionally allow unlimited purchases by different family members.
- Each item is for one configured event or Anything; event views include Anything items.
- Refreshing the page preserves both shared data and the selected identity.
- Switching identities does not display data retained from the previous identity.

This is a trust-based app, not secure authentication: someone can deliberately
switch to another profile and see surprises. No claim of protection against
impersonation is made.

## 2. Scope

### Included

- Name picker and switch-person action, using YAML-managed family members.
- Authoritative YAML configuration for member names and available events.
- Birthday and Christmas as default configurable events, with extensible options.
- One optional event per item and event filtering that includes Anything items.
- One wishlist per family profile, represented by that profile's items.
- Required gift name; optional link, price, and notes.
- Owner-only wishlist editing and deletion, according to selected identity.
- Purchase marking, buyer names, and buyer-only undo.
- Per-item "Allow multiple purchases" toggle, off by default.
- Persistent shared storage and a responsive, accessible interface.
- Automated backend and frontend tests, plus an integrated browser smoke test.

### Excluded

- Real login screens, passwords, invitations, access restrictions, and deployment.
- Multiple independent family groups or in-app member/event administration.
- Calendar dates, event scheduling, annual instances, notifications, reservations,
  requested quantities, payments, gift delivery, image uploads, and automatic
  product-page extraction.
- Live push updates, purchase history after undo, and a separate shopping dashboard.

## 3. Architecture and boundaries

Use a single repository with independently organized applications:

- `frontend/`: React, TypeScript, and Vite; owns presentation and interaction.
- `backend/`: Django and Django REST Framework; owns the JSON API, validation,
  identity resolution, ownership rules, purchase rules, and persistence.
- SQLite for initial local development. Use Django models and migrations so a
  later move to PostgreSQL does not require a domain-model rewrite.

Use a development proxy for `/api/` so the browser interacts through one origin.
This is a local-development decision, not a production hosting decision.

Keep these responsibilities separate:

1. Identity resolution maps a request to its current family profile.
2. Wishlist operations manage item fields and enforce ownership.
3. Purchase operations enforce purchase limits and undo ownership.
4. Response serialization removes recipient-inappropriate purchase information.
5. A shared frontend API client handles JSON requests, CSRF, and errors.
6. Focused frontend features implement identity selection, lists, event filters,
   item forms, and purchase actions without duplicating backend rules.
7. Configuration loading validates YAML and synchronizes authoritative member
   and event definitions into persistent records without deleting history.

Use ordinary component state and a focused data-loading layer; do not introduce
a global application store merely for this small scope. Requests must support
discarding obsolete responses after identity or navigation changes.

## 4. Profiles now, individual accounts later

A family profile is a domain identity, distinct from an authentication account.
All wishlist and purchase relations point to profiles, never display names,
session keys, or usernames.

For this version:

- Selecting a profile stores its ID in a Django server-side session.
- Only active, YAML-configured profiles are selectable. An inactive selected
  profile is treated as a stale identity, never silently replaced with another.
- The API exposes the current profile, and React uses that response as the
  source of truth rather than a browser-stored member ID.
- One backend identity resolver supplies the current profile to domain operations.
- Selected identity is shared by tabs using the same browser session.
- Missing or stale selected identity produces a consistent identity-required
  response for wishlist and purchase operations, and the UI returns to the picker.

Reserve an optional one-to-one link from a family profile to
`settings.AUTH_USER_MODEL`. It remains unused by the name-picker flow. Future
account work can authenticate a Django user, resolve their linked profile,
disable unrestricted profile selection, and replace the picker UI without
reassigning gifts or purchases. Real authentication and that mode switch are
not implemented in this version.

Because identity selection is not authentication, do not assume DRF's standard
SessionAuthentication alone identifies a selected family profile. Enforce the
profile requirement through the shared identity boundary.

## 5. Authoritative YAML configuration

The configuration lives at `backend/config/family.yaml`. Its shape is:

```yaml
members:
  alex: Alex
  sam: Sam

events:
  birthday: Birthday
  christmas: Christmas
```

The sample names above illustrate the format, not real family data. The shipped
file starts with `members: {}` and the Birthday and Christmas event defaults.
The empty picker explains how to add names to this file; there is no in-app
add-member flow.

### Configuration contract

- `members` and `events` are required mappings from stable string keys to
  nonempty display labels. Empty mappings are valid.
- Keys use lowercase letters, numbers, hyphens, and underscores, begin with a
  letter, and are at most 80 characters. Keys are stable identity, not labels.
- Labels are trimmed, at most 80 characters, and unique within their mapping
  after case-folding. Member names and event labels may match across mappings.
- Reject malformed YAML, duplicate mapping keys, unknown top-level keys, invalid
  types, and invalid keys or labels with a useful configuration error.
- Use safe YAML parsing; configuration must not instantiate arbitrary objects.
- `anything` is a reserved event key and Anything is a reserved event label
  (case-insensitive after trimming).
  Anything is an intrinsic choice, not a record that can be removed from YAML.
- Birthday and Christmas are editable defaults, not hard-coded mandatory events.
  Events are labels only: Birthday does not store a person's birthday date,
  and Christmas does not imply scheduling or a year-specific event instance.

### Synchronization and lifecycle

- Validate the entire configuration before making any database changes.
- A dedicated Django configuration-sync command applies the configuration
  atomically. The supported backend startup workflow runs migrations, then
  synchronization, then starts the server. Invalid configuration prevents that
  workflow from starting the server.
- YAML edits apply after running the same startup workflow again; no hot reload
  or per-request file parsing is required. Document this restart workflow.
- Synchronization upserts records by stable configuration key. Label changes
  preserve profile/item/purchase relationships and future account links.
- Missing keys deactivate existing records rather than deleting them. Readding
  the same key reactivates its original record and relationships.
- Changing a key is a removal plus addition; document that renaming a label
  should change only the value, not the key.
- Inactive profiles disappear from name selection and wishlist browsing, but
  their items, purchase marks, and last configured names remain stored. Other
  people's lists still show their names for existing purchase marks.
- Inactive events disappear from new-event choices. Existing items retain their
  event and last configured label; owners may keep that assignment while editing
  other fields or change it to an active event or Anything.
- The API provides no member/event creation, editing, or deletion endpoints.
  The database stores synchronized identities and history, not independent
  configuration overrides.

## 6. Data model

### FamilyProfile

- Stable primary key.
- Unique stable configuration key.
- Display name: trimmed, required, maximum 80 characters, synchronized from YAML.
- Active flag, synchronized from whether the key is currently configured.
- Optional unique link to a Django user, nullable and unused initially.
- Creation timestamp.

### Event

- Stable primary key and unique stable configuration key.
- Display label: trimmed, required, maximum 80 characters, synchronized from YAML.
- Active flag, synchronized from whether the key is currently configured.
- Creation timestamp.

There is no Anything record. A null item event represents Anything.

### WishlistItem

- Stable primary key and owner profile foreign key.
- Name: trimmed, required, maximum 200 characters.
- Link: optional HTTP or HTTPS URL, maximum 2,000 characters.
- Price: optional display text, maximum 80 characters, allowing family-supplied
  currency notation such as "$25" without adding currency conversion.
- Notes: optional plain text, maximum 5,000 characters.
- `allow_multiple_purchases`: boolean, default false.
- Optional event foreign key, null by default (Anything). Event records are
  retained rather than deleted when removed from YAML.
- Creation and modification timestamps. Modification time reflects item-field
  changes only, never purchase activity.

### Purchase

- Stable primary key.
- Item foreign key and buyer profile foreign key.
- Creation timestamp, not needed in the recipient-facing representation.
- Unique database constraint on `(item, buyer)`.

There is no global purchased boolean on an item. Availability is derived from
the item's repeat-purchase setting and its active purchase records.

## 7. Wishlist and event behavior

- The current profile can create items only on its own list.
- Only an item's owner may edit or delete it.
- Item creation and editing expose all ordinary item fields, including the
  repeat-purchase toggle, but never purchase fields.
- Owners can edit or delete an item regardless of purchase state. Deleting an
  item removes its purchase records without warnings that disclose purchases.
- A deletion confirmation is always shown, using the same wording regardless
  of purchase state.
- Lists use creation order, newest first. The profile directory uses name order.
  Neither ordering nor directory metadata depends on purchases.
- Owner-visible counts, if displayed, count wishlist items only.
- Every item has one event or Anything; assigning multiple events is out of scope.
- Owners can select any active event or Anything. An inactive current event is
  shown as no longer configured and can be retained, but cannot be newly assigned.
- Lists default to All events, showing all items including inactive-event items.
- The event filter offers active events plus Anything. Selecting a specific
  active event shows that event's items together with Anything items. Selecting
  Anything alone shows only items with no assigned event.
- Filtering is available on both the owner's list and other family wishlists;
  purchase visibility rules are unchanged.
- Changing an item's event preserves all existing purchase marks. Marks belong
  to the item, not to an event or calendar occurrence; changing events does not
  reset purchases.

## 8. Purchase rules

### Rules shared by all items

- A profile cannot mark its own item purchased.
- Each buyer has at most one active mark per item; no quantity entry is provided.
- The buyer can undo only their own mark. Undo removes that purchase record.
- Repeating an already-successful own mark is idempotent and does not create
  a second record. Repeating undo is also idempotent for that buyer.
- Other family members can view buyer names but cannot remove those marks.

### Ordinary items: repeat purchases disabled

- With no existing purchase, another profile may mark the item purchased.
- Once any purchase exists, no additional buyer may mark it purchased.
- If two buyers submit concurrently, only one succeeds. The other receives
  a conflict response and the frontend refreshes the item.

### Repeatable items: repeat purchases enabled

- Any nonrecipient profile without an existing own mark may mark it purchased,
  even when other buyers already have marks.
- Nonrecipients see all buyer names, and the item remains available to others.
- "Unlimited" means no cross-buyer limit, not multiple marks by one buyer.

### Changing the toggle

- Changing the setting always preserves existing purchase records.
- Turning repeat purchases off prevents new marks whenever any purchase exists.
  Multiple marks created while the option was on remain valid until their
  respective buyers undo them.
- The owner's save response and validation do not depend on purchase state.
  In particular, changing the toggle cannot reveal that several buyers exist.

### Integrity and concurrency

Purchase creation, undo, and repeatability changes must use a shared atomic
mutation strategy so they cannot interleave into invalid new purchases. For
SQLite, acquire the write lock before reading purchase state, such as through
a transaction that first performs a database-side no-op update on the item
without overwriting a previously read value or changing modification timestamps.
A transaction and a read alone, or
`select_for_update()` alone on SQLite, is insufficient.

The database uniqueness constraint prevents duplicate marks by the same buyer.
The transaction boundary enforces the cross-buyer rule for ordinary items.
Bounded lock retries or a retryable error must leave no partial writes; a
conflicting buyer gets the ordinary already-purchased response after rechecking.

## 9. Surprise protection

The backend must omit purchase information entirely from recipient-facing item
responses; hiding it in React is insufficient.

- Owner item representations have no purchase collection, buyer names, purchase
  count, purchased flag, or availability derived from purchases.
- Nonowner representations include buyer summaries and whether the selected
  profile can purchase or undo its own mark.
- Apply this rule to list, detail, create, and update responses, not only the
  main wishlist screen.
- Direct purchase attempts by recipients are denied without revealing whether
  purchases exist.
- Item edit/delete outcomes, timestamps, ordering, and toggle validation do not
  change based on purchases in a way visible to the recipient.
- Do not persist purchase-bearing data in browser storage or a service worker.
- Identity-sensitive API responses use `Cache-Control: no-store`.
- On identity switching, immediately hide old wishlist data, cancel or discard
  in-flight requests, and fetch data for the confirmed new identity.
- On window focus, revalidate current identity before displaying retained
  identity-sensitive data; shared-browser tabs are not independent identities.

These are protections against accidental spoilers, not a security boundary
against someone switching names or inspecting a previously viewed page.

## 10. JSON API contract

Use `/api/` endpoints with a consistent JSON error format containing a stable
error code, a readable message, and field errors where applicable.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/session/` | Current profile or null; bootstrap CSRF cookie |
| PUT | `/api/session/` | Select an existing profile by ID |
| DELETE | `/api/session/` | Clear selected identity |
| GET | `/api/profiles/` | List active YAML-managed profiles without purchase metadata |
| GET | `/api/events/` | List active YAML-managed events |
| GET | `/api/profiles/{id}/items/` | Read an active profile's wishlist, optionally filtered by event |
| POST | `/api/items/` | Add an item for the selected profile |
| GET | `/api/items/{id}/` | Read one item using viewer-specific serialization |
| PATCH | `/api/items/{id}/` | Edit an owned item |
| DELETE | `/api/items/{id}/` | Delete an owned item |
| PUT | `/api/items/{id}/purchase/` | Mark purchased as the selected profile |
| DELETE | `/api/items/{id}/purchase/` | Undo the selected profile's own mark |

Clients cannot assign ownership, buyer identity, or purchase state through item
payloads. Unknown or read-only mutation fields are rejected rather than trusted.

Use `event_id` for item assignment: null means Anything. Responses include
the item's event ID, label, and active status, or null for Anything. Item create
and update responses follow the same recipient-specific purchase omission rules.

The list endpoint accepts no event parameter for All events,
`?event=anything` for only Anything items, or `?event=<configuration-key>` for
an active event plus Anything items. Unknown or inactive event filters return
400. Direct browsing of an inactive profile or its items returns 404 to other
profiles; archived buyer names on active profiles' items remain visible.

Session bootstrap, profile/event listing, and profile selection are available
without a selected profile; other operations require one. Use 400 for invalid
input, 403 for missing selected identity or forbidden operations (distinguished
by stable error codes), 404 for missing resources, and 409 for a conflicting
purchase. Own-repeat purchase and own-repeat undo are successful no-ops.

Enable CSRF validation on every state-changing endpoint, including profile
selection. React sends Django's CSRF token and session cookie.
Do not rely on DRF's authenticated-session-only CSRF behavior for this anonymous
name-picker session flow.

## 11. User interface and data flow

### Name picker

Large buttons for active configured names. With no profiles, show a friendly
setup message pointing to `backend/config/family.yaml` and explaining the restart
workflow. No in-app name editing or adding is available. The header clearly
shows the selected person and offers "Switch person."

### Main navigation

Two primary destinations: "My wishlist" and "Family wishlists." Selecting a
family member opens that person's list. If it is the current profile, use the
owner presentation, not a purchase-enabled version.

Both wishlist views have an event filter. Label a selected event view so it is
clear that it also includes Anything items. All events is the initial selection.
Changing the person or selected identity resets the filter to All events.

### Wishlist items and forms

Show gift name, optional price, notes, and an external link when provided.
Show the event label or Anything on each item. Item forms include an event
selector defaulting to Anything and populated from the configured options.
An inactive existing event remains visible as a retainable current choice.
Owners get add/edit/delete controls and the repeat-purchase toggle. Other
profiles get purchase controls and buyer names. A repeatable item visibly says
that multiple purchases are welcome, without exposing purchases to its owner.

Keep forms short and usable on phones. Use labeled fields, keyboard-accessible
controls, visible focus, readable contrast, and text status indicators rather
than color alone. Render notes as text, not HTML. External links open safely.

### Refresh and failure behavior

- Fetch on navigation, after relevant mutations, and on window focus.
- No background live-update promise is made; conflicts are handled by the API.
- Show loading and empty states, and readable error messages with retry actions.
- Disable duplicate submissions while a mutation is pending.
- Preserve unsaved form values after failed saves.
- Do not show optimistic purchase success before backend confirmation.
- A purchase conflict explains that someone already bought the item and refreshes
  its buyer information for the nonrecipient.
- Switching identity closes forms and removes old identity-specific view state.

## 12. Verification strategy

### Backend

- YAML validation, duplicate keys/labels, safe parsing, reserved Anything values,
  and atomic failure without partial synchronization.
- Config synchronization idempotency, label renames preserving identity and
  login links, removal/reactivation preserving history, and empty member/event lists.
- Session selection and clearing, persistence, stale/inactive/missing profiles,
  and inability to select an inactive profile.
- Read-only profile/event endpoints and absence of in-app configuration mutations.
- Wishlist create/read/update/delete, optional fields, invalid links, and attempts
  to mutate someone else's items or inject owner/buyer fields.
- Event defaults, assignment validation, retaining inactive event assignments,
  and event changes preserving purchase marks.
- All events, Anything-only, and specific-event-plus-Anything filters; invalid
  filters; inactive-profile browsing restrictions; no purchase-dependent filtering.
- Purchase information absent from every owner-facing response, including
  after editing repeatability and when deleting purchased items.
- Nonrecipients see buyer names; recipients cannot purchase their own items.
- Single-buyer conflicts, same-buyer idempotency, repeatable multi-buyer success,
  own-only undo, and repeatability changes preserving prior marks.
- A real concurrent test against file-backed SQLite uses separate connections
  to verify that simultaneous ordinary-item purchases cannot both succeed.
- CSRF rejection on all writes, including name selection before a
  profile is selected, and success with a valid CSRF token.
- Cache headers and responses that do not leak purchases through metadata.

### Frontend

- Configured-name selection, empty-configuration guidance, identity switching,
  and stale request disposal.
- Wishlist browsing, item form validation, editing, and deletion confirmation.
- Event selector defaulting to Anything, event filtering that includes Anything,
  inactive current event presentation, and no member/event administration controls.
- Correct owner/nonowner controls and omission of owner purchase information.
- Single-purchase and repeatable purchase controls, own undo, conflicts, and errors.
- Loading/empty/retry states, preserved input on save failure, and accessible labels.
- Shared-session identity revalidation on focus.

### Integrated smoke test

Using the real frontend and backend with an isolated test configuration: configure
three profiles and the default events, create ordinary and repeatable gifts
assigned to Birthday, Christmas, and Anything, and verify event filtering.
Purchase as different profiles, undo one mark, refresh to verify persistence,
and return to the recipient to confirm no purchase details are present. Rename
a configured member label and remove an event, rerun the startup workflow, and
confirm that relationships and existing assignments survive. Check both a
phone-sized viewport and a desktop viewport. Do not modify real family data
as part of smoke testing.

## 13. Delivery boundary

This document approves a design only after the user's written-spec review.
Next, prepare a detailed implementation plan, obtain its review and an execution
method choice, then implement. Do not scaffold applications or install product
dependencies as part of this specification stage.
