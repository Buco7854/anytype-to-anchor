import { noteLabel } from "../src/lib/titles";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFiles, safePath } from "../src/lib/archive";
import { parseExport } from "../src/lib/parse";
import { createArchive, selectedNotes } from "../src/lib/convert";
import { markdownToDelta } from "../src/lib/richtext";
import { defaultOptions, type Dataset, type Options } from "../src/lib/types";
import { exampleFiles } from "../src/sample";

function json(raw: unknown) {
  return strToU8(JSON.stringify(raw));
}
function legacy(
  id: string,
  details: Record<string, unknown>,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
) {
  return json({
    sbType: "Page",
    snapshot: { data: { details: { id, ...details }, blocks, ...extra } },
  });
}
function options(dataset: Dataset, overrides: Partial<Options> = {}): Options {
  return {
    ...defaultOptions,
    selectedKeys: dataset.notes.map((note) => note.key),
    ...overrides,
  };
}
const plain = (delta: { ops: { insert: string }[] }) =>
  delta.ops.map((op) => op.insert).join("");

describe("Anytype source formats", () => {
  it("uses real layout enum values for notes and tasks, excluding Sets and metadata", () => {
    const result = parseExport({
      "note.pb.json": legacy("note", { name: "A note", resolvedLayout: 9 }, []),
      "task.pb.json": legacy(
        "task",
        { name: "A task", resolvedLayout: 2, done: true },
        [],
      ),
      "set.pb.json": legacy("set", { name: "My Set", resolvedLayout: 3 }, []),
      "types/type.pb.json": legacy(
        "type",
        { name: "Type", resolvedLayout: 4 },
        [],
      ),
    });
    expect(result.notes.map((note) => note.kind)).toEqual(["note", "task"]);
    expect(result.notes[1].delta.ops.at(-1)?.attributes?.list).toBe("checked");
    expect(result.skipped).toBe(2);
  });
  it("traverses children in document order and keeps nested list depth and overlapping marks", () => {
    const dataset = parseExport({
      "note.pb.json": legacy("n", { name: "Note" }, [
        { id: "root", smartblock: {}, childrenIds: ["a", "b"] },
        { id: "b", text: { text: "Second", style: "Paragraph" } },
        { id: "nested", text: { text: "Nested", style: "Marked" } },
        {
          id: "a",
          childrenIds: ["nested"],
          text: {
            text: "First",
            style: "Marked",
            marks: {
              marks: [
                { range: { from: 0, to: 5 }, type: "Bold" },
                { range: { from: 1, to: 4 }, type: "Italic" },
              ],
            },
          },
        },
      ]),
    });
    expect(plain(dataset.notes[0].delta)).toBe("First\nNested\nSecond\n");
    expect(
      dataset.notes[0].delta.ops.some(
        (op) =>
          op.insert === "irs" && op.attributes?.bold && op.attributes?.italic,
      ),
    ).toBe(true);
    expect(
      dataset.notes[0].delta.ops.some((op) => op.attributes?.indent === 1),
    ).toBe(true);
  });
  it("resolves custom tag relation option IDs and preserves dates", () => {
    const dataset = parseExport({
      "objects/n.pb.json": legacy(
        "n",
        {
          name: "Note",
          customTags: ["bafy-option"],
          createdDate: 1700000000,
          lastModifiedDate: "2024-01-02T00:00:00Z",
        },
        [],
        { relationLinks: [{ key: "customTags", format: "tag" }] },
      ),
      "relationsOptions/o.pb.json": legacy(
        "bafy-option",
        { name: "Research", relationKey: "customTags" },
        [],
      ),
    });
    expect(dataset.notes[0].tags).toEqual(["Research"]);
    expect(dataset.notes[0].createdAt).toBe("2023-11-14T22:13:20.000Z");
    expect(dataset.notes[0].updatedAt).toBe("2024-01-02T00:00:00.000Z");
  });
  it("reads AnyBlock 2 property labels, Markdown inline marks, task completion, and media", () => {
    const dataset = parseExport({
      "objects/task.anyblock.json": json({
        formatVersion: "2.0",
        id: "task",
        type: "Task",
        properties: {
          Name: "Read",
          "Resolved layout": "todo",
          Done: true,
          Tags: ["Books"],
          "Creation date": "2026-01-02",
        },
        blocks: [
          { id: "1", type: "paragraph", text: "A **good** book" },
          { id: "2", type: "image", object_id: "image-id", name: "cover.png" },
        ],
      }),
      "files/image-id.anyblock.json": json({
        formatVersion: "2.0",
        kind: "file_object",
        id: "image-id",
        properties: { Name: "cover.png", "Mime type": "image/png" },
        blocks: [],
      }),
      "files/cover.png": new Uint8Array([137, 80, 78, 71]),
    });
    expect(dataset.notes).toHaveLength(1);
    expect(dataset.notes[0].kind).toBe("task");
    expect(dataset.notes[0].tags).toEqual(["Books"]);
    expect(
      dataset.notes[0].delta.ops.some(
        (op) => op.insert === "good" && op.attributes?.bold,
      ),
    ).toBe(true);
    expect(dataset.notes[0].attachments[0].path).toBe("files/cover.png");
  });
  it("reads Markdown properties, checklists, code blocks and relative attachments", () => {
    const dataset = parseExport({
      "export/Notes/reading.md": strToU8(
        "---\ntitle: Reading\ntype: Task\ntags: [Books, Personal]\ndone: true\ncreated: 2026-01-01\n---\n# Reading\n\n- [x] **Read**\n- [ ] Reflect\n\n```js\nconsole.log(1)\n```\n\n![Cover](../files/cover.png)",
      ),
      "export/files/cover.png": new Uint8Array([1, 2, 3]),
    });
    const note = dataset.notes[0];
    expect(note.title).toBe("Reading");
    expect(note.tags).toEqual(["Books", "Personal"]);
    expect(note.kind).toBe("task");
    expect(note.attachments[0].path).toBe("export/files/cover.png");
    expect(
      note.delta.ops.some((op) => op.attributes?.list === "unchecked"),
    ).toBe(true);
    expect(note.delta.ops.some((op) => op.attributes?.["code-block"])).toBe(
      true,
    );
    expect(plain(note.delta)).toContain("console.log(1)");
  });
  it("flattens tables with a visible warning and never evaluates HTML", () => {
    const warnings: string[] = [];
    const delta = markdownToDelta(
      "| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>",
      (warning) => warnings.push(warning),
    );
    expect(plain(delta)).toContain("1 | 2");
    expect(plain(delta)).toContain("<script>");
    expect(warnings).toHaveLength(2);
  });
  it("rejects binary Protobuf and Set-only exports with actionable instructions", () => {
    expect(() => parseExport({ "file.pb": new Uint8Array([1]) })).toThrow(
      /Binary Protobuf/,
    );
    expect(() =>
      parseExport({
        "set.pb.json": legacy("s", { name: "Set", resolvedLayout: 3 }, []),
      }),
    ).toThrow(/inside your Anytype Set/);
  });
  it("handles malformed JSON alongside valid objects and cyclic block trees", () => {
    const dataset = parseExport({
      "broken.json": strToU8("{"),
      "valid.pb.json": legacy("n", { name: "Cycle" }, [
        { id: "a", childrenIds: ["b"], text: { text: "A" } },
        { id: "b", childrenIds: ["a"], text: { text: "B" } },
      ]),
    });
    expect(plain(dataset.notes[0].delta)).toBe("A\nB\n");
    expect(dataset.warnings.some((warning) => warning.includes("cyclic"))).toBe(
      true,
    );
    expect(
      dataset.warnings.some((warning) => warning.includes("invalid JSON")),
    ).toBe(true);
  });
});

