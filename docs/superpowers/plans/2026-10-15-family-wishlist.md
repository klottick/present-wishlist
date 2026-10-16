# Family Wishlist Implementation Plan

This is the historical implementation plan. All twelve tasks were executed;
its original workspace and execution prerequisites describe the pre-Git project.
For the application review and follow-up fixes, see
[the review report](../../verification/repo-review-2026-10-16.md) rather than
redispatching these tasks. The [later Docker release evidence](../../verification/docker-release.md)
records container distribution and subsequent verification.

> **Historical execution instructions:** The original workflow used
> `subagent-driven-development` or `executing-plans` and task checkboxes. Those
> instructions and the pre-Git assumptions below are retained as planning history,
> not current setup requirements or authorization to rerun completed tasks.

**Goal:** Build the approved family wishlist with YAML-defined people/events, easy identity selection, private purchase information, and optional repeat purchases.

**Architecture:** A React/TypeScript SPA talks to a Django REST Framework API through a local Vite proxy. Django sessions hold the selected family profile, independent of a future authentication account. Django persists synchronized configuration, gifts, and purchase records in SQLite; a dedicated configuration-sync command runs in the backend startup workflow.

**Tech Stack:** Python 3.14; Django 5.2 LTS (at least 5.2.8 for Python 3.14); Django REST Framework; PyYAML; SQLite; Node 24; React 19; TypeScript; Vite 8; Vitest 5; React Testing Library; Playwright Test; standard CSS.

**Spec:** `docs/superpowers/specs/2026-10-15-family-wishlist-design.md` (user approved).

## Global Constraints

- "The configuration lives at `backend/config/family.yaml`."
- "Available members and events come exclusively from a YAML configuration file."
- "Keys use lowercase letters, numbers, hyphens, and underscores, begin with a letter, and are at most 80 characters."
- "Labels are trimmed, at most 80 characters, and unique within their mapping after case-folding."
- "There is no Anything record. A null item event represents Anything."
- "Each buyer has at most one active mark per item; no quantity entry is provided."
- "Changing the setting always preserves existing purchase records."
- "The backend must omit purchase information entirely from recipient-facing item responses; hiding it in React is insufficient."
- "Enable CSRF validation on every state-changing endpoint, including profile selection."
- "This is a trust-based app, not secure authentication."
- Implement no credentials, deployment, calendar dates, yearly event instances, live push updates, or in-app member/event editing.
- Name/link/price/notes limits are respectively 200/2,000/80/5,000 characters. Link schemes are HTTP/HTTPS only; price is display text.
- Run TDD per behavior: write the test, observe the intended failure, implement only that behavior, then rerun. Infrastructure can be installed to run tests; no untested domain implementation first.
- This workspace currently has documentation only and no Git repository. Preserve existing files. Do not initialize Git just to satisfy checkpoint steps. If Git is available at execution time, stage only each task's listed files and commit; otherwise record the verified checkpoint in this plan.
- Execution and dependency installation begin only after the user reviews this plan and chooses an execution approach. Isolation setup belongs to execution, not planning.

## Review Focus

1. A YAML label becomes a boolean/date/number, contains a duplicate key, or uses a reserved Anything label: reject clearly before changing stored configuration (Task 2).
2. A removed member is an existing buyer or has a future login link: archive/reactivate without losing marks, gifts, names, IDs, or account links (Tasks 2–3).
3. An archived event is retained while an owner edits another field: permit retention but reject assigning that event to a different item (Task 5).
4. A shared browser tab changes identity while another tab has an old request/form: hide old content, discard obsolete responses, revalidate on focus, and do not submit a stale form (Task 8).
5. A single-purchase item is bought concurrently or repeatability changes during a purchase: serialize mutations, preserve valid existing marks, and never leak state to the owner (Tasks 5–6).

---

## File structure and responsibilities

All files below are new except the approved spec and this plan. Create Python package `__init__.py` files alongside their packages.

| Paths | Responsibility |
| --- | --- |
| `backend/requirements.in`, `backend/requirements.txt` | Direct dependency ranges and exact resolved runtime dependencies |
| `backend/manage.py`, `backend/project/{settings,test_settings,urls,wsgi,asgi}.py` | Django runtime, environment settings, file-backed test database, root URLs |
| `backend/wishlist/{apps,models}.py`, `backend/wishlist/migrations/0001_initial.py` | Four domain models and database constraints |
| `backend/wishlist/configuration/{loader,sync}.py` | Pure safe YAML validation; atomic database synchronization |
| `backend/wishlist/management/commands/sync_family_config.py` | Explicit sync command with `--config` path |
| `backend/config/family.yaml` | Authoritative editable configuration, initially empty members/default events |
| `backend/wishlist/{identity,errors,selectors,serialization}.py` | Current profile, domain failures, read queries, viewer-specific item representations |
| `backend/wishlist/services/{items,purchases}.py` | Transactional item mutations and purchase operations |
| `backend/wishlist/api/{base,urls,session,catalog,items,purchases}.py` | CSRF-protected JSON endpoints and consistent responses |
| `backend/wishlist/tests/{helpers,test_models,test_configuration,test_sync,test_identity,test_catalog,test_item_reads,test_item_writes,test_purchases,test_concurrency,test_startup}.py` | Django regression and integration tests |
| `scripts/dev_backend.py`, `scripts/verify.sh` | Migrate/sync/serve workflow and repeatable complete checks |
| `frontend/{package.json,package-lock.json,index.html,tsconfig.json,tsconfig.app.json,tsconfig.node.json,vite.config.ts,eslint.config.js}` | Frontend toolchain, linting, proxy, build, tests |
| `frontend/src/{main.tsx,App.tsx,styles.css}` | Application entry, page composition, responsive design |
| `frontend/src/api/{types,client}.ts` | Shared API contract and fetch/CSRF/error handling |
| `frontend/src/features/identity/{IdentityProvider,NamePicker}.tsx` | Session lifecycle, identity generations, name selection |
| `frontend/src/features/wishlists/{WishlistPage,GiftCard,EventFilter,PurchaseControls}.tsx` | List loading, filtering, gift display, purchase interactions |
| `frontend/src/features/wishlists/useWishlist.ts` | Abortable identity-scoped list loading and refresh |
| `frontend/src/features/items/{ItemForm,DeleteItemDialog}.tsx` | Owned-item mutations and accessible forms |
| `frontend/src/components/{AsyncState,AppHeader}.tsx` | Reusable loading/error UI and current-person header |
| `frontend/src/test/{setup,fixtures}.ts`, adjacent `*.test.ts(x)` | jsdom setup, typed fixtures, feature tests |
| `frontend/playwright.config.ts`, `frontend/e2e/{family-wishlist.spec.ts,server.py,fixtures.yaml}` | Isolated real-server browser verification |
| `.gitignore`, `README.md`, `docs/verification/family-wishlist.md` | Local artifact exclusions, setup/configuration guide, actual verification evidence |

