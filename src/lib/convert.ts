import { strToU8, zipSync } from "fflate";
import { stringify } from "yaml";
import { deltaToMarkdown } from "./richtext";
import type { Dataset, Note, Options } from "./types";

export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/aac",
  "audio/webm",
]);
export function selectedNotes(
  dataset: Pick<Dataset, "notes">,
  options: Options,
): Note[] {
  const keys = new Set(options.selectedKeys);
  return dataset.notes.filter(
    (note) =>
      keys.has(note.key) &&
      options.kinds.includes(note.kind) &&
      (options.includeArchived || !note.archived),
  );
}

// Stable UUID v5 identities allow Anchor's “Skip existing” option to work across conversions.
export async function uuid(key: string): Promise<string> {
  const namespace = new Uint8Array([
    0x7a, 0xbd, 0x18, 0x25, 0x62, 0x21, 0x4b, 0x9a, 0x9d, 0x02, 0x77, 0xf2,
    0x7b, 0xf3, 0xe0, 0x11,
  ]);
  const text = strToU8(key);
  const bytes = new Uint8Array(namespace.length + text.length);
  bytes.set(namespace);
  bytes.set(text, namespace.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)).slice(
    0,
    16,
  );
  hash[6] = (hash[6] & 15) | 80;
  hash[8] = (hash[8] & 63) | 128;
  const hex = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const filename = (name: string) =>
  name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 100) || "Untitled";

export async function createArchive(
  dataset: Dataset,
  options: Options,
  now = new Date().toISOString(),
) {
  const chosen = selectedNotes(dataset, options);
  if (!chosen.length)
    throw new Error("Select at least one note or task to convert.");
  if (options.includeTags) {
    const invalid = chosen.find(
      (note) =>
        note.tags.length > 50 || note.tags.some((tag) => tag.length > 100),
    );
    if (invalid)
      throw new Error(
        `“${invalid.title}” has tags beyond Anchor’s limits (50 per note, 100 characters per tag). Turn off Include tags or shorten the tags in Anytype.`,
      );
  }
  const warnings = [...dataset.warnings];
  const files: Record<string, Uint8Array> = Object.create(null);
  const tagNames = options.includeTags
    ? [...new Set(chosen.flatMap((note) => note.tags))].sort()
    : [];
  const tags = await Promise.all(
    tagNames.map(async (name) => ({
      id: await uuid("tag:" + name),
      name,
      color: null,
    })),
  );
  const tagIds = new Map(tags.map((tag) => [tag.name, tag.id]));
  const notes = [];
  let preserved = 0;
  for (const note of chosen) {
    const id = await uuid("anytype:" + note.key);
    const attachments = [];
    if (options.includeAttachments) {
      for (const [position, file] of note.attachments.entries()) {
        const bytes = dataset.files[file.path];
        if (!bytes) {
          warnings.push(`${note.title}: missing attachment ${file.name}.`);
          continue;
        }
        const attachmentId = await uuid(
          "attachment:" + note.key + ":" + file.path,
        );
        const supported = ALLOWED_MIME.has(file.mime);
        const archivePath = `${supported ? "attachments" : "unsupported-attachments"}/${id}/${attachmentId}-${filename(file.name)}`;
        files[archivePath] = bytes;
        if (supported) {
          attachments.push({
            id: attachmentId,
            type: file.mime.startsWith("image/") ? "image" : "audio",
            originalFilename: file.name,
            mimeType: file.mime,
            fileSize: bytes.length,
            position,
            archivePath,
          });
        } else {
          preserved++;
          warnings.push(
            `${note.title}: ${file.name} (${file.mime}) is kept in ${archivePath}. Anchor cannot import this attachment type.`,
          );
        }
      }
    }
    const content = JSON.stringify(note.delta);
    notes.push({
      id,
      origin: "owned",
      title: note.title,
      content,
      state: "active",
      isArchived: note.archived,
      isPinned: false,
      background: null,
      tagIds: options.includeTags
        ? note.tags.map((tag) => tagIds.get(tag)!)
        : [],
      createdAt: note.createdAt ?? now,
      updatedAt: note.updatedAt ?? note.createdAt ?? now,
      attachments,
    });
    const metadata = stringify({
      title: note.title,
      type: note.kind === "task" ? "Task" : "Note",
      ...(options.includeTags && note.tags.length ? { tags: note.tags } : {}),
      created: note.createdAt ?? now,
      modified: note.updatedAt ?? note.createdAt ?? now,
    });
    files[`markdown/${filename(note.title)}-${id.slice(0, 8)}.md`] = strToU8(
      `---\n${metadata}---\n\n# ${note.title}\n\n${deltaToMarkdown(note.delta)}`,
    );
  }
  const manifest = {
    format: "anchor-export",
    version: 1,
    exportedAt: now,
    server: { version: null },
    user: { id: "", email: "" },
    counts: {
      notes: notes.length,
      tags: tags.length,
      attachments: notes.reduce(
        (sum, note) => sum + note.attachments.length,
        0,
      ),
    },
    tags,
    notes,
    warnings,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["conversion-report.md"] = strToU8(
    `# Anytype → Anchor\n\nConverted ${notes.length} objects with ${tags.length} tags and ${manifest.counts.attachments} importable attachments.\n${preserved} unsupported attachments preserved separately. ${dataset.skipped} supporting or non-content objects skipped.\n\n## Import into Anchor\n\nOpen Anchor → Settings → Import / Export → Import notes. Select this ZIP and choose Anchor backup if asked. Review the import and keep “Skip existing” enabled to avoid duplicates. Requires an Anchor version with the Anchor backup importer.\n\nThe markdown/ folder contains readable copies. Import the ZIP once; do not also import these copies.\n\nTasks become individual notes with a checked or unchecked first line. Attachment placeholders identify the original location; Anchor displays attached media separately. Missing dates use the conversion time. Tags are ${options.includeTags ? "included" : "omitted"}; tags written inside body text remain part of the text.\n\n## Conversion notes\n\n${warnings.length ? warnings.map((message) => `- ${message.replace(/\n/g, " ")}`).join("\n") : "No conversion warnings."}\n\nObject relationships, Set filters, sharing, reminders, and version history are not recreated.\n`,
  );
  return { bytes: zipSync(files, { level: 6 }), manifest, warnings };
}
