# Family wishlist

A small, local family wishlist. Names and occasions are configured in YAML; gifts and purchase marks are stored in SQLite.

The application is runnable, but final acceptance has an open keyboard-focus
issue and a minor filter-label edge case. See [outstanding review findings](docs/verification/outstanding-issues.md).

## Local setup

Requirements: Python 3.14 and Node.js 24 or newer.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

Edit `backend/config/family.yaml`, then start from the repository root:

```yaml
members:
  alex: Alex
  sam: Sam
events:
  birthday: Birthday
  winter_holiday: Winter holiday
```

The lowercase keys are stable identities; labels are the names people see. Keep a key when renaming a person or occasion, so existing gifts, event assignments, and purchase marks continue to refer to the same records. Keys use lowercase letters, numbers, hyphens, and underscores, begin with a letter, and are at most 80 characters. Labels are trimmed, unique within their section (case-insensitively), and at most 80 characters.

```sh
.venv/bin/python scripts/dev_backend.py
```

This migrates the development database, synchronizes YAML, and starts Django on `127.0.0.1:8000`; the Vite frontend is started separately:

```sh
npm --prefix frontend run dev
```

The launcher accepts `--config PATH`, `--database PATH`, and `--port PORT` (default `8000`). `FAMILY_CONFIG_PATH` and `WISHLIST_DB_PATH` provide the config/database defaults for isolated environments; explicit `--config` or `--database` values take precedence. YAML validation/sync happens before the server starts; an invalid or unreadable config fails closed. After changing YAML, restart the backend to synchronize it.

## Using the wishlist

Choose your configured name when prompted, then add gifts to your list. Leave Event set to **Anything** for an item without an occasion. An occasion filter includes those Anything gifts in addition to gifts assigned to the selected occasion; the Anything-only filter shows only unassigned gifts.

Each buyer can mark an ordinary item once. A competing mark is rejected if another buyer has already marked it. An item configured to allow multiple purchases can be marked once by each buyer; a buyer can undo only their own mark. There is no quantity field. Owners do not receive purchase information in item API responses, and the owner UI does not display buyers.

Removing a person or occasion from YAML archives the existing record instead of erasing it. Archived members and event assignments remain visible where already used, and their records and purchase marks are preserved. An archived event cannot be newly assigned to another item. Restore the same key to reactivate that record.

Identity selection is a shared-tab convenience, not an account system. Tabs in one browser share the selected profile, so switching names affects those tabs; use separate browser profiles for separate concurrent identities. A future login/account integration is not implemented: name selection is not authentication, and this app is trust-based. Do not expose it to untrusted users or put real credentials or sensitive secrets in notes. No authentication, deployment, calendar dates, or live push updates are provided.

## Verification

Run the complete local check sequence from the repository root:

```sh
bash scripts/verify.sh
```

It stops on the first failed command and runs the file-backed Django suite, Django checks and migration consistency, dependency checks, frontend tests/lint/build, and isolated real-browser workflows at 1280×800 and 390×844. Browser verification uses temporary YAML and SQLite files under `/tmp/opencode`, allocates unused loopback ports per viewport, and allows only the exact generated frontend origin through the backend's `WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN` setting. It will not reuse occupied external server ports. See [verification evidence](docs/verification/family-wishlist.md) for actual versions and results.
