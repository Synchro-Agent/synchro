// Composio trên Synchro giả lập (npm run dev:mock; SYNCHRO_URL / MOCK_URL đổi được cổng): quản trị viên dán khóa ở Providers, mọi người có Composio
// trong Connectors và lượt chat, Connect Link hiện thành nút trong khung chat, ứng dụng đã kết nối hiện ở trang Connectors và ngắt được.
// Khóa không bao giờ xuất hiện trong dữ liệu trả về trình duyệt. Xong thì gỡ khóa, trả máy chủ về như cũ.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
const KEY = "ak_mock_composio_0001";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const raw = async (method, p, body) => {
  const r = await fetch(B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text };
};
if (!cookie) await raw("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const debug = (body) => fetch(`${M}/composio/_debug`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
const until = async (f, ms = 30_000, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const run = async (text) => {
  const r = await raw("POST", "/api/llm", { async: true, skills: true, system: "", model: "anthropic/claude-haiku-5-5", conv: `cx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, messages: [{ role: "user", content: text }] });
  return until(async () => { const x = (await raw("GET", `/api/runs/${r.j?.run}?json=1`)).j?.run; return x && x.status !== "running" ? x : null; }, 60_000);
};

const before = (await raw("GET", "/api/admin/apikeys")).j?.providers?.find((p) => p.id === "composio");
if (!before) { console.log("Máy chủ chưa có Composio (chạy lại npm run dev:mock trên bản mới)."); process.exit(1); }
try {
  await raw("DELETE", "/api/admin/apikeys?id=composio");
  await debug({ reset: true });
  console.log("1. Chưa có khóa");
  let r = await raw("GET", "/api/connectors");
  ok(r.s === 200 && r.j.composio?.state === "no_key" && r.j.composio.admin === true && r.j.composio.connector === null, "Connectors báo rõ chưa có khóa (quản trị viên thấy nút thêm khóa)", r.text.slice(0, 300));
  ok((await debug()).sessions.length === 0, "chưa gọi Composio");

  console.log("2. Quản trị viên dán khóa");
  r = await raw("POST", "/api/admin/apikeys", { id: "composio", key: "ak_sai" });
  ok(r.s === 400, "khóa sai bị từ chối", r.text.slice(0, 200));
  r = await raw("POST", "/api/admin/apikeys", { id: "composio", key: KEY });
  ok(r.s === 200 && r.j.providers.find((p) => p.id === "composio")?.configured && !r.text.includes(KEY), "khóa đúng được lưu, chỉ trả về dạng che", r.text.slice(0, 300));
  ok(!r.j.catalog.some((p) => p.id === "composio"), "không thành nhà cung cấp model");

  console.log("3. Composio tự có cho tài khoản, một phiên dùng lại");
  r = await raw("GET", "/api/connectors");
  ok(r.j?.composio?.state === "active" && r.j.composio.connector?.tools?.length === 3 && r.j.composio.apps === 0, "Composio đang hoạt động, 3 công cụ, chưa có ứng dụng", r.text.slice(0, 400));
  ok(!r.text.includes(KEY) && !/\/composio\/mcp\//.test(r.text), "khóa và địa chỉ phiên không ra trình duyệt");
  ok(!r.j.connectors.some((c) => c.dir === "composio"), "Composio không lẫn vào connector tự thêm");
  await raw("GET", "/api/connectors"); await raw("GET", "/api/connectors/composio");
  // Lần chạy trước có thể để lại phiên đã lưu (Composio giả lập vừa xóa hết): khi đó phiên được tạo lại ở lời gọi đầu tiên, không tạo ở mỗi lần tải trang.
  ok((await debug()).sessions.length <= 1, "tải lại nhiều lần: không tạo thêm phiên", JSON.stringify((await debug()).sessions));
  const cid = r.j.composio.connector.id;
  ok((await raw("DELETE", `/api/connectors/${cid}`)).s === 400, "không gỡ được Composio");

  console.log("4. Kết nối Gmail ngay trong chat");
  let fin = await run(`#tool=COMPOSIO_MANAGE_CONNECTIONS #args={"toolkits":["gmail"]}`);
  const link = fin?.events?.find((e) => e.kind === "link");
  const l = link && JSON.parse(link.text);
  ok(fin?.status === "done" && l?.app === "gmail" && l.name === "Gmail" && l.url.startsWith(`${M}/composio/link/`), "Connect Link hiện thành nút Kết nối Gmail", JSON.stringify(fin?.events ?? fin).slice(0, 500));
  ok(!fin?.events?.some((e) => e.kind === "ask"), "tạo Connect Link không cần duyệt");
  ok((await debug()).sessions.length === 1, "sau lời gọi đầu: đúng một phiên cho tài khoản", JSON.stringify((await debug()).sessions));
  ok(!JSON.stringify(fin).includes(KEY), "khóa không có trong lượt chạy");
  if (l) await fetch(l.url);
  r = await raw("GET", "/api/connectors/composio");
  const gmail = r.j?.list?.find((a) => a.app === "gmail");
  ok(gmail?.status === "ACTIVE" && gmail.name === "Gmail" && !r.text.includes("never-shown") && !r.text.includes(KEY), "đăng nhập xong: Gmail có trong danh sách, không kèm dữ liệu đăng nhập", r.text.slice(0, 400));

  // Khóa Composio là khóa chung của cả máy chủ: một tài khoản tải trang liên tục không được biến thành một lời gọi Composio mỗi lần.
  const lists = () => debug().then((d) => d.listed);
  const n0 = await lists();
  const tb = Date.now();
  const many = await Promise.all(Array.from({ length: 20 }, () => raw("GET", "/api/connectors/composio")));
  for (let i = 0; i < 10; i++) await raw("GET", "/api/connectors/composio");
  const n1 = await lists(), cap = 1 + Math.ceil((Date.now() - tb) / 1000);
  ok(many.every((x) => x.s === 200 && x.j.list.some((a) => a.app === "gmail")) && n1 - n0 <= cap, `30 lần tải trang liền nhau trong ${Date.now() - tb} ms: ${n1 - n0} lời gọi Composio (tối đa ${cap}, trước đây 30), danh sách vẫn đủ`, `${n1 - n0}`);
  await sleep(1100);
  await raw("GET", "/api/connectors/composio");
  ok((await lists()) - n1 === 1, "hơn 1 giây sau: tải lại danh sách mới từ Composio");

  console.log("5. Quyền: đọc chạy luôn, ghi hỏi trước");
  fin = await run(`#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(!fin?.events?.some((e) => e.kind === "ask") && /Mock email from Composio/.test(JSON.stringify(fin)), "đọc email: chạy không cần hỏi", JSON.stringify(fin?.events ?? fin).slice(0, 400));
  // Model dùng khóa API: công cụ cần duyệt dừng lượt lại và trả về thẻ duyệt (approval) kèm thao tác.
  fin = await run(`#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_SEND_EMAIL","arguments":{"to":"a@b.c"}}]}`);
  const ap = fin?.result?.approval ?? fin?.result?.json?.approval;
  ok(ap?.calls?.[0]?.connector?.name === "Composio" && ap.calls[0].input?.tools?.[0]?.tool_slug === "GMAIL_SEND_EMAIL" && ap.calls[0].tool.destructive === true, "gửi email: dừng chờ duyệt, thẻ có thao tác GMAIL_SEND_EMAIL", JSON.stringify(fin).slice(0, 500));
  console.log("6. Ngắt ứng dụng");
  r = await raw("DELETE", `/api/connectors/composio?id=${encodeURIComponent(gmail?.id ?? "x")}`);
  ok(r.s === 200 && r.j.removed === "Gmail" && !r.j.list.some((a) => a.app === "gmail"), "ngắt Gmail", r.text.slice(0, 300));
  r = await raw("DELETE", "/api/connectors/composio?id=ca_khong_co");
  ok(r.s === 404, "mã không thuộc tài khoản: 404", r.text.slice(0, 200));

  console.log("7. Gỡ khóa");
  await raw("DELETE", "/api/admin/apikeys?id=composio");
  r = await raw("GET", "/api/connectors");
  ok(r.j?.composio?.state === "no_key" && r.j.composio.connector === null, "gỡ khóa: trở lại chưa có khóa", r.text.slice(0, 200));
} finally {
  await raw("DELETE", "/api/admin/apikeys?id=composio");
  await debug({ reset: true }).catch(() => {});
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
