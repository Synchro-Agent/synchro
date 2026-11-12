// Kiểm tra: tự nhận diện logo connector và các quyền chi tiết (theo cuộc trò chuyện, cài đặt connector, quyền quản trị viên).
const B = "http://localhost:3200", MCP = "http://127.0.0.1:4011";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
// Kiểm tra gọi dịch vụ thật trên Internet (DeepWiki, Context7): lỗi mạng không chặn deploy, chỉ cảnh báo.
const soft = (c, n, x = "") => { if (c) return ok(true, n); console.log("  ⚠", n, "(dịch vụ bên ngoài, không tính lỗi)", String(x).slice(0, 200)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await member("POST", "/api/auth/signup", { email: "conn-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "conn-member@synchro.test", password: "Member-pass-123" });
// Tài khoản test có quyền riêng (mọi model, mọi tính năng) để không phụ thuộc quyền mặc định quản trị viên đặt cho thành viên.
async function fullPerms(email) {
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  if (u) await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
await fullPerms("conn-member@synchro.test");

for (const c of [admin, member]) { const r = await c("GET", "/api/connectors"); for (const x of r.j.connectors ?? []) await c("DELETE", `/api/connectors/${x.id}`); }
async function oauth(c, url) {
  const page = await fetch(url).then((r) => r.text());
  const link = /id="allow" href="([^"]+)"/.exec(page)[1].replace(/&amp;/g, "&");
  const back = (await fetch(link, { redirect: "manual" })).headers.get("location");
  return fetch(back, { headers: { cookie: c.cookie() } }).then((r) => r.text());
}
const svgOf = (icon) => (icon?.startsWith("data:image/svg+xml;base64,") ? Buffer.from(icon.split(",")[1], "base64").toString() : "");
const chat = (c, model, text, extra = {}) => c("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model, skills: true, ...extra });
const resume = (c, id, d) => c("POST", "/api/llm", { resume: id, decisions: d });
const C = "anthropic/claude-opus-5-5";

console.log("1. Tự nhận diện logo");
let r = await admin("POST", "/api/connectors", { name: "Mock Modern", url: `${MCP}/modern` });
ok(r.j.connector?.icon && svgOf(r.j.connector.icon).includes("#7C3AED"), "logo máy chủ MCP tự khai báo (serverInfo.icons)", `svg: ${svgOf(r.j.connector?.icon).slice(0, 300)} · status ${r.s} · ${JSON.stringify(r.j).slice(0, 120)}`);
r = await admin("POST", "/api/connectors", { name: "Mock SSE", url: `${MCP}/sse` });
ok(svgOf(r.j.connector?.icon).includes("#F59E0B"), "logo lấy từ trang chủ (link rel=icon), bỏ qua mask-icon", (r.j.connector?.icon ?? "").slice(0, 80));
r = await admin("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
ok(r.j.authorizeUrl && svgOf(r.j.connector?.icon).includes("#F59E0B"), "connector cần đăng nhập vẫn có logo ngay từ trước khi đăng nhập", (r.j.connector?.icon ?? "none").slice(0, 60));
const notesId = r.j.connector.id;
await oauth(admin, r.j.authorizeUrl);
// Connector tự thêm: mọi công cụ mặc định Hỏi mỗi lần (không tin readOnlyHint của máy chủ); bài kiểm thử cần công cụ đọc chạy luôn nên tự cho phép nhóm công cụ đọc.
await admin("PATCH", `/api/connectors/${notesId}`, { group: { kind: "read", perm: "allow" } });
r = await admin("POST", "/api/connectors", { dir: "deepwiki" });
soft(/^data:image\/(png|svg\+xml|x-icon|jpeg|webp|gif);base64,/.test(r.j.connector?.icon ?? ""), `DeepWiki thật: tìm được logo (${(r.j.connector?.icon ?? "").slice(5, 25)})`, JSON.stringify(r.j).slice(0, 200));
r = await admin("POST", "/api/connectors", { dir: "context7" });
soft(/^data:image\//.test(r.j.connector?.icon ?? ""), `Context7 thật: tìm được logo (${(r.j.connector?.icon ?? "").slice(5, 25)})`, JSON.stringify(r.j).slice(0, 200));
r = await admin("POST", "/api/connectors", { name: "Notion của tôi", url: "https://mcp.notion.com/mcp" });
ok(r.j.connector?.dir === "notion" && r.j.connector.logo === "notion" && r.j.connector.name === "Notion của tôi", "dán địa chỉ Notion: nhận ra là Notion, dùng logo có sẵn, giữ tên tự đặt", JSON.stringify(r.j.connector).slice(0, 200));
r = await admin("POST", "/api/connectors", { name: "Lạ", url: "https://example.com/mcp" });
ok(r.s === 502, "trang không phải MCP vẫn báo lỗi bình thường", JSON.stringify(r.j));

console.log("2. Hỏi một lần mỗi cuộc trò chuyện");
r = await admin("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "chat" } });
ok(r.j.connector.tools.find((t) => t.name === "create_note").perm === "chat", "đặt quyền 'hỏi một lần mỗi cuộc trò chuyện'");
r = await chat(admin, C, `#tool=create_note #args={"title":"A"}`, { conv: "conv-1" });
ok(!!r.j?.approval, "lần đầu trong cuộc trò chuyện: hỏi", JSON.stringify(r).slice(0, 300));
r = await resume(admin, r.j.approval.id, { [r.j.approval.calls[0].id]: "chat" });
ok(/Đã tạo ghi chú/.test(r.j.text ?? ""), "chọn 'cho phép trong cuộc trò chuyện này': chạy", JSON.stringify(r.j).slice(0, 200));
r = await chat(admin, C, `#tool=create_note #args={"title":"B"}`, { conv: "conv-1" });
ok(!r.j.approval && /Đã tạo ghi chú/.test(r.j.text ?? ""), "cùng cuộc trò chuyện: không hỏi lại", JSON.stringify(r.j).slice(0, 200));
r = await chat(admin, C, `#tool=create_note #args={"title":"C"}`, { conv: "conv-2" });
ok(!!r.j.approval, "cuộc trò chuyện khác: hỏi lại");
await resume(admin, r.j.approval.id, {});
r = await admin("GET", "/api/connectors");
ok(r.j.connectors.find((x) => x.id === notesId).tools.find((t) => t.name === "create_note").perm === "chat", "quyền đã đặt không bị đổi thành 'luôn cho phép'");

console.log("3. Cài đặt riêng của connector");
r = await admin("PATCH", `/api/connectors/${notesId}`, { settings: { chat: false } });
ok(r.j.connector.settings.chat === false && r.j.connector.settings.projects === true, "tắt dùng trong chat thường");
r = await chat(admin, C, `#tool=search_notes #args={"query":"A"}`);
ok(!/Đã gọi công cụ/.test(r.j.text ?? ""), "chat thường không dùng connector này nữa", r.j.text);
r = await chat(admin, C, `#tool=search_notes #args={"query":"A"}`, { project: 7 });
ok(/Đã gọi công cụ mock_notes__search_notes/.test(r.j.text ?? ""), "trong dự án vẫn dùng được", r.j.text);
await admin("PATCH", `/api/connectors/${notesId}`, { settings: { chat: true } });
r = await admin("PATCH", `/api/connectors/${notesId}`, { settings: { destructive: false } });
ok(r.j.connector.tools.find((t) => t.name === "delete_note").locked === "setting", "tắt công cụ xóa dữ liệu: công cụ xóa bị khóa");
r = await chat(admin, C, `#tool=delete_note #args={"id":"n1"}`);
ok(!r.j.approval && !/Đã xóa/.test(r.j.text ?? ""), "công cụ xóa không được đưa cho model", JSON.stringify(r.j).slice(0, 200));
await admin("PATCH", `/api/connectors/${notesId}`, { settings: { destructive: true } });
r = await admin("PATCH", `/api/connectors/${notesId}`, { settings: { maxCalls: 7, newTools: "khong", chat: "yes" } });
ok(r.j.connector.settings.maxCalls === 0 && r.j.connector.settings.newTools === "auto" && r.j.connector.settings.chat === true, "giá trị cài đặt không hợp lệ bị bỏ qua");
r = await admin("PATCH", `/api/connectors/${notesId}`, { settings: { maxCalls: 5, newTools: "block" } });
ok(r.j.connector.settings.maxCalls === 5 && r.j.connector.settings.newTools === "block", "đặt giới hạn số lần gọi và quyền cho công cụ mới");

console.log("4. Quyền quản trị viên cho tài khoản thường");
const me = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "conn-member@synchro.test");
const feats = me.perms.features;
r = await admin("PATCH", `/api/admin/users/${me.id}`, { action: "set_perms", perms: { models: ["*"], features: feats, connectors: { custom: false, allowed: ["deepwiki", "notion"], destructive: false } } });
ok(r.s === 200, "lưu quyền connector cho tài khoản", JSON.stringify(r.j));
r = await member("GET", "/api/connectors");
ok(r.j.policy?.custom === false && JSON.stringify(r.j.policy.allowed) === '["deepwiki","notion"]' && r.j.policy.destructive === false, "tài khoản nhận được quyền", JSON.stringify(r.j.policy));
r = await member("POST", "/api/connectors", { name: "X", url: `${MCP}/modern` });
ok(r.s === 403 && /tùy chỉnh/.test(r.j.error), "không được thêm connector tùy chỉnh", JSON.stringify(r.j));
r = await member("POST", "/api/connectors", { dir: "context7" });
ok(r.s === 403, "connector ngoài danh sách cho phép bị chặn", JSON.stringify(r.j));
r = await member("POST", "/api/connectors", { name: "DW", url: "https://mcp.deepwiki.com/mcp" });
ok(r.s === 200 && r.j.connector?.dir === "deepwiki", "dán địa chỉ connector được phép thì vẫn thêm được (nhận ra là DeepWiki)", JSON.stringify(r.j).slice(0, 200));
const dwId = r.j.connector?.id;
r = await admin("PATCH", `/api/admin/users/${me.id}`, { action: "set_perms", perms: { models: ["*"], features: feats, connectors: { custom: false, allowed: ["notion"], destructive: false } } });
r = await member("GET", "/api/connectors");
ok(r.j.connectors.find((x) => x.id === dwId)?.adminBlocked === true, "quản trị viên bỏ quyền: connector hiện là bị quản trị viên tắt");
r = await chat(member, C, `#tool=read_wiki_structure #args={"repoName":"a/b"}`);
ok(!r.j.approval && !/Đã gọi công cụ deepwiki/.test(r.j.text ?? ""), "connector bị quản trị viên tắt không dùng được trong chat", JSON.stringify(r.j).slice(0, 200));
r = await member("POST", `/api/connectors/${dwId}/connect`);
ok(r.s === 403, "không kết nối lại được connector bị quản trị viên tắt");
await fullPerms("conn-member@synchro.test");
r = await member("GET", "/api/connectors");
ok(r.j.policy.custom === true && r.j.connectors.find((x) => x.id === dwId)?.adminBlocked === false, "về quyền mặc định: dùng lại được");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
