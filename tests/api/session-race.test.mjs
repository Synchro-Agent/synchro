// Dọn phiên Antigravity / Grok sau lượt (server/ai/cli_runtime.ts: watchSessions, cliRunning): lượt dọn của lượt khác không được xóa thư mục ảnh của lượt tạo ảnh
// đang chờ đọc. Nguyên nhân bài replicate.test "402 hết số dư" lúc đạt lúc không: lượt nền (bộ não, bộ nhớ) chạy bằng Antigravity của cùng tài khoản, hay lượt tạo ảnh
// trước đó, hoãn việc dọn tới khi không còn CLI nào chạy; đúng lúc CLI của lượt tạo ảnh mới thoát, việc dọn chạy và xóa brain/<mã>/ trước khi lượt đó kịp đọc ảnh.
// Tệp thuần, không cần máy chủ: chạy trên thư mục tạm.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-sweep-"));
process.env.SYNCHRO_ENGINE_HOME = home;
delete process.env.SYNCHRO_ENGINE_USER;
const { "ai/cli_runtime": R } = await loadTs(["ai/cli_runtime"]);
const dir = path.join(home, "logins", "agy", "u1");
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const conv = (id) => path.join(dir, ".gemini", "antigravity-cli", "brain", id);
const makeConv = (id) => { fs.mkdirSync(conv(id), { recursive: true }); fs.writeFileSync(path.join(conv(id), "anh.jpg"), "x"); };
// Tiến trình CLI giả: xong khi gọi end().
const proc = () => { let end; const done = new Promise((r) => { end = r; }); return { done, end: () => end({ code: 0 }) }; };
fs.mkdirSync(dir, { recursive: true });
makeConv(uuid(1)); // phiên cũ của đoạn chat, có trước mọi lượt

console.log("1. Lượt nền và lượt tạo ảnh trước còn chờ dọn: không xóa ảnh của lượt tạo ảnh đang đọc");
// Lượt nền (bộ não) chạy Antigravity của cùng tài khoản.
const bg = await R.watchSessions(dir), pBg = proc();
R.cliRunning(dir, pBg);
makeConv(uuid(2)); // phiên của lượt nền (không báo mã)
// Lượt tạo ảnh A xong trong lúc lượt nền còn chạy: tự xóa phiên của mình, việc dọn phải hoãn.
const a = await R.watchSessions(dir), pA = proc();
R.cliRunning(dir, pA);
makeConv(uuid(3));
pA.end(); await sleep(20);
await R.removeSessionFiles(dir, uuid(3));
await a.sweep();
// Lượt tạo ảnh B (Replicate báo 402, về Antigravity) bắt đầu, CLI ghi ảnh vào brain/<mã B>.
const b = await R.watchSessions(dir), pB = proc();
R.cliRunning(dir, pB);
makeConv(uuid(4));
pBg.end(); await sleep(20);
void bg.sweep();
// CLI của B thoát: B mới bắt đầu đọc ảnh.
pB.end();
await sleep(400);
ok(fs.existsSync(path.join(conv(uuid(4)), "anh.jpg")), "ảnh của lượt B còn nguyên sau khi CLI thoát, tới lúc B đọc xong");
// B đọc xong, tự xóa phiên, rồi dọn.
await R.removeSessionFiles(dir, uuid(4));
await b.sweep();
await sleep(400);
ok(!fs.existsSync(conv(uuid(2))), "phiên không ai nhận của lượt nền vẫn được dọn khi mọi lượt đã xong");
ok(fs.existsSync(path.join(conv(uuid(1)), "anh.jpg")), "phiên có từ trước không bị đụng tới");

console.log("2. Không kẹt: hai lượt cùng gọi dọn khi lượt kia chưa xong");
const c = await R.watchSessions(dir), d = await R.watchSessions(dir);
makeConv(uuid(5));
await c.sweep(); // d còn chạy: c hoãn
ok(fs.existsSync(conv(uuid(5))), "lượt khác còn chạy: chưa dọn");
await d.sweep(); // d xong: cả hai chạy
await sleep(400);
ok(!fs.existsSync(conv(uuid(5))), "lượt cuối xong: việc dọn đã hoãn chạy");
await d.sweep(); // gọi lại không làm lệch bộ đếm
const e = await R.watchSessions(dir);
makeConv(uuid(6));
await e.sweep();
await sleep(300);
ok(!fs.existsSync(conv(uuid(6))), "gọi sweep hai lần không làm các lượt sau chờ mãi");

console.log("3. Phiên lượt chat báo về được giữ");
const f = await R.watchSessions(dir), pChat = proc();
R.cliRunning(dir, pChat);
makeConv(uuid(7));
R.sessionSeen(dir, uuid(7));
pChat.end(); await sleep(20);
await f.sweep();
await sleep(300);
ok(fs.existsSync(conv(uuid(7))), "mã lượt chat báo về (sessionSeen): không xóa");

fs.rmSync(home, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
