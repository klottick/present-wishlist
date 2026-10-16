# Prebuilt Docker Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute a tested, public, multi-platform wishlist image that users run without building source or installing Python/Node.

**Architecture:** One non-root container serves the compiled React frontend and Django API through Gunicorn/WhiteNoise. A read-only family YAML mount and named SQLite volume hold user configuration/data. A small reusable GitHub workflow builds/tests images before publishing versioned multi-platform manifests to GHCR.

**Tech Stack:** Python 3.14, existing Django/React/Vite stack, Gunicorn, WhiteNoise, Docker Buildx, Compose v2, GitHub Actions/Container Registry.

**Spec:** `docs/superpowers/specs/2026-10-16-docker-release-design.md` (user approved).

## Global Constraints

- Publish Linux images for both `amd64` and `arm64`; no 32-bit ARM support.
- One image, one container, one port; no Node runtime, Vite server, proxy container, or external database.
- Preserve existing development/test settings and the complete verification suite.
- Release settings disable debug mode and require a non-development `DJANGO_SECRET_KEY`.
- Default published port: `127.0.0.1:8000:8000`.
- Read-only bind mount: `./family.yaml` to `/config/family.yaml`.
- Named persistent volume: `/data`, database `/data/wishlist.sqlite3`.
- Support only one application container per SQLite volume; no horizontal scaling.
- Run as a fixed non-root user; no root startup permission repairs or world-writable storage.
- API paths retain JSON errors and `no-store` privacy; no broad SPA fallback.
- Official base images with explicit versions; pin added Python dependencies and CI actions to reviewed commit SHAs.
- Publishing is triggered only by a published stable GitHub release with a `vMAJOR.MINOR.PATCH` tag.
- Publish exact version (without `v`), commit-SHA, and `latest` tags only after both architectures pass smoke tests.
- Reject non-increasing stable versions; serialize publication without canceling running publication.
- Only the attachment job receives `contents: write`; generic publisher receives read-content/write-package permissions.
- No authentication, TLS automation, managed hosting, Kubernetes, external database, or custom AI skill.
- No real release/tag creation, push, or package visibility change without explicit execution-stage approval.

## Review Focus

1. Fresh or read-only storage: first-run non-root volume ownership works; failures must stop before serving or mutating the database (Tasks 2–3).
2. Unexpected paths and stale browser caches: missing assets/API endpoints never become HTML; root revalidates while immutable assets remain cacheable (Tasks 1 and 3).
3. Bad configuration and proxy headers: reject unsafe secret/host/origin input without leaking values, and never infer HTTPS/host identity from untrusted forwarding headers (Tasks 1–3).
4. Restart/upgrade with an existing session: preserve identity, gifts, and purchase marks without startup duplication or surprise disclosures (Task 3).
5. Delayed/out-of-order or failed releases: invalid/older versions and either architecture's failed check cannot move final tags; public source does not imply public image pulls (Tasks 4–6).

## File boundaries and execution order

1. Release-only settings/WSGI/static serving and health: new `backend/project/release_settings.py`, `release_wsgi.py`, `release_urls.py`, `frontend_static.py`, `health.py`; tests in `backend/wishlist/tests/test_release_runtime.py`; pinned runtime dependencies in `backend/requirements.txt`.
2. Startup: `scripts/container_entrypoint.py`; tests in `backend/wishlist/tests/test_container_startup.py`.
3. Image/install/smoke: `.dockerignore`, `Dockerfile`, `compose.yaml`, `.env.example`, `family.example.yaml`, `scripts/smoke_container.py`; smoke ownership tests in `backend/wishlist/tests/test_container_smoke.py`.
4. Release metadata/bundle: `scripts/release_metadata.py`; tests in `backend/wishlist/tests/test_release_metadata.py`.
5. Automation: `.github/workflows/ci.yaml`, `publish-image.yaml`, `release.yaml`; workflow contract tests in `backend/wishlist/tests/test_release_workflows.py`.
6. User instructions/acceptance: `README.md`, `docs/verification/docker-release.md`; approved design status updated at completion.

Tasks 1–3 are a coupled runtime chain. Task 4 is independent of image internals, but Task 5 requires Tasks 3–4. Task 6 follows integration. Do not dispatch agents during planning; the user selects execution method after reviewing this plan.

---

### Task 1: Release settings, frontend serving, and readiness

