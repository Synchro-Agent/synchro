// Làm mới gói ở Cài đặt → Providers: đọc lại với CLI, không mất đăng nhập, không ảnh hưởng tài khoản khác. Cần dev:mock đang chạy.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
let cookie = "";
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: body ? JSON.stringify(body) : undefined }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
for (const cli of ["claude", "codex", "agy", "grok"]) {
  const before = await api("GET", `/api/engines/${cli}/status`);
  const r = await api("POST", `/api/engines/${cli}/refresh`);
  ok(r.s === 200 && r.j.cli === cli && r.j.loggedIn === before.j.loggedIn, `${cli}: làm mới giữ nguyên trạng thái đăng nhập`, JSON.stringify(r.j));
}
ok((await api("POST", "/api/engines/khong-co/refresh")).s === 404, "CLI lạ: 404");
{ const r = await fetch(`${B}/api/engines/grok/refresh`, { method: "POST", headers: { origin: "https://la.test", cookie } }); ok(r.status === 403, "yêu cầu từ trang khác bị chặn", r.status); }
{ const r = await fetch(`${B}/api/engines/grok/refresh`, { method: "POST", headers: { origin: B } }); ok(r.status === 401, "chưa đăng nhập Synchro: từ chối", r.status); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
