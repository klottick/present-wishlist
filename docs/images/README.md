# Screenshot provenance

The README images are actual Chromium captures of the published
`ghcr.io/klottick/present-wishlist:0.1.0` application, taken on 2026-10-16.
They are not mockups, and no application styling was overridden for the captures.

| Image | Browser viewport | View |
| --- | --- | --- |
| `wishlist-owner-desktop.png` | 1280×900 | Alex managing four gift ideas; purchase details are absent. |
| `wishlist-buyer-desktop.png` | 1280×1000 | Sam browsing Alex's list; own undo controls and Robin/Sam purchase marks are visible. |
| `wishlist-mobile.png` | 390×844 | Alex filtering Christmas, which also includes Anything gifts; no horizontal overflow. |

Images capture the full page, so their stored height may exceed the viewport.
Names, gifts, prices and links are synthetic; external links use `example.com`.
Only an isolated temporary YAML file, database volume and loopback port were
used. No real family records, credentials, browser storage or developer tools
appear in the images.

To refresh the screenshots, run the released image with disposable configuration
and storage, populate fictional gifts and buyer marks, then use separate browser
contexts for owner and buyer. Wait for completed list loading and fonts before
capturing. Confirm owner purchase privacy, expected buyer controls and mobile
overflow checks. Remove only the resources created for the capture, and update
this record if the version or viewport changes.
