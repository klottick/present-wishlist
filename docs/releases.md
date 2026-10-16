# Releases and reusable image publishing

[Back to the README](../README.md)

This guide is for maintainers. For installation and updates, use the
[README](../README.md) and [operations guide](operations.md).

## This repository's release pipeline

`.github/workflows/release.yaml` runs only for published stable GitHub releases
with canonical `vMAJOR.MINOR.PATCH` tags. Drafts/prereleases do not publish images.
The workflow is serialized for the repository and does not cancel a publish in
progress.

1. **Prepare:** check the event commit, fetch the complete release history,
   validate numeric version ordering, and run the complete application suite.
2. **Publish:** build and smoke Linux amd64 and arm64, refresh release eligibility
   on this publishing attempt, then log in and push the exact tested images.
   ARM execution uses QEMU on the GitHub x86_64 runner.
3. **Attach:** generate version-pinned install files and attach them and
   `image-digest.txt` to the release after successful image publication.

Published image tags are the version without `v`, `sha-<full-commit>`, and
`latest`. Installations use an exact version, not `latest`. The release summary
and `image-digest.txt` identify the combined manifest digest.

The preparation job has read-only content access. The generic publisher has
read-content/write-package access; only the attachment job has `contents: write`.
Pull-request verification cannot publish images.

## Publication checklist

- Obtain explicit approval for pushing/merging and for the chosen release/tag;
  do not infer publication approval from local tests or design approval.
- Use the exact reviewed commit and wait for application and both platform CI
  checks. Do not claim native ARM testing when execution used QEMU.
- Publish the approved stable release and observe the real release workflow.
- Verify anonymous package access using a private, empty `DOCKER_CONFIG`, not
  cached credentials. A public repository does not guarantee a public image.
  Obtain approval before any required package-visibility change.
- Check version, full-SHA, and `latest` resolve to the expected digest and contain
  both platforms. Pull published images and exercise the actual application.
- Download the attached installation files into an empty directory; verify
  configuration, persistence and privacy without source checkout/builds.
- Record the release URL, digests, native/emulated tests and any limitations in
  [release evidence](verification/docker-release.md).

The generated bundle contains `.env.example`, but GitHub sanitizes its leading
period: the actual public attachment is **`default.env.example`**. Check attachment
names through the release API/page and document the files users really download.
Copy that template to `.env`; never upload a real secret.

## Partial failures and recovery

An existing exact-version image tag is never silently overwritten. Registry
authentication/network failures must not be interpreted as tag absence. Version
eligibility is refreshed on every publishing-job retry, so an old failed job
cannot bypass ordering checks after a newer stable release.

Registry alias updates are **not atomic**. If publishing partially fails, inspect
all tags, manifests and digests and explicitly plan repair. Do not blindly rerun
the whole release, move a release tag, overwrite a stable image, or delete
registry artifacts to hide the failure.

If images were successfully published and only asset attachment failed, use
GitHub Actions' **Re-run failed jobs** to retry attachment alone. Staging tags are
run-specific implementation artifacts, not installation tags.

## Reuse across different stacks

Keep each project's Dockerfile, application tests, version validator and
serialized release caller in that project. Only the generic build/smoke/push
workflow is shared. A publishing job can call this implementation at an immutable
audited commit after its own `prepare` job validates and tests the release:

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

The publisher checks out the **caller's** event commit, not this repository.
The smoke command receives the built image as `IMAGE` and its platform as
`PLATFORM`; it must exit nonzero on failure. Commands are trusted repository code,
never user-supplied release text. All requested images must pass before login or
registry writes; tested images are retained and pushed without rebuilding.

The optional pre-publish hook must refresh the caller's release-order validation;
provide it to prevent stale retries moving `latest` backward. The caller must
hold its own release concurrency lock. Review and deliberately update the pinned
workflow when adopting later changes; do not copy this application's Django,
SQLite, or startup assumptions into another stack.