## Shared implementation decisions

### Backend dependencies and commands

Use `Django>=5.2.8,<5.3`, `djangorestframework>=3.16,<4`, and `PyYAML>=6,<7`. Resolve compatible current patches during Task 1, run `pip check`, and record exact versions in `backend/requirements.txt`. Do not add pytest, a production server, CORS middleware, or authentication packages merely for this scope.

Commands below run from the repository root unless prefixed by `npm --prefix frontend`. Create `.venv` with `python3 -m venv .venv`. Use `.venv/bin/python backend/manage.py test ... --settings=project.test_settings` for Django tests. The test settings use `backend/.test.sqlite3`, never the real `backend/db.sqlite3`; ignore both database files. Concurrency tests use `TransactionTestCase`, separate connections, and the real file-backed database, never an in-memory substitute.

SQLite uses `OPTIONS={"transaction_mode": "IMMEDIATE", "timeout": 20}` and `ATOMIC_REQUESTS=False`. Service mutation transactions begin before reads of mutable item/purchase state. This acquires SQLite's write lock at transaction entry and avoids ineffective SQLite `select_for_update()` locking. Keep network/file work outside these short transactions. A genuine lock timeout becomes `503 database_busy`, with no partial write. A future PostgreSQL migration will need equivalent per-item row locks in the service boundary; do not claim it is already tested there.

Support environment variables `FAMILY_CONFIG_PATH` and `WISHLIST_DB_PATH` for isolated runs; defaults point to the approved config and development database. Missing/unreadable config errors are explicit. Development host/origin settings cover localhost/127.0.0.1 and Vite's origin only; no wildcard access policy or deployment setup.

### Public JSON/TypeScript contract

Define these exports in `frontend/src/api/types.ts` and mirror their field names exactly in Python serialization. Arrays are plain JSON arrays, not pagination envelopes.

```ts
type Profile = { id: number; key: string; name: string };
type EventOption = { id: number; key: string; label: string; is_active: boolean };
type Session = { profile: Profile | null };
type Buyer = { buyer_id: number; buyer_name: string };
type ItemBase = {
  id: number; owner_id: number; name: string; link: string; price: string;
  notes: string; event: EventOption | null; allow_multiple_purchases: boolean;
  created_at: string; updated_at: string;
};
type OwnerItem = ItemBase & { is_owner: true };
type OtherItem = ItemBase & {
  is_owner: false; purchases: Buyer[]; can_purchase: boolean; can_undo: boolean;
};
type Item = OwnerItem | OtherItem;
type ItemInput = {
  name: string; link: string; price: string; notes: string;
  event_id: number | null; allow_multiple_purchases: boolean;
};
type EventFilterValue = 'all' | 'anything' | { key: string };
type ApiFailure = { code: string; message: string; fields?: Record<string, string[]> };
```

Create requires `name`; omitted optional strings become `""`, event becomes null, repeatability becomes false. PATCH accepts `Partial<ItemInput>`; null is allowed only for `event_id`. Do not silently coerce arrays/objects into strings or accept purchase/owner fields. Return item representations after item create/PATCH and purchase PUT/DELETE; return 204 only after item deletion. Session PUT accepts `{profile_id: number}`; PUT and DELETE return `Session`. Use `201` for item creation and `200` for successful reads/updates/purchase operations (including no-ops).

All `/api/` responses, including errors, carry `Cache-Control: no-store`. Errors use the `ApiFailure` shape: `400 validation_error`, `403 identity_required` or `forbidden`/`csrf_failed`, `404 not_found`, `405 method_not_allowed`, `409 already_purchased`, and `503 database_busy`. Owner purchase attempts always return the same forbidden shape independent of purchase state.

### Shared backend test fixtures

`backend/wishlist/tests/helpers.py` supplies `make_profile(key: str, name: str | None = None) -> FamilyProfile`, `make_event(key: str, label: str | None = None, *, active: bool = True) -> Event`, and `make_item(owner: FamilyProfile, **fields) -> WishlistItem`. `WishlistTestCase.setUp()` creates `self.owner` (Alex), `self.buyer` (Sam), `self.other` (Robin), `self.item` (ordinary, Anything), and an API client selected as owner. `select_profile(client, profile)` bootstraps a CSRF cookie and selects through the real endpoint once Task 3 exists. Model-only tests create their own fixtures before that task. Use an explicitly CSRF-enforcing client for protection tests.

