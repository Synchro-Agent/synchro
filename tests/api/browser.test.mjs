// Trình duyệt của Synchro: mọi model (khóa API Claude / ChatGPT / Gemini, gói subscription qua cầu nối MCP) tự thao tác trên web
// khi người dùng nhờ. Workspace giả lập chạy Chrome thật trên máy (scripts/mock-workspace.mjs); trang mẫu là bài kiểm tra
// tests/fixtures/browser-quiz.html (máy chủ giả lập phục vụ ở /_fixture/browser-quiz). Máy không có Chrome thì bỏ qua phần chạy thật.
import { findChrome } from "../../scripts/mock-workspace.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010", PAGE = `${MOCK}/_fixture/browser-quiz`;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
function client(init = "") {
  let cookie = init;
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await member("POST", "/api/auth/signup", { email: "browser-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Browser Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "browser-member@synchro.test", password: "Member-pass-123" });
const memberRow = async () => (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "browser-member@synchro.test");
const setFeatures = async (features) => {
  const u = await memberRow();
  await admin("PATCH", `/api/admin/users/${u.id}`, { action: "set_perms", perms: { models: ["*"], features: { ...Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])), ...features } } });
};
const last = async () => (await fetch(`${MOCK}/_debug/last`)).json();
const ask = (c, model, text, extra = {}) => c("POST", "/api/llm", { system: "", model, skills: true, messages: [{ role: "user", content: text }], ...extra });
const TASK = `#browser mở ${PAGE} rồi làm bài giúp mình`;
const chrome = findChrome();

console.log("1. Trình duyệt dùng được khi có workspace và quyền Synchro Code + Cloud sandbox");
await setFeatures({});
let r = await member("GET", "/api/browser");
ok(r.s === 200 && r.j.available === true && r.j.control === true, "GET /api/browser: dùng được, đang bật điều khiển", JSON.stringify(r.j));
r = await member("POST", "/api/browser", { op: "ticket" });
ok(r.s === 200 && /\/ws-agent\/screen\?t=[\w-]+\.[\w-]+$/.test(r.j?.url ?? ""), "vé màn hình trực tiếp", JSON.stringify(r.j));
await setFeatures({ sandbox: false });
r = await member("GET", "/api/browser");
ok(r.s === 200 && r.j.available === false && /Cloud sandbox/.test(r.j.reason ?? ""), "không có Cloud sandbox → khóa, kèm lý do", JSON.stringify(r.j));
ok((await member("POST", "/api/browser", { op: "ticket" })).s === 403, "không có quyền → không cấp vé");
r = await ask(member, "anthropic/claude-haiku-5-5", TASK);
ok(r.s === 200 && !(await last()).anthropic.tools?.some((t) => t.name?.startsWith("browser_")), "không có quyền → model không nhận công cụ trình duyệt", JSON.stringify(r.j).slice(0, 200));
await setFeatures({});

console.log("2. Công cụ trình duyệt luôn có khi bật, phần đầu prompt giữ nguyên giữa các câu hỏi (đọc lại từ bộ đệm)");
r = await ask(member, "anthropic/claude-haiku-5-5", "Giải thích ngắn gọn lãi kép là gì?");
const A1 = await last();
ok(A1.anthropic.tools?.some((t) => t.name === "browser_batch") && /<browser>/.test(JSON.stringify(A1.anthropic.system)), "có công cụ và hướng dẫn trình duyệt");
ok(r.s === 200 && !/trình duyệt/.test(r.j?.text ?? ""), "câu hỏi kiến thức: model không tự mở trình duyệt", JSON.stringify(r.j).slice(0, 200));
await ask(member, "anthropic/claude-haiku-5-5", "Làm trang web cho quán cà phê");
const A2 = await last();
ok(JSON.stringify(A1.anthropic.tools) === JSON.stringify(A2.anthropic.tools) && JSON.stringify(A1.anthropic.system) === JSON.stringify(A2.anthropic.system), "hai câu hỏi khác nhau: công cụ và phần đầu prompt giống hệt");

