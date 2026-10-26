// Phần dùng chung của CLI giả lập (claude, codex, agy) cho npm run dev:mock: không gọi mạng thật, không cần tài khoản.
// dev:mock chép các tệp này vào <engine home>/.local/bin kèm mock-cli.json ({ base: địa chỉ máy chủ giả lập }).
const fs = require("fs"), path = require("path"), crypto = require("crypto"), readline = require("readline");

const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "mock-cli.json"), "utf8")); } catch { return { base: "http://127.0.0.1:4010" }; } })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const uuid = () => crypto.randomUUID();
const readStdin = () => new Promise((r) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => r(s)); });
const readLine = (prompt) => new Promise((r) => {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin });
  rl.once("line", (l) => { rl.close(); r(l.trim()); });
});
const flag = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

/** Đếm lượt trong một phiên (để kiểm tra resume nối tiếp đúng hội thoại). */
function bumpSession(dir, id) {
  const f = path.join(dir, "mock-sessions.json"), s = readJson(f, {});
  s[id] = (s[id] ?? 0) + 1;
  writeJson(f, s);
  return s[id];
}
/** Hạn mức giả lập: mỗi lượt dùng 7% phiên 5 giờ và 2% tuần. */
function bumpUsage(dir) {
  const f = path.join(dir, "mock-usage.json"), now = Date.now();
  const u = readJson(f, { n: 0, five: now + 5 * 3600e3, week: now + 7 * 86400e3 });
  if (u.five < now) { u.five = now + 5 * 3600e3; u.n = 0; }
  u.n += 1;
  writeJson(f, u);
  return { five: Math.min(1, u.n * 0.07), week: Math.min(1, u.n * 0.02), fiveReset: u.five, weekReset: u.week };
}
function reply(name, prompt, turn) {
  const last = prompt.trim().split("\n").filter(Boolean).pop() ?? "";
  return `Chào bạn! Mình là ${name} chạy qua CLI giả lập (lượt ${turn} của hội thoại). Bạn vừa nói: "${last.slice(0, 120)}".`;
}
/** Tổng số lượt đã chat (mọi phiên) trong thư mục cấu hình: dùng để giả lập phần trăm hạn mức đã dùng. */
const totalTurns = (dir) => Object.values(readJson(path.join(dir, "mock-sessions.json"), {})).reduce((x, y) => x + y, 0);
const chunks = (t, n = 12) => Array.from({ length: Math.ceil(t.length / n) }, (_, i) => t.slice(i * n, i * n + n));

module.exports = { cfg, sleep, out, uuid, readStdin, readLine, flag, bumpSession, bumpUsage, totalTurns, reply, chunks, fs, path, crypto };
