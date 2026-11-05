// Khóa Anthropic không gắn với workspace: tự dùng khi chỉ có một, hỏi khi có nhiều, gửi đúng header khi gọi model. Cần dev:mock đang chạy ở :3200.
const B = "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
let cookie = "";
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: body ? JSON.stringify(body) : undefined }); const c = r.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const base = (await api("GET", "/api/admin/apikeys")).j.providers.find((p) => p.id === "anthropic").baseUrl;
const save = (key, workspaceId) => api("POST", "/api/admin/apikeys", { id: "anthropic", key, baseUrl: base, name: "Claude", ...(workspaceId !== undefined ? { workspaceId } : {}) });
const cur = async () => (await api("GET", "/api/admin/apikeys")).j.providers.find((p) => p.id === "anthropic");
const ORIGINAL = "sk-ant-mock-local-0001";
try {
  let r = await save("sk-ant-mock-org-one-0001");
  let p = await cur();
  ok(r.s === 200 && p.workspaceId === "wrkspc_01Default0000" && p.models.length > 0, "một workspace: tự dùng, không hỏi", JSON.stringify(r.j?.error ?? p.workspaceId));
  const t = await api("POST", "/api/admin/apikeys/test", { model: "anthropic/claude-haiku-5-5", prompt: "ping" });
  ok(t.s === 200 && !t.j?.error, "gọi model bằng khóa này chạy được (máy giả lập từ chối nếu thiếu header workspace)", JSON.stringify(t.j));
  r = await save("sk-ant-mock-org-two-0001");
  ok(r.s === 400 && r.j?.needWorkspace === true && r.j.workspaces.map((w) => w.name).join() === "Default,Team", "nhiều workspace: hỏi, không tự chọn, bỏ workspace đã lưu trữ", JSON.stringify(r.j));
  ok(!/anthropic-workspace-id/.test(r.j?.error ?? ""), "thông báo nói bằng lời thường, không có tên header", r.j?.error);
  p = await cur();
  ok(p.keyHint.includes("0001") && p.workspaceId === "wrkspc_01Default0000", "chưa chọn thì không lưu khóa mới, khóa cũ còn nguyên", p.workspaceId);
  r = await save("sk-ant-mock-org-two-0001", "wrkspc_01Team000000");
  p = await cur();
  ok(r.s === 200 && p.workspaceId === "wrkspc_01Team000000", "chọn workspace rồi lưu được", JSON.stringify(r.j?.error));
  r = await api("POST", "/api/admin/apikeys", { action: "refresh", id: "anthropic" });
  p = await cur();
  ok(r.s === 200 && p.status === "ok" && p.workspaceId === "wrkspc_01Team000000", "làm mới vẫn gửi workspace đã lưu", JSON.stringify(r.j?.error ?? p.error));
  r = await save("sk-ant-mock-org-member-0001");
  ok(r.s === 400 && r.j?.needWorkspace === true && r.j.workspaces.length === 0, "không xem được danh sách: nhờ dán ID", JSON.stringify(r.j));
  r = await save("sk-ant-mock-org-member-0001", "abc");
  ok(r.s === 400 && /wrkspc_/.test(r.j?.error ?? "") && !r.j?.needWorkspace, "ID sai dạng: báo ngay, không gọi hãng", JSON.stringify(r.j));
  r = await save("sk-ant-mock-org-member-0001", "wrkspc_01Nope000000");
  ok(r.s === 400 && /Không tìm thấy workspace wrkspc_01Nope000000/.test(r.j?.error ?? ""), "workspace không tồn tại: nói rõ", JSON.stringify(r.j));
  r = await save(ORIGINAL);
  p = await cur();
  ok(r.s === 200 && p.workspaceId === "", "đổi sang khóa đã gắn workspace: không giữ workspace của khóa cũ", p.workspaceId);
} finally {
  await save(ORIGINAL, "");
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
