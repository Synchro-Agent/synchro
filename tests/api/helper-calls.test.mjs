// Đo việc phụ trên gói của tài khoản miễn phí (gói w10-quota, nhóm A): một thành viên mới, quyền mặc định, đăng nhập gói ChatGPT giả lập
// (như tài khoản free thật: GPT-6 Luna là model rẻ nhất), nhắn 8 tin ở chế độ Tự động trong hai đoạn chat, cách nhau vài giây. Trình duyệt
// tự gọi đặt tên đoạn chat và phản biện tự động sau câu trả lời: bộ đo gọi đúng như ui/home.tsx (autoTitle, afterArtifacts). Đếm mọi lượt
// của gói theo engine_turns (via: "job:<tên>" là việc phụ) và dòng [timing] job= trong nhật ký máy chủ giả lập (LOG=<tệp nhật ký dev:mock>).
// Trên production 15/11: 57 trong 59 lượt GPT-6 Luna là việc phụ (≈6 việc phụ cho mỗi tin nhắn). Kỳ vọng sau gói này: tối đa 2 việc phụ
// cho mỗi tin nhắn, "tin nhắn hôm nay" đúng bằng số tin người dùng gửi.
// Chạy: npm run dev:mock (đặt SYNCHRO_BRAIN_IDLE_MS=3000 để bộ não chưng cất sau mỗi khoảng nghỉ ngắn như người dùng thật nghỉ giữa hai tin),
// rồi LOG=<nhật ký dev:mock> node tests/api/helper-calls.test.mjs. OLD_UI=1: trình duyệt bản cũ (phản biện tự động cả bản sửa mode="patch").
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { tempUser } from "../lib/tempuser.mjs";
import { waitFor } from "../lib/wait.mjs";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
const LOG = process.env.LOG ?? "", OUT = process.env.OUT ?? "", OLD_UI = process.env.OLD_UI === "1", GAP = Number(process.env.GAP_MS ?? 6000);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logAt = () => (LOG && fs.existsSync(LOG) ? fs.statSync(LOG).size : 0);
const logSince = (at) => { if (!LOG || !fs.existsSync(LOG)) return []; const b = fs.readFileSync(LOG); return b.subarray(at).toString("utf8").split("\n").filter((l) => l.includes("[timing]")); };

