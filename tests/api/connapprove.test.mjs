// Connector trên gói CLI (đường thật trên máy chủ: không có khóa API): công cụ ghi hiện thẻ duyệt trong khung chat, lời gọi của CLI chờ câu trả lời,
// kết quả về lại model. Chạy trên cả bốn CLI giả lập. Kèm token tự nhập, hãng chưa duyệt Synchro, connector mất kết nối trong chat.
// Cần npm run dev:mock (web 3200, LLM giả 4010, MCP giả 4011).
const B = "http://localhost:3200", MCP = "http://127.0.0.1:4011", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const until = async (f, ms = 30_000, step = 250) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const code = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()))?.[1];
async function oauth(url) {
  const page = await fetch(url).then((r) => r.text());
  const link = /id="allow" href="([^"]+)"/.exec(page)[1].replace(/&amp;/g, "&");
  const back = (await fetch(link, { redirect: "manual" })).headers.get("location");
  return fetch(back, { headers: { cookie } }).then((r) => r.text());
}
const events = async (run) => (await api("GET", `/api/runs/${run}?json=1`)).j?.run;
const start = (model, text, conv) => api("POST", "/api/llm", { async: true, conv, model, skills: true, system: "", messages: [{ role: "user", content: text }] });
const askOf = async (run, skip = 0) => {
  const ev = await until(async () => (await events(run))?.events?.filter((e) => e.kind === "ask")[skip]);
  return ev ? JSON.parse(ev.text) : null;
};
const finished = (run) => until(async () => { const x = await events(run); return x?.status !== "running" ? x : null; }, 40_000);
const textOf = (fin) => String(fin?.result?.text ?? fin?.result?.json?.text ?? JSON.stringify(fin?.result ?? ""));

