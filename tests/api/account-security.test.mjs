// Bảo mật tài khoản: đổi mật khẩu đăng xuất phiên khác, đường dẫn đặt lại mật khẩu, tệp tải lên có chủ, tiêu đề bảo mật, /api/health, xóa tài khoản qua API.
import fs from "node:fs";
import path from "node:path";
import { SRC_ROOTS } from "../lib/srcroots.mjs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
const tag = Date.now().toString(36);
const signup = async (email, password = "Member-pass-123") => {
  const c = client();
  const r = await c("POST", "/api/auth/signup", { email, password, profile: { fullName: "Người thử", birthDate: "2000-01-01" } });
  ok(r.s === 200 && r.j?.pending === true, `đăng ký ${email}`, JSON.stringify(r.j));
  // Đăng ký không cấp phiên (blueprint F2.4): đăng nhập bằng mật khẩu vừa đặt.
  await c("POST", "/api/auth/login", { email, password });
  return c;
};
const upload = async (c, name, text) => {
  const fd = new FormData();
  fd.append("file", new Blob([text], { type: "text/plain" }), name);
  const r = await fetch(`${B}/api/files`, { method: "POST", headers: { origin: B, cookie: c.cookie() }, body: fd });
  return { s: r.status, j: await r.json().catch(() => null) };
};

console.log("1. Đổi mật khẩu đăng xuất các phiên khác");
const email = `acc-${tag}@synchro.test`;
const a1 = await signup(email), a2 = client();
await a2("POST", "/api/auth/login", { email, password: "Member-pass-123" });
ok((await a2("GET", "/api/auth/me")).j?.user?.email === email, "phiên thứ hai đang hoạt động");
let r = await a1("POST", "/api/auth/password", { current: "Member-pass-123", password: "Member-pass-456" });
ok(r.s === 200 && r.j.signedOut === 1, "đổi mật khẩu: báo đã đăng xuất 1 phiên khác", JSON.stringify(r.j));
ok((await a1("GET", "/api/auth/me")).j?.user?.email === email, "phiên đang dùng vẫn đăng nhập");
ok(!(await a2("GET", "/api/auth/me")).j?.user, "phiên kia bị đăng xuất ngay");

