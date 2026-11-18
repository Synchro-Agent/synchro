// Tự kiểm tệp Word model tạo bằng run_code (H1 T9): tiêu đề "THƯ MỜI HỢP TÁC" nằm hai đoạn liền nhau trong thân tài liệu — đoạn đầu chữ 9 pt căn phải
// (dòng đầu trang bị đặt nhầm vào thân), đoạn sau là tiêu đề 17 pt căn giữa. Ảnh xem trước nhỏ khó thấy, đọc XML thì chắc.
// Đọc thẳng word/document.xml (không cần LibreOffice), báo đoạn lặp liền nhau và tiêu đề trùng chữ trong <docx_check> để model sửa trước khi giao.
// Chỉ báo, không sửa tệp. Tệp hỏng, không phải docx: bỏ qua im lặng. Tệp thuần ngoài JSZip: tests/api/output-selfcheck.test.mjs.
import "server-only";
import JSZip from "jszip";
import { readCapped, ZipTooBig } from "../scripts/zipguard.mjs";

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// level: cấp tiêu đề (0 Title, 1 Heading1 / Subtitle / chữ đậm ≥ 16 pt, 2… Heading2…, chữ đậm 14–15 pt là 2); không phải tiêu đề thì không có.
export type DocxPara = { text: string; heading: boolean; level?: number };
export type DocxDup = { text: string; at: number[]; kind: "liền nhau" | "tiêu đề trùng" };

/** Bỏ các bảng (kể cả bảng lồng) khỏi XML: ô bảng cạnh nhau hay lặp chữ có chủ ý (hai cột ký "(Ký, ghi rõ họ tên)"), không phải đoạn văn liền nhau.
 *  Chỗ bảng để lại một đoạn mốc nên hai đoạn trước và sau bảng không bị coi là liền nhau. */
export function stripTables(xml: string): string {
  let out = "", i = 0;
  for (;;) {
    const a = xml.indexOf("<w:tbl>", i), b = xml.indexOf("<w:tbl ", i), at = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    if (at < 0) return out + xml.slice(i);
    out += xml.slice(i, at) + "<w:p><w:r><w:t>\u2063</w:t></w:r></w:p>";
    let depth = 0, k = at;
    for (;;) {
      const o1 = xml.indexOf("<w:tbl>", k), o2 = xml.indexOf("<w:tbl ", k), open = o1 < 0 ? o2 : o2 < 0 ? o1 : Math.min(o1, o2), close = xml.indexOf("</w:tbl>", k);
      if (close < 0) return out;
      if (open >= 0 && open < close) { depth++; k = open + 7; continue; }
      depth--; k = close + 8;
      if (depth <= 0) break;
    }
    i = k;
  }
}

/** Các đoạn văn của thân tài liệu (bỏ đoạn trống), kèm dấu hiệu là tiêu đề (kiểu Title / Heading, hoặc đậm cỡ ≥ 14 pt). Đọc bằng indexOf, mỗi byte một lần. */
export function docxParas(doc: string): DocxPara[] {
  const xml = stripTables(doc), out: DocxPara[] = [];
  const body = xml.indexOf("<w:body");
  for (let i = xml.indexOf("<w:p", body < 0 ? 0 : body); i >= 0 && out.length < 4000; ) {
    const ch = xml[i + 4];
    if (ch !== ">" && ch !== " " && ch !== "/") { i = xml.indexOf("<w:p", i + 4); continue; }
    if (xml[xml.indexOf(">", i) - 1] === "/") { i = xml.indexOf("<w:p", i + 4); continue; }
    const end = xml.indexOf("</w:p>", i);
    if (end < 0) break;
    const p = xml.slice(i, end);
    let text = "";
    for (let k = p.indexOf("<w:t"); k >= 0; k = p.indexOf("<w:t", k + 4)) {
      const c = p[k + 4]; if (c !== ">" && c !== " ") continue;
      const gt = p.indexOf(">", k), close = p.indexOf("</w:t>", gt);
      if (gt < 0 || close < 0 || p[gt - 1] === "/") continue;
      text += decode(p.slice(gt + 1, close));
    }
    if (text.trim()) {
      const style = /<w:pStyle w:val="([^"]*)"/.exec(p)?.[1] ?? "";
      const sz = Math.max(0, ...[...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => +m[1])) / 2;
      const st = style.replace(/\s/g, ""), styled = /^(title|heading|tieude|tiêuđề|subtitle)/i.test(st), heading = styled || (/<w:b(?:\s|\/)/.test(p) && sz >= 14);
      const level = !heading ? undefined : /^title/i.test(st) ? 0 : /^subtitle/i.test(st) ? 1 : styled ? Math.max(1, +(/\d/.exec(st)?.[0] ?? 1)) : sz >= 16 ? 1 : 2;
      out.push({ text: text.replace(/\s+/g, " ").trim(), heading, ...(level === undefined ? {} : { level }) });
    }
    i = xml.indexOf("<w:p", end);
  }
  return out;
}

