# Family wishlist

A small, local family wishlist. Names and occasions are configured in YAML; gifts and purchase marks are stored in SQLite.

The repository review and follow-up fixes are recorded in the
[review report](docs/verification/repo-review-2026-10-16.md).

## Docker install (no source build)

Prebuilt [v0.1.0](https://github.com/klottick/present-wishlist/releases/tag/v0.1.0)
is available for Linux `amd64` and `arm64`, with verified anonymous pulls and a
source-free Compose installation. See [Docker release verification](docs/verification/docker-release.md).

**Trusted family use only.** Choosing a name is not authentication. Anyone with
access can switch names and reveal surprises. Do not expose this app to the
internet or untrusted users. Container packaging does not add accounts or TLS.

Install Docker Engine with Compose, or Docker Desktop in **Linux-container mode**.
Images target Linux `amd64` and `arm64`; ARM needs a **64-bit OS**, not 32-bit
Raspberry Pi OS. Windows/macOS use Docker's Linux VM. Python/Node are not required.

1. Choose an exact stable version on the repository's
   [Releases page](https://github.com/klottick/present-wishlist/releases).
   Download its **attached** `compose.yaml`, `family.example.yaml`, and
   `default.env.example` (not the source archives) into an empty directory.
   GitHub renames the uploaded `.env.example` attachment to `default.env.example`.
2. Copy `family.example.yaml` to `family.yaml` and `default.env.example` to `.env`.
   Edit the names/events using the YAML format below; keep keys stable when
   renaming. Ensure the YAML is readable by container UID 10001 (for example,
   mode `0644` inside a private installation directory on Linux).
3. Generate a private random secret, e.g. `openssl rand -hex 32`, and set
   `DJANGO_SECRET_KEY` in `.env`. Do not share or commit this file; use mode
   `0600` on Unix. Keep the same secret across updates to preserve sessions.
   The downloaded example pins `WISHLIST_VERSION` to that release.
4. From that directory:

   ```sh
   docker compose config --quiet
   docker compose pull
   docker compose up -d --wait
   ```

Open **http://localhost:8000**. No local build, Vite, Node, or Python server is
needed. `docker compose ps` shows health; `docker compose logs --tail=100 app`
shows startup errors. `/healthz/` returns readiness without family data.
Avoid sharing `docker compose config` output without `--quiet`: it includes secrets.

### Configuration and trusted LAN access

The app mounts `./family.yaml` read-only at `/config/family.yaml` and stores SQLite
in the `wishlist-data` named volume at `/data/wishlist.sqlite3`. Use one application
instance per volume. Edit YAML, then run `docker compose restart app` to sync.
If your editor replaces the file instead of writing it in place, use
`docker compose up -d --force-recreate app` to refresh the bind mount.

Loopback-only access is the default. For a trusted LAN, explicitly set in `.env`:

```dotenv
WISHLIST_BIND_ADDRESS=0.0.0.0
DJANGO_ALLOWED_HOSTS=wishlist.home,192.168.1.20
```

Use your server's actual DNS name/IP, then visit e.g. `http://192.168.1.20:8000`.
Do not use wildcard allowed hosts. `DJANGO_CSRF_TRUSTED_ORIGINS` normally stays
empty for this same-origin setup; optional entries must be exact HTTP/HTTPS
origins, not paths or wildcards. Forwarded proxy headers are not trusted.
Firewall access to trusted devices; public hosting/hardening is outside scope.

### Backup, restore, and updates

The following shell examples are for Linux/macOS (adapt paths in PowerShell).
Protect the backup directory: it contains all family data and your secret.
Stop before copying SQLite; do not copy a live database file.

```sh
mkdir -m 700 backup
docker compose stop app
docker compose cp app:/data/wishlist.sqlite3 ./backup/wishlist.sqlite3
cp family.yaml .env backup/
chmod 600 backup/* backup/.env
docker compose start app
```

Restore first into an **isolated installation with a fresh named volume**, not
over your running family's data. Put the backup directory in the new installation
alongside its Compose file. Restore YAML as readable by the container, but keep
`.env` private. The host shell streams the private database through stdin, so no
backup permissions are relaxed. Pull the same image version, then run this
non-root helper (the application must remain stopped):

```sh
cp ./backup/family.yaml ./backup/.env .
chmod 644 family.yaml
chmod 600 .env
docker compose pull
docker compose run --rm -T --no-deps --entrypoint python app -c \
  "import os,shutil,sys; os.umask(0o077); dst=open('/data/wishlist.sqlite3','xb'); shutil.copyfileobj(sys.stdin.buffer,dst); dst.close()" \
  < ./backup/wishlist.sqlite3
docker compose up -d --wait
```

This refuses to overwrite an existing database and creates it as UID/GID
`10001:10001` with private permissions in the fresh volume. Verify gifts and
purchase privacy before relying on the restored installation. Never run two
apps against the same SQLite volume, use `chmod 777`, or switch the service to root
to hide permission problems. Keep the backup's secret to preserve sessions.

Before updating, back up as above. Set `WISHLIST_VERSION` in `.env` to the desired
exact stable version, then `docker compose pull` and `docker compose up -d --wait`.
Migrations and YAML synchronization run before serving. There is **no automatic
schema rollback**: restoring an old image may require restoring its matching
pre-upgrade database backup. Normal `stop`, `start`, and `down` preserve the named
volume; **`docker compose down -v` destroys stored gifts, purchases, and sessions**.

### Troubleshooting

- Missing YAML: create the actual `family.yaml` file first. Compose deliberately
  refuses to create a directory in its place. Invalid YAML stops startup.
- Invalid secret/hosts: use a random secret of at least 50 characters (64 hex
  characters recommended); specify exact hosts/IPs without schemes or ports.
- Permission denied: YAML must be readable and the data volume writable by UID
  10001. A bind-mounted data directory needs correct ownership; the default named
  volume initializes ownership automatically. Restore into a fresh volume rather
  than changing an existing installation's ownership blindly.
- Unhealthy/restarting: inspect `docker compose logs --tail=100 app` for validation,
  migration, or sync failure. Startup fails closed; do not bypass checks.
- Unsupported platform: use `amd64` or 64-bit `arm64` Linux containers; no 32-bit
  ARM image is supplied.
- Pull denied/not found: check the version exists and GHCR package visibility is
  public. A public GitHub repository does **not** make its image public. End users
  should not need a login/PAT; report a private-package release as a release defect.

## Source development setup

Requirements: Python 3.14 and Node.js 24 or newer.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade 'pip>=26.2'
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run install:browsers
```

The browser install script uses the Playwright CLI installed by the frontend lockfile. On Linux, if Chromium reports missing system libraries, install the OS dependencies with `cd frontend && npx playwright install --with-deps chromium`; this may require administrator privileges. The browser download and OS dependencies are separate from `npm ci`.

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

Identity selection is a shared-tab convenience, not an account system. Tabs in one browser share the selected profile, so switching names affects those tabs; use separate browser profiles for separate concurrent identities. A future login/account integration is not implemented: name selection is not authentication, and this app is trust-based. Do not expose it to untrusted users or put real credentials or sensitive secrets in notes. No authentication, managed hosting, calendar dates, or live push updates are provided.

## Reusing image publication across projects

Keep each project's Dockerfile, application tests, version guard, and serialized
release caller local. Only the generic build/smoke/push workflow is shared. For a
different stack, a caller's publishing job can look like this (after its own
`prepare` job validates the stable release and tests the application):

```yaml
publish:
  needs: [prepare]
  permissions:
    contents: read
    packages: write
  uses: klottick/present-wishlist/.github/workflows/publish-image.yaml@41af090209bf25666410809a976e3d8bcb2baa41
  with:
    image: ghcr.io/your-name/your-project
    version: ${{ needs.prepare.outputs.version }}
    context: .
    dockerfile: Dockerfile
    platforms: linux/amd64,linux/arm64
    smoke-command: ./ci/smoke-image.sh "$IMAGE" "$PLATFORM"
    pre-publish-command: ./ci/check-release-order.sh "$VERSION"
```

That immutable reference pins the audited publisher implementation in this
repository. Review and deliberately update the pin when adopting later changes.
The publisher checks out the caller's event commit, not this repository. The smoke
command is trusted repository code, never user-supplied release text. It receives
the built image/platform and must exit nonzero on failure. Both tested images are
retained and pushed without rebuilding; final version, `sha-<full-commit>`, and
`latest` aliases use those digests. No shared infrastructure repository is needed.
The optional pre-publish hook refreshes the caller's release-order check inside
the publishing job; supply it so rerunning an old failed job cannot move `latest`
backward after a newer release. The caller must hold its release concurrency lock.

Only published canonical stable releases trigger this project's caller. Publication
is serialized, older/equal versions are rejected, and an existing exact image tag
is never silently overwritten. Registry tag updates are **not atomic**: after a
partial failure, inspect all tags/digests and explicitly plan repair; do not blindly
rerun the whole release. If only asset attachment failed after successful image
publication, use GitHub Actions' **Re-run failed jobs** so only attachment retries.
See the Actions run summary for the combined digest; releases attach
`image-digest.txt` too. Staging tags are run-specific and are not installation tags.

## Verification

Run the complete local check sequence from the repository root:

```sh
bash scripts/verify.sh
```

Before running browser verification on a fresh machine, run `npm --prefix frontend run install:browsers` to install Playwright's Chromium binary. The verification script does not download browsers implicitly.

It stops on the first failed command and runs the file-backed Django suite, Django checks and migration consistency, dependency checks, frontend tests/lint/build, and isolated real-browser workflows at 1280×800 and 390×844. Browser verification uses temporary YAML and SQLite files under `/tmp/opencode`, allocates unused loopback ports per viewport, and allows only the exact generated frontend origin through the backend's `WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN` setting. It will not reuse occupied external server ports. See [verification evidence](docs/verification/family-wishlist.md) for actual versions and results.