## Task 1: Persist family profiles, events, wishlist items, and purchases

**Files:** Create backend runtime/dependency files, models, initial migration, `.gitignore`, `backend/wishlist/tests/{helpers,test_models}.py` from the map.

**Interfaces:** Produces `FamilyProfile(config_key, name, is_active, user, created_at)`, `Event(config_key, label, is_active, created_at)`, `WishlistItem(owner, name, link, price, notes, event, allow_multiple_purchases, created_at, updated_at)`, and `Purchase(item, buyer, created_at)`. Profile/user is nullable one-to-one with `SET_NULL`; item/owner and purchase/buyer use `PROTECT`; item/event uses `PROTECT`; purchase/item uses `CASCADE`. Models use integer primary keys, matching the JSON contract.

- [x] **Step 1: Establish runnable infrastructure and write `ModelTests.test_item_defaults_and_future_login_link` before domain models exist.** Install dependencies in `.venv`, create only Django package/settings boilerplate, and write:

```python
profile = FamilyProfile.objects.create(config_key="alex", name="Alex")
item = WishlistItem.objects.create(owner=profile, name="A book")
self.assertIsNone(profile.user_id)
self.assertIsNone(item.event_id)
self.assertFalse(item.allow_multiple_purchases)
self.assertEqual((item.link, item.price, item.notes), ("", "", ""))
```

- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_models --settings=project.test_settings`. Expected: failure importing missing domain models, not a missing dependency or settings error.
- [x] **Step 3: Implement the four models and generate their initial migration.** Use spec limits, active defaults true, unique `config_key` on profiles/events and named unique `(item,buyer)` constraint. Add tests `test_duplicate_buyer_is_database_rejected`, `test_item_deletion_cascades_purchase`, and `test_user_link_is_optional_unique_and_preserves_profile_on_user_deletion` asserting those exact relationships. Each added behavior follows red/green.
- [x] **Step 4: Run model tests,** `.venv/bin/python backend/manage.py check`, `.venv/bin/python backend/manage.py makemigrations --check --dry-run`, and `.venv/bin/python -m pip check`. Expected: tests pass, no system/dependency issues, and no missing migration. Freeze exact installed runtime dependencies into `backend/requirements.txt` only after verifying them.
- [x] **Step 5: Commit/checkpoint** this task's listed files with message `feat: persist family wishlist domain models`.

## Task 2: Validate and synchronize authoritative YAML configuration

**Files:** Create configuration modules, sync command, `backend/config/family.yaml`, `backend/wishlist/tests/{test_configuration,test_sync}.py`; extend helpers if needed.

**Interfaces:** Consumes Task 1 models. Produces frozen `FamilyConfig(members: dict[str,str], events: dict[str,str])`, `ConfigError(ValueError)`, `load_family_config(path: Path) -> FamilyConfig`, and `sync_family_config(config: FamilyConfig) -> None`. Command `sync_family_config --config PATH` defaults to settings' `FAMILY_CONFIG_PATH`; catches `ConfigError` as Django `CommandError`.

- [x] **Step 1: Write `ConfigurationTests.test_loads_stable_keys_and_trims_labels` and `SyncTests.test_rename_remove_reactivate_preserves_identity`.** The first loads YAML with `alex: ' Alex '` and asserts `config.members == {'alex':'Alex'}`. The second syncs Alex/Birthday, links Alex to a Django user and a gift/purchase, syncs an empty mapping, then readds the same keys with new labels; assert unchanged primary keys, user link, gift IDs, purchase IDs, updated labels, and final active flags true.

```python
self.assertEqual(config.members, {"alex": "Alex"})
self.assertEqual((profile.pk, profile.user_id), original_identity)
self.assertEqual(list(Purchase.objects.values_list("pk", flat=True)), original_marks)
self.assertTrue(profile.is_active)
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_configuration wishlist.tests.test_sync --settings=project.test_settings`. Expected: missing loader/sync failures.
- [x] **Step 3: Implement safe loading and atomic synchronization.** Use a PyYAML `SafeLoader` subclass that rejects duplicate keys at every mapping; reject merge-key indirection rather than permitting ambiguous overriding. Validate the whole parsed shape before calling sync, and reject nonstring values, extra/missing top-level keys, invalid keys, overlength/blank/duplicate labels, and reserved Anything event key/label. `sync_family_config()` uses `update_or_create(config_key=...)` and deactivates absent keys without changing archived labels or user links. Ship `members: {}` and Birthday/Christmas defaults.
- [x] **Step 4: Add and run tests** `test_rejects_duplicate_yaml_keys`, `test_rejects_boolean_date_number_and_object_labels`, `test_rejects_unsafe_tags_and_merge_keys`, `test_checks_key_and_label_limits_and_reserved_anything`, `test_empty_mappings_are_valid`, `test_invalid_config_leaves_database_unchanged`, `test_sync_is_idempotent`, and `test_missing_or_unreadable_file_is_actionable`. Assert `ConfigError`/`CommandError`, zero partial changes, and preserved archived buyer labels; run the Step 2 command until all pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: configure family members and events from yaml`.

## Task 3: Expose safe name selection and read-only configured catalogs

**Files:** Create `identity.py`, `errors.py`, `serialization.py`, API `base.py`, `urls.py`, `session.py`, `catalog.py`, identity/catalog tests; modify project URL wiring and helpers.

**Interfaces:** Consumes active profiles/events. Produces `current_profile(request: HttpRequest) -> FamilyProfile | None`, `require_profile(request: HttpRequest) -> FamilyProfile`, `serialize_profile(profile: FamilyProfile) -> dict`, `serialize_event(event: Event) -> dict`, and `DomainError(code: str, message: str, status: int, fields: dict | None = None)`. Produces session/profiles/events endpoints and reusable `FamilyAPIView` with CSRF protection for all unsafe methods, no standard user-login requirement, JSON errors, and no-store headers. `api_exception_handler(exc, context)` and `csrf_failure(request, reason='')` normalize DRF and middleware errors.