/** Đoạn lặp: hai đoạn liền nhau cùng chữ (≥ 4 chữ cái), hoặc cùng một tiêu đề lặp lại ở cùng chỗ trong dàn ý: tiêu đề cấp cao nhất (Title / Heading 1)
 *  lặp ở bất kỳ đâu, tiêu đề cấp dưới lặp dưới cùng một tiêu đề cha. "Ưu điểm / Nhược điểm" dưới "Phương án A" rồi lại dưới "Phương án B" là dàn ý
 *  bình thường, không báo (review W10). Cột ký, bảng điền tên… lặp có chủ ý nên chỉ xét đoạn ≥ 4 chữ cái. */
export function docxDuplicates(paras: DocxPara[]): DocxDup[] {
  const out: DocxDup[] = [];
  const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
  for (let i = 1; i < paras.length; i++) {
    const a = norm(paras[i - 1].text), b = norm(paras[i].text);
    if (a === b && letters(a) >= 4 && !out.some((d) => d.at.includes(i))) out.push({ text: paras[i].text, at: [i, i + 1], kind: "liền nhau" });
  }
  const seen = new Map<string, number[]>();
  // Đường dẫn tiêu đề đang mở theo cấp: tiêu đề cấp n đóng mọi cấp ≥ n.
  const path: { level: number; text: string }[] = [];
  paras.forEach((p, i) => {
    if (!p.heading) return;
    const level = p.level ?? 1;
    while (path.length && path[path.length - 1].level >= level) path.pop();
    const parent = level <= 1 ? "" : path.map((h) => h.text).join(" › ");
    path.push({ level, text: norm(p.text) });
    if (letters(p.text) < 4) return;
    const k = `${parent}\u0000${norm(p.text)}`;
    seen.set(k, [...(seen.get(k) ?? []), i + 1]);
  });
  for (const [k, at] of seen) if (at.length > 1 && !out.some((d) => norm(d.text) === k.slice(k.indexOf("\u0000") + 1))) out.push({ text: paras[at[0] - 1].text, at, kind: "tiêu đề trùng" });
  return out.slice(0, 8);
}

/** Đoạn lặp trong một tệp .docx (rỗng nếu không có, hay tệp không đọc được). */
export async function docxIssues(data: Buffer): Promise<DocxDup[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { return []; }
  const f = zip.file("word/document.xml");
  if (!f) return [];
  // Tệp do code người dùng viết: đọc tối đa 20 MB XML, dừng hẳn nếu giải nén vượt 40 MB (bom zip).
  let xml: string;
  try { xml = (await readCapped(f, 20 * 1048576, { left: 40 * 1048576 }) as { data: Buffer }).data.toString("utf8"); } catch (e) { if (e instanceof ZipTooBig) return []; throw e; }
  return docxDuplicates(docxParas(xml));
}

/** Thẻ gửi model sau run_code: đoạn / tiêu đề lặp trong các tệp Word vừa tạo. */
export async function docxNote(files: { path: string; data: Buffer }[]): Promise<string> {
  const rows: string[] = [];
  for (const f of files.filter((x) => /\.docx$/i.test(x.path) && !/(?:^|\/)_preview\//.test(x.path)).slice(0, 6)) {
    const dups = await docxIssues(f.data).catch(() => []);
    if (dups.length) rows.push(`${f.path.replace(/^outputs\//, "")}: ${dups.map((d) => `“${d.text.slice(0, 80)}” lặp ${d.kind === "liền nhau" ? "ở hai đoạn liền nhau" : "làm tiêu đề"} (đoạn ${d.at.join(" và ")})`).join("; ")}`);
  }
  return rows.length ? `\n<docx_check>\nĐoạn chữ / tiêu đề bị lặp trong tệp Word: ${rows.join(" | ")}. Thường là dòng đầu trang hay tiêu đề bị ghi hai lần vào thân tài liệu: giữ một bản (dòng chạy đầu trang thì đặt vào header của section), chạy lại rồi kiểm tra lại. Lặp có chủ ý thì nói rõ lý do với người dùng.\n</docx_check>` : "";
}