**Files:** Create the five release/runtime modules and `test_release_runtime.py` listed above; modify `backend/requirements.txt`. Leave `project/settings.py`, `project/wsgi.py`, and their development contracts unchanged.

**Interfaces:**
- `project.release_settings` imports existing settings then overrides release constants; `DJANGO_SETTINGS_MODULE=project.release_settings` is the release selector.
- `project.frontend_static.wrap_frontend(application: WSGIApplication, root: Path) -> WSGIApplication` wraps a supplied app with WhiteNoise.
- `project.health.health(request: HttpRequest) -> JsonResponse`, mounted at `/healthz/` by `project.release_urls` alongside existing `/api/` routes.
- `project.release_wsgi.application` initializes Django using release settings, then wraps it using `FRONTEND_DIST_PATH` (default `<repo>/frontend/dist`).

- [ ] **1. Write parameterized release-setting tests using fresh subprocesses**, not module reloads that alter shared Django settings. Assert `DEBUG is False`, `ROOT_URLCONF == 'project.release_urls'`, no development CSRF origins, `USE_X_FORWARDED_HOST is False`, and `SECURE_PROXY_SSL_HEADER is None`.
  Test missing, surrounding-whitespace, development, placeholder, short (<50 characters), and low-diversity (<5 distinct characters) secrets fail without echoing the secret. A generated 64-character random hex secret succeeds.
  `DJANGO_ALLOWED_HOSTS` extends internal `localhost,127.0.0.1,[::1]`; trim/deduplicate exact DNS/IP names. Reject `*`, suffix wildcards, URLs, ports, empty entries, and invalid DNS/IP syntax. `DJANGO_CSRF_TRUSTED_ORIGINS` defaults empty; allow exact HTTP/HTTPS origins including non-default ports/IPv6, but reject credentials, wildcard hosts, paths, queries, fragments, whitespace, malformed ports, or empty list entries.
  Named cases: `test_release_defaults_are_not_development_settings`, `test_rejects_unsafe_secret_without_disclosure` (`assert result.returncode != 0; assert secret not in result.stdout + result.stderr`), and `test_rejects_nonexact_hosts_and_origins`. Probe subprocesses print only non-secret settings on successful imports.
- [ ] **2. Run RED:** `.venv/bin/python backend/manage.py test wishlist.tests.test_release_runtime --settings=project.test_settings --keepdb`. New module/import failures establish missing behavior; ensure existing cases remain unaffected.
- [ ] **3. Implement release settings and pin dependencies.** Use Gunicorn `26.2.0` and WhiteNoise `6.12.0` (PyPI metadata checked during planning); resolve and pin any newly required transitive package rather than leaving an unbounded addition. Use `/config/family.yaml` and `/data/wishlist.sqlite3` release defaults, retaining explicit `FAMILY_CONFIG_PATH`/`WISHLIST_DB_PATH` overrides. Do not install dependencies outside the project environment.
- [ ] **4. Write WSGI/readiness tests before implementing those modules.** Build a temporary `index.html` and `/assets/main-abc12345.js`; assert `/` returns HTML with `Cache-Control: no-cache`, hashed asset returns JavaScript with immutable caching, conditional root GET can return 304, `/assets/missing.js` is 404, and a downstream sentinel/API error is unchanged. Assert ordinary/non-hashed files are not immutable and static CORS is disabled. Through the release URLconf test `/api/missing/` returns JSON 404 with `no-store`. GET/HEAD `/healthz/` is non-sensitive/no-store and 200 with migrated tables, 503 on database errors with no exception text; unsafe methods return 405.
  Named cases: `test_root_revalidates_but_hashed_assets_are_immutable`, `test_missing_asset_does_not_return_index`, `test_unknown_api_remains_json_no_store`, and `test_health_database_failure_is_nonsensitive` (`self.assertEqual(response.status_code, 503); self.assertNotContains(response, 'sqlite', status_code=503)`).
- [ ] **5. Run RED for these new tests**, then implement WhiteNoise wrapping with `index_file=True`, `autorefresh=False`, `allow_all_origins=False`, immutable recognition limited to hashed `/assets/` filenames, and a header callback forcing root HTML to revalidate. Require an existing readable `index.html`. Health checks query an application table and the session table; an empty configured family is still healthy. Do not add a catch-all UI route or change API serialization.
- [ ] **6. Run GREEN:** repeat the focused command, then `.venv/bin/python backend/manage.py test wishlist --settings=project.test_settings --keepdb` and `.venv/bin/python -m pip check`. Verify development WSGI does not start serving built frontend files.
- [ ] **7. Commit only Task 1 files:** `feat: add release runtime and same-origin frontend serving`.

