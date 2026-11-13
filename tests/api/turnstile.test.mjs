// Cloudflare Turnstile và chặn email dùng một lần. Chưa dán khóa: không gì thay đổi. Dán khóa: đăng ký cần mã, đăng nhập cần mã sau N lần sai,
// xin đặt lại mật khẩu khi chưa đăng nhập cần mã; mã sai / đã dùng / sai hành động / sai tên miền bị từ chối; khóa bí mật mã hóa, không ra trình duyệt.
// siteverify giả chạy ngay trong bài (TURNSTILE_VERIFY_URL). Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-turnstile-"));
const B = "http://localhost:3200";

// ---- siteverify giả ----
const seen = [];
let down = false;
const used = new Set();
const sv = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d)).on("end", () => {
    if (down) { req.socket.destroy(); return; }
    const f = new URLSearchParams(raw), token = f.get("response");
    seen.push({ secret: f.get("secret"), token, remoteip: f.get("remoteip"), idem: f.get("idempotency_key") });
    const [action, hostname] = String(token).split(":");
    const success = f.get("secret") === "0x4AAAAAAATestSecretKey_abc" && token !== "bad" && !used.has(token);
    if (success) used.add(token);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(success ? { success, action, hostname } : { success: false, "error-codes": [used.has(token) ? "timeout-or-duplicate" : "invalid-input-response"] }));
  });
});
await new Promise((r) => sv.listen(0, "127.0.0.1", r));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "turnstile-test"; process.env.SYNCHRO_RELAX_LIMITS = "1"; process.env.APP_URL = B;
process.env.ADMIN_EMAILS = "boss@synchro.test"; process.env.TURNSTILE_VERIFY_URL = `http://127.0.0.1:${sv.address().port}/turnstile/v0/siteverify`;
const { authstore: AS, turnstile: T, "api/auth/signup/route": SU, "api/auth/login/route": L, "api/auth/forgot/route": F, "api/auth/me/route": ME, "api/admin/settings/route": AD, "api/admin/route": ADG } =
  await loadTs(["authstore", "turnstile", "api/auth/signup/route", "api/auth/login/route", "api/auth/forgot/route", "api/auth/me/route", "api/admin/settings/route", "api/admin/route"]);
