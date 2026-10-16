# Documentation review — 2026-10-16

## Scope

Review the README and supporting documentation for professional presentation,
accuracy, real screenshots and absence of emojis. The review started from
`f454814674b008a7101e932e0cc07219186abcdc`; it changes documentation and image
assets only. No application behavior, dependency, workflow, release tag or
published image was changed.

## Findings and corrections

| Finding | Correction |
| --- | --- |
| README led with internal review history and had no screenshots. | Added a product-focused overview, features, owner/buyer/mobile screenshots and a release-based quick start. |
| Installation, source development and release maintenance were interleaved. | Added focused configuration, operations, development and publishing guides, linked from the README and documentation index. |
| Archival description could imply removed members' wishlists remained browsable. | Clarified that removed members cannot be selected or browsed; stored records and their buyer names on other lists remain preserved. |
| YAML restrictions were incomplete. | Documented required mappings, key/label limits, reserved Anything, string quoting and restart behavior. |
| Older verification counts were presented as current, and resolved findings still said they remained open. | Labeled evidence by revision/phase, linked later release results and corrected resolved-status wording without replacing historical counts. |
| Completed plans still looked like active execution instructions. | Marked them as historical and separated original planning checkboxes/gates from actual execution evidence. |
| Release design/plan still described the environment asset only by its generated filename. | Distinguished generated `.env.example` from GitHub's actual `default.env.example` attachment. |
| The development guide omitted Vite's fallback-port/CSRF interaction. | Independent review identified the omission; confirmed only ports 5173/5174 are trusted by default and documented matching exact-origin configuration with a fixed, strict frontend port. |

Instructions were compared with the YAML loader/synchronizer, selectors,
development/container launchers, settings, Compose file, verification script and
release workflows. The live `v0.1.0` release API confirmed the attachment names.

## Screenshot verification

- Captured the actual released `0.1.0` image, whose OCI revision label matched
  `1ca854af68ca63b1907f530427ce5a086ce4c42e`; runtime UID/GID was `10001:10001`.
- Used only fictional family/gift data, separate owner/buyer browser contexts,
  a temporary YAML file, an isolated volume and a dynamically assigned loopback
  port. No product styling overrides or mock application responses were used.
- Asserted four owner gifts and absence of purchase fields/controls; buyer view
  showed two own-undo controls and another buyer's mark. The mobile Christmas
  filter included the Anything gift and had no horizontal overflow.
- Inspected all three PNGs visually. Their total size is approximately 255 KiB.
  Exact dimensions and capture context are described in
  [screenshot provenance](../images/README.md).
- Rendered the README through GitHub's Markdown API, then loaded the resulting
  HTML and local image assets in Chromium with a simple responsive preview
  stylesheet. All three images decoded with descriptive alt text at desktop
  1280×900 and mobile 390×844; neither preview overflowed horizontally. This was
  a local rendering check, not a claim that unpushed assets were visible on GitHub.
- Stopped the screenshot container with exit code 0, removed its container/volume,
  and confirmed no resources with that run's ownership label remained.

## Validation

- Independent documentation review found no Critical or Important issues. Its
  one Minor development-port omission was verified against the settings and
  corrected without changing application behavior.
- `bash scripts/verify.sh`: 130 backend tests, 81 frontend tests, both browser
  workflows, Django checks, migration consistency, dependency consistency, lint
  and production build passed.
- Checked repository-relative Markdown/HTML links and image paths for existing
  targets, shell snippets with `bash -n`, and complete family-YAML examples with
  the application's actual loader. These checks do not execute every destructive
  operational command or establish that all external websites stay available.
- Scanned README and every Markdown document under `docs/` for emoji pictographs,
  flag characters and emoji presentation/keycap markers; none were present.
- `git diff --check`: passed.

Earlier release evidence remains revision-specific. This review does not claim
to fix the previously unexplained browser CI timeout or deferred smoke-log
diagnostic, test native ARM hardware, add authentication, or harden public hosting.