### Task 2: Fail-closed container startup

**Files:** Create `scripts/container_entrypoint.py` and `backend/wishlist/tests/test_container_startup.py`.

**Interfaces:** `container_entrypoint.main() -> int` is invoked by the image's exec-form entrypoint; it consumes Task 1 settings. Reuse `wishlist.configuration.loader.load_family_config(path: Path) -> FamilyConfig` for YAML validation and existing `migrate`/`sync_family_config` management commands. No copy of YAML validation or synchronization logic.

- [ ] **1. Write startup-order/failure tests** using the existing importlib launcher-test pattern inside fresh subprocesses with isolated release environment/config/database/frontend paths, so global Django test settings cannot select the real or shared test database. Narrowly mock management-command calls and final `os.execvp` for failure injection/order assertions; actual migration/sync behavior is exercised by Task 3. Assert validate → migrate → sync → exec order, no server on any preceding failure, release settings forced even when environment requests development settings, and no secret in diagnostics. Invalid/missing/directory YAML, missing frontend, unwritable parent, or read-only existing DB must fail before management commands. Use a real non-root/read-only-volume check in Task 3 rather than trusting root-sensitive `chmod` tests.
  Named cases: `test_preflight_failure_prevents_database_commands` (`assert commands == []; assert not exec_called`), `test_migrate_failure_prevents_sync_and_exec`, `test_sync_failure_prevents_exec`, and `test_success_execs_exact_single_worker_contract`.
- [ ] **2. Run RED:** `.venv/bin/python backend/manage.py test wishlist.tests.test_container_startup --settings=project.test_settings --keepdb`.
- [ ] **3. Implement the entrypoint.** Set umask `0077`, establish backend import path, force release settings, initialize Django, validate settings/YAML/frontend, and probe actual database-parent writability with a uniquely named temporary file removed immediately. Check an existing DB is a writable regular file without truncation. Run management commands serially, then `os.execvp('gunicorn', argv)`.
  Exact server contract: `project.release_wsgi:application`, bind `0.0.0.0:8000`, `--workers 1 --worker-class gthread --threads 4 --timeout 60 --graceful-timeout 20 --access-logfile - --error-logfile - --forwarded-allow-ips '' --no-control-socket --umask 0077`. Set the working directory to the backend. Do not forward arbitrary commands, enable reload, or run migrations in each Gunicorn worker.
- [ ] **4. Assert failure isolation and exec arguments**, including that a failed migrate prevents sync, failed sync prevents exec, all checks use the same resolved config/database paths, and permission probes leave no files. Catch operational errors with actionable messages, never a retry loop or secret dump.
- [ ] **5. Run GREEN:** focused startup tests, Task 1 tests, then the full backend suite. Use a temporary migrated SQLite file and valid sample YAML for an actual launcher startup/termination probe once Task 3 supplies the image.
- [ ] **6. Commit:** `feat: add fail-closed container startup`.

### Task 3: Pull-only Compose installation and verified non-root image

**Files:** Create `.dockerignore` first, then root `Dockerfile`, `compose.yaml`, `.env.example`, `family.example.yaml`, `scripts/smoke_container.py`, and `backend/wishlist/tests/test_container_smoke.py`.

**Interfaces:**
- Image layout: `/app/backend`, `/app/frontend/dist`, `/app/scripts/container_entrypoint.py`; UID/GID `10001:10001`; `/data` owned by that identity with mode `0700` before switching user.
- `python3 scripts/smoke_container.py --image IMAGE --platform linux/amd64|linux/arm64` exits 0 only when all real-container checks pass. It requires only host Python's standard library and Docker, so the reusable publisher needs no wishlist toolchain setup.
- Compose service `app`, named volume `wishlist-data`; image `${WISHLIST_IMAGE:-ghcr.io/klottick/present-wishlist}:${WISHLIST_VERSION:?Set WISHLIST_VERSION}`. Require `DJANGO_SECRET_KEY`, accept `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`, and publish `${WISHLIST_BIND_ADDRESS:-127.0.0.1}:8000:8000`. No `build:` entry.

