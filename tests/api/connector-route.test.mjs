// Lời nhờ "tạo Google Docs" ở chế độ Tự động, đầu cuối trên bản giả lập: lượt phải đi đường đầy đủ có công cụ của
// Composio (không đi đường nhanh, không bị xếp học ngôn ngữ / hỏi đáp), và lời gọi ghi Google Docs ra thẻ duyệt.
// Gói Claude giả lập trả lời bằng ghi chú "[công cụ Synchro: N]" khi lượt có cầu nối công cụ; đường nhanh thì không.
// Cần npm run dev:mock. Chạy tay:
// BASE=http://localhost:3500 MOCK=http://127.0.0.1:4310 node tests/api/connector-route.test.mjs
const B = process.env.BASE ?? "http://localhost:3200", M = process.env.MOCK ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
const api = async (method, p, body) => {
  const headers = { "content-type": "application/json", origin: B, cookie };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const r = await fetch(B + p, { method, redirect: "manual", headers, body: payload });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null;
  try {
    j = await r.json();
  } catch {
    // Trang lỗi HTML: để bài kiểm báo theo mã trạng thái.
    j = null;
  }
  return { s: r.status, j };
};
const until = async (f, ms = 30_000, step = 250) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await f();
    if (v) return v;
    await sleep(step);
  }
  return null;
};
const code = async (cli) => {
  const page = await fetch(`${M}/mock-login/${cli}`).then((x) => x.text());
  return /id="code"[^>]*>([^<]+)</.exec(page)?.[1];
};
const events = async (run) => (await api("GET", `/api/runs/${run}?json=1`)).j?.run;
const finished = (run) => until(async () => {
  const x = await events(run);
  return x?.status !== "running" ? x : null;
}, 60_000);
const textOf = (fin) => String(fin?.result?.text ?? fin?.result?.json?.text ?? JSON.stringify(fin?.result ?? ""));
const R = Date.now() % 100000;

await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
try {
  await api("POST", "/api/engines/claude/login/start", {});
  await api("POST", "/api/engines/claude/login/code", { code: await code("claude") });
  const plan = async () => (await api("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn;
  ok(await until(plan, 15_000, 500), "đăng nhập gói Claude giả lập");
  await api("DELETE", "/api/connectors/composio");
  const linked = await api("POST", "/api/connectors/composio", { key: "ck_mock_alice_00000001" });
  ok(linked.s === 200, "liên kết Composio bằng khóa ck_ của tài khoản giả lập", linked);
  await fetch(`${M}/composio/_debug`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ link: { account: "alice", slug: "googledocs" } }),
  });

  console.log("1. Năm cách nói “tạo Google Docs” ở chế độ Tự động: lượt đầy đủ, có công cụ");
  const asks = [
    `Dùng connector Google Docs: tạo một tài liệu mới tên Kế hoạch quý ${R}`,
    `Dùng connector Google Docs: tạo một tài liệu mới tên "Biên bản họp ${R}"`,
    `Make a Google Doc titled Meeting notes ${R}`,
    `Hãy dùng Google Docs để tạo tài liệu "Báo cáo tuần ${R}"`,
    `Crée un nouveau document Google Docs nommé Plan ${R}`,
  ];
  for (const [i, text] of asks.entries()) {
    const body = { async: true, conv: `cxroute-${R}-${i}`, model: "auto", effort: "auto", skills: true, system: "" };
    const r = await api("POST", "/api/llm", { ...body, messages: [{ role: "user", content: text }] });
    const fin = await finished(r.j?.run);
    const note = (fin?.events ?? []).map((e) => e.text ?? "").find((t) => /^Tự động chọn/.test(t)) ?? "";
    ok(/việc thao tác nhiều bước/.test(note), `“${text.slice(0, 48)}…”: Tự động xếp thao tác`, note || fin);
    const tools = /công cụ Synchro: \d+/.test(textOf(fin));
    ok(fin?.status === "done" && tools, "lượt đầy đủ có cầu nối công cụ", textOf(fin));
  }

  console.log("2. Lời gọi ghi Google Docs qua Composio: thẻ duyệt");
  const exec = "composio__COMPOSIO_MULTI_EXECUTE_TOOL";
  const args = { tools: [{ tool_slug: "GOOGLEDOCS_CREATE_DOCUMENT", arguments: { title: `Kế hoạch ${R}` } }] };
  const content = `Dùng connector Google Docs: tạo tài liệu tên Kế hoạch ${R} #tool=${exec}`
    + ` #args=${JSON.stringify(args)}`;
  const body = { async: true, conv: `cxroute-${R}-card`, model: "auto", effort: "auto", skills: true, system: "" };
  const r = await api("POST", "/api/llm", { ...body, messages: [{ role: "user", content }] });
  const ask = await until(async () => (await events(r.j?.run))?.events?.find((e) => e.kind === "ask"));
  const card = ask ? JSON.parse(ask.text) : null;
  const docsCard = /GOOGLEDOCS_CREATE_DOCUMENT|Google Docs/.test(JSON.stringify(card ?? {}));
  ok(card?.kind === "connector" && docsCard, "thẻ duyệt hiện cho lời gọi tạo tài liệu Google Docs", card);
  if (card) await api("POST", "/api/approve", { id: card.id, ok: false });
  await finished(r.j?.run);
} finally {
  await api("DELETE", "/api/connectors/composio");
  // Còn đăng nhập gói Claude thì Tự động của các bộ chạy sau chọn Claude Code giả lập (chỉ nhại tin nhắn).
  await api("POST", "/api/engines/claude/logout");
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
