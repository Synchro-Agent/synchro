// A6.4: Worker ping /api/health mỗi phút (ops/uptime-worker/worker.mjs) — đọc kết quả, thử lại một lần, báo GitHub đúng một lần sau N phút lỗi liền,
// báo hồi, ghi KV chỉ khi trạng thái đổi; workflow uptime.yml không còn cron dày đốt phút Actions. Chạy bằng fetch / KV giả, không cần Cloudflare.
import fs from "node:fs";
import { check, judge } from "../../ops/uptime-worker/worker.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };

console.log("1. Đọc /api/health");
ok(judge(200, JSON.stringify({ ok: true, db: true, agent: null, build: "abc" })).ok, "200, db đúng, agent null (máy không bật workspace): ổn");
ok(!judge(503, JSON.stringify({ ok: false, db: true, agent: false })).ok && /503/.test(judge(503, "{}").why), "503: lỗi, nói mã HTTP");
ok(!judge(200, JSON.stringify({ db: false })).ok, "db sai: lỗi");
ok(!judge(200, JSON.stringify({ db: true, agent: false })).ok, "agent sai: lỗi");
ok(!judge(200, "<html>Bad gateway</html>").ok, "200 mà không phải JSON (trang lỗi của proxy): lỗi");

// Môi trường giả: KV đếm số lần ghi, fetch trả theo kịch bản, ghi lại các lần kích GitHub.
function world(script) {
  const store = new Map(), gh = [];
  let writes = 0, i = 0;
  const env = {
    HEALTH_URL: "https://example.test/api/health", GH_REPO: "owner/repo", GH_TOKEN: "t", FAILS_TO_ALERT: "3",
    UPTIME: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { writes++; store.set(k, v); } },
  };
  const state = { ghStatus: 204 };
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith("https://api.github.com/")) { gh.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response(state.ghStatus === 204 ? null : "bad credentials", { status: state.ghStatus }); }
    const step = script[Math.min(i++, script.length - 1)];
    if (step === "net") throw new Error("ECONNREFUSED");
    return new Response(step === "ok" ? JSON.stringify({ ok: true, db: true, agent: true }) : JSON.stringify({ ok: false, db: false }), { status: step === "ok" ? 200 : 503 });
  };
  let t = 1_700_000_000_000;
  const deps = { fetch: fetchImpl, sleep: async () => {}, now: () => (t += 60_000), retryMs: 0 };
  return { env, gh, store, deps, state, writes: () => writes, setScript: (s) => { script = s; i = 0; } };
}

console.log("2. Phút bình thường");
{
  const w = world(["ok"]);
  for (let k = 0; k < 5; k++) await check(w.env, w.deps);
  ok(w.gh.length === 0 && w.writes() === 0, "5 phút ổn: không báo, không ghi KV (giữ dưới hạn mức ghi của KV Free)", { gh: w.gh.length, writes: w.writes() });
}

console.log("3. Chập chờn một lần (deploy xanh / lam)");
{
  const w = world(["bad", "ok"]);
  const r = await check(w.env, w.deps);
  ok(r.ok && w.gh.length === 0 && w.writes() === 0, "lỗi rồi thử lại ổn ngay trong phút đó: coi là ổn", r);
}