- [x] **Step 1: Write `IdentityTests.test_selects_configured_profile_without_login` and `test_selection_requires_csrf_even_without_django_user`.** GET session must return `{'profile':None}` and set `csrftoken`; a CSRF-enforcing PUT without header returns 403 `csrf_failed`; valid token plus `{'profile_id': profile.pk}` returns 200 with that profile and persists through a second GET. Assert no Django authentication user was created.

```python
self.assertEqual(bootstrap.json(), {"profile": None})
self.assertIn("csrftoken", bootstrap.cookies)
self.assertEqual((rejected.status_code, rejected.json()["code"]), (403, "csrf_failed"))
self.assertEqual(confirmed.json()["profile"]["id"], profile.pk)
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_identity wishlist.tests.test_catalog --settings=project.test_settings`. Expected: endpoint/identity assertions fail.
- [x] **Step 3: Implement endpoints and error boundary.** Explicitly apply Django CSRF protection around DRF dispatch, since anonymous profile sessions do not trigger ordinary DRF session-auth CSRF checks. Use session key `family_profile_id`; reject unknown/inactive selection, clear stale identity on bootstrap, and return null rather than select a substitute. GET catalogs return only active records, sorted by case-folded labels then IDs. GET events returns only real events, not an Anything row. Implement no catalog mutation endpoints.
- [x] **Step 4: Add/run tests** `test_clear_and_refresh_session`, `test_inactive_or_missing_selection_returns_null`, `test_catalog_excludes_archived_records`, `test_profiles_events_are_read_only`, and `test_all_api_responses_are_json_and_no_store`. Verify wrong method is 405, inactive IDs cannot be selected, malformed selection is 400, missing identity is 403 `identity_required` on a small test-only protected view, and linked future user accounts do not change name-picker behavior. Expected: all identity/catalog tests pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: add csrf protected family identity sessions`.

## Task 4: Read and filter wishlists with recipient-specific serialization

**Files:** Create `selectors.py`, API `items.py`, `test_item_reads.py`; modify `serialization.py` and API URLs.

**Interfaces:** Consumes identity/catalog/models and Task 3's profile/event serializers. Produces `wishlist_items(owner_id: int, event_filter: str | None) -> QuerySet[WishlistItem]`, `visible_item(item_id: int) -> WishlistItem`, and `serialize_item(item: WishlistItem, viewer: FamilyProfile) -> dict`. Produces GET item/list endpoints. Active owners only; purchase-bearing relations are prefetched for nonowner rendering.

- [x] **Step 1: Write `ItemReadTests.test_owner_payload_omits_purchase_fields`.** Add a purchase, GET both owner list and detail, and assert the exact item key set equals `ItemBase` keys plus `is_owner`; assert no nested buyer name/ID, count, availability, or purchase fields. After another purchase on a repeatable item, the owner's `updated_at` and ordering remain unchanged.

```python
self.assertEqual(set(payload), {"id", "owner_id", "name", "link", "price", "notes",
    "event", "allow_multiple_purchases", "created_at", "updated_at", "is_owner"})
self.assertNotIn("purchases", payload)
self.assertEqual(after["updated_at"], before["updated_at"])
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_item_reads --settings=project.test_settings`. Expected: read endpoints or serialization assertions fail.
- [x] **Step 3: Implement GET routes/selectors/serialization.** Owner representations omit purchase fields, not null them. Nonowners receive buyer summaries sorted by purchase creation then ID, and availability derived from the viewer's mark and repeatability. Reject inactive owner and invalid filters before listing. Lists order by `-created_at,-id`; event keys filter with `(event=selected OR event IS NULL)`, while `anything` selects null only. Include archived event label/status on retained assignments.
- [x] **Step 4: Add/run tests** `test_specific_event_includes_anything`, `test_anything_only_and_all_events`, `test_unknown_or_inactive_filter_is_400`, `test_archived_owner_is_not_browsable`, `test_archived_buyer_name_remains_visible`, and `test_nonowner_sees_buyers_and_own_undo_capability`. Fixtures include Birthday, Christmas, Anything, archived event, and purchases. Assert exact IDs and no purchase-dependent owner ordering/counts; rerun Task 3 tests too. Expected: all pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: read event filtered wishlists without recipient spoilers`.

## Task 5: Create, edit, and delete owned wishlist items

**Files:** Create `services/items.py`, `test_item_writes.py`; modify API `items.py`, serialization/URLs only as needed.

**Interfaces:** Produces `validate_item_input(data: dict, *, instance: WishlistItem | None = None, partial: bool = False) -> dict`, `create_item(owner: FamilyProfile, data: dict) -> WishlistItem`, `update_item(item_id: int, actor: FamilyProfile, data: dict) -> WishlistItem`, and `delete_item(item_id: int, actor: FamilyProfile) -> None`. Validated data uses model field names and resolved Event/null, not client ownership. Each mutation is an explicit short transaction beginning before reading the item, including repeatability changes.

- [x] **Step 1: Write `ItemWriteTests.test_create_defaults_and_owner_only_edit`.** POST `{'name':'  A book  '}` returns 201 with trimmed name, null event, false repeatability, empty optional strings, and no purchase fields. Another profile's PATCH/DELETE returns 403 and leaves the item unchanged. Requests with `owner_id`, `purchases`, `buyer_id`, unknown fields, nonstring text, and unsafe URL schemes return 400.

