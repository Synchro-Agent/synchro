// Chốt ô tổng phải là công thức (app/xlsxcheck.ts): tệp Excel dựng bằng SheetJS như tệp model tạo bằng openpyxl. Không cần máy chủ.
import { createRequire } from "node:module";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const XLSX = createRequire(path.join(process.cwd(), "package.json"))("xlsx");
const { xlsxcheck: C } = await loadTs(["xlsxcheck"]);

const book = (rows, name = "Mô hình") => {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (typeof v === "string" && v.startsWith("=") ? { t: "n", v: 0, f: v.slice(1) } : v))));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
};
console.log("1. Ô tổng ghi cứng bị báo, công thức thì không");
const good = book([
  ["", "Chỉ tiêu", "Quý 1", "Quý 2", "Cả năm (Total)"],
  ["", "Doanh thu", 100, 120, "=SUM(C2:D2)"],
  ["", "Chi phí", 60, 70, "=SUM(C3:D3)"],
  ["", "TỔNG CỘNG (TOTAL)", "=SUM(C2:C3)", "=SUM(D2:D3)", "=SUM(E2:E3)"],
  ["", "Tăng trưởng", "", "=(D2-C2)/C2", ""],
]);
ok((await C.hardTotals(good)).length === 0, "mô hình đúng chuẩn: không báo gì", JSON.stringify(await C.hardTotals(good)));
const bad = book([
  ["", "Chỉ tiêu", "Quý 1", "Quý 2", "Cả năm (Total)"],
  ["", "Doanh thu", 100, 120, 220],
  ["", "Chi phí", 60, 70, "=SUM(C3:D3)"],
  ["", "Tổng cộng", 160, "=SUM(D2:D3)", 350],
  ["", "Công ty mẹ", 5, 6, "=SUM(C5:D5)"],
  ["", "Tổng quan thị trường", 7, 8, "=SUM(C6:D6)"],
], "Kế hoạch");
const got = await C.hardTotals(bad);
const refs = got.map((g) => g.ref).sort();
ok(JSON.stringify(refs) === JSON.stringify(["C4", "E2", "E4"]), "báo đúng E2 (cột Total), C4 và E4 (hàng Tổng cộng), không báo ô có công thức", JSON.stringify(got));
ok(got.every((g) => g.sheet === "Kế hoạch") && got.find((g) => g.ref === "C4").value === 160, "kèm tên sheet và giá trị ghi cứng");
ok(!refs.includes("C5") && !refs.includes("C6"), "\"Công ty…\", \"Tổng quan…\" không phải hàng tổng");
const note = await C.totalsNote([{ path: "outputs/ke-hoach.xlsx", data: bad }, { path: "outputs/_preview/x.xlsx", data: bad }, { path: "outputs/a.txt", data: Buffer.from("x") }]);
ok(note.includes("<excel_totals>") && note.includes("ke-hoach.xlsx: Kế hoạch!") && !note.includes("_preview") && /=SUM/.test(note), "thẻ gửi model: tệp, ô, cách sửa; bỏ tệp xem trước", note);
ok((await C.totalsNote([{ path: "outputs/ok.xlsx", data: good }])) === "", "tệp đúng: không có thẻ");
ok((await C.hardTotals(Buffer.from("không phải zip"))).length === 0, "tệp hỏng: bỏ qua im lặng");
const en = book([["Item", "Q1", "Q2"], ["Revenue", 1, 2], ["Subtotal", 3, "=SUM(C2:C2)"], ["Net margin", 0.2, 0.3]]);
ok(JSON.stringify((await C.hardTotals(en)).map((g) => g.ref)) === JSON.stringify(["B3", "B4", "C4"]), "nhãn tiếng Anh: Subtotal, Net margin", JSON.stringify(await C.hardTotals(en)));

console.log("2. Tệp do code người dùng viết: không chặn tiến trình chung, không nở bộ nhớ");
const JSZip = createRequire(path.join(process.cwd(), "package.json"))("jszip");
const swap = async (parts) => { const z = await JSZip.loadAsync(bad); for (const [k, v] of Object.entries(parts)) z.file(k, v); return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }); };
const timed = async (buf) => { const t = performance.now(); const r = await C.hardTotals(buf); return { r, ms: performance.now() - t }; };
// 2 MB "<c r="A1">" không có </c>: regex lười cũ tốn hàng chục giây (bậc hai) trong tiến trình phục vụ mọi người dùng.
let t = await timed(await swap({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${'<c r="A1">'.repeat(200_000)}</row></sheetData></worksheet>` }));
ok(t.ms < 1500 && Array.isArray(t.r), `sheet 2 MB toàn <c> không đóng: xong sau ${Math.round(t.ms)} ms`);
t = await timed(await swap({ "xl/sharedStrings.xml": `<sst>${"<si><t>".repeat(300_000)}</sst>` }));
ok(t.ms < 1500, `sharedStrings 2 MB toàn <si> không đóng: xong sau ${Math.round(t.ms)} ms`);
t = await timed(await swap({ "xl/_rels/workbook.xml.rels": `<Relationships>${'<Relationship Id="rId1" '.repeat(100_000)}` }));
ok(t.ms < 1500, `workbook.xml.rels toàn thẻ không đóng: xong sau ${Math.round(t.ms)} ms`);
// Ô rất nhiều <v> không đóng bên trong một ô.
t = await timed(await swap({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1">${"<v>".repeat(500_000)}</c></row></sheetData></worksheet>` }));
ok(t.ms < 1500, `một ô chứa 1.5 MB <v> không đóng: xong sau ${Math.round(t.ms)} ms`);
// Zip bomb: 200 MB chữ lặp nén còn vài trăm KB. Dừng ở trần 8 MB mỗi phần, không đọc cả 200 MB vào bộ nhớ.
const bomb = await swap({ "xl/worksheets/sheet1.xml": Buffer.alloc(200 * 1048576, 0x20) });
const heap0 = process.memoryUsage().rss;
t = await timed(bomb);
ok(bomb.length < 1048576 && t.r.length === 0 && t.ms < 3000, `zip bomb ${Math.round(bomb.length / 1024)} KB → 200 MB: bỏ qua sau ${Math.round(t.ms)} ms`);
ok(process.memoryUsage().rss - heap0 < 120 * 1048576, `bộ nhớ tăng ${Math.round((process.memoryUsage().rss - heap0) / 1048576)} MB (dưới 120 MB)`);
// Sheet hợp lệ cỡ vừa (20.000 ô) vẫn được kiểm và vẫn báo đúng ô.
const rows = [["Chỉ tiêu", "Giá trị"], ...Array.from({ length: 10_000 }, (_, i) => [`Dòng ${i}`, i]), ["Tổng cộng", 123]];
const big = book(rows);
t = await timed(big);
ok(t.r.length === 1 && t.r[0].ref === "B10002" && t.ms < 1500, `sheet 20.000 ô: báo đúng B10002 sau ${Math.round(t.ms)} ms`, JSON.stringify(t.r));
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
