// Composio của bạn trong lượt chat (npm run dev:mock; SYNCHRO_URL / MOCK_URL đổi được cổng): chưa liên kết thì model được dặn mời liên kết (nút trong khung chat),
// đã liên kết thì có công cụ meta và lời dặn không chép Connect Link / không đưa vào "Sources"; thao tác ghi vẫn hỏi trước, đọc thì chạy luôn.
import { CK_KEYS } from "../../scripts/mock-composio.mjs";
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
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
// Bộ kiểm thử gọi model nhiều lần: xóa mức dùng cũ của tài khoản thử nghiệm (data-mock của máy này) để không chạm hạn mức.
{ const { existsSync } = await import("node:fs"); const f = process.cwd() + "/data-mock/synchro.db";
  if (existsSync(f)) { const { createRequire } = await import("node:module"); const R = createRequire(process.cwd() + "/package.json");
    const db = new (R("better-sqlite3"))(f); db.pragma("busy_timeout = 5000"); db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run("admin@synchro.test"); db.close(); } }
const debug = (body) => fetch(`${M}/composio/_debug`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json());
const last = () => fetch(`${M}/_debug/last`).then((r) => r.json()).then((j) => JSON.stringify(j.anthropic ?? {}));
const until = async (f, ms = 30_000, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const run = async (text) => {
  const r = await raw("POST", "/api/llm", { async: true, skills: true, system: "", model: "anthropic/claude-haiku-5-5", conv: `cxc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, messages: [{ role: "user", content: text }] });
  return until(async () => { const x = (await raw("GET", `/api/runs/${r.j?.run}?json=1`)).j?.run; return x && x.status !== "running" ? x : null; }, 60_000);
};

try {
  await debug({ reset: true });
  await raw("DELETE", "/api/connectors/composio");
  console.log("1. Chưa liên kết: lời dặn mời liên kết, không có công cụ Composio");
  let fin = await run("Tóm tắt email mới nhất trong Gmail của mình");
  let req = await last();
  ok(fin?.status === "done" && /chưa liên kết Composio/.test(req) && /connector_reconnect/.test(req) && !/COMPOSIO_SEARCH_TOOLS/.test(req), "model biết Composio chưa liên kết và có nút để mời liên kết", req.slice(0, 300));

  console.log("2. Đã liên kết (khóa ck_): công cụ meta và lời dặn về Connect Link");
  const r = await raw("POST", "/api/connectors/composio", { key: CK_KEYS.alice });
  ok(r.s === 200 && r.j.composio?.state === "linked", "liên kết bằng khóa ck_", r.text.slice(0, 200));
  fin = await run(`#tool=COMPOSIO_MANAGE_CONNECTIONS #args={"toolkits":["gmail"]}`);
  req = await last();
  ok(/COMPOSIO_SEARCH_TOOLS/.test(req) && /KHÔNG chép đường link kết nối/.test(req) && /Sources/.test(req) && !/chưa liên kết Composio/.test(req), "model có công cụ Composio, được dặn không chép link và không đưa vào Sources", req.slice(0, 300));
  const l = JSON.parse(fin?.events?.find((e) => e.kind === "link")?.text ?? "null");
  ok(l?.app === "gmail" && l.name === "Gmail" && l.url.startsWith(`${M}/composio/link/`), "Connect Link → nút Kết nối Gmail", JSON.stringify(fin?.events ?? fin).slice(0, 400));
  if (l) await fetch(l.url);

  console.log("3. Quyền: đọc chạy luôn, ghi hỏi trước");
  fin = await run(`#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_FETCH_EMAILS","arguments":{}}]}`);
  ok(!fin?.events?.some((e) => e.kind === "ask") && /Mock email for alice/.test(JSON.stringify(fin)), "đọc email: chạy không cần hỏi", JSON.stringify(fin?.events ?? fin).slice(0, 400));
  fin = await run(`#tool=COMPOSIO_MULTI_EXECUTE_TOOL #args={"tools":[{"tool_slug":"GMAIL_SEND_EMAIL","arguments":{"to":"a@b.c"}}]}`);
  const ap = fin?.result?.approval ?? fin?.result?.json?.approval;
  ok(ap?.calls?.[0]?.connector?.name === "Composio" && ap.calls[0].input?.tools?.[0]?.tool_slug === "GMAIL_SEND_EMAIL", "gửi email: dừng chờ duyệt", JSON.stringify(fin).slice(0, 500));
  ok(!JSON.stringify(fin).includes(CK_KEYS.alice), "khóa không có trong lượt chạy");
} finally {
  await raw("DELETE", "/api/connectors/composio").catch(() => {});
  await debug({ reset: true }).catch(() => {});
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
