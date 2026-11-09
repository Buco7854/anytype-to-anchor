import "./style.css";
import { initTheme } from "./theme";
import { noteLabel } from "./lib/titles";
import { MAX_INPUT, type InputFile } from "./lib/archive";
import { ALLOWED_MIME, selectedNotes } from "./lib/convert";
import {
  defaultOptions,
  type Attributes,
  type Note,
  type Options,
  type Preview,
} from "./lib/types";
import { exampleFiles } from "./sample";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
initTheme();
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
let preview: Preview | undefined;
let options: Options = { ...defaultOptions, kinds: [...defaultOptions.kinds] };
let activeKey: string | undefined;
let busy = false;
let pendingName = "";
let search = "";
let downloadUrl: string | undefined;
const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
const announce = (text: string) => {
  $("status").textContent = text;
};
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setBusy(value: boolean, label = "") {
  busy = value;
  $("workspace").setAttribute("aria-busy", String(value));
  document
    .querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "[type=checkbox], #search, #select-all, .note-row button",
    )
    .forEach((control) => {
      control.disabled = value;
    });
  for (const id of [
    "choose-files",
    "replace-files",
    "try-example",
    "empty-example",
  ])
    $(id).toggleAttribute("disabled", value);
  $("source-state").textContent = label || (preview ? "Loaded" : "Source");
  $("download").toggleAttribute(
    "disabled",
    value || !preview || !selectedNotes(preview, options).length,
  );
  $("download").childNodes[0].textContent =
    label === "Converting…" ? "Creating ZIP… " : "Download Anchor ZIP ";
  if (label) announce(label);
}
function showError(message: string) {
  $("source-error").textContent = message;
  $("source-error").hidden = false;
}
async function loadFiles(files: FileList | File[]) {
  if (busy || !files.length) return;
  if (Array.from(files).reduce((sum, file) => sum + file.size, 0) > MAX_INPUT) {
    showError(
      "This export is larger than 100 MB. Export a smaller selection from your Set.",
    );
    return;
  }
  setBusy(true, "Reading…");
  try {
    const inputs = await Promise.all(
      Array.from(files).map(async (file) => ({
        name: file.name,
        data: await file.arrayBuffer(),
      })),
    );
    parse(
      inputs,
      files.length === 1 ? files[0].name : plural(files.length, "file"),
    );
  } catch {
    setBusy(false);
    showError("These files could not be read. Select them again to retry.");
  }
}
function parse(files: InputFile[], name: string) {
  pendingName = name;
  $("source-error").hidden = true;
  $("download-success").hidden = true;
  setBusy(true, "Reading…");
  worker.postMessage(
    { type: "parse", files },
    files.map((file) => file.data),
  );
}
function loadExample() {
  if (!busy) parse(exampleFiles(), "Example · 4 notes and tasks");
}
worker.onmessage = (event) => {
  if (event.data.type === "parsed") {
    preview = event.data.preview;
    options.selectedKeys = preview!.notes.map((note) => note.key);
    activeKey = preview!.notes[0]?.key;
    search = "";
    $<HTMLInputElement>("search").value = "";
    $("source-name").textContent = pendingName;
    $("source-loaded").hidden = false;
    $("drop-title").textContent = "Export loaded";
    $("choose-files").childNodes[0].textContent = "Choose another export ";
    $("dropzone").hidden = true;
    if (matchMedia("(max-width:700px)").matches)
      $<HTMLDetailsElement>("options-panel").open = false;
    $("empty-review").hidden = true;
    $("loaded-review").hidden = false;
    setBusy(false);
    update();
    announce(
      `${plural(preview!.notes.length, "object")} loaded. Ready to review.`,
    );
  } else if (event.data.type === "converted") {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(
      new Blob([event.data.bytes], { type: "application/zip" }),
    );
    const link = el("a");
    link.href = downloadUrl;
    link.download = `anytype-to-anchor-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    $("download-success").textContent =
      "ZIP created. In Anchor, open Settings → Import / Export → Import notes, then choose the downloaded ZIP.";
    $("download-success").hidden = false;
    setBusy(false);
    showWarnings(event.data.warnings);
    announce("Anchor ZIP created. Choose this ZIP in Anchor’s import dialog.");
  } else {
    setBusy(false);
    showError(event.data.message);
  }
};
worker.onerror = () => {
  setBusy(false);
  showError(
    "The converter could not start. Reload this page and try again in a current browser.",
  );
};
function visibleNotes(): Note[] {
  return (preview?.notes ?? []).filter(
    (note) =>
      options.kinds.includes(note.kind) &&
      (options.includeArchived || !note.archived) &&
      `${noteLabel(note)} ${note.tags.join(" ")} ${note.typeName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
}
function currentWarnings(chosen: Note[]): string[] {
  const warnings = [...(preview?.warnings ?? [])];
  if (options.includeAttachments) {
    for (const note of chosen)
      for (const file of note.attachments) {
        if (!ALLOWED_MIME.has(file.mime))
          warnings.push(
            `${noteLabel(note)}: ${file.name} will be kept in unsupported-attachments/. Anchor only imports supported images and audio.`,
          );
      }
  }
  return warnings;
}
function showWarnings(warnings: string[]) {
  $("warnings").hidden = !warnings.length;
  $("warnings-summary").textContent =
    `${plural(warnings.length, "conversion note")} to review`;
  $("warnings-list").replaceChildren(
    ...warnings.map((warning) => el("li", "", warning)),
  );
}
function update() {
  if (!preview) return;
  const chosen = selectedNotes(preview, options);
  $("notes-count").textContent = String(
    preview.notes.filter((note) => note.kind === "note").length,
  );
  $("tasks-count").textContent = String(
    preview.notes.filter((note) => note.kind === "task").length,
  );
  const notes = chosen.filter((note) => note.kind === "note").length;
  const tasks = chosen.length - notes;
  const tags = options.includeTags
    ? new Set(chosen.flatMap((note) => note.tags)).size
    : 0;
  const attachments = options.includeAttachments
    ? chosen.reduce((sum, note) => sum + note.attachments.length, 0)
    : 0;
  $("selection-summary").textContent =
    `${plural(notes, "note")} and ${plural(tasks, "task")} selected`;
  $("download-hint").textContent =
    `${plural(tags, "tag")} · ${plural(attachments, "file")} · Anchor backup ZIP`;
  $("review-description").textContent =
    `${preview.format} · ${plural(preview.notes.length, "object")}${preview.skipped ? ` · ${preview.skipped} supporting objects skipped` : ""}`;
  $("download").toggleAttribute("disabled", busy || !chosen.length);
  $("download-success").hidden = true;
  renderList();
  renderPreview();
  showWarnings(currentWarnings(chosen));
}
function renderList() {
  const visible = visibleNotes();
  const list = $("notes-list");
  if (!visible.some((note) => note.key === activeKey))
    activeKey = visible[0]?.key;
  $("select-all").textContent =
    visible.length &&
    visible.every((note) => options.selectedKeys.includes(note.key))
      ? "Deselect visible"
      : "Select visible";
  if (!visible.length) {
    list.replaceChildren(
      el(
        "p",
        "preview-empty",
        search
          ? "No matching notes. Try another search."
          : "No objects match these options. Include Notes, Tasks, or archived objects.",
      ),
    );
    return;
  }
  list.replaceChildren(
    ...visible.map((note) => {
      const row = el(
        "div",
        `note-row${activeKey === note.key ? " active" : ""}`,
      );
      const check = el("input");
      check.type = "checkbox";
      check.checked = options.selectedKeys.includes(note.key);
      check.setAttribute("aria-label", `Include ${noteLabel(note)}`);
      check.addEventListener("change", () => {
        if (check.checked) options.selectedKeys.push(note.key);
        else
          options.selectedKeys = options.selectedKeys.filter(
            (key) => key !== note.key,
          );
        // Keep focus on the same checkbox after the list is reconciled.
        const index = visible.findIndex((item) => item.key === note.key);
        update();
        list.querySelectorAll<HTMLInputElement>("input")[index]?.focus();
      });
      const button = el("button");
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `Preview ${noteLabel(note)} ${note.kind === "task" ? "Task" : "Note"}${note.title ? "" : " · No title"}${note.archived ? " · Archived" : ""}`,
      );
      button.setAttribute("aria-pressed", String(activeKey === note.key));
      button.append(
        el("span", "note-row-title", noteLabel(note)),
        document.createTextNode(" "),
        el(
          "span",
          "note-row-type",
          `${note.kind === "task" ? "Task" : "Note"}${note.title ? "" : " · No title"}${note.archived ? " · Archived" : ""}`,
        ),
      );
      button.addEventListener("click", () => {
        activeKey = note.key;
        list.querySelectorAll(".note-row").forEach((item) => {
          const active = item === row;
          item.classList.toggle("active", active);
          item
            .querySelector("button")!
            .setAttribute("aria-pressed", String(active));
        });
        renderPreview();
      });
      row.append(check, button);
      return row;
    }),
  );
}
function renderPreview() {
  const panel = $("note-preview");
  const note = preview?.notes.find((note) => note.key === activeKey);
  if (!note) {
    panel.replaceChildren(
      el("p", "preview-empty", "Select a note to preview its content."),
    );
    return;
  }
  panel.replaceChildren();
  const date = note.createdAt
    ? new Date(note.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Original date unavailable";
  panel.append(
    el(
      "p",
      "preview-meta",
      `${note.kind === "task" ? "Task" : "Note"}${note.title ? "" : " · No title"} · ${date}`,
    ),
  );
  if (note.title) panel.append(el("h3", "", note.title));
  if (options.includeTags && note.tags.length) {
    const tags = el("div", "preview-tags");
    tags.setAttribute("aria-label", "Tags");
    tags.append(...note.tags.map((tag) => el("span", "tag", tag)));
    panel.append(tags);
  }
  const content = el("div", "preview-content");
  let current = el("p", "preview-line");
  const orderedCounts = new Map<number, number>();
  const addLine = (attrs: Attributes) => {
    if (attrs.header) current.classList.add("header");
    if (attrs["code-block"]) current.classList.add("code");
    if (attrs.blockquote) current.classList.add("quote");
    if (attrs.list === "checked" || attrs.list === "unchecked") {
      const check = el("input", "preview-checkbox");
      check.type = "checkbox";
      check.disabled = true;
      check.checked = attrs.list === "checked";
      check.setAttribute(
        "aria-label",
        attrs.list === "checked" ? "Completed task" : "Incomplete task",
      );
      current.prepend(check);
    } else if (attrs.list) {
      const depth = Number(attrs.indent) || 0;
      const count = (orderedCounts.get(depth) ?? 0) + 1;
      if (attrs.list === "ordered") orderedCounts.set(depth, count);
      current.prepend(
        document.createTextNode(attrs.list === "ordered" ? `${count}. ` : "• "),
      );
    }
    if (!attrs.list) orderedCounts.clear();
    if (attrs.indent)
      current.style.paddingLeft = `${Number(attrs.indent) * 12}px`;
    content.append(current);
    current = el("p", "preview-line");
  };
  for (const op of note.delta.ops) {
    const attrs = op.attributes ?? {};
    op.insert.split("\n").forEach((part, index) => {
      if (index) addLine(attrs);
      if (!part) return;
      const span = el("span", "", part);
      if (attrs.bold) span.style.fontWeight = "600";
      if (attrs.italic) span.style.fontStyle = "italic";
      if (attrs.underline || attrs.strike)
        span.style.textDecoration =
          `${attrs.underline ? "underline" : ""} ${attrs.strike ? "line-through" : ""}`.trim();
      if (attrs.link) span.title = String(attrs.link);
      current.append(span);
    });
  }
  if (current.textContent) content.append(current);
  panel.append(content);
  if (options.includeAttachments && note.attachments.length)
    panel.append(
      el(
        "p",
        "preview-attachment",
        `${plural(note.attachments.length, "attachment")} · ${note.attachments.map((file) => file.name).join(", ")}`,
      ),
    );
}
const input = $<HTMLInputElement>("file-input");
for (const id of ["choose-files", "replace-files"])
  $(id).addEventListener("click", () => {
    input.value = "";
    input.click();
  });
input.addEventListener("change", () => {
  if (input.files) void loadFiles(input.files);
});
for (const id of ["try-example", "empty-example"])
  $(id).addEventListener("click", loadExample);
// Drop is an alternative to the fully keyboard-operable file picker.
for (const type of ["dragenter", "dragover"])
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    if (!busy) $("dropzone").classList.add("dragover");
  });
