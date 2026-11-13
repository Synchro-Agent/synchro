import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp, { type Metadata } from "sharp";
import jschardet from "jschardet";
import { parseInWorker, withParseSlot, withConvertSlot, lowPriority, parserEnv } from "./sandbox";
import { sniffUtf16 } from "./detect";
import { transcribeAudio } from "./transcribe";
import { type ContentBlock, type Extractor, FileError, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE } from "./types";

const run = promisify(execFile);
// Trần số điểm ảnh của một tấm ảnh: chặn "bom giải nén ảnh" (ảnh 20000×20000 = 400 triệu điểm ngốn hàng GB bộ nhớ khi giải nén).
const IMAGE_MAX_PIXELS = 40_000_000;
const PDF_NATIVE = process.env.LLM_PDF_NATIVE ? process.env.LLM_PDF_NATIVE === "1" : (process.env.LLM_PROVIDER ?? "anthropic") === "anthropic";
const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 20);
// Chữ lấy nhiều trang hơn ảnh rất nhiều: rẻ, và tệp dài thì tìm đoạn liên quan (RAG). Từng chỉ lấy 20 trang đầu của mọi tệp.
const PDF_TEXT_PAGES = Math.max(PDF_MAX_PAGES, Number(process.env.PDF_TEXT_PAGES ?? 600));
// Giới hạn số trang một tệp PDF gửi thẳng cho Claude (theo tài liệu API của hãng); chưa thử được trên CLI thật.
const PDF_NATIVE_PAGES = Number(process.env.PDF_NATIVE_PAGES ?? 100);

// Giải mã văn bản, tự phát hiện encoding (mặc định UTF-8).
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf).replace(/^\uFEFF/, "");
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf).replace(/^\uFEFF/, "");
  // UTF-16 không có dấu BOM: giải đúng little/big-endian thay vì coi mỗi byte 0 là ký tự rác.
  const u16 = sniffUtf16(buf);
  if (u16) return new TextDecoder(u16).decode(buf).replace(/^\uFEFF/, "");
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try { return utf8.decode(buf).replace(/^\uFEFF/, ""); } catch { /* không phải UTF-8 */ }
  const det = (jschardet.detect(buf.toString("binary")).encoding || "").toLowerCase();
  // Gần như UTF-8 (cụt ký tự cuối, lẫn một byte lạ): giải UTF-8 không fatal, chỉ byte hỏng thành U+FFFD, thay vì đọc cả tệp theo cp1252 ra "Tiáº¿ng".
  const loose = looseUtf8(buf, det.startsWith("utf-8"));
  if (loose !== null) return loose;
  // Mã một byte KHÔNG bao giờ ném lỗi (mọi byte đều có ký tự), nên thứ tự thử là tất cả: thử sai là ra chữ hỏng (São → Săo).
  // - Mã nhiều byte (Nhật/Trung/Hàn…): tin jschardet, sai thì TextDecoder fatal ném và lùi tiếp.
  // - Windows-1258 (tiếng Việt) chỉ khi có bằng chứng rõ là tiếng Việt (jschardet hay đoán tiếng Việt ngắn thành Hy Lạp).
  // - Mã chữ không phải Latinh (Nga, Hy Lạp, Do Thái, Thái): chỉ tin khi phần lớn chữ là byte cao — jschardet hay gán nhầm tiếng Ý thành Windows-1253.
  // - Còn lại là cp1252 (Tây Âu), kể cả khi jschardet đoán "cp1258".
  const tries: string[] = [];
  if (det && MULTI_BYTE.test(det)) tries.push(det);
  else if (looksVietnamese1258(buf)) tries.push("windows-1258");
  else if (det && NON_LATIN_1BYTE.test(det) && highByteShare(buf) >= 0.3) tries.push(det);
  else if (det && !WESTERN.test(det) && !NON_LATIN_1BYTE.test(det) && !det.includes("1258")) tries.push(det); // vd. Windows-1250 (Séc, Ba Lan)
  tries.push("windows-1252");
  for (const enc of tries) {
    // cp1258 ghi dấu thanh tách rời (ê + dấu sắc): ghép lại thành "ế" để tìm kiếm / so khớp chữ như văn bản UTF-8.
    try { const s = new TextDecoder(enc, { fatal: true }).decode(buf); return enc === "windows-1258" ? s.normalize("NFC") : s; } catch { /* thử encoding kế */ }
  }
  return new TextDecoder("windows-1252").decode(buf);
}