console.log("2. Đường dẫn đặt lại mật khẩu do quản trị viên tạo");
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const uid = (await a1("GET", "/api/auth/me")).j.user.id;
ok((await a1("PATCH", `/api/admin/users/${uid}`, { action: "reset_link" })).s === 403, "người thường không tạo được");
r = await admin("PATCH", `/api/admin/users/${uid}`, { action: "reset_link" });
const url = r.j?.resetUrl ?? "", token = url.split("#")[1];
ok(r.s === 200 && /\/reset#/.test(url) && token?.length >= 40, "quản trị viên nhận đường dẫn, mã nằm sau dấu #", JSON.stringify(r.j));
const anon = client();
ok((await anon("POST", "/api/auth/reset", { token: "sai", password: "Member-pass-789" })).s === 400, "mã sai bị từ chối");
ok((await anon("POST", "/api/auth/reset", { token, password: "ngan" })).s === 400, "mật khẩu yếu bị từ chối, mã vẫn còn dùng được");
r = await anon("POST", "/api/auth/reset", { token, password: "Member-pass-789" });
ok(r.s === 200, "đặt lại thành công", JSON.stringify(r.j));
ok(!(await a1("GET", "/api/auth/me")).j?.user, "mọi phiên cũ bị đăng xuất");
ok((await anon("POST", "/api/auth/reset", { token, password: "Member-pass-000" })).s === 400, "đường dẫn chỉ dùng được một lần");
ok((await client()("POST", "/api/auth/login", { email, password: "Member-pass-789" })).s === 200, "đăng nhập được bằng mật khẩu mới");
ok((await fetch(`${B}/reset`)).status === 200, "trang /reset mở được khi chưa đăng nhập");
const audit = (await admin("GET", "/api/admin")).j?.audit ?? [];
ok(audit.some((x) => x.action === "admin_reset_link") && audit.some((x) => x.action === "password_reset"), "ghi nhật ký quản trị", JSON.stringify(audit.slice(0, 3)));

console.log("3. Thử sai nhiều lần từ một nơi không khóa chủ tài khoản ở nơi khác");
// Khóa giới hạn gồm email + IP; mức theo email lớn hơn nhiều. Ở máy thử mọi yêu cầu cùng IP nên chỉ kiểm tra thông báo chung, không lộ email có tồn tại.
const w1 = await client()("POST", "/api/auth/login", { email, password: "sai-mat-khau-1" }), w2 = await client()("POST", "/api/auth/login", { email: `khong-co-${tag}@synchro.test`, password: "sai-mat-khau-1" });
ok(w1.s === 401 && w2.s === 401 && w1.j.error === w2.j.error, "sai mật khẩu và không có tài khoản báo cùng một lỗi", JSON.stringify([w1.j, w2.j]));

console.log("4. Tệp tải lên có chủ");
const o1 = await signup(`file-a-${tag}@synchro.test`), o2 = await signup(`file-b-${tag}@synchro.test`);
const up = await upload(o1, "bi-mat.txt", `Nội dung bí mật ${tag}`);
ok(up.s === 200 && up.j.id, "tải tệp lên", JSON.stringify(up.j));
let ctx = await o1("POST", "/api/files/context", { ids: [up.j.id], names: {}, query: "" });
ok(JSON.stringify(ctx.j).includes(`bí mật ${tag}`), "chủ tệp đọc được nội dung");
ctx = await o2("POST", "/api/files/context", { ids: [up.j.id], names: {}, query: "" });
ok(ctx.s === 200 && ctx.j.blocks.length === 0, "người khác biết mã tệp vẫn không đọc được", JSON.stringify(ctx.j));
const same = await upload(o2, "cung-noi-dung.txt", `Nội dung bí mật ${tag}`);
ok(same.j?.id === up.j.id && (await o2("POST", "/api/files/context", { ids: [up.j.id], names: {}, query: "" })).j.blocks.length > 0, "tự tải lên đúng nội dung đó thì thành chủ");

console.log("5. Tiêu đề bảo mật");
const home = await fetch(`${B}/`);
const hd = (k) => home.headers.get(k) ?? "";
ok(/max-age=\d{7,}/.test(hd("strict-transport-security")), "HSTS", hd("strict-transport-security"));
ok(hd("x-content-type-options") === "nosniff", "nosniff");
ok(/frame-ancestors 'self'/.test(hd("content-security-policy")) && hd("x-frame-options") === "SAMEORIGIN", "chống nhúng trang vào site khác", hd("content-security-policy"));
ok(hd("referrer-policy") === "strict-origin-when-cross-origin", "Referrer-Policy");
ok(hd("cross-origin-embedder-policy") === "credentialless" && hd("cross-origin-opener-policy") === "same-origin", "giữ COOP / COEP cho WebContainers");
ok(!/script-src/.test(hd("content-security-policy")), "không chặn script: artifact, Monaco, WebContainers không bị ảnh hưởng");

console.log("6. /api/health");
const h = await fetch(`${B}/api/health`);
const hj = await h.json();
ok((h.status === 200 || h.status === 503) && typeof hj.ok === "boolean" && hj.db === true && hj.build, "trả trạng thái, không cần đăng nhập", JSON.stringify(hj));
ok(Object.keys(hj).every((k) => ["ok", "build", "db", "disk", "agent", "backup"].includes(k)), "chỉ có cờ trạng thái, không số liệu hay đường dẫn", JSON.stringify(hj));
ok(!/\/|synchro\.db|@/.test(JSON.stringify(hj)), "không lộ đường dẫn, email", JSON.stringify(hj));

console.log("7. Xóa tài khoản qua API");
const gone = await signup(`gone-${tag}@synchro.test`);
const gid = (await gone("GET", "/api/auth/me")).j.user.id;
const gu = await upload(gone, "rieng.txt", `tệp riêng ${tag}`);
r = await gone("DELETE", "/api/auth/account", { password: "Member-pass-123" });
ok(r.s === 200, "xóa tài khoản", JSON.stringify(r.j));
ok(!(await gone("GET", "/api/auth/me")).j?.user, "phiên đã mất");
ok((await admin("GET", `/api/admin/users/${gid}`)).s === 404, "tài khoản không còn");
const relogin = await signup(`gone2-${tag}@synchro.test`);
ok((await relogin("POST", "/api/files/context", { ids: [gu.j.id], names: {}, query: "" })).j.blocks.length === 0, "tệp riêng đã bị xóa cùng tài khoản");

console.log("8. Nhật ký quản trị có nhãn cho mọi hành động");
{
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const actions = new Set(SRC_ROOTS.filter((r) => fs.existsSync(r)).flatMap(walk).flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\baudit\("([a-z_]+)"/g)].map((m) => m[1])));
  const ui = fs.readFileSync("ui/adminui.tsx", "utf8");
  const missing = [...actions].filter((a) => !new RegExp(`\\b${a}: \\[`).test(ui));
  ok(actions.size > 15 && !missing.length, `${actions.size} hành động đều có nhãn`, missing.join());
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
