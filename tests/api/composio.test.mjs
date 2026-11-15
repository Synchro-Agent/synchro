// Composio của bạn trên Synchro giả lập (npm run dev:mock; SYNCHRO_URL / MOCK_URL đổi được cổng): mỗi tài khoản có sẵn Composio Connect, bấm
// "Liên kết Composio" là đăng nhập OAuth (đăng ký động, PKCE S256) ở trang Composio, hoặc dán khóa ck_ ở Nâng cao. Mỗi người dùng tài khoản Composio
// của chính mình; ứng dụng liên kết trên web Composio dùng được ngay; token tự làm mới; Ngắt liên kết về nút Liên kết. Token / khóa không ra trình duyệt.
import { CK_KEYS } from "../../tools/mock-composio.mjs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(init = "") {
  let cookie = init;
  const f = async (method, p, body) => {
    const r = await fetch(p.startsWith("http") ? p : B + p, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { s: r.status, j, text };
  };
  f.cookie = () => cookie;
  return f;
}
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? ""), member = client();
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
// Bộ kiểm thử gọi model nhiều lần: xóa mức dùng cũ của tài khoản thử nghiệm (data-mock của máy này) để không chạm hạn mức.
{ const { existsSync } = await import("node:fs"); const f = process.cwd() + "/data-mock/synchro.db";
  if (existsSync(f)) { const { createRequire } = await import("node:module"); const R = createRequire(process.cwd() + "/package.json");
    const db = new (R("better-sqlite3"))(f); db.pragma("busy_timeout = 5000"); db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run("admin@synchro.test"); db.close(); } }
