// Thao tác tệp của dịch vụ workspace chạy bằng root: code trong sandbox đổi tệp / thư mục thành liên kết không được dẫn root ra ngoài.
// Tự chạy, không cần máy chủ: dựng đúng các đòn tấn công bằng liên kết thật trên đĩa. Hàm dùng thật ở workspace/agent.mjs (runOnce).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectOutputs, createRunQueue, safeRead, safeWrite } from "../../workspace/safefs.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const T = fs.mkdtempSync(path.join(os.tmpdir(), "safefs-"));
const fresh = (n) => { const d = path.join(T, n); fs.mkdirSync(d, { recursive: true }); return d; };

console.log("1. Ghi tệp vào thư mục giữ lại (đòn: ln -sf /etc/cron.d/x main.sh rồi chạy lần 2)");
{
  const dir = fresh("w1"), victim = path.join(T, "victim-w1");
  fs.writeFileSync(victim, "của root");
  fs.symlinkSync(victim, path.join(dir, "main.sh"));
  safeWrite(dir, "main.sh", Buffer.from("echo hi"));
  ok(fs.readFileSync(victim, "utf8") === "của root", "không ghi xuyên liên kết ở thành phần cuối");
  ok(!fs.lstatSync(path.join(dir, "main.sh")).isSymbolicLink() && fs.readFileSync(path.join(dir, "main.sh"), "utf8") === "echo hi", "tệp mới thay chỗ liên kết");

  // liên kết treo: writeFileSync thường sẽ tạo tệp mới ở đích (tạo được cron job mới)
  const newTarget = path.join(T, "created-by-attacker");
  fs.symlinkSync(newTarget, path.join(dir, "a.py"));
  safeWrite(dir, "a.py", Buffer.from("x"));
  ok(!fs.existsSync(newTarget), "không tạo tệp mới ở đích của liên kết treo");

  // thư mục trung gian là liên kết
  const outside = fresh("outside-w1");
  fs.symlinkSync(outside, path.join(dir, "skill"));
  safeWrite(dir, "skill/sub/run.py", Buffer.from("x"));
  ok(!fs.existsSync(path.join(outside, "sub")), "không tạo thư mục / tệp xuyên thư mục trung gian là liên kết");
  ok(fs.lstatSync(path.join(dir, "skill")).isDirectory() && fs.existsSync(path.join(dir, "skill/sub/run.py")), "thư mục trung gian thành thư mục thật");

  // FIFO: mở để ghi sẽ treo; thư mục trùng tên
  fs.mkdirSync(path.join(dir, "d.py"));
  fs.writeFileSync(path.join(dir, "d.py", "x"), "1");
  safeWrite(dir, "d.py", Buffer.from("y"));
  ok(fs.statSync(path.join(dir, "d.py")).isFile(), "thư mục trùng tên được thay bằng tệp");
  let threw = false;
  try { safeWrite(dir, "../escape", Buffer.from("x")); } catch { threw = true; }
  ok(threw && !fs.existsSync(path.join(T, "escape")), "từ chối đường dẫn có ..");
}

console.log("2. Đọc outputs/ (đòn: rm -rf outputs; ln -s /var/www/synchro outputs)");
{
  const secret = fresh("secret-r1");
  fs.writeFileSync(path.join(secret, ".env.production"), "DATA_KEY=bi-mat");
  const dir = fresh("r1");
  fs.symlinkSync(secret, path.join(dir, "outputs"));
  let r = collectOutputs(path.join(dir, "outputs"));
  ok(r.files.length === 0 && r.skipped.length === 1, "outputs là liên kết: không đọc gì", JSON.stringify(r));

  const dir2 = fresh("r2"), out = path.join(dir2, "outputs");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "that.txt"), "ok");
  fs.symlinkSync(path.join(secret, ".env.production"), path.join(out, "leak.txt"));
  fs.symlinkSync(secret, path.join(out, "sub"));
  r = collectOutputs(out);
  const names = r.files.map((f) => f.path);
  ok(names.length === 1 && names[0] === "that.txt", "chỉ gửi tệp thật, liên kết bị bỏ", JSON.stringify(names));
  ok(!JSON.stringify(r.files).includes(Buffer.from("DATA_KEY=bi-mat").toString("base64")), "nội dung tệp bí mật không ra ngoài");
  ok(safeRead(path.join(out, "leak.txt")) === null, "safeRead không đi theo liên kết");
  ok(safeRead(path.join(out, "that.txt"), 1) === null, "safeRead tôn trọng giới hạn kích thước");
}

