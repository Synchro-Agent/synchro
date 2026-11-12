// Kiểm tra end-to-end Connectors của Synchro trên bản giả lập (npm run dev:mock: web 3200, LLM giả 4010, MCP giả 4011).
const B = "http://localhost:3200", MCP = "http://127.0.0.1:4011";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body, raw = false) => {
    const r = await fetch(p.startsWith("http") ? p : B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });

// Mô phỏng trình duyệt: mở trang đăng nhập, bấm Cho phép/Từ chối, theo chuyển hướng về Synchro (kèm cookie của người đã bấm kết nối).
async function oauth(c, authorizeUrl, decision = "allow", tamper) {
  const page = await fetch(authorizeUrl).then((r) => r.text());
  const link = new RegExp(`id="${decision}" href="([^"]+)"`).exec(page)?.[1];
  if (!link) return { error: "no consent link: " + page.slice(0, 200) };
  const r = await fetch(link.replace(/&amp;/g, "&"), { redirect: "manual" });
  let back = r.headers.get("location");
  if (tamper) back = tamper(back);
  const cb = await fetch(back, { headers: { cookie: c.cookie() } });
  return { html: await cb.text(), back };
}
const chat = (c, model, text, extra = {}) => c("POST", "/api/llm", { system: "", messages: [{ role: "user", content: text }], model, skills: true, ...extra });
const resume = (c, id, decisions) => c("POST", "/api/llm", { resume: id, decisions });

console.log("1. Danh sách và Composio");
let r = await admin("GET", "/api/connectors");
for (const x of r.j.connectors ?? []) await admin("DELETE", `/api/connectors/${x.id}`);
r = await admin("GET", "/api/connectors");
// Danh mục connector gợi ý không còn gửi cho trình duyệt; Composio (connector chính) có trạng thái riêng.
ok(r.s === 200 && r.j.connectors.length === 0 && r.j.directory === undefined && ["linked", "unlinked"].includes(r.j.composio?.state) && r.j.composio.connector?.dir === "composio", "trống, không còn danh mục gợi ý, Composio của bạn có sẵn (chưa liên kết / đã liên kết)", JSON.stringify(r.j).slice(0, 200));

console.log("2. Kiểm tra đầu vào");
r = await admin("POST", "/api/connectors", { name: "", url: "https://x.com/mcp" }); ok(r.s === 400 && /tên/.test(r.j.error), "thiếu tên bị chặn", JSON.stringify(r.j));
r = await admin("POST", "/api/connectors", { name: "X", url: "ftp://x.com/mcp" }); ok(r.s === 400, "giao thức lạ bị chặn", JSON.stringify(r.j));
r = await admin("POST", "/api/connectors", { name: "X", url: "https://user:pass@x.com/mcp" }); ok(r.s === 400 && /mật khẩu/.test(r.j.error), "URL chứa mật khẩu bị chặn", JSON.stringify(r.j));
r = await admin("POST", "/api/connectors", { name: "Không phải MCP", url: `${MCP}/khong-co` }); ok(r.s === 502 && /không phải máy chủ MCP/.test(r.j.error), "địa chỉ không phải MCP báo rõ, không lưu", JSON.stringify(r.j));
r = await admin("GET", "/api/connectors"); ok(r.j.connectors.length === 0, "connector lỗi không bị lưu lại");

console.log("3. Connector cần OAuth (Streamable HTTP đời 2025)");
r = await admin("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
ok(r.s === 200 && r.j.authorizeUrl, "trả về địa chỉ đăng nhập", JSON.stringify(r.j).slice(0, 300));
const notesId = r.j.connector?.id;
const au = new URL(r.j.authorizeUrl);
ok(au.searchParams.get("code_challenge_method") === "S256" && au.searchParams.get("code_challenge") && au.searchParams.get("state") && au.searchParams.get("resource") === `${MCP}/mcp`, "PKCE S256 + state + resource đúng");
ok(/notes:read/.test(au.searchParams.get("scope")) && /offline_access/.test(au.searchParams.get("scope")) && au.searchParams.get("client_id")?.startsWith("mock_"), "scope lấy từ máy chủ + offline_access, client đăng ký động", au.searchParams.get("scope"));
ok(r.j.connector.status === "needs_auth", "trạng thái chờ đăng nhập");
// state đúng nhưng người khác hoàn tất → bị chặn
await member("POST", "/api/auth/signup", { email: "conn-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "conn-member@synchro.test", password: "Member-pass-123" });
// Tài khoản test có quyền riêng (mọi model, mọi tính năng) để không phụ thuộc quyền mặc định quản trị viên đặt cho thành viên.
async function fullPerms(email) {
  const u = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === email);
  if (u) await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } });
}
await fullPerms("conn-member@synchro.test");

