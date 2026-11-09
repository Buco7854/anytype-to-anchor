import type { Note, Op } from "./types";

export function readableTitle(value: unknown): string | undefined {
  const title = typeof value === "string" ? value.trim() : "";
  if (
    !title ||
    /^bafy[a-z2-7]{30,}$/i.test(title) ||
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(title) ||
    /^[a-f0-9]{32,}$/i.test(title) ||
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(title)
  )
    return;
  return title;
}

export function contentLabel(ops: Op[]): string | undefined {
  const first = ops
    .map((op) => op.insert)
    .join("")
    .split(/\r?\n/)
    .map((text) => text.trim().replace(/\s+/g, " "))
    .find((text) => readableTitle(text) && !/^\[Attachment:|^—$/.test(text));
  if (!first) return;
  const characters = Array.from(first);
  return characters.length > 120
    ? characters.slice(0, 120).join("").trimEnd() + "…"
    : first;
}

// A review/file label is never written back as an unnamed note's title.
export function noteLabel(note: Pick<Note, "title" | "delta">): string {
  return note.title || contentLabel(note.delta.ops) || "Untitled";
}
