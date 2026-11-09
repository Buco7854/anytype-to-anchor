# Anytype → Anchor

A browser-only converter for moving notes and tasks from [Anytype](https://anytype.io) to [ZhFahim/anchor](https://github.com/ZhFahim/anchor). Choose an export, review your notes, and download an Anchor backup ZIP. Notes and files are never uploaded, stored in browser storage, or sent to an API. The only saved preference is your light/dark theme. Fonts and dependencies are bundled with the site.

## Use it

1. In Anytype desktop, open the Notes or Tasks Set and **select the objects inside it**. Choose Export. A Set is a query; exporting only its definition does not necessarily include the objects it shows.
2. Select **Any-Block → JSON**, enable **Include files**, **Include linked objects**, and **ZIP archive**. Linked objects allow the converter to resolve tag option names. Markdown exports with YAML properties also work. Binary Protobuf (`.pb`) is not supported.
3. Choose the ZIP on this page. You can also choose individual `.pb.json`, `.anyblock.json`, `.json`, `.md`, or `.markdown` files. Use a ZIP when you need attachments and folder paths.
4. Review your notes. Toggle tags, attachments, or archived objects; limit conversion to notes or tasks; search and deselect individual objects. Search filters the list, not the download selection. The summary states exactly how many objects are selected.
5. Download **Anchor ZIP**. In Anchor, open **Settings → Import / Export → Import notes**, choose the ZIP, and select **Anchor backup** if asked. Review and confirm. Use an Anchor version with the native backup importer. Keep **Skip existing** on to avoid duplicates.

The theme follows your device setting initially. Use the sun/moon button in the header to switch between light and dark; your choice is remembered on this device. Theme switching also works when browser storage is disabled.

“Try an example” explicitly loads four fictional local notes/tasks so you can test the interface without supplying an export.

## What moves

| Anytype content                                         | Anchor result                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Notes and content objects                               | Individual notes, with title and body                                                                  |
| Tasks                                                   | Individual notes with a checked/unchecked first line                                                   |
| Headings, bold, italic, underline, strikethrough, links | Rich-text formats supported by Anchor                                                                  |
| Lists, checklists, quotes, code blocks                  | Corresponding Anchor formats; nested lists keep indentation                                            |
| Tag properties                                          | Optional Anchor tags; body hashtags remain text                                                        |
| Creation and modification dates                         | Preserved when available; otherwise conversion time                                                    |
| Archived objects                                        | Excluded by default; optionally imported as archived notes                                             |
| JPEG, PNG, WebP, GIF and supported audio                | Note attachments; Anchor displays them separately from body text                                       |
| Other attachments, such as PDFs and videos              | Original bytes retained in `unsupported-attachments/`, with a warning                                  |
| Tables                                                  | Markdown tables become text; Any-Block tables/views produce warnings and preserve supported child text |
| Set definitions, types, properties and options          | Supporting metadata; excluded from the note selection                                                  |

Unnamed objects keep an empty title in Anchor. The review list and Markdown filenames use the first text line only as a label; it is never assigned as the note title. The preview marks these objects “No title”, and Markdown copies declare an empty title without adding a heading. Original body headings and text are kept. Existing names and explicit title blocks are preserved.

The converter reads legacy `snapshot.data` JSON exports and the AnyBlock 2 JSON document format. It prefers structured JSON when both structured objects and Markdown appear in one export. Tag names are resolved from exported relation options or inline named properties. It does not recreate Set filters, arbitrary custom properties, object relationships, reminders, sharing, history, or original inline attachment placement. Some AnyBlock 2 inline HTML marks remain visible text. Object links continue to point to Anytype; Markdown local-document links become text. Review the conversion notes before importing.

Code blocks keep their literal text and multiline structure in both the Anchor ZIP and Markdown copies. Inline code spans are plain text in Anchor; color-mark warnings refer to text/background colors, not to code-block support.

Input limits: 100 MB compressed, 250 MB expanded, 25 MB per file, 10,000 entries. Large exports should be split into smaller selections. Anchor’s content limit is checked before download; tag limits are checked when tags are included. Unsafe paths and malformed archives are rejected. Files are handled in a Web Worker to keep the interface responsive.

## Download contents

- `manifest.json`: Anchor `anchor-export` version 1, with serialized Quill Delta content, tags, timestamps, UUIDs, and attachment metadata.
- `attachments/`: files supported by Anchor, referenced by the manifest.
- `unsupported-attachments/`: other original attachments for manual recovery.
- `markdown/`: readable copies of the selected notes, including YAML properties.
- `conversion-report.md`: import instructions, totals, and conversion warnings.

Import the **whole ZIP once**. The Markdown copies are for your records; importing them again creates duplicate notes. Stable UUID v5 IDs derived from Anytype object IDs support Anchor’s skip-existing behavior for repeated conversions. Markdown-only exports use their file paths as identity, so renaming a file changes its ID.

## Run locally

Node.js 22.12+ (22 is in `.nvmrc`).

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run preview` serves `dist/` on port 4173. TypeScript, Vite, fflate, YAML, and marked; no backend or application framework. Vite uses a relative base, so builds work at both a domain root and a GitHub Pages repository path.

## Publish on GitHub Pages

1. Push these files to the repository’s `main` branch.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. The **Test and publish GitHub Pages** workflow runs converter tests, builds the static site, runs browser tests, uploads `dist/`, and deploys it. Pull requests run the checks without publishing. You can also run the workflow manually from the Actions tab on `main`.

For this repository, the expected URL is **https://buco7854.github.io/anytype-to-anchor/** after a successful deployment. No API keys or secrets are needed. Changing Pages settings and the first remote deployment are not performed by the local setup.

The workflow follows [GitHub’s Pages custom workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), including a separate deployment job, the `github-pages` environment, and Pages/OIDC permissions limited to deployment.

## Compatibility and verification

The output contract was checked against [Anchor’s native importer](https://github.com/ZhFahim/anchor/blob/c002fd8d78b686dae1d0725bf7fe842db49ce219/web/features/import-export/adapters/anchor.ts), [manifest definition](https://github.com/ZhFahim/anchor/blob/c002fd8d78b686dae1d0725bf7fe842db49ce219/server/src/import-export/export-manifest.util.ts), and [Quill content parser](https://github.com/ZhFahim/anchor/blob/c002fd8d78b686dae1d0725bf7fe842db49ce219/web/features/notes/quill.ts). Anytype parsing follows its [legacy exporter](https://github.com/anyproto/anytype-heart/blob/develop/core/converter/pbc/pbc.go), [block and layout definitions](https://github.com/anyproto/anytype-heart/blob/develop/pkg/lib/pb/model/protos/models.proto), and [AnyBlock 2 fixtures](https://github.com/anyproto/anytype-heart/tree/develop/core/block/import/pb/testdata/anyblock_full).

Tests cover source parsing, tag resolution/exclusion, task completion, block order, dates, attachments, archive validation, output structure, and browser upload/review/download. Responsive views are checked at 1440, 768, 390, and 320 CSS pixels. A production Anchor account and your personal export were not available for a live account import; review a small selection first.

MIT. Independent of Anytype and Anchor.
