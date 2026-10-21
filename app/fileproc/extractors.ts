import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import sharp from "sharp";
import jschardet from "jschardet";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { type ContentBlock, type Extractor, FileError, IMAGE_MAX_EDGE } from "./types";

const run = promisify(execFile);
const PDF_NATIVE = process.env.LLM_PDF_NATIVE ? process.env.LLM_PDF_NATIVE === "1" : (process.env.LLM_PROVIDER ?? "anthropic") === "anthropic";
const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 20);
const XLSX_MAX_ROWS = 200;

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
    if (!big) return [{ type: "image", media_type: kind, data: buf.toString("base64") }];
    const out = await sharp(buf).resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside" }).toBuffer();
    const mt = kind === "image/gif" ? "image/png" : kind;
    return [{ type: "image", media_type: mt, data: out.toString("base64") }];
  },
};

// ---- 2. PDF ----
const pdfExtractor: Extractor = {
  name: "pdf",
  match: (k) => k === "application/pdf",
  async run(buf, { name }) {
    if (PDF_NATIVE) {
      // Provider hỗ trợ PDF trực tiếp: gửi nguyên văn bản gốc, kèm text dự phòng cho nhánh khác.
      const fb = await pdfFallback(buf).catch(() => null);
      return [{ type: "document", media_type: "application/pdf", data: buf.toString("base64"), name, fallbackText: fb?.text, fallbackImages: fb?.images }];
    }
    const fb = await pdfFallback(buf);
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
    const { stdout } = await run(py, [path.join(process.cwd(), "scripts", "pdf_extract.py"), src, String(PDF_MAX_PAGES), "1.3"], { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 });
    const j = JSON.parse(stdout) as { total: number; texts: string[]; images: string[] };
    const chars = j.texts.join("").replace(/\s+/g, "").length;
    const scanned = chars < 20 * Math.max(1, j.texts.length);
    // PDF scan (không có lớp text): chỉ dùng ảnh trang.
    const text = scanned ? "" : j.texts.map((t, i) => `--- Trang ${i + 1} ---\n${t}`).join("\n\n");
    const note = j.total > PDF_MAX_PAGES ? `\n\n(Chỉ xử lý ${PDF_MAX_PAGES}/${j.total} trang đầu.)` : "";
    return { text: text ? text + note : "", images: j.images };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---- 3. DOCX: tiêu đề / đoạn / bảng -> text thuần có cấu trúc ----
function htmlToText(html: string): string {
  const dec = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const strip = (s: string) => dec(s.replace(/<[^>]+>/g, "")).trim();
  let s = html.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => strip(c[0]).replace(/\|/g, "/")));
    if (!rows.length) return "";
    const w = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => "| " + Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ") + " |";
    return "\n\n" + [line(rows[0]), "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n") + "\n\n";
  });
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, x) => `\n\n${"#".repeat(Number(n))} ${strip(x)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, x) => `\n- ${strip(x)}`)
    .replace(/<\/p>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return dec(s).replace(/\n{3,}/g, "\n\n").trim();
}
const docxExtractor: Extractor = {
  name: "docx",
  match: (k) => k === "docx",
  async run(buf) {
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return [{ type: "text", text: htmlToText(value) }];
  },
};

// ---- 4. XLSX / CSV: giữ tên sheet + tên cột, 200 dòng đầu + thống kê ----
function sheetToText(ws: XLSX.WorkSheet, title: string): string {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
  if (!rows.length) return `## Sheet: ${title}\n(trống)`;
  const head = (rows[0] as unknown[]).map((c) => String(c ?? ""));
  const body = rows.slice(1);
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  const shown = body.slice(0, XLSX_MAX_ROWS);
  const lines = [`## Sheet: ${title} (${body.length} dòng, ${head.length} cột)`, "| " + head.map(cell).join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |",
    ...shown.map((r) => "| " + head.map((_, i) => cell((r as unknown[])[i])).join(" | ") + " |")];
  if (body.length > XLSX_MAX_ROWS) lines.push(`… (đã cắt, chỉ hiện ${XLSX_MAX_ROWS}/${body.length} dòng)`);
  const stats: string[] = [];
  head.forEach((h, i) => {
    const nums = body.map((r) => (r as unknown[])[i]).filter((v): v is number => typeof v === "number");
    if (nums.length > body.length / 2 && nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      stats.push(`- ${h || "cột " + (i + 1)}: min=${Math.min(...nums)}, max=${Math.max(...nums)}, trung bình=${+(sum / nums.length).toFixed(2)}, tổng=${+sum.toFixed(2)}`);
    }
  });
  if (stats.length) lines.push("\nThống kê cột số (toàn bộ dữ liệu):", ...stats);
  return lines.join("\n");
}
const sheetExtractor: Extractor = {
  name: "sheet",
  match: (k) => k === "xlsx" || k === "csv",
  async run(buf, { kind }) {
    const wb = kind === "csv" ? XLSX.read(decodeText(buf), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
    return [{ type: "text", text: wb.SheetNames.map((n) => sheetToText(wb.Sheets[n], n)).join("\n\n") }];
  },
};

// ---- 5. PPTX: text theo slide + ghi chú ----
const pptxExtractor: Extractor = {
  name: "pptx",
  match: (k) => k === "pptx",
  async run(buf) {
    const z = await JSZip.loadAsync(buf);
    const num = (n: string) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
    const txt = async (f: string) => [...(await z.file(f)!.async("string")).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).filter(Boolean)
      .map((s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).join("\n");
    const slides = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b));
    const out: string[] = [];
    for (const f of slides) {
      const n = num(f);
      const notesF = `ppt/notesSlides/notesSlide${n}.xml`;
      const notes = z.file(notesF) ? await txt(notesF) : "";
      out.push(`## Slide ${n}\n${await txt(f)}${notes ? `\n\n[Ghi chú] ${notes}` : ""}`);
    }
    return [{ type: "text", text: out.join("\n\n") }];
  },
};

// ---- 6. TXT / MD / JSON / code / HTML / XML ----
const textExtractor: Extractor = {
  name: "text",
  match: (k) => k === "text",
  async run(buf) { return [{ type: "text", text: decodeText(buf) }]; },
};

// Strategy: thêm loại mới chỉ cần thêm một extractor vào mảng này.
export const EXTRACTORS: Extractor[] = [imageExtractor, pdfExtractor, docxExtractor, sheetExtractor, pptxExtractor, textExtractor];

export function pickExtractor(kind: string, name: string): Extractor {
  const e = EXTRACTORS.find((x) => x.match(kind));
  if (!e) throw new FileError(`Không hỗ trợ loại tệp của "${name}".`);
  return e;
}
