// Khóa truy cập trên bản www của APP_URL (và các tên miền con thêm bằng SYNCHRO_ALLOWED_ORIGINS): sameOrigin đã nhận các trang đó, nên
// đăng ký / đăng nhập / xác minh lại bằng khóa ở đó cũng phải qua được (clientDataJSON.origin là https://www.…), rpID vẫn là tên miền gốc.
// Trang ngoài tên miền, hoặc http, vẫn bị từ chối. Tự chạy được, không cần máy chủ (loadTs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { authenticator } from "../lib/fake-passkey.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-pk-origins-"));
const APEX = "https://synchro.example", WWW = "https://www.synchro.example";
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "pk-origins-test"; process.env.SYNCHRO_RELAX_LIMITS = "1"; process.env.APP_URL = APEX;
process.env.SYNCHRO_ALLOWED_ORIGINS = "app.synchro.example, https://khac.example, evilsynchro.example";
const { authstore: AS, passkeys: P, "api/auth/passkey/route": R } = await loadTs(["authstore", "passkeys", "api/auth/passkey/route"]);
const req = (site, p, cookie, body) => new Request(site + p, { method: body ? "POST" : "GET", headers: { origin: site, host: new URL(site).host, "content-type": "application/json", cookie: cookie ?? "", "user-agent": "t", "x-forwarded-for": "7.7.7.7" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const api = async (site, cookie, body) => { const r = await R.POST(req(site, "/api/auth/passkey", cookie, body)); return { r, j: await r.json(), ck: cookies(r) }; };

try {
  console.log("1. Danh sách nguồn gốc được nhận");
  {
    const rp = P.relyingParty(req(WWW, "/"));
    ok(rp.rpID === "synchro.example", "rpID vẫn là tên miền gốc, kể cả khi yêu cầu đến từ www", rp);
    ok(JSON.stringify([...rp.origins].sort()) === JSON.stringify(["https://app.synchro.example", "https://synchro.example", "https://www.synchro.example"]), "APP_URL + bản www + tên miền con trong SYNCHRO_ALLOWED_ORIGINS; bỏ tên miền khác", rp.origins);
  }

  const u = AS.createUser({ email: "pko@synchro.test", name: "PKO", verified: true });
  const sess = AS.createSession(u, req(WWW, "/"), "google").split(";")[0];
  const dev = authenticator({ origin: WWW, rpId: "synchro.example" });

  console.log("2. Đăng ký khóa trên www");
  {
    let { r, j } = await api(WWW, sess, { op: "reg-options" });
    ok(r.status === 200 && j.rp?.id === "synchro.example", "tùy chọn đăng ký trên www: rpID là tên miền gốc", j);
    ({ r, j } = await api(WWW, sess, { op: "register", response: dev.register(j) }));
    ok(r.status === 200 && j.passkeys?.length === 1, "clientDataJSON.origin = https://www.… → thêm được khóa", j);
    // Trang ngoài tên miền / http: vẫn từ chối dù chữ ký đúng.
    ({ j } = await api(WWW, sess, { op: "reg-options" }));
    ({ r } = await api(WWW, sess, { op: "register", response: authenticator({ origin: "https://khac.example", rpId: "synchro.example" }).register(j) }));
    ok(r.status === 400, "nguồn gốc ngoài tên miền (dù có trong SYNCHRO_ALLOWED_ORIGINS): từ chối", r.status);
    ({ j } = await api(WWW, sess, { op: "reg-options" }));
    ({ r } = await api(WWW, sess, { op: "register", response: authenticator({ origin: "http://www.synchro.example", rpId: "synchro.example" }).register(j) }));
    ok(r.status === 400 && P.listPasskeys(u.id).length === 1, "http (không phải https): từ chối", r.status);
  }

  console.log("3. Đăng nhập và xác minh lại bằng khóa trên www");
  {
    let { r, j, ck } = await api(WWW, "", { op: "login-options" });
    ok(r.status === 200 && j.rpId === "synchro.example", "tùy chọn đăng nhập trên www", j);
    ({ r, j, ck } = await api(WWW, "", { op: "login", response: dev.assert(j) }));
    ok(r.status === 200 && j.user?.id === u.id && ck.some((c) => c.startsWith("synchro_session=")), "đăng nhập bằng khóa trên www", j);
    // Cùng khóa đó trên tên miền gốc và trên tên miền con được thêm.
    ({ j } = await api(APEX, "", { op: "login-options" }));
    ({ r } = await api(APEX, "", { op: "login", response: dev.assert(j, { origin: APEX }) }));
    ok(r.status === 200, "cùng khóa đăng nhập được trên tên miền gốc", r.status);
    ({ j } = await api(WWW, "", { op: "login-options" }));
    ({ r } = await api(WWW, "", { op: "login", response: dev.assert(j, { origin: "https://evilsynchro.example" }) }));
    ok(r.status === 401, "tên máy chỉ trùng phần đuôi chữ (evilsynchro.example): từ chối", r.status);
    // Xác minh lại (step-up) trên www.
    ({ r, j } = await api(WWW, sess, { op: "reauth-options" }));
    ok(r.status === 200 && j.rpId === "synchro.example", "thử thách xác minh lại trên www", j);
    ({ r, j } = await api(WWW, sess, { op: "reauth", response: dev.assert(j) }));
    ok(r.status === 200 && j.ok === true, "xác minh lại bằng khóa trên www", j);
  }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
