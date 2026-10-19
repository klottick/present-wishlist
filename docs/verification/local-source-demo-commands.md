# Local-source Docker demo-command verification

[Back to development and testing](../development.md#verify-commands-in-an-isolated-local-docker-project)

Verified 2026-10-19 on Docker Engine 29.7.2 and Compose 5.5.0, native
`linux/amd64`. This is a disposable local run, not the published `0.1.0` image
or a release claim.

| Item | Result |
| --- | --- |
| Source revision | `6b79e0b7a4d704453a70ef816424e31be7717cb3` |
| Local image | `present-wishlist-local:source-test`, digest `sha256:7627a56e84780dba171f2a2cbc7ef987d9a47356cf27b00814efe1faac0e6cc3`; OCI revision label matched source; runtime user `10001:10001` |
| Isolated project | `wishlist-local-image-1792443504-2795064`; synthetic YAML; fresh project-scoped named volume; random loopback port `32803` |
| Startup | Compose `up -d --wait` reported healthy; `/healthz/` returned HTTP 200; startup log showed all migrations applied and configured YAML synchronized |
| Demo commands | `seed_demo` twice succeeded; `reset_demo` without `--yes` exited nonzero with the expected refusal; `reset_demo --yes` removed four demo gifts; an ordinary gift remained (`ordinary=1 marked_demo=0`); reseed restored four demo gifts |
| Cleanup | Verified project labels on the only container, network and volume; removed only that Compose project and its temporary files. Removed the uniquely tagged test image after verifying its source revision label. No main Compose project, live volume, unrelated service or global Docker resource was changed. |
| Native image smoke | `python3 scripts/smoke_container.py --image present-wishlist-ux-smoke:f479492 --platform linux/amd64` passed frontend/assets, CSRF, privacy, persistence, fail-closed startup and termination. The uniquely tagged image was removed after the run. |

Detailed command/output logs are ephemeral under `/tmp/opencode`:
`wishlist-ux-docs-docker-build.log`, `wishlist-docker-compose-acceptance.log`,
`wishlist-ux-docs-smoke-build.log`, and `wishlist-ux-docs-smoke.log`.

To repeat, follow the isolated procedure linked above. Do not point it at a
family installation or use reset commands against family data.
