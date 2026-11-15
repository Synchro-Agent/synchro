// Đăng ký (blueprint F2.4): email mới và email đã có tài khoản nhận cùng một câu trả lời "Hãy kiểm tra email" ({ pending: true }), cùng mã,
// không cookie phiên. Email đã có: không đổi gì ở tài khoản cũ, chủ email nhận thư "email này đã có tài khoản" (tiếng Việt hoặc tiếng Anh
// theo ngôn ngữ người gửi). Email mới: tạo tài khoản chưa xác minh, gửi thư xác minh; trước khi bấm thư, đăng nhập bằng mật khẩu vừa đặt trả
// lời y như sai mật khẩu, nên "đăng ký rồi đăng nhập thử" không dò được email nào đã đăng ký. Email dành riêng cho quản trị viên trả lời y hệt.
// Tự chạy được, không cần dev:mock (thư ghi ra tệp qua MAIL_CAPTURE_DIR).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { readAuthStore } from "../lib/srcroots.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-taken-"));
const MAIL = path.join(tmp, "mail");
const B = "http://localhost:3200";
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "taken-test"; process.env.SYNCHRO_RELAX_LIMITS = "1"; process.env.APP_URL = B;
process.env.MAIL_CAPTURE_DIR = MAIL; process.env.ADMIN_EMAILS = "boss@taken.test";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = (to) => { try { return fs.readdirSync(MAIL).sort().map((f) => JSON.parse(fs.readFileSync(path.join(MAIL, f), "utf8"))).filter((m) => m.to === to); } catch { return []; } };
const waitMail = async (to, n) => { for (let i = 0; i < 40 && mails(to).length < n; i++) await sleep(50); return mails(to); };
try {
  const { authstore: AS, mailtpl: T, introflag: IF, "api/auth/signup/route": SU, "api/auth/login/route": LG } = await loadTs(["authstore", "mailtpl", "introflag", "api/auth/signup/route", "api/auth/login/route"]);
  let ipN = 0;
  const signup = async (email, { lang, acceptLang = "vi-VN", password = "Mat-khau-moi-456" } = {}) => {
    const r = await SU.POST(new Request(B + "/api/auth/signup", { method: "POST", headers: { origin: B, host: "localhost:3200", "content-type": "application/json", "user-agent": "t", "accept-language": acceptLang, "x-forwarded-for": `6.6.6.${++ipN}` }, body: JSON.stringify({ email, password, profile: { fullName: "Người Lạ", birthDate: "2000-01-01" }, ...(lang ? { lang } : {}) }) }));
    return { s: r.status, j: await r.json(), cookie: (r.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("synchro_session=")), setCookies: (r.headers.getSetCookie?.() ?? []).length };
  };
  const login = async (email, password) => {
    const r = await LG.POST(new Request(B + "/api/auth/login", { method: "POST", headers: { origin: B, host: "localhost:3200", "content-type": "application/json", "user-agent": "t", "x-forwarded-for": `6.6.7.${++ipN}` }, body: JSON.stringify({ email, password }) }));
    return { s: r.status, j: await r.json(), cookie: (r.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("synchro_session=")) };
  };

  console.log("1. Mẫu thư hai thứ tiếng");
  const vi = T.signupTakenMail({ base: B, url: `${B}/reset`, lang: "vi" }), en = T.signupTakenMail({ base: B, url: `${B}/reset`, lang: "en" });
  ok(/đã có tài khoản/.test(vi.subject) && vi.text.includes(`${B}/reset`) && vi.html.includes(`${B}/reset`), "tiếng Việt: tiêu đề, đường đặt lại mật khẩu ở cả HTML và chữ thuần", vi.subject);
  ok(/already has a Synchro account/.test(en.subject) && en.text.includes(`${B}/reset`), "tiếng Anh: tiêu đề và đường đặt lại mật khẩu", en.subject);
  ok(!/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(en.subject + en.text), "bản tiếng Anh không sót tiếng Việt", en.text);

  console.log("2. Email đã có tài khoản");
  const PW = "Mat-khau-cu-123";
  const u = AS.createUser({ email: "co-roi@taken.test", name: "Chủ", verified: true, passwordHash: await AS.hashPassword(PW) });
  let r = await signup("co-roi@taken.test", { lang: "vi" });
  ok(r.s === 200 && r.j.pending === true && !r.j.user && !r.cookie && Object.keys(r.j).join() === "pending", "trả { pending: true } (Hãy kiểm tra email), không có phiên, không lộ gì thêm", r);
  const cur = AS.findByEmail("co-roi@taken.test");
  ok(cur?.id === u.id && cur.password_hash === u.password_hash && cur.name === "Chủ" && cur.status === "active", "tài khoản cũ giữ nguyên, mật khẩu không đổi", cur);
  let m = await waitMail("co-roi@taken.test", 1);
  ok(m.length === 1 && /đã có tài khoản/.test(m[0].subject) && m[0].text.includes("/reset"), "chủ email nhận thư tiếng Việt \"email này đã có tài khoản\"", m.map((x) => x.subject));
  r = await signup("CO-ROI@taken.test", { acceptLang: "en-US" });
  ok(r.s === 200 && r.j.pending === true && !r.cookie, "viết hoa khác vẫn nhận ra, trả như trên", r);
  m = await waitMail("co-roi@taken.test", 2);
  ok(m.length === 2 && /already has a Synchro account/.test(m[1].subject), "trình duyệt tiếng Anh: thư tiếng Anh", m.map((x) => x.subject));
  ok(AS.adminAudit(20).some((a) => a.action === "signup_email_taken"), "ghi nhật ký bảo mật");

  console.log("3. Email dành riêng cho quản trị viên: trả lời y hệt");
  r = await signup("boss@taken.test", { lang: "en" });
  ok(r.s === 200 && r.j.pending === true && !r.cookie && !AS.findByEmail("boss@taken.test"), "không tạo tài khoản, cùng câu trả lời", r);

  console.log("4. Email mới: cùng câu trả lời, tài khoản được tạo, chưa đăng nhập được trước khi bấm thư");
  const takenR = await signup("co-roi@taken.test", { lang: "vi" });
  r = await signup("moi@taken.test", { lang: "vi" });
  ok(r.s === 200 && Object.keys(r.j).join() === "pending" && r.j.pending === true && !r.cookie && r.setCookies === 0, "email mới: chỉ { pending: true }, không cookie nào", r);
  ok(r.s === takenR.s && JSON.stringify(r.j) === JSON.stringify(takenR.j) && r.cookie === takenR.cookie && r.setCookies === takenR.setCookies, "email mới và email đã có: cùng mã, cùng thân, cùng (không) cookie", [r, takenR]);
  let nu = AS.findByEmail("moi@taken.test");
  ok(!!nu && nu.email_verified === 0 && nu.status === "active" && AS.needsVerify(nu) && AS.verifyLocked(nu), "tài khoản mới đã tạo, chưa xác minh", nu);
  ok(!AS.sessionsOf(nu?.id ?? "").length, "đăng ký không tạo phiên đăng nhập nào", AS.sessionsOf(nu?.id ?? "").length);
  m = await waitMail("moi@taken.test", 1);
  ok(m.length === 1 && !/đã có tài khoản|already has/.test(m[0].subject) && /verify#[\w-]+/.test(m[0].text), "nhận thư xác minh có đường dẫn, không phải thư \"đã có tài khoản\"", m.map((x) => x.subject));
  // Cách dò "đăng ký email X với mật khẩu P rồi đăng nhập bằng P": trước đây 200 với email mới, 401 với email đã có.
  const probeNew = await login("moi@taken.test", "Mat-khau-moi-456"), probeOld = await login("co-roi@taken.test", "Mat-khau-moi-456");
  const wrongNew = await login("moi@taken.test", "Sai-mat-khau-999"), none = await login("khong-co@taken.test", "Mat-khau-moi-456");
  ok(probeNew.s === 401 && !probeNew.cookie, "email mới, mật khẩu vừa đặt, chưa bấm thư: 401, không phiên", probeNew);
  ok(probeNew.s === probeOld.s && JSON.stringify(probeNew.j) === JSON.stringify(probeOld.j) && probeNew.cookie === probeOld.cookie, "đăng ký rồi đăng nhập thử: email mới và email đã có trả lời y hệt", [probeNew, probeOld]);
  ok(JSON.stringify(wrongNew.j) === JSON.stringify(probeNew.j) && JSON.stringify(none.j) === JSON.stringify(probeNew.j), "mật khẩu đúng, sai, hay không có tài khoản: cùng một câu", [wrongNew.j, none.j]);
  ok(/thư xác minh/.test(probeNew.j.error ?? ""), "câu báo nhắc người vừa đăng ký mở thư xác minh trước", probeNew.j);
  nu = AS.findByEmail("moi@taken.test");
  ok(nu.last_login_at === null && !AS.sessionsOf(nu.id).length, "vẫn chưa có phiên nào");
  ok(AS.adminAudit(30).some((a) => a.action === "login_failed" && a.detail === "email_unverified"), "nhật ký bảo mật ghi rõ lý do (chỉ quản trị viên thấy)");
  const tok = /verify#([\w-]+)/.exec(m[0].text)?.[1];
  AS.confirmVerify(new Request(B + "/api/auth/verify", { method: "POST", headers: { origin: B, "x-forwarded-for": "6.6.8.1" } }), tok);
  ok(AS.findByEmail("moi@taken.test").email_verified === 1 && !AS.sessionsOf(nu.id).length, "bấm đường dẫn: đã xác minh, không tự tạo phiên (chủ email không vào nhầm tài khoản người khác lập sẵn)");
  const lg = await login("moi@taken.test", "Mat-khau-moi-456");
  ok(lg.s === 200 && lg.j.user?.email === "moi@taken.test" && lg.cookie && lg.j.user.verifyPending === false, "xác minh xong: đăng nhập bằng mật khẩu vừa đặt", lg);
  ok(lg.j.firstLogin === true, "lần đăng nhập đầu: máy chủ báo firstLogin", lg.j);
  ok((await login("moi@taken.test", "Mat-khau-moi-456")).j.firstLogin === undefined, "đăng nhập lần sau: không còn firstLogin");
  ok((await login("co-roi@taken.test", "Mat-khau-moi-456")).s === 401, "đăng ký trùng không đổi mật khẩu tài khoản cũ");
  // Tài khoản chưa xác minh nhưng đã từng đăng nhập (trước khi có luật này, hay lúc yêu cầu xác minh đang tắt): vẫn đăng nhập như cũ.
  const old = AS.createUser({ email: "cu-chua-xm@taken.test", name: "Cũ", verified: false, passwordHash: await AS.hashPassword(PW) });
  AS.db().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now() - 86400_000, old.id);
  ok((await login("cu-chua-xm@taken.test", PW)).s === 200, "tài khoản chưa xác minh đã từng đăng nhập: không bị khóa ngoài");
  // Quản trị viên tắt yêu cầu xác minh (thư không gửi được): người mới đăng nhập ngay, đổi lại cách dò trên dùng lại được (ghi ở authstore.signup).
  AS.setVerifyGate(false);
  try {
    await signup("tat-xm@taken.test", { lang: "vi" });
    ok((await login("tat-xm@taken.test", "Mat-khau-moi-456")).s === 200, "yêu cầu xác minh tắt: đăng nhập ngay được, không ai bị kẹt ngoài");
  } finally { AS.setVerifyGate(true); }
  // Giới hạn chỉ riêng đường "email đã có" sẽ thành dấu hiệu dò (429 chỉ với email đã đăng ký): chỉ còn giới hạn chung theo IP.
  const src = readAuthStore();
  ok(!/limit\("signup-taken:"/.test(src) && /limit\("signup:" \+ ip/.test(src), "không có giới hạn riêng cho email đã có tài khoản, giới hạn chung theo IP còn nguyên");

  console.log("5. Phim giới thiệu: lần đăng nhập đầu, dù đăng ký từ hôm trước");
  // Mở thư xác minh hôm sau rồi mới đăng nhập: tài khoản đã hơn 24 giờ, chưa từng đăng nhập, chưa xem phim.
  const late = AS.createUser({ email: "hom-sau@taken.test", name: "Hôm sau", verified: true, passwordHash: await AS.hashPassword(PW) });
  AS.db().prepare("UPDATE users SET created_at = ? WHERE id = ?").run(Date.now() - 25 * 3600_000, late.id);
  const lt = await login("hom-sau@taken.test", PW);
  ok(lt.s === 200 && lt.j.firstLogin === true, "tài khoản tạo 25 giờ trước, lần đầu đăng nhập: firstLogin", lt.j);
  const kind = IF.firstKind("login", lt.j.firstLogin);
  ok(kind === "signup" && IF.wantsIntro(lt.j.user, kind) === true, "lần đăng nhập đầu tính như vừa đăng ký: phát phim", [kind, lt.j.user?.createdAt]);
  const again = await login("hom-sau@taken.test", PW);
  ok(IF.wantsIntro(again.j.user, IF.firstKind("login", again.j.firstLogin)) === false, "đăng nhập lại: không phát phim");
  const now = Date.now();
  ok(IF.wantsIntro({ id: "a", createdAt: now - 60_000 }, "login") === false, "đăng nhập lại tài khoản mới tạo (đã đăng nhập trước đó): không phát phim");
  ok(IF.firstKind("profile", true) === "profile" && IF.firstKind("login", undefined) === "login", "chỉ đăng nhập bằng mật khẩu lần đầu mới đổi");
  ok(IF.wantsIntro({ id: "c", createdAt: now - 3 * 3600_000 }, "profile") === false && IF.wantsIntro({ id: "d", createdAt: now }, "profile") === true, "bước hồ sơ (Google…) giữ như cũ");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
