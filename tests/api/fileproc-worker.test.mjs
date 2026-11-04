// Tiến trình đọc tệp: zip bomb, bảng tính rất dài, tệp hỏng không làm sập gì và báo lỗi rõ. Không cần máy chủ (gọi thẳng scripts/extract-worker.mjs với giới hạn bộ nhớ như lúc chạy thật).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
const R = createRequire(path.join(process.cwd(), "package.json"));
const JSZip = R("jszip"), XLSX = R("xlsx");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const worker = path.join(process.cwd(), "scripts", "extract-worker.mjs");
const parse = (kind, buf, name = "t", heap = 1024) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [`--max-old-space-size=${heap}`, worker, kind, name], { input: buf, maxBuffer: 256 * 1048576, timeout: 120_000 });
  let j = null; try { j = JSON.parse(r.stdout.toString("utf8")); } catch {}
  return { j, code: r.status, ms: Date.now() - t, err: r.stderr?.toString().slice(0, 300) };
};
const zipOf = async (files) => { const z = new JSZip(); for (const [n, d] of Object.entries(files)) z.file(n, d); return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }); };
const zeros = (mb) => Buffer.alloc(mb * 1048576);

console.log("1. Zip bomb");
const bomb = await zipOf({ "a.txt": zeros(600), "b.txt": zeros(600) });
ok(bomb.length < 4 * 1048576, "tệp thử nén nhỏ", bomb.length);
let r = parse("zip", bomb, "bomb.zip", 256);
ok(r.j?.text?.includes("Tệp nén bomb.zip: 2 tệp"), "zip thường: vẫn liệt kê tên tệp, không giải nén hết", JSON.stringify(r).slice(0, 300));
const docxBomb = await zipOf({ "word/document.xml": zeros(600), "[Content_Types].xml": "<x/>" });
r = parse("docx", docxBomb, "bomb.docx", 256);
ok(r.j?.error === "too_big", "docx bomb bị từ chối, tiến trình không chết", JSON.stringify(r).slice(0, 300));
const pptxBomb = await zipOf({ "ppt/presentation.xml": "<x/>", "ppt/slides/slide1.xml": zeros(600) });
r = parse("pptx", pptxBomb, "bomb.pptx", 256);
ok(r.j?.error === "too_big", "pptx bomb bị từ chối", JSON.stringify(r).slice(0, 300));
const xlsxBomb = await zipOf({ "xl/workbook.xml": zeros(600) });
r = parse("xlsx", xlsxBomb, "bomb.xlsx", 256);
ok(r.j?.error === "too_big", "xlsx bomb bị từ chối", JSON.stringify(r).slice(0, 300));
// Kích thước khai trong zip là giả: danh mục nói vài byte nhưng dữ liệu thật rất lớn.
const liar = Buffer.from(docxBomb);
for (let i = liar.length - 22; i > 0; i--) { if (liar.readUInt32LE(i) === 0x02014b50) { liar.writeUInt32LE(10, i + 24); } if (liar.readUInt32LE(i) === 0x04034b50) { liar.writeUInt32LE(10, i + 22); } }
r = parse("docx", liar, "liar.docx", 256);
ok(r.j?.error === "too_big" || r.j?.error === "bad", "khai kích thước giả vẫn bị chặn khi giải nén", JSON.stringify(r).slice(0, 300));

console.log("2. Bảng tính rất dài");
const rows = [["ten", "so"]]; for (let i = 0; i < 200_000; i++) rows.push([`dong ${i}`, i]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
r = parse("xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "lon.xlsx");
ok(r.j?.text?.includes("min=0, max=199999"), "200.000 dòng đọc được, có thống kê (không tràn ngăn xếp)", JSON.stringify(r).slice(0, 300));
ok(r.j?.text?.includes("đã cắt, chỉ hiện 200/200000"), "chỉ đưa 200 dòng đầu vào nội dung");

console.log("3. Tệp bình thường và tệp hỏng");
const small = await zipOf({ "src/a.js": "console.log(1)", "README": "xin chào", "x.bin": Buffer.from([0, 1, 2]) });
r = parse("zip", small, "ok.zip");
ok(r.j?.text?.includes("--- src/a.js ---") && r.j.text.includes("xin chào"), "zip thường có nội dung tệp chữ", JSON.stringify(r).slice(0, 300));
r = parse("csv", Buffer.from("a,b\n1,2\n3,4\n"), "t.csv");
ok(r.j?.text?.includes("## Sheet:") && r.j.text.includes("| 1 | 2 |"), "CSV đọc được", JSON.stringify(r).slice(0, 300));
r = parse("docx", Buffer.from("PK\x03\x04 không phải zip"), "hong.docx");
ok(r.j?.error === "bad", "tệp hỏng báo lỗi, không ném ra ngoài", JSON.stringify(r).slice(0, 300));

console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
