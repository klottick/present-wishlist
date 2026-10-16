# Docker operations

[Back to the README](../README.md)

These instructions apply to the downloaded, pull-only `compose.yaml`. Run commands
from your installation directory. Shell examples use Linux/macOS syntax; adapt
paths and permission commands for PowerShell.

## Runtime layout

| Resource | Location or default |
| --- | --- |
| Browser address | `http://localhost:8000` |
| Host binding | `127.0.0.1:8000:8000` |
| Read-only family file | `./family.yaml` mounted at `/config/family.yaml` |
| Persistent storage | Compose volume `wishlist-data`, mounted at `/data` |
| Database | `/data/wishlist.sqlite3` |
| Runtime identity | UID/GID `10001:10001` |
| Readiness endpoint | `/healthz/` |

Compose prefixes the actual volume name with its project name. Keep the
installation directory/project name stable when updating, or explicitly select
the original Compose project; a different project normally gets a new volume.
Use only one application instance per SQLite volume.

## Environment settings

Copy the release's `default.env.example` attachment to `.env`. GitHub renames the
repository's `.env.example` upload to that public attachment name.

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Required private random secret, at least 50 characters. Generate 64 hexadecimal characters with `openssl rand -hex 32`. Keep it stable to preserve sessions. |
| `WISHLIST_VERSION` | Exact image version, without `v`; release downloads set it for you. |
| `WISHLIST_BIND_ADDRESS` | Published host address; defaults to `127.0.0.1`. |
| `DJANGO_ALLOWED_HOSTS` | Optional comma-separated exact DNS names/IPs, without schemes or ports. Loopback hosts remain allowed. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Normally empty for same-origin use. Optional entries must be exact HTTP/HTTPS origins, not paths or wildcards. |
| `WISHLIST_IMAGE` | Optional image repository override; normally leave unset. |

After changing `.env`, use `docker compose up -d --wait` to recreate the service
with the new environment. `docker compose restart` alone does not reload it.
For family-file changes, follow the [configuration guide](configuration.md).

## Health and logs

```sh
docker compose ps
docker compose logs --tail=100 app
```

Startup validates configuration and writable storage, applies migrations,
synchronizes YAML, and starts Gunicorn. Failures stop startup instead of serving
with invalid configuration. Readiness checks query application and session tables
without returning family data. Logs go to stdout/stderr.

Use `docker compose config --quiet` to validate configuration. Do not share the
output of `docker compose config` without `--quiet`: it contains the secret.

## Trusted LAN access

Name selection is not authentication. Use this only on a trusted family network;
internet exposure and TLS/proxy hardening are not provided.

To allow trusted devices, set your server's actual DNS name/IP in `.env`:

```dotenv
WISHLIST_BIND_ADDRESS=0.0.0.0
DJANGO_ALLOWED_HOSTS=wishlist.home,192.168.1.20
```

Apply with `docker compose up -d --wait`, then visit, for example,
`http://192.168.1.20:8000`. Restrict firewall access to trusted devices. Do not use
wildcard allowed hosts. Same-origin access normally needs no trusted-origin
override; forwarded host/protocol headers are deliberately not trusted.

## Backup

Backups contain all family data and the application secret. Protect them, stop
the app before copying SQLite, and do not copy a live database file.

For a new backup directory:

```sh
mkdir -m 700 backup
docker compose stop app
docker compose cp app:/data/wishlist.sqlite3 ./backup/wishlist.sqlite3
cp family.yaml .env backup/
chmod 600 backup/* backup/.env
docker compose start app
```

Check each command succeeds. Keep the app stopped until the database copy is
complete. For later backups use another private directory rather than assuming
an existing backup is safe to overwrite.

## Restore into an isolated installation

Use a fresh installation directory and a fresh named volume, not your running
family's data. Download the Compose file from the same release as the backup.
Place the private `backup` directory beside it. The application must remain
stopped until restoration is complete. Stop any other app using the destination
host port, or deliberately configure a separate loopback port in an override.

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

The host shell streams the private database through stdin; backup permissions
are not relaxed. The helper creates the database as UID/GID `10001:10001` with
mode `0600` and refuses to overwrite an existing database. Keep the restored
secret to preserve sessions. Verify gifts and buyer/recipient privacy before
relying on the restored installation.

Do not use `chmod 777`, run the app as root to mask permissions problems, or run
two application instances against the same SQLite volume.

## Updates and data retention

1. Back up the database, family YAML, and `.env` before upgrading.
2. Set `WISHLIST_VERSION` in `.env` to the desired exact stable version.
3. Run `docker compose pull`, then `docker compose up -d --wait`.
4. Check health and confirm the existing gifts are present.

Migrations run before serving. There is no automatic schema rollback: restoring
an older image may also require restoring its matching pre-upgrade database.

Normal `stop`, `start`, and `down` preserve the named volume.
**`docker compose down -v` deletes stored gifts, purchase marks, and sessions.**

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing family file | Create the actual `family.yaml` file first. Compose refuses to create a directory in its place. |
| Invalid YAML | Use the [configuration rules](configuration.md); both mappings are required and Anything is reserved. |
| Invalid secret or hosts | Generate a private random secret of at least 50 characters; use exact hosts/IPs without schemes, ports or wildcards. |
| Permission denied | YAML must be readable and the data volume writable by UID 10001. Fresh named volumes initialize ownership; host data bind mounts need deliberate ownership. |
| Port 8000 unavailable | Another service owns the port. Do not stop unrelated services blindly; change only the published host port in a Compose override if needed. `WISHLIST_BIND_ADDRESS` changes the address, not the port. |
| Unhealthy or restarting | Inspect `docker compose logs --tail=100 app` for validation, migration or sync failures. Do not bypass startup checks. |
| Unsupported platform | Use Linux amd64 or 64-bit arm64. A 32-bit ARM OS is unsupported. Docker Desktop must use Linux containers. |
| Pull denied or not found | Confirm the version and public package accessibility. End users should not need a GitHub login or token. |
| Empty list after moving directories | Check the Compose project and its volume; a new project name can create a different database volume. |