if (!chrome) {
  console.log("  (máy này không có Chrome / Chromium: bỏ qua phần chạy trình duyệt thật)");
} else {
  console.log("3. Model khóa API tự làm xong bài trên trang (mở → đọc → điền / chọn / bấm → kiểm tra)");
  for (const model of ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna", "google/gemini-3.8-flash"]) {
    const t0 = Date.now();
    r = await ask(member, model, TASK);
    ok(r.s === 200 && /Đã làm xong trên trình duyệt/.test(r.j?.text ?? "") && /6\/6 thao tác/.test(r.j.text) && /Trang cuối: Đã nộp bài/.test(r.j.text), `${model}: làm 6/6 thao tác, trang cuối "Đã nộp bài" (${Date.now() - t0} ms)`, JSON.stringify(r.j).slice(0, 400));
  }
  // Đúng yêu cầu của lượt làm bài (lời gọi chạy nền sau đó như rút bộ nhớ, đặt tên đoạn chat có thể là yêu cầu gần nhất).
  const H = await (await fetch(`${MOCK}/_debug/hist`)).json();
  const turnOf = (v) => [...(H[v] ?? [])].reverse().find((b) => JSON.stringify(b.messages ?? b.input ?? "").includes("Đã làm 6/6 thao tác"));
  const L = { anthropic: turnOf("anthropic") ?? { messages: [] }, openai: turnOf("openai"), google: turnOf("google") };
  const tr = L.anthropic.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
  ok(tr.some((b) => Array.isArray(b.content) && b.content.some((x) => x.type === "image" && x.source?.data?.length > 1000)), "Claude nhận ảnh chụp trình duyệt (khối image trong tool_result)");
  const batch = tr.map((b) => (typeof b.content === "string" ? b.content : "")).find((t) => t.startsWith("Đã làm 6/6 thao tác"));
  ok(!!batch && /select: xong → 12A2/.test(batch) && /Trang hiện tại: "Đã nộp bài"/.test(batch), "kết quả browser_batch: từng thao tác và trang cuối", batch ?? JSON.stringify(tr).slice(0, 400));
  const read = JSON.stringify(L.anthropic.messages).match(/\[\d+\] clickable \\"B\. goes\\"/);
  ok(!!read || JSON.stringify(L.anthropic.messages).includes("Đã lược kết quả cũ"), "đọc trang thấy cả đáp án dạng thẻ div (clickable) có [ref]");
  const oai = L.openai?.input ?? [];
  ok(oai.some((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((c) => c.type === "input_image")), "ChatGPT (Responses) nhận ảnh chụp qua tin input_image ngay sau kết quả công cụ", JSON.stringify(oai.map((x) => x.type ?? x.role)).slice(0, 300));
  const gem = L.google?.messages ?? [];
  ok(gem.some((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")), "Gemini nhận ảnh chụp qua tin image_url", JSON.stringify(gem.map((m) => m.role)).slice(0, 300));

  console.log("4. Gói subscription (Claude Code) dùng công cụ trình duyệt qua cầu nối MCP");
  const code = async () => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${MOCK}/mock-login/claude`).then((x) => x.text()))?.[1];
  await member("POST", "/api/engines/claude/login/start", {});
  const lg = await member("POST", "/api/engines/claude/login/code", { code: await code() });
  ok(lg.s === 200, "đăng nhập gói Claude (giả lập)", JSON.stringify(lg.j));
  r = await ask(member, "sub-claude/sonnet", `#browser #tool=browser_navigate #args={"url":"${PAGE}"}`);
  ok(r.s === 200 && /đã dùng browser_navigate: Đã mở trang\..*Bài kiểm tra thử/.test(r.j?.text ?? ""), "Claude Code gọi mcp__synchro__browser_navigate và nhận kết quả", JSON.stringify(r.j).slice(0, 400));
  r = await ask(member, "sub-claude/sonnet", `#browser #tool=browser_find #args={"query":"goes"}`);
  ok(r.s === 200 && /B\. goes/.test(r.j?.text ?? ""), "browser_find qua MCP tìm thấy đáp án", JSON.stringify(r.j).slice(0, 400));

  console.log("5. Cài đặt → Khả năng → Điều khiển trình duyệt tắt thì model không còn công cụ trình duyệt");
  await member("PATCH", "/api/caps", { browse: false });
  r = await ask(member, "anthropic/claude-haiku-5-5", TASK);
  ok(r.s === 200 && !/Đã làm xong trên trình duyệt/.test(r.j?.text ?? "") && !(await last()).anthropic.tools?.some((t) => t.name?.startsWith("browser_")), "tắt → không có công cụ trình duyệt", JSON.stringify(r.j).slice(0, 200));
  await member("PATCH", "/api/caps", { browse: true });
  ok((await member("GET", "/api/caps")).j?.caps?.browse === true, "bật lại → caps.browse = true");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