let ipN = 0;
const req = (p, body, { cookie = "", ip = "7.7.7.7", method } = {}) => new Request(B + p, { method: method ?? (body ? "POST" : "GET"), headers: { origin: B, host: "localhost:3200", "content-type": "application/json", cookie, "user-agent": "t", "x-forwarded-for": ip }, ...(body ? { body: JSON.stringify(body) } : {}) });
const j = async (r) => ({ s: r.status, j: await r.json() });
const profile = { fullName: "Người Thử", birthDate: "2000-01-01" };
const signup = (email, turnstile, ip) => SU.POST(req("/api/auth/signup", { email, password: "Mat-khau-dung-123", profile, turnstile }, { ip: ip ?? `9.9.9.${++ipN}` })).then(j);
const PW = "Mat-khau-dung-123";
try {
  const boss = AS.createUser({ email: "boss@synchro.test", name: "Boss", verified: true, passwordHash: await AS.hashPassword(PW) });
  const bossCk = AS.createSession(boss, req("/"), "password").split(";")[0];
  const u = AS.createUser({ email: "user@synchro.test", name: "U", verified: true, passwordHash: await AS.hashPassword(PW) });

  console.log("1. Chưa dán khóa: không gì thay đổi");
  ok(T.turnstileSiteKey() === null && T.turnstileOn() === false, "Turnstile tắt");
  let r = await j(await ME.GET(req("/api/auth/me")));
  ok(r.j.turnstile === null, "/api/auth/me không có khóa site", r.j);
  r = await signup("free1@synchro.test");
  ok(r.s === 200 && r.j.user, "đăng ký không cần mã", r);
  for (let i = 0; i < 6; i++) await L.POST(req("/api/auth/login", { email: u.email, password: "sai-mat-khau" }, { ip: "8.8.8.1" }));
  r = await j(await L.POST(req("/api/auth/login", { email: u.email, password: PW }, { ip: "8.8.8.1" })));
  ok(r.s === 200 && r.j.user && !r.j.captcha, "sai mật khẩu nhiều lần rồi đúng: vẫn đăng nhập, không hỏi mã", r);
  r = await j(await F.POST(req("/api/auth/forgot", { email: u.email })));
  ok(r.s === 200, "quên mật khẩu không cần mã", r);
  ok(seen.length === 0, "không gọi Cloudflare lần nào", seen);

  console.log("2. Email dùng một lần");
  ok(T.isDisposable("a@mailinator.com") && T.isDisposable("a@x.mailinator.com") && !T.isDisposable("a@gmail.com") && !T.isDisposable("a@synchro.test"), "nhận ra tên miền và tên miền con");
  r = await signup("rac@mailinator.com");
  ok(r.s === 400 && r.j.error === T.DISPOSABLE && !AS.findByEmail("rac@mailinator.com"), "đăng ký bằng email dùng một lần: từ chối, không tạo tài khoản", r);
  r = await j(await AD.PATCH(req("/api/admin/settings", { blockDisposable: false }, { cookie: bossCk, method: "PATCH" })));
  ok(r.s === 200 && r.j.settings.turnstile.blockDisposable === false, "quản trị viên tắt được", r);
  r = await signup("rac2@mailinator.com");
  ok(r.s === 200 && r.j.user, "tắt rồi: đăng ký được", r);
  await AD.PATCH(req("/api/admin/settings", { blockDisposable: true }, { cookie: bossCk, method: "PATCH" }));
  ok((await AD.PATCH(req("/api/admin/settings", { blockDisposable: false }, { cookie: AS.createSession(u, req("/"), "password").split(";")[0], method: "PATCH" }))).status === 403, "người thường không đổi được");

  console.log("3. Dán khóa");
  r = await j(await AD.PATCH(req("/api/admin/settings", { turnstile: { siteKey: "bad key!", secret: "x" } }, { cookie: bossCk, method: "PATCH" })));
  ok(r.s === 400 && !T.turnstileOn(), "khóa sai dạng: từ chối", r);
  r = await j(await AD.PATCH(req("/api/admin/settings", { turnstile: { siteKey: "0x4AAAAAAATestSiteKey", secret: "0x4AAAAAAATestSecretKey_abc", loginAfter: 3 } }, { cookie: bossCk, method: "PATCH" })));
  ok(r.s === 200 && r.j.settings.turnstile.on && r.j.settings.turnstile.hasSecret && !JSON.stringify(r.j).includes("TestSecretKey"), "lưu được, trả về không có khóa bí mật", r);
  const raw = AS.getSetting("turnstile", "");
  ok(!raw.includes("TestSecretKey") && raw.includes("0x4AAAAAAATestSiteKey"), "khóa bí mật mã hóa trong cơ sở dữ liệu", raw);
  r = await j(await ADG.GET(req("/api/admin", undefined, { cookie: bossCk })));
  ok(r.j.settings.turnstile?.siteKey === "0x4AAAAAAATestSiteKey" && !JSON.stringify(r.j).includes("TestSecretKey"), "trang quản trị thấy khóa site, không thấy khóa bí mật", r.j.settings);
  r = await j(await ME.GET(req("/api/auth/me")));
  ok(r.j.turnstile === "0x4AAAAAAATestSiteKey" && !JSON.stringify(r.j).includes("Secret"), "/api/auth/me trả khóa site cho trang đăng nhập", r.j);
  ok(AS.adminAudit(5).some((a) => a.action === "admin_turnstile_on"), "nhật ký: bật chống bot");
  r = await j(await AD.PATCH(req("/api/admin/settings", { turnstile: { siteKey: "0x4AAAAAAATestSiteKey", secret: "" } }, { cookie: bossCk, method: "PATCH" })));
  ok(r.j.settings.turnstile.hasSecret && T.turnstileOn(), "lưu lại với ô khóa bí mật trống: giữ khóa cũ", r.j.settings.turnstile);

  console.log("4. Đăng ký cần mã");
  r = await signup("s1@synchro.test");
  ok(r.s === 400 && r.j.captcha === true && !AS.findByEmail("s1@synchro.test"), "không có mã: từ chối, báo hiện ô kiểm tra", r);
  r = await signup("s1@synchro.test", "bad");
  ok(r.s === 400 && r.j.captcha === true, "mã sai: từ chối", r);
  r = await signup("s1@synchro.test", "signup:localhost:aaa", "4.4.4.4");
  ok(r.s === 200 && r.j.user?.email === "s1@synchro.test", "mã đúng: đăng ký được", r);
  ok(seen.at(-1).secret === "0x4AAAAAAATestSecretKey_abc" && seen.at(-1).remoteip === "4.4.4.4" && seen.at(-1).idem, "gửi Cloudflare khóa bí mật đã giải mã, IP người dùng, khóa chống lặp", seen.at(-1));
  r = await signup("s2@synchro.test", "signup:localhost:aaa");
  ok(r.s === 400 && r.j.captcha, "mã đã dùng: từ chối", r);
  r = await signup("s2@synchro.test", "login:localhost:bbb");
  ok(r.s === 400 && r.j.captcha, "mã lấy cho đăng nhập không dùng để đăng ký được", r);
  r = await signup("s2@synchro.test", "signup:evil.example:ccc");
  ok(r.s === 400 && r.j.captcha, "mã lấy ở tên miền khác: từ chối", r);
  r = await signup("rac3@mailinator.com", "signup:localhost:ddd");
  ok(r.s === 400 && r.j.error === T.DISPOSABLE, "có mã vẫn chặn email dùng một lần", r);

  console.log("5. Đăng nhập: hỏi mã sau 3 lần sai");
  const login = (password, turnstile, ip = "5.5.5.5") => L.POST(req("/api/auth/login", { email: u.email, password, turnstile }, { ip })).then(j);
  r = await login("sai-1"); ok(r.s === 401 && !r.j.captcha, "lần sai 1: chưa hỏi", r);
  r = await login("sai-2"); ok(r.s === 401 && !r.j.captcha, "lần sai 2: chưa hỏi", r);
  r = await login("sai-3"); ok(r.s === 401 && r.j.captcha === true, "lần sai 3: báo cần ô kiểm tra cho lần sau", r);
  r = await login(PW); ok(r.s === 400 && r.j.captcha && !r.j.user, "mật khẩu đúng nhưng không có mã: chưa cho vào", r);
  r = await login(PW, "login:localhost:e1"); ok(r.s === 200 && r.j.user?.id === u.id, "có mã: đăng nhập được", r);
  // Email này đã bị nhập sai 9 lần (6 lần ở mục 1 + 3 lần trên) từ nhiều IP: dò mật khẩu phân tán, IP nào cũng phải qua ô kiểm tra.
  r = await login(PW, undefined, "5.5.5.6"); ok(r.s === 400 && r.j.captcha, "email bị sai từ 3N lần trở lên (nhiều IP): IP mới cũng phải qua ô kiểm tra", r);
  const u2 = AS.createUser({ email: "user2@synchro.test", name: "U2", verified: true, passwordHash: await AS.hashPassword(PW) });
  r = await j(await L.POST(req("/api/auth/login", { email: u2.email, password: PW }, { ip: "5.5.5.7" })));
  ok(r.s === 200 && r.j.user, "tài khoản khác, IP chưa sai lần nào: không hỏi", r);

  console.log("6. Quên mật khẩu");
  r = await j(await F.POST(req("/api/auth/forgot", { email: u.email })));
  ok(r.s === 400 && r.j.captcha, "chưa đăng nhập, không có mã: từ chối", r);
  r = await j(await F.POST(req("/api/auth/forgot", { email: "khong-co@synchro.test", turnstile: "reset:localhost:f1" })));
  ok(r.s === 200 && r.j.ok, "có mã: trả lời như thường (không lộ email có tài khoản hay không)", r);
  const uCk = AS.createSession(u, req("/"), "password").split(";")[0];
  r = await j(await F.POST(req("/api/auth/forgot", { email: u.email }, { cookie: uCk })));
  ok(r.s === 200, "chủ tài khoản xin từ Cài đặt: không hỏi mã", r);

  console.log("7. Cloudflare không trả lời: đăng ký và đặt lại mật khẩu từ chối, đăng nhập vẫn cho qua");
  down = true;
  r = await signup("s5@synchro.test", "signup:localhost:g1");
  ok(r.s === 503 && r.j.error === T.VERIFY_DOWN && r.j.captcha === true && !AS.findByEmail("s5@synchro.test"), "đăng ký: từ chối, báo thử lại sau, không tạo tài khoản", r);
  r = await j(await F.POST(req("/api/auth/forgot", { email: u.email, turnstile: "reset:localhost:g2" })));
  ok(r.s === 503 && r.j.error === T.VERIFY_DOWN, "xin đặt lại mật khẩu khi chưa đăng nhập: từ chối", r);
  r = await j(await F.POST(req("/api/auth/forgot", { email: u.email }, { cookie: uCk })));
  ok(r.s === 200, "chủ tài khoản xin từ Cài đặt (không hỏi mã): vẫn được", r);
  r = await login(PW, "login:localhost:g3");
  ok(r.s === 200 && r.j.user?.id === u.id, "đăng nhập cần mã (sau nhiều lần sai): vẫn cho qua", r);
  down = false;
  r = await signup("s5@synchro.test", "signup:localhost:g4");
  ok(r.s === 200 && r.j.user?.email === "s5@synchro.test", "Cloudflare trả lời lại: đăng ký được", r);
  const { VI2EN } = (await loadTs(["i18n-dict"]))["i18n-dict"];
  ok(typeof VI2EN[T.VERIFY_DOWN] === "string" && /try again/i.test(VI2EN[T.VERIFY_DOWN]), "thông báo có bản tiếng Anh", VI2EN[T.VERIFY_DOWN]);

  console.log("8. Tắt");
  r = await j(await AD.PATCH(req("/api/admin/settings", { turnstile: { clear: true } }, { cookie: bossCk, method: "PATCH" })));
  ok(r.s === 200 && !r.j.settings.turnstile.on && !T.turnstileOn() && T.turnstileSiteKey() === null, "xóa khóa: tắt hẳn", r.j.settings?.turnstile);
  r = await signup("s6@synchro.test");
  ok(r.s === 200, "tắt rồi: đăng ký không cần mã", r);

  console.log("9. CSP chỉ cho Cloudflare ở trang chưa đăng nhập");
  const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
  const out = ts.transpileModule(fs.readFileSync("next.config.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(tmp, "next.config.mjs"); fs.writeFileSync(f, out);
  const hs = await (await import(f)).default.headers();
  const csp = (h) => h.headers.find((x) => x.key === "Content-Security-Policy-Report-Only")?.value ?? "";
  const pages = hs.filter((h) => csp(h));
  ok(pages.some((h) => !h.missing && !csp(h).includes("challenges.cloudflare.com") && h.source.includes("api/")), "trang đã đăng nhập: không có Cloudflare", pages.map((h) => h.source));
  ok(pages.some((h) => h.missing?.[0]?.key === "synchro_session" && csp(h).includes("https://challenges.cloudflare.com")), "chưa có cookie phiên: cho Cloudflare", pages.map((h) => [h.source, h.missing]));
  ok(pages.some((h) => h.source === "/reset" && csp(h).includes("https://challenges.cloudflare.com")), "trang quên mật khẩu: cho Cloudflare");
  ok(hs.findIndex((h) => h.missing) > hs.findIndex((h) => csp(h) && !h.missing), "luật cho Cloudflare đứng sau (đè luật chung)");
} finally { sv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
