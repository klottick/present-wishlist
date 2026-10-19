# Screenshot provenance

The README images are actual Chromium captures of the source at `f479492` (demo
commands and UI task) taken on 2026-10-19. They are not captures of the older published
`ghcr.io/klottick/present-wishlist:0.1.0` image, mockups, or styling overrides.

| Image | Browser viewport | View |
| --- | --- | --- |
| `wishlist-owner-desktop.png` | 1280×900 | Alex's list with synthetic demo gifts; purchase details are absent. |
| `wishlist-buyer-desktop.png` | 1280×1000 | Sam browsing Alex's list with synthetic purchase marks and buyer controls. |
| `wishlist-mobile.png` | 390×844 | Alex's list on mobile, including the occasion filter; no horizontal overflow. |

Desktop images were captured at their viewport dimensions; the mobile image is
a viewport capture at exactly 390×844 (it does not show the full list below the
fold).
Names, gifts, prices and links are synthetic; external links use `example.com`.
The current source's `seed_demo` command populated a temporary YAML-configured
SQLite database. Only isolated loopback ports, temporary database/config files,
and private browser contexts were used. The owned app processes and temporary
files were cleaned after capture. No real family records, credentials, browser
storage or developer tools appear in the images.

To refresh the screenshots, follow the isolated source-preview procedure in the
task report or run the current source with disposable configuration and storage.
Use separate browser contexts for owner and buyer. Wait for completed list loading
and fonts before capturing. Confirm owner purchase privacy, expected buyer
controls and mobile overflow checks. Remove only the resources created for the
capture, and update this record if the source revision or viewport changes.