```python
self.assertEqual((created.status_code, created.json()["name"]), (201, "A book"))
self.assertIsNone(created.json()["event"])
self.assertFalse(created.json()["allow_multiple_purchases"])
self.assertEqual((forbidden_edit.status_code, forbidden_delete.status_code), (403, 403))
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_item_writes --settings=project.test_settings`. Expected: unsupported mutation or missing service failures.
- [x] **Step 3: Implement validation and owned mutations.** Enforce all exact character limits and HTTP/HTTPS URLs server-side. Active events can be assigned; unchanged inactive `event_id` may be retained only on that same item's update. Updates to the event or repeatability preserve marks and expose no purchase-dependent errors. Deletion always succeeds for an existing owned item and returns 204 regardless of marks.
- [x] **Step 4: Add/run tests** `test_all_field_limits_and_invalid_types`, `test_keep_archived_event_but_reject_new_assignment`, `test_event_change_preserves_purchase_ids`, `test_toggle_off_preserves_multiple_marks_without_leaking`, `test_create_patch_and_delete_have_no_recipient_spoilers`, and `test_purchase_activity_does_not_change_item_timestamp`. Compare owner responses before/after marks except for fields intentionally changed. Run all backend tests to date plus migration drift check; expected all pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: manage owned wishlist items and occasion assignments`.

## Task 6: Record purchases atomically and enforce buyer-owned undo

**Files:** Create `services/purchases.py`, API `purchases.py`, `test_purchases.py`, `test_concurrency.py`; modify API URLs/error mapping.

**Interfaces:** Consumes atomic item services and viewer serialization. Produces `mark_purchased(item_id: int, buyer: FamilyProfile) -> WishlistItem` and `undo_purchase(item_id: int, buyer: FamilyProfile) -> WishlistItem`. Both begin a transaction before reading mutable state, check active owner/current buyer, deny owner purchase attempts consistently, and return a refreshed item for serialization.

- [x] **Step 1: Write `PurchaseTests.test_single_purchase_conflict_and_repeatable_buyers`.** Sam's PUT ordinary item returns 200, repeating Sam's PUT returns 200 with one row, Robin's PUT returns 409 `already_purchased`; owner enables repeatability, then Robin succeeds with two rows. Both nonrecipients see buyer names; recipient reads and edits contain none.

```python
self.assertEqual((first.status_code, repeated.status_code), (200, 200))
self.assertEqual((conflict.status_code, conflict.json()["code"]), (409, "already_purchased"))
self.assertEqual(Purchase.objects.filter(item=self.item).count(), 2)  # after enabling repeatability
self.assertNotIn("purchases", owner_payload)
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_purchases --settings=project.test_settings`. Expected: missing purchase service/routes.
- [x] **Step 3: Implement purchase services/routes.** Use Task 1's uniqueness constraint and shared IMMEDIATE transaction strategy with Task 5. Check own existing mark before rejecting another ordinary-item buyer. DELETE removes only `(item,buyer)` and is a successful no-op if absent; it cannot address another buyer. Turning repeatability off preserves multiple historical marks but blocks additional marks until none remain. Normalize genuine SQLite lock timeout to retryable 503 without swallowing unrelated database failures.
- [x] **Step 4: Write and run concurrency regressions.** `ConcurrencyTests.test_two_simultaneous_buyers_only_one_wins` uses two threads/connections, a barrier before service invocation (never inside acquired transactions), joins with finite timeouts, and asserts one success, one conflict, one stored mark, no unhandled exception. `test_toggle_and_purchase_are_serialized` races disabling a repeatable item already bought by Sam against Robin's mark; final state is disabled and either one or two preserved marks, depending on lock order, but a later third buyer always conflicts. Also test concurrent same-buyer idempotency, repeatable different buyers, forced lock-timeout rollback, owner denial independent of state, own-only/idempotent undo, and unchanged item timestamps. Run all backend tests. Expected: all pass with real file-backed SQLite.
- [x] **Step 5: Commit/checkpoint** with message `feat: coordinate gift purchases without duplicates or spoilers`.

## Task 7: Establish the typed frontend API client and its test harness

**Files:** Create frontend toolchain/entry placeholders, `api/{types,client}.ts`, `api/client.test.ts`, test setup/fixtures; modify `.gitignore` for frontend artifacts.

**Interfaces:** Produces all shared JSON types, `ApiError extends Error` with `status:number` and `failure:ApiFailure`, and `request<T>(path: string, init?: RequestInit): Promise<T>` (path includes `/api/`). Named exports: `getSession(signal?:AbortSignal):Promise<Session>`, `selectProfile(id:number):Promise<Session>`, `clearSession():Promise<Session>`, `getProfiles(signal?:AbortSignal):Promise<Profile[]>`, `getEvents(signal?:AbortSignal):Promise<EventOption[]>`, `getItems(profileId:number,filter:EventFilterValue,signal?:AbortSignal):Promise<Item[]>`, `createItem(input:ItemInput):Promise<OwnerItem>`, `updateItem(id:number,input:Partial<ItemInput>):Promise<OwnerItem>`, `deleteItem(id:number):Promise<void>`, `markPurchased(id:number):Promise<OtherItem>`, and `undoPurchase(id:number):Promise<OtherItem>`. Void responses resolve `undefined`.

- [x] **Step 1: Install frontend test infrastructure and write `client.test.ts` test `sends CSRF and session cookies for mutations`.** Use current compatible React 19/Vite 8/Vitest 5 packages, TypeScript, jsdom, Testing Library, user-event, jest-dom, and ESLint; lock with `package-lock.json`. Test mock fetch sees `credentials:'same-origin'`, JSON content type, and `X-CSRFToken` from `csrftoken` cookie on an unsafe request.

```ts
expect(fetchMock).toHaveBeenCalledWith('/api/session/', expect.objectContaining({
  method: 'PUT', credentials: 'same-origin',
  headers: expect.objectContaining({ 'X-CSRFToken': 'test-token' }),
}));
```
- [x] **Step 2: Run** `npm --prefix frontend test -- --run src/api/client.test.ts`. Expected: missing client implementation, not unavailable test dependencies.
- [x] **Step 3: Implement types/client and development proxy.** Use `fetch`, no Axios dependency; do not persist responses. Preserve `AbortError`, normalize malformed/non-JSON errors to a readable `ApiError`, handle 204 without JSON parsing, and encode event keys with URLSearchParams. Vite proxies `/api` to `http://127.0.0.1:8000`, overridable with `VITE_API_TARGET` for E2E; backend trusts only local Vite origins on ports 5173/5174 for CSRF. Scripts are `dev`, `build` (typecheck then Vite), `test`, and `lint`; restrict Vitest to `src/**/*.test.{ts,tsx}` so it does not collect Playwright specs. Include no sample counter UI in the deliverable.
- [x] **Step 4: Add/run tests** `does not parse a 204 body`, `maps field errors and non-JSON failures`, `preserves abort cancellation`, and `omits all-events query but encodes specific keys`. Run API tests, `npm --prefix frontend run build`, and `npm --prefix frontend run lint`. Expected: all pass, no type/lint errors.
- [x] **Step 5: Commit/checkpoint** with message `feat: add typed react api client and local development proxy`.

