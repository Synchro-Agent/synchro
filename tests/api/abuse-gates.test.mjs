// Chống lạm dụng khi đăng ký mở: sàn đĩa trên đường ghi cơ sở dữ liệu, hạn mức thấp hơn cho tài khoản chưa xác minh, chưa xác minh thì chưa đăng được trang công khai.
// Phần đầu nạp thẳng mô-đun với thư mục dữ liệu tạm; phần sau chạy trên máy chủ giả lập, bật cổng xác minh trong lúc thử rồi trả lại như cũ.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

const B = process.env.SYNCHRO_TEST_URL || "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-abuse-"));
const mockDb = path.join(process.cwd(), "data-mock", "synchro.db");
process.env.DATA_DIR = tmp;
process.env.SYNCHRO_MIN_FREE_MB = "1";
const { chatstore, artifactstore, authstore, runs } = await loadTs(["chatstore", "artifactstore", "authstore", "runs"]);
const { pushItems, SYNC_LIMITS } = chatstore;
authstore.db().pragma("foreign_keys = OFF"); // Thư mục tạm không có tài khoản nào.
const item = (id, n, upd = Date.now(), extra = {}) => ({ kind: "chat", id, upd, data: JSON.stringify({ t: "x".repeat(n) }), ...extra });
let r = pushItems("u1", [item("a", 1000)]);
ok(r[0].ok, "đĩa còn chỗ: ghi bình thường", JSON.stringify(r));
r = pushItems("u1", [item("big", 2000)], { total: 1500 });
ok(r[0].error === "quota", "tài khoản hạn mức thấp: quá thì báo hết hạn mức", JSON.stringify(r));
ok(SYNC_LIMITS.lockedTotal < SYNC_LIMITS.total, "tài khoản chưa xác minh có hạn mức nhỏ hơn");
process.env.SYNCHRO_MIN_FREE_MB = "999999999";
r = pushItems("u1", [item("b", 1000)]);
ok(r[0].error === "disk" && !r[0].ok, "đĩa sắp đầy: không nhận thêm và báo rõ lý do", JSON.stringify(r));
r = pushItems("u1", [item("a", 10, Date.now() + 1)]);
ok(r[0].ok, "đĩa sắp đầy: bản nhỏ đi vẫn lưu được", JSON.stringify(r));
r = pushItems("u1", [{ kind: "chat", id: "a", upd: Date.now() + 2, deleted: true }]);
ok(r[0].ok && r[0].deleted, "đĩa sắp đầy: vẫn xóa được", JSON.stringify(r));
const art = { ident: "x", title: "T", type: "html", content: "<p>hi</p>" };
let code = 0;
try { artifactstore.saveArtifact("u1", "c1", art); } catch (e) { code = e.status; }
ok(code === 507, "đĩa sắp đầy: artifact báo 507", code);
process.env.SYNCHRO_MIN_FREE_MB = "1";
ok(!!artifactstore.saveArtifact("u1", "c1", art), "đĩa còn chỗ: artifact lưu được");
code = 0;
try { artifactstore.saveArtifact("u1", "c1", { ...art, content: "y".repeat(5000) }, { maxBytes: 1000 }); } catch (e) { code = e.status; }
ok(code === 413, "artifact quá tổng dung lượng: báo 413", code);
const locked = authstore.createUser({ email: "lock@synchro.test", name: "L", verified: false, passwordHash: "x" });
const real = authstore.createUser({ email: "real@synchro.test", name: "R", verified: true, passwordHash: "x" });
ok(runs.turnsLimit(locked) < runs.turnsLimit(real), "tài khoản chưa xác minh chạy được ít lượt cùng lúc hơn", `${runs.turnsLimit(locked)} / ${runs.turnsLimit(real)}`);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- qua API ----
let cookie = "";
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b && JSON.stringify(b) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro")) cookie = c.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
const R = createRequire(path.join(process.cwd(), "package.json"));
const db = new (R("better-sqlite3"))(mockDb);
db.pragma("busy_timeout = 5000");
const saved = db.prepare("SELECT value FROM settings WHERE key = 'verify_gate'").get()?.value;
const email = `abuse-${Date.now()}@synchro.test`;
await call("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Abuse Tester", birthDate: "2000-01-01" } });
await call("POST", "/api/auth/login", { email, password: "Member-pass-123" });
db.prepare("INSERT INTO settings (key, value) VALUES ('verify_gate', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
try {
  const conv = `abuse-${Date.now()}`;
  const msgs = [{ role: "user", text: "chào" }, { role: "ai", text: "chào bạn" }];
  let x = await call("POST", "/api/share", { conv, title: "Sign in to Synchro", msgs });
  ok(x.s === 403 && /xác minh email/.test(x.j?.error ?? ""), "chưa xác minh: không tạo được trang chia sẻ công khai", JSON.stringify(x));
  const app = { conv, ident: "a1", title: "App", type: "html", content: "<p>x</p>" };
  x = await call("POST", "/api/apps", { ...app, visibility: "org" });
  ok(x.s === 403 && /xác minh email/.test(x.j?.error ?? ""), "chưa xác minh: không đăng được ứng dụng cho cả tổ chức", JSON.stringify(x));
  x = await call("POST", "/api/apps", { ...app, visibility: "private" });
  ok(x.s === 200 && !!x.j?.id, "chưa xác minh: ứng dụng riêng vẫn được", JSON.stringify(x));
  const y = await call("PATCH", `/api/apps/${x.j?.id}`, { visibility: "org" });
  ok(y.s === 403, "chưa xác minh: không chuyển ứng dụng riêng thành cho cả tổ chức", JSON.stringify(y));
} finally {
  if (saved === undefined) db.prepare("DELETE FROM settings WHERE key = 'verify_gate'").run();
  else db.prepare("UPDATE settings SET value = ? WHERE key = 'verify_gate'").run(saved);
  db.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
