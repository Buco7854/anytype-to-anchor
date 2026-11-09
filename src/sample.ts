import { strToU8 } from "fflate";
import type { InputFile } from "./lib/archive";

// Deliberate example content; loaded only by the “Try an example” control.
export function exampleFiles(): InputFile[] {
  const object = (
    id: string,
    name: string,
    layout: number,
    tags: string[],
    blocks: any[],
    done = false,
  ) => ({
    sbType: "Page",
    snapshot: {
      data: {
        details: {
          id,
          name,
          resolvedLayout: layout,
          tags,
          done,
          createdDate: 1760058000,
          lastModifiedDate: 1760144400,
        },
        blocks: [
          { id, smartblock: {}, childrenIds: blocks.map((block) => block.id) },
          ...blocks,
        ],
      },
    },
  });
  const samples = [
    object(
      "example-note-garden",
      "A small digital garden",
      9,
      ["Personal", "Ideas"],
      [
        {
          id: "intro",
          text: {
            text: "Keep the ideas worth coming back to. Leave room for them to grow.",
            style: "Paragraph",
          },
        },
        {
          id: "heading",
          text: { text: "A few things to remember", style: "Header2" },
        },
        {
          id: "a",
          text: { text: "Write things in your own words", style: "Marked" },
        },
        {
          id: "b",
          text: { text: "Connect a new idea to an old one", style: "Marked" },
        },
        {
          id: "c",
          text: { text: "Come back. Change your mind.", style: "Marked" },
        },
      ],
    ),
    object(
      "example-note-weekend",
      "Plans for a slower weekend",
      0,
      ["Personal"],
      [
        {
          id: "p",
          text: {
            text: "A walk by the water, a book, and no particular schedule.",
            style: "Paragraph",
          },
        },
        {
          id: "q",
          text: { text: "Pack a notebook", style: "Checkbox", checked: false },
        },
      ],
    ),
    object(
      "example-task-move",
      "Give my notes a new home",
      2,
      ["Projects"],
      [
        {
          id: "p",
          text: {
            text: "Export the Notes and Tasks objects from Anytype, review the conversion, then import into Anchor.",
            style: "Paragraph",
          },
        },
      ],
    ),
    object(
      "example-task-sort",
      "Sort the reading list",
      2,
      ["Personal"],
      [
        {
          id: "p",
          text: {
            text: "Keep the books I still want to read. Let the rest go.",
            style: "Paragraph",
          },
        },
      ],
      true,
    ),
  ];
  return samples.map((raw, index) => ({
    name: `example-${index}.pb.json`,
    data: strToU8(JSON.stringify(raw)).buffer as ArrayBuffer,
  }));
}
