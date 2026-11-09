import { parseDocument } from "yaml";
import { strFromU8 } from "fflate";
import { resolveFile } from "./archive";
import { readableTitle, contentLabel, noteLabel } from "./titles";
import { inline, line, markdownToDelta, push } from "./richtext";
import type { Attachment, Attributes, Dataset, Delta, Note, Op } from "./types";

// All untrusted export data is checked at the boundary before it becomes a Note.
type Raw = Record<string, any>;
const record = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => typeof v === "string" && !!v.trim(),
  );
const valueString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const isTrue = (value: unknown) => value === true || value === "true";
const basename = (path: string) => path.split("/").at(-1) ?? path;
const titleFromPath = (path: string) =>
  basename(path).replace(/\.(?:pb\.|anyblock\.)?json$|\.md$|\.markdown$/i, "");
export function date(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return;
  const numeric =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))
      ? Number(value)
      : undefined;
  const d =
    numeric === undefined
      ? new Date(String(value))
      : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
export function mimeFor(path: string): string {
  const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
  return (
    (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        m4a: "audio/x-m4a",
        ogg: "audio/ogg",
        aac: "audio/aac",
        webm: "audio/webm",
        pdf: "application/pdf",
        mp4: "video/mp4",
        txt: "text/plain",
      } as Record<string, string>
    )[ext] ?? "application/octet-stream"
  );
}

