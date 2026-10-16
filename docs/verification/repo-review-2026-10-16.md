# Repository review — 2026-10-16

Status: complete. Independent Luna re-reviews accepted the frontend and tooling
fixes; no Critical or Important review findings remain open in scope.
Baseline: `29ffd43` on `main`. The user requested Luna subagent reviewers;
backend, frontend, and tooling were reviewed separately by three Lunas, with
controller triage and final verification. This review does not add deployment,
authentication, or live-update requirements beyond the approved design.

## Findings accepted for correction

| Area | Severity | Finding |
| --- | --- | --- |
| Delete confirmation | Important | Same-profile revalidation tries to focus disabled Cancel during pending deletion, losing keyboard containment. |
| Event filters | Minor | Generated display text can collide with another valid configured label. |
| Item form accessibility | Minor | Several server field errors lack input descriptions; multiple name errors repeat an ID. |
| Browser-test setup | Important | Documented clean setup omits the separate Playwright Chromium installation. |
| Browser-test fixtures | Minor | Temporary fixture allocation assumes `/tmp/opencode` already exists. |

All five findings were corrected. The modal now restores focus to an enabled
control or its container, including during pending deletion; retryable failure
feedback is restricted to the dialog's original confirmed profile while stale
success and identity-required responses retain their generation guards. Event
labels are disambiguated across the whole option set. Form controls describe
all applicable error messages using unique groups. Browser provisioning is an
explicit setup step, and fixture allocation safely creates its missing parent.

Separate Lunas reviewed the fixes independently of their coders. Their only
remaining comments were two minor test-assertion gaps; the controller added
all-option label uniqueness and assertions that editing clears only the changed
field's errors, plus clearing of event and checkbox descriptions. These extend
coverage of existing correct behavior, so no new failing-before-fix claim is
made for those assertion-only additions.

The backend reviewer identified no actionable application defects. It ran
78 focused tests using an isolated database, covering API identity, permissions,
recipient privacy, strict input handling, configuration archival/synchronization,
models, and SQLite concurrency.

## Baseline verification

Before changes, `bash scripts/verify.sh` passed: 91 backend tests, 79 frontend
tests, Django checks/migration consistency, `pip check`, frontend lint/build,
and two real-browser workflows (1280×800 and 390×844). Passing baseline tests
did not cover every reviewed edge case; corrections require new regressions.

## Dependency checks

- `npm --prefix frontend audit --json`: no reported advisories.
- OSV API queries for the installed Python runtime dependencies (`asgiref`,
  Django, Django REST Framework, PyYAML, and sqlparse): no reported advisories.
- The project virtual environment's installer, pip 25.1.1, had six distinct
  published advisories (with duplicate GHSA/PYSEC alias records). Upgraded only
  project-local pip to 26.2.1 and re-queried OSV: no reported advisories.
  Application dependency pins and system Python were not changed.
- Basic tracked-source credential-pattern scan: no matching private-key blocks,
  GitHub tokens, AWS access-key IDs, or OpenAI-style tokens. This is not a
  comprehensive secret detector or a guarantee about arbitrary credential formats.

These are point-in-time advisory checks, not proof that the software is free
of vulnerabilities. Dependency license auditing, production hardening, other
database engines, and exhaustive cross-browser/assistive-technology testing
are not claimed. Name impersonation remains an explicit trust-model limitation.

Documentation references used for setup and accessibility checks:
[Playwright browsers](https://playwright.dev/docs/browsers) and
[MDN aria-describedby](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby).
Context7 documentation lookup was attempted but its monthly quota was exhausted.

## Clean browser-cache provisioning

The controller ran `npm --prefix frontend run install:browsers` with
`PLAYWRIGHT_BROWSERS_PATH` pointing to an initially empty, private temporary
directory. Chromium 1248, FFmpeg 1013, and Chromium Headless Shell 1248 downloaded
successfully. A Node Playwright probe then launched that Chromium installation,
rendered a page, checked its heading, and closed the browser. Only the private
download directory was removed afterward; the existing shared cache was untouched.
This verifies browser provisioning and launch on this host, not OS-library
installation on a freshly provisioned operating system (which was not attempted).

The controller also created a separate temporary Python 3.14 virtual environment,
ran the README's pip upgrade and pinned requirements installation, checked
dependencies, and imported Django/DRF/PyYAML successfully (5.2.18/3.18.3/6.0.3).
Only that private environment was removed. This was a setup/import check, not
another isolated full application-suite run.

A separate temporary Node directory containing only `package.json` and
`package-lock.json` also passed `npm ci` and browser-install script resolution
(`--dry-run`). The repository's existing `node_modules` was not replaced.

## Final verification

The controller ran `bash scripts/verify.sh` after integrating both fix sets:

| Check | Result |
| --- | --- |
| Backend suite | PASS — 92 tests |
| Django checks/migration consistency | PASS — no issues or drift |
| Python dependency consistency | PASS |
| Frontend suite | PASS — 81 tests in 10 files |
| Frontend lint and production build | PASS |
| Real-browser workflows | PASS — desktop 1280×800 and phone 390×844 |

The controller then ran
`npm --prefix frontend run test:e2e -- --repeat-each=3`: all six browser runs
passed, three per viewport. This explicitly exercises the formerly unhandled
pending-delete revalidation branch in addition to the existing workflows.
No failing iteration was discarded and no retry-until-green policy was used.

Independent frontend and tooling re-reviews are complete. The original
outstanding focus/label issues are now [resolved](outstanding-issues.md).
Acceptance is for the approved local-development scope, not deployment or
authentication readiness.
