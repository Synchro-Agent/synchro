// Model chỉ nhận 2 loại đầu vào: text và ảnh (kèm document PDF nếu provider hỗ trợ).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string }
  | { type: "document"; media_type: string; data: string; name?: string; fallbackText?: string; fallbackImages?: string[] };

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const LARGE_TOKENS = 50_000;
export const IMAGE_MAX_EDGE = 1568;
export const estTokens = (s: string) => Math.ceil(s.length / 4);

export class FileError extends Error {}

export type Extractor = {
  name: string;
  match: (kind: string) => boolean;
  run: (buf: Buffer, ctx: { name: string; kind: string }) => Promise<ContentBlock[]>;
};
