import { readFiles, type InputFile } from "./lib/archive";
import { parseExport } from "./lib/parse";
import { createArchive } from "./lib/convert";
import type { Dataset, Options } from "./lib/types";

let dataset: Dataset | undefined;
self.onmessage = async (
  event: MessageEvent<
    | { type: "parse"; files: InputFile[] }
    | { type: "convert"; options: Options }
  >,
) => {
  try {
    if (event.data.type === "parse") {
      const next = parseExport(readFiles(event.data.files));
      dataset = next;
      const { files: _, ...preview } = next;
      self.postMessage({ type: "parsed", preview });
    } else {
      if (!dataset) throw new Error("Choose an export first.");
      const result = await createArchive(dataset, event.data.options);
      self.postMessage(
        { type: "converted", bytes: result.bytes, warnings: result.warnings },
        { transfer: [result.bytes.buffer] },
      );
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Conversion failed. Try a smaller, fresh export.",
    });
  }
};
