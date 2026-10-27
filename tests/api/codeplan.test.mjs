// Synchro Code chạy bằng gói subscription như bằng khóa API (npm run dev:mock, workspace giả lập, CLI giả lập):
// Claude Code, Codex, Antigravity làm việc trong workspace bằng đúng bộ công cụ của Synchro Code qua cầu nối MCP
// (sửa tệp, chạy lệnh, danh sách việc), sự kiện cho giao diện giống vòng lặp khóa API, tin nhắn thêm ghép vào giữa chừng.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const codeOf = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((r) => r.text()))?.[1];
// Một lượt Synchro Code: đọc NDJSON tới khi xong.
const turn = async (model, text, sid, o = {}) => {
  const r = await fetch(`${B}/api/agent`, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ sid, model, messages: [{ role: "user", content: text }] }) });
  if (!r.ok) return { status: r.status, events: [], error: (await r.json().catch(() => ({}))).error };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { const e = JSON.parse(l); events.push(e); o.onEvent?.(e); } }
  }
  return { status: r.status, events, done: events.find((e) => e.t === "done"), error: events.find((e) => e.t === "error")?.error };
};

for (const cli of ["claude", "codex", "agy"]) await api("POST", `/api/engines/${cli}/logout`);
console.log("1. Đăng nhập gói");
await api("POST", "/api/engines/claude/login/start", {});
ok((await api("POST", "/api/engines/claude/login/code", { code: await codeOf("claude") })).j?.state === "done", "Claude: đã đăng nhập gói");
const cx = await api("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${cx.j?.userCode}`);
for (let i = 0; i < 20; i++) { if ((await api("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn) break; await sleep(500); }
await api("POST", "/api/engines/agy/login/start", {});
ok((await api("POST", "/api/engines/agy/login/code", { code: await codeOf("agy") })).j?.state === "done", "Antigravity: đã đăng nhập gói");

console.log("2. Claude Code làm việc trong workspace qua công cụ của Synchro");
const sid = String(1790000000000 + Math.floor(Math.random() * 1e6));
let r = await turn("sub-claude/sonnet", 'Tạo tệp chào #tool=write_file #args={"path":"hello.txt","content":"xin chao"}', sid);
const tool = r.events.find((e) => e.t === "tool"), res = r.events.find((e) => e.t === "result");
ok(r.status === 200 && tool?.name === "write_file" && tool.input.path === "hello.txt" && res?.ok && res.diff?.path === "hello.txt", "gói Claude gọi write_file của Synchro Code: sự kiện công cụ, kết quả, số dòng thay đổi", JSON.stringify(r.events).slice(0, 500));
ok(r.events.some((e) => e.t === "text" && /write_file/.test(e.text)) && /đã dùng write_file: Đã tạo hello\.txt/.test(r.done?.text ?? ""), "lời dẫn trước công cụ và câu trả lời cuối như vòng lặp khóa API", JSON.stringify(r.done ?? r.error));
r = await turn("sub-claude/sonnet", 'Kiểm tra #tool=bash #args={"command":"cat hello.txt && echo $((6*7))","description":"Đọc tệp và tính thử"}', sid);
const out = r.events.find((e) => e.t === "result");
ok(out?.ok && /xin chao/.test(out.output) && /42/.test(out.output), "chạy lệnh trong workspace thấy tệp vừa tạo", JSON.stringify(out));

console.log("3. Codex và Antigravity dùng cùng bộ công cụ");
r = await turn("sub-codex/gpt-6.1-sol", 'Đọc tệp #tool=read_file #args={"path":"hello.txt"}', sid);
ok(r.events.some((e) => e.t === "result" && e.ok && /xin chao/.test(e.output)) && /đã dùng read_file/.test(r.done?.text ?? ""), "gói ChatGPT (Codex) đọc tệp qua Synchro Code", JSON.stringify(r.done ?? r.error ?? r.events).slice(0, 400));
r = await turn("sub-agy/gemini-3.8-flash", 'Liệt kê tệp #tool=list_files #args={}', sid);
ok(r.events.some((e) => e.t === "result" && e.ok && /hello\.txt/.test(e.output)) && /đã dùng list_files/.test(r.done?.text ?? ""), "gói Gemini (Antigravity) liệt kê tệp qua Synchro Code", JSON.stringify(r.done ?? r.error ?? r.events).slice(0, 400));
r = await turn("sub-claude/sonnet", 'Lên kế hoạch #tool=update_plan #args={"items":[{"content":"Buoc mot","status":"completed"},{"content":"Buoc hai","status":"in_progress"}]}', sid);
const plan = r.events.find((e) => e.t === "plan");
ok(plan?.items?.length === 2 && plan.items[1].status === "in_progress", "danh sách việc hiện trong giao diện", JSON.stringify(plan));

console.log("4. Nhắn thêm khi đang chạy bằng gói");
let steered = false;
r = await turn("sub-claude/sonnet", 'Chạy thử #tool=bash #args={"command":"sleep 3; echo xong","description":"Chờ một chút"}', sid, {
  onEvent: async (e) => { if (e.t === "tool" && !steered) { steered = true; await sleep(300); await api("POST", "/api/agent/steer", { sid, text: "Thêm một tệp README nữa nhé" }); } },
});
const st = r.events.find((e) => e.t === "steer");
ok(st?.text === "Thêm một tệp README nữa nhé" && r.events.indexOf(st) > r.events.findIndex((e) => e.t === "result") && /user_followup/.test(r.done?.text ?? ""), "tin nhắn thêm ghép vào kết quả công cụ, model đọc ngay ở bước kế tiếp (không ngắt việc)", JSON.stringify({ ev: r.events.map((e) => e.t), done: r.done?.text }).slice(0, 500));

for (const cli of ["claude", "codex", "agy"]) await api("POST", `/api/engines/${cli}/logout`);
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
