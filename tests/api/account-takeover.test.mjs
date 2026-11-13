// Chiếm tài khoản qua đổi email, xác minh hai bước đặt trước, và quản trị viên đổi email hộ. Tự chạy được, không cần dev:mock, không gửi thư thật.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-takeover-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "takeover-test"; process.env.SYNCHRO_RELAX_LIMITS = "1";
process.env.MAIL_CAPTURE_DIR = path.join(tmp, "mail");
const { authstore: AS, mfa: M } = await loadTs(["authstore", "mfa"]);
const B = "http://localhost:3200";
const req = (ip = "7.7.7.7") => new Request(B + "/", { method: "POST", headers: { origin: B, host: "localhost:3200", "user-agent": "t", "x-forwarded-for": ip } });
const d = AS.db();
const PW = "Mat-khau-dung-123";
let n = 0;
const mkUser = async (o = {}) => AS.createUser({ email: `u${++n}@takeover.test`, name: "U", verified: true, passwordHash: await AS.hashPassword(PW), ...o });
const fresh = (u) => AS.getUser(u.id);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const throws = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const prof = (email, subject = "g-" + email) => ({ provider: "google", subject, email, emailVerified: true, name: "N", avatar: null });
/** Dòng đổi email đang chờ, mã biết trước: thư thật không có trong kiểm thử. */
const pending = (u, to = `moi-${++n}@evil.test`) => {
  const token = crypto.randomBytes(16).toString("hex");
  d.exec("CREATE TABLE IF NOT EXISTS email_changes (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_email TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  d.prepare("INSERT INTO email_changes (token_hash, user_id, new_email, expires_at) VALUES (?, ?, ?, ?)").run(sha(token), u.id, to, Date.now() + 3_600_000);
  return token;
};
const emailRows = (u) => d.prepare("SELECT COUNT(*) n FROM email_changes WHERE user_id = ?").get(u.id).n;
const resetToken = (u, by = u.id) => { const t = crypto.randomBytes(16).toString("hex"); d.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(sha(t), u.id, Date.now() + 3_600_000, by); return t; };
const admin = AS.createUser({ email: "admin-thu@takeover.test", name: "Ad", verified: true });

try {
  console.log("1. Đường dẫn đổi email đang chờ mất hiệu lực khi mật khẩu hay chủ tài khoản đổi");
  {
    const u = await mkUser(), tok = pending(u);
    await AS.redeemResetLink(req(), resetToken(u), "Mat-khau-moi-456");
    ok(emailRows(u) === 0, "đặt lại mật khẩu: xóa đường dẫn đang chờ");
    const e = await throws(() => AS.confirmEmailChange(req(), tok));
    ok(e?.status === 400 && fresh(u).email === u.email, "kẻ giữ đường dẫn không đổi được email nữa", e?.message);
  }
  {
    const u = await mkUser(), tok = pending(u);
    await AS.changePassword(req(), fresh(u), PW, "Mat-khau-moi-456", "khong-co");
    ok((await throws(() => AS.confirmEmailChange(req(), tok)))?.status === 400, "tự đổi mật khẩu: đường dẫn hết hiệu lực");
  }
  for (const [name, act, body] of [["đặt mật khẩu hộ", "set_password", { password: "Mat-khau-moi-456" }], ["khóa tài khoản", "suspend", {}], ["đánh dấu đã xác minh", "mark_verified", {}], ["đổi email hộ", "set_email", { email: `doi-${n}@takeover.test` }]]) {
    const u = await mkUser();
    pending(u);
    await AS.adminAct(req(), admin, u.id, act, body);
    ok(emailRows(u) === 0, `quản trị viên ${name}: xóa đường dẫn đang chờ`);
  }
  {
    const u = await mkUser({ verified: false }), tok = pending(u);
    const r = AS.oauthLogin(req(), prof(u.email));
    ok(r.claimed && emailRows(u) === 0, "chủ email giành lại bằng Google: xóa đường dẫn người đăng ký trước đã xin", r.claimed);
    ok((await throws(() => AS.confirmEmailChange(req(), tok)))?.status === 400 && fresh(u).email === u.email, "người đăng ký trước không chiếm lại được bằng đường dẫn cũ");
  }
  console.log("2. Tài khoản chưa xác minh chưa xin đổi email được");
  {
    const u = await mkUser({ verified: false });
    const e = await throws(() => AS.requestEmailChange(req(), u, PW, "ke-gian@evil.test"));
    ok(e?.status === 403 && emailRows(u) === 0, "từ chối, không tạo đường dẫn", e?.message);
    const tok = pending(u);
    ok((await throws(() => AS.checkEmailChange(req(), tok)))?.status === 400 && (await throws(() => AS.confirmEmailChange(req(), tok)))?.status === 400, "đường dẫn tạo từ trước khi có cổng cũng không dùng được");
    const v = await mkUser();
    await AS.requestEmailChange(req(), v, PW, `dung-${n}@takeover.test`, "vi");
    ok(emailRows(v) === 1, "tài khoản đã xác minh vẫn đổi được như cũ");
    const tok2 = pending(await mkUser(), `xac-nhan-${n}@takeover.test`);
    ok(AS.confirmEmailChange(req(), tok2) === `xac-nhan-${n}@takeover.test`, "đường dẫn hợp lệ vẫn xác nhận được");
  }
  console.log("3. Quản trị viên đổi email hộ không biến tài khoản lâu năm thành tài khoản mới");
  {
    const u = await mkUser(), to = `moi-${++n}@takeover.test`;
    d.prepare("INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)").run(sha("cu-" + u.id), u.id, u.email, Date.now() + 3_600_000);
    await AS.adminAct(req(), admin, u.id, "set_email", { email: to });
    const v = fresh(u);
    ok(v.email === to && v.email_verified === 1 && !AS.needsVerify(v) && !AS.verifyLocked(v), "email mới, không bị khóa tính năng", v.email_verified);
    ok(d.prepare("SELECT COUNT(*) n FROM email_verifications WHERE user_id = ?").get(u.id).n === 0, "thư xác minh cũ (có nút Không phải tôi) không còn dùng được");
    const r = await AS.redeemResetLink(req(), resetToken(v), "Mat-khau-moi-456");
    ok(r.fresh === false, "quên mật khẩu ở địa chỉ mới: không bị coi là giành lại, không xóa bộ não");
    const w = await mkUser(), g = `g-${++n}@takeover.test`;
    await AS.adminAct(req(), admin, w.id, "set_email", { email: g });
    const o = AS.oauthLogin(req(), prof(g));
    ok(o.claimed === "" && o.fresh === false && !!fresh(w).password_hash, "đăng nhập Google ở địa chỉ mới: giữ mật khẩu, không xóa gì", o.claimed);
  }
  {
    // Tài khoản đã bị bản cũ đánh dấu chưa xác minh trên máy chủ thật.
    const u = await mkUser(), to = `cu-${++n}@takeover.test`;
    d.prepare("UPDATE users SET email = ?, email_verified = 0 WHERE id = ?").run(to, u.id);
    d.prepare("INSERT INTO audit (at, action, target_id, detail) VALUES (?, 'admin_set_email', ?, ?)").run(Date.now(), u.id, to);
    const other = await mkUser({ verified: false }), moved = await mkUser();
    d.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").run(moved.id);
    d.prepare("INSERT INTO audit (at, action, target_id, detail) VALUES (?, 'admin_set_email', ?, ?)").run(Date.now(), moved.id, "dia-chi-khac@takeover.test");
    d.prepare("DELETE FROM settings WHERE key = 'admin_email_healed'").run();
    AS.healAdminEmails(d);
    ok(fresh(u).email_verified === 1, "sửa lại tài khoản còn giữ địa chỉ quản trị viên đã đặt");
    ok(fresh(other).email_verified === 0 && fresh(moved).email_verified === 0, "không đụng tới tài khoản khác");
    d.prepare("UPDATE users SET email_verified = 0 WHERE id = ?").run(u.id);
    AS.healAdminEmails(d);
    ok(fresh(u).email_verified === 0, "chỉ chạy một lần");
  }
  console.log("4. Xác minh hai bước trên tài khoản chưa xác minh email");
  {
    const u = await mkUser({ verified: false });
    ok((await throws(() => M.startMfa(u)))?.status === 403 && (await throws(() => M.confirmMfa(u, "000000")))?.status === 403, "chưa xác minh: không bật được");
    const v = await mkUser();
    AS.markReauth(v.id); // bật 2FA cần vừa xác minh lại (step-up); tài khoản tạo thẳng trong test chưa có phiên đăng nhập
    const s = M.startMfa(v);
    ok(/^[A-Z2-7]{32}$/.test(s.secret), "đã xác minh: bật được như cũ");
    const tok = pending(v);
    M.confirmMfa(v, M.totpAt(s.secret, Math.floor(Date.now() / 30_000)));
    ok(M.mfaStatus(v.id).enabled && emailRows(v) === 0, "bật xong: đường dẫn đổi email đang chờ hết hiệu lực", tok.length);
    // Tài khoản cũ đã bật trước khi có cổng: chủ email giành lại không bị đòi mã của người khác.
    const seed = (x) => d.prepare("INSERT INTO user_mfa (user_id, secret, enabled_at, recovery) VALUES (?, 'x', ?, '[]')").run(x.id, Date.now());
    const q = await mkUser({ verified: false });
    seed(q);
    d.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES ('github', 'cua-ke-gian', ?, 'x@evil.test', ?)").run(q.id, Date.now());
    const r = AS.oauthLogin(req(), prof(q.email));
    ok(r.claimed && r.mfa === false && r.dropped && !M.mfaStatus(q.id).enabled, "giành lại bằng Google: gỡ mã, có phiên ngay", { c: r.claimed, m: r.mfa });
    ok(d.prepare("SELECT provider FROM identities WHERE user_id = ?").all(q.id).map((x) => x.provider).join() === "google", "kẻ đăng ký trước không còn vào được bằng cách đăng nhập họ đã gắn");
    const q2 = await mkUser({ verified: false });
    seed(q2);
    const r2 = await AS.redeemResetLink(req(), resetToken(q2), "Mat-khau-moi-456");
    ok(!M.mfaStatus(q2.id).enabled && r2.dropped, "giành lại bằng thư đặt lại mật khẩu: gỡ mã");
    const q3 = await mkUser({ verified: false });
    seed(q3);
    await AS.redeemResetLink(req(), resetToken(q3, admin.id), "Mat-khau-moi-456");
    ok(M.mfaStatus(q3.id).enabled, "đường dẫn quản trị viên tạo không phải bằng chứng hộp thư: giữ nguyên");
    const k = await mkUser();
    seed(k);
    await AS.redeemResetLink(req(), resetToken(k), "Mat-khau-moi-456");
    ok(M.mfaStatus(k.id).enabled, "tài khoản đã xác minh quên mật khẩu: vẫn phải qua bước hai");
    const k2 = await mkUser();
    seed(k2);
    const r3 = AS.oauthLogin(req(), prof(k2.email));
    ok(r3.mfa === true && M.mfaStatus(k2.id).enabled, "tài khoản đã xác minh đăng nhập Google: vẫn phải qua bước hai");
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
