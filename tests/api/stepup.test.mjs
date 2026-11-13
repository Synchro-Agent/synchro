// Xác minh lại (step-up) trước khi thêm khóa truy cập / bật xác minh hai bước, qua đúng route API mà giao diện gọi (stepup.tsx):
// phiên cũ không gửi gì → 403 { reauth: true }; gửi mật khẩu đúng → chạy tiếp; mật khẩu sai → 400 báo sai (vẫn { reauth: true } để hộp giữ nguyên).
// Tự chạy được, không cần máy chủ (loadTs).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-stepup-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "stepup-test"; process.env.SYNCHRO_RELAX_LIMITS = "1";
delete process.env.APP_URL;

const { authstore: AS, "api/auth/mfa/route": MR, "api/auth/passkey/route": PR } = await loadTs(["authstore", "api/auth/mfa/route", "api/auth/passkey/route"]);
const B = "http://synchro.test";
const PW = "Mat-khau-dung-123";
const call = async (route, cookie, body) => {
  const res = await route.POST(new Request(B + "/api/x", { method: "POST", headers: { origin: B, host: "synchro.test", cookie, "content-type": "application/json", "user-agent": "t" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
/** Mã phiên (SessionRow.id) của cookie: sha256 của mã trong cookie, như authstore. */
const sid = (cookie) => crypto.createHash("sha256").update(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))).digest("hex");
/** Phiên đã đăng nhập từ lâu: bỏ mốc "vừa xác minh" mà lần đăng nhập ghi cho phiên này. */
const stale = (cookie) => globalThis.__synchroReauth?.delete(sid(cookie));
const signInAgain = (u, method = "password") => AS.createSession(u, new Request(B + "/", { headers: { host: "synchro.test", "user-agent": "t" } }), method).split(";")[0];
let n = 0;
const login = async (o = {}) => {
  const u = AS.createUser({ email: `s${++n}@stepup.test`, name: "S", verified: true, ...o });
  return { u, cookie: signInAgain(u) };
};

try {
  console.log("1. Bật xác minh hai bước (op: start)");
  {
    const { u, cookie } = await login({ passwordHash: await AS.hashPassword(PW) });
    const fresh = await call(MR, cookie, { op: "start" });
    ok(fresh.status === 200 && fresh.json.secret, "vừa đăng nhập (trong 5 phút): bật được ngay", fresh);
    stale(cookie);
    const no = await call(MR, cookie, { op: "start" });
    ok(no.status === 403 && no.json.reauth === true, "phiên cũ, không gửi mật khẩu → 403 { reauth: true }", no);
    const bad = await call(MR, cookie, { op: "start", password: "sai-mat-khau-999" });
    ok(bad.status === 400 && bad.json.reauth === true && bad.json.error === "Mật khẩu không đúng.", "mật khẩu sai → 400 báo sai", bad);
    const still = await call(MR, cookie, { op: "start" });
    ok(still.status === 403, "mật khẩu sai không được tính là đã xác minh", still);
    const good = await call(MR, cookie, { op: "start", password: PW });
    ok(good.status === 200 && /^[A-Z2-7]{32}$/.test(good.json.secret ?? ""), "mật khẩu đúng → bắt đầu bật", good);
    const again = await call(MR, cookie, { op: "start" });
    ok(again.status === 200, "đã xác minh: 5 phút sau đó không hỏi lại", again);
  }

  console.log("2. Thêm khóa truy cập (op: reg-options)");
  {
    const { u, cookie } = await login({ passwordHash: await AS.hashPassword(PW) });
    stale(cookie);
    const no = await call(PR, cookie, { op: "reg-options" });
    ok(no.status === 403 && no.json.reauth === true, "phiên cũ, không gửi mật khẩu → 403 { reauth: true }", no);
    const bad = await call(PR, cookie, { op: "reg-options", password: "sai-mat-khau-999" });
    ok(bad.status === 400 && bad.json.reauth === true && bad.json.error === "Mật khẩu không đúng.", "mật khẩu sai → 400 báo sai", bad);
    const good = await call(PR, cookie, { op: "reg-options", password: PW });
    ok(good.status === 200 && typeof good.json.challenge === "string" && good.json.user?.name === u.email, "mật khẩu đúng → có thử thách đăng ký", good);
    const reg = await call(PR, cookie, { op: "register", response: {} });
    ok(reg.status === 400 && !reg.json.reauth, "bước register tiếp theo không bị hỏi lại (chỉ còn lỗi của câu trả lời hỏng)", reg);
  }

  console.log("3. Tài khoản không có mật khẩu (Google / GitHub / khóa)");
  {
    const { u, cookie } = await login();
    stale(cookie);
    const no = await call(MR, cookie, { op: "start" });
    ok(no.status === 403 && no.json.reauth === true, "phiên cũ → 403 { reauth: true }", no);
    const pw = await call(MR, cookie, { op: "start", password: "bat-ky-123456" });
    ok(pw.status === 400 && pw.json.reauth === true && /chưa có mật khẩu/.test(pw.json.error), "gửi mật khẩu khi không có mật khẩu → 400, gợi ý khóa hoặc đăng nhập lại", pw);
    const ro = await call(PR, cookie, { op: "reauth-options" });
    ok(ro.status === 400 && /chưa có khóa/.test(ro.json.error), "chưa có khóa nào → không xác minh bằng khóa được", ro);
    const fake = await call(PR, cookie, { op: "reauth", response: { id: "x", response: { clientDataJSON: "" } } });
    ok(fake.status === 400 && (await call(MR, cookie, { op: "start" })).status === 403, "câu trả lời khóa giả → 400, vẫn chưa xác minh", fake);
    // Đăng nhập lại: PHIÊN MỚI được tính là vừa xác minh; phiên cũ thì không.
    const fresh = signInAgain(u, "google");
    const re = await call(MR, fresh, { op: "start" });
    ok(re.status === 200 && re.json.secret, "đăng nhập lại → phiên mới bật được ngay", re);
    const old = await call(MR, cookie, { op: "start" });
    ok(old.status === 403 && old.json.reauth === true, "phiên cũ vẫn bị hỏi xác minh lại", old);
  }
  {
    const { u, cookie } = await login();
    AS.db().exec(`CREATE TABLE IF NOT EXISTS user_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER)`);
    AS.db().prepare("INSERT INTO user_passkeys (id, user_id, name, public_key, created_at) VALUES (?, ?, 'K', x'00', ?)").run("khoa-cua-toi", u.id, Date.now());
    stale(cookie);
    const ro = await call(PR, cookie, { op: "reauth-options" });
    ok(ro.status === 200 && typeof ro.json.challenge === "string" && ro.json.allowCredentials?.map((c) => c.id).join() === "khoa-cua-toi", "có khóa → thử thách chỉ nhận khóa của tài khoản này", ro);
  }

  // Mốc "vừa xác minh" gắn với từng phiên: cookie cũ bị đánh cắp không được hưởng lần đăng nhập / xác minh lại của chủ thật ở thiết bị khác.
  console.log("4. Phiên cũ (bị chiếm) không ăn theo phiên khác của cùng tài khoản");
  {
    const { u, cookie: stolen } = await login({ passwordHash: await AS.hashPassword(PW) });
    stale(stolen);
    ok((await call(MR, stolen, { op: "start" })).status === 403, "phiên cũ một mình → 403");
    const owner = signInAgain(u); // chủ thật đăng nhập ở máy khác
    const m = await call(MR, stolen, { op: "start" });
    ok(m.status === 403 && m.json.reauth === true && !m.json.secret, "chủ đăng nhập ở máy khác → phiên cũ vẫn 403 khi bật xác minh hai bước", m);
    const p = await call(PR, stolen, { op: "reg-options" });
    ok(p.status === 403 && p.json.reauth === true && !p.json.challenge, "… và vẫn 403 khi xin thêm khóa truy cập", p);
    const r = await call(PR, stolen, { op: "register", response: {} });
    ok(r.status === 403 && r.json.reauth === true, "… và vẫn 403 ở bước register", r);
    // Chủ xác minh lại bằng mật khẩu trong phiên của mình (sau 5 phút): chỉ phiên đó được mở.
    stale(owner);
    const up = await call(MR, owner, { op: "start", password: PW });
    ok(up.status === 200 && up.json.secret, "chủ xác minh lại bằng mật khẩu → phiên của chủ bật được", up);
    const after = await call(PR, stolen, { op: "reg-options" });
    ok(after.status === 403 && after.json.reauth === true, "chủ xác minh lại ở phiên khác → phiên cũ vẫn 403", after);
    ok(!AS.recentlyReauthed(u.id), "mốc không còn gắn theo mã tài khoản");
    // Đổi mật khẩu: chỉ phiên đang đổi được tính là vừa xác minh.
    const mine = AS.current(new Request(B + "/", { headers: { host: "synchro.test", cookie: owner } }));
    stale(owner);
    await AS.changePassword(new Request(B + "/", { headers: { host: "synchro.test", "user-agent": "t" } }), mine.user, PW, PW + "-moi", mine.session.id);
    ok(AS.recentlyReauthed(sid(owner)) && !AS.recentlyReauthed(sid(stolen)), "đổi mật khẩu → chỉ phiên đang đổi được đánh dấu");
  }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
