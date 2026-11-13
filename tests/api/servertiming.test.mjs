// Header Server-Timing (auth / work / total) trên mọi phản hồi của /api/* (app/servertiming.ts, handle() trong app/authstore.ts).
// 1. Bộ bọc timed(): đúng định dạng, cộng dồn thời gian kiểm tra đăng nhập, không gắn hai lần khi bọc lồng, phản hồi có header bất biến.
// 2. Mọi route trong app/api đều đi qua handle() / route() / engineRoute() / timed() (route mới quên bọc thì bộ này báo).
// 3. Máy chủ thật: các API trang chính gọi khi mở trang đều mang Server-Timing. Chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL).
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const RE = /^auth;dur=(\d+\.\d), work;dur=(\d+\.\d), total;dur=(\d+\.\d)$/;
const parse = (h) => { const m = RE.exec(h ?? ""); return m ? { auth: Number(m[1]), work: Number(m[2]), total: Number(m[3]) } : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("1. Bộ bọc timed()");
const { servertiming: T } = await loadTs(["servertiming"]);
{
  const h = T.timed(async () => { T.timeAuth(() => { const t = Date.now(); while (Date.now() - t < 15); }); T.timeAuth(() => { const t = Date.now(); while (Date.now() - t < 10); }); await sleep(30); return Response.json({ ok: true }); });
  const r = await h(new Request("http://x/api/a"));
  const v = parse(r.headers.get("server-timing"));
  ok(v, "định dạng auth;dur=…, work;dur=…, total;dur=…", r.headers.get("server-timing"));
  ok(v && v.auth >= 24 && v.work >= 25 && Math.abs(v.auth + v.work - v.total) <= 0.2, "auth cộng dồn hai lần kiểm tra; work = total − auth", v);
  ok((await r.json()).ok === true && r.status === 200, "body và mã trạng thái giữ nguyên");
}
{
  const inner = T.timed(async () => new Response("x", { status: 201 }));
  const outer = T.timed(async (req) => inner(req));
  const r = await outer(new Request("http://x/api/b"));
  ok(r.headers.get("server-timing")?.split("total;").length === 2 && r.status === 201, "bọc lồng nhau: chỉ một header", r.headers.get("server-timing"));
}
{
  const r = await T.timed(async () => Response.redirect("http://x/next", 302))(new Request("http://x/api/c"));
  ok(r.status === 302 && r.headers.get("location") === "http://x/next" && parse(r.headers.get("server-timing")), "phản hồi có header bất biến (Response.redirect) vẫn có Server-Timing", [...r.headers]);
  const two = new Headers(); two.append("Set-Cookie", "a=1"); two.append("Set-Cookie", "b=2");
  const imm = new Response(null, { status: 303, headers: two });
  Object.defineProperty(imm, "headers", { value: new Proxy(imm.headers, { get: (t, k) => (k === "set" ? () => { throw new TypeError("immutable"); } : typeof t[k] === "function" ? t[k].bind(t) : t[k]) }) });
  const r2 = T.withServerTiming(imm, "auth;dur=0.0, work;dur=1.0, total;dur=1.0");
  ok(r2.headers.getSetCookie().join("|") === "a=1|b=2" && r2.headers.get("server-timing"), "bản sao giữ đủ các Set-Cookie", r2.headers.getSetCookie());
}
{
  let thrown = null;
  try { await T.timed(async () => { throw new Error("boom"); })(new Request("http://x/api/d")); } catch (e) { thrown = e; }
  ok(thrown?.message === "boom", "lỗi của route không bị nuốt (Next / handle() xử lý như cũ)");
  ok(T.timeAuth(() => 7) === 7, "timeAuth ngoài yêu cầu đang đo chỉ chạy hàm");
}

console.log("2. Mọi route trong app/api đều được đo");
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name === "route.ts") files.push(p); } };
walk(path.join(process.cwd(), "app", "api"));
const bare = [];
let methods = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^export (?:async )?(function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b(.*)/.exec(line);
    if (!m) continue;
    methods++;
    if (m[1] === "function" || !/^ = (handle|route|engineRoute|timed)\(/.test(m[3])) bare.push(`${path.relative(process.cwd(), f)}: ${line.slice(0, 80)}`);
  }
}
ok(files.length > 90 && methods > 150, `quét ${files.length} tệp route, ${methods} phương thức`, { files: files.length, methods });
ok(!bare.length, "không phương thức nào thiếu bộ đo", bare.join("\n"));

console.log("3. Máy chủ: API trang chính gọi khi mở trang");
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
const get = (p, auth = true) => fetch(B + p, { headers: auth ? { cookie } : {}, redirect: "manual" });
if (!cookie) {
  const r = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
}
// Trang chính (page.tsx, store.tsx, …) gọi các API này ngay khi mở; thêm vài route không qua handle() (models, skills, runs, health).
const LOAD = ["/api/bootstrap", "/api/auth/me", "/api/models", "/api/skills", "/api/plugins", "/api/connectors", "/api/inbox", "/api/caps", "/api/usage", "/api/brain", "/api/apps", "/api/artifacts", "/api/tasks", "/api/runs", "/api/health", "/api/admin/health", "/api/github"];
const missing = [], bad = [];
for (const p of LOAD) {
  const r = await get(p);
  await r.arrayBuffer().catch(() => null);
  const h = r.headers.get("server-timing");
  if (!h) missing.push(`${p} (${r.status})`);
  else { const v = parse(h); if (!v || Math.abs(v.auth + v.work - v.total) > 0.2) bad.push(`${p}: ${h}`); }
}
ok(!missing.length, `${LOAD.length} API mở trang đều có Server-Timing`, missing.join(", "));
ok(!bad.length, "số đo hợp lệ: auth + work = total", bad.join("\n"));
{
  const r = await get("/api/auth/me");
  const v = parse(r.headers.get("server-timing"));
  ok(v && v.auth > 0, "đã đăng nhập: có thời gian kiểm tra phiên (auth > 0)", r.headers.get("server-timing"));
  const u = await get("/api/inbox", false);
  ok(u.status === 401 && parse(u.headers.get("server-timing")), "lỗi 401 của handle() cũng có Server-Timing", u.status);
  const o = await get("/api/auth/oauth/khong-co", false);
  ok(o.status === 302 && parse(o.headers.get("server-timing")), "chuyển hướng 302 (đăng nhập OAuth) cũng có Server-Timing", o.status);
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