for (const x of (await api("GET", "/api/connectors")).j.connectors ?? []) await api("DELETE", `/api/connectors/${x.id}`);
let r = await api("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
const notesId = r.j.connector?.id;
await oauth(r.j.authorizeUrl);
const conn = async () => (await api("GET", "/api/connectors")).j.connectors.find((x) => x.id === notesId);
ok((await conn())?.status === "ok", "connector cần đăng nhập đã kết nối");

// Đăng nhập cả bốn gói giả lập.
await api("POST", "/api/engines/claude/login/start", {});
await api("POST", "/api/engines/claude/login/code", { code: await code("claude") });
const cx = await api("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${cx.j?.userCode}`);
await api("POST", "/api/engines/agy/login/start", {});
await api("POST", "/api/engines/agy/login/code", { code: await code("agy") });
const gk = await api("POST", "/api/engines/grok/login/start", {});
await fetch(`${M}/mock-login/grok/approve?code=${gk.j?.userCode}`);
for (const cli of ["claude", "codex", "agy", "grok"]) await until(async () => (await api("GET", `/api/engines/${cli}/status?fresh=1`)).j?.loggedIn, 15_000, 500);

try {
  const CLIS = [["claude", "sub-claude/sonnet"], ["codex", "sub-codex/gpt-6.1-sol"], ["agy", "sub-agy/gemini-3.8-flash"], ["grok", "sub-grok/grok-4.7"]];
  for (const [cli, model] of CLIS) {
    console.log(`${cli}: thẻ duyệt công cụ ghi`);
    const conv = `conn-${cli}-${Date.now()}`;
    await api("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "ask" } });
    // Từ chối: công cụ không chạy, model nhận kết quả bị từ chối, lượt kết thúc bình thường.
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Bị từ chối ${cli}"}`, conv);
    let run = r.j?.run;
    let a = await askOf(run);
    ok(a?.kind === "connector" && a.conn?.name === "Mock Notes" && a.tool === "create_note" && /Bị từ chối/.test(a.detail), "hiện thẻ duyệt với connector, công cụ, tham số", JSON.stringify(a ?? (await events(run))).slice(0, 400));
    if (a) ok((await api("POST", "/api/approve", { id: a.id, ok: false, note: "đừng tạo" })).s === 200, "trả lời Từ chối");
    let fin = await finished(run);
    ok(fin?.status === "done" && /từ chối/.test(textOf(fin)) && /đừng tạo/.test(textOf(fin)), "model nhận kết quả từ chối kèm lời nhắn; lượt kết thúc bình thường", `${fin?.status} ${textOf(fin)}`);
    ok(!/khóa API/.test(textOf(fin)), "không còn khuyên dùng model khóa API", textOf(fin));
    ok(fin?.events?.some((e) => e.kind === "asked" && JSON.parse(e.text).ok === false), "thẻ chuyển sang đã từ chối");
    // Cho phép một lần: chạy, lần sau vẫn hỏi.
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Một lần ${cli}"}`, conv);
    run = r.j?.run;
    a = await askOf(run);
    if (a) await api("POST", "/api/approve", { id: a.id, ok: true });
    fin = await finished(run);
    ok(/Đã tạo ghi chú/.test(textOf(fin)), "Cho phép một lần: công cụ chạy, kết quả về model", textOf(fin));
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Trong chat ${cli}"}`, conv);
    run = r.j?.run;
    a = await askOf(run);
    ok(!!a, "cho phép một lần không lưu: lần sau vẫn hỏi");
    // Cho phép trong đoạn chat: không hỏi lại trong đoạn chat này, đoạn chat khác vẫn hỏi.
    if (a) await api("POST", "/api/approve", { id: a.id, ok: true, chat: true });
    fin = await finished(run);
    ok(/Đã tạo ghi chú/.test(textOf(fin)) && fin.events.some((e) => e.kind === "asked" && JSON.parse(e.text).chat === true), "Cho phép trong đoạn chat: chạy", textOf(fin));
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Không hỏi lại ${cli}"}`, conv);
    fin = await finished(r.j?.run);
    ok(/Đã tạo ghi chú/.test(textOf(fin)) && !fin.events.some((e) => e.kind === "ask"), "cùng đoạn chat: không hỏi lại", textOf(fin));
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Đoạn khác ${cli}"}`, `${conv}-2`);
    run = r.j?.run;
    a = await askOf(run);
    ok(!!a, "đoạn chat khác: hỏi lại");
    // Luôn cho phép: lưu vào quyền của công cụ.
    if (a) await api("POST", "/api/approve", { id: a.id, ok: true, always: true });
    fin = await finished(run);
    ok(/Đã tạo ghi chú/.test(textOf(fin)) && (await conn()).tools.find((t) => t.name === "create_note").perm === "allow", "Luôn cho phép: chạy và lưu quyền", textOf(fin));
    r = await start(model, `#tool=mock_notes__create_note #args={"title":"Đã luôn cho phép ${cli}"}`, `${conv}-3`);
    fin = await finished(r.j?.run);
    ok(/Đã tạo ghi chú/.test(textOf(fin)) && !fin.events.some((e) => e.kind === "ask"), "sau Luôn cho phép: không hỏi nữa");
  }

  console.log("Thẻ dài và các trường hợp biên");
  await api("PATCH", `/api/connectors/${notesId}`, { perms: { create_note: "ask" } });
  r = await start("sub-claude/sonnet", `#tool=mock_notes__create_note #args=${JSON.stringify({ title: 'x"'.repeat(4000) })}`, `conn-long-${Date.now()}`);
  let run = r.j?.run;
  let a = await askOf(run);
  ok(a?.kind === "connector" && /không hiện ở đây/.test(a.detail), "tham số rất dài: thẻ vẫn hiện được, ghi rõ phần không hiện", JSON.stringify(a).slice(0, 200));
  if (a) await api("POST", "/api/approve", { id: a.id, ok: false });
  await finished(run);
  // Trả lời thẻ bằng lời: thẻ khép ngay, công cụ không chạy, model đọc được tin nhắn. Trên cả bốn CLI: tin nhắn đi theo kết quả công cụ qua cầu nối.
  for (const [cli, model] of [["claude", "sub-claude/sonnet"], ["codex", "sub-codex/gpt-6.1-sol"], ["agy", "sub-agy/gemini-3.8-flash"], ["grok", "sub-grok/grok-4.7"]]) {
    const title = `Bằng lời ${cli} ${Date.now()}`;
    r = await start(model, `#tool=mock_notes__create_note #args=${JSON.stringify({ title })}`, `conn-typed-${cli}-${Date.now()}`);
    run = r.j?.run;
    a = await askOf(run);
    const sent = await api("POST", `/api/runs/${run}`, { text: "đừng tạo nữa, đổi tiêu đề thành ABC" });
    ok(sent.j?.queued === true, `${cli}: tin nhắn thêm được nhận khi thẻ đang chờ`, JSON.stringify(sent));
    const fin = await finished(run);
    ok(fin?.status === "done" && fin.events.some((e) => e.kind === "asked" && JSON.parse(e.text).typed === true), `${cli}: thẻ khép vì tin nhắn, lượt không phải chờ người bấm`, `${fin?.status} ${JSON.stringify(fin?.events?.filter((e) => e.kind === "asked"))}`);
    ok(fin?.events.some((e) => e.kind === "steer" && /đổi tiêu đề thành ABC/.test(e.text)), `${cli}: tin nhắn hiện trong đoạn chat và tới model`, JSON.stringify(fin?.events?.map((e) => e.kind)));
    ok(!/Đã tạo ghi chú/.test(textOf(fin)), `${cli}: công cụ không chạy`, textOf(fin));
    ok((await api("POST", "/api/approve", { id: a?.id, ok: true })).s !== 200 || !/Đã tạo ghi chú/.test(textOf(await events(run))), `${cli}: bấm Cho phép muộn không chạy công cụ`);
  }
  // Dừng khi đang chờ duyệt: thôi chờ ngay, câu hỏi không còn hiệu lực.
  r = await start("sub-claude/sonnet", `#tool=mock_notes__create_note #args={"title":"Dừng"}`, `conn-stop-${Date.now()}`);
  run = r.j?.run;
  a = await askOf(run);
  await api("DELETE", `/api/runs/${run}`);
  const fin = await finished(run);
  ok(fin && fin.status !== "running", "bấm Dừng khi đang chờ duyệt: lượt không treo", fin?.status);
  ok((await api("POST", "/api/approve", { id: a?.id, ok: true })).s === 409, "câu hỏi hết hiệu lực sau khi dừng");
  // Lượt không chạy nền: không có khung chat để hỏi. Không treo, không khuyên khóa API.
  const t0 = Date.now();
  r = await api("POST", "/api/llm", { model: "sub-claude/sonnet", skills: true, system: "", messages: [{ role: "user", content: `#tool=mock_notes__create_note #args={"title":"Không hỏi"}` }] });
  ok(r.s === 200 && Date.now() - t0 < 25_000 && /khung chat/.test(JSON.stringify(r.j)) && !/khóa API/.test(JSON.stringify(r.j)), "lượt không có khung chat: báo rõ, không treo", JSON.stringify(r.j).slice(0, 300));

  console.log("Connector mất kết nối trong chat");
  await fetch(`${MCP}/__revoke`, { method: "POST" });
  await api("POST", `/api/connectors/${notesId}/refresh`);
  ok((await conn()).status === "needs_auth", "hãng thu hồi đăng nhập: cần kết nối lại", JSON.stringify(await conn()).slice(0, 200));
  r = await start("sub-claude/sonnet", "Mock Notes của mình có gì mới?", `conn-off-${Date.now()}`);
  let done = await finished(r.j?.run);
  const card = done?.events?.find((e) => e.kind === "conn");
  ok(card && JSON.parse(card.text).id === notesId, "người dùng nhắc tới connector: có nút Kết nối lại trong khung chat", JSON.stringify(done?.events ?? []).slice(0, 300));
  r = await start("sub-claude/sonnet", `#tool=connector_reconnect #args={"connector":"Mock Notes"}`, `conn-off2-${Date.now()}`);
  done = await finished(r.j?.run);
  ok(done?.events?.some((e) => e.kind === "conn") && /Kết nối lại/.test(textOf(done)), "model tự gọi nút kết nối lại khi câu hỏi cần connector", textOf(done));
  r = await api("POST", `/api/connectors/${notesId}/connect`);
  ok(/authorize/.test(r.j?.authorizeUrl ?? ""), "Kết nối lại: ra trang đăng nhập", JSON.stringify(r.j).slice(0, 200));
  await oauth(r.j.authorizeUrl);
  ok((await conn()).status === "ok", "đăng nhập xong: dùng lại được");
  r = await api("POST", `/api/connectors/${notesId}/connect`, { force: true });
  ok(/authorize/.test(r.j?.authorizeUrl ?? "") && r.j.connector.status === "ok", "Đăng nhập lại khi đang tốt: ra trang đăng nhập, giữ kết nối cũ", JSON.stringify(r.j).slice(0, 200));

  console.log("Token / API key");
  r = await api("POST", "/api/connectors", { name: "Công ty", url: `${MCP.replace("127.0.0.1", "localhost")}/apikey` });
  ok(r.s >= 400 && /token hoặc API key/.test(r.j?.error ?? ""), "máy chủ chỉ nhận token: chỉ đúng cách kết nối", JSON.stringify(r.j));
  r = await api("POST", "/api/connectors", { name: "Công ty", url: `${MCP.replace("127.0.0.1", "localhost")}/apikey`, token: "sai" });
  ok(r.s === 400 && /từ chối token/.test(r.j?.error ?? ""), "token sai bị từ chối, không lưu", JSON.stringify(r.j));
  r = await api("POST", "/api/connectors", { name: "Công ty", url: `${MCP.replace("127.0.0.1", "localhost")}/apikey`, token: "mock-api-key" });
  const keyId = r.j?.connector?.id;
  ok(r.s === 200 && r.j.connector.status === "ok" && r.j.connector.auth === "token" && !r.j.authorizeUrl, "token đúng: kết nối ngay", JSON.stringify(r.j).slice(0, 300));
  ok(!JSON.stringify(r.j).includes("mock-api-key") && !JSON.stringify((await api("GET", "/api/connectors")).j).includes("mock-api-key"), "token không trả về trình duyệt");
  r = await api("POST", `/api/connectors/${keyId}/connect`, { token: "mock-api-key" });
  ok(r.s === 200 && r.j.connector.status === "ok", "nhập lại token trên connector có sẵn");
  await api("DELETE", `/api/connectors/${keyId}`);

  console.log("Hãng chưa duyệt Synchro");
  // Danh mục gợi ý không còn trên giao diện; connector danh mục cũ (thêm bằng { dir }) vẫn nhận và vẫn nói rõ lý do của hãng.
  ok((await api("GET", "/api/connectors")).j.directory === undefined, "không còn gửi danh mục gợi ý cho trình duyệt");
  r = await api("POST", "/api/connectors", { dir: "figma" });
  ok(r.s === 400 && /Figma/.test(r.j?.error ?? "") && !r.j?.authorizeUrl, "Figma: không thử đăng nhập, báo rõ lý do", JSON.stringify(r.j));
} finally {
  await api("DELETE", `/api/connectors/${notesId}`);
  for (const cli of ["claude", "codex", "agy", "grok"]) await api("POST", `/api/engines/${cli}/logout`);
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
