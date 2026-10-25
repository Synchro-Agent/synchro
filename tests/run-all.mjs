// Chạy mọi bộ kiểm thử API trên Synchro giả lập (npm run dev:mock phải đang chạy ở http://localhost:3200).
// Dùng: node tests/run-all.mjs [tên bộ…]   — ví dụ: node tests/run-all.mjs runs plugins
// CI (GitHub Actions) chạy tệp này trước mỗi lần deploy; bộ nào lỗi thì không deploy.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "api");
const want = process.argv.slice(2);
const suites = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().filter((f) => !want.length || want.some((w) => f.startsWith(w)));
// Tài khoản quản trị thử nghiệm có hạn mức riêng; kiểm thử gọi model rất nhiều lần nên tạm nâng hạn mức rồi trả lại như cũ.
const R = createRequire(path.join(process.cwd(), "package.json"));
const db = new (R("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db"));
db.pragma("busy_timeout = 5000");
const adminId = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@synchro.test")?.id;
const saved = adminId ? db.prepare("SELECT override FROM usage_users WHERE user_id = ?").get(adminId) : undefined;
if (adminId) db.prepare("INSERT INTO usage_users (user_id, session_start, week_anchor, override) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET override = excluded.override")
  .run(adminId, Date.now(), Date.now(), JSON.stringify({ session: 100000, weekly: 100000 }));
const restore = () => { if (adminId && saved !== undefined) db.prepare("UPDATE usage_users SET override = ? WHERE user_id = ?").run(saved.override, adminId); else if (adminId) db.prepare("DELETE FROM usage_users WHERE user_id = ?").run(adminId); };
process.on("exit", restore);

// Đăng nhập quản trị một lần, chia phiên cho các bộ kiểm thử.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const lg = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
const adminCookie = (lg.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (!adminCookie) { console.error(`Không đăng nhập được tài khoản quản trị thử nghiệm (${lg.status}): ${(await lg.text()).slice(0, 200)}`); process.exit(1); }

const rows = [];
for (const f of suites) {
  const t = Date.now();
  console.log(`\n━━ ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 15 * 60_000, env: { ...process.env, SYNCHRO_ADMIN_COOKIE: adminCookie } });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  const m = /(\d+) đạt, (\d+) lỗi|(\d+)\/(\d+) đạt/.exec(r.stdout.split("\n").reverse().join("\n"));
  const pass = m ? Number(m[1] ?? m[3]) : 0, fail = m ? Number(m[2] ?? Number(m[4]) - Number(m[3])) : 1;
  rows.push({ f, pass, fail: r.status === 0 ? fail : Math.max(fail, 1), s: ((Date.now() - t) / 1000).toFixed(0) });
}
console.log("\n━━ Tổng kết");
for (const r of rows) console.log(`${r.fail ? "✗" : "✓"} ${r.f.padEnd(34)} ${r.pass} đạt, ${r.fail} lỗi  (${r.s}s)`);
const bad = rows.filter((r) => r.fail).length;
console.log(bad ? `\n${bad}/${rows.length} bộ có lỗi` : `\nTất cả ${rows.length} bộ đều đạt`);
process.exit(bad ? 1 : 0);