for (const x of (await member("GET", "/api/connectors")).j.connectors ?? []) await member("DELETE", `/api/connectors/${x.id}`);
let o = await oauth(member, r.j.authorizeUrl);
ok(/tài khoản đã bấm kết nối/.test(o.html), "người khác không hoàn tất được đăng nhập của mình", o.html?.slice(0, 300));
// Lấy lại địa chỉ đăng nhập mới (state cũ đã dùng) rồi hoàn tất đúng
r = await admin("POST", `/api/connectors/${notesId}/connect`);
o = await oauth(admin, r.j.authorizeUrl, "allow", (b) => b.replace(/iss=[^&]+/, "iss=http%3A%2F%2Fevil.example"));
ok(/không khớp/.test(o.html), "iss sai bị từ chối (RFC 9207)", o.html?.slice(0, 300));
r = await admin("POST", `/api/connectors/${notesId}/connect`);
o = await oauth(admin, r.j.authorizeUrl, "deny");
ok(/từ chối cấp quyền/.test(o.html), "người dùng bấm Từ chối được báo rõ", o.html?.slice(0, 300));
r = await admin("POST", `/api/connectors/${notesId}/connect`);
const firstAuth = r.j.authorizeUrl;
o = await oauth(admin, firstAuth);
ok(/Đã kết nối/.test(o.html) && /BroadcastChannel\("synchro-connector"\)/.test(o.html) && /postMessage/.test(o.html), "đăng nhập xong, trang báo về cửa sổ chính (qua BroadcastChannel vì COOP cắt window.opener)", o.html?.slice(0, 200));
const replay = await fetch(o.back, { headers: { cookie: admin.cookie() } }).then((x) => x.text());
ok(/đã dùng|hết hạn/.test(replay), "dùng lại state cũ bị chặn");
r = await admin("GET", "/api/connectors");
let notes = r.j.connectors.find((x) => x.id === notesId);
ok(notes?.status === "ok" && notes.tools.length === 3 && notes.auth === "oauth" && notes.serverName === "Mock Notes", "đã kết nối, 3 công cụ", JSON.stringify(notes).slice(0, 300));
ok(notes.tools.find((t) => t.name === "search_notes").perm === "allow" && notes.tools.find((t) => t.name === "create_note").perm === "ask" && notes.tools.find((t) => t.name === "delete_note").destructive, "quyền mặc định: chỉ đọc = luôn cho phép, ghi = hỏi trước");
ok(!JSON.stringify(r.j).match(/at_|rt_|code_verifier|client_secret/), "không lộ token/bí mật ra trình duyệt");

console.log("4. Máy chủ đời mới 2026-07-28 và SSE đời cũ");
r = await admin("POST", "/api/connectors", { name: "Mock Modern", url: `${MCP}/modern` });
ok(r.s === 200 && !r.j.authorizeUrl && r.j.connector.status === "ok" && r.j.connector.tools.length === 3, "modern: kết nối ngay, 3 công cụ", JSON.stringify(r.j).slice(0, 300));
r = await admin("POST", "/api/connectors", { name: "Mock SSE", url: `${MCP}/sse` });
ok(r.s === 200 && r.j.connector.status === "ok" && r.j.connector.tools[0]?.name === "echo", "SSE đời cũ: kết nối được", JSON.stringify(r.j).slice(0, 300));
r = await admin("POST", "/api/connectors", { name: "Trùng", url: `${MCP}/sse` });
ok(r.s === 400 && /rồi/.test(r.j.error), "thêm trùng địa chỉ bị chặn");