describe("Anchor v1 import archive contract", () => {
  it("creates a native manifest with serialized Quill Delta, stable UUIDs and matching counts", async () => {
    const dataset = parseExport(readFiles(exampleFiles()));
    const result = await createArchive(
      dataset,
      options(dataset),
      "2026-11-01T00:00:00.000Z",
    );
    const zip = unzipSync(result.bytes);
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
    expect(manifest.format).toBe("anchor-export");
    expect(manifest.version).toBe(1);
    expect(manifest.counts).toEqual({ notes: 4, tags: 3, attachments: 0 });
    expect(
      manifest.notes.every(
        (note: any) =>
          note.origin === "owned" &&
          note.state === "active" &&
          typeof note.content === "string" &&
          Array.isArray(JSON.parse(note.content).ops),
      ),
    ).toBe(true);
    expect(manifest.notes[0].id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    const second = await createArchive(dataset, options(dataset));
    expect(second.manifest.notes[0].id).toBe(manifest.notes[0].id);
    expect(
      Object.keys(zip).filter((path) => path.endsWith(".md")),
    ).toHaveLength(5);
    expect(strFromU8(zip["conversion-report.md"])).toContain(
      "Import into Anchor",
    );
  });
  it("removes tag properties from both manifest and Markdown without changing body text", async () => {
    const dataset = parseExport({
      "n.md": strToU8(
        "---\ntags: [Personal]\n---\n# Note\n\nKeep #body-tag as text.",
      ),
    });
    const result = await createArchive(
      dataset,
      options(dataset, { includeTags: false }),
    );
    expect(result.manifest.tags).toEqual([]);
    expect(result.manifest.notes[0].tagIds).toEqual([]);
    expect(result.manifest.notes[0].content).toContain("#body-tag");
    const zip = unzipSync(result.bytes);
    const markdown = strFromU8(
      Object.entries(zip).find(([path]) => path.startsWith("markdown/"))![1],
    );
    expect(markdown).not.toContain("tags:");
    expect(markdown).toContain("#body-tag");
  });
  it("keeps images importable and preserves unsupported originals with warnings", async () => {
    const dataset = parseExport({
      "n.md": strToU8("# Note\n\n![cat](cat.png)\n[PDF](file.pdf)"),
      "cat.png": new Uint8Array([1, 2, 3]),
      "file.pdf": strToU8("%PDF-test"),
    });
    const result = await createArchive(dataset, options(dataset));
    expect(result.manifest.counts.attachments).toBe(1);
    const zip = unzipSync(result.bytes);
    const attachment = result.manifest.notes[0].attachments[0];
    expect(zip[attachment.archivePath]).toEqual(new Uint8Array([1, 2, 3]));
    expect(attachment.mimeType).toBe("image/png");
    expect(
      Object.keys(zip).some((path) =>
        path.startsWith("unsupported-attachments/"),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((message) =>
        message.includes("Anchor cannot import"),
      ),
    ).toBe(true);
    const without = await createArchive(
      dataset,
      options(dataset, { includeAttachments: false }),
    );
    expect(without.manifest.counts.attachments).toBe(0);
    expect(
      Object.keys(unzipSync(without.bytes)).some((path) =>
        path.startsWith("attachments/"),
      ),
    ).toBe(false);
  });
  it("filters selection, object kinds, and archived notes and rejects an empty conversion", async () => {
    const dataset = parseExport(readFiles(exampleFiles()));
    dataset.notes[0].archived = true;
    expect(selectedNotes(dataset, options(dataset))).toHaveLength(3);
    expect(
      selectedNotes(dataset, options(dataset, { kinds: ["task"] })),
    ).toHaveLength(2);
    expect(
      selectedNotes(
        dataset,
        options(dataset, {
          selectedKeys: [dataset.notes[0].key],
          includeArchived: true,
        }),
      ),
    ).toHaveLength(1);
    await expect(
      createArchive(dataset, options(dataset, { selectedKeys: [] })),
    ).rejects.toThrow(/at least one/);
  });
});

describe("archive validation", () => {
  it("opens nested ZIPs and rejects invalid archives and unsafe paths", () => {
    const bytes = zipSync({ "Export/n.md": strToU8("# Note") });
    expect(
      Object.keys(
        readFiles([{ name: "export.zip", data: bytes.buffer as ArrayBuffer }]),
      ),
    ).toEqual(["Export/n.md"]);
    expect(() =>
      readFiles([{ name: "bad.zip", data: new Uint8Array([1, 2]).buffer }]),
    ).toThrow(/ZIP could not/);
    expect(() => safePath("../outside.md")).toThrow(/unsafe/);
    expect(() => safePath("C:\\outside.md")).toThrow(/unsafe/);
    expect(() =>
      readFiles([
        {
          name: "unsafe.zip",
          data: zipSync({ "../n.md": strToU8("bad") }).buffer as ArrayBuffer,
        },
      ]),
    ).toThrow(/unsafe/);
  });
  it("checks expanded file size before inflating a compressed bomb", () => {
    const bytes = zipSync({ "large.md": new Uint8Array(26 * 1024 * 1024) });
    expect(() =>
      readFiles([{ name: "large.zip", data: bytes.buffer as ArrayBuffer }]),
    ).toThrow(/expands beyond/);
  });
});

describe("compatibility boundaries", () => {
  it("recognizes the Object Type field used by Anytype Markdown exports", () => {
    const dataset = parseExport({
      "task.md": strToU8(
        "---\ntitle: Test Task\nObject Type: Task\ndone: true\n---\n# Test Task\n\nA task body.",
      ),
    });
    expect(dataset.notes[0].kind).toBe("task");
    expect(
      dataset.notes[0].delta.ops.some(
        (op) => op.attributes?.list === "checked",
      ),
    ).toBe(true);
  });
  it("retains original JSON file attachments instead of treating them as metadata", async () => {
    const dataset = parseExport({
      "n.md": strToU8("# Note\n\n[Configuration](settings.json)"),
      "settings.json": strToU8('{"theme":"dark"}'),
    });
    expect(dataset.notes[0].attachments).toHaveLength(1);
    const result = await createArchive(dataset, options(dataset));
    expect(
      result.warnings.some((warning) =>
        warning.includes("application/octet-stream"),
      ),
    ).toBe(true);
    const preserved = Object.entries(unzipSync(result.bytes)).find(([path]) =>
      path.startsWith("unsupported-attachments/"),
    );
    expect(strFromU8(preserved![1])).toBe('{"theme":"dark"}');
  });
  it("blocks incompatible tags at download time while allowing a tag-free conversion", async () => {
    const dataset = parseExport({
      "n.md": strToU8("---\ntags: [" + "A".repeat(101) + "]\n---\n# Note"),
    });
    await expect(createArchive(dataset, options(dataset))).rejects.toThrow(
      /Turn off Include tags/,
    );
    const result = await createArchive(
      dataset,
      options(dataset, { includeTags: false }),
    );
    expect(result.manifest.tags).toEqual([]);
  });
});

describe("blank source titles with readable review labels", () => {
  const objectId = "bafyrei" + "a".repeat(52);

  it("preserves a blank title while labeling the note from its first text in document order", async () => {
    const dataset = parseExport({
      [`${objectId}.pb.json`]: legacy(
        objectId,
        { resolvedLayout: 9, tags: ["Divertissement"] },
        [
          { id: "root", smartblock: {}, childrenIds: ["heading", "body"] },
          {
            id: "body",
            text: { text: "Voir les saves sur reddit", style: "Paragraph" },
          },
          { id: "heading", text: { text: "À lire", style: "Header2" } },
        ],
      ),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0])).toBe("À lire");
    expect(dataset.notes[0].key).toBe(objectId);
    expect(plain(dataset.notes[0].delta)).toBe(
      "À lire\nVoir les saves sur reddit\n",
    );
    const result = await createArchive(dataset, options(dataset));
    expect(result.manifest.notes[0].title).toBe("");
    const zip = unzipSync(result.bytes);
    const markdown = strFromU8(
      Object.entries(zip).find(([path]) => path.startsWith("markdown/"))![1],
    );
    expect(parseYaml(markdown.split("---")[1]).title).toBe("");
    expect(markdown).not.toMatch(/^# /m);
    expect(markdown).toContain("## À lire");
    expect(result.manifest.notes[0].content).toContain(
      "Voir les saves sur reddit",
    );
  });

  for (const style of ["Title", 7]) {
    it(`recovers a ${style} title block when the name is blank`, () => {
      const dataset = parseExport({
        [`${objectId}.pb.json`]: legacy(
          objectId,
          { name: " \n ", resolvedLayout: 9 },
          [
            { id: "title", text: { text: "Reading list", style } },
            { id: "body", text: { text: "Content", style: "Paragraph" } },
          ],
        ),
      });
      expect(dataset.notes[0].title).toBe("Reading list");
      expect(plain(dataset.notes[0].delta)).toBe("Content\n");
    });
  }

  it("preserves an explicit name instead of replacing it with a heading", () => {
    const dataset = parseExport({
      [`${objectId}.pb.json`]: legacy(objectId, { name: "Original name" }, [
        {
          id: "heading",
          text: { text: "A section heading", style: "Header2" },
        },
      ]),
    });
    expect(dataset.notes[0].title).toBe("Original name");
  });

  it("keeps an unnamed task title blank while retaining its completion state", () => {
    const dataset = parseExport({
      [`${objectId}.pb.json`]: legacy(
        objectId,
        { name: objectId, resolvedLayout: 2, done: true },
        [{ id: "body", text: { text: "Book a table", style: "Paragraph" } }],
      ),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0])).toBe("Book a table");
    expect(dataset.notes[0].delta.ops[0].attributes?.list).toBe("checked");
    expect(plain(dataset.notes[0].delta)).toBe("\nBook a table\n");
  });

  it("keeps empty objects untitled and uses a neutral review label", () => {
    const dataset = parseExport({
      [`${objectId}.pb.json`]: legacy(objectId, {}, []),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0])).toBe("Untitled");
  });

  it("labels unnamed AnyBlock 2 notes without assigning them a title", () => {
    const dataset = parseExport({
      [`${objectId}.anyblock.json`]: json({
        formatVersion: "2.0",
        id: objectId,
        properties: { Name: objectId },
        blocks: [
          {
            id: "body",
            type: "paragraph",
            text: "A **reading** [list](https://example.com)",
          },
        ],
      }),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0])).toBe("A reading list");
    expect(plain(dataset.notes[0].delta)).toBe("A reading list\n");
  });

  it("bounds review labels without changing the blank title or shortening the body", () => {
    const body = "A long note " + "é".repeat(150);
    const dataset = parseExport({
      [`${objectId}.pb.json`]: legacy(objectId, {}, [
        { id: "body", text: { text: body } },
      ]),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0]).length).toBeLessThanOrEqual(121);
    expect(noteLabel(dataset.notes[0]).endsWith("…")).toBe(true);
    expect(plain(dataset.notes[0].delta)).toBe(body + "\n");
  });

  it("preserves an explicit blank title in Markdown with an ID filename", () => {
    const dataset = parseExport({
      [`${objectId}.md`]: strToU8(
        "---\nname: ''\n---\n\nÀ **lire**\n\nVoir les saves sur reddit",
      ),
    });
    expect(dataset.notes[0].title).toBe("");
    expect(noteLabel(dataset.notes[0])).toBe("À lire");
    expect(plain(dataset.notes[0].delta)).toBe(
      "À lire\nVoir les saves sur reddit\n",
    );
  });
});

