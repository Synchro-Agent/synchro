// Đăng ký bằng email đã có tài khoản (blueprint F2.4): trả "Hãy kiểm tra email" ({ pending: true }), không có phiên, không đổi gì ở
// tài khoản cũ, và gửi tới chính địa chỉ đó thư "email này đã có tài khoản" bằng tiếng Việt hoặc tiếng Anh theo ngôn ngữ người gửi.
// Email dành riêng cho quản trị viên trả lời y hệt. Tự chạy được, không cần dev:mock (thư ghi ra tệp qua MAIL_CAPTURE_DIR).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

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
  const { authstore: AS, mailtpl: T, "api/auth/signup/route": SU } = await loadTs(["authstore", "mailtpl", "api/auth/signup/route"]);
  let ipN = 0;
  const signup = async (email, { lang, acceptLang = "vi-VN", password = "Mat-khau-moi-456" } = {}) => {
    const r = await SU.POST(new Request(B + "/api/auth/signup", { method: "POST", headers: { origin: B, host: "localhost:3200", "content-type": "application/json", "user-agent": "t", "accept-language": acceptLang, "x-forwarded-for": `6.6.6.${++ipN}` }, body: JSON.stringify({ email, password, profile: { fullName: "Người Lạ", birthDate: "2000-01-01" }, ...(lang ? { lang } : {}) }) }));
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

  console.log("4. Email mới vẫn đăng ký được");
  r = await signup("moi@taken.test", { lang: "vi" });
  ok(r.s === 200 && r.j.user?.email === "moi@taken.test" && r.cookie, "tạo tài khoản và đăng nhập", r);
  m = await waitMail("moi@taken.test", 1);
  ok(m.length === 1 && !/đã có tài khoản|already has/.test(m[0].subject), "nhận thư xác minh, không phải thư \"đã có tài khoản\"", m.map((x) => x.subject));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
