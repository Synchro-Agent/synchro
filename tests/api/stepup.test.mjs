// Xác minh lại (step-up) trước khi thêm khóa truy cập / bật xác minh hai bước, qua đúng route API mà giao diện gọi (stepup.tsx):
// phiên cũ không gửi gì → 403 { reauth: true }; gửi mật khẩu đúng → chạy tiếp; mật khẩu sai → 400 báo sai (vẫn { reauth: true } để hộp giữ nguyên).
// Tự chạy được, không cần máy chủ (loadTs).
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
/** Phiên đã đăng nhập từ lâu: bỏ mốc "vừa xác minh" mà lần đăng nhập ghi. */
const stale = (u) => globalThis.__synchroReauth?.delete(u.id);
let n = 0;
const login = async (o = {}) => {
  const u = AS.createUser({ email: `s${++n}@stepup.test`, name: "S", verified: true, ...o });
  const cookie = AS.createSession(u, new Request(B + "/", { headers: { host: "synchro.test", "user-agent": "t" } }), "password").split(";")[0];
  return { u, cookie };
};

try {
  console.log("1. Bật xác minh hai bước (op: start)");
  {
    const { u, cookie } = await login({ passwordHash: await AS.hashPassword(PW) });
    const fresh = await call(MR, cookie, { op: "start" });
    ok(fresh.status === 200 && fresh.json.secret, "vừa đăng nhập (trong 5 phút): bật được ngay", fresh);
    stale(u);
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
    stale(u);
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
    stale(u);
    const no = await call(MR, cookie, { op: "start" });
    ok(no.status === 403 && no.json.reauth === true, "phiên cũ → 403 { reauth: true }", no);
    const pw = await call(MR, cookie, { op: "start", password: "bat-ky-123456" });
    ok(pw.status === 400 && pw.json.reauth === true && /chưa có mật khẩu/.test(pw.json.error), "gửi mật khẩu khi không có mật khẩu → 400, gợi ý khóa hoặc đăng nhập lại", pw);
    const ro = await call(PR, cookie, { op: "reauth-options" });
    ok(ro.status === 400 && /chưa có khóa/.test(ro.json.error), "chưa có khóa nào → không xác minh bằng khóa được", ro);
    const fake = await call(PR, cookie, { op: "reauth", response: { id: "x", response: { clientDataJSON: "" } } });
    ok(fake.status === 400 && (await call(MR, cookie, { op: "start" })).status === 403, "câu trả lời khóa giả → 400, vẫn chưa xác minh", fake);
    // Đăng xuất rồi đăng nhập lại: phiên mới được tính là vừa xác minh.
    AS.createSession(u, new Request(B + "/", { headers: { host: "synchro.test" } }), "google");
    const re = await call(MR, cookie, { op: "start" });
    ok(re.status === 200 && re.json.secret, "đăng nhập lại → bật được ngay", re);
  }
  {
    const { u, cookie } = await login();
    AS.db().exec(`CREATE TABLE IF NOT EXISTS user_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER)`);
    AS.db().prepare("INSERT INTO user_passkeys (id, user_id, name, public_key, created_at) VALUES (?, ?, 'K', x'00', ?)").run("khoa-cua-toi", u.id, Date.now());
    stale(u);
    const ro = await call(PR, cookie, { op: "reauth-options" });
    ok(ro.status === 200 && typeof ro.json.challenge === "string" && ro.json.allowCredentials?.map((c) => c.id).join() === "khoa-cua-toi", "có khóa → thử thách chỉ nhận khóa của tài khoản này", ro);
  }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
