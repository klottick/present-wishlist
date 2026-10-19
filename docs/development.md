# Development and testing

[Back to the README](../README.md)

Docker users do not need this toolchain. These instructions are for contributors
running the application from source. Commands run from the repository root unless
otherwise noted.

## Requirements

- Python 3.14 with virtual-environment support.
- Node.js 24 or newer and npm.
- Chromium and its OS libraries for browser tests; provision using the pinned
  project's Playwright CLI as described below.

## Install dependencies

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade 'pip>=26.2'
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run install:browsers
```

The last command installs the Chromium binary used by the lockfile's Playwright
version. Browser installation is separate from `npm ci`. On Linux, missing browser
OS libraries may require administrator privileges:

```sh
cd frontend
npx playwright install --with-deps chromium
```

Return to the repository root for subsequent commands. Windows contributors must
adapt virtual-environment paths and POSIX shell commands; the verified source
workflow uses Linux.

## Run the application

Add members to `backend/config/family.yaml` using the
[configuration guide](configuration.md). The tracked development file deliberately
starts with `members: {}`; do not commit real family data.

In one terminal:

```sh
.venv/bin/python scripts/dev_backend.py
```

The launcher migrates the development database, synchronizes YAML, and starts
Django at `http://127.0.0.1:8000`. Invalid or unreadable configuration prevents
the supported startup workflow from serving.

In another terminal:

```sh
npm --prefix frontend run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Vite proxies
`/api` to Django. This is separate from the release image, which serves the built
frontend and API from one origin without Vite or Node at runtime.

If ports 5173 and 5174 are occupied, Vite may choose a higher port. Django trusts
only those two frontend ports by default, so writes from a higher port fail CSRF
validation unless you explicitly trust its exact loopback origin. Either use an
available default port, or stop the backend and restart both processes with a
matching origin and an available port, for example:

```sh
WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN=http://127.0.0.1:5175 \
  .venv/bin/python scripts/dev_backend.py
```

In the frontend terminal:

```sh
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Open `http://127.0.0.1:5175` exactly; `localhost` is a different origin.
`--strictPort` prevents another silent port change. Choose an unused port rather
than stopping unrelated services, and update both commands if you choose another.

### Isolated development paths

The backend launcher accepts `--config PATH`, `--database PATH`, and `--port PORT`
(default `8000`). `FAMILY_CONFIG_PATH` and `WISHLIST_DB_PATH` supply path defaults;
explicit command-line paths take precedence. Defaults are
`backend/config/family.yaml` and `backend/db.sqlite3`.

If you change the backend port, set `VITE_API_TARGET` to the corresponding URL
when launching Vite. Stop and rerun the backend launcher after YAML changes.

### Demo wishlist records

For a populated local UI, first start the app as above so migrations and the
authoritative YAML profiles/events are synchronized, then run from the repository
root:

```sh
.venv/bin/python backend/manage.py seed_demo
.venv/bin/python backend/manage.py reset_demo --yes
```

In a locally built source image, run `docker compose exec app python backend/manage.py seed_demo`
or `docker compose exec app python backend/manage.py reset_demo --yes`. To select
that image safely, use a separate temporary Compose project as shown below; do
not switch an existing family installation to a development image or run demo
reset against its database. These commands are not available in the published
`0.1.0` image. Seeding only uses
active profiles and events already present from configured YAML; it never creates
or changes identities/events. Demo items carry an internal ownership marker, so
reseed keeps edited examples and their marks intact. Reset requires `--yes` and
deletes only marked demo items; purchase marks and edits on those examples go with
them. Unmarked wishlist gifts and configuration are never reset. These commands
target whichever database the app is configured to use: do not run them against a
shared, production, or real-family database.

#### Verify commands in an isolated local Docker project

This optional smoke procedure builds the current source under a local-only image
tag, then creates a disposable Compose project, YAML configuration and named
database volume. It does not read or overwrite the repository's `.env` or
`family.yaml`. It requires Docker Compose v2.24.4 or newer for the `!override`
port syntax.

From the repository root, create private scratch configuration and a unique
project name:

```sh
work="$(mktemp -d /tmp/opencode/wishlist-local-image.XXXXXX)"
project="wishlist-local-image-$(date +%s)-$$"
cp compose.yaml "$work/compose.yaml"
cat > "$work/family.yaml" <<'YAML'
members:
  alex: Alex
  sam: Sam
  robin: Robin
events:
  birthday: Birthday
  christmas: Christmas
YAML
cat > "$work/.env" <<EOF
WISHLIST_IMAGE=present-wishlist-local
WISHLIST_VERSION=source-test
DJANGO_SECRET_KEY=$(openssl rand -hex 32)
EOF
chmod 600 "$work/.env"
cat > "$work/compose.override.yaml" <<'YAML'
services:
  app:
    ports: !override
      - "127.0.0.1::8000"
YAML
docker buildx build --platform linux/amd64 --load \
  --tag present-wishlist-local:source-test \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg VERSION=source-test .
```

Use the same `-p`, `--env-file`, and `-f` arguments for every Compose command;
the unique project name scopes its network and named database volume, while the
port override asks Docker for an available loopback port:

```sh
compose=(docker compose -p "$project" --env-file "$work/.env"
  -f "$work/compose.yaml" -f "$work/compose.override.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait
"${compose[@]}" ps
"${compose[@]}" port app 8000
"${compose[@]}" exec app python backend/manage.py seed_demo
"${compose[@]}" exec app python backend/manage.py seed_demo
"${compose[@]}" exec app python backend/manage.py reset_demo
```

The last command must refuse without `--yes`. Verify reset behavior only in this
disposable database: create an ordinary gift there, run
`"${compose[@]}" exec app python backend/manage.py reset_demo --yes`, and confirm
only marked demo gifts and their purchase marks were removed while the ordinary
gift remains. Keep this app/config/database isolated; never use these reset steps
on family data. Once finished, inspect the project name and Compose ownership,
then remove only this test project's containers/network/volume with
`"${compose[@]}" down --volumes` and remove its temporary directory. Do not use
global Docker prune commands.

See [local Docker demo-command verification](verification/local-source-demo-commands.md)
for a recorded run of this procedure and the native container smoke test.

## Verification

From the repository root:

```sh
bash scripts/verify.sh
```

The script stops on the first failed command and runs:

1. File-backed Django tests using `project.test_settings`.
2. Django system checks and migration consistency.
3. Python dependency consistency with `pip check`.
4. Frontend unit tests, lint, type checking and production build.
5. Real-browser workflows at 1280×800 and 390×844.

It does not download browsers implicitly; install Chromium first. Browser fixtures
use temporary YAML/SQLite under `/tmp/opencode`, dynamically allocated loopback
ports and a private process group. They do not reuse occupied server ports or the
family's development database. The exact generated frontend origin is passed to
Django through the development-only `WISHLIST_EXTRA_CSRF_TRUSTED_ORIGIN` setting;
wildcard/external origins are not accepted there.

The main/PR workflow additionally builds and smokes both container architectures.
Full local application verification alone does not run Docker smoke tests.

## Real-container smoke

With Docker available, build a native test image and run the standard-library
probe:

```sh
docker buildx build --platform linux/amd64 --load -t present-wishlist:smoke .
python3 scripts/smoke_container.py --image present-wishlist:smoke --platform linux/amd64
```

Use `linux/arm64` instead on an ARM host or an explicitly configured emulator.
Do not install privileged host emulation merely to make an unsupported local
platform appear tested. GitHub CI uses QEMU for arm64 execution on x86_64.

The probe checks frontend/assets, CSRF, recipient privacy, non-root storage,
replacement/restart persistence, failed startup and termination. Its temporary
files, containers and volumes are isolated and cleaned by the probe.

## Architecture and evidence

- `frontend/`: React, TypeScript, Vite, and the shared JSON API client.
- `backend/`: Django REST Framework, selected-profile sessions, validation,
  viewer-specific serialization, YAML synchronization, and SQLite persistence.
- `scripts/`: development startup, verification, container startup/smoke, and
  release metadata generation.
- `.github/workflows/`: read-only verification and stable-release publication.

See the [documentation index](README.md) for design records, historical reviews,
and release evidence. Past test totals are tied to their recorded revisions,
not a substitute for running the current suite.
