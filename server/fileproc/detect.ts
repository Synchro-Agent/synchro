import "server-only";
import { FileError } from "../../shared/fileproc/types";

// Tên các tệp trong zip, đọc thẳng từ danh mục trung tâm: không giải nén, không tạo đối tượng cho từng mục (zip độc hại có thể khai hàng trăm nghìn mục).
// Trả về null nếu tệp không phải zip đọc được.
export function zipNames(buf: Buffer, want: Set<string>): Set<string> | null {
  const min = Math.max(0, buf.length - 65_557);
  let end = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const size = buf.readUInt32LE(end + 12), off = buf.readUInt32LE(end + 16), found = new Set<string>();
  // ZIP64: không theo dõi tiếp, coi như zip thường; tiến trình đọc tệp tự xử lý.
  if (off === 0xffffffff || size === 0xffffffff) return found;
  // Tệp có phần đầu thêm vào (tự giải nén): vị trí khai lệch so với thực tế.
  let p = end - size;
  if (p < 0 || off > p) return null;
  while (p + 46 <= end && buf.readUInt32LE(p) === 0x02014b50) {
    const n = buf.readUInt16LE(p + 28), x = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32);
    if (n <= 64) { const name = buf.toString("utf8", p + 46, p + 46 + n); if (want.has(name)) found.add(name); }
    p += 46 + n + x + c;
  }
  return found;
}

const OOXML = new Set(["word/document.xml", "xl/workbook.xml", "ppt/presentation.xml"]);

/** UTF-16 không có dấu BOM: ký tự ASCII để lại một byte 0 ở nửa cao. Nhiều byte 0 ở vị trí lẻ → little-endian, ở vị trí chẵn → big-endian.
 * Trả về nhãn encoding cho TextDecoder, hoặc null nếu không giống UTF-16. */
export function sniffUtf16(buf: Buffer): "utf-16le" | "utf-16be" | null {
  const n = Math.min(buf.length - (buf.length % 2), 8192);
  if (n < 16) return null;
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i++) { if (buf[i] === 0) { if (i % 2) oddZero++; else evenZero++; } }
  const half = n / 2;
  // Một nửa (theo chẵn/lẻ) phần lớn là byte 0 còn nửa kia gần như không có: dấu hiệu rõ của UTF-16 văn bản ASCII/Latinh.
  if (oddZero / half > 0.3 && evenZero / half < 0.05) return "utf-16le";
  if (evenZero / half > 0.3 && oddZero / half < 0.05) return "utf-16be";
  return null;
}

/** Giải 8KB đầu theo UTF-16 đã đoán: văn bản thật gần như không có ký tự điều khiển (U+0000–U+0008, U+000E–U+001F) hay ký tự hỏng U+FFFD.
 * Dưới 2% mới coi là chữ. */
export function utf16LooksText(buf: Buffer, enc: "utf-16le" | "utf-16be"): boolean {
  const s = new TextDecoder(enc).decode(buf.subarray(0, Math.min(buf.length - (buf.length % 2), 8192)));
  if (!s.length) return false;
  let bad = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c <= 0x08 || (c >= 0x0e && c <= 0x1f) || c === 0xfffd) bad++; }
  return bad / s.length < 0.02;
}

// Nhận diện loại thật bằng magic bytes. Đuôi file chỉ dùng làm gợi ý cho loại văn bản.
export async function detectKind(buf: Buffer, name: string): Promise<string> {
  const h = buf.subarray(0, 16);
  const startsWith = (...b: number[]) => b.every((x, i) => h[i] === x);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 8).toString() === "ftyp") {
    // ftyp: cả HEIC/HEIF (ảnh) lẫn MP4/MOV (video) đều dùng hộp này; phân theo brand chính.
    const brand = buf.subarray(8, 12).toString().trim().toLowerCase();
    if (["heic", "heix", "heif", "mif1", "msf1", "hevc"].includes(brand)) return "image/heic";
    return "audio"; // mp4 / mov / m4a → phiên âm
  }
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    const z = zipNames(buf, OOXML);
    if (!z) throw new FileError(`"${name}" là tệp nén bị hỏng, không mở được.`);
    return z.has("word/document.xml") ? "docx" : z.has("xl/workbook.xml") ? "xlsx" : z.has("ppt/presentation.xml") ? "pptx" : "zip";
  }
  // Excel "Unicode Text" lưu UTF-16 có dấu BOM: đầy byte 0 nhưng là chữ thật, phải xét trước khi kết luận tệp nhị phân.
  // Xét TRƯỚC khung MPEG: BOM UTF-16LE (FF FE) cũng khớp mẫu đồng bộ FF Ex của MP3, từng làm tệp .csv UTF-16 bị đem đi phiên âm.
  if ((h[0] === 0xff && h[1] === 0xfe) || (h[0] === 0xfe && h[1] === 0xff)) return /\.(csv|tsv)$/i.test(name) ? "csv" : "text";
  // Âm thanh / video: mp3 (ID3 hoặc khung MPEG), wav (RIFF…WAVE), webm / mkv (EBML) → phiên âm bằng Scribe.
  if (startsWith(0x49, 0x44, 0x33) || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return "audio";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString() === "WAVE") return "audio";
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return "audio";
  if (startsWith(0x4f, 0x67, 0x67, 0x53)) return "audio"; // Ogg (ogg/opus)
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) {
    // Office cũ (.doc/.xls/.ppt, định dạng OLE). Chỉ chuyển bằng LibreOffice headless khi máy chủ có cài (biến môi trường SYNCHRO_SOFFICE_BIN);
    // mặc định (không đặt biến) giữ nguyên hành vi cũ: báo người dùng lưu lại thành .docx/.xlsx/.pptx. Không hard-fail khởi động máy chủ.
    if (process.env.SYNCHRO_SOFFICE_BIN) return "legacy-office";
    throw new FileError(`"${name}" là định dạng Office cũ (.doc/.xls/.ppt). Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  }
  // UTF-16 KHÔNG có dấu BOM (nhiều công cụ Windows xuất kiểu này): cũng đầy byte 0 nhưng là chữ, nhận trước khi coi là nhị phân.
  // Mẫu byte 0 chẵn/lẻ cũng gặp ở tệp nhị phân (bảng số nguyên 16-bit…): chỉ nhận khi giải ra thật sự là chữ, không thì rơi xuống chặn nhị phân bên dưới.
  const u16 = sniffUtf16(buf);
  if (u16 && utf16LooksText(buf, u16)) return /\.(csv|tsv)$/i.test(name) ? "csv" : "text";
  const head = buf.subarray(0, 8192);
  let ctl = 0; for (const c of head) if (c < 9 || (c > 13 && c < 32)) ctl++;
  if (head.includes(0) || ctl / Math.max(head.length, 1) > 0.05) throw new FileError(`"${name}" là tệp nhị phân (${(name.split(".").pop() || "không rõ").toUpperCase()}) mà Synchro chưa đọc được.`);
  return /\.(csv|tsv)$/i.test(name) ? "csv" : "text";
}
