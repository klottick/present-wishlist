# Family configuration

[Back to the README](../README.md)

Family members and occasions are managed in YAML, not through the application.
For a Docker installation, edit `family.yaml` beside `compose.yaml`. For source
development, edit `backend/config/family.yaml` unless you selected another path.

## Format

```yaml
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

The entire file is validated before synchronization, which runs at backend
startup. Invalid configuration prevents the supported startup workflow from
serving requests. Editing the file alone does not update an already-running app.

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
