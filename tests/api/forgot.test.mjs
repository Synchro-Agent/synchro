// Quên mật khẩu: gửi đường dẫn qua email (bản giả lập ghi thư ra data-mock/mail), đường dẫn dùng một lần, đăng xuất mọi thiết bị, không lộ email nào có tài khoản.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
const B = "http://localhost:3200", MAIL = path.resolve("data-mock/mail");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const mails = (to) => { try { return fs.readdirSync(MAIL).sort().map((f) => JSON.parse(fs.readFileSync(path.join(MAIL, f), "utf8"))).filter((m) => m.to === to); } catch { return []; } };

console.log("1. Mẫu thư");
const { mailtpl: T } = await loadTs(["mailtpl"]);
const m = T.resetMail({ base: "https://x.test", name: "<b>An</b>", url: "https://x.test/reset#abc", minutes: 60, lang: "vi" });
ok(m.subject === "Đặt lại mật khẩu Synchro" && m.html.includes('href="https://x.test/reset#abc"') && m.text.includes("https://x.test/reset#abc"), "thư có đường dẫn ở cả HTML và chữ thuần");
ok(m.html.includes("&lt;b&gt;An&lt;/b&gt;") && !m.html.includes("<b>An</b>"), "tên người dùng được thoát ký tự HTML");
ok(!/script|<style/i.test(m.html), "không dùng script, style riêng");
const en = T.resetMail({ base: "https://x.test", url: "https://x.test/reset#abc", minutes: 60, lang: "en" });
ok(en.subject === "Reset your Synchro password" && !/[ặảấ]/.test(en.html), "bản tiếng Anh không sót tiếng Việt");
ok(T.changedMail({ base: "https://x.test", when: "10:00", lang: "vi" }).html.includes("10:00"), "thư báo đã đổi mật khẩu có thời điểm");

console.log("2. Luồng đặt lại");
const email = `forgot-${Date.now()}@synchro.test`, a = client(), other = client();
let r = await a("POST", "/api/auth/signup", { email, password: "Forgot-pass-123", profile: { fullName: "Quên Mật Khẩu", birthDate: "2000-01-01" } });
ok(r.s === 200, "tạo tài khoản thử", JSON.stringify(r.j));
await a("POST", "/api/auth/login", { email, password: "Forgot-pass-123" });
r = await a("GET", "/api/auth/me"); ok(r.j?.user?.email === email, "đang đăng nhập");

const none = await other("POST", "/api/auth/forgot", { email: `khong-co-${Date.now()}@synchro.test` });
r = await other("POST", "/api/auth/forgot", { email, lang: "vi" });
ok(none.s === 200 && r.s === 200 && JSON.stringify(none.j) === JSON.stringify(r.j), "email có và không có tài khoản trả lời giống nhau", JSON.stringify([none, r]));
await new Promise((ok) => setTimeout(ok, 300));
// Đăng ký bằng email cũng gửi thư xác minh: chỉ đếm thư đặt lại.
const sent = mails(email).filter((x) => x.subject === "Đặt lại mật khẩu Synchro");
ok(sent.length === 1, "gửi đúng một thư", sent.length);
const token = /reset#([\w-]+)/.exec(sent[0]?.text ?? "")?.[1];
ok(!!token, "thư có mã đặt lại");
r = await other("POST", "/api/auth/reset", { token: "sai", check: true }); ok(r.s === 400, "mã sai bị từ chối");
r = await other("POST", "/api/auth/reset", { token, check: true }); ok(r.s === 200, "kiểm tra mã đúng", JSON.stringify(r.j));
r = await other("POST", "/api/auth/reset", { token, password: "123" }); ok(r.s === 400, "mật khẩu quá ngắn bị từ chối, mã vẫn còn");
r = await other("POST", "/api/auth/reset", { token, password: "Moi-pass-456789", lang: "vi" }); ok(r.s === 200, "đặt mật khẩu mới", JSON.stringify(r.j));
r = await a("GET", "/api/auth/me"); ok(!r.j?.user, "phiên cũ bị đăng xuất");
r = await other("POST", "/api/auth/reset", { token, password: "Lai-pass-456789" }); ok(r.s === 400, "đường dẫn chỉ dùng được một lần");
r = await other("POST", "/api/auth/login", { email, password: "Forgot-pass-123" }); ok(r.s !== 200, "mật khẩu cũ không còn dùng được");
r = await other("POST", "/api/auth/login", { email, password: "Moi-pass-456789" }); ok(r.s === 200, "đăng nhập bằng mật khẩu mới", JSON.stringify(r.j));
await new Promise((ok) => setTimeout(ok, 300));
ok(mails(email).some((x) => x.subject === "Mật khẩu Synchro của bạn đã được đổi"), "có thư báo mật khẩu đã đổi");

console.log("3. Chống gửi thư rác");
const c = client();
for (let i = 0; i < 5; i++) await c("POST", "/api/auth/forgot", { email });
await new Promise((ok) => setTimeout(ok, 300));
ok(mails(email).filter((x) => x.subject === "Đặt lại mật khẩu Synchro").length <= 3, "tối đa 3 thư mỗi giờ cho một tài khoản", mails(email).length);
for (const f of (() => { try { return fs.readdirSync(MAIL); } catch { return []; } })()) { try { if (JSON.parse(fs.readFileSync(path.join(MAIL, f), "utf8")).to === email) fs.rmSync(path.join(MAIL, f)); } catch {} }

console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