- [ ] **1. Write smoke resource-ownership tests** for a small `main(argv: list[str] | None = None) -> int` orchestrator: command failures preserve exit status/diagnostics; readiness timeout prints owned logs; interruption/failure cleans every created resource once; never removes resources it did not create. Mock Docker only in these lifecycle tests; application behavior must be tested against the real image.
  Named cases: `test_readiness_failure_cleans_only_owned_resources`, `test_cleanup_continues_after_one_resource_failure`, and `test_primary_failure_is_not_hidden_by_cleanup` (`assert exit_code != 0; assert unrelated_name not in removed_names`).
- [ ] **2. Implement the real smoke probe before the image.** Use unique run-labelled container/volume names and a private directory under `/tmp/opencode` (create parent safely). Write an Alex/Sam YAML fixture, generate a private secret, allocate published ports with `127.0.0.1::8000`, and discover the assigned port from Docker. Wait with deadlines (up to 120s for emulation), not fixed sleeps. In `finally`, remove only containers/volumes/private files created by this invocation, preserving logs on assertion failure.
  Checks: health becomes healthy; effective UID is 10001; `/data` is writable and not world-readable; no DB existed before runtime; Node/npm and personal config are absent. Fetch root and every referenced local JS/CSS asset, validate status/MIME/cache headers, and assert unknown asset/API behavior. Use separate cookie jars to select Alex and Sam with GET-session CSRF bootstrap and PUT-session; POST an Alex gift, PUT its purchase as Sam, and assert buyer data is absent for Alex. Reject writes without a CSRF token and with a foreign Origin; reject an unallowed Host on an API request; verify spoofed forwarding headers do not alter same-origin behavior.
  Stop/remove the app container without deleting its volume; recreate with identical mounts/secret and confirm the same session cookies, gift IDs, and marks persist. Restart once more to check idempotent YAML sync. Check missing/invalid YAML, missing secret, and read-only storage fail without serving. Stop with a 30s grace period and fail if SIGKILL was needed. Runtime API failures and unknown paths must not expose stack traces or secret values.
- [ ] **3. Run RED:** `.venv/bin/python backend/manage.py test wishlist.tests.test_container_smoke --settings=project.test_settings --keepdb`, then the real smoke command against a nonexistent local image. Require a clear missing-image failure; no source-server fallback. Then write `.dockerignore` and image/Compose files.
- [ ] **4. Implement the multi-stage image.** Use Node `24.21.0-slim` at build platform and Python `3.14.4-slim` for target runtime. Both manifests were checked for amd64/arm64 during planning. Keep frontend dependency install cached by copying lockfiles before sources. Install pinned Python runtime requirements, upgrade project-image pip to at least 26.2, copy only runtime backend files/launcher/built assets, and exclude backend tests if not needed at runtime. Create `/data` ownership before `USER 10001:10001`; do not initialize a database or declare an anonymous `VOLUME`. Use exec-form entrypoint and `EXPOSE 8000`; healthcheck calls `http://127.0.0.1:8000/healthz/` with Python urllib, with a short request timeout. Include OCI source/revision labels supplied by CI.
  `.dockerignore` excludes `**/.npmrc`, `.env*` except the intentional example, all personal YAML/databases, `.git`, virtualenv/node_modules, browser/test outputs, and agent scratch files. No broad copy may undo these exclusions. Source image contains no family-specific data.
- [ ] **5. Implement Compose/sample files.** Use long bind-mount syntax with `read_only: true` and `bind.create_host_path: false`; preserve named-volume copy-up ownership. Add `restart: unless-stopped` and `stop_grace_period: 30s`, but no forced container name. Sample YAML has Alex/Sam and Birthday/Christmas; `.env.example` has an empty required secret, illustrative `WISHLIST_VERSION=0.1.0`, and loopback defaults. The example version is not a claim that 0.1.0 is published.
- [ ] **6. Run GREEN:** focused ownership tests; `docker buildx build --platform linux/amd64 --load -t present-wishlist:smoke .`; `python3 scripts/smoke_container.py --image present-wishlist:smoke --platform linux/amd64`. Repeat with an arm64 tag/platform under an existing emulator or native runner. Do not register privileged host binfmt handlers without approval; if local emulation is unavailable, require the ARM CI check rather than claim ARM execution.
  In a private install directory, copy only Compose/sample files, supply a secret and local image override, run `docker compose config --quiet`, then `up -d` and the HTTP/session/persistence checks. Use existing Playwright/browser tooling to load this actual Compose-served frontend at both existing viewports (1280×800 and 390×844); confirm the name picker renders, select a name, and create a gift through the UI. This is separate from the stdlib probe and must not silently use Vite. Test missing YAML/secret paths explicitly. Clean only this test's project with its isolated volume; never apply `down -v` to a user's installation. Run the complete existing `bash scripts/verify.sh` after integration.
