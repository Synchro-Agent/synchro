import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import jschardet from "jschardet";
import { parseInWorker, withParseSlot, lowPriority } from "./sandbox";
import { type ContentBlock, type Extractor, FileError, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE } from "./types";

const run = promisify(execFile);
const PDF_NATIVE = process.env.LLM_PDF_NATIVE ? process.env.LLM_PDF_NATIVE === "1" : (process.env.LLM_PROVIDER ?? "anthropic") === "anthropic";
const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 20);

// Giải mã văn bản, tự phát hiện encoding (mặc định UTF-8).
export function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try { return utf8.decode(buf).replace(/^\uFEFF/, ""); } catch { /* không phải UTF-8 */ }
  const enc = (jschardet.detect(buf.toString("binary")).encoding || "windows-1252").toLowerCase();
  try { return new TextDecoder(enc).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

// ---- 1. Ảnh: gửi thẳng, KHÔNG OCR, resize nếu cạnh dài > 1568px ----
const imageExtractor: Extractor = {
  name: "image",
  match: (k) => k.startsWith("image/"),
  async run(buf, { kind }) {
    const meta = await sharp(buf).metadata();
    const big = Math.max(meta.width ?? 0, meta.height ?? 0) > IMAGE_MAX_EDGE;
    if (!big && buf.length <= IMAGE_MAX_BYTES) return [{ type: "image", media_type: kind, data: buf.toString("base64") }];
    let out = big ? await sharp(buf).resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside" }).toBuffer() : buf;
    let mt = kind === "image/gif" ? "image/png" : kind;
    // Ảnh chụp màn hình PNG vẫn nặng sau khi thu nhỏ: nén JPEG chất lượng cao (nền trắng cho phần trong suốt) để 20 ảnh vẫn gửi được một lần.
    if (out.length > IMAGE_MAX_BYTES) {
      const jpg = await sharp(out).flatten({ background: "#ffffff" }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
      if (jpg.length < out.length) { out = jpg; mt = "image/jpeg"; }
    }
    return [{ type: "image", media_type: mt, data: out.toString("base64") }];
  },
};

// ---- 2. PDF ----
const pdfExtractor: Extractor = {
  name: "pdf",
  match: (k) => k === "application/pdf",
  async run(buf, { name, uid }) {
    if (PDF_NATIVE) {
      // Provider hỗ trợ PDF trực tiếp: gửi nguyên văn bản gốc, kèm text dự phòng cho nhánh khác.
      const fb = await withParseSlot(uid, () => pdfFallback(buf)).catch(() => null);
      return [{ type: "document", media_type: "application/pdf", data: buf.toString("base64"), name, fallbackText: fb?.text, fallbackImages: fb?.images }];
    }
    const fb = await withParseSlot(uid, () => pdfFallback(buf));
    const out: ContentBlock[] = [];
    if (fb.text) out.push({ type: "text", text: fb.text });
    out.push(...fb.images.map((data) => ({ type: "image" as const, media_type: "image/jpeg", data })));
    return out;
  },
};

async function pdfFallback(buf: Buffer): Promise<{ text: string; images: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf-"));
  try {
    const src = path.join(dir, "in.pdf");
    await writeFile(src, buf);
    const py = process.env.PYTHON_BIN || path.join(process.cwd(), ".mkvenv", "bin", "python");
    const job = run(py, [path.join(process.cwd(), "scripts", "pdf_extract.py"), src, String(PDF_MAX_PAGES), "1.3"], { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 });
    lowPriority(job.child.pid);
    const { stdout } = await job;
    const j = JSON.parse(stdout) as { total: number; texts: string[]; images: string[] };
    const chars = j.texts.join("").replace(/\s+/g, "").length;
    const scanned = chars < 20 * Math.max(1, j.texts.length);
    // PDF scan (không có lớp text): chỉ dùng ảnh trang.
    const text = scanned ? "" : j.texts.map((t, i) => `--- Trang ${i + 1} ---\n${t}`).join("\n\n");
    const note = j.total > PDF_MAX_PAGES ? `\n\n(Chỉ xử lý ${PDF_MAX_PAGES}/${j.total} trang đầu.)` : "";
    return { text: text ? text + note : "", images: j.images };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---- 3. DOCX, XLSX / CSV, PPTX, ZIP: đọc trong tiến trình riêng (scripts/extract-worker.mjs), tệp độc hại hay quá lớn không kéo sập máy chủ web ----
const workerExtractor: Extractor = {
  name: "office",
  match: (k) => k === "docx" || k === "xlsx" || k === "csv" || k === "pptx" || k === "zip",
  async run(buf, { name, kind, uid }) { return [{ type: "text", text: await parseInWorker(kind, buf, name, uid) }]; },
};

// ---- 4. TXT / MD / JSON / code / HTML / XML ----
const textExtractor: Extractor = {
  name: "text",
  match: (k) => k === "text",
  async run(buf) { return [{ type: "text", text: decodeText(buf) }]; },
};

// Strategy: thêm loại mới chỉ cần thêm một extractor vào mảng này.
export const EXTRACTORS: Extractor[] = [imageExtractor, pdfExtractor, workerExtractor, textExtractor];

export function pickExtractor(kind: string, name: string): Extractor {
  const e = EXTRACTORS.find((x) => x.match(kind));
  if (!e) throw new FileError(`Không hỗ trợ loại tệp của "${name}".`);
  return e;
}
