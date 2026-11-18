// Model chỉ nhận 2 loại đầu vào: text và ảnh (kèm document PDF nếu provider hỗ trợ).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string }
  | { type: "document"; media_type: string; data: string; name?: string; fallbackText?: string; fallbackImages?: string[] };

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** Các loại tệp máy chủ đọc được (gợi ý cho hộp chọn tệp của trình duyệt). Tệp lạ vẫn tải lên được dạng thô ở Synchro Code; danh sách này chỉ để
 * hộp chọn tệp mặc định lọc đúng loại hay dùng. Khớp nhánh nhận diện ở fileproc/detect.ts cộng các loại mở rộng (âm thanh, ảnh HEIC, Office cũ). */
export const UPLOAD_ACCEPT = [
  "image/*", "audio/*", "video/*", "application/pdf", "text/*",
  ".pdf", ".txt", ".md", ".markdown", ".mdx", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yml", ".yaml", ".toml", ".html", ".htm",
  ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt", ".pptx", ".zip",
  ".heic", ".heif", ".mp3", ".wav", ".m4a", ".mp4", ".mov", ".webm",
].join(",");
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
  // signal: yêu cầu tải lên của người gửi (đóng tab, gỡ thẻ tệp, hết giờ chờ thì hủy): việc chờ lượt dài (chép lời, OCR) rời hàng, không chạy nữa.
  run: (buf: Buffer, ctx: { name: string; kind: string; uid?: string; signal?: AbortSignal }) => Promise<ContentBlock[]>;
};