const email = `cx-member-${Date.now().toString(36)}@synchro.test`;
await member("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "CX Member", birthDate: "2000-01-01" } });
if ((await member("GET", "/api/connectors")).s !== 200) await member("POST", "/api/auth/login", { email, password: "Member-pass-123" });
const debug = (body) => fetch(`${M}/composio/_debug`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
const until = async (f, ms = 30_000, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const run = async (c, text) => {
  const r = await c("POST", "/api/llm", { async: true, skills: true, system: "", model: "anthropic/claude-haiku-5-5", conv: `cx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, messages: [{ role: "user", content: text }] });
  return until(async () => { const x = (await c("GET", `/api/runs/${r.j?.run}?json=1`)).j?.run; return x && x.status !== "running" ? x : null; }, 60_000);
};
// Mô phỏng cửa sổ đăng nhập: mở trang Composio, bấm Cho phép / Từ chối (as: tài khoản Composio), theo chuyển hướng về Synchro bằng cookie của người đã bấm.
async function oauth(c, url, decision = "allow", as) {
  const page = await fetch(url + (as ? `&as=${as}` : "")).then((r) => r.text());
  const link = new RegExp(`id="${decision}" href="([^"]+)"`).exec(page)?.[1];
  if (!link) return { error: page.slice(0, 200) };
  const r = await fetch(link.replace(/&amp;/g, "&"), { redirect: "manual" });
  const cb = await fetch(r.headers.get("location"), { headers: { cookie: c.cookie() } });
  return { html: await cb.text() };
}
const secrets = (t) => /cxat_|cxrt_|ck_mock_|code_verifier/.test(t);

try {
  await debug({ reset: true });
  for (const c of [admin, member]) await c("DELETE", "/api/connectors/composio");

  console.log("1. Composio có sẵn, chưa liên kết; không còn khóa dự án dùng chung");
  let r = await admin("GET", "/api/connectors");
  const cxA = r.j?.composio;
  ok(r.s === 200 && cxA?.state === "unlinked" && cxA.connector?.dir === "composio" && cxA.connector.status === "needs_auth" && cxA.manageUrl === "https://dashboard.composio.dev", "Connectors: Composio của bạn có sẵn, chờ Liên kết", r.text.slice(0, 300));
  ok(!r.j.connectors.some((c) => c.dir === "composio"), "Composio không lẫn vào connector tự thêm");
  const keys = await admin("GET", "/api/admin/apikeys");
  ok(keys.s === 200 && !keys.j.providers.some((p) => p.id === "composio"), "Providers không còn ô khóa Composio", keys.text.slice(0, 200));
  ok((await admin("POST", "/api/admin/apikeys", { id: "composio", key: "ak_mock_composio_0001" })).s >= 400, "không lưu được khóa dự án Composio nữa");
  ok((await admin("GET", "/api/connectors/composio?retry=1")).j?.list === undefined, "không còn danh sách ứng dụng ở Synchro");

  console.log("2. Liên kết bằng đăng nhập Composio (OAuth)");
  r = await admin("POST", "/api/connectors/composio", {});
  const au = r.j?.authorizeUrl && new URL(r.j.authorizeUrl);
  ok(r.s === 200 && au?.pathname === "/composio/oauth/authorize" && au.searchParams.get("code_challenge_method") === "S256" && au.searchParams.get("code_challenge") && au.searchParams.get("state") && au.searchParams.get("resource") === `${M}/composio/mcp`, "trả về trang đăng nhập Composio: PKCE S256, state, resource đúng máy chủ MCP", r.text.slice(0, 400));
  ok(!secrets(r.text) && (await debug()).clients === 1, "Synchro tự đăng ký (DCR) một client với Composio; không lộ bí mật", r.text.slice(0, 200));
  let o = await oauth(admin, r.j.authorizeUrl, "deny");
  r = await admin("GET", "/api/connectors/composio");
  ok(r.j?.composio?.state === "unlinked", "bấm Từ chối: vẫn chưa liên kết", r.text.slice(0, 300));
  r = await admin("POST", "/api/connectors/composio", {});
  const stolen = r.j.authorizeUrl;
  o = await oauth(member, stolen, "allow", "alice");
  ok(/tài khoản đã bấm kết nối/.test(o.html ?? "") && (await admin("GET", "/api/connectors/composio")).j?.composio?.state === "unlinked", "người khác hoàn tất đăng nhập hộ: bị từ chối (state gắn với tài khoản đã bấm)", o.html?.slice(0, 200));
  r = await admin("POST", "/api/connectors/composio", {});
  ok((await debug()).clients === 1, "liên kết lại: dùng lại client đã đăng ký");
  o = await oauth(admin, r.j.authorizeUrl, "allow", "alice");
  r = await admin("GET", "/api/connectors");
  const linkedA = r.j?.composio;
  ok(linkedA?.state === "linked" && linkedA.via === "oauth" && linkedA.connector.status === "ok" && linkedA.connector.tools.length === 3, "đăng nhập xong: Đã liên kết, 3 công cụ meta", r.text.slice(0, 400));
  ok(!secrets(r.text) && !("list" in linkedA) && !("apps" in linkedA), "không có token, không có danh sách ứng dụng", r.text.slice(0, 300));
  o = await oauth(admin, stolen, "allow", "alice");
  ok(/hết hạn hoặc đã dùng/.test(o.html ?? ""), "state cũ không dùng lại được", o.html?.slice(0, 200));

  console.log("3. Khóa ck_ ở Nâng cao (tài khoản thứ hai)");
  r = await member("POST", "/api/connectors/composio", { key: "ak_project_key_123" });
  ok(r.s === 400 && /ck_/.test(r.j?.error ?? ""), "khóa không phải ck_: báo rõ", r.text.slice(0, 200));
  r = await member("POST", "/api/connectors/composio", { key: "ck_mock_wrong_0000001" });
  ok(r.s === 400 && (await member("GET", "/api/connectors/composio")).j?.composio?.state === "unlinked", "khóa sai: Composio từ chối, không lưu", r.text.slice(0, 200));
  r = await member("POST", "/api/connectors/composio", { key: CK_KEYS.bob });
  ok(r.s === 200 && r.j.composio?.state === "linked" && r.j.composio.via === "key" && r.j.composio.keyHint === "ck_••••0001" && r.j.connector?.tools?.length === 3, "khóa đúng: thử với Composio rồi lưu, chỉ hiện dạng che", r.text.slice(0, 300));
  ok(!r.text.includes(CK_KEYS.bob) && !(await member("GET", "/api/connectors")).text.includes(CK_KEYS.bob), "khóa không bao giờ trả về trình duyệt");

  console.log("4. Mỗi người một tài khoản Composio");
  const idA = linkedA.connector.id;
  ok((await member("POST", `/api/connectors/${idA}/connect`, {})).s === 404 && (await member("PATCH", `/api/connectors/${idA}`, { enabled: false })).s === 404 && (await member("DELETE", `/api/connectors/${idA}`)).s === 404, "tài khoản khác không kết nối / sửa / gỡ được Composio của người này");
  let fin = await run(admin, `#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(/No active connection for gmail/.test(JSON.stringify(fin)), "chưa liên kết Gmail trên Composio: công cụ báo chưa có kết nối", JSON.stringify(fin?.events ?? fin).slice(0, 300));

  console.log("5. Liên kết ứng dụng trên web Composio: Synchro dùng được ngay");
  const lists0 = (await debug()).lists;
  await debug({ link: { account: "alice", slug: "gmail" } });
  fin = await run(admin, `#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(/Mock email for alice/.test(JSON.stringify(fin)) && !fin?.events?.some((e) => e.kind === "ask"), "lượt sau dùng Gmail của alice ngay (đọc: không cần duyệt), không cần bấm gì ở Synchro", JSON.stringify(fin?.events ?? fin).slice(0, 300));
  ok((await debug()).lists === lists0, "không phải tải lại danh sách công cụ (công cụ meta không đổi)");
  fin = await run(member, `#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(/No active connection for gmail/.test(JSON.stringify(fin)) && !/Mock email for alice/.test(JSON.stringify(fin)), "tài khoản thứ hai (bob) không thấy Gmail của alice", JSON.stringify(fin?.events ?? fin).slice(0, 300));
  const calls = (await debug()).calls;
  ok(calls.some((x) => x.account === "alice") && calls.some((x) => x.account === "bob"), "Composio nhận lời gọi đúng tài khoản của từng người", calls);

  console.log("6. Ứng dụng chưa liên kết: nút Kết nối trong khung chat");
  fin = await run(member, `#tool=COMPOSIO_MANAGE_CONNECTIONS #args={"toolkits":["slack"]}`);
  const lk = fin?.events?.find((e) => e.kind === "link"), l = lk && JSON.parse(lk.text);
  ok(l?.name === "Slack" && l.url.startsWith(`${M}/composio/link/`), "Connect Link thành nút Kết nối Slack", JSON.stringify(fin?.events ?? fin).slice(0, 400));
  ok(!fin?.events?.some((e) => e.kind === "ask") && !(fin?.result?.json?.webSources ?? fin?.result?.webSources ?? []).some((w) => w.url === l?.url), "tạo Connect Link không cần duyệt, link không thành nguồn");

  console.log("7. Token hết hạn: tự làm mới");
  await debug({ expire: true });
  fin = await run(admin, `#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(/Mock email for alice/.test(JSON.stringify(fin)), "access token hết hạn: dùng refresh token, lượt vẫn chạy", JSON.stringify(fin?.events ?? fin).slice(0, 300));
  ok((await admin("GET", "/api/connectors/composio")).j?.composio?.connector?.status === "ok", "vẫn Đã liên kết");
  await debug({ revoke: true });
  fin = await run(admin, `#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  r = await admin("GET", "/api/connectors/composio");
  ok(r.j?.composio?.state === "linked" && r.j.composio.connector.status === "needs_auth", "Composio thu hồi đăng nhập: thẻ báo cần đăng nhập lại", r.text.slice(0, 300));
  r = await admin("POST", "/api/connectors/composio", {});
  ok(r.s === 200 && !!r.j.authorizeUrl, "bấm Đăng nhập lại: mở trang đăng nhập Composio", r.text.slice(0, 200));
  await oauth(admin, r.j.authorizeUrl, "allow", "alice");
  ok((await admin("GET", "/api/connectors/composio")).j?.composio?.connector?.status === "ok", "đăng nhập lại xong: chạy tiếp");

  console.log("8. Ngắt liên kết");
  r = await member("DELETE", "/api/connectors/composio");
  ok(r.s === 200 && r.j.composio?.state === "unlinked" && r.j.composio.connector.tools.length === 0 && !r.j.composio.keyHint, "Ngắt liên kết: về nút Liên kết Composio, quên khóa", r.text.slice(0, 300));
  fin = await run(member, `#tool=connector_reconnect #args={"connector":"Composio"}`);
  const conn = fin?.events?.find((e) => e.kind === "conn"), cj = conn && JSON.parse(conn.text);
  ok(cj?.link === true && cj.name === "Composio", "chưa liên kết mà cần ứng dụng: model hiện nút Liên kết Composio ngay trong khung chat", JSON.stringify(fin?.events ?? fin).slice(0, 400));
  ok((await admin("GET", "/api/connectors/composio")).j?.composio?.state === "linked", "tài khoản kia vẫn đã liên kết");
} finally {
  for (const c of [admin, member]) await c("DELETE", "/api/connectors/composio").catch(() => {});
  await debug({ reset: true }).catch(() => {});
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