console.log("4. Sập thật: báo một lần sau 3 phút, rồi báo hồi");
{
  const w = world(["net"]);
  const r1 = await check(w.env, w.deps), r2 = await check(w.env, w.deps);
  ok(!r1.ok && !r2.ok && w.gh.length === 0, "phút 1, 2 lỗi: chưa báo", w.gh);
  const r3 = await check(w.env, w.deps);
  ok(r3.sent === "down" && w.gh.length === 1 && /\/actions\/workflows\/uptime\.yml\/dispatches$/.test(w.gh[0].url) && w.gh[0].body.ref === "main" && /^down: không gọi được: ECONNREFUSED/.test(w.gh[0].body.inputs.reason) && w.gh[0].auth === "Bearer t",
    "phút 3: kích uptime.yml trên main một lần, kèm lý do", w.gh);
  const before = w.writes();
  for (let k = 0; k < 30; k++) await check(w.env, w.deps);
  ok(w.gh.length === 1 && w.writes() === before, "sập thêm 30 phút: không báo lại, không ghi KV thêm", { gh: w.gh.length, writes: w.writes() - before });
  ok(w.writes() <= 3, `cả đợt sập chỉ ghi KV ${w.writes()} lần`, w.writes());
  w.setScript(["ok"]);
  const up = await check(w.env, w.deps);
  ok(up.ok && up.sent === "up" && w.gh.length === 2 && /^up: /.test(w.gh[1].body.inputs.reason) && JSON.parse(w.store.get("state")).fails === 0, "hồi lại: báo up một lần, trạng thái về 0", w.gh[1]);
  await check(w.env, w.deps);
  ok(w.gh.length === 2, "phút sau đó: không báo thêm");
}

console.log("5. Báo GitHub lỗi thì phút sau thử lại");
{
  const w = world(["bad"]);
  w.state.ghStatus = 401;
  for (let k = 0; k < 3; k++) await check(w.env, w.deps);
  const s = JSON.parse(w.store.get("state"));
  ok(w.gh.length === 1 && s.down && !s.alerted && /chưa báo được: GitHub trả 401/.test(s.why), "token sai: ghi lại chưa báo được, kèm lý do", s);
  w.state.ghStatus = 204;
  const r = await check(w.env, w.deps);
  ok(r.sent === "down" && w.gh.length === 2 && JSON.parse(w.store.get("state")).alerted, "phút sau: báo lại được", r);
}

console.log("6. Lỗi rồi hồi trước khi đủ 3 phút");
{
  const w = world(["bad"]);
  await check(w.env, w.deps); await check(w.env, w.deps);
  w.setScript(["ok"]);
  const r = await check(w.env, w.deps);
  ok(r.ok && !r.sent && w.gh.length === 0 && JSON.parse(w.store.get("state")).fails === 0, "2 phút lỗi rồi ổn: không báo gì, đếm lại từ 0", r);
}

console.log("7. Workflow GitHub và cấu hình Worker");
const wf = fs.readFileSync(".github/workflows/uptime.yml", "utf8");
const crons = [...wf.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
// Phút Actions mỗi tháng của lịch: số lần chạy mỗi ngày × 30 (mỗi job tính tối thiểu 1 phút).
const perDay = (c) => { const [m, h] = c.split(/\s+/); const cnt = (f, n) => (f === "*" ? n : f.startsWith("*/") ? Math.ceil(n / Number(f.slice(2))) : f.split(",").length); return cnt(m, 60) * cnt(h, 24); };
const monthly = crons.reduce((s, c) => s + perDay(c) * 30, 0);
ok(crons.length >= 1 && monthly <= 200, `lịch dự phòng của uptime.yml tốn ${monthly} phút Actions / tháng (≤ 200; mỗi 5 phút là 8.640)`, crons);
ok(/workflow_dispatch:[\s\S]*reason:/.test(wf) && /REASON: \$\{\{ github\.event\.inputs\.reason/.test(wf) && !/run: \|[\s\S]*\$\{\{ github\.event\.inputs/.test(wf.split("REASON:")[1] ?? ""), "Worker kích bằng workflow_dispatch; lý do chỉ đi qua biến môi trường, không chèn vào script");
const toml = fs.readFileSync("ops/uptime-worker/wrangler.toml", "utf8");
ok(/crons = \["\* \* \* \* \*"\]/.test(toml) && /binding = "UPTIME"/.test(toml) && /GH_WORKFLOW = "uptime\.yml"/.test(toml) && !/GH_TOKEN\s*=/.test(toml), "Worker chạy mỗi phút, có KV UPTIME, token không nằm trong tệp (wrangler secret)");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