for (const type of ["dragleave", "drop"])
  $("dropzone").addEventListener(type, () =>
    $("dropzone").classList.remove("dragover"),
  );
$("dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  if ((event as DragEvent).dataTransfer?.files)
    void loadFiles((event as DragEvent).dataTransfer!.files);
});
// Avoid navigating away if an export is dropped outside the input area.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());
for (const [id, key] of [
  ["include-tags", "includeTags"],
  ["include-attachments", "includeAttachments"],
  ["include-archived", "includeArchived"],
] as const) {
  $<HTMLInputElement>(id).addEventListener("change", (event) => {
    options[key] = (event.target as HTMLInputElement).checked;
    update();
  });
}
for (const [id, kind] of [
  ["include-notes", "note"],
  ["include-tasks", "task"],
] as const) {
  $<HTMLInputElement>(id).addEventListener("change", (event) => {
    options.kinds = (event.target as HTMLInputElement).checked
      ? [...options.kinds, kind]
      : options.kinds.filter((value) => value !== kind);
    update();
  });
}
$("search").addEventListener("input", (event) => {
  search = (event.target as HTMLInputElement).value;
  renderList();
  renderPreview();
});
$("select-all").addEventListener("click", () => {
  const visible = visibleNotes();
  const all = visible.every((note) => options.selectedKeys.includes(note.key));
  const keys = new Set(visible.map((note) => note.key));
  options.selectedKeys = all
    ? options.selectedKeys.filter((key) => !keys.has(key))
    : [...new Set([...options.selectedKeys, ...keys])];
  update();
});
$("download").addEventListener("click", () => {
  if (busy || !preview || !selectedNotes(preview, options).length) return;
  setBusy(true, "Converting…");
  worker.postMessage({ type: "convert", options });
});
const guide = $<HTMLDialogElement>("guide");
$("help-button").addEventListener("click", () => guide.showModal());
for (const id of ["close-guide", "guide-done"])
  $(id).addEventListener("click", () => guide.close());
guide.addEventListener("click", (event) => {
  if (event.target === guide) {
    const rect = guide.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      guide.close();
  }
});
