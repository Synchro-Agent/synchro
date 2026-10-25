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
// Kiểm thử gọi model rất nhiều lần: tạm bỏ ngân sách tự đặt (Cài đặt → Usage) rồi trả lại như cũ.
const R = createRequire(path.join(process.cwd(), "package.json"));
const db = new (R("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db"));
db.pragma("busy_timeout = 5000");
db.exec("CREATE TABLE IF NOT EXISTS usage_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)");
const saved = db.prepare("SELECT json FROM usage_config WHERE id = 1").get()?.json;
const cfg = (() => { try { return JSON.parse(saved ?? "{}"); } catch { return {}; } })();
db.prepare("INSERT INTO usage_config (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify({ ...cfg, budget: { session: null, weekly: null } }));
// Khả năng (Cài đặt → Khả năng) của tài khoản thử nghiệm: bộ kiểm thử bật / tắt rồi tự trả lại, nhưng bộ bị ngắt giữa chừng thì không,
// nên trình chạy chụp lại trước và trả về như cũ khi xong (kể cả khi lỗi).
db.exec("CREATE TABLE IF NOT EXISTS user_caps (user_id TEXT PRIMARY KEY, caps TEXT NOT NULL, updated_at INTEGER NOT NULL)");
const owner = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@synchro.test")?.id;
const savedCaps = owner ? db.prepare("SELECT caps FROM user_caps WHERE user_id = ?").get(owner)?.caps : undefined;
const restore = () => {
  if (saved === undefined) db.prepare("DELETE FROM usage_config WHERE id = 1").run(); else db.prepare("UPDATE usage_config SET json = ? WHERE id = 1").run(saved);
  if (owner) { if (savedCaps === undefined) db.prepare("DELETE FROM user_caps WHERE user_id = ?").run(owner); else db.prepare("UPDATE user_caps SET caps = ? WHERE user_id = ?").run(savedCaps, owner); }
};
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

// Đăng nhập tài khoản chủ sở hữu một lần, chia phiên cho các bộ kiểm thử.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const lg = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
const adminCookie = (lg.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (!adminCookie) { console.error(`Không đăng nhập được tài khoản chủ sở hữu thử nghiệm (${lg.status}): ${(await lg.text()).slice(0, 200)}`); process.exit(1); }

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
