# Family configuration

[Back to the README](../README.md)

Family members and occasions are managed in YAML, not through the application.
For a Docker installation, edit `family.yaml` beside `compose.yaml`. For source
development, edit `backend/config/family.yaml` unless you selected another path.

## Format

```yaml
# Optional display name (supported in 0.1.2 and newer).
family_name: Smith
members:
  alex: Alex
  sam: Sam
  robin: Robin
events:
  birthday: Birthday
  christmas: Christmas
```

Both `members` and `events` must be present and must be mappings. Empty mappings
are valid. The Docker example includes Alex and Sam; the source-development file
starts with no members. Add your own names before using that empty picker.

`family_name` is an optional display label supported in `0.1.2` and newer. It must be a string
of at most 80 characters; surrounding whitespace is trimmed, and omitted,
`null`, or blank values retain generic app wording. It affects only the header,
browser tab, and family-list labels, never member identity or personal wishlist
headings. Older images, including `0.1.1`, reject this field; upgrade before
adding it. The public `GET /api/config/` endpoint supplies only this
validated value to the interface.

| Field | Rules |
| --- | --- |
| Keys | Start with a lowercase letter; use only lowercase letters, numbers, hyphens and underscores; maximum 80 characters. |
| Labels | Nonempty strings, trimmed, maximum 80 characters; unique within their section, ignoring case. |
| Event restrictions | The key `anything` and the label `Anything` are reserved. Do not add them to YAML. |

Duplicate keys, unknown top-level fields, YAML merge keys, unsafe tags, and
non-string labels are rejected. Quote labels such as `"Yes"` or `"2026-12-25"`
that YAML could otherwise interpret as booleans or dates.

Birthday and Christmas are examples, not mandatory occasions. Occasions are
labels only: they do not schedule dates, track years, or reset purchase marks.

## Stable keys and renaming

Keys identify persistent records; labels are the names shown in the interface.
To rename a person or occasion, change only the label:

```yaml
members:
  sam: Samantha
events:
  birthday: Birthday gifts
```

Keep the other configured entries when editing the file: YAML is authoritative,
so omitted keys are archived. Changing a key creates a new identity instead of
renaming the old one. Label changes under the same key preserve gifts, event
assignments, purchase marks, selected sessions, and any existing account link.
Account-based login itself is not implemented.

## Applying changes

The entire file is validated before member/occasion synchronization, which runs
at backend startup. Invalid configuration prevents the supported startup
workflow from serving requests. Editing the file alone does not update the
running app's members or occasions.

In `0.1.2` and newer, branding is read from YAML when the browser loads
`/api/config/`. Reload the page after changing `family_name`; it does not require
member/occasion synchronization. If an editor replaces a Docker-mounted file,
recreate the container as described below so it sees the new file. An unreadable
or invalid configuration produces a generic branding fallback rather than
exposing file contents or paths.

For Docker:

```sh
docker compose restart app
```

If your editor replaces the file rather than modifying it in place, refresh the
read-only bind mount by recreating the container:

```sh
docker compose up -d --force-recreate --wait app
```

For source development, stop and rerun `scripts/dev_backend.py`. Restarting only
Vite does not synchronize the configuration.

## Removing and restoring entries

- Removed members disappear from name selection and family-list browsing. Their
  gifts and purchase records remain stored. Their names remain visible on their
  existing purchase marks on other active members' lists.
- Removed occasions disappear from new assignments and occasion filters.
  Existing gifts keep their archived assignment and label. Owners may retain
  that assignment while editing other fields, or choose an active occasion or
  Anything; an archived occasion cannot be newly assigned to another gift.
- Reintroducing the same key reactivates its existing record and relationships.
- Synchronization does not delete gifts or purchase history when a key is removed.

## Anything and filtering

Anything is built in and represents a gift with no assigned occasion.

- **All events** shows every gift on the selected list, including gifts with
  archived occasions.
- A configured occasion shows gifts assigned to that occasion **and** Anything
  gifts.
- **Anything** alone shows only gifts with no occasion.

Changing a gift's occasion preserves its purchase marks. There are no annual
event instances or automatic purchase resets.

## Profile photos

Choose your name, then open **Profile photo** on **My wishlist** to upload,
replace, or remove your picture. JPEG, PNG, and WebP files up to 5 MB and
20 megapixels are supported. Animated images are rejected. Photos are oriented,
center-cropped to a 256px square, and saved as JPEG without original metadata.
People without a photo show initials. The photo appears in name selection,
family browsing, and wishlist headings.

Photos belong to the existing profile identity and are stored in the database,
not YAML. Renaming a label preserves its photo. Existing database backups include
photos; no separate media directory is needed. Photo reads are public within the
app so the initial name picker can show them. Editing follows the app's existing
selected-name trust model.

## Shopping links and previews

Gift forms accept up to ten HTTP/HTTPS links, in the order entered. Use **Add
another link** or the row's **Remove** button. Blank rows are ignored and duplicate
URLs are rejected. Existing single links migrate automatically on startup;
editing links preserves purchase records.

After a gift is saved, its links load compact previews with page titles,
descriptions, and thumbnails where provided. The server makes bounded public
page requests and caches successful metadata for seven days, or an unavailable
result for one hour, with at most 512 cached URLs. Preview fetches use at most two server request threads, reserving capacity for
normal app actions. The browser loads at most two previews at a time. Saving a
gift never waits for this work. Private-network
URLs, nonstandard web ports, inaccessible pages, and sites requiring scripts or
blocking automated requests remain ordinary clickable links. Prices and stock
are not tracked.

Preview text is rendered as text. Thumbnail images load from the source website
without a referrer, so viewing an image can contact that external image host.
Broken images are hidden while the destination remains usable. No preview
service account or API key is required.
