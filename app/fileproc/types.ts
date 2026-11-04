// Model chỉ nhận 2 loại đầu vào: text và ảnh (kèm document PDF nếu provider hỗ trợ).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string }
  | { type: "document"; media_type: string; data: string; name?: string; fallbackText?: string; fallbackImages?: string[] };

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** Như Claude: tối đa 20 tệp mỗi tin nhắn (đủ cho một bộ đề nhiều trang chụp màn hình). */
export const MAX_FILES_PER_MESSAGE = 20;
/** Tổng dung lượng tệp gửi kèm một lượt (dưới giới hạn 40 MB của máy chủ web, chừa chỗ cho lịch sử chat). */
export const MAX_ATTACH_BYTES = 34 * 1024 * 1024;
/** Ảnh lớn hơn mức này sau khi thu nhỏ thì nén lại (JPEG chất lượng cao, chữ vẫn sắc nét) để nhiều ảnh vẫn gửi được một lần. */
export const IMAGE_MAX_BYTES = 900 * 1024;
export const LARGE_TOKENS = 50_000;
export const IMAGE_MAX_EDGE = 1568;
export const estTokens = (s: string) => Math.ceil(s.length / 4);

export class FileError extends Error {}

export type Extractor = {
  name: string;
  match: (kind: string) => boolean;
  run: (buf: Buffer, ctx: { name: string; kind: string; uid?: string }) => Promise<ContentBlock[]>;
};
