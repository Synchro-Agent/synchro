// Khóa truy cập (WebAuthn) với một "thiết bị" giả bằng phần mềm: tự tạo cặp khóa P-256, dựng attestation "none" và chữ ký đăng nhập như trình duyệt.
// Đăng ký, đăng nhập, gửi lại câu trả lời cũ bị từ chối, sai nguồn gốc bị từ chối, bộ đếm không tăng bị từ chối, xác minh hai bước, đổi tên, xóa.
// Tự chạy được, không cần dev:mock (nạp thẳng route của Next).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { authenticator, b64u } from "../lib/fake-passkey.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-passkey-"));
const B = "http://localhost:3200";
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "passkey-test"; process.env.SYNCHRO_RELAX_LIMITS = "1"; process.env.APP_URL = B;
const { authstore: AS, mfa: M, passkeys: P, "api/auth/passkey/route": R, "api/auth/login/route": L, "api/auth/mfa/route": MR } = await loadTs(["authstore", "mfa", "passkeys", "api/auth/passkey/route", "api/auth/login/route", "api/auth/mfa/route"]);
const req = (p, cookie, body, origin = B) => new Request(B + p, { method: body ? "POST" : "GET", headers: { origin, host: "localhost:3200", "content-type": "application/json", cookie: cookie ?? "", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0", "x-forwarded-for": "6.6.6.6" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const api = async (cookie, body) => { const r = await R.POST(req("/api/auth/passkey", cookie, body)); return { r, j: await r.json(), ck: cookies(r) }; };

const PW = "Mat-khau-dung-123";
const u = AS.createUser({ email: "pk@synchro.test", name: "PK", verified: true, passwordHash: await AS.hashPassword(PW) });
const loginPw = async () => { const r = await L.POST(req("/api/auth/login", "", { email: u.email, password: PW })); return { r, j: await r.json(), ck: cookies(r) }; };
const lastAudit = (action) => AS.db().prepare("SELECT * FROM audit WHERE action = ? ORDER BY id DESC LIMIT 1").get(action);
try {
  const { ck: [sess] } = await loginPw();
  ok(!!sess, "đăng nhập mật khẩu để thêm khóa");
  ok((await api("", { op: "reg-options" })).r.status === 401, "chưa đăng nhập: không thêm khóa được");

  // ---- đăng ký ----
  const dev = authenticator({ origin: B });
  let { r, j } = await api(sess, { op: "reg-options" });
  ok(r.status === 200 && j.rp?.id === "localhost" && j.rp?.name === "Synchro" && j.attestation === "none" && j.authenticatorSelection?.residentKey === "required" && j.challenge, "tùy chọn đăng ký: rpID theo APP_URL, attestation none, khóa lưu trên thiết bị", j);
  ok(Buffer.from(j.user.id, "base64url").toString() === u.id, "userHandle là mã tài khoản", j.user);
  const reg = dev.register(j);
  ({ r, j } = await api(sess, { op: "register", response: reg, name: "  MacBook   của tôi " }));
  ok(r.status === 200 && j.passkeys?.length === 1 && j.passkeys[0].name === "MacBook của tôi" && j.passkeys[0].id === dev.id, "đăng ký được, tên đã làm gọn", j);
  ok(lastAudit("passkey_added")?.actor_id === u.id, "nhật ký: thêm khóa");
  ({ r, j } = await api(sess, { op: "register", response: reg }));
  ok(r.status === 400, "gửi lại câu trả lời đăng ký cũ: từ chối (thử thách đã dùng)", { s: r.status, j });
  ok(AS.publicUser(AS.getUser(u.id)).methods.includes("passkey"), "khóa truy cập hiện trong các cách đăng nhập");

  // Thử thách cấp cho tài khoản A không dùng được cho tài khoản B.
  const u2 = AS.createUser({ email: "pk2@synchro.test", name: "PK2", verified: true, passwordHash: await AS.hashPassword(PW) });
  const s2 = AS.createSession(u2, req("/"), "password").split(";")[0];
  const dev2 = authenticator({ origin: B });
  ({ j } = await api(sess, { op: "reg-options" }));
  ({ r } = await api(s2, { op: "register", response: dev2.register(j) }));
  ok(r.status === 400 && P.listPasskeys(u2.id).length === 0, "thử thách của tài khoản khác: từ chối", r.status);
  // Sai nguồn gốc khi đăng ký.
  ({ j } = await api(s2, { op: "reg-options" }));
  ({ r } = await api(s2, { op: "register", response: dev2.register(j, { origin: "https://evil.example" }) }));
  ok(r.status === 400 && P.listPasskeys(u2.id).length === 0, "đăng ký từ trang khác: từ chối", r.status);

  // ---- đăng nhập ----
  ({ r, j } = await api("", { op: "login-options" }));
  ok(r.status === 200 && j.rpId === "localhost" && j.challenge && !j.allowCredentials?.length, "tùy chọn đăng nhập: không lộ danh sách khóa", j);
  const a1 = dev.assert(j);
  let ck;
  ({ r, j, ck } = await api("", { op: "login", response: a1 }));
  const sessPk = ck.find((c) => c.startsWith("synchro_session="));
  ok(r.status === 200 && j.user?.email === u.email && AS.current(req("/", sessPk))?.session.method === "passkey", "đăng nhập bằng khóa: có phiên, cách đăng nhập là passkey", j);
  ok(lastAudit("login")?.detail === "passkey", "nhật ký: đăng nhập bằng khóa", lastAudit("login"));
  ok(P.listPasskeys(u.id)[0].lastUsedAt > 0, "ghi lần dùng gần nhất");
  ({ r } = await api("", { op: "login", response: a1 }));
  ok(r.status === 400, "gửi lại đúng câu trả lời đã dùng: từ chối", r.status);
  ok(P.pendingChallenges() === 0, "thử thách đã dùng hoặc hỏng đều bị xóa", P.pendingChallenges());

  ({ j } = await api("", { op: "login-options" }));
  ({ r } = await api("", { op: "login", response: dev.assert(j, { origin: "https://evil.example" }) }));
  ok(r.status === 401, "chữ ký đúng nhưng ký cho trang khác: từ chối", r.status);
  ok(/passkey/.test(lastAudit("login_failed")?.detail ?? ""), "nhật ký: đăng nhập thất bại", lastAudit("login_failed"));
  ({ j } = await api("", { op: "login-options" }));
  ({ r } = await api("", { op: "login", response: dev.assert(j, { rpId: "evil.example" }) }));
  ok(r.status === 401, "rpID khác: từ chối", r.status);
  // Máy chủ đã lưu bộ đếm của lần đăng nhập thành công (1): chữ ký mang bộ đếm 1 lần nữa là bản sao.
  ({ j } = await api("", { op: "login-options" }));
  ({ r } = await api("", { op: "login", response: dev.assert(j, { at: 1 }) }));
  ok(r.status === 401, "bộ đếm không tăng (khóa bị sao chép?): từ chối", r.status);
  ({ j } = await api("", { op: "login-options" }));
  ({ r } = await api("", { op: "login", response: dev.assert(j, { handle: b64u(Buffer.from(u2.id)) }) }));
  ok(r.status === 401, "userHandle không phải chủ của khóa: từ chối", r.status);
  ({ j } = await api("", { op: "login-options" }));
  const forged = dev.assert(j); forged.response.signature = b64u(crypto.randomBytes(70));
  ({ r } = await api("", { op: "login", response: forged }));
  ok(r.status === 401, "chữ ký giả: từ chối", r.status);
  ({ r } = await api("", { op: "login", response: dev.assert({ challenge: b64u(crypto.randomBytes(32)) }) }));
  ok(r.status === 400, "thử thách máy chủ chưa cấp: từ chối", r.status);
  ({ j } = await api("", { op: "login-options" }));
  ({ r, j } = await api("", { op: "login", response: dev.assert(j) }));
  ok(r.status === 200 && j.user?.id === u.id, "sau các lần bị từ chối, khóa thật vẫn đăng nhập được", j);

  // ---- cùng xác minh hai bước ----
  const st = await MR.POST(req("/api/auth/mfa", sess, { op: "start" }));
  const { secret } = await st.json();
  await MR.POST(req("/api/auth/mfa", sess, { op: "confirm", code: M.totpAt(secret, Math.floor(Date.now() / 30_000)) }));
  ok(M.mfaStatus(u.id).enabled, "bật xác minh hai bước");
  ({ j } = await api("", { op: "login-options" }));
  ({ r, j, ck } = await api("", { op: "login", response: dev.assert(j) }));
  ok(r.status === 200 && j.user?.id === u.id, "khóa có xác minh người dùng (vân tay / PIN): đủ hai yếu tố, vào thẳng", j);
  ({ j } = await api("", { op: "login-options" }));
  ({ r, j, ck } = await api("", { op: "login", response: dev.assert(j, { uv: false }) }));
  ok(r.status === 200 && j.mfa === true && !j.user && ck.length === 1 && ck[0].startsWith("synchro_mfa="), "khóa không xác minh người dùng: vẫn phải nhập mã bước hai", { j, ck });
  r = await MR.POST(req("/api/auth/mfa", ck[0], { op: "verify", code: M.totpAt(secret, Math.floor(Date.now() / 30_000) + 1) }));
  ok(r.status === 200 && AS.current(req("/", cookies(r).find((c) => c.startsWith("synchro_session="))))?.session.method === "passkey", "nhập mã xong: phiên ghi là passkey", r.status);
  const pwl = await loginPw();
  ok(pwl.j.mfa === true, "mật khẩu vẫn cần mã như cũ");

  // ---- đổi tên, xóa ----
  ({ r, j } = await api(sess, { op: "rename", id: dev.id, name: "Điện thoại" }));
  ok(r.status === 200 && j.passkeys[0].name === "Điện thoại" && lastAudit("passkey_renamed"), "đổi tên", j);
  ({ r } = await api(s2, { op: "rename", id: dev.id, name: "Của tôi" }));
  ok(r.status === 404, "không đổi tên được khóa của người khác", r.status);
  ({ r } = await api(s2, { op: "delete", id: dev.id }));
  ok(r.status === 404 && P.listPasskeys(u.id).length === 1, "không xóa được khóa của người khác", r.status);
  // Tài khoản chỉ còn khóa truy cập: không xóa được khóa cuối cùng.
  const u3 = AS.createUser({ email: "pk3@synchro.test", name: "PK3", verified: true });
  const s3 = AS.createSession(u3, req("/"), "google").split(";")[0];
  const dev3 = authenticator({ origin: B });
  ({ j } = await api(s3, { op: "reg-options" }));
  ({ r } = await api(s3, { op: "register", response: dev3.register(j) }));
  ok(r.status === 200, "tài khoản không mật khẩu vẫn thêm khóa được", r.status);
  ({ r, j } = await api(s3, { op: "delete", id: dev3.id }));
  ok(r.status === 400 && P.listPasskeys(u3.id).length === 1, "khóa là cách đăng nhập duy nhất: không cho xóa", j);
  ({ r, j } = await api(sess, { op: "delete", id: dev.id }));
  ok(r.status === 200 && j.passkeys.length === 0 && lastAudit("passkey_removed"), "xóa khóa", j);
  ({ j } = await api("", { op: "login-options" }));
  ({ r } = await api("", { op: "login", response: dev.assert(j) }));
  ok(r.status === 401, "khóa đã xóa không đăng nhập được nữa", r.status);

  // ---- tài khoản bị khóa, email chưa xác minh ----
  ({ j } = await api("", { op: "login-options" }));
  AS.db().prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(u3.id);
  ({ r } = await api("", { op: "login", response: dev3.assert(j) }));
  ok(r.status === 403, "tài khoản bị khóa: không đăng nhập bằng khóa được", r.status);
  const u4 = AS.createUser({ email: "pk4@synchro.test", name: "PK4", verified: false, passwordHash: await AS.hashPassword(PW) });
  const s4 = AS.createSession(u4, req("/"), "password").split(";")[0];
  ({ r } = await api(s4, { op: "reg-options" }));
  ok(r.status === 403, "email chưa xác minh: chưa thêm khóa được", r.status);
  ok((await R.POST(req("/api/auth/passkey", "", { op: "login-options" }, "https://evil.example"))).status === 403, "yêu cầu từ trang khác (CSRF): từ chối");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