- [ ] **7. Commit:** `feat: package wishlist as a persistent non-root container`.

### Task 4: Stable-release guard and downloadable install bundle

**Files:** Create `scripts/release_metadata.py` and `backend/wishlist/tests/test_release_metadata.py`.

**Interfaces:**
- `parse_version(tag: str) -> tuple[int, int, int]`: accept only canonical `vMAJOR.MINOR.PATCH` (no leading zeros except zero, prerelease/build suffix, whitespace, or shell metacharacters).
- `validate_release(current: dict, releases: list[dict]) -> str`: verify current is published/non-draft/non-prerelease, exclude its own numeric release ID, require its numeric version strictly above every other published canonical stable version, return version without `v`.
- `write_bundle(source: Path, destination: Path, version: str) -> None`: copy `compose.yaml`, `family.example.yaml`, `.env.example`; replace only the `.env.example` image version with the validated exact version, retaining the empty required secret.
- CLI: `python3 scripts/release_metadata.py --event EVENT_JSON --releases RELEASES_JSON --bundle-dir OUTPUT`, printing `version=...` for the caller to add to `$GITHUB_OUTPUT`. Read JSON downloaded with paginated authenticated `gh api`, not a truncated release list. Do not put tokens in bundle files.

- [ ] **1. Write tests before the helper.** Assert `v1.10.0 > v1.9.9`, `v0.1.0` works with no prior releases, older/equal-other-ID versions fail, own release ID is ignored, and draft/prerelease/invalid tags fail before producing a bundle. Invalid unrelated historic tags are ignored rather than parsed as a new version. Test an older event queued after a newer published release is rejected, and a failed/empty-body/malformed release-list response cannot become an empty successful history (a valid JSON `[]` is allowed for the first release). Bundle test reads copied files and asserts exact version, empty secret, no `latest` default, and source files unchanged.
  Named cases: `test_versions_sort_numerically` (`assert parse_version('v1.10.0') > parse_version('v1.9.9')`), `test_old_queued_release_cannot_advance_latest`, `test_malformed_history_fails_closed`, and `test_bundle_pins_only_its_requested_version`.
- [ ] **2. Run RED:** `.venv/bin/python backend/manage.py test wishlist.tests.test_release_metadata --settings=project.test_settings --keepdb`.
- [ ] **3. Implement only the metadata/asset helper** using the Python standard library. Keep GitHub networking/credentials in workflow steps; helper receives event/history fixtures and fails with concise diagnostics. Never execute or interpolate a tag as shell source.
- [ ] **4. Run GREEN:** focused tests plus full backend suite. Generate a `0.1.0` bundle in a private temp directory and validate Compose using a generated test secret without printing resolved secret-bearing configuration.
- [ ] **5. Commit:** `feat: validate stable releases and prepare install assets`.

### Task 5: CI and reusable multi-platform publishing

**Files:** Create `.github/workflows/ci.yaml`, `publish-image.yaml`, `release.yaml`, and `backend/wishlist/tests/test_release_workflows.py`.

**Interfaces:**
- Reusable `publish-image.yaml` exposes `workflow_call` inputs `image` (required), `version` (required numeric stable string), `context` (default `.`), `dockerfile` (default `Dockerfile`), `platforms` (default `linux/amd64,linux/arm64`), and `smoke-command` (required). It outputs `digest` for the combined manifest. Derive immutable source revision from checked-out release commit, not `github.event.release.target_commitish` (which can be a moving branch).
- This project's smoke command is `python3 scripts/smoke_container.py --image "$IMAGE" --platform "$PLATFORM"`. Pass command/input strings through environment variables rather than embedding untrusted expressions into shell code. Caller-controlled smoke commands are executable trusted repository code, never PR titles/release descriptions.
- Generic publisher checks out the **caller repository**, builds its Dockerfile, and invokes its smoke command; it must not depend on this project's Python modules, script paths, or Compose layout.

