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
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
