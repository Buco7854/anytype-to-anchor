import { unzipSync } from "fflate";

export const MAX_INPUT = 100 * 1024 * 1024;
const MAX_EXPANDED = 250 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
export type InputFile = { name: string; data: ArrayBuffer };

export function safePath(path: string): string {
  const value = path.replace(/\\/g, "/");
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..") ||
    /\0/.test(value)
  ) {
    throw new Error(
      "The export contains an unsafe file path. Create a fresh export in Anytype.",
    );
  }
  return value.replace(/^\.\//, "");
}

export function readFiles(inputs: InputFile[]): Record<string, Uint8Array> {
  if (!inputs.length)
    throw new Error("Choose an Anytype ZIP, JSON, or Markdown export.");
  if (inputs.reduce((sum, file) => sum + file.data.byteLength, 0) > MAX_INPUT) {
    throw new Error(
      "This export is larger than 100 MB. Export a smaller selection from your Set.",
    );
  }
  const result: Record<string, Uint8Array> = Object.create(null);
  let expanded = 0;
  let count = 0;
  const check = (size: number) => {
    expanded += size;
    count++;
    if (expanded > MAX_EXPANDED || size > MAX_FILE || count > 10000) {
      throw new Error(
        "This export expands beyond the browser limit (250 MB total, 25 MB per file, 10,000 files). Export a smaller selection.",
      );
    }
  };
  for (const input of inputs) {
    if (/\.zip$/i.test(input.name)) {
      let archive;
      try {
        archive = unzipSync(new Uint8Array(input.data), {
          filter: (entry) => {
            safePath(entry.name);
            check(entry.originalSize);
            return !entry.name.endsWith("/");
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/limit|unsafe|expands/.test(message)) throw error;
        throw new Error(
          "This ZIP could not be opened. Use an unencrypted ZIP export from Anytype.",
        );
      }
      for (const [name, data] of Object.entries(archive)) {
        const path = safePath(name);
        if (result[path])
          throw new Error(`Duplicate file path in export: ${path}`);
        result[path] = data;
      }
    } else {
      const name = safePath(input.name);
      check(input.data.byteLength);
      if (result[name])
        throw new Error(
          `Two selected files have the same name: ${name}. Use a ZIP to preserve their folders.`,
        );
      result[name] = new Uint8Array(input.data);
    }
  }
  return result;
}

export function resolveFile(
  files: Record<string, Uint8Array>,
  source: string,
  target: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/)[0]);
  } catch {
    decoded = target;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) return;
  const parts = source.split("/").slice(0, -1);
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part) parts.push(part);
  }
  const relative = parts.join("/");
  if (files[relative]) return relative;
  if (files[decoded]) return decoded;
  // Older exports refer to a basename while storing the binary in files/.
  const matches = Object.keys(files).filter(
    (path) =>
      path.endsWith("/" + decoded) || path.split("/").at(-1) === decoded,
  );
  if (matches.length === 1) return matches[0];
}
