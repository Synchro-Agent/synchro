// Đọc tệp văn phòng và tệp nén trong tiến trình riêng (app/fileproc/extractors.ts gọi): tệp người dùng tải lên là dữ liệu không tin được.
// - Zip bomb hay bảng tính khổng lồ chỉ làm chết tiến trình này (giới hạn bộ nhớ, thời gian ở phía gọi), không kéo sập máy chủ web đang giữ luồng trả lời của mọi người.
// - Lỗi prototype pollution của thư viện xlsx 0.18.5 mất theo tiến trình, không lọt vào máy chủ web.
// Cách gọi: node scripts/extract-worker.mjs <docx|xlsx|csv|pptx|zip> <tên tệp>; nội dung tệp vào stdin, stdout là JSON { text } hoặc { error: "too_big" | "bad" }.
import JSZip from "jszip";
import jschardet from "jschardet";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { measureZip, readCapped, ZipTooBig, ZIP_MAX_BYTES } from "./zipguard.mjs";

const XLSX_MAX_ROWS = 200;
// Đủ cho hàng nghìn trang; phần trên mức này model cũng không đọc hết (tệp lớn đi qua RAG), mà JSON quá lớn làm nặng máy chủ web khi nhận về.
const TEXT_MAX = 16_000_000;

function decodeText(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); } catch { /* không phải UTF-8 */ }
  const enc = (jschardet.detect(buf.toString("binary")).encoding || "windows-1252").toLowerCase();
  try { return new TextDecoder(enc).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

// ---- DOCX: tiêu đề / đoạn / bảng -> text thuần có cấu trúc ----
function htmlToText(html) {
  const dec = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const strip = (s) => dec(s.replace(/<[^>]+>/g, "")).trim();
  let s = html.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => strip(c[0]).replace(/\|/g, "/")));
    if (!rows.length) return "";
    const w = rows.reduce((a, r) => Math.max(a, r.length), 0);
    const line = (r) => "| " + Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ") + " |";
    return "\n\n" + [line(rows[0]), "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n") + "\n\n";
  });
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, x) => `\n\n${"#".repeat(Number(n))} ${strip(x)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, x) => `\n- ${strip(x)}`)
    .replace(/<\/p>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return dec(s).replace(/\n{3,}/g, "\n\n").trim();
}
async function docx(buf) {
  await measureZip(await JSZip.loadAsync(buf));
  // Chỉ cần chữ: bỏ ảnh để mammoth không đổi từng ảnh thành base64 trong bộ nhớ.
  const { value } = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  return htmlToText(value);
}

// ---- XLSX / CSV: giữ tên sheet + tên cột, 200 dòng đầu + thống kê ----
function sheetToText(ws, title) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true });
  if (!rows.length) return `## Sheet: ${title}\n(trống)`;
  const head = rows[0].map((c) => String(c ?? ""));
  const body = rows.slice(1);
  const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  const shown = body.slice(0, XLSX_MAX_ROWS);
  const lines = [`## Sheet: ${title} (${body.length} dòng, ${head.length} cột)`, "| " + head.map(cell).join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |",
    ...shown.map((r) => "| " + head.map((_, i) => cell(r[i])).join(" | ") + " |")];
  if (body.length > XLSX_MAX_ROWS) lines.push(`… (đã cắt, chỉ hiện ${XLSX_MAX_ROWS}/${body.length} dòng)`);
  const stats = [];
  head.forEach((h, i) => {
    // Vòng lặp thay vì Math.min(...mảng): bảng nhiều dòng làm tràn ngăn xếp khi trải mảng thành đối số.
    let n = 0, sum = 0, min = Infinity, max = -Infinity;
    for (const r of body) { const v = r[i]; if (typeof v === "number") { n++; sum += v; if (v < min) min = v; if (v > max) max = v; } }
    if (n > body.length / 2 && n) stats.push(`- ${h || "cột " + (i + 1)}: min=${min}, max=${max}, trung bình=${+(sum / n).toFixed(2)}, tổng=${+sum.toFixed(2)}`);
  });
  if (stats.length) lines.push("\nThống kê cột số (toàn bộ dữ liệu):", ...stats);
  return lines.join("\n");
}
async function sheet(buf, kind) {
  if (kind === "xlsx") await measureZip(await JSZip.loadAsync(buf));
  const wb = kind === "csv" ? XLSX.read(decodeText(buf), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  return wb.SheetNames.map((n) => sheetToText(wb.Sheets[n], n)).join("\n\n");
}

// ---- PPTX: text theo slide + ghi chú ----
async function pptx(buf) {
  const z = await JSZip.loadAsync(buf);
  await measureZip(z);
  const num = (n) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const txt = async (f) => [...(await z.file(f).async("string")).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
    .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).filter(Boolean)
    .map((s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).join("\n");
  const slides = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b));
  const out = [];
  for (const f of slides) {
    const n = num(f), notesF = `ppt/notesSlides/notesSlide${n}.xml`;
    const notes = z.file(notesF) ? await txt(notesF) : "";
    out.push(`## Slide ${n}\n${await txt(f)}${notes ? `\n\n[Ghi chú] ${notes}` : ""}`);
  }
  return out.join("\n\n");
}

