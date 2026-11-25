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
// Mức dùng cũ của các tài khoản thử (chỉ dữ liệu giả lập data-mock): chạy nhiều lượt trong ngày thì cộng dồn tới hạn mức phiên, bộ kiểm
// sau bị chặn "đã dùng hết giới hạn của phiên này" (routing.test lỗi 8/16). Mỗi lượt chạy bắt đầu từ mức dùng 0.
db.prepare("DELETE FROM usage_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@synchro.test')").run();
// Khả năng (Cài đặt → Khả năng) của tài khoản thử nghiệm: bộ kiểm thử bật / tắt rồi tự trả lại, nhưng bộ bị ngắt giữa chừng thì không,
// nên trình chạy chụp lại trước và trả về như cũ khi xong (kể cả khi lỗi).
db.exec("CREATE TABLE IF NOT EXISTS user_caps (user_id TEXT PRIMARY KEY, caps TEXT NOT NULL, updated_at INTEGER NOT NULL)");
const savedCaps = adminId ? db.prepare("SELECT caps FROM user_caps WHERE user_id = ?").get(adminId)?.caps : undefined;
// Bộ não tổng hợp của tài khoản quản trị: tắt học trong lúc chạy để các bộ khác không bị chen ghi chú liên quan / công cụ bộ não
// (bộ brain dùng tài khoản riêng), xong thì trả lại như cũ.
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
const memKey = adminId ? `mem:${adminId}` : null;
const savedMem = memKey ? db.prepare("SELECT value FROM settings WHERE key = ?").get(memKey)?.value : undefined;
if (memKey) db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(memKey, JSON.stringify({ ...(savedMem ? JSON.parse(savedMem) : {}), gen: false }));
// Cài đặt Synchro Code của tài khoản thử nghiệm (chế độ quyền, trang được phép…): chạy với mặc định, xong trả lại như cũ
// (để một lần thử tay chọn "Hỏi trước" không làm các bộ khác dừng chờ duyệt).
db.exec("CREATE TABLE IF NOT EXISTS code_prefs (user_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
const savedCode = adminId ? db.prepare("SELECT json FROM code_prefs WHERE user_id = ?").get(adminId)?.json : undefined;
if (adminId) db.prepare("DELETE FROM code_prefs WHERE user_id = ?").run(adminId);
const restore = () => {
  if (adminId && savedCode !== undefined) db.prepare("INSERT INTO code_prefs (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json").run(adminId, savedCode, Date.now());
  if (adminId && saved !== undefined) db.prepare("UPDATE usage_users SET override = ? WHERE user_id = ?").run(saved.override, adminId); else if (adminId) db.prepare("DELETE FROM usage_users WHERE user_id = ?").run(adminId);
  if (adminId) { if (savedCaps === undefined) db.prepare("DELETE FROM user_caps WHERE user_id = ?").run(adminId); else db.prepare("UPDATE user_caps SET caps = ? WHERE user_id = ?").run(savedCaps, adminId); }
  if (memKey) { if (savedMem === undefined) db.prepare("DELETE FROM settings WHERE key = ?").run(memKey); else db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(savedMem, memKey); }
};
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

// Đăng nhập quản trị một lần, chia phiên cho các bộ kiểm thử.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const lg = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
const adminCookie = (lg.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (!adminCookie) { console.error(`Không đăng nhập được tài khoản quản trị thử nghiệm (${lg.status}): ${(await lg.text()).slice(0, 200)}`); process.exit(1); }

const SUITE_MS = 15 * 60_000;
/** Vì sao bộ kiểm dừng: hết giờ / bị giết / mã thoát, kèm dòng lỗi đầu tiên của stderr
 *  và chỗ ném lỗi (dòng "at …" kế tiếp). */
function why(r, err) {
  const head = r.error?.code === "ETIMEDOUT" ? `hết ${SUITE_MS / 60_000} phút, bị dừng`
    : r.error ? `${r.error.code ?? r.error.message}` : r.signal ? `bị giết (${r.signal})` : `mã thoát ${r.status}`;
  const lines = err.split("\n").map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^(?:[A-Za-z]*Error|AssertionError|Uncaught)\b/.test(l));
  const msg = i >= 0 ? [lines[i], lines.slice(i + 1).find((l) => l.startsWith("at "))].filter(Boolean)
    : lines.filter((l) => !/^Node\.js v/.test(l)).slice(-2);
  return [head, ...msg].join(" · ").slice(0, 500);
}

const rows = [];
for (const f of suites) {
  const t = Date.now();
  console.log(`\n━━ ${f}`);
  // maxBuffer: mặc định 1 MB; bộ in nhiều hơn bị giết giữa chừng (ENOBUFS) và trông như tự sập.
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    timeout: SUITE_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SYNCHRO_ADMIN_COOKIE: adminCookie } });
  const out = r.stdout ?? "", err = r.stderr ?? "";
  process.stdout.write(out); process.stderr.write(err);
  // Dòng tổng kết: "N đạt, M lỗi|hỏng", "N/T đạt", hoặc "N passed, M failed" (vài bộ Speech in tiếng Anh; trước đây không khớp nên luôn bị tính là lỗi).
  const SUM = /(\d+) (?:đạt|passed), (\d+) (?:lỗi|hỏng|failed)|(\d+)\/(\d+) đạt/;
  const m = SUM.exec(out.split("\n").reverse().join("\n"));
  const pass = m ? Number(m[1] ?? m[3]) : 0, fail = m ? Number(m[2] ?? Number(m[4]) - Number(m[3])) : 1;
  // Bộ hỏng mà không có dòng ✗ nào giải thích (sập giữa chừng, hết giờ, bị giết): in lý do trên MỘT dòng ✗, vì ci.txt
  // của CI chỉ giữ các dòng ✗ và đuôi nhật ký, vết ngăn xếp nằm giữa nhật ký sẽ mất.
  if (r.status !== 0 && (!m || !fail)) console.log(`  ✗ ${f} dừng không có tổng kết: ${why(r, err)}`);
  rows.push({ f, pass, fail: r.status === 0 ? fail : Math.max(fail, 1), s: ((Date.now() - t) / 1000).toFixed(0) });
}
console.log("\n━━ Tổng kết");
for (const r of rows) console.log(`${r.fail ? "✗" : "✓"} ${r.f.padEnd(34)} ${r.pass} đạt, ${r.fail} lỗi  (${r.s}s)`);
const bad = rows.filter((r) => r.fail).length;
console.log(bad ? `\n${bad}/${rows.length} bộ có lỗi` : `\nTất cả ${rows.length} bộ đều đạt`);
// exitCode thay cho process.exit(): khi đầu ra là ống (npm run qa đọc qua pipe), Node ghi không đồng bộ và process.exit() cắt mất phần tổng kết.
process.exitCode = bad ? 1 : 0;
