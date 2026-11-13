// Đọc tệp văn phòng và tệp nén trong tiến trình riêng (app/fileproc/extractors.ts gọi): tệp người dùng tải lên là dữ liệu không tin được.
// - Zip bomb hay bảng tính khổng lồ chỉ làm chết tiến trình này (giới hạn bộ nhớ, thời gian ở phía gọi), không kéo sập máy chủ web đang giữ luồng trả lời của mọi người.
// - Lỗi prototype pollution của thư viện xlsx 0.18.5 mất theo tiến trình, không lọt vào máy chủ web.
// Cách gọi: node scripts/extract-worker.mjs <docx|xlsx|csv|pptx|zip> <tên tệp>; nội dung tệp vào stdin, stdout là JSON { text } hoặc { error: "too_big" | "bad" }.
import JSZip from "jszip";
import jschardet from "jschardet";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { measureZip, readCapped, ZipTooBig, ZIP_MAX_BYTES } from "./zipguard.mjs";

// Bản ESM của thư viện không xuất SSF ở tên riêng, chỉ có trong default.
const SSF = XLSX.default.SSF;
const XLSX_MAX_ROWS = 200;
// Đủ cho hàng nghìn trang; phần trên mức này model cũng không đọc hết (tệp lớn đi qua RAG), mà JSON quá lớn làm nặng máy chủ web khi nhận về.
const TEXT_MAX = 16_000_000;

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
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
const pad = (n) => String(n).padStart(2, "0");
// Từ số seri, không qua Date: Date của thư viện lệch theo múi giờ máy chủ (giờ địa phương năm 1899 có phần giây lẻ), ngày gần nửa đêm nhảy sang hôm khác.
function dateText(v, date1904) {
  const p = SSF.parse_date_code(v, { date1904 });
  if (!p) return null;
  const hasTime = p.H || p.M || p.S, clock = pad(p.H) + ":" + pad(p.M) + (p.S ? ":" + pad(p.S) : "");
  // Dưới 1 là giờ thuần (ngày 0 của năm 1900 không có thật).
  if (v < 1) return { d: v, s: clock };
  return { d: v, s: pad(p.d) + "/" + pad(p.m) + "/" + p.y + (hasTime ? " " + clock : "") };
}
// Giá trị một ô: số giữ nguyên để thống kê, ngày thành { d, s } (không vào thống kê số), còn lại là chữ. "" là ô trống.
function cellValue(c, date1904) {
  if (c.v == null || c.t === "z") return c.f ? "=" + c.f : "";
  if (c.t === "b") return c.v ? "TRUE" : "FALSE";
  if (c.t === "e") return c.w ?? "#ERROR";
  if (c.t === "n") {
    const fmt = typeof c.z === "string" ? c.z : "";
    if (fmt && SSF.is_date(fmt)) return dateText(c.v, date1904) ?? c.v;
    if (fmt.includes("%") && c.w) return c.w.trim();
    return c.v;
  }
  return String(c.v).trim();
}
// CSV đọc nguyên chữ (ngày giữ đúng như người dùng viết), số phải tự nhận: số 0 đứng đầu là mã / số điện thoại; "1,000,000" và "1.000.000" (từ hai nhóm trở lên) là số có phân cách nghìn.
function csvNum(s) {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^-?[1-9]\d{0,2}(?:\.\d{3}){2,}$/.test(s)) return Number(s.replace(/\./g, ""));
  return NaN;
}
const numOf = (v, csv) => (typeof v === "number" ? v : csv && typeof v === "string" ? csvNum(v) : NaN);
// Hàng tổng: tính vào thống kê thì tổng cột gấp đôi. "Tổng công ty ABC", "Cộng tác viên" là tên thật, không phải hàng tổng.
const TOTAL_ROW = /^(?:(?:tổng|tong)(?=[\s:.\-]|$)(?!\s+(?:công ty|cong ty|giám đốc|giam doc|cục|hợp|quan|đài|thống|đại lý|kho|vụ|liên đoàn))|(?:cộng|cong)(?=\s*[:.\-]|$|\s+(?:lại|phát sinh|tiền|tháng|quý|năm|nhóm|phòng|chung))|(?:grand\s+|sub-?)?totals?(?=[\s:.\-]|$)|sum(?=[\s:.\-]|$))/i;
// Ô =SUM(C2:C20) ngay trong cột C là ô tổng; =SUM(B2:D2) theo hàng là một giá trị thật của cột "Tổng" nên vẫn được tính.
const COL_SUM = /^\s*(?:SUM|SUBTOTAL)\((?:\d+\s*,\s*)?\$?([A-Z]+)\$?\d+:\$?([A-Z]+)\$?\d+\)\s*$/i;

