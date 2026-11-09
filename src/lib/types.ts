export type Attributes = Record<string, string | number | boolean>;
export type Op = { insert: string; attributes?: Attributes };
export type Delta = { ops: Op[] };
export type Attachment = { path: string; name: string; mime: string };
export type Note = {
  key: string;
  title: string;
  kind: "note" | "task";
  typeName: string;
  tags: string[];
  delta: Delta;
  createdAt?: string;
  updatedAt?: string;
  archived: boolean;
  attachments: Attachment[];
};
export type Dataset = {
  notes: Note[];
  files: Record<string, Uint8Array>;
  warnings: string[];
  skipped: number;
  format: string;
};
export type Preview = Omit<Dataset, "files">;
export type Options = {
  includeTags: boolean;
  includeAttachments: boolean;
  includeArchived: boolean;
  kinds: ("note" | "task")[];
  selectedKeys: string[];
};
export const defaultOptions: Options = {
  includeTags: true,
  includeAttachments: true,
  includeArchived: false,
  kinds: ["note", "task"],
  selectedKeys: [],
};
