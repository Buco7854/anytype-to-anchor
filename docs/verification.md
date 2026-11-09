# Verification

Checked on 2026-11-09 with Node.js 22.23.4 and Playwright Chromium.

## Converter

- 26 unit tests cover legacy snapshot JSON, AnyBlock 2 JSON, Anytype Markdown properties, task completion, overlapping rich-text marks, tree order, custom tag option resolution, timestamps, selections, archive limits, unsafe paths, unsupported attachments, optional tags, and the Anchor v1 manifest contract.
- A separate one-off test loaded the actual Anchor `anchorAdapter` and `parseStoredContent` source fetched from upstream, removed TypeScript annotations/import bindings, and parsed generated ZIPs using those functions. It passed with tags enabled and disabled, verified four notes, task completion, original timestamps, and byte-for-byte attachment recovery. Temporary upstream source was not added to this repository.
- Compatibility target: Anchor commit `c002fd8d78b686dae1d0725bf7fe842db49ce219`, `anchor-export` version 1. A live import into a personal Anchor account remains unverified.

## Browser

Eight Playwright tests cover upload, review, searching, selection, task filtering, tag exclusion, ZIP download and manifest validation, error recovery, guide focus restoration, and no external requests or browser storage writes during conversion.

Screenshots of both initial and loaded states were viewed at 1440, 768, 390, and 320 CSS pixels. Mobile options collapse after loading so review follows the source. No horizontal overflow at those widths. Reduced motion and 200% computed text sizes were tested. Axe found no violations in the final initial state, loaded note state, or task preview. The tests caught and prompted fixes for footer link distinction and accessible note button names. A real screen reader was not tested; automated checks do not establish full WCAG conformance.

## Visual review

Direction: **Framed sheet**, seed **69558703**, locally bundled IBM Plex Sans. No palette/type redraw. The graph builder pattern was adapted to a note list and preview because the input/output are documents. The custom transfer mark and literal Anytype → Anchor route supply the product identity; the live preview shows tags disappearing when excluded. No external pictures or clips, no stock media, and no client content to replace. The four fictional examples live in `src/sample.ts` and are only shown after explicitly choosing the example.

The design skill's real Chromium inspector reported **0 failures and 0 warnings** at 1440, 768, and 390 pixels. Its complete screenshot sheets were viewed. Source lint has one justified warning: UUID encoding uses hexadecimal zero-padding; it is not decorative numbering.

Final self-critique: design 8/10, usability 8/10, creativity 7/10, content 8/10. The first action and destination are explicit, edges align, counts come from actual selected objects, zero states are honest, and output controls respond to options. The intentional empty preview is a functional first-run state. The main remaining visual limitation is the extra vertical scroll on narrow phones; content and actions remain available. This is a utility screen, so image/motion quotas for marketing pages do not apply.

## Build and publishing

The production build succeeds with relative asset and worker URLs. The workflow checks pull requests and deploys only `main` pushes/manual runs. It uses a separate GitHub Pages environment/deploy job, with Pages and OIDC permissions scoped to that job. Workflow YAML was parsed locally. GitHub Pages settings, remote Actions execution, and the public deployment have not been performed from this workspace.

## Unnamed-title regression

Fixed the fallback that exposed Anytype storage IDs as titles when no name was exported. Tests cover document order, string/numeric title blocks, blank and ID-valued names, AnyBlock 2 inline formatting, task checkbox titles, empty objects, bounded inferred titles, and Markdown. The browser test verifies the readable title in the preview and downloaded manifest. Source object IDs and complete body content are preserved. Synthetic object IDs are used in fixtures.
