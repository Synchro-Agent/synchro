// Không bao giờ chỉ "Mình sẽ…" rồi im lặng: model báo sẽ làm mà lượt dừng khi chưa dùng công cụ nào thì Synchro nhắc làm tiếp
// (app/stall.ts), với mọi model — khóa API (Claude, GPT, Gemini), gói subscription (Claude Code, Codex, Antigravity) — ở chat và
// Synchro Code; Antigravity 1.4.11 gọi công cụ MCP nạp khi cần qua CallMcpTool vẫn được phép, bị agy tự chặn thì báo rõ.
// [mock:stall] trong câu hỏi: model giả lượt đầu chỉ báo "Mình sẽ mở trình duyệt và làm ngay." (không gọi công cụ).
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010", PAGE = `${M}/_fixture/browser-quiz`;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), me = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
await me("POST", "/api/auth/signup", { email: "stall@synchro.test", password: "Member-pass-123", profile: { fullName: "Stall Tester", birthDate: "2000-01-01" } });
await me("POST", "/api/auth/login", { email: "stall@synchro.test", password: "Member-pass-123" });
const row = (await admin("GET", "/api/admin")).j.users.find((x) => x.email === "stall@synchro.test");
await admin("PATCH", `/api/admin/users/${row.id}`, { action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(row.perms.features).map((k) => [k, true])) } });
await me("DELETE", "/api/brain");
const STALL = "Mình sẽ mở trình duyệt và làm ngay.";
const PLAN = (tag) => `Ghi việc ${tag} [mock:stall] #tool=update_plan #args={"items":[{"content":"Buoc ${tag}","status":"in_progress"}]}`;
// Lượt chạy bền: nhận mã lượt rồi đọc tới khi xong (kết quả, nhật ký làm việc).
const run = async (body, c = me) => {
  const r0 = await c("POST", "/api/llm", { async: true, skills: true, system: "", conv: `stall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...body });
  const id = typeof r0.j?.run === "string" ? r0.j.run : r0.j?.run?.id ?? r0.j?.id;
  if (!id) return { s: r0.s, j: r0.j, text: String(r0.j?.text ?? ""), events: [] };
  let rn = null;
  for (let i = 0; i < 240; i++) { rn = (await c("GET", `/api/runs/${id}?json=1`)).j?.run; if (rn && !["running", "queued", "pending"].includes(rn.status)) break; await sleep(500); }
  return { s: rn?.http ?? 0, j: rn, text: String(rn?.result?.text ?? ""), events: rn?.events ?? [] };
};
const hist = async () => (await fetch(`${M}/_debug/hist`)).json();
const code = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];

console.log("1. Khóa API: lượt chỉ báo sẽ làm → Synchro nhắc, model làm thật bằng công cụ");
for (const [model, vendor] of [["anthropic/claude-haiku-5-5", "anthropic"], ["openai/gpt-6.1-sol", "openai"], ["google/gemini-3.8-flash", "google"]]) {
  const tag = `${vendor}-${Date.now().toString(36)}`;
  const r = await run({ model, messages: [{ role: "user", content: PLAN(tag) }] });
  const H = await hist();
  // Lượt chính (có công cụ), không phải lời gọi nền như đặt tên đoạn chat.
  const sent = JSON.stringify([...(H[vendor] ?? [])].reverse().find((x) => x.tools?.length && JSON.stringify(x).includes(tag)) ?? {});
  ok(r.s === 200 && /Đã gọi công cụ update_plan/.test(r.text) && r.text.trim() !== STALL && sent.includes("synchro_continue"), `${model}: không dừng sau câu dẫn, đã nhắc và làm xong`, { text: r.text.slice(0, 200), nudged: sent.includes("synchro_continue") });
  ok(r.events.some((e) => e.kind === "say" && e.text === STALL), `${model}: câu dẫn vẫn hiện trong nhật ký làm việc`, r.events);
}
{
  const hi = `Chào bạn ${Date.now().toString(36)}, hôm nay thế nào?`;
  const r = await run({ model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: hi }] });
  const mine = ((await hist()).anthropic ?? []).filter((x) => JSON.stringify(x.messages ?? "").includes(hi));
  ok(r.s === 200 && mine.length >= 1 && !mine.some((x) => JSON.stringify(x).includes("synchro_continue")) && !r.events.some((e) => e.kind === "say"), "câu trả lời bình thường không bị nhắc thêm", { n: mine.length, text: r.text.slice(0, 80) });
}

console.log("2. Gói subscription: Claude Code, Codex, Antigravity");
// Gói Claude đăng nhập bằng tài khoản quản trị (như các bài kiểm thử khác); Codex, Antigravity bằng tài khoản thử.
await admin("POST", "/api/engines/claude/login/start", {});
await admin("POST", "/api/engines/claude/login/code", { code: await code("claude") });
for (let i = 0; i < 20 && !(await admin("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn; i++) await sleep(500);
const cx = await me("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${cx.j?.userCode}`);
for (let i = 0; i < 20 && !(await me("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn; i++) await sleep(500);
await me("POST", "/api/engines/agy/login/start", {});
await me("POST", "/api/engines/agy/login/code", { code: await code("agy") });
for (let i = 0; i < 20 && !(await me("GET", "/api/engines/agy/status?fresh=1")).j?.loggedIn; i++) await sleep(500);
ok((await admin("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn, "đã đăng nhập gói Claude (giả lập)");
for (const model of ["sub-claude/sonnet", "sub-codex/gpt-6.1-sol", "sub-agy/gemini-3.8-flash"]) {
  const tag = model.split("/")[0];
  const r = await run({ model, messages: [{ role: "user", content: PLAN(tag) }] }, model.startsWith("sub-claude") ? admin : me);
  ok(r.s === 200 && /\[đã dùng update_plan/.test(r.text) && !r.text.startsWith(STALL), `${model}: không dừng sau câu dẫn, đã nhắc trong cùng phiên và làm xong`, { s: r.s, text: r.text.slice(0, 240), err: r.j?.result?.error ?? r.j?.error });
}
{
  const r = await run({ model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Ghi việc [mock:ondemand] #tool=update_plan #args={"items":[{"content":"Nap khi can","status":"in_progress"}]}' }] });
  ok(/\[đã dùng update_plan qua CallMcpTool/.test(r.text), "Antigravity 1.4.11: công cụ nạp khi cần (CallMcpTool) vẫn chạy", r.text.slice(0, 200));
  // Antigravity tự chặn công cụ dựng sẵn của nó: Synchro nhắc dùng công cụ của Synchro → lượt làm xong (như tin đầu "tóm tắt video").
  const d = await run({ model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Mở trang [mock:deny] #tool=browser_tabs #args={"op":"list"}' }] });
  ok(/\[đã dùng browser_tabs/.test(d.text), "Antigravity tự chặn công cụ của nó → nhắc dùng công cụ của Synchro, làm xong", JSON.stringify(d.j).slice(0, 300));
  // Nhắc hết lượt vẫn bị chặn: báo rõ, không im lặng.
  const dd = await run({ model: "sub-agy/gemini-3.8-flash", messages: [{ role: "user", content: 'Mở trang [mock:denyall] #tool=browser_tabs #args={"op":"list"}' }] });
  ok(/Antigravity tự chặn công cụ/.test(JSON.stringify(dd.j)), "vẫn bị chặn sau khi nhắc → báo rõ, không im lặng", JSON.stringify(dd.j).slice(0, 300));
}

console.log("3. Trình duyệt của Synchro: lượt dừng sau câu dẫn được nhắc, rồi mở trang thật");
const caps = (await me("GET", "/api/caps")).j?.caps ?? {};
if (!caps.browse) await me("PATCH", "/api/caps", { browse: true });
{
  const r = await run({ model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: `Mở trang [mock:stall] #tool=browser_navigate #args={"url":"${PAGE}","browser":"synchro"}` }] });
  ok(r.s === 200 && /Đã gọi công cụ browser_navigate/.test(r.text) && /browser-quiz|Bài kiểm tra|quiz/i.test(r.text), "mở trang bằng trình duyệt của Synchro sau khi được nhắc", r.text.slice(0, 300));
}

console.log("4. Synchro Code: agent không dừng sau câu dẫn (khóa API lẫn gói)");
const turn = async (text, model, c = me) => {
  const r = await fetch(`${B}/api/agent`, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie: c.cookie() },
    body: JSON.stringify({ sid: String(1797000000000 + Math.floor(Math.random() * 1e9)), model, messages: [{ role: "user", content: text }], skills: false, perm: { mode: "auto", allow: [] } }) });
  const out = await r.text();
  return out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
};
for (const model of ["anthropic/claude-haiku-5-5", "sub-claude/sonnet"]) {
  const ev = await turn(PLAN(`code-${model.split("/")[0]}`), model, model.startsWith("sub-claude") ? admin : me);
  ok(ev.some((e) => e.t === "plan" || (e.t === "tool" && e.name === "update_plan")) && ev.some((e) => e.t === "done"), `${model}: agent được nhắc và gọi công cụ`, ev.map((e) => e.t + (e.name ? `:${e.name}` : "")).join(" "));
}

for (const cli of ["codex", "agy"]) await me("POST", `/api/engines/${cli}/logout`);
await admin("POST", "/api/engines/claude/logout");
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
