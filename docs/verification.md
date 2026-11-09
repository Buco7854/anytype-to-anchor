# Verification

Checked on 2026-11-09 with Node.js 22.23.4 and Playwright Chromium.

## Converter

- 34 unit tests cover legacy snapshot JSON, AnyBlock 2 JSON, Anytype Markdown properties, task completion, overlapping rich-text marks, tree order, custom tag option resolution, timestamps, selections, archive limits, unsafe paths, unsupported attachments, optional tags, and the Anchor v1 manifest contract.
- A separate one-off test loaded the actual Anchor `anchorAdapter` and `parseStoredContent` source fetched from upstream, removed TypeScript annotations/import bindings, and parsed generated ZIPs using those functions. It passed with tags enabled and disabled, verified four notes, task completion, original timestamps, and byte-for-byte attachment recovery. Temporary upstream source was not added to this repository.
- Compatibility target: Anchor commit `c002fd8d78b686dae1d0725bf7fe842db49ce219`, `anchor-export` version 1. A live import into a personal Anchor account remains unverified.

## Browser

Fifteen Playwright tests cover upload, review, searching, selection, task filtering, tag exclusion, ZIP download and manifest validation, error recovery, guide focus restoration, and no external requests or browser storage writes during conversion.

Screenshots of both initial and loaded states were viewed at 1440, 768, 390, and 320 CSS pixels. Mobile options collapse after loading so review follows the source. No horizontal overflow at those widths. Reduced motion and 200% computed text sizes were tested. Axe found no violations in the final initial state, loaded note state, or task preview. The tests caught and prompted fixes for footer link distinction and accessible note button names. A real screen reader was not tested; automated checks do not establish full WCAG conformance.

## Visual review

Direction: **Framed sheet**, seed **69558703**, locally bundled IBM Plex Sans. No palette/type redraw. The graph builder pattern was adapted to a note list and preview because the input/output are documents. The custom transfer mark and literal Anytype → Anchor route supply the product identity; the live preview shows tags disappearing when excluded. No external pictures or clips, no stock media, and no client content to replace. The four fictional examples live in `src/sample.ts` and are only shown after explicitly choosing the example.

The design skill's real Chromium inspector reported **0 failures and 0 warnings** at 1440, 768, and 390 pixels. Its complete screenshot sheets were viewed. Source lint has two justified warnings: UUID encoding uses hexadecimal zero-padding, and the floating guide dialog uses a shadow.

Final self-critique: design 8/10, usability 8/10, creativity 7/10, content 8/10. The first action and destination are explicit, edges align, counts come from actual selected objects, zero states are honest, and output controls respond to options. The intentional empty preview is a functional first-run state. The main remaining visual limitation is the extra vertical scroll on narrow phones; content and actions remain available. This is a utility screen, so image/motion quotas for marketing pages do not apply.

## Build and publishing

The production build succeeds with relative asset and worker URLs. The workflow checks pull requests and deploys only `main` pushes/manual runs. It uses a separate GitHub Pages environment/deploy job, with Pages and OIDC permissions scoped to that job. Workflow YAML was parsed locally. GitHub Pages is configured for Actions. Publishing and public browser smoke checks are performed from this workspace; the title-preservation correction was also verified through the actual upstream Anchor adapter. A live account import remains unverified.

## Unnamed-title regression

Unnamed objects retain an empty title in the Anchor manifest. The first body line supplies a review-list label and filename only; the preview explicitly shows “No title”. Markdown copies declare an empty title and do not insert a heading. Tests cover unchanged body content/order, source title blocks, task completion, empty objects, formatted AnyBlock 2 content, bounded review labels, Markdown round trips and explicit empty Markdown titles with body headings. The browser test verifies both the review label and the empty title in the downloaded manifest. Fixtures use synthetic IDs.

## Dark theme and code blocks

Dark theme is tested at 1440, 768, 390, and 320 CSS pixels with actual screenshots of initial and loaded states. The device preference, keyboard toggle, persisted override, reload, and disabled-storage fallback pass. Axe reports no violations in dark initial, loaded, success, warning, error, or guide states. Both light and dark skill inspections report 0 failures and 0 warnings; all screenshot sheets were viewed. The source lint warnings for hexadecimal UUID padding and the floating dialog shadow are intentional. No user content enters storage. The visual self-critique remains design 8/10, usability 8/10, creativity 7/10, content 8/10; small-phone scrolling remains the same practical limitation.

Code-block regressions cover named and numeric legacy styles, AnyBlock 2, literal Markdown characters, multiline content, and backticks inside a block. Markdown export groups consecutive code lines under one fence longer than any contained backtick run. Native Anchor content uses the same `code-block: true` line format as Anchor’s Markdown importer. Color and inline-code warnings are now separate; neither implies code blocks are unsupported.
