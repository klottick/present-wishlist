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
- Obtain independent whole-change review and record final verification below.
- After separate authorization, push and observe actual CI and first stable
  release workflow. Registry permission/absence-check behavior is not yet proven.
- Confirm GHCR public visibility. With a private, empty `DOCKER_CONFIG`, inspect
  both platform manifests and pull the published images anonymously; match exact
  version, full-SHA and latest digests with the Actions output.
- Download attached install files into a fresh directory and follow README
  installation without checkout/builds; recheck persistence and purchase privacy.
- Record actual release URL, version, combined/platform digests and native/emulated
  results. None are available yet, so this is not a completed Docker release.