## Task 8: Select identities and invalidate stale frontend state

**Files:** Create identity components/tests, `AppHeader.tsx`, `AsyncState.tsx`; compose `App.tsx` and `main.tsx`.

**Interfaces:** Consumes Task 7 client. Produces `IdentityProvider({children})`, `useIdentity() -> {profile:Profile|null, phase:'loading'|'ready'|'checking'|'changing'|'error', generation:number, choose(id:number):Promise<void>, clear():Promise<void>, revalidate():Promise<void>}`, and `NamePicker({profiles:Profile[], onChoose, pending:boolean})`. A generation changes before identity transitions and focus revalidation; generations invalidate old requests and mutation completions. During `checking`, retained children are hidden and inert until identity is confirmed. If the same profile is confirmed, preserve draft inputs; if identity changes, unmount/discard old forms and filters. Explicit name switching clears old children immediately, even before confirmation. Key the final profile subtree by profile ID, not by every revalidation generation.

- [x] **Step 1: Write identity tests** `shows configured names without add-member control` and `late response cannot restore previous identity`. Using controlled deferred promises, switch from Sam to Alex, resolve Sam's old request last, and assert only Alex's current view remains. With empty names, assert the YAML path and restart guidance appear.

```tsx
expect(screen.getByRole('button', { name: 'Alex' })).toBeEnabled();
expect(screen.queryByRole('button', { name: /add family member/i })).not.toBeInTheDocument();
// In the separate empty-catalog test:
expect(screen.getByText(/backend\/config\/family.yaml/)).toBeVisible();
```
- [x] **Step 2: Run** `npm --prefix frontend test -- --run src/features/identity`. Expected: missing provider/picker behavior.
- [x] **Step 3: Implement the provider, picker, header, and root gate.** Bootstrap session before rendering a wishlist. Hide sensitive children synchronously on blur/revalidation, clear them on explicit switching, abort previous reads, and ignore generation-mismatched completions even when mocks/server ignore cancellation. Revalidate on focus/visibility return before revealing any retained UI. A failed transition stays behind a retryable gate, not the old wishlist. Reset obsolete pending flags without discarding draft inputs if revalidation confirms the same identity. No localStorage/sessionStorage use.
- [x] **Step 4: Add/run tests** `shared-tab changed-identity revalidation clears stale form and filter`, `same-identity focus check preserves unsaved input`, `selection failure offers retry without old purchase data`, `identity-required returns to picker`, and `select persists through root remount`. Use mocked server session changes plus window focus/blur events, including a pending form submission. Assert no old buyer name is visible or interactive during/after an identity change. Run all frontend tests and typecheck/build; expected pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: support easy family identity selection without stale spoilers`.

## Task 9: Browse event-filtered family wishlists

**Files:** Create `useWishlist.ts`, `WishlistPage.tsx`, `GiftCard.tsx`, `EventFilter.tsx` and adjacent tests; modify App/navigation/styles.

**Interfaces:** Consumes profile/events/client/identity. Produces `useWishlist(ownerId:number, filter:EventFilterValue, generation:number) -> {items:Item[], loading:boolean, error:ApiError|null, refresh():void}`, `EventFilter({events,value,onChange})`, `GiftCard({item:Item,children?:ReactNode})`, and `WishlistPage({owner:Profile})`. Data loads and completions are scoped to owner/filter/identity generation; owner or identity change resets filter to `'all'`.

- [x] **Step 1: Write list tests** `specific event includes Anything and explains that inclusion` and `owner gifts never render purchase controls or buyer names`. Mock server responses with Birthday/Anything items, assert selected event key passed to client, visible event labels, and a clearly labeled All events / Anything / configured-event selector. Use separate owner/nonowner fixtures with exact union types.

```tsx
expect(getItems).toHaveBeenLastCalledWith(owner.id, { key: 'birthday' }, expect.any(AbortSignal));
expect(screen.getByText('Birthday book')).toBeVisible();
expect(screen.getByText('Anything gift card')).toBeVisible();
expect(screen.queryByRole('button', { name: /mark purchased/i })).not.toBeInTheDocument(); // owner test
```
- [x] **Step 2: Run** `npm --prefix frontend test -- --run src/features/wishlists/WishlistPage.test.tsx src/features/wishlists/EventFilter.test.tsx`. Expected: missing list components/loading behavior.
- [x] **Step 3: Implement browsing and filtering.** Compose My wishlist / Family wishlists navigation, active profile buttons, and owner-aware views. Fetch on navigation/filter changes, refresh on confirmed focus identity, and expose refresh to future mutations. All events includes inactive-event items; render archived labels as no longer configured. Empty lists and unavailable profiles get clear messages, loading has status text, errors offer retry. Render notes as text and external links with `target='_blank' rel='noopener noreferrer'`.
- [x] **Step 4: Add/run tests** `late list response does not overwrite a new person or filter`, `changing person resets All events`, `archived event label is retained`, `empty and failed lists have useful actions`, and `notes containing HTML remain text`. Run frontend tests/lint/build. Expected: pass, no stale content or unsafe HTML rendering.
- [x] **Step 5: Commit/checkpoint** with message `feat: browse family wishlists by configured occasion`.

## Task 10: Add buyer purchase controls and conflict recovery

**Files:** Create `PurchaseControls.tsx` and tests; modify GiftCard/WishlistPage composition.

**Interfaces:** Consumes `OtherItem`, API mutation methods, and identity generation. Produces `PurchaseControls({item:OtherItem,onChanged:()=>void})`; owner items never instantiate it. On successful mutation, invoke refresh; old-generation completions do not show notices or refresh the new identity.

- [x] **Step 1: Write tests** `repeatable gift still allows another buyer` and `buyer can undo only own mark`. Assert a repeatable item showing Sam's name still offers purchase to Robin, while an ordinary purchased item does not. Assert Undo appears only when `can_undo` is true and invokes only the current item's undo endpoint.

```tsx
expect(screen.getByRole('button', { name: /mark purchased/i })).toBeEnabled(); // repeatable fixture
// After clicking Undo in the own-mark fixture:
expect(undoPurchase).toHaveBeenCalledWith(item.id);
expect(markPurchased).not.toHaveBeenCalled();
```
- [x] **Step 2: Run** `npm --prefix frontend test -- --run src/features/wishlists/PurchaseControls.test.tsx`. Expected: missing controls.
- [x] **Step 3: Implement buyer names, repeatability label, and controls.** Respect backend capabilities; disable controls during requests; wait for confirmation before success UI. On 409, show an already-purchased explanation and refresh. On 503/network failure, explain retry without claiming success. Successful own undo refreshes the list. Use status/alert roles, not color alone.
- [x] **Step 4: Add/run tests** `conflict explains and refreshes`, `pending prevents double submission without optimistic success`, `failure offers retry`, and `identity transition discards pending purchase completion`. Run all frontend tests/lint/build. Expected: all pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: show gift purchase coordination and buyer owned undo`.

