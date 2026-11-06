// Học lỗi không còn mất âm thầm: đoạn chat giữ trong hàng chờ, Bộ não biết số lượng và lý do, Học lại cho vào hàng chờ lại. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-brainfail-"));
process.env.DATA_KEY = "brain-key";
const { authstore: AS, brain: BR } = await loadTs(["authstore", "brain"]);
const u = AS.createUser({ email: "a@brain.test", name: "A", verified: true });
const n = BR.importChats(u, [{ id: "c1", title: "Kế hoạch ra mắt", msgs: [{ role: "user", text: "Lập kế hoạch ra mắt sản phẩm mới trong quý này" }, { role: "ai", text: "Đây là kế hoạch." }] }]);
ok(n === 1, "đoạn chat vào hàng chờ", n);
// Máy thử không có model nào đăng nhập nên mỗi lần học đều lỗi, giống gói hết hạn.
for (let i = 0; i < 3; i++) await BR.distillPending({ uid: u.id, now: true });
let s = BR.brainGraph(u).stats;
ok(s.failed === 1 && s.pending === 0, "lỗi đủ số lần: thôi thử, nhưng vẫn đếm là chưa học được", s);
ok(typeof s.learnError === "string" && s.learnError.length > 0, "biết lý do lần lỗi gần nhất", s.learnError);
await BR.distillPending({ uid: u.id, now: true });
ok(BR.brainGraph(u).stats.failed === 1, "lần sau không tự thử nữa, không tốn lượt của gói");
ok(BR.retryLearning(u.id) === 1 && BR.brainGraph(u).stats.pending === 1 && BR.brainGraph(u).stats.failed === 0, "Học lại: vào hàng chờ lại, không mất đoạn chat");
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