export function parseExport(files: Record<string, Uint8Array>): Dataset {
  const notes: Note[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const parsed: { path: string; raw: Raw; data: Raw; v2: boolean }[] = [];
  const formats = new Set<string>();
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  for (const [path, bytes] of Object.entries(files)) {
    if (
      !/\.json$/i.test(path) ||
      /(^|\/)(__MACOSX|\.git|\.DS_Store)(\/|$)/.test(path)
    )
      continue;
    try {
      const raw = record(JSON.parse(strFromU8(bytes)));
      const snapshot = record(raw.snapshot);
      const data = record(
        snapshot.data ?? (raw.snapshot ? snapshot : undefined),
      );
      const v2 =
        typeof raw.formatVersion === "string" && Array.isArray(raw.blocks);
      if (v2 && !raw.formatVersion.startsWith("2.")) {
        warn(
          `${basename(path)}: AnyBlock version ${raw.formatVersion} is unsupported.`,
        );
        skipped++;
        continue;
      }
      if (raw.snapshot || v2) parsed.push({ path, raw, data, v2 });
    } catch {
      warn(`${basename(path)}: invalid JSON; this file was skipped.`);
      skipped++;
    }
  }
  const byId = new Map<string, Raw>();
  const tagKeys = new Set(["tag", "tags"]);
  for (const item of parsed) {
    const d = item.v2 ? record(item.raw.properties) : record(item.data.details);
    byId.set(valueString(item.raw.id ?? d.id, titleFromPath(item.path)), {
      ...d,
      path: item.path,
    });
    for (const relation of list(item.data.relationLinks)) {
      if (relation.format === "tag" || relation.format === 11)
        tagKeys.add(relation.key);
    }
    if (
      d.relationKey &&
      (d.relationFormat === "tag" || d.relationFormat === 11)
    )
      tagKeys.add(d.relationKey);
  }
  const dictionaries = Object.entries(files).filter(([path]) =>
    /(^|\/)properties\.json$/.test(path),
  );
  for (const [, bytes] of dictionaries) {
    try {
      for (const property of list(JSON.parse(strFromU8(bytes)).properties)) {
        if (
          property.format === "tags" ||
          property.format === "tag" ||
          property.format === "multi_select"
        ) {
          for (const key of [
            property.property,
            property.name,
            property.internal_key,
          ])
            if (typeof key === "string") tagKeys.add(key);
        }
      }
    } catch {
      /* Already reported above when malformed. */
    }
  }
  const attachment = (
    source: string,
    target: string,
    name: string,
    mime = "",
  ): Attachment | undefined => {
    const object = byId.get(target);
    const candidates = [target, object?.["Name"], object?.name, name].filter(
      (v): v is string => typeof v === "string" && !!v,
    );
    for (const candidate of candidates) {
      const found =
        resolveFile(files, object?.path ?? source, candidate) ??
        resolveFile(files, source, candidate);
      if (found && !/\.(?:pb|anyblock)\.json$/i.test(found))
        return {
          path: found,
          name: name || basename(found),
          mime:
            mime ||
            object?.fileMimeType ||
            object?.["Mime type"] ||
            mimeFor(found),
        };
    }
    warn(
      `${basename(source)}: attachment “${name || target}” is missing from the export. Enable Include files in Anytype.`,
    );
  };
  const addNote = (note: Note) => {
    note.tags = [
      ...new Set(note.tags.map((tag) => tag.trim()).filter(Boolean)),
    ];
    note.attachments = note.attachments.filter(
      (a, index, all) => all.findIndex((b) => b.path === a.path) === index,
    );
    // Anchor limits the serialized Delta, not just the visible text.
    if (JSON.stringify(note.delta).length > 1_000_000) {
      throw new Error(
        `“${noteLabel(note)}” exceeds Anchor’s 1,000,000-character content limit. Split this object in Anytype, then export again.`,
      );
    }
    if (note.title.length > 1000) {
      warn(
        `“${note.title.slice(0, 50)}…”: title shortened to Anchor’s 1,000-character limit.`,
      );
      note.title = note.title.slice(0, 1000);
    }
    notes.push(note);
  };
  for (const { path, raw, data, v2 } of parsed) {
    const p = v2 ? record(raw.properties) : record(data.details);
    const get = (key: string, label: string) =>
      p[key] ??
      p[label] ??
      Object.entries(record(raw.property_internal_keys))
        .filter(([, val]) => val === key)
        .map(([name]) => p[name])[0];
    const layout =
      get("resolvedLayout", "Resolved layout") ?? get("layout", "Layout");
    const typeIds = strings(data.objectTypes ?? p.type);
    const typeName = valueString(
      v2
        ? raw.type
        : typeIds
            .map((id) => byId.get(id)?.name ?? id.replace(/^ot-|^type-/, ""))
            .join(", "),
      "Note",
    );
    const sbType = String(raw.sbType ?? "");
    const structuralPath =
      /(^|\/)(types|relations|relationsOptions|options|templates|participants|files)\//i.test(
        path,
      );
    const structuralLayout =
      [
        1, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        24, 25, 26, 27,
      ].includes(Number(layout)) ||
      /^(set|collection|object_type|property|property_option|file|image|audio|video|pdf|participant|space|space_view|profile)$/.test(
        String(layout),
      );
    const structuralType = sbType && !["Page", "16", "0x10"].includes(sbType);
    if (
      structuralPath ||
      structuralLayout ||
      structuralType ||
      (raw.kind && raw.kind !== "object") ||
      isTrue(get("isDeleted", "Deleted"))
    ) {
      skipped++;
      continue;
    }
    if (!Array.isArray(v2 ? raw.blocks : data.blocks)) {
      skipped++;
      continue;
    }
    formats.add(v2 ? "AnyBlock 2 JSON" : "Any-Block JSON");
    const blocks: Raw[] = list(v2 ? raw.blocks : data.blocks).map(record);
    const titleBlock = !v2
      ? blocks.find(
          (block) =>
            ["Title", 7].includes(block.text?.style) &&
            readableTitle(block.text?.text),
        )
      : undefined;
    const title =
      readableTitle(get("name", "Name")) ??
      readableTitle(titleBlock?.text?.text) ??
      "";
    const kind =
      Number(layout) === 2 ||
      layout === "todo" ||
      /\b(task|todo|to-do)\b/i.test(typeName)
        ? "task"
        : "note";
    const ops: Op[] = [];
    const attachments: Attachment[] = [];
    const contextWarnings: string[] = [];
    const contextWarn = (message: string) => contextWarnings.push(message);
    const emit = (block: Raw, depth = 0) => {
      const text = v2 ? block : record(block.text);
      const style = v2
        ? valueString(block.type)
        : typeof text.style === "number"
          ? [
              "Paragraph",
              "Header1",
              "Header2",
              "Header3",
              "Header4",
              "Quote",
              "Code",
              "Title",
              "Checkbox",
              "Marked",
              "Numbered",
              "Toggle",
              "Description",
              "Callout",
              "ToggleHeader1",
              "ToggleHeader2",
              "ToggleHeader3",
            ][text.style]
          : (text.style ?? "Paragraph");
      if (v2 ? typeof block.text === "string" : !!block.text) {
        if (style === "Title") return;
        let value = valueString(v2 ? block.text : text.text);
        let inlineOps: Op[] = [];
        const attrs: Attributes = {};
        const heading = /^(?:Header|ToggleHeader|heading_)(\d)/.exec(style);
        if (heading) attrs.header = Math.min(Number(heading[1]), 3);
        else if (["Checkbox", "checkbox"].includes(style))
          attrs.list = isTrue(text.checked) ? "checked" : "unchecked";
        else if (["Marked", "bulleted_list_item"].includes(style))
          attrs.list = "bullet";
        else if (["Numbered", "numbered_list_item"].includes(style))
          attrs.list = "ordered";
        else if (["Quote", "quote"].includes(style)) attrs.blockquote = true;
        else if (["Code", "code"].includes(style)) attrs["code-block"] = true;
        if (depth && attrs.list) attrs.indent = Math.min(depth, 8);
        if (v2 && !attrs["code-block"]) {
          // Mentions remain human-readable. No HTML is inserted in the page.
          value = value.replace(/<mention\b[^>]*>([\s\S]*?)<\/mention>/g, "$1");
          inlineOps = inline(value);
          if (/<\/?(?:font|u|mark)\b/.test(value))
            contextWarn("Some inline HTML formatting is preserved as text.");
        } else if (attrs["code-block"]) inlineOps = [{ insert: value }];
        else {
          const marks = list(record(text.marks).marks);
          const boundaries = new Set([0, value.length]);
          for (const mark of marks) {
            const range = record(mark.range);
            boundaries.add(
              Math.max(0, Math.min(value.length, Number(range.from) || 0)),
            );
            boundaries.add(
              Math.max(0, Math.min(value.length, Number(range.to) || 0)),
            );
          }
          const points = [...boundaries].sort((a, b) => a - b);
          for (let i = 0; i < points.length - 1; i++) {
            const start = points[i],
              end = points[i + 1];
            const formats: Attributes = {};
            for (const mark of marks) {
              if (
                Number(mark.range?.from ?? 0) > start ||
                Number(mark.range?.to ?? 0) < end
              )
                continue;
              const type =
                typeof mark.type === "number"
                  ? [
                      "Strikethrough",
                      "Keyboard",
                      "Italic",
                      "Bold",
                      "Underscored",
                      "Link",
                      "TextColor",
                      "BackgroundColor",
                      "Mention",
                      "Emoji",
                      "Object",
                    ][mark.type]
                  : mark.type;
              const key = (
                {
                  Bold: "bold",
                  Italic: "italic",
                  Underscored: "underline",
                  Strikethrough: "strike",
                } as Record<string, string>
              )[type];
              if (key) formats[key] = true;
              else if (type === "Link") formats.link = valueString(mark.param);
              else if (
                ["BackgroundColor", "TextColor", "Keyboard"].includes(type)
              )
                contextWarn(
                  "Some text colors or inline code styling are not supported by Anchor; the text is kept.",
                );
            }
            push(inlineOps, value.slice(start, end), formats);
          }
        }
        line(ops, inlineOps, attrs);
      } else if (
        block.file ||
        (v2 && ["image", "audio", "file", "video", "pdf"].includes(style))
      ) {
        const file = v2 ? block : record(block.file);
        const target = valueString(
          file.object_id ?? file.targetObjectId ?? file.hash,
        );
        const found = attachment(
          path,
          target,
          valueString(file.name),
          valueString(file.mime_type ?? file.mime),
        );
        if (found) attachments.push(found);
        line(ops, [
          { insert: `[Attachment: ${valueString(file.name, target)}]` },
        ]);
      } else if (block.bookmark || style === "bookmark") {
        const bookmark = v2 ? block : block.bookmark;
        const url = valueString(bookmark.url);
        line(ops, [
          {
            insert: valueString(bookmark.title, url),
            ...(url ? { attributes: { link: url } } : {}),
          },
        ]);
      } else if (block.link || style === "link" || style === "object") {
        const target = valueString(
          v2 ? block.object_id : block.link.targetBlockId,
        );
        line(ops, [
          {
            insert: valueString(
              byId.get(target)?.name ?? byId.get(target)?.Name,
              target || "Linked object",
            ),
            attributes: {
              link: `anytype://object?objectId=${encodeURIComponent(target)}`,
            },
          },
        ]);
        contextWarn(
          "Object links still point to Anytype; Anchor cannot resolve them to imported notes.",
        );
      } else if (block.latex || style === "latex") {
        line(ops, [{ insert: valueString(block.latex?.text ?? block.text) }]);
        contextWarn("Equations are preserved as text.");
      } else if (block.div || style === "divider") line(ops, [{ insert: "—" }]);
      else if (
        block.table ||
        style === "table" ||
        block.dataview ||
        style === "dataview"
      )
        contextWarn(
          "Tables and views cannot be recreated in Anchor. Export the objects shown in a Set, not only the Set itself.",
        );
      else if (
        (v2 &&
          !["property", "layout", "table_row", "table_column"].includes(
            style,
          )) ||
        (!v2 &&
          Object.keys(block).some((key) =>
            ["widget", "chat", "tableOfContents"].includes(key),
          ))
      )
        contextWarn(
          `Unsupported block ${v2 ? style : "widget or embedded content"} was skipped.`,
        );
    };
    if (v2) {
      for (const block of blocks) emit(block, Number(block.indent) || 0);
    } else {
      // The array's order is not document order. Traverse childrenIds, including layout containers.
      const map = new Map(blocks.map((block) => [block.id, block]));
      const children = new Set(
        blocks.flatMap((block) => strings(block.childrenIds)),
      );
      const visited = new Set<string>();
      const visit = (block: Raw, depth = 0) => {
        if (visited.has(block.id)) return;
        visited.add(block.id);
        emit(block, depth);
        const nextDepth =
          block.text &&
          !["Title", "Description", 7, 12].includes(block.text.style)
            ? depth + 1
            : depth;
        for (const id of strings(block.childrenIds)) {
          const child = map.get(id);
          if (child) visit(child, nextDepth);
        }
      };
      for (const block of blocks.filter((block) => !children.has(block.id)))
        visit(block);
      for (const block of blocks)
        if (!visited.has(block.id)) {
          contextWarn("A cyclic block tree was flattened.");
          visit(block);
        }
    }
    if (kind === "task") {
      ops.unshift(...(title ? [{ insert: title }] : []), {
        insert: "\n",
        attributes: {
          list: isTrue(get("done", "Done")) ? "checked" : "unchecked",
        },
      });
    }
    const tags: string[] = [];
    for (const [key, value] of Object.entries(p)) {
      if (tagKeys.has(key) || /^tags?$/i.test(key)) {
        for (const tag of strings(value)) {
          const option = byId.get(tag);
          if (option) tags.push(valueString(option.name ?? option.Name, tag));
          else if (
            /^(bafy|opt-|rel-)/.test(tag) ||
            /^[a-f0-9]{24,}$/i.test(tag)
          )
            contextWarn(
              `Tag “${tag}” could not be resolved. Include linked objects when exporting.`,
            );
          else tags.push(tag);
        }
      }
    }
    for (const message of contextWarnings)
      warn(`${title || "Unnamed note"}: ${message}`);
    addNote({
      key: valueString(raw.id ?? p.id, path),
      title,
      kind,
      typeName,
      tags,
      delta: { ops: ops.length ? ops : [{ insert: "\n" }] },
      createdAt: date(get("createdDate", "Creation date")),
      updatedAt: date(get("lastModifiedDate", "Last modified date")),
      archived: isTrue(get("isArchived", "Archived")),
      attachments,
    });
  }

  // Prefer structured objects if both formats for the same export are present.
  if (!notes.length) {
    for (const [path, bytes] of Object.entries(files)) {
      if (
        !/\.(md|markdown)$/i.test(path) ||
        /(^|\/)(__MACOSX|\.git)\//.test(path)
      )
        continue;
      if (/\.schema\./.test(path)) continue;
      formats.add("Markdown");
      let markdown = strFromU8(bytes)
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n");
      let properties: Raw = {};
      if (markdown.startsWith("---\n")) {
        const end = markdown.indexOf("\n---", 4);
        if (end !== -1) {
          const document = parseDocument(markdown.slice(4, end), {
            uniqueKeys: true,
          });
          if (document.errors.length)
            throw new Error(
              `${basename(path)} has invalid YAML properties. Export it again as Any-Block JSON.`,
            );
          properties = record(document.toJS({ maxAliasCount: 50 }));
          markdown = markdown.slice(end + 4).trimStart();
        }
      }
      const lower: Raw = Object.fromEntries(
        Object.entries(properties).map(([key, val]) => [
          key.toLowerCase().replace(/[ _-]/g, ""),
          val,
        ]),
      );
      const heading = /^#\s+(.+)(?:\n|$)/.exec(markdown);
      const hasTitleProperty =
        Object.hasOwn(lower, "title") || Object.hasOwn(lower, "name");
      const title = hasTitleProperty
        ? (readableTitle(lower.title) ?? readableTitle(lower.name) ?? "")
        : ((heading ? contentLabel(inline(heading[1])) : undefined) ??
          readableTitle(titleFromPath(path)) ??
          "");
      if (heading && heading[1] === title)
        markdown = markdown.slice(heading[0].length).trimStart();
      const typeName =
        strings(lower.objecttype ?? lower.type).join(", ") || "Note";
      if (/^(set|collection|query|object type|tag|relation)$/i.test(typeName)) {
        skipped++;
        continue;
      }
      const kind = /\b(task|todo|to-do)\b/i.test(typeName) ? "task" : "note";
      const attachments: Attachment[] = [];
      const contextWarnings: string[] = [];
      markdown = markdown.replace(
        /!?\[([^\]]*)\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,
        (match, label, href) => {
          const target = href.replace(/^<|>$/g, "");
          if (
            /^[a-z][a-z\d+.-]*:|^\/\//i.test(target) ||
            target.startsWith("#")
          )
            return match;
          if (/\.(md|markdown)(?:#.*)?$/i.test(target)) {
            contextWarnings.push(
              "Local document links are preserved as text because Anchor cannot resolve them.",
            );
            return `${label} (${target})`;
          }
          const file = attachment(path, target, label || basename(target));
          if (file) attachments.push(file);
          return `[Attachment: ${label || basename(target)}]`;
        },
      );
      const delta = markdownToDelta(markdown, (message) =>
        contextWarnings.push(message),
      );
      for (const message of contextWarnings)
        warn(`${title || "Unnamed note"}: ${message}`);
      if (kind === "task")
        delta.ops.unshift(...(title ? [{ insert: title }] : []), {
          insert: "\n",
          attributes: {
            list: isTrue(lower.done ?? lower.checked) ? "checked" : "unchecked",
          },
        });
      addNote({
        key: path,
        title,
        kind,
        typeName,
        delta,
        tags: strings(lower.tags ?? lower.tag),
        createdAt: date(
          lower.created ??
            lower.createddate ??
            lower.creationdate ??
            lower.createdat,
        ),
        updatedAt: date(
          lower.modified ??
            lower.lastmodifieddate ??
            lower.updated ??
            lower.updatedat,
        ),
        archived: isTrue(lower.archived ?? lower.isarchived),
        attachments,
      });
    }
  }
  const keys = new Set<string>();
  for (const note of notes) {
    if (keys.has(note.key))
      throw new Error(
        "This selection contains duplicate object IDs. Convert one export at a time.",
      );
    keys.add(note.key);
  }
  if (!notes.length)
    throw new Error(
      "No notes or tasks were found. Select the objects inside your Anytype Set and export as Any-Block → JSON or Markdown. A Set definition alone does not contain its notes. Binary Protobuf exports are not supported.",
    );
  return { notes, files, warnings, skipped, format: [...formats].join(" + ") };
}