console.log("3. Khung hình xem thử không đẩy tệp thật ra khỏi danh sách");
{
  const out = path.join(fresh("r3"), "outputs");
  fs.mkdirSync(path.join(out, "_preview"), { recursive: true });
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(out, "_preview", `f${String(i).padStart(2, "0")}.jpg`), "x");
  fs.writeFileSync(path.join(out, "video.mp4"), "mp4");
  const r = collectOutputs(out, { files: 20, previews: 8 });
  ok(r.files.some((f) => f.path === "video.mp4"), "video.mp4 vẫn được gửi dù có 30 khung xem thử", JSON.stringify(r.files.map((f) => f.path)));
  ok(r.files.filter((f) => f.path.startsWith("_preview")).length === 8, "khung xem thử có hạn mức riêng");
  const tiny = collectOutputs(out, { files: 20, previews: 8, totalBytes: 4 });
  ok(tiny.files[0]?.path === "video.mp4", "ngân sách dung lượng dành cho tệp thật trước");
}

console.log("4. Hàng đợi chạy code");
{
  const q = createRunQueue({ max: 3, queue: 3, perUser: 2, waitMs: 300 });
  const a = await q.acquire("a", 600), b = await q.acquire("a", 600);
  let got = "";
  const longWait = q.acquire("b", 600).then((f) => { got = "b-long"; return f; });
  await new Promise((r) => setTimeout(r, 10));
  ok(!got, "chạy dài không chiếm chỗ dành cho chạy ngắn");
  const s = await q.acquire("c", 30);
  ok(q.running === 3, "chạy ngắn vẫn vào được chỗ dành riêng");
  s(); a();
  const f = await longWait;
  ok(got === "b-long", "chỗ trống được cấp cho người đang chờ");
  f(); b();

  const q2 = createRunQueue({ max: 1, queue: 5, perUser: 5, waitMs: 2000 });
  const r0 = await q2.acquire("x", 30);
  const order = [];
  const x2 = q2.acquire("x", 30).then((f) => { order.push("x"); return f; });
  await new Promise((r) => setTimeout(r, 5));
  const y1 = q2.acquire("y", 30).then((f) => { order.push("y"); return f; });
  await new Promise((r) => setTimeout(r, 5));
  r0();
  const fx = await x2; fx();
  const fy = await y1; fy();
  ok(order.join() === "x,y", "cùng mức thì ai đến trước được trước", order.join());

  const q3 = createRunQueue({ max: 1, queue: 5, perUser: 5, waitMs: 2000 });
  const h1 = await q3.acquire("x", 30);
  const h2p = q3.acquire("x", 30);
  const h3p = q3.acquire("y", 30);
  let first = "";
  h2p.then(() => { first ||= "x"; }); h3p.then(() => { first ||= "y"; });
  await new Promise((r) => setTimeout(r, 5));
  const held = createRunQueue({ max: 2, queue: 5, perUser: 5, waitMs: 2000 });
  const u1 = await held.acquire("busy", 30), u2 = await held.acquire("idle", 30);
  const later = held.acquire("busy", 30).then((f) => ["busy", f]);
  await new Promise((r) => setTimeout(r, 5));
  const earlierIdle = held.acquire("idle", 30).then((f) => ["idle", f]);
  await new Promise((r) => setTimeout(r, 5));
  u2(); // "busy" đang chạy 1, "idle" đang chạy 0: idle được trước dù đến sau
  const winner = await Promise.race([later, earlierIdle]);
  ok(winner[0] === "idle", "công bằng: người đang chạy ít nhất được chọn trước", winner[0]);
  winner[1](); u1();
  h1(); await h2p.then((f) => f()); await h3p.then((f) => f());

  const q4 = createRunQueue({ max: 1, queue: 1, perUser: 1, waitMs: 40 });
  const hold = await q4.acquire("x", 30);
  const w = q4.acquire("y", 30).catch((e) => e.message);
  const full = await q4.acquire("z", 30).catch((e) => e.message);
  ok(/nhiều code/.test(full), "hàng đầy thì báo bận, không chờ vô hạn", full);
  ok(/nhiều code/.test(await w), "chờ quá giới hạn thì báo bận");
  hold();

  const q5 = createRunQueue({ max: 1, waitMs: 5000 });
  const hold5 = await q5.acquire("x", 30);
  const ac = new AbortController();
  const gone = q5.acquire("y", 30, ac.signal).catch((e) => e.message);
  ac.abort();
  ok(/Đã dừng/.test(await gone) && q5.queued === 0, "người gọi bỏ đi thì rời hàng");
  const drained = q5.acquire("y", 30).catch((e) => e.message);
  q5.close("đang cập nhật");
  ok((await drained) === "đang cập nhật", "dịch vụ sắp tắt: trả lỗi cho người đang chờ");
  ok((await q5.acquire("z", 30).catch((e) => e.message)) === "đang cập nhật", "dịch vụ sắp tắt: từ chối lần chạy mới");
  hold5();
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
