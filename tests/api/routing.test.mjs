// Giảm chi phí model: chế độ Tự động chọn model theo độ khó; yêu cầu gửi Anthropic có điểm đệm prompt ở cuối lịch sử.
const B = "http://localhost:3200", MOCK = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
// run-all đăng nhập quản trị một lần rồi chia phiên (tránh giới hạn số lần đăng nhập); chạy riêng lẻ thì tự đăng nhập.
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const member = admin;
// Model hiện ở bộ chọn (Cài đặt → API → Model picker): chế độ Tự động chỉ chọn trong các model này.
const before = (await admin("GET", "/api/admin/apikeys")).j?.main ?? ["*"];
const setShown = (main) => admin("POST", "/api/admin/apikeys", { action: "main", main });
await setShown(["*"]);
const ask = (c, text, extra = {}) => c("POST", "/api/llm", { system: "", model: "auto", skills: true, messages: [{ role: "user", content: text }], ...extra });
const last = async () => (await fetch(`${MOCK}/_debug/last`)).json();

console.log("1. Chế độ Tự động chọn model theo độ khó");
let r = await ask(member, "Xin chào");
ok(r.s === 200 && r.j.auto?.tier === "fast" && /haiku|flash|luna|mini|lite|nano/i.test(r.j.model), `câu chào → model nhanh: ${r.j?.model}`, JSON.stringify(r.j).slice(0, 300));
r = await ask(member, "Làm trang web cho quán cà phê");
ok(r.s === 200 && r.j.auto?.tier === "strong" && /opus|fable|astra|argon/i.test(r.j.model), `làm trang web → model mạnh: ${r.j?.model} (${r.j?.auto?.why?.join(", ")})`, JSON.stringify(r.j).slice(0, 300));
ok(/<artifact/.test(r.j.text ?? ""), "câu trả lời vẫn đầy đủ (artifact) khi chạy qua chế độ Tự động");
r = await ask(member, "Giải thích ngắn gọn khái niệm lãi kép là gì?");
ok(r.s === 200 && r.j.auto && r.j.auto.tier !== "strong", `câu hỏi kiến thức ngắn → không dùng model mạnh nhất: ${r.j?.model}`, JSON.stringify(r.j?.auto));
r = await ask(member, "Đọc giúp tôi tệp này", { messages: [{ role: "user", content: [{ type: "text", text: "Tóm tắt tài liệu đính kèm" }, { type: "image", media_type: "image/png", data: "iVBORw0KGgo=" }] }] });
ok(r.s === 200 && r.j.auto?.why?.includes("có tệp đính kèm"), `có tệp đính kèm được tính là khó hơn: ${r.j?.model}`, JSON.stringify(r.j?.auto));

console.log("2. Chỉ chọn trong model đang hiện ở bộ chọn");
// Bộ chọn chỉ có model nhanh và model cân bằng: việc khó dùng model mạnh nhất có trong danh sách.
await setShown(["anthropic/claude-haiku-5-5", "openai/gpt-6.1-sol"]);
r = await ask(member, "Làm trang web cho quán cà phê");
ok(r.s === 200 && r.j.model === "openai/gpt-6.1-sol", `bộ chọn chỉ có Haiku và GPT-6.1 Sol → việc khó dùng Sol: ${r.j?.model}`, JSON.stringify(r.j).slice(0, 200));
r = await ask(member, "Xin chào");
ok(r.s === 200 && r.j.model === "anthropic/claude-haiku-5-5", `… còn câu chào vẫn dùng Haiku: ${r.j?.model}`);
await setShown([]);
r = await ask(member, "Xin chào");
ok(r.s === 503 && /bộ chọn model/.test(r.j?.error ?? ""), "bộ chọn không có model nào → báo lỗi rõ ràng", JSON.stringify(r.j));
await setShown(before);

console.log("3. Bộ nhớ đệm prompt (Anthropic)");
r = await member("POST", "/api/llm", { system: "", model: "anthropic/claude-opus-5-5", skills: true, messages: [{ role: "user", content: "Câu một" }, { role: "assistant", content: "Trả lời một" }, { role: "user", content: "Làm trang web cho quán cà phê" }] });
const L = (await last()).anthropic;
const lastMsg = L?.messages?.[L.messages.length - 1];
const lastBlock = Array.isArray(lastMsg?.content) ? lastMsg.content[lastMsg.content.length - 1] : null;
ok(lastBlock?.cache_control?.type === "ephemeral", "điểm đệm ở cuối tin nhắn mới nhất", JSON.stringify(lastMsg).slice(0, 300));
ok(Array.isArray(L?.system) && L.system.some((b) => b.cache_control), "điểm đệm ở cuối phần hướng dẫn hệ thống + danh mục skill");
const marks = JSON.stringify(L).match(/"cache_control"/g)?.length ?? 0;
ok(marks <= 4, `không vượt giới hạn 4 điểm đệm của Anthropic (${marks})`);
r = await member("POST", "/api/llm", { system: "Bạn là trợ lý.", model: "anthropic/claude-opus-5-5", messages: [{ role: "user", content: "Xin chào" }] });
const L2 = (await last()).anthropic;
ok(Array.isArray(L2?.system) && L2.system[0]?.cache_control && JSON.stringify(L2.messages).includes("cache_control"), "lượt gọi đơn giản (không skill) cũng có điểm đệm", JSON.stringify(L2).slice(0, 300));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