- [ ] **1. Write workflow contract tests before YAML.** Parse using existing PyYAML with `BaseLoader` so YAML 1.1 does not turn `on` into boolean. Assert CI has `pull_request`/main-push triggers with read-only permissions, no publishing or `pull_request_target`; release trigger is only `release: types: [published]`, excludes draft/prerelease, and has whole-workflow repository-specific concurrency with `cancel-in-progress: false`. Assert prepare/verify → publisher → attachment dependencies, minimal per-job permissions, required workflow_call inputs, action SHA pins, and no wishlist-specific imports in the generic publisher. These structural tests are not substitutes for a real Actions run.
  Named cases: `test_pr_workflow_cannot_publish`, `test_publisher_is_caller_stack_independent`, `test_release_publication_is_serialized` (`assert concurrency['cancel-in-progress'] == 'false'` with BaseLoader), and `test_release_assets_require_successful_publish`. Disallow `continue-on-error` and `always()` on the build/smoke → publishing path.
- [ ] **2. Run RED:** `.venv/bin/python backend/manage.py test wishlist.tests.test_release_workflows --settings=project.test_settings --keepdb`.
- [ ] **3. Implement read-only CI.** Install Python 3.14/Node 24, create `.venv`, upgrade pip, install pinned requirements, run `npm --prefix frontend ci`, provision Playwright Chromium/OS dependencies on the disposable runner, and execute `bash scripts/verify.sh`. Build/smoke both image platforms with QEMU or native runners; grant no package-write permission. Preserve no-retry test semantics and isolate ports/volumes.
- [ ] **4. Implement the generic publisher with standard Docker actions/Buildx.** Resolve current supported checkout/setup-buildx/setup-qemu/login action versions from official releases and pin their full commit SHAs before committing. Do not blindly copy stale sample SHAs.
  Use one runner/job for a simple sequential platform loop: build each platform with `--load` under a unique local tag, invoke the smoke command with `IMAGE`/`PLATFORM`, and retain both tested images locally. Only after every smoke succeeds, authenticate to GHCR with `GITHUB_TOKEN`, push architecture-specific staging tags, capture their immutable manifest digests, and create the combined final manifest from those exact digests (never rebuild after testing). Apply version, `sha-<full-commit>`, and `latest` aliases and output the combined digest. A failed build/smoke must run no login/push/promotion step; later registry failures must fail visibly rather than report a successful release. Do not promise atomic updates across three registry tags.
  Give the Bash build/test step `id: build-smoke` and explicit `set -euo pipefail`; keep login/push/promotion in later default-success-only steps. Add `test_second_platform_failure_exits_build_step`: execute the actual YAML run block with a private stub Docker executable and a smoke command returning 17 for arm64; `assert result.returncode == 17`, with no registry-writing command in the recorded calls. Do not use a mocked registry to claim actual publishing works.
  Source/revision/version OCI labels accompany the tested images. Refuse an already-present exact-version tag; authentication/network errors during this check must fail closed, not count as tag absence. Diagnose partially published runs and require explicit repair/recovery rather than silently overwriting stable tags or retagging older artifacts as `latest`. A fully published version may retry only asset attachment without republishing images.
- [ ] **5. Implement the project release caller.** Under the whole-workflow concurrency lock, checkout the event tag with sufficient history, obtain the full current release and paginated release history, run Task 4's helper, install application-test dependencies, and rerun verification. The publisher receives prepared version plus default platforms and the Task 3 command. After successful publication, a separate attachment job generates/uploads the three bundle files and a release digest summary using `contents: write`; other jobs retain `contents: read`. The package publisher alone receives `packages: write`.
- [ ] **6. Run GREEN:** workflow contract tests, full backend suite, and actionlint (if absent, obtain the official pinned binary under `/tmp/opencode`, not a system installation). Review exact permissions/secret flow, numeric-version guard, same tested-image promotion, and output wiring manually. Run image smoke commands locally for both platforms where supported. A real CI/release run remains the final gate in Task 6; YAML parsing/lint cannot prove registry permissions or action execution.
- [ ] **7. Commit:** `ci: verify containers and publish reusable multi-platform releases`.

### Task 6: Installation documentation, review, and first-release acceptance

**Files:** Modify `README.md`, the Docker design's status, and create `docs/verification/docker-release.md`. Fix only concrete integration findings in earlier task files, with regressions.

**Interfaces:** User installs just release `compose.yaml`, `family.example.yaml`, and `.env.example`; copies examples to `family.yaml` and `.env`, generates a stable secret (e.g. `openssl rand -hex 32`), and runs Compose. No source clone or local build is required.

