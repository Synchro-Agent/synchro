// H4.3: lần chạy lỗi của việc tự động trong Hộp thư hiện lý do ngay trên dòng và nút "Chạy lại" trên dòng. Hàm thuần + cấu trúc giao diện, không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const { taskerr: T, chaterror: E, "i18n-dict": D } = await loadTs(["taskerr", "chaterror", "i18n-dict"]);
const en = (t) => { if (Object.prototype.hasOwnProperty.call(D.VI2EN, t)) return D.VI2EN[t]; for (const [re, f] of D.RULES_EN) { const m = t.match(re); if (m) return f(m); } return t; };

console.log("1. Lý do một dòng");
const line = (raw) => T.failLine(T.failInfo(raw).text);
ok(line("fetch failed") === "Mất kết nối tới model.", "mất mạng: câu đầu của lời giải thích, không lộ lỗi thô", line("fetch failed"));
ok(line("spawn claude ENOENT") === "Model chưa khởi động được trên máy chủ." && !/ENOENT/.test(line("spawn claude ENOENT")), "lỗi khởi động CLI", line("spawn claude ENOENT"));
ok(line("") === "Không thể kết nối tới model." && line(undefined) === line(""), "không có lý do: câu chung, không để trống", line(""));
const quota = "Gói Claude của bạn đã hết hạn mức. Hạn mức hồi lúc 14:00.";
ok(line(quota) === "Gói Claude của bạn đã hết hạn mức.", "câu của máy chủ giữ nguyên (câu đầu)", line(quota));
const long = "Lỗi " + "rất dài ".repeat(40);
ok(T.failLine(long).length <= 120 && T.failLine(long).endsWith("…"), "dài quá thì cắt, có dấu …", T.failLine(long).length);
const info = T.failInfo("TypeError: x is not a function\n    at f (a.js:1:2)");
ok(info.detail?.includes("TypeError") && !/TypeError/.test(info.text), "lỗi lập trình: câu đọc được, nguyên văn ở phần chi tiết", JSON.stringify(info));
ok(T.failInfo("Credit balance is too low", (s) => E.isForeign(s, s, "vi")).text === E.FOREIGN_ERR, "lỗi tiếng Anh của hãng trên giao diện tiếng Việt: câu chung");
for (const raw of ["fetch failed", "spawn claude ENOENT", "", "CLI killed by SIGKILL", "TypeError: x"])
  ok(!/[ăâđêôơư]/i.test(T.failLine(en(T.failInfo(raw).text))), `có bản tiếng Anh: ${raw || "(trống)"}`, en(T.failInfo(raw).text));

console.log("2. Khi nào có nút Chạy lại trên dòng");
const it = (run, task, status, at, kind = "task") => ({ run, task, status, at, kind });
const failed = it("r1", "t1", "error", 100);
ok(T.canRerun(failed, [failed], true), "lần chạy lỗi, việc còn: có nút");
ok(!T.canRerun(failed, [failed], false), "việc đã xóa: không có nút");
ok(!T.canRerun(it("r2", "t1", "done", 100), [], true) && !T.canRerun(it("r3", "t1", "running", 100), [], true), "xong / đang chạy: không có nút");
ok(!T.canRerun(it("n1", "", "error", 100, "notice"), [], true) && !T.canRerun(it("a1", "t1", "error", 100, "action"), [], true), "thông báo / việc đã duyệt: không có nút");
ok(!T.canRerun(failed, [failed, it("r4", "t1", "running", 200)], true), "đã chạy lại (lần mới hơn đang chạy): nút trên dòng cũ ẩn");
ok(!T.canRerun(failed, [failed, it("w", "t1", "waiting", 150)], true), "đang chờ Chrome để chạy lần mới: nút ẩn");
ok(T.canRerun(failed, [failed, it("r5", "t1", "done", 50), it("r6", "t2", "done", 300), it("a2", "t1", "done", 400, "action")], true), "lần cũ hơn, việc khác, việc đã duyệt không làm ẩn nút");

console.log("3. Giao diện Hộp thư");
const ui = fs.readFileSync("app/tasksui.tsx", "utf8");
const row = ui.slice(ui.indexOf('<div className="tk-line">'), ui.indexOf("{open === x.run && !bkR.on && <ResultBody"));
ok(row.length > 0 && /<span className="tk-why" data-notr>\{tr\("Lỗi"\)\}: \{failReason\(x\.error\)\}<\/span>/.test(row), "dòng lỗi hiện \"Lỗi: <lý do>\" ngay trên dòng", row.slice(0, 300));
const rowBtnEnd = row.indexOf("</button>\n");
ok(rowBtnEnd > 0 && row.indexOf("tk-rerun") > rowBtnEnd, "nút Chạy lại nằm cạnh nút của dòng, không lồng trong nút", rowBtnEnd);
ok(/canRerun\(x, all, byId\.has\(x\.task\)\)/.test(row) && /!bkR\.on && canRerun/.test(row), "nút theo canRerun, ẩn khi đang chọn hàng loạt");
ok(/disabled=\{rerun === x\.run\}/.test(row) && /const rerunRow = async/.test(ui) && /finally \{ setRerun\(null\); \}/.test(ui), "bấm rồi thì khóa nút tới khi máy chủ nhận lệnh");
ok(/className="sk-err tk-err"/.test(ui) && /tr\("Chi tiết kỹ thuật"\)/.test(ui), "mở ra: câu đọc được, lỗi thô trong \"Chi tiết kỹ thuật\"");
for (const s of ["Lỗi", "Chạy lại", "Chi tiết kỹ thuật"]) ok(Object.prototype.hasOwnProperty.call(D.VI2EN, s), `có bản tiếng Anh: ${s}`);
const css = fs.readFileSync("app/globals.css", "utf8");
ok(/\.tk-line\{display:flex/.test(css) && /\.tk-line>\.tk-row\{flex:1;min-width:0\}/.test(css), "dòng và nút cùng hàng, chữ dài không đẩy nút ra ngoài");
ok(css.includes("  .tk-row .tk-chip{display:none}\n  .tk-rerun.btn.sm>span:not(.art-spin){display:none}"), "điện thoại: nút chỉ còn biểu tượng, không chiếm chỗ của tên việc");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