// ---- ZIP (cả thư mục tải lên ở Synchro Code cũng đi dạng .zip): danh sách tệp kèm nội dung các tệp chữ ----
const ZIP_TEXT = /\.(txt|md|markdown|mdx|log|csv|tsv|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|ps1|sql|html?|css|scss|sass|less|json|jsonl|ya?ml|toml|ini|cfg|conf|xml|svg|vue|svelte|lua|r|dart|scala|gradle|properties|env|gitignore|dockerfile|makefile)$|(^|\/)(Dockerfile|Makefile|LICENSE|README)$/i;
// Mỗi tệp chỉ cần vài chục KB đầu: không giải nén hết nên tệp 2 GB nén còn 2 MB cũng chỉ tốn 1 MB bộ nhớ. Tổng số byte giải nén có trần, hết trần thì dừng và báo đã lược bớt.
const ZIP_FILE_READ = 1048576;
async function zip(buf, name) {
  const z = await JSZip.loadAsync(buf);
  const files = Object.values(z.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store$)/.test(f.name));
  const list = files.map((f) => f.name).sort();
  const parts = [`Tệp nén ${name}: ${files.length} tệp\n${list.slice(0, 400).join("\n")}${list.length > 400 ? `\n… và ${list.length - 400} tệp khác` : ""}`];
  let chars = 400_000;
  const budget = { left: ZIP_MAX_BYTES };
  for (const f of files.filter((x) => ZIP_TEXT.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (chars <= 0 || budget.left <= 0) { parts.push("(… còn các tệp khác, đã lược bớt cho gọn)"); break; }
    let got;
    try { got = await readCapped(f, ZIP_FILE_READ, budget); }
    catch (e) { if (e instanceof ZipTooBig) { parts.push("(… còn các tệp khác, đã lược bớt cho gọn)"); break; } continue; }
    const t = decodeText(got.data);
    if (/\u0000/.test(t.slice(0, 2000))) continue;
    const part = t.slice(0, Math.min(chars, 60_000));
    chars -= part.length;
    parts.push(`--- ${f.name} ---\n${part}${got.cut || part.length < t.length ? "\n…[đã cắt]" : ""}`);
  }
  return parts.join("\n\n");
}

const [kind, name = "tệp"] = process.argv.slice(2);
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const buf = Buffer.concat(chunks);
const send = (o) => new Promise((ok) => process.stdout.write(JSON.stringify(o), () => ok()));
try {
  const text = kind === "docx" ? await docx(buf) : kind === "xlsx" || kind === "csv" ? await sheet(buf, kind) : kind === "pptx" ? await pptx(buf) : kind === "zip" ? await zip(buf, name) : null;
  if (text === null) await send({ error: "bad" });
  else await send({ text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n…[đã cắt]` : text });
} catch (e) {
  await send(e instanceof ZipTooBig ? { error: "too_big" } : { error: "bad", detail: String(e?.message ?? e).slice(0, 200) });
}
process.exit(0);