function sheetRows(ws, csv, date1904) {
  const byRow = new Map(), colSum = new Set();
  // Đi theo các ô có thật, không theo !ref: tệp có thể khai A1:XFD1048576 mà chỉ vài ô có dữ liệu.
  for (const a of Object.keys(ws)) {
    if (a[0] === "!") continue;
    const v = cellValue(ws[a], date1904);
    if (v === "") continue;
    const { r, c } = XLSX.utils.decode_cell(a);
    let row = byRow.get(r);
    if (!row) byRow.set(r, (row = []));
    row[c] = v;
    const m = ws[a].f && COL_SUM.exec(ws[a].f);
    if (m && m[1].toUpperCase() === m[2].toUpperCase() && m[1].toUpperCase() === XLSX.utils.encode_col(c)) colSum.add(r + ":" + c);
  }
  // Ô chữ gộp theo chiều dọc (nhóm hàng): mọi hàng trong nhóm đều mang nhãn đó. Số gộp thì không lặp, kẻo thống kê tính nhiều lần.
  for (const m of ws["!merges"] ?? []) {
    if (m.e.r === m.s.r || m.e.r - m.s.r > 5000) continue;
    const v = byRow.get(m.s.r)?.[m.s.c];
    if (typeof v !== "string") continue;
    for (let r = m.s.r + 1; r <= m.e.r; r++) { const row = byRow.get(r); if (row && (row[m.s.c] ?? "") === "") row[m.s.c] = v; }
  }
  return { rows: [...byRow.keys()].sort((x, y) => x - y).map((r) => ({ r, cells: byRow.get(r) })), colSum };
}
// Hàng tiêu đề: báo cáo thường mở đầu bằng tên công ty, tên báo cáo, kỳ báo cáo. Lấy hàng đầu tiên trong 20 hàng đầu đủ rộng gần bằng bảng và phần lớn là chữ.
function headerIndex(rows, csv) {
  const top = rows.slice(0, 20), filled = (x) => x.cells.filter((v) => v !== undefined).length;
  const most = top.reduce((n, x) => Math.max(n, filled(x)), 0), need = Math.ceil(most * 0.8);
  return top.findIndex((x) => {
    const vals = x.cells.filter((v) => v !== undefined);
    const words = vals.filter((v) => typeof v === "string" && Number.isNaN(numOf(v, csv))).length;
    return vals.length >= need && words * 2 >= vals.length;
  });
}
function sheetToText(ws, title, csv, date1904) {
  const { rows, colSum } = sheetRows(ws, csv, date1904);
  if (!rows.length) return `## Sheet: ${title}\n(trống)`;
  const hi = headerIndex(rows, csv);
  const width = rows.reduce((n, x) => Math.max(n, x.cells.length), 0);
  // Không hàng nào giống tiêu đề (bảng toàn số): đặt tên cột tạm, không nuốt mất hàng dữ liệu đầu tiên.
  const head = hi >= 0 ? Array.from({ length: width }, (_, i) => { const v = rows[hi].cells[i]; return v === undefined ? "" : typeof v === "object" ? v.s : String(v); }) : Array.from({ length: width }, (_, i) => `cột ${i + 1}`);
  const above = hi > 0 ? rows.slice(0, hi) : [], body = rows.slice(hi + 1);
  const cell = (v) => (v === undefined ? "" : typeof v === "object" ? v.s : typeof v === "number" ? String(+v.toPrecision(15)) : String(v)).replace(/\|/g, "/").replace(/\n/g, " ");
  const shown = body.slice(0, XLSX_MAX_ROWS);
  const lines = [`## Sheet: ${title} (${body.length} dòng, ${width} cột)`];
  if (above.length) lines.push(`Phần đầu sheet, trên hàng tiêu đề: ${above.map((x) => x.cells.filter((v) => v !== undefined).map(cell).join(" ")).join(" / ")}`);
  lines.push("| " + head.map(cell).join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |", ...shown.map((x) => "| " + head.map((_, i) => cell(x.cells[i])).join(" | ") + " |"));
  if (body.length > XLSX_MAX_ROWS) lines.push(`… (đã cắt, chỉ hiện ${XLSX_MAX_ROWS}/${body.length} dòng; bản gốc đủ dòng nằm trong inputs/ khi chạy run_code)`);
  const totals = new Set(body.filter((x) => { const t = x.cells.find((v) => typeof v === "string" && Number.isNaN(numOf(v, csv))); return t !== undefined && TOTAL_ROW.test(t.normalize("NFC")); }).map((x) => x.r));
  const stats = [], spans = [];
  let cut = false;
  head.forEach((h, i) => {
    // Vòng lặp thay vì Math.min(...mảng): bảng nhiều dòng làm tràn ngăn xếp khi trải mảng thành đối số.
    let n = 0, sum = 0, min = Infinity, max = -Infinity, dn = 0, dmin = null, dmax = null;
    for (const x of body) {
      const v = x.cells[i];
      if (v === undefined) continue;
      if (typeof v === "object") { dn++; if (!dmin || v.d < dmin.d) dmin = v; if (!dmax || v.d > dmax.d) dmax = v; continue; }
      const num = numOf(v, csv);
      if (Number.isNaN(num)) continue;
      if (totals.has(x.r) || colSum.has(x.r + ":" + i)) { cut = true; continue; }
      n++; sum += num; if (num < min) min = num; if (num > max) max = num;
    }
    const name = h || "cột " + (i + 1);
    if (n > (body.length - totals.size) / 2 && n) stats.push(`- ${name}: min=${min}, max=${max}, trung bình=${+(sum / n).toFixed(2)}, tổng=${+sum.toFixed(2)}`);
    if (dn > body.length / 2 && dn) spans.push(`- ${name}: từ ${dmin.s} đến ${dmax.s}`);
  });
  if (stats.length) lines.push(`\nThống kê cột số (toàn bộ dữ liệu${cut ? ", không tính hàng tổng và ô tổng cột để khỏi tính trùng" : ""}):`, ...stats);
  if (spans.length) lines.push("\nCột ngày (dd/mm/yyyy):", ...spans);
  return lines.join("\n");
}
async function sheet(buf, kind) {
  if (kind === "xlsx") await measureZip(await JSZip.loadAsync(buf));
  // raw với CSV: thư viện tự đoán 01/02/2026 theo kiểu Mỹ thành ngày 2 tháng 1 và đổi thành số. cellNF để biết ô số nào thực ra là ngày.
  const wb = kind === "csv" ? XLSX.read(decodeText(buf), { type: "string", raw: true }) : XLSX.read(buf, { type: "buffer", cellNF: true });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  return wb.SheetNames.map((n) => sheetToText(wb.Sheets[n], n, kind === "csv", date1904)).join("\n\n");
}

// Thứ tự slide THỰC của bài trình chiếu nằm ở ppt/presentation.xml (sldIdLst → r:id → rels → tệp slide), KHÔNG theo tên tệp:
// kéo-thả đổi chỗ slide chỉ đổi thứ tự trong presentation.xml còn tên tệp giữ nguyên, nên sắp theo tên là sai thứ tự người dùng thấy.
async function slideOrder(z, num) {
  const all = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b));
  const pres = z.file("ppt/presentation.xml"), rels = z.file("ppt/_rels/presentation.xml.rels");
  if (!pres || !rels) return all;
  try {
    const relMap = new Map([...(await rels.async("string")).matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    const norm = (t) => ("ppt/" + t.replace(/^\.\.\//, "").replace(/^\/?ppt\//, "").replace(/^\//, "")).replace(/ppt\/ppt\//, "ppt/");
    const ordered = [...(await pres.async("string")).matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)]
      .map((m) => relMap.get(m[1])).filter(Boolean).map(norm).filter((f) => z.file(f));
    for (const f of all) if (!ordered.includes(f)) ordered.push(f); // slide lạ không có trong danh sách: thêm theo tên, khỏi bỏ sót
    return ordered.length ? ordered : all;
  } catch { return all; }
}

// ---- PPTX: text theo slide + ghi chú ----
async function pptx(buf) {
  const z = await JSZip.loadAsync(buf);
  await measureZip(z);
  const num = (n) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const txt = async (f) => [...(await z.file(f).async("string")).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
    .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).filter(Boolean)
    .map((s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).join("\n");
  // Biểu đồ thật không có <a:t> nên số liệu từng mất hẳn: slide hai biểu đồ chỉ còn tiêu đề, model tưởng slide không có số. Đọc giá trị đã lưu trong tệp biểu đồ của slide đó.
  const xmlDec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const points = (x) => [...x.matchAll(/<c:pt\b[^>]*idx="(\d+)"[^>]*>\s*(?:<c:formatCode>[^<]*<\/c:formatCode>\s*)?<c:v>([^<]*)<\/c:v>/g)].map((m) => [Number(m[1]), xmlDec(m[2])]);
  const chartText = async (slide) => {
    const rels = z.file(slide.replace("slides/", "slides/_rels/") + ".rels");
    if (!rels) return "";
    const parts = [...(await rels.async("string")).matchAll(/Target="\.\.\/charts\/(chart[^"\/]*\.xml)"/g)].map((m) => `ppt/charts/${m[1]}`);
    const out = [];
    for (const p of [...new Set(parts)]) {
      if (!z.file(p)) continue;
      const x = await z.file(p).async("string");
      const title = [...(/<c:title>([\s\S]*?)<\/c:title>/.exec(x)?.[1] ?? "").matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlDec(m[1])).join("");
      const lines = [];
      for (const s of x.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)) {
        const name = points(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(s[1])?.[1] ?? "")[0]?.[1] ?? "";
        const cat = new Map(points(/<c:(?:cat|xVal)>([\s\S]*?)<\/c:(?:cat|xVal)>/.exec(s[1])?.[1] ?? ""));
        const vals = points(/<c:(?:val|yVal)>([\s\S]*?)<\/c:(?:val|yVal)>/.exec(s[1])?.[1] ?? "");
        if (vals.length) lines.push(`- ${name || "Chuỗi"}: ${vals.slice(0, 200).map(([i, v]) => (cat.has(i) ? `${cat.get(i)}=${v}` : v)).join(", ")}`);
      }
      if (lines.length) out.push(`[Biểu đồ${title ? `: ${title}` : ""}]\n${lines.join("\n")}`);
    }
    return out.join("\n");
  };
  const slides = await slideOrder(z, num);
  const out = [];
  for (const f of slides) {
    const n = num(f), notesF = `ppt/notesSlides/notesSlide${n}.xml`;
    const notes = z.file(notesF) ? await txt(notesF) : "", charts = await chartText(f);
    out.push(`## Slide ${n}\n${await txt(f)}${charts ? `\n\n${charts}` : ""}${notes ? `\n\n[Ghi chú] ${notes}` : ""}`);
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