/** Văn bản UTF-8 có vài byte hỏng: phần lớn ký tự ngoài ASCII là chuỗi UTF-8 hợp lệ, U+FFFD chỉ chiếm phần nhỏ (≤ 1/5).
 * cp1252 thật gần như không bao giờ tạo ra chuỗi UTF-8 hợp lệ ("Ã©"), nên cần ≥3 ký tự hợp lệ; jschardet đã nói utf-8 thì 1 là đủ. */
function looseUtf8(buf: Buffer, detSaysUtf8: boolean): string | null {
  const s = new TextDecoder("utf-8").decode(buf);
  let good = 0, bad = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 0xfffd) bad++; else if (c >= 0x80) good++; }
  return good >= (detSaysUtf8 ? 1 : 3) && bad * 4 <= good ? s.replace(/^\uFEFF/, "") : null;
}

// Không có "utf": UTF-8 fatal đã hỏng ở trên thì thử lại vẫn hỏng (gần như UTF-8 đã do looseUtf8 lo).
const MULTI_BYTE = /^(shift_jis|euc-|gb|big5|iso-2022|hz)/;
const NON_LATIN_1BYTE = /^(windows-125[1356]|koi8|iso-8859-[5678]|maccyrillic|x-mac-cyrillic|ibm8(55|66)|tis-620)/;
const WESTERN = /^(ascii|windows-1252|iso-8859-1)$/;

