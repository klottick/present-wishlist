# Documentation

## User and maintainer guides

- [Project overview, screenshots and installation](../README.md)
- [Family configuration](configuration.md): YAML format, stable identities,
  archival behavior and occasion filters.
- [Docker operations](operations.md): environment settings, LAN access, health,
  backup/restore, updates and troubleshooting.
- [Development and testing](development.md): source setup, local servers,
  verification and container smoke tests.
- [Releases and publisher reuse](releases.md): publication, recovery and
  adapting the shared workflow to other stacks.

## Verification records

These are revision-specific evidence, not continuously updated test dashboards.

- [Documentation review, 2026-10-16](verification/documentation-review-2026-10-16.md):
  guide restructuring, accuracy corrections, real screenshots and validation.
- [Docker release verification](verification/docker-release.md): `v0.1.0`
  publication, manifests, anonymous installation and operational checks; also
  records the current known smoke diagnostic limitation and unexplained earlier
  browser timeout.
- [Repository review, 2026-10-16](verification/repo-review-2026-10-16.md):
  pre-Docker application review and its fixes; the 92-test backend result is
  historical, not the later 130-test release total.
- [Application verification history](verification/family-wishlist.md): original
  implementation and follow-up review evidence.
- [Resolved review findings](verification/outstanding-issues.md): historical
  deletion-focus and event-label issues, with their corrections.

## Design and implementation history

The following are approved historical specifications and implementation plans,
not instructions to rerun completed work. Later release settings and packaging
extend the original source-development scope without adding authentication.

- [Application design](superpowers/specs/2026-10-15-family-wishlist-design.md)
- [Application implementation plan](superpowers/plans/2026-10-15-family-wishlist.md)
- [Docker release design](superpowers/specs/2026-10-16-docker-release-design.md)
- [Docker release implementation plan](superpowers/plans/2026-10-16-docker-release.md)