console.log("5. Dùng công cụ trong chat");
const C = "anthropic/claude-opus-5-5", O = "openai/gpt-6.1-sol", G = "google/gemini-3.8-flash";
r = await chat(admin, C, `Tìm ghi chú #tool=search_notes #args={"query":"Synchro"}`);
ok(r.s === 200 && /Kế hoạch ra mắt/.test(r.j.text) && r.j.skills?.some((u) => u.kind === "tool" && /Mock Notes/.test(u.name)), "Claude gọi công cụ chỉ đọc (luôn cho phép), trả lời theo kết quả", JSON.stringify(r.j).slice(0, 300));
r = await chat(admin, O, `Tạo ghi chú #tool=create_note #args={"title":"Từ GPT"}`);
ok(r.s === 200 && r.j.approval?.calls?.[0]?.tool?.name === "create_note" && r.j.approval.calls[0].connector.name === "Mock Notes" && r.j.approval.calls[0].input.title === "Từ GPT", "công cụ ghi dừng lại chờ duyệt", JSON.stringify(r.j).slice(0, 300));
let ap = r.j.approval;
r = await resume(member, ap.id, { [ap.calls[0].id]: "allow" });
ok(r.s === 410, "người khác không tiếp tục được lượt chờ duyệt của mình");
r = await resume(admin, ap.id, { [ap.calls[0].id]: "deny" });
ok(r.s === 200 && /từ chối/.test(r.j.text), "Từ chối: model nhận kết quả bị từ chối", JSON.stringify(r.j).slice(0, 300));
r = await resume(admin, ap.id, {});
ok(r.s === 410, "lượt chờ duyệt chỉ dùng được một lần");
r = await chat(admin, C, `#tool=search_notes #args={"query":"Từ GPT"}`);
ok(/Không có ghi chú/.test(r.j.text), "bị từ chối thì không tạo ghi chú", r.j.text);
r = await chat(admin, O, `#tool=create_note #args={"title":"Lần hai"}`);
r = await resume(admin, r.j.approval.id, { [r.j.approval.calls[0].id]: "allow" });
ok(r.s === 200 && /Đã tạo ghi chú/.test(r.j.text), "Cho phép một lần: công cụ chạy", JSON.stringify(r.j).slice(0, 300));
r = await chat(admin, O, `#tool=create_note #args={"title":"Lần ba"}`);
ok(!!r.j.approval, "cho phép một lần không lưu, lần sau vẫn hỏi");
r = await resume(admin, r.j.approval.id, { [r.j.approval.calls[0].id]: "always" });
ok(/Đã tạo ghi chú/.test(r.j.text ?? ""), "Luôn cho phép: chạy và lưu quyền");
r = await chat(admin, O, `#tool=create_note #args={"title":"Lần bốn"}`);
ok(r.s === 200 && !r.j.approval && /Đã tạo ghi chú/.test(r.j.text), "sau Luôn cho phép không hỏi lại", JSON.stringify(r.j).slice(0, 200));
r = await admin("GET", "/api/connectors");
ok(r.j.connectors.find((x) => x.id === notesId).tools.find((t) => t.name === "create_note").perm === "allow", "quyền đã lưu là luôn cho phép");
r = await chat(admin, C, `#tool=delete_note #args={"id":"n2"}`);
ok(r.j.approval?.calls?.[0]?.tool?.destructive === true, "công cụ xóa được đánh dấu nguy hiểm khi hỏi", JSON.stringify(r.j).slice(0, 200));
await resume(admin, r.j.approval.id, { [r.j.approval.calls[0].id]: "deny" });
r = await chat(admin, G, `Tra vùng #tool=lookup_region #args={"region":"ap-đông-nam"}`);
ok(r.s === 200 && /Vùng ap-đông-nam: hoạt động bình thường/.test(r.j.text), "Gemini gọi công cụ máy chủ 2026 (header Mcp-Param mã hóa base64)", JSON.stringify(r.j).slice(0, 300));
r = await chat(admin, C, `#tool=echo #args={"text":"xin chào SSE"}`);
ok(r.s === 200 && /Echo: xin chào SSE/.test(r.j.text), "gọi công cụ qua SSE đời cũ", JSON.stringify(r.j).slice(0, 300));

console.log("6. Token hết hạn → tự làm mới");
await fetch(`${MCP}/__expire`, { method: "POST" });
r = await chat(admin, C, `#tool=search_notes #args={"query":"Lần"}`);
ok(r.s === 200 && /Lần hai/.test(r.j.text), "token hết hạn được làm mới, công cụ vẫn chạy", JSON.stringify(r.j).slice(0, 300));
r = await admin("GET", "/api/connectors");
ok(r.j.connectors.find((x) => x.id === notesId).status === "ok", "connector vẫn ở trạng thái đã kết nối");

