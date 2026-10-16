# Docker release verification — 2026-10-16

## Status

Local implementation on `feat/docker-release`; **no release published**. Push,
release/tag creation, and any GHCR visibility change require explicit approval.
Local results are not proof of Actions execution or anonymous registry access.

## Evidence

- Baseline `bash scripts/verify.sh`: 92 backend / 81 frontend tests, lint/build,
  Django checks/migration consistency, dependencies, both browser workflows pass.
- New release runtime/startup/smoke ownership/release metadata/workflow contracts
  were written first and failed for missing implementation, then passed.
- `docker buildx build --platform linux/amd64 --load -t present-wishlist:smoke .`:
  successful native amd64 build (Docker Engine 29.7.2, Buildx 0.36.1).
- `python3 scripts/smoke_container.py --image present-wishlist:smoke --platform linux/amd64`:
  passes compiled HTML/JS/CSS and cache checks, CSRF/session writes, untrusted
  Host/Origin rejection, spoofed forwarding headers, buyer/recipient privacy,
  fresh non-root storage, replacement/restart session/data preservation, invalid
  config/missing secret/read-only volume failures, and clean SIGTERM shutdown.
- Image inspected: user `10001:10001`, exec-form entrypoint, ~60 MB reported by
  Docker; no Node/npm, baked YAML, or preinitialized database.
- Isolated pull-only Compose probe copied only installation files, supplied a
  private test secret and local-image override, and became healthy. No source
  server or build step was used. Missing YAML failed without creating a directory;
  missing secret failed quiet Compose validation.
- Real Chromium loaded that Compose-served compiled frontend at **1280×800** and
  **390×844**, selected Alex and created one gift per viewport, with no JS errors.
- With that Compose app stopped, SQLite was copied and restored into a fresh
  non-root volume. Both browser-created gifts were preserved. Only probe-owned
  containers, network, volumes and temporary files were cleaned up.
- A smoke failure exposed Docker's ephemeral port changing on restart. A separate
  Docker-only probe confirmed that behavior; smoke now rediscovers the origin.
- Generated version-pinned release bundle passed `docker compose config --quiet`.
- Workflow failure test executes the actual build/smoke Bash block: second
  platform returns **17**, the block returns **17**, and no registry write occurs.
- Official action releases resolved to full commit pins. Official actionlint
  **1.7.12** archive SHA256 verified before use; all workflows pass actionlint.

## Remaining acceptance gates

- This host advertises only amd64 execution; **ARM has not run locally**. No
  privileged host emulation was installed. CI explicitly builds/smokes arm64 with
  QEMU on its disposable runner; success there is required before publication.
- After separate authorization, push and observe actual CI and first stable
  release workflow. Registry permission/absence-check behavior is not yet proven.
- Confirm GHCR public visibility. With a private, empty `DOCKER_CONFIG`, inspect
  both platform manifests and pull the published images anonymously; match exact
  version, full-SHA and latest digests with the Actions output.
- Download attached install files into a fresh directory and follow README
  installation without checkout/builds; recheck persistence and purchase privacy.
- Record actual release URL, version, combined/platform digests and native/emulated
  results. None are available yet, so this is not a completed Docker release.

## Independent review and corrections

One fresh-context, read-only review examined `e5493f2..03ac8c0` against the approved
spec and six-task plan. No Critical findings; three Important findings were
verified and fixed in `41af090209bf25666410809a976e3d8bcb2baa41`:

1. Successful preparation can be reused when retrying a failed publishing job,
   after a newer release has published. Added a generic trusted caller
   `pre-publish-command` hook; this caller refreshes release history/eligibility
   inside every publisher attempt before login. Regression simulates old `1.0.0`
   with newer `1.1.0` and rejects it before publication.
2. The original restore example bind-mounted host-owned `0600` backups into a
   UID-10001 helper; a live regression reproduced `PermissionError`. The corrected
   README streams private database bytes through host stdin, restores readable
   YAML, and keeps `.env` private. The same isolated real-image regression now
   preserves the session/gift and rejects attempts to overwrite an existing DB.
3. Relative runtime paths changed meaning after `chdir`. Startup now resolves and
   exports path overrides before settings initialization, preserving them through
   `exec` into Gunicorn. The relative-path subprocess regression failed first and
   passes with absolute paths consistently used in preflight, migrations and sync.

Additional acceptance found that GitHub CLI disallows `--slurp` with `--jq`.
Reproduced using the checksummed official CLI **2.102.0** in scratch storage (the
host's older CLI did not support `--slurp`). Pagination now uses separate
`jq -e 'add'` under `pipefail`. The actual workflow-block regression verifies all
pages are retained and an API failure cannot produce successful preparation.
A read-only real CLI request with the corrected pipeline returned valid `[]` for
this repository. This is not a simulated successful release.

Deferred Minor: fail-closed smoke checks for Gunicorn's “Listening at:” only in
stdout, although Gunicorn logs it to stderr. The nonzero startup-exit assertions
still run; combining both log streams would strengthen that diagnostic assertion.

## Post-correction local validation

- `bash scripts/verify.sh`: **129 backend tests, 81 frontend tests, 2 browser
  workflows passed**, plus Django checks/migration consistency, dependency check,
  frontend lint and production build.
- `/tmp/opencode/actionlint-1.7.12/actionlint -color`: no findings.
- Rebuilt `present-wishlist:smoke` natively for `linux/amd64` using the root Dockerfile.
- Repeated actual amd64 stdlib smoke: passed, including replacement/restart,
  privacy, read-only storage and termination.
- Repeated isolated Compose backup/restore using the corrected README helper,
  host-private backup files, and rebuilt non-root image: session/gift preserved,
  existing database not overwritten; only probe resources cleaned.
- Repeated actual rebuilt-image Compose UI probes at 1280×800 and 390×844:
  choose Alex, create a gift, no JavaScript errors. Removed/recreated the Compose
  app without removing its volume; both UI-created gifts remained.
- `git diff --check`: clean.

ARM and remote release checks above remain pending, not passing or waived.

## Explicit execution decisions

- Add an optional caller-owned pre-publication eligibility hook rather than
  coupling the generic publisher to wishlist release code. Other callers must
  supply their own ordering guard; omitting it leaves their retry ordering unsafe.
- Keep ARM, Actions, first-package behavior and anonymous pull checks as gated
  remote acceptance, not simulated success. Risk: infrastructure integration
  defects may still appear after authorization; the release is not yet accepted.
- Accept non-atomic registry alias updates as designed, with explicit partial-run
  diagnosis/repair. Risk: a registry failure can temporarily leave aliases on
  different digests; stable tags must not be blindly overwritten.
