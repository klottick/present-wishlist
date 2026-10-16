# Prebuilt Docker release

Date: 2026-10-16. Status: approved; native local implementation in verification.
First publication, ARM execution, and anonymous release acceptance remain pending.

## Goal and agreed constraints

Let someone run the wishlist without installing Python/Node or building source.
The user wants reusable release setup across mixed-stack projects and explicitly
prefers KISS. Publish Linux images for both `amd64` and `arm64`; Docker selects
the correct architecture automatically. ARM support means a 64-bit OS, not
32-bit Raspberry Pi installations. macOS/Windows users run Linux containers.

Success: download a small configuration bundle, supply family YAML and a secret,
then run `docker compose up -d`. Updates must preserve family data and sessions.
The application remains trust-based; packaging does not provide authentication.

## Approach and alternatives

Use one image and one container, exposing the built React frontend and Django
API at the same origin. Keep SQLite and external family YAML.

- Recommended: Gunicorn plus WhiteNoise in the Python runtime. No Node runtime,
  Vite server, reverse-proxy container, or external database is required.
- Separate frontend/proxy and backend containers would work, but add configuration
  and orchestration without a benefit for this small application.
- A general deployment framework or new shared-infrastructure repository is out
  of scope. Reuse a small publishing workflow, not a universal Dockerfile.

## Image and serving

Create `.dockerignore`, a multi-stage root `Dockerfile`, and `compose.yaml`.
Build frontend assets with the existing lockfile and Node requirement. Copy
only the built assets and required backend/runtime files into a Python 3.14
image. Pin added Python dependencies and use official base images with explicit
versions; pin CI actions to reviewed commit SHAs.

Run as a fixed non-root user. Exclude real YAML, databases, environment files,
credentials (including `.npmrc`), source-control metadata, dependency directories,
browser binaries, test artifacts, and agent scratch data from the image context.
Provide a separate sample YAML for download rather than baking personal config
into the image. No application database is initialized during image building.

Gunicorn listens on container port 8000 with one worker and a small thread pool,
appropriate to a single-instance SQLite application. WhiteNoise serves built
assets and the root document. API paths retain JSON errors and `no-store` privacy;
missing assets and unknown API routes must never return the application HTML.
The current UI has no client-side URL router, so no broad SPA fallback is needed.
Root HTML must revalidate on updates; hashed assets may be cached long-term.

## Runtime configuration and startup

Use a separate release settings module so source-development/test behavior stays
unchanged. Release settings disable debug mode, require a non-development
`DJANGO_SECRET_KEY`, and validate configured allowed hostnames and optional exact
CSRF trusted origins. Same-origin operation requires no permissive CORS setup or
development-origin allowlist. Do not implicitly trust forwarded proxy headers.

Compose pulls the published image, with no build step in the normal user path.
Default published port: `127.0.0.1:8000:8000`. Document explicit opt-in LAN access
and matching allowed hosts; untrusted/public exposure remains unsupported.

- Read-only bind mount: `./family.yaml` to `/config/family.yaml`.
- Named persistent volume: `/data`, database `/data/wishlist.sqlite3`.
- Local `.env`: stable secret, image version, and optional allowed hosts.

The named volume must be writable by the non-root runtime on a fresh install.
A missing bind-mounted file must fail clearly, not become an empty directory.
Do not broaden filesystem permissions or run the service as root to mask errors.

Startup validates required settings, readable/valid YAML, and writable storage;
then runs migrations, synchronizes YAML, and replaces the launcher process with
Gunicorn. Any failure stops startup without serving requests. Restarting syncs
YAML idempotently and preserves gifts, purchases, and stable configuration keys.
Support only one application container per SQLite volume; no horizontal scaling.

Add a minimal health endpoint without family data or identity requirements,
checking application/database readiness. Use it for the container health check.
Logs go to stdout/stderr; normal termination reaches Gunicorn cleanly.

## Release automation and cross-project reuse

Publish `ghcr.io/klottick/present-wishlist` using GitHub Actions and the repository
`GITHUB_TOKEN` with minimal read-content/write-package permissions. No new PAT
or Docker Hub account is necessary. Public image visibility must be explicitly
verified; a public source repository alone does not guarantee anonymous pulls.

Use a small `workflow_call` publishing workflow with image name, Dockerfile,
context, and platform inputs. This repository has a release caller; other stacks
can reuse the publisher by immutable commit reference, retaining their own
Dockerfiles and validation jobs. Do not create or change other repositories.

Run application verification and image smoke checks on pull requests without
publishing or granting package-write permissions. Publishing is triggered only
by a published stable GitHub release with a `vMAJOR.MINOR.PATCH` tag. Build and
smoke-test both architectures, then publish their combined manifest, exact version
tag (without `v`), commit-SHA tag, and `latest`. Reject non-increasing stable
versions so an old release cannot move `latest` backward. Serialize publication;
do not cancel a running publish halfway through. No prerelease channels initially.

Buildx/QEMU or native runners may supply ARM execution; report emulated tests
honestly. Failed architecture checks prevent final release tags being published.
Attach `compose.yaml`, sample YAML, and `.env.example` to the GitHub release so
installation does not require cloning the repository. Compose defaults to that
exact release version rather than an unpinned `latest` tag.
Only the attachment job receives `contents: write`; the generic image publisher
does not need permission to modify repository contents or releases.

## Validation and acceptance

Preserve the existing complete verification suite and add focused regressions for
release-setting validation, root/static routing, startup failure/ordering, and
health behavior. Exercise the actual built image, not just Django's test server.

Container checks cover frontend loading, CSRF-protected session selection and gift
creation, buyer marking and recipient-hidden responses, fresh-volume permissions,
restart/replacement persistence, invalid/missing config, and orderly termination.
Use isolated fixtures, ports, volumes, and processes; never touch real family data.
Check both platform manifests and anonymous pulls after publication. End-to-end
release acceptance requires the first real workflow run and published-image test;
local success alone does not establish that the release pipeline works.

README instructions cover first install, secret generation, startup, YAML changes,
version-pinned updates, and backup/restore. Back up with the application stopped
or using SQLite's backup mechanism; warn against `docker compose down -v`.
Take a backup before upgrades; do not promise reverse migrations or automatic
rollback across schema changes. No automatic updater or database replacement.

## Scope and next gate

No authentication, TLS automation, managed hosting, Kubernetes, external database,
or custom AI skill. Existing official Docker skills guide setup, but releases
must work without an AI agent. No source-code changes or publication occur at
this design stage. After written-spec approval, prepare the implementation plan
and agree its execution method. Creating a real release/tag or changing package
visibility requires explicit approval during execution.

## References

- https://docs.docker.com/build/building/multi-platform/
- https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
- https://whitenoise.readthedocs.io/en/stable/

Context7 documentation lookup was attempted but the monthly quota was exhausted;
official documentation was used instead.
