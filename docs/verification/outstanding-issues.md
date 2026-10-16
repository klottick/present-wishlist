# Final-review findings — resolved

Updated 2026-10-16. Both findings below were fixed during the follow-up full
repository review. Independent Luna re-review accepted the fixes; regression
tests and verification from that revision are recorded in the
[application review report](repo-review-2026-10-16.md). The descriptions below retain
the original failure conditions for reference, not as current open issues.
For later release verification and known limitations, see
[Docker release evidence](docker-release.md).

## Resolved: pending delete lost keyboard focus after identity revalidation

Location: `frontend/src/features/items/DeleteItemDialog.tsx`, restoration effect.

Reproduction:

1. Open a deletion confirmation and submit deletion; hold its HTTP response.
2. Blur/focus the page and hold the same-person session check until the hidden,
   inert authenticated subtree has rendered.
3. Release the session check while deletion is still pending.
4. Release deletion with a retryable error, then press Escape.

Previously, the restoration effect tried to focus a disabled Cancel button.
Because the button existed, the fallback dialog container was not selected.
Focus stayed on the page body and the dialog did not receive Escape/Tab events,
although pointer interaction still worked. At the original finding, the
returned-identity-error variant had been fixed but the pending-request variant
had not. Both variants were resolved in the subsequent review.

Fix: focus an enabled Cancel control or fall back to the focusable dialog
container, preserving the same-identity guard. The deterministic browser
regression holds both requests through a rendered hidden/inert interval,
restores the same identity while deletion remains pending, then checks Tab,
retryable failure feedback, Escape, and return focus. It runs at both viewports.

## Resolved: generated filter labels could collide

Location: `frontend/src/features/wishlists/EventFilter.tsx`.

These valid labels yield two visually identical configured options:

```yaml
events:
  all: All events
  special: All events (configured occasion)
```

Previously, the disambiguation suffix for the first configured label collided
with the second. The filter now disambiguates the complete rendered option set,
including synthetic options and further generated-label collisions, using
stable keys without reserving additional YAML labels. Tests assert uniqueness
across every option and preserve distinct filter-key selection.

## Verification status

At the pre-Docker review checkpoint: 92 backend tests, 81 frontend tests,
lint/build/checks, and both real-browser workflows passed. Six additional
browser stability runs passed. The previously missing pending-delete variant
is now part of the configured browser suite. No Critical or Important review
findings remain open within the approved local-development scope.