- [ ] **1. Document the install/update path** separately from existing source development. Explain both Linux architectures/64-bit ARM, Docker Desktop Linux-container mode, selecting an exact release version, stable secret/session behavior, URL `http://localhost:8000`, logs/health, and restart after YAML edits. For LAN use show explicit bind-address/hostname changes, not wildcard allowed hosts; keep the trust-model warning prominent.
- [ ] **2. Document operational safety.** Stop before filesystem backups, copy the database plus family YAML and private `.env`, restore into a volume with UID/GID 10001 ownership, and test restoration using isolated resources. Prefer `docker compose stop`/`start` for backup so a private helper container can mount the declared volume. Explain `pull` → `up -d` updates after backup, no automatic schema rollback, and that `down -v` destroys stored data. Include troubleshooting for missing YAML, invalid secret/hosts, wrong permissions, unhealthy startup, unsupported platform, and private-package pull errors. Do not print or commit private secret values.
- [ ] **3. Document cross-stack reuse** with a tiny example caller pointing to this publisher at an immutable commit and supplying image/context/Dockerfile/platforms/smoke-command. Explain that each project owns its tests/release-version gate/concurrency and runtime packaging; no new repositories or abstraction library are required.
- [ ] **4. Obtain a fresh whole-change review** against the approved spec and this plan; provide self-contained context and actual diff. Validate findings before fixes. Rerun `bash scripts/verify.sh`, both platform smoke probes, isolated Compose install/replacement/backup-restore, and `git diff --check` after any correction. Record exact commands/results, native vs emulated runs, unresolved limits, and reviewed revision in the verification document. Do not mark publication complete yet.
- [ ] **5. Commit local implementation/docs using Conventional Commits**, then ask for explicit approval to push the implementation and publish the first `v0.1.0` release (or another user-selected canonical version). Do not infer this approval from approval of the spec/plan. If denied or deferred, stop with a verified local implementation and clearly pending publication.
- [ ] **6. After publication authorization**, push the approved commit/tag and create the stable GitHub release; observe all CI/release jobs through completion. If first-time GHCR visibility is private, request/confirm the authorized change to public; do not compensate with end-user credentials or a new PAT. Failures require diagnosis, not repeated blind releases.
- [ ] **7. Verify the published product anonymously.** Use a private empty `DOCKER_CONFIG` directory so cached login cannot mask access restrictions; inspect the exact-version manifest for both architectures and matching expected combined digest. Pull/smoke each platform by published reference, fetch the three release assets into a fresh private directory, supply test config/secret, and run the exact documented Compose install without source checkout/builds. Confirm persistence and recipient privacy. The matching `latest`/SHA references must resolve to the expected release digest.
- [ ] **8. Record the actual release URL/version/digests/results**, commit final evidence, and report any post-release documentation commit separately. Leave unrelated images, builders, networks, data, and global settings untouched. Only call the Docker release complete when the real workflow and anonymous install have passed.

## Planning self-review and execution gate

Coverage: image/static/runtime and security → Tasks 1–3; YAML/storage/startup and lifecycle → Tasks 2–3; canonical version/order/asset bundle → Task 4; reuse/permissions/two-platform publishing → Task 5; installation/backup/review/public pull/real workflow acceptance → Task 6. Each Review Focus case has an explicit test owner above. Signatures, environment names, mount paths, port, UID/GID, and CLI flags are consistent across tasks.

Planning checks used read-only registry inspection: Python `3.14.4-slim` and Node `24.21.0-slim` have both target manifests. PyPI reports Gunicorn `26.2.0` and WhiteNoise `6.12.0`; official docs confirm the referenced WhiteNoise API and Gunicorn flags. Context7 quota was exhausted, so official docs were consulted. No image was built, dependencies installed, app code changed, or remote release created during planning.

Local tooling: Docker Engine 29.7.2 and Buildx 0.36.1 on amd64. ARM runtime support must be demonstrated during execution; base-image availability alone does not demonstrate it.

**Execution recommendation:** Native implementation in this session with one fresh whole-change reviewer, because the six tasks share a tight settings/startup/image/release interface and KISS is an explicit priority. Subagent-driven implementation with fresh per-task reviewers is also available if the user prefers stronger intermediate gates. Wait for plan approval and method selection before implementation.
