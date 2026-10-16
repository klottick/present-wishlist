# Outstanding final-review findings

Updated 2026-10-15. The application is runnable and the complete configured
verification command passes, but the controller has not given unconditional
acceptance. A passing smoke suite does not invalidate these narrower findings.

## Important: pending delete loses keyboard focus after identity revalidation

Location: `frontend/src/features/items/DeleteItemDialog.tsx`, restoration effect.

Reproduction:

1. Open a deletion confirmation and submit deletion; hold its HTTP response.
2. Blur/focus the page and hold the same-person session check until the hidden,
   inert authenticated subtree has rendered.
3. Release the session check while deletion is still pending.
4. Release deletion with a retryable error, then press Escape.

The restoration effect tries to focus a disabled Cancel button. The button
exists, so the fallback focusable dialog container is not selected. Focus stays
on the page body, and the dialog does not receive Escape/Tab events. The modal
can still be operated with a pointer. The returned-identity-error variant with
enabled controls was fixed; this pending-request variant remains open.

Required follow-up: focus an enabled control or the dialog container, preserve
the same-identity guard, and retain a deterministic real-browser regression
that holds both requests through a rendered hidden interval.

## Minor: generated filter label can collide with another configured label

Location: `frontend/src/features/wishlists/EventFilter.tsx`.

These valid labels yield two visually identical configured options:

```yaml
events:
  all: All events
  special: All events (configured occasion)
```

The built-in All events choice is now distinct, but the disambiguation suffix
used for the first configured label collides with the second. Filter values and
backend filtering remain correct. A follow-up should disambiguate the complete
rendered set, using stable keys where needed, without reserving additional YAML
labels.

## Verification status

Controller's fresh `bash scripts/verify.sh` passed after the final fix wave:
91 backend tests, 79 frontend tests, lint/build, and 2 real-browser workflows
(1280×800 and 390×844). The remaining pending-delete variant was independently
reproduced by Sol in a targeted isolated browser probe; it is not yet part of
the configured passing suite. Final acceptance remains withheld for that issue.