## Task 11: Add owner item forms and consistent deletion

**Files:** Create ItemForm/DeleteItemDialog and tests; integrate owner actions in WishlistPage; extend responsive CSS.

**Interfaces:** Consumes `OwnerItem`, event options, and item mutation methods. Produces `ItemForm({item?:OwnerItem,events:EventOption[],onSaved:()=>void,onCancel:()=>void})` and `DeleteItemDialog({item:OwnerItem,onDeleted:()=>void,onCancel:()=>void})`. Both live under the identity gate, use current generation, and disappear on identity/person changes. Event controls map Anything to `event_id:null`.

- [x] **Step 1: Write form tests** `new item defaults to Anything and single purchase` and `failed save preserves all input`. Enter a gift/link/price/notes and select Birthday, simulate server field/network error, and assert every value remains plus a readable error. Assert required name, exact length limits, and labeled fields are enforced without replacing server validation.

```tsx
expect(screen.getByRole('combobox', { name: /event/i })).toHaveDisplayValue('Anything');
expect(screen.getByRole('checkbox', { name: /allow multiple purchases/i })).not.toBeChecked();
expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveAttribute('maxlength', '200');
// After a rejected save:
expect(screen.getByRole('textbox', { name: /gift name/i })).toHaveValue('A book');
```
- [x] **Step 2: Run** `npm --prefix frontend test -- --run src/features/items`. Expected: missing forms/dialog.
- [x] **Step 3: Implement create/edit forms and delete confirmation.** A retained inactive event has an explicit current disabled-to-new-selection choice that submits its existing ID unchanged until the owner chooses another. Expose repeatability checkbox, name-only minimum input, inline field errors, cancel, pending state, and post-save refresh. Delete always asks the same confirmation regardless of purchase state; use an accessible dialog with keyboard escape, focus containment, and focus return. Do not add purchase-state-dependent warnings or an unsaved-change feature.
- [x] **Step 4: Add/run tests** `retains archived current event on other edits`, `editing event or repeatability sends no purchase fields`, `delete confirmation copy is independent of purchases`, `keyboard can complete and cancel dialog`, and `identity switch removes unfinished form`. Check visible focus and one-column phone layout at 390px without horizontal overflow. Run frontend tests/lint/build; expected pass.
- [x] **Step 5: Commit/checkpoint** with message `feat: create and edit family gift ideas with event assignments`.

## Task 12: Verify the real application and document its configuration workflow

**Files:** Create startup/verification scripts, startup tests, Playwright configuration/server/fixtures/spec, README, and verification evidence document; update artifact ignores.

