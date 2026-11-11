// Ba vai trò Owner / Admin / Member: chủ sở hữu (OWNER_EMAILS, mặc định email đầu tiên của ADMIN_EMAILS) thêm / bỏ quản trị viên; quản trị viên
// nhận 403 ở mọi việc chỉ chủ sở hữu được làm (khóa API, số dư đã nạp, bảng giá, hạn mức của quản trị viên, thêm / bỏ quản trị viên, xóa
// vĩnh viễn tài khoản, xem phần che của khóa, cấu hình sao lưu R2, khóa Turnstile, chặn email dùng một lần, hạn mức giọng / ảnh trả tiền thật,
// khóa dịch vụ ElevenLabs / Composio / Replicate, việc tốn khóa API của sổ model, cập nhật CLI của gói) còn chủ sở hữu làm được; quản trị viên vẫn làm được các việc quản trị khác; nhật ký ghi đổi vai trò.
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
// Tài khoản quản trị đang bị khóa vẫn là tài khoản quản trị: quản trị viên khác không đặt sẵn hạn mức riêng lên đó.
ok((await owner("PATCH", `/api/admin/users/${idB}`, { action: "suspend" })).s === 200, "chủ sở hữu khóa một quản trị viên");
ok((await admin("PATCH", "/api/admin/usage", { user: idB, override: { weekly: 0 } })).s === 403, "hạn mức riêng của quản trị viên đang bị khóa: quản trị viên 403");
ok((await owner("PATCH", `/api/admin/users/${idB}`, { action: "restore" })).s === 200, "chủ sở hữu mở khóa lại");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "suspend" })).s === 403, "khóa tài khoản của quản trị viên khác: quản trị viên 403");
ok((await admin("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "member" })).s === 403, "bỏ quản trị viên: quản trị viên 403");
ok((await owner("PATCH", `/api/admin/users/${idB}`, { action: "set_role", role: "member" })).s === 200, "bỏ quản trị viên: chủ sở hữu thành công");
ok((await admin("PATCH", `/api/admin/users/${meO.id}`, { action: "suspend" })).s === 403, "khóa chủ sở hữu: quản trị viên 403");
ok((await admin("DELETE", `/api/admin/users/${idM}`, { confirm: emM })).s === 403, "xóa vĩnh viễn tài khoản: quản trị viên 403");
r = await owner("DELETE", `/api/admin/users/${idM}`, { confirm: emM });
ok(r.s === 200 && !(await cM("GET", "/api/auth/me")).j?.user, "xóa vĩnh viễn tài khoản: chủ sở hữu thành công", JSON.stringify(r.j));

console.log("2b. Phần gộp từ r9: sao lưu R2, Turnstile, email dùng một lần, hạn mức tiền thật, khóa dịch vụ, sổ model");
// Sao lưu liên tục: quản trị viên xem trạng thái (không thấy Account ID / Access Key ID), không lưu / gỡ / bật được.
const bkO = (await owner("GET", "/api/admin/backup")).j, bkA = await admin("GET", "/api/admin/backup");
ok(bkO?.owner === true && bkA.s === 200 && bkA.j.owner === false, "sao lưu: quản trị viên xem được trạng thái, biết mình không phải chủ sở hữu", JSON.stringify(bkA.j).slice(0, 200));
ok(!bkA.j.accountId || bkA.j.accountId === "••••", "sao lưu: quản trị viên không thấy Account ID", bkA.j.accountId);
ok((await admin("POST", "/api/admin/backup", { action: "save", accountId: "x", bucket: `b-${tag}`, accessKeyId: "y", secret: "z", prefix: "synchro" })).s === 403, "sao lưu: lưu cấu hình R2 quản trị viên 403");
ok((await admin("POST", "/api/admin/backup", { action: "save", enabled: !bkO.enabled })).s === 403, "sao lưu: bật / tắt quản trị viên 403");
ok((await admin("POST", "/api/admin/backup", { action: "clear" })).s === 403, "sao lưu: gỡ cấu hình quản trị viên 403");
ok((await owner("GET", "/api/admin/backup")).j?.bucket === bkO.bucket, "sao lưu: cấu hình không đổi sau các lần bị chặn");
r = await owner("POST", "/api/admin/backup", { action: "save", prefix: bkO.prefix || "synchro" });
ok(r.s === 200 && r.j.owner === true, "sao lưu: chủ sở hữu lưu được", JSON.stringify(r.j).slice(0, 200));
// Cài đặt quản trị: mỗi mục chỉ chủ sở hữu bị chặn riêng, kể cả khi gộp chung với mục quản trị viên được đổi.
const setO = (await owner("GET", "/api/admin")).j.settings;
const gated = [
  ["khóa Turnstile", { turnstile: { siteKey: "1x00000000000000000000AA", secret: "1x0000000000000000000000000000000AA", loginAfter: 3 } }],
  ["tắt Turnstile", { turnstile: { clear: true } }],
  ["chặn email dùng một lần", { blockDisposable: !setO.turnstile?.blockDisposable }],
  ["hạn mức giọng ElevenLabs", { speechBudget: { user: 1 } }],
  ["hạn mức ảnh Replicate", { replicateBudget: { user: 1 } }],
];
for (const [n, body] of gated) ok((await admin("PATCH", "/api/admin/settings", body)).s === 403, `${n}: quản trị viên 403`);
r = await admin("PATCH", "/api/admin/settings", { signupOpen: setO.signupOpen, speechBudget: { user: 1 } });
ok(r.s === 403, "gộp mục được phép với hạn mức: cả yêu cầu bị chặn, không lưu nửa chừng");
const setA = (await owner("GET", "/api/admin")).j.settings;
ok(JSON.stringify(setA.turnstile) === JSON.stringify(setO.turnstile) && JSON.stringify(setA.speechBudget) === JSON.stringify(setO.speechBudget) && JSON.stringify(setA.replicateBudget) === JSON.stringify(setO.replicateBudget), "cài đặt không đổi sau các lần bị chặn", JSON.stringify([setA.turnstile, setO.turnstile]));
r = await owner("PATCH", "/api/admin/settings", { blockDisposable: !!setO.turnstile?.blockDisposable, speechBudget: { user: setO.speechBudget?.user ?? 0 }, replicateBudget: { user: setO.replicateBudget?.user ?? 0 } });
ok(r.s === 200 && r.j.settings.speechBudget.user === setO.speechBudget?.user && r.j.settings.replicateBudget.user === setO.replicateBudget?.user, "hạn mức tiền thật và chặn email: chủ sở hữu lưu được", JSON.stringify(r.j).slice(0, 300));
r = await owner("PATCH", "/api/admin/settings", { turnstile: { loginAfter: setO.turnstile?.loginAfter ?? 5 } });
ok(r.s === 200 && r.j.settings.turnstile.on === !!setO.turnstile?.on && r.j.settings.turnstile.loginAfter === (setO.turnstile?.loginAfter ?? 5), "Turnstile: chủ sở hữu lưu được", JSON.stringify(r.j?.settings?.turnstile));
ok((await admin("PATCH", "/api/admin/settings", { verifyGate: setO.verifyGate !== false })).s === 200, "luật xác minh email: quản trị viên vẫn đổi được");
// Khóa dịch vụ ElevenLabs / Composio / Replicate: thêm, đổi, gỡ chỉ chủ sở hữu.
for (const [id, k] of [["elevenlabs", "sk_mock_eleven_0001"], ["composio", "ak_mock_composio_0001"], ["replicate", "r8_mock_replicate_0001"]]) {
  ok((await admin("POST", "/api/admin/apikeys", { id, kind: id, key: k })).s === 403, `khóa ${id}: quản trị viên 403 khi thêm / đổi`);
  ok((await admin("DELETE", `/api/admin/apikeys?id=${id}`)).s === 403, `khóa ${id}: quản trị viên 403 khi gỡ`);
}
// Sổ model: việc tốn khóa API của chủ máy chủ chỉ chủ sở hữu; ghim / ẩn vẫn là việc của quản trị viên.
const regO = (await owner("GET", "/api/admin/models")).j, regA = (await admin("GET", "/api/admin/models")).j;
ok(regO?.owner === true && regA?.owner === false, "sổ model biết ai là chủ sở hữu", JSON.stringify([regO?.owner, regA?.owner]));
const auto0 = regO.settings.auto, someKey = regO.models.find((m) => !m.plan)?.key ?? "openai/gpt-x";
for (const [n, body] of [["bật / tắt tự nhận model mới", { action: "auto", on: !auto0 }], ["tự nhận model mới theo hãng", { action: "provider", id: "openai", on: false }], ["Kiểm tra ngay", { action: "check" }], ["Thử lại một model", { action: "retest", key: someKey }]])
  ok((await admin("POST", "/api/admin/models", body)).s === 403, `${n}: quản trị viên 403`);
ok((await owner("GET", "/api/admin/models")).j.settings.auto === auto0, "tự nhận model mới không đổi sau lần bị chặn");
r = await owner("POST", "/api/admin/models", { action: "auto", on: auto0 });
ok(r.s === 200 && r.j.settings.auto === auto0, "bật / tắt tự nhận model mới: chủ sở hữu được", JSON.stringify(r.j).slice(0, 200));
const pinned0 = !!regO.models.find((m) => m.key === someKey)?.pinned;
r = await admin("POST", "/api/admin/models", { action: "pin", key: someKey, on: !pinned0 });
ok(r.s === 200, "ghim model: quản trị viên vẫn làm được", JSON.stringify(r.j).slice(0, 200));
await admin("POST", "/api/admin/models", { action: "pin", key: someKey, on: pinned0 });

console.log("3. Quản trị viên vẫn làm các việc quản trị khác");
const main = keysA.main;
ok((await admin("POST", "/api/admin/apikeys", { action: "main", main })).s === 200, "chọn model hiển thị");
ok((await admin("POST", "/api/admin/apikeys", { action: "refresh", id: "openai" })).s === 200, "làm mới danh sách model của khóa đã có");
await owner("PATCH", "/api/admin/usage", { config: { admins: false } });
ok((await admin("PATCH", "/api/admin/usage", { config: { session: cfg.session } })).s === 200, "hạn mức mặc định cho mọi người (khi không áp cho quản trị viên)");
// Hạn mức đang áp cho quản trị viên (gồm chủ sở hữu): hạn mức mặc định cũng chỉ chủ sở hữu đổi, nếu không đặt 0 là chặn được chủ sở hữu.
await owner("PATCH", "/api/admin/usage", { config: { admins: true } });
ok((await admin("PATCH", "/api/admin/usage", { config: { weekly: 0 } })).s === 403, "áp cho quản trị viên: đặt hạn mức tuần = 0 thì quản trị viên 403");
ok((await admin("PATCH", "/api/admin/usage", { config: { session: null, weekly: null } })).s === 403, "áp cho quản trị viên: bỏ hạn mức mặc định thì quản trị viên 403");
r = await owner("PATCH", "/api/admin/usage", { config: { weekly: cfg.weekly } });
ok(r.s === 200, "áp cho quản trị viên: chủ sở hữu vẫn đổi được hạn mức mặc định");
await owner("PATCH", "/api/admin/usage", { config: { admins: cfg.admins, session: cfg.session, weekly: cfg.weekly } });
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