console.log("7. Chặn, tắt, quyền theo nhóm");
r = await admin("PATCH", `/api/connectors/${notesId}`, { perms: { search_notes: "block" } });
ok(r.s === 200 && r.j.connector.tools.find((t) => t.name === "search_notes").perm === "block", "chặn một công cụ");
r = await chat(admin, C, `#tool=search_notes #args={"query":"Synchro"}`);
ok(r.s === 200 && !/Kế hoạch ra mắt/.test(r.j.text ?? ""), "công cụ bị chặn không được đưa cho model", JSON.stringify(r.j).slice(0, 200));
r = await admin("PATCH", `/api/connectors/${notesId}`, { group: { kind: "write", perm: "ask" } });
ok(r.j.connector.tools.filter((t) => !t.readOnly).every((t) => t.perm === "ask"), "đặt quyền cho cả nhóm công cụ ghi");
r = await admin("PATCH", `/api/connectors/${notesId}`, { perms: { search_notes: "allow", khong_co: "allow" } });
ok(!r.j.connector.tools.some((t) => t.name === "khong_co"), "bỏ qua tên công cụ không tồn tại");
r = await admin("PATCH", `/api/connectors/${notesId}`, { enabled: false });
r = await chat(admin, C, `#tool=search_notes #args={"query":"Synchro"}`);
ok(!/Kế hoạch ra mắt/.test(r.j.text ?? ""), "tắt connector thì model không dùng được");
await admin("PATCH", `/api/connectors/${notesId}`, { enabled: true });

console.log("8. Tách biệt tài khoản");
r = await member("GET", "/api/connectors");
ok(r.s === 200 && r.j.connectors.length === 0, "tài khoản khác không thấy connector của mình");
r = await member("PATCH", `/api/connectors/${notesId}`, { enabled: false });
ok(r.s === 404, "tài khoản khác không sửa được connector của mình");
r = await member("DELETE", `/api/connectors/${notesId}`);
ok(r.s === 404, "tài khoản khác không xóa được connector của mình");
r = await chat(member, C, `#tool=search_notes #args={"query":"Synchro"}`);
ok(r.s === 200 && !/Kế hoạch ra mắt/.test(r.j.text ?? ""), "chat của tài khoản khác không dùng connector của mình");

console.log("9. Connector thật trên Internet (không cần đăng nhập)");
r = await admin("POST", "/api/connectors", { dir: "deepwiki" });
ok(r.s === 200 && r.j.connector?.status === "ok" && r.j.connector.tools.length > 0, `DeepWiki thật: ${r.j.connector?.tools?.map((t) => t.name).join(", ")}`, JSON.stringify(r.j).slice(0, 300));
r = await chat(admin, C, `#tool=read_wiki_structure #args={"repoName":"modelcontextprotocol/modelcontextprotocol"}`);
// Máy chủ không khai báo mà tên rõ là đọc (read_): dùng luôn. Nếu DeepWiki có khai báo là công cụ ghi thì vẫn hỏi; không cảnh báo xóa dữ liệu.
if (r.j.approval) {
  ok(r.j.approval.calls[0].tool.destructive === false, "công cụ DeepWiki: hỏi trước nhưng không cảnh báo xóa dữ liệu", JSON.stringify(r.j).slice(0, 300));
  r = await resume(admin, r.j.approval.id, { [r.j.approval.calls[0].id]: "allow" });
}
ok(r.s === 200 && /Đã gọi công cụ deepwiki__read_wiki_structure/.test(r.j.text) && r.j.text.length > 80, "gọi công cụ DeepWiki thật trong chat", JSON.stringify(r.j).slice(0, 400));
console.log("     ↳", r.j.text?.slice(0, 160).replace(/\n/g, " "));
r = await admin("POST", "/api/connectors", { dir: "context7" });
ok(r.s === 200 && r.j.connector?.status === "ok", `Context7 thật: ${r.j.connector?.tools?.map((t) => t.name).join(", ")}`, JSON.stringify(r.j).slice(0, 300));
r = await admin("POST", "/api/connectors", { dir: "notion" });
ok(r.s === 200 && /^https:\/\/mcp\.notion\.com\//.test(r.j.authorizeUrl ?? "") && new URL(r.j.authorizeUrl).searchParams.get("code_challenge_method") === "S256", "Notion thật: tìm được máy chủ đăng nhập, tự đăng ký Synchro, ra trang đăng nhập Notion", JSON.stringify(r.j).slice(0, 300));

console.log("10. Làm mới và gỡ");
r = await admin("POST", `/api/connectors/${notesId}/refresh`);
ok(r.s === 200 && r.j.connector.tools.length === 3, "làm mới danh sách công cụ");
r = await admin("DELETE", `/api/connectors/${notesId}`);
ok(r.s === 200 && !r.j.connectors.some((x) => x.id === notesId), "gỡ connector");
r = await chat(admin, C, `#tool=create_note #args={"title":"Sau khi gỡ"}`);
ok(r.s === 200 && !r.j.approval && !/Đã tạo ghi chú/.test(r.j.text ?? ""), "connector đã gỡ không còn công cụ");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
