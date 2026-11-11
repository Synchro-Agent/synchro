// Ba vai trò Owner / Admin / Member: chủ sở hữu (OWNER_EMAILS, mặc định email đầu tiên của ADMIN_EMAILS) thêm / bỏ quản trị viên; quản trị viên
// nhận 403 ở mọi việc chỉ chủ sở hữu được làm (khóa API, số dư đã nạp, bảng giá, hạn mức của quản trị viên, thêm / bỏ quản trị viên, xóa
// vĩnh viễn tài khoản, xem phần che của khóa) còn chủ sở hữu làm được; quản trị viên vẫn làm được các việc quản trị khác; nhật ký ghi đổi vai trò.
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
  return f;
}
const tag = Date.now().toString(36);
const PW = "Member-pass-123";
const signup = async (email) => {
  const c = client();
  const r = await c("POST", "/api/auth/signup", { email, password: PW, profile: { fullName: "Người thử", birthDate: "2000-01-01" } });
  ok(r.s === 200, `đăng ký ${email}`, JSON.stringify(r.j));
  return c;
};
const owner = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await owner("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });

console.log("1. Vai trò và thêm quản trị viên");
const meO = (await owner("GET", "/api/auth/me")).j?.user;
ok(meO?.role === "owner" && meO.isAdmin, "tài khoản quản trị đầu tiên trong ADMIN_EMAILS là chủ sở hữu (không cần OWNER_EMAILS)", JSON.stringify(meO && { role: meO.role }));
const emA = `adm-${tag}@synchro.test`, emB = `adm2-${tag}@synchro.test`, emM = `mem-${tag}@synchro.test`;
const cA = await signup(emA), cB = await signup(emB), cM = await signup(emM);
const idOf = async (c) => (await c("GET", "/api/auth/me")).j.user.id;
const idA = await idOf(cA), idB = await idOf(cB), idM = await idOf(cM);
for (const id of [idA, idB, idM]) await owner("PATCH", `/api/admin/users/${id}`, { action: "mark_verified" });
ok((await cM("PATCH", `/api/admin/users/${idA}`, { action: "set_role", role: "admin" })).s === 403, "thành viên không cấp được quyền");
let r = await owner("PATCH", `/api/admin/users/${idA}`, { action: "set_role", role: "admin" });
ok(r.s === 200, "chủ sở hữu cấp quyền quản trị viên", JSON.stringify(r.j));
const admin = client();
await admin("POST", "/api/auth/login", { email: emA, password: PW });
const meA = (await admin("GET", "/api/auth/me")).j?.user;
ok(meA?.role === "admin" && meA.isAdmin, "người được cấp là quản trị viên", JSON.stringify(meA && { role: meA.role, isAdmin: meA.isAdmin }));
r = await admin("GET", "/api/admin");
ok(r.s === 200 && r.j.role === "admin", "quản trị viên vào được trang Quản trị", r.s);
const row = (list, id) => list.find((u) => u.id === id);
ok(row(r.j.users, meO.id)?.role === "owner" && row(r.j.users, idA)?.role === "admin" && row(r.j.users, idM)?.role === "member", "danh sách người dùng có vai trò", JSON.stringify([row(r.j.users, meO.id)?.role, row(r.j.users, idA)?.role, row(r.j.users, idM)?.role]));
let audit = (await owner("GET", "/api/admin")).j.audit;
ok(audit.some((x) => x.action === "admin_role_granted" && x.target_email === emA && x.detail === "member → admin" && x.actor_email === "admin@synchro.test"), "nhật ký ghi cấp quyền (ai, cho ai, cũ → mới)", JSON.stringify(audit.slice(0, 3)));

console.log("2. Việc chỉ chủ sở hữu làm được: quản trị viên 403, chủ sở hữu thành công");
const keysO = (await owner("GET", "/api/admin/apikeys")).j;
const keysA = (await admin("GET", "/api/admin/apikeys")).j;
const oa = keysO.providers.find((p) => p.id === "openai");
ok(keysO.owner === true && !!oa?.keyHint && !!oa.baseUrl, "chủ sở hữu thấy phần che của khóa và địa chỉ API", JSON.stringify(oa && { keyHint: oa.keyHint, baseUrl: oa.baseUrl }));
ok(keysA.owner === false && keysA.providers.every((p) => p.keyHint === null && !p.workspaceId && !p.baseUrl), "quản trị viên không thấy phần che của khóa, địa chỉ API riêng, workspace", JSON.stringify(keysA.providers.map((p) => [p.id, p.keyHint, p.baseUrl])));
const key = { id: "openai", key: "sk-mock-openai-0001", baseUrl: oa.baseUrl };
r = await admin("POST", "/api/admin/apikeys", key);
ok(r.s === 403, "đổi khóa API: quản trị viên 403", JSON.stringify(r));
r = await owner("POST", "/api/admin/apikeys", key);
ok(r.s === 200 && r.j.providers.find((p) => p.id === "openai")?.configured, "đổi khóa API: chủ sở hữu thành công", JSON.stringify(r.j).slice(0, 200));
const custom = { kind: "compatible", name: `Thu ${tag}`, key: "sk-mock-compat-0001", baseUrl: oa.baseUrl };
ok((await admin("POST", "/api/admin/apikeys", custom)).s === 403, "thêm nhà cung cấp mới: quản trị viên 403");
r = await owner("POST", "/api/admin/apikeys", custom);
const cid = r.j?.providers?.find((p) => p.name === custom.name)?.id;
ok(r.s === 200 && !!cid, "thêm nhà cung cấp mới: chủ sở hữu thành công", JSON.stringify(r.j).slice(0, 300));
ok((await admin("DELETE", `/api/admin/apikeys?id=${cid}`)).s === 403, "gỡ khóa API: quản trị viên 403");
r = await owner("DELETE", `/api/admin/apikeys?id=${cid}`);
ok(r.s === 200 && !r.j.providers.some((p) => p.id === cid), "gỡ khóa API: chủ sở hữu thành công", r.s);
const cr = keysO.credits?.find((c) => c.provider === "openai");
const credit = { action: "credit", id: "openai", amount: cr ? cr.amount : null };
ok((await admin("POST", "/api/admin/apikeys", credit)).s === 403, "số dư API đã nạp: quản trị viên 403");
ok((await owner("POST", "/api/admin/apikeys", credit)).s === 200, "số dư API đã nạp: chủ sở hữu thành công");
const price = { config: { prices: { "openai/gpt-5.4-mini": { in: 0.5, out: 2, cache: 0.05 } } } };
ok((await admin("PATCH", "/api/admin/usage", price)).s === 403, "bảng giá: quản trị viên 403");
r = await owner("PATCH", "/api/admin/usage", price);
ok(r.s === 200 && r.j.config.prices["openai/gpt-5.4-mini"]?.in === 0.5 && r.j.owner === true, "bảng giá: chủ sở hữu thành công", JSON.stringify(r.j?.config));
await owner("PATCH", "/api/admin/usage", { config: { prices: { "openai/gpt-5.4-mini": null } } });
const cfg = (await owner("GET", "/api/admin/usage")).j.config;
ok((await admin("PATCH", "/api/admin/usage", { config: { admins: cfg.admins } })).s === 403, "áp hạn mức cho quản trị viên: quản trị viên 403");
ok((await owner("PATCH", "/api/admin/usage", { config: { admins: cfg.admins } })).s === 200, "áp hạn mức cho quản trị viên: chủ sở hữu thành công");
ok((await admin("PATCH", "/api/admin/usage", { user: idA, override: { session: 1 } })).s === 403, "hạn mức riêng của tài khoản quản trị viên (kể cả của chính mình): quản trị viên 403");
r = await owner("PATCH", "/api/admin/usage", { user: idA, override: { session: 1 } });
ok(r.s === 200 && r.j.users.find((u) => u.id === idA)?.override.session === 1, "hạn mức riêng của quản trị viên: chủ sở hữu thành công");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "admin" })).s === 403, "thêm quản trị viên: quản trị viên 403");
ok((await owner("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "admin" })).s === 200, "thêm quản trị viên: chủ sở hữu thành công");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "suspend" })).s === 403, "khóa tài khoản của quản trị viên khác: quản trị viên 403");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "member" })).s === 403, "bỏ quản trị viên: quản trị viên 403");
ok((await owner("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "member" })).s === 200, "bỏ quản trị viên: chủ sở hữu thành công");
ok((await admin("PATCH", `/api/admin/users/${meO.id}`, { action: "suspend" })).s === 403, "khóa chủ sở hữu: quản trị viên 403");
ok((await admin("DELETE", `/api/admin/users/${idM}`, { confirm: emM })).s === 403, "xóa vĩnh viễn tài khoản: quản trị viên 403");
r = await owner("DELETE", `/api/admin/users/${idM}`, { confirm: emM });
ok(r.s === 200 && !(await cM("GET", "/api/auth/me")).j?.user, "xóa vĩnh viễn tài khoản: chủ sở hữu thành công", JSON.stringify(r.j));

console.log("3. Quản trị viên vẫn làm các việc quản trị khác");
const main = keysA.main;
ok((await admin("POST", "/api/admin/apikeys", { action: "main", main })).s === 200, "chọn model hiển thị");
ok((await admin("POST", "/api/admin/apikeys", { action: "refresh", id: "openai" })).s === 200, "làm mới danh sách model của khóa đã có");
ok((await admin("PATCH", "/api/admin/usage", { config: { session: cfg.session } })).s === 200, "hạn mức mặc định cho mọi người");
ok((await admin("PATCH", "/api/admin/usage", { user: idB, override: null })).s === 200, "hạn mức riêng của thành viên");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "suspend" })).s === 200 && (await admin("PATCH", `/api/admin/users/${idB}`, { action: "restore" })).s === 200, "khóa / mở khóa thành viên");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "set_perms", perms: null })).s === 200, "đổi quyền của thành viên");
ok((await admin("GET", "/api/admin/usage")).j?.owner === false, "trang hạn mức biết người xem không phải chủ sở hữu");

console.log("4. Bỏ quyền và nhật ký");
r = await owner("PATCH", `/api/admin/users/${idA}`, { action: "set_role", role: "member" });
ok(r.s === 200, "chủ sở hữu bỏ quyền quản trị viên");
ok((await admin("GET", "/api/admin")).s === 403 && (await admin("GET", "/api/auth/me")).j?.user?.role === "member", "người bị bỏ quyền không vào được Quản trị nữa");
ok((await owner("PATCH", `/api/admin/users/${idM}`, { action: "set_role", role: "owner" })).s >= 400, "không cấp được vai trò lạ");
audit = (await owner("GET", "/api/admin")).j.audit;
ok(["admin_role_granted", "admin_role_revoked"].every((a) => audit.some((x) => x.action === a && x.target_email === emB)) && audit.some((x) => x.action === "admin_role_revoked" && x.target_email === emA && x.detail === "admin → member"), "nhật ký ghi cả cấp và bỏ quyền", JSON.stringify(audit.slice(0, 6).map((x) => [x.action, x.target_email, x.detail])));
for (const id of [idA, idB]) await owner("DELETE", `/api/admin/users/${id}`, { confirm: id === idA ? emA : emB });

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
