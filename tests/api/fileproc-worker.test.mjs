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

console.log("4. Bảng tính thật: hàng tiêu đề, ngày, hàng tổng");
const bookOf = (sheets) => { const b = XLSX.utils.book_new(); for (const [n, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(b, ws, n); return XLSX.write(b, { type: "buffer", bookType: "xlsx" }); };
const dt = (v) => ({ t: "n", v, z: "dd/mm/yyyy" });
const report = XLSX.utils.aoa_to_sheet([["CÔNG TY ABC"], ["BÁO CÁO DOANH THU THÁNG 10"], ["Ngày", "Khách", "Nhóm", "SL", "Đơn giá", "Thành tiền", "Ghi chú"],
  [dt(46308), "An", "A", 2, 100, 200, "đầu kỳ"], [dt(46309), "Bình", "", 3, 100, 300, ""], [dt(46310), "Chi", "B", 1, 500, 500, ""], ["Tổng cộng", "", "", 6, "", { t: "n", v: 1000, f: "SUM(F4:F6)" }, ""]]);
report["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 3, c: 2 }, e: { r: 4, c: 2 } }];
r = parse("xlsx", bookOf({ "Doanh thu": report }), "bc.xlsx");
let t = r.j?.text ?? "";
ok(t.includes("(4 dòng, 7 cột)") && t.includes("| Ngày | Khách | Nhóm | SL | Đơn giá | Thành tiền | Ghi chú |"), "hàng tiêu đề là hàng đủ cột, không phải hàng tên công ty", t.slice(0, 400));
ok(t.includes("CÔNG TY ABC") && t.includes("BÁO CÁO DOANH THU"), "tên công ty, tên báo cáo vẫn tới model", t.slice(0, 300));
ok(t.includes("| 13/10/2026 | An | A | 2 | 100 | 200 | đầu kỳ |"), "ngày ra dd/mm/yyyy, không phải số seri", t);
ok(!/46308/.test(t), "không còn số seri ở đâu", t);
ok(t.includes("| 14/10/2026 | Bình | A |"), "ô gộp dọc: hàng dưới cũng mang nhãn nhóm", t);
ok(t.includes("Thành tiền: min=200, max=500, trung bình=333.33, tổng=1000"), "hàng Tổng cộng không bị tính vào thống kê", t);
ok(t.includes("không tính hàng tổng"), "có nói rõ đã bỏ hàng tổng", t);
ok(t.includes("Ngày: từ 13/10/2026 đến 15/10/2026") && !/- Ngày: min=/.test(t), "cột ngày có khoảng ngày, không có min/max số", t);

const named = XLSX.utils.aoa_to_sheet([["Đơn vị", "Lương"], ["Tổng công ty Điện lực", 100], ["Cộng tác viên", 50], ["Khối A", 70]]);
t = parse("xlsx", bookOf({ L: named }), "n.xlsx").j?.text ?? "";
ok(t.includes("tổng=220"), "\"Tổng công ty\", \"Cộng tác viên\" không bị coi là hàng tổng", t);
const rowSum = XLSX.utils.aoa_to_sheet([["Tên", "T1", "T2", "Cả năm"], ["An", 1, 2, { t: "n", v: 3, f: "SUM(B2:C2)" }], ["Bình", 3, 4, { t: "n", v: 7, f: "SUM(B3:C3)" }]]);
t = parse("xlsx", bookOf({ S: rowSum }), "r.xlsx").j?.text ?? "";
ok(t.includes("Cả năm: min=3, max=7, trung bình=5, tổng=10"), "cột tổng theo hàng (=SUM cả hàng) vẫn là dữ liệu", t);
const numbers = XLSX.utils.aoa_to_sheet([[1, 2], [3, 4]]);
t = parse("xlsx", bookOf({ N: numbers }), "n.xlsx").j?.text ?? "";
ok(t.includes("(2 dòng, 2 cột)") && t.includes("| 1 | 2 |") && t.includes("| cột 1 | cột 2 |"), "bảng toàn số: không nuốt hàng đầu làm tiêu đề", t);
const wide = XLSX.utils.aoa_to_sheet([["Tên", "Tuổi"], ["An", 30, "thừa"]]);
t = parse("xlsx", bookOf({ W: wide }), "w.xlsx").j?.text ?? "";
ok(t.includes("thừa"), "hàng dài hơn tiêu đề không mất ô", t);
// Tệp khai vùng khổng lồ: sửa thẳng trong XML vì thư viện sẽ đi qua cả vùng nếu ghi bằng nó.
const hz = await JSZip.loadAsync(bookOf({ H: XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]) }));
const hp = "xl/worksheets/sheet1.xml";
hz.file(hp, (await hz.file(hp).async("string")).replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:XFD1048576"'));
r = parse("xlsx", await hz.generateAsync({ type: "nodebuffer" }), "h.xlsx", 256);
ok(r.j?.text?.includes("| a | b |"), "khai !ref khổng lồ không làm chậm hay chết tiến trình", JSON.stringify(r).slice(0, 200));
r = parse("csv", Buffer.from("Ngày,Khách,Tiền,Mã\n01/02/2026,An,1000,0123\n02/03/2026,Bình,2000,0456\nTổng,,3000,\n"), "c.csv");
t = r.j?.text ?? "";
ok(t.includes("| 01/02/2026 | An | 1000 | 0123 |"), "CSV: ngày giữ đúng như đã viết, mã số giữ số 0 đầu", t);
ok(t.includes("Tiền: min=1000, max=2000") && t.includes("tổng=3000") && !/Ngày: min/.test(t) && !/Mã: min/.test(t), "CSV: chỉ cột tiền vào thống kê, bỏ hàng Tổng", t);
const ho = XLSX.utils.aoa_to_sheet([["Ngày"], [{ t: "n", v: 46308.5, z: "dd/mm/yyyy hh:mm" }], [{ t: "n", v: 46309, z: "m/d/yy" }], [{ t: "n", v: 0.25, z: "h:mm" }], [{ t: "n", v: 0.125, z: "0.0%" }]]);
t = parse("xlsx", bookOf({ T: ho }), "t.xlsx").j?.text ?? "";
ok(t.includes("13/10/2026 12:00") && t.includes("14/10/2026") && t.includes("| 06:00 |") && t.includes("12.5%"), "giờ, định dạng ngày kiểu Mỹ, phần trăm đều ra đúng", t);
const tz = spawnSync(process.execPath, [worker, "xlsx", "t.xlsx"], { input: bookOf({ T: XLSX.utils.aoa_to_sheet([["Ngày", "x"], [dt(46308), 1]]) }), env: { ...process.env, TZ: "Asia/Ho_Chi_Minh" } });
ok(tz.stdout.toString().includes("13/10/2026"), "không lệch ngày theo múi giờ máy chủ", tz.stdout.toString().slice(0, 200));

console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