**Interfaces:** Consumes all tasks. Produces `scripts/dev_backend.py:main(argv: list[str] | None = None) -> int` and root command `.venv/bin/python scripts/dev_backend.py [--config PATH] [--database PATH] [--port PORT]`, default port 8000; it runs migrations, sync, then dev server and stops on either failure. Shared environment points all subprocesses at the same config/database. Frontend `npm run test:e2e` invokes Playwright. E2E server wrapper uses dedicated files under `/tmp/opencode`, ports 8001/5174, and refuses to reuse unrelated running servers. Use `workers:1` and a fresh configuration/database/server pair for each viewport scenario, not shared mutable state across desktop/mobile runs.

- [x] **Step 1: Write `StartupTests.test_invalid_configuration_prevents_server_start` and the real-server browser scenario before the launcher exists.** Mock subprocess boundaries in the unit test: assert ordered migrate/sync/serve, sync failure blocks serve, and paths propagate. Browser fixtures contain Alex/Sam/Robin, Birthday/Christmas, and no real family data. Scenario asserts picker, gift creation, event filtering, single-buyer conflict, repeatable multi-buyer success, own undo, persistence, recipient purchase-field absence via API, and no buyer text on recipient screen.

```python
self.assertEqual([call.args[0][2] for call in run_mock.call_args_list], ["migrate", "sync_family_config"])
self.assertNotEqual(exit_code, 0)  # main() reports failed sync without launching runserver
```
- [x] **Step 2: Run** `.venv/bin/python backend/manage.py test wishlist.tests.test_startup --settings=project.test_settings` and `npm --prefix frontend run test:e2e`. Expected: missing launcher / failed real workflow, not a passing mocked app. Install Playwright's compatible Chromium if needed only during execution.
- [x] **Step 3: Implement startup and isolated browser harness.** `scripts/dev_backend.py` uses `sys.executable` and checked subprocesses, no shell interpolation; default paths are relative to repository rather than caller's current directory. E2E `server.py` creates a unique temporary directory, copies `fixtures.yaml` there, configures backend/Vite targets, and manages only processes/files it created. Add YAML label rename and event removal/restart checks preserving IDs/purchases and archived assignment labels. Run the scenario at desktop 1280×800 and phone 390×844; inspect console errors and horizontal overflow. Do not edit the real configuration for testing.
- [x] **Step 4: Create README and verify from the documented workflow.** Document `.venv` setup/install, `npm --prefix frontend ci`, editing stable keys versus labels, startup/restart, Anything filter inclusion, archived members/events, one-mark-per-buyer repeatability, shared-tab identity, future-login boundary, trust limitation, and all tests. `scripts/verify.sh` runs backend tests with file-backed test settings, Django system/migration checks, pip check, frontend tests/lint/build, and browser tests; fail on the first failed command. Run `bash scripts/verify.sh`; expected every command exits 0. Record actual versions, commands/results, viewports, and any remaining limitations in `docs/verification/family-wishlist.md`, never invented counts or unrun checks.
- [x] **Step 5: Commit/checkpoint** with message `test: verify family wishlist workflows and document yaml setup`. Obtain the required whole-change review before claiming implementation complete; fix actual findings and rerun affected/full checks. No deployment or merge is implied.

## Self-review and requirement coverage

- Intent, easy name selection, persistence, future accounts: Tasks 1, 3, 7–8.
- YAML validation, exact schema, startup/restart, stable identities, archives: Tasks 1–3, 12.
- Item field limits, CRUD, one event/Anything, archived assignment retention: Tasks 1, 4–5, 9, 11.
- Event-inclusive filters and no purchase-dependent recipient metadata: Tasks 4–5, 9.
- Single/repeatable purchase rules, idempotency, own undo, races: Tasks 5–6, 10.
- API-wide CSRF, errors, no-store, omitted fields: Tasks 3–7; integrated proof in Task 12.
- Stale requests, shared tabs, retry/error/empty states, accessibility: Tasks 7–11.
- All five Review Focus items have named tests in their owning tasks.
- No product files, dependencies, Git initialization, or servers are created by writing this plan.

## Documentation checked during planning

Context7 lookup was attempted but unavailable because its monthly quota was exceeded. Official documentation was used instead:

- Django 5.2 Python compatibility: https://docs.djangoproject.com/en/5.2/faq/install/#what-python-version-can-i-use-with-django
- SQLite transaction modes and locking: https://docs.djangoproject.com/en/5.2/ref/databases/#transactions-behavior
- Django CSRF behavior: https://docs.djangoproject.com/en/6.0/ref/csrf/
- DRF session authentication/anonymous CSRF caveat: https://www.django-rest-framework.org/api-guide/authentication/#sessionauthentication
- React standalone app tooling: https://react.dev/learn/build-a-react-app-from-scratch
- Vite/Node requirements: https://vite.dev/guide/
- Vitest requirements and one-shot testing: https://vitest.dev/guide/

Observed local runtimes during planning: Python 3.14.4 and Node v24.21.0. No runtime installation or product scaffolding has occurred.

## Review and execution gate

The user approved this plan and selected subagent-driven execution with Luna
coders, Sol reviewers, and the controller retaining final acceptance authority.

- **Native:** implement tasks in this session, with a fresh whole-change reviewer at the end. Recommended for this small app because its tasks share a tightly coupled API contract and identity rules; it avoids repeatedly transferring that context.
- **Subagent-driven:** fresh implementer and reviewer per task, followed by whole-change review. More independent review during implementation, at higher context cost.

All twelve task-scoped gates have been executed. Whole-app review and one final
fix/re-review wave are recorded in the plan-scoped ledger. The controller's
original full verification passed (91 backend tests, 79 frontend tests, 2 browser
workflows, lint/build/checks), with a residual keyboard-focus finding at that
handoff. The subsequent 2026-10-16 repository review resolved that finding and
records the current acceptance/verification status in
`docs/verification/repo-review-2026-10-16.md`. Do not redispatch completed tasks.