it("round-trips an unnamed note through generated Markdown without adding a heading or title", async () => {
  const dataset = parseExport({
    "note.pb.json": legacy("roundtrip", { resolvedLayout: 9 }, [
      {
        id: "body",
        text: { text: "A body, not a title.", style: "Paragraph" },
      },
    ]),
  });
  const result = await createArchive(dataset, options(dataset));
  const files = unzipSync(result.bytes);
  const entry = Object.entries(files).find(([path]) =>
    path.startsWith("markdown/"),
  )!;
  expect(entry[0]).toMatch(/\/Untitled\.md$/);
  const markdown = strFromU8(entry[1]);
  expect(markdown).not.toMatch(/^# /m);
  expect(result.manifest.notes[0].title).toBe("");
  const restored = parseExport({ [entry[0]]: entry[1] });
  expect(restored.notes[0].title).toBe("");
  expect(plain(restored.notes[0].delta)).toBe("A body, not a title.\n");
});

it("keeps an original heading as body content when Markdown explicitly declares no title", () => {
  const dataset = parseExport({
    "a-heading.md": strToU8(
      '---\ntitle: ""\n---\n# A body heading\n\nOriginal text',
    ),
  });
  expect(dataset.notes[0].title).toBe("");
  expect(plain(dataset.notes[0].delta)).toBe("A body heading\nOriginal text\n");
});

describe("code blocks and inline-format warnings", () => {
  const code = 'const value = "**literal**";\nconsole.log(value);';
  const codeLines = (delta: {
    ops: { insert: string; attributes?: Record<string, unknown> }[];
  }) =>
    delta.ops
      .filter((op) => op.attributes?.["code-block"])
      .reduce((sum, op) => sum + op.insert.split("\n").length - 1, 0);

  for (const style of ["Code", 6]) {
    it(`preserves legacy ${style} blocks and emits no inline-format warning`, async () => {
      const dataset = parseExport({
        "code.pb.json": legacy("code", { name: "Code example" }, [
          {
            id: "code",
            text: {
              text: code,
              style,
              marks: {
                marks: [
                  { type: "Keyboard", range: { from: 0, to: code.length } },
                ],
              },
            },
          },
        ]),
      });
      expect(plain(dataset.notes[0].delta)).toBe(code + "\n");
      expect(codeLines(dataset.notes[0].delta)).toBe(2);
      expect(dataset.warnings).toEqual([]);
      const result = await createArchive(dataset, options(dataset));
      expect(codeLines(JSON.parse(result.manifest.notes[0].content))).toBe(2);
    });
  }

  it("preserves AnyBlock 2 code without treating its Markdown characters as formatting", () => {
    const dataset = parseExport({
      "code.anyblock.json": json({
        formatVersion: "2.0",
        id: "code",
        properties: { Name: "Code example" },
        blocks: [{ id: "code", type: "code", language: "js", text: code }],
      }),
    });
    expect(plain(dataset.notes[0].delta)).toBe(code + "\n");
    expect(codeLines(dataset.notes[0].delta)).toBe(2);
    expect(dataset.warnings).toEqual([]);
  });

  it("round-trips multiline code with literal formatting and backticks through generated Markdown", async () => {
    const original =
      code + '\nconst slash = "\\path";\n```\nA Markdown fence inside code';
    const dataset = parseExport({
      "code.pb.json": legacy("code", { name: "Code example" }, [
        { id: "code", text: { text: original, style: "Code" } },
      ]),
    });
    const result = await createArchive(dataset, options(dataset));
    const files = unzipSync(result.bytes);
    const entry = Object.entries(files).find(([path]) =>
      path.startsWith("markdown/"),
    )!;
    const markdown = strFromU8(entry[1]);
    expect(markdown).toContain("````\n" + original + "\n````");
    const restored = parseExport({ [entry[0]]: entry[1] });
    expect(plain(restored.notes[0].delta)).toBe(original + "\n");
    expect(codeLines(restored.notes[0].delta)).toBe(5);
    expect(restored.warnings).toEqual([]);
  });

  it("distinguishes unsupported inline code from supported code blocks", () => {
    const dataset = parseExport({
      "inline.pb.json": legacy("inline", { name: "Inline example" }, [
        {
          id: "p",
          text: {
            text: "A command",
            marks: { marks: [{ type: "Keyboard", range: { from: 2, to: 9 } }] },
          },
        },
      ]),
    });
    expect(dataset.warnings).toEqual([
      "Inline example: Inline code spans are kept as plain text in Anchor. Code blocks retain their formatting.",
    ]);
    expect(plain(dataset.notes[0].delta)).toBe("A command\n");
  });

  it("does not suggest a code limitation when only text colors are omitted", () => {
    const dataset = parseExport({
      "color.pb.json": legacy("color", { name: "Color example" }, [
        {
          id: "p",
          text: {
            text: "Colored text",
            marks: {
              marks: [
                { type: "TextColor", param: "red", range: { from: 0, to: 7 } },
              ],
            },
          },
        },
      ]),
    });
    expect(dataset.warnings[0]).toContain("Text or background colors");
    expect(dataset.warnings[0]).not.toContain("code");
    expect(plain(dataset.notes[0].delta)).toBe("Colored text\n");
  });
});
