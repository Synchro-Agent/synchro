// Gọi lại từ bộ não: chỉ mục theo từng người phải luôn khớp dữ liệu (thêm, sửa, xóa, đoạn chat đang mở) và không tách từ lại ghi chú không đổi. Hàm thuần, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-recall-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "recall-test";
const { brain: B, authstore: AU } = await loadTs(["brain", "authstore"]);
const mk = (n) => AU.createUser({ email: `recall${n}${Date.now()}@synchro.test`, name: "R", verified: true });
const u = mk(1);
B.brainReady?.(u);
const hit = (q, conv) => B.brainRecall(u.id, q, conv);

B.saveNote(u, "Trà sữa Sapa", { body: "Quán trà sữa ở Sapa bán nhiều hương vị hoa đào." });
for (let i = 0; i < 12; i++) B.saveNote(u, `Ghi chú ${i}`, { body: `Nội dung thường ngày số ${i} về công việc văn phòng.` });
ok(/Trà sữa Sapa/.test(hit("hoa đào ở Sapa")), "tìm thấy ghi chú liên quan");
ok(!hit("xyzzy không có đâu"), "không liên quan: không gọi lại");
await sleep(5);
B.saveNote(u, "Trà sữa Sapa", { body: "Quán đã đổi món: giờ bán bánh chuối nướng." });
ok(/Trà sữa Sapa/.test(hit("bánh chuối nướng")), "sửa ghi chú: từ mới tìm thấy ngay");
ok(!/Trà sữa Sapa/.test(hit("hoa đào")), "sửa ghi chú: từ cũ không còn");
await sleep(5);
B.deleteNote(u, "Trà sữa Sapa");
ok(!/Trà sữa Sapa/.test(hit("bánh chuối nướng")), "xóa ghi chú: không gọi lại nữa");
const other = mk(2);
B.saveNote(other, "Bí mật", { body: "Mật khẩu kho hàng rồng lửa." });
for (let i = 0; i < 12; i++) B.saveNote(other, `Việc ${i}`, { body: `Chuyện thường ngày số ${i} của văn phòng.` });
ok(!hit("rồng lửa") && /Bí mật/.test(B.brainRecall(other.id, "rồng lửa")), "mỗi người một chỉ mục");

// Nhiều ghi chú: lần đầu dựng ở nền, không chặn; các lần sau rất nhanh.
const big = mk(3);
const filler = "nội dung ghi chú rất dài về nhiều chuyện khác nhau trong cuộc sống hằng ngày ".repeat(20);
for (let i = 0; i < 700; i++) B.saveNote(big, `Trang ${i}`, { body: `${filler} ${i === 350 ? "kỳ lân xanh" : ""}` });
B.warmRecall(big.id);
for (let i = 0; i < 400 && !/Trang 350/.test(B.brainRecall(big.id, "kỳ lân xanh")); i++) await sleep(20);
ok(/Trang 350/.test(B.brainRecall(big.id, "kỳ lân xanh")), "dựng xong ở nền: tìm thấy");
const t0 = performance.now();
for (let i = 0; i < 20; i++) B.brainRecall(big.id, "kỳ lân xanh");
const each = (performance.now() - t0) / 20;
ok(each < 30, `không tách từ lại mỗi lượt: ${each.toFixed(1)} ms mỗi lần với 700 ghi chú`, each);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
