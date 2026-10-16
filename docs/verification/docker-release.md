# Docker release verification — 2026-10-16

## Status

Implementation merged through [PR #1](https://github.com/klottick/present-wishlist/pull/1).
The user separately authorized [v0.1.0](https://github.com/klottick/present-wishlist/releases/tag/v0.1.0),
published from `1ca854af68ca63b1907f530427ce5a086ce4c42e`. Real release workflow,
anonymous pulls, and source-free installation acceptance passed. No GHCR
visibility change was needed or performed. Details and limits are below.

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

## v0.1.0 remote acceptance

- Main [Verify run 38950738618](https://github.com/klottick/present-wishlist/actions/runs/38950738618)
  passed at the release source: 130 backend tests, 81 frontend tests, both browser
  workflows, checks/lint/build, amd64 and QEMU arm64 image smoke.
- [Release run 38951896001](https://github.com/klottick/present-wishlist/actions/runs/38951896001)
  passed `prepare`, `publish / publish`, and `attach`. Raw publishing-job logs
  confirm actual `PASS linux/amd64` and `PASS linux/arm64` before publication.
  This exercised authenticated first-publication absence handling and registry
  writes; it does not prove every registry failure/retry scenario remotely.
- Anonymous registry requests and Docker manifest inspection with a private,
  empty `DOCKER_CONFIG` confirmed exactly Linux amd64/arm64. Anonymous pulls
  fetched amd64 by version and arm64 by immutable platform digest. No credentials
  were copied into that configuration; it remained `{}`. The local GitHub CLI's
  package metadata API lacked `read:packages` scope; no token scope was expanded.
  Public accessibility is established by the actual anonymous manifest/pulls.
- `0.1.0`, `sha-1ca854af68ca63b1907f530427ce5a086ce4c42e`, and `latest` each
  matched the release's `image-digest.txt` and the original registry response's
  `Docker-Content-Digest`/SHA256:

  | Manifest | Digest |
  | --- | --- |
  | Combined | `sha256:89d5bc2f5fccf8e6cb04bf3183a96ece2d52e96488d82fd62f1ea8c72ceef6d2` |
  | Linux amd64 | `sha256:56a06766bd86fbe56a961267c599e8f4163aca1bc3b2d013d368bf4b712d39f4` |
  | Linux arm64 | `sha256:29b32ec09b9dea3043da3798d7165dccf8f2fa9186e60bf3fc6d916fb368294e` |

- Actual downloaded amd64 image passed the complete stdlib smoke again locally:
  static/cache, CSRF, privacy, non-root storage, replacement/restart persistence,
  fail-closed startup and termination. ARM ran under QEMU on GitHub's x86_64
  runner, **not natively or locally**; no privileged local emulation was installed.
- All four assets were downloaded anonymously into an empty, private directory;
  their SHA256 values matched GitHub's asset metadata. GitHub renamed the uploaded
  `.env.example` to **`default.env.example`**. This is documented GitHub filename
  sanitization, not missing file contents. Installation instructions and release
  notes now use the actual attached filename, copied to `.env`. The tag/image were
  not moved or rebuilt; documentation corrections are subsequent commits.
- Downloaded Compose/YAML/environment examples were used without a checkout,
  local build, or development server. Quiet validation and anonymous pull passed.
  The default host port 8000 was already owned by unrelated `qwen-vllm`; that
  service was left untouched. An acceptance-only Compose override changed only
  the published loopback port. The source-free app became healthy.
- Real Chromium selected Alex and created a gift in the published-image UI;
  the gift was visible at 1280×800 and 390×844 with no horizontal overflow.
  Sam marked it purchased through a separate API session. Force-recreating the
  app preserved both sessions, the gift and buyer mark; Alex's response omitted
  all purchase/control fields.
- The app was stopped, SQLite/YAML/secret backed up into host-private `0600`
  files, then restored via stdin into a fresh non-root volume. A second restore
  refused overwrite with `FileExistsError`. Restored UID 10001 / mode `0600`
  database preserved sessions, gift and buyer privacy. Reloading Chromium also
  preserved the original Alex session and gift without purchase details.
- Probe-owned containers, networks and fresh volumes were removed and label
  queries confirmed none remained; unrelated `qwen-vllm` stayed running.
- Remaining limits: no native ARM hardware, real-family LAN deployment or future
  schema upgrade was exercised. These are not claims made by this release.

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

ARM CI and remote release acceptance subsequently passed as recorded above.

## PR review and real CI

- A second independent read-only review examined the actual PR range
  `d571807..f968947`. No Critical, Important, or new Minor findings. The reviewer
  independently passed 37 focused tests, native-amd64 image smoke, actionlint and
  range whitespace checks. The previously accepted smoke diagnostic Minor remains
  deferred; the review was recorded as a PR comment, not a self-approval.
- [GitHub Verify run 38948695732](https://github.com/klottick/present-wishlist/actions/runs/38948695732)
  passed against PR head `f96894713c43db0180999cea0b4c6378e80ec0bf`:
  - `application`: 129 backend tests, 81 frontend tests, both browser workflows,
    Django/dependency checks, lint and build passed.
  - `containers (linux/amd64)`: real build and smoke passed natively on x86_64.
  - `containers (linux/arm64)`: real build and smoke passed using QEMU aarch64
    on an x86_64 runner (emulated, not native ARM).
- Raw job logs confirm both `PASS linux/amd64` and `PASS linux/arm64`, including
  frontend/assets, CSRF, privacy, volume/session persistence, fail-closed startup
  and termination. These read-only CI jobs did not publish registry artifacts.
- The PR merge-preview tree matched the fully verified local source tree. The
  final documentation update is checked again before merging; no release is
  created as part of integration.

### Pre-merge test lifecycle corrections

A fresh local pre-merge verification caught the existing intermittent
`discards an unfinished owner draft when the selected identity changes` failure:
pending React work reached `getItems` after its mock had been reset to return
`undefined`. The suite's nested teardown reset mocks before the outer shared
cleanup unmounted the tree. A deterministic teardown invariant first failed with
the app still mounted; explicitly calling `cleanup()` before the assertion/reset
made it pass. No application behavior was changed.

Stability verification then exposed
`ignores a late list response after the identity generation changes`: its visible
filter did not prove the first list request had started, because catalog loading
is asynchronous. Focus could invalidate the initial catalog before the stale
request existed. The test now waits for the initial API request before triggering
focus, preserving its intended late-response assertion rather than weakening it.

Both failures were investigated rather than hidden by retries. After correction,
all 28 wishlist tests passed six consecutive stability runs (failure-stop, no
retries). Fresh full local verification then passed: 129 backend tests, 81 frontend
tests, both browser workflows, checks, lint and build. Latest-head PR checks are
required again before merge. The changes affect test setup/synchronization only.

The next [CI run 38949578201](https://github.com/klottick/present-wishlist/actions/runs/38949578201)
passed both architecture builds/smokes and all 129 backend/81 frontend tests,
but the phone browser workflow timed out. Context cleanup's secondary protocol
error masked the stalled operation, and the initial CI configuration uploaded no
failure artifacts. This blocked merge at that point. CI now retains failed browser traces
for seven days and enables Playwright API/browser diagnostics; neither retries
nor larger timeouts are used to turn this failure green. The instrumentation is
covered by a workflow contract that failed before the change.

The subsequent latest-head PR run 38950219083 and main run 38950738618 passed
all checks before/after merge; six additional local browser stress workflows
also passed. The earlier phone timeout remains **unexplained, not fixed**. The
successful runs did not exercise failure-artifact upload. This limitation is
retained in release notes rather than concealed by a retry or larger timeout.

## Explicit execution decisions

- Add an optional caller-owned pre-publication eligibility hook rather than
  coupling the generic publisher to wishlist release code. Other callers must
  supply their own ordering guard; omitting it leaves their retry ordering unsafe.
- Keep remote acceptance as real checks, not simulated success. Verification,
  release Actions, both architecture smokes, anonymous pulls and downloaded
  installation gates passed for v0.1.0. No authorization for future releases or
  package visibility changes is inferred from this release.
- Accept non-atomic registry alias updates as designed, with explicit partial-run
  diagnosis/repair. Risk: a registry failure can temporarily leave aliases on
  different digests; stable tags must not be blindly overwritten.