const u = await tempUser(B, "helper-calls", { name: "Helper Calls", fullPerms: false, verified: true });
const db = () => { const d = new (createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db")); d.pragma("busy_timeout = 5000"); return d; };
const st = await u.api("POST", "/api/engines/codex/login/start", {});
await fetch(`${M}/mock-login/codex/approve?code=${st.j?.userCode}`).catch(() => {});
ok(!!(await waitFor(async () => (await u.api("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn, 20_000, { every: 500 })), "đăng nhập gói ChatGPT giả lập");

const at0 = logAt(), t0 = Date.now();
const run = async (conv, msgs) => {
  const r = await u.api("POST", "/api/llm", { async: true, skills: true, system: "", model: "auto", effort: "auto", messages: msgs, conv });
  for (let i = 0; i < 400 && r.j?.run; i++) { const x = await u.api("GET", `/api/runs/${r.j.run}?json=1`); if (x.j?.run?.status && x.j.run.status !== "running") return x.j.run.result ?? x.j.run; await sleep(300); }
  return r.j;
};
// Trình duyệt sau mỗi câu trả lời (ui/home.tsx): đặt tên đoạn chat một lần (lỗi thì thử lại ở câu sau); phản biện tự động artifact quan trọng.
const titled = new Set();
const afterReply = async (conv, msgs, reply) => {
  if (!titled.has(conv)) {
    const t = await u.api("POST", "/api/title", { messages: [...msgs, { role: "assistant", content: reply }].map((m) => ({ role: m.role, text: String(m.content) })) });
    if (t.s === 200 && t.j?.title) titled.add(conv);
  }
  const arts = [...String(reply).matchAll(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
  for (const a of arts) {
    if (!OLD_UI && /mode="patch"/.test(a.attrs)) continue;
    if (a.body.split("\n").length < 10) continue;
    await u.api("POST", "/api/critic", { title: "Bản thử", type: "html", content: a.body, model: "", question: "", auto: true });
  }
};
const CONVS = {
  [`hc-a-${Date.now()}`]: ["Xin chào", "Giải thích định luật Ohm thật ngắn gọn", "Cho mình một ví dụ với pin 9V", "Mình là kỹ sư điện, thích câu trả lời ngắn, nhớ giúp mình nhé"],
  [`hc-b-${Date.now()}`]: ["Viết trang HTML đồng hồ đếm ngược 10 phút có nút bắt đầu", "Đổi màu nền sang xanh dương nhạt", "Thêm nút đặt lại", "Cảm ơn nhé"],
};
let turns = 0, planTurns = 0;
for (const [conv, asks] of Object.entries(CONVS)) {
  const msgs = [];
  for (const ask of asks) {
    msgs.push({ role: "user", content: ask });
    const res = await run(conv, msgs);
    const reply = String(res?.text ?? "");
    ok(reply.length > 0 || !!res?.error, `“${ask}” → ${res?.model ?? "?"}${res?.error ? ` lỗi: ${res.error}` : ""}`, res);
    msgs.push({ role: "assistant", content: reply });
    turns++; if (/^sub-codex\//.test(String(res?.model ?? ""))) planTurns++;
    await afterReply(conv, msgs.slice(0, -1), reply);
    await sleep(GAP);
  }
}
// Cho bộ não chưng cất và chăm sóc (nhịp 3 giây trên dev:mock) như sau một quãng nghỉ.
await sleep(Number(process.env.SETTLE_MS ?? 30_000));

const d = db();
const rows = d.prepare("SELECT via, model FROM engine_turns WHERE user_id = ? AND at >= ?").all(u.uid, t0);
const api = d.prepare("SELECT feature, COUNT(*) AS n, SUM(cost) AS cost FROM usage_events WHERE user_id = ? AND at >= ? GROUP BY feature").all(u.uid, t0);
d.close();
const lines = logSince(at0);
const jobs = {};
for (const l of lines) { const j = /\bjob=(\S+)/.exec(l)?.[1] ?? "(lượt người dùng)"; jobs[j] = (jobs[j] ?? 0) + 1; }
const byVia = {};
for (const r of rows) byVia[r.via] = (byVia[r.via] ?? 0) + 1;
const helperRows = rows.filter((r) => r.via === "warm" || r.via.startsWith("job:")).length;
const helperLog = lines.filter((l) => /\bjob=/.test(l)).length;
const usage = (await u.api("GET", "/api/usage?all=1")).j;
const codex = usage?.vendors?.find((v) => v.cli === "codex")?.sub ?? usage?.sub;
const report = { oldUi: OLD_UI, userTurns: turns, planUserTurns: planTurns, planRows: rows.length, byVia, helperRows, timingLines: lines.length, jobsFromLog: jobs, helperLog, helpersPerTurn: Math.round((Math.max(helperRows, helperLog) / turns) * 100) / 100, apiEvents: api, messagesToday: codex?.turnsToday ?? null, helpersToday: codex?.helpersToday ?? null };
console.log(JSON.stringify(report, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
if (!OLD_UI && !process.env.MEASURE_ONLY) {
  ok(report.helpersPerTurn <= 2, `tối đa 2 việc phụ cho mỗi tin nhắn (đo được ${report.helpersPerTurn})`, report);
  // Tự động gửi một số tin sang model khóa API: "tin nhắn hôm nay" của gói ChatGPT là số tin người dùng chạy bằng gói đó.
  ok(codex?.turnsToday === planTurns && codex?.helpersToday === helperRows, `"tin nhắn hôm nay" của gói = ${planTurns} tin người dùng chạy bằng gói (đo được ${codex?.turnsToday}), việc nền đếm riêng (${codex?.helpersToday})`, codex);
}
await u.remove();
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