// Tỉ lệ byte ≥0x80 trong số byte "chữ" (chữ ASCII hoặc byte cao): văn bản chữ Kirin/Hy Lạp gần như toàn byte cao, văn bản chữ Latinh chỉ lác đác.
function highByteShare(buf: Buffer): number {
  let hi = 0, letters = 0;
  for (const c of buf.subarray(0, 65_536)) {
    if (c >= 0x80) { hi++; letters++; } else if ((c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a) letters++;
  }
  return letters ? hi / letters : 0;
}

// Byte mà cp1258 đọc khác cp1252 theo kiểu riêng của tiếng Việt: Ă ă Đ đ Ơ ơ Ư ư ₫ và 5 dấu thanh dạng tổ hợp (huyền, sắc, ngã, hỏi, nặng).
const VN_1258_BYTES = new Set([0xc3, 0xe3, 0xd0, 0xf0, 0xd5, 0xf5, 0xdd, 0xfd, 0xfe, 0xcc, 0xec, 0xde, 0xd2, 0xf2]);
// Một âm tiết tiếng Việt (đã bỏ dấu thanh): phụ âm đầu + vần. Nguyên âm ă / â / iê / uô / ươ… luôn cần phụ âm cuối ("ăn", không có "ăo").
const VN_SYLLABLE = new RegExp(
  "^(?:ngh|ng|nh|ch|gh|gi|kh|ph|th|tr|qu|[bcdđghklmnprstvx])?(?:" +
  "(?:uyê|oă|oa|oe|uâ|uê|uy|iê|yê|uô|ươ|oo|a|ă|â|e|ê|i|o|ô|ơ|u|ư|y)(?:ch|ng|nh|c|m|n|p|t)" +
  "|uya|uyu|uây|uôi|ươi|ươu|iêu|yêu|oai|oay|oeo|ai|ao|au|ay|âu|ây|eo|êu|ia|iu|oa|oe|oi|ôi|ơi|ua|uê|ui|uơ|uy|ưa|ưi|ưu|a|e|ê|i|o|ô|ơ|u|ư|y)$",
);
const isVnSyllable = (w: string) => VN_SYLLABLE.test(w.normalize("NFD").replace(/[̣̀́̃̉]/g, "").normalize("NFC"));

/** Bằng chứng tích cực rằng tệp là tiếng Việt mã Windows-1258: có byte đặc trưng, và khi đọc theo 1258 thì các từ mang chữ/dấu riêng của tiếng Việt
 * là âm tiết tiếng Việt hợp lệ (không phải "Săo", "coś", "međ" như văn bản Bồ Đào Nha / Ý / Iceland mã cp1252), đồng thời đa số từ là âm tiết tiếng Việt.
 * Cần ít nhất một từ hợp lệ có ă / đ / ơ / ư; chỉ có dấu thanh tổ hợp thì cần ≥3 từ (tiếng Ý "può", "ciò" cũng ra âm tiết trông như tiếng Việt). */
export function looksVietnamese1258(buf: Buffer): boolean {
  const head = buf.subarray(0, 65_536);
  if (!head.some((c) => VN_1258_BYTES.has(c))) return false;
  const words = new TextDecoder("windows-1258").decode(head).normalize("NFC").toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
  let valid = 0, letters = 0, marks = 0, contra = 0;
  for (const w of words) {
    const ok = isVnSyllable(w);
    if (ok) valid++;
    if (!/[^\u0000-ÿ]/.test(w)) continue; // từ không có ký tự nào ngoài Latin-1: cp1252 và 1258 đọc như nhau, không là bằng chứng
    if (!ok) contra++;
    else if (/[ăđơư]/.test(w)) letters++;
    else marks++;
  }
  const evidence = letters + marks;
  return (letters > 0 || marks >= 3) && evidence >= 2 * contra && valid / words.length >= 0.5;
}

// ---- 1. Ảnh: gửi thẳng, KHÔNG OCR; tự xoay theo EXIF (ảnh dọc chụp điện thoại lên đúng chiều), resize nếu cạnh dài > 1568px, HEIC/GIF → PNG ----
// failOn:"error" để ảnh hỏng báo lỗi rõ thay vì ra dữ liệu rác; limitInputPixels chặn ảnh khổng lồ.
const openImage = (b: Buffer) => sharp(b, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" });
const imageExtractor: Extractor = {
  name: "image",
  match: (k) => k.startsWith("image/"),
  async run(buf, { kind, name }) {
    let meta: Metadata;
    try { meta = await openImage(buf).metadata(); }
    catch { throw new FileError(`Ảnh "${name}" quá lớn hoặc bị hỏng nên không xử lý được (giới hạn ~40 triệu điểm ảnh).`); }
    const w = meta.width ?? 0, hgt = meta.height ?? 0;
    if (w * hgt > IMAGE_MAX_PIXELS) throw new FileError(`Ảnh "${name}" quá lớn (${w}×${hgt} điểm ảnh). Giới hạn ~40 triệu điểm ảnh — hãy thu nhỏ rồi tải lại.`);
    const heic = kind === "image/heic", gif = kind === "image/gif";
    const needRotate = (meta.orientation ?? 1) > 1;       // có cờ xoay EXIF: phải nắn lại để ảnh lên đúng chiều
    const big = Math.max(w, hgt) > IMAGE_MAX_EDGE;
    // Ảnh thường, nhỏ, không cần xoay / đổi định dạng: gửi nguyên bản cho model.
    if (!heic && !gif && !needRotate && !big && buf.length <= IMAGE_MAX_BYTES) return [{ type: "image", media_type: kind, data: buf.toString("base64") }];
    let pipe = openImage(buf).rotate();                   // rotate() không tham số = tự xoay theo EXIF rồi gỡ cờ
    if (big) pipe = pipe.resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside" });
    // HEIC (model không nhận) và GIF động (chỉ cần khung đầu): ép sang PNG.
    let out: Buffer, mt: string;
    try {
      if (heic || gif) { out = await pipe.png().toBuffer(); mt = "image/png"; }
      else { out = await pipe.toBuffer(); mt = kind; }
    } catch { throw new FileError(heic ? `Không đọc được ảnh HEIC "${name}" (máy chủ chưa hỗ trợ giải mã HEIC). Hãy lưu sang JPEG / PNG rồi tải lại.` : `Ảnh "${name}" bị hỏng, không xử lý được.`); }
    // Ảnh chụp màn hình PNG vẫn nặng sau khi thu nhỏ: nén JPEG chất lượng cao (nền trắng cho phần trong suốt) để 20 ảnh vẫn gửi được một lần.
    if (out.length > IMAGE_MAX_BYTES) {
      const jpg = await openImage(out).flatten({ background: "#ffffff" }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
      if (jpg.length < out.length) { out = jpg; mt = "image/jpeg"; }
    }
    return [{ type: "image", media_type: mt, data: out.toString("base64") }];
  },
};

// ---- 1b. Âm thanh / video: phiên âm bằng Scribe, bản chép có mốc thời gian làm nội dung tệp (hàng convert, chạy lâu) ----
const audioExtractor: Extractor = {
  name: "audio",
  match: (k) => k === "audio",
  async run(buf, { name, uid }) { return [{ type: "text", text: await withConvertSlot(uid, () => transcribeAudio(buf, name, uid)) }]; },
};

// ---- 1c. Office cũ (.doc/.xls/.ppt): chuyển bằng LibreOffice headless (chỉ khi máy chủ có cài, SYNCHRO_SOFFICE_BIN) rồi đi tiếp đường docx/xlsx/pptx ----
async function convertLegacyOffice(buf: Buffer, name: string): Promise<{ buf: Buffer; kind: string }> {
  const bin = process.env.SYNCHRO_SOFFICE_BIN;
  if (!bin) throw new FileError(`"${name}" là định dạng Office cũ (.doc/.xls/.ppt). Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  // Đoán loại từ các luồng OLE để chọn đúng đuôi nguồn và đích; LibreOffice tự nhận bộ lọc nhập theo nội dung.
  const s = buf.subarray(0, 65_536).toString("latin1");
  const [srcExt, target] = /Workbook|\bBook\b/.test(s) ? ["xls", "xlsx"] : /PowerPoint Document/.test(s) ? ["ppt", "pptx"] : ["doc", "docx"];
  const dir = await mkdtemp(path.join(tmpdir(), "soffice-"));
  try {
    const src = path.join(dir, `in.${srcExt}`), profile = path.join(dir, "profile");
    await writeFile(src, buf);
    // Hồ sơ người dùng riêng theo lần chạy + môi trường tối thiểu (không khóa bí mật): nhiều lần chạy không giẫm lên nhau, soffice không ra mạng.
    const job = run(bin, ["--headless", "--norestore", "--nologo", `-env:UserInstallation=file://${profile}`, "--convert-to", target, "--outdir", dir, src],
      { timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, env: { ...parserEnv(), HOME: dir } });
    lowPriority(job.child.pid);
    await job;
    const out = await readFile(path.join(dir, `in.${target}`));
    return { buf: out, kind: target };
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError(`Không chuyển được tệp Office cũ "${name}". Hãy lưu lại thành .docx/.xlsx/.pptx rồi tải lên.`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const legacyOfficeExtractor: Extractor = {
  name: "legacy-office",
  match: (k) => k === "legacy-office",
  async run(buf, ctx) {
    const conv = await withConvertSlot(ctx.uid, () => convertLegacyOffice(buf, ctx.name));
    return [{ type: "text", text: await parseInWorker(conv.kind, conv.buf, ctx.name, ctx.uid) }];
  },
};

// ---- 2. PDF ----
const pdfExtractor: Extractor = {
  name: "pdf",
  match: (k) => k === "application/pdf",
  async run(buf, { name, uid }) {
    if (PDF_NATIVE) {
      // Provider hỗ trợ PDF trực tiếp: gửi nguyên văn bản gốc, kèm text dự phòng cho nhánh khác. Không có Python để đọc thử thì vẫn gửi như cũ.
      const fb = await withParseSlot(uid, () => pdfFallback(buf, uid)).catch((e) => { if (e instanceof BadPdf) throw new FileError(`Không đọc được "${name}": tệp PDF bị hỏng hoặc đang đặt mật khẩu.`); return null; });
      // Dài quá giới hạn số trang của API (lỗi cả lượt, có thể cả các lượt sau của phiên): gửi phần chữ, các lượt hỏi về tệp vẫn tìm được đoạn liên quan.
      if (!fb || fb.total <= PDF_NATIVE_PAGES) return [{ type: "document", media_type: "application/pdf", data: buf.toString("base64"), name, fallbackText: fb?.text, fallbackImages: fb?.images }];
      return textBlocks(fb);
    }
    return textBlocks(await withParseSlot(uid, () => pdfFallback(buf, uid)).catch((e) => { if (e instanceof BadPdf) throw new FileError(`Không đọc được "${name}": tệp PDF bị hỏng hoặc đang đặt mật khẩu.`); throw e; }));
  },
};
const textBlocks = (fb: { text: string; images: string[] }) => {
  const out: ContentBlock[] = [];
  if (fb.text) out.push({ type: "text", text: fb.text });
  out.push(...fb.images.map((data) => ({ type: "image" as const, media_type: "image/jpeg", data })));
  return out;
};

class BadPdf extends Error {}
const pyBin = () => process.env.PYTHON_BIN || path.join(process.cwd(), ".mkvenv", "bin", "python");
/** OCR một trang PDF scan bằng scripts/ocr.py (RapidOCR). Chỉ chạy khi bật SYNCHRO_OCR=1 (mặc định tắt: giữ nguyên hành vi cũ, không spawn vô ích khi máy chủ chưa cài OCR). */
async function ocrPage(imgPath: string, uid?: string): Promise<string> {
  const job = run(pyBin(), [path.join(process.cwd(), "scripts", "ocr.py"), imgPath], { maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: "SIGKILL", env: parserEnv() });
  lowPriority(job.child.pid);
  return withConvertSlot(uid, async () => (await job).stdout.trim());
}

async function pdfFallback(buf: Buffer, uid?: string): Promise<{ total: number; text: string; images: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf-"));
  const imgDir = path.join(dir, "img");
  try {
    const src = path.join(dir, "in.pdf");
    await mkdir(imgDir, { recursive: true });
    await writeFile(src, buf);
    // Môi trường tối thiểu (không khóa bí mật) + SIGKILL khi quá giờ: PDF độc hại không giữ được tiến trình hay đọc trộm biến môi trường.
    const job = run(pyBin(), [path.join(process.cwd(), "scripts", "pdf_extract.py"), src, String(PDF_MAX_PAGES), "1.3", String(PDF_TEXT_PAGES), imgDir], { maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: "SIGKILL", env: parserEnv() });
    lowPriority(job.child.pid);
    const { stdout } = await job;
    const j = JSON.parse(stdout) as { bad?: string; total: number; texts: string[]; images: string[] };
    if (j.bad) throw new BadPdf(j.bad);
    // Quyết định theo TỪNG trang: trang có dưới 20 ký tự chữ là trang scan → OCR riêng trang đó (khi đã bật OCR và có ảnh trang).
    const texts = [...j.texts];
    if (process.env.SYNCHRO_OCR === "1") {
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].replace(/\s+/g, "").length >= 20 || !j.images[i]) continue;
        const got = await ocrPage(path.join(imgDir, j.images[i]), uid).catch(() => "");
        if (got.trim()) texts[i] = got;
      }
    }
    const chars = texts.join("").replace(/\s+/g, "").length;
    const scanned = chars < 20 * Math.max(1, texts.length);
    // PDF scan không OCR được (không có lớp text, OCR tắt / thất bại): chỉ dùng ảnh trang.
    const text = scanned ? "" : texts.map((t, i) => `--- Trang ${i + 1} ---\n${t}`).join("\n\n");
    const note = !text ? "" : j.total > texts.length ? `\n\n(Chỉ có chữ của ${texts.length}/${j.total} trang đầu.)` : "";
    // Ảnh trang nằm trên đĩa tạm (không qua stdout): đọc lại và mã hoá base64 cho khối nội dung, rồi thư mục bị xoá ở finally.
    const images = await Promise.all(j.images.map((fn) => readFile(path.join(imgDir, fn)).then((b) => b.toString("base64"))));
    return { total: j.total, text: text ? text + note : j.total > PDF_MAX_PAGES ? `(PDF dạng ảnh ${j.total} trang: chỉ có ảnh của ${PDF_MAX_PAGES} trang đầu. Hãy nói rõ điều này với người dùng.)` : "", images };
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
export const EXTRACTORS: Extractor[] = [imageExtractor, audioExtractor, legacyOfficeExtractor, pdfExtractor, workerExtractor, textExtractor];

export function pickExtractor(kind: string, name: string): Extractor {
  const e = EXTRACTORS.find((x) => x.match(kind));
  if (!e) throw new FileError(`Không hỗ trợ loại tệp của "${name}".`);
  return e;
}
