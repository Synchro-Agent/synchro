import JSZip from "jszip";
import { FileError } from "./types";

// Nhận diện loại thật bằng magic bytes. Đuôi file chỉ dùng làm gợi ý cho loại văn bản.
export async function detectKind(buf: Buffer, name: string): Promise<string> {
  const h = buf.subarray(0, 16);
  const startsWith = (...b: number[]) => b.every((x, i) => h[i] === x);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    try {
      const z = await JSZip.loadAsync(buf);
      if (z.file("word/document.xml")) return "docx";
      if (z.file("xl/workbook.xml")) return "xlsx";
      if (z.file("ppt/presentation.xml")) return "pptx";
    } catch { /* zip hỏng */ }
    throw new FileError(`"${name}" là tệp nén/định dạng Office không được hỗ trợ (chỉ nhận .docx, .xlsx, .pptx).`);
  }
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) throw new FileError(`"${name}" là định dạng Office cũ (.doc/.xls/.ppt). Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  const head = buf.subarray(0, 8192);
  let ctl = 0; for (const c of head) if (c < 9 || (c > 13 && c < 32)) ctl++;
  if (head.includes(0) || ctl / Math.max(head.length, 1) > 0.05) throw new FileError(`"${name}" là tệp nhị phân (${(name.split(".").pop() || "không rõ").toUpperCase()}) mà Synchro chưa đọc được.`);
  return /\.(csv|tsv)$/i.test(name) ? "csv" : "text";
}
