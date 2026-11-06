// Cổng lượt model: mỗi tài khoản chỉ giữ vài lượt cùng lúc, phần dư xếp hàng công bằng; hàng đầy thì từ chối rõ ràng; Dừng được lúc đang chờ.
// Phần đầu không cần máy chủ; phần sau chạy trên máy chủ giả lập với tài khoản riêng và giới hạn riêng (turns_limit:<id>).
import { createRequire } from "node:module";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

const B = process.env.SYNCHRO_TEST_URL || "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

// Bộ hẹn giờ của cổng không giữ tiến trình: bài này tự giữ.
setInterval(() => {}, 1000);
process.env.SYNCHRO_TURNS_GLOBAL = "3";
const { acquire, queuedOf, runningOf, gateStats } = (await loadTs(["turngate"])).turngate;

const held = [await acquire({ uid: "a", lane: "run", limit: 2 }), await acquire({ uid: "a", lane: "run", limit: 2 })];
ok(typeof held[0] === "function" && runningOf("a") === 2, "tài khoản giữ đủ số lượt cho phép");
const order = [];
let why = null;
const a3 = acquire({ uid: "a", lane: "run", limit: 2, onWait: (w) => { why = w; } }).then((s) => { order.push("a3"); return s; });
ok(why === "account" && queuedOf("a") === 1, "quá mức của tài khoản: xếp hàng và báo đúng lý do", why);
const b1 = await acquire({ uid: "b", lane: "run", limit: 2 });
ok(typeof b1 === "function", "tài khoản khác không bị hàng của tài khoản đầu chặn");
let whyB = null;
const b2 = acquire({ uid: "b", lane: "run", limit: 2, onWait: (w) => { whyB = w; } }).then((s) => { order.push("b2"); return s; });
ok(whyB === "server", "cả máy đầy: báo máy chủ bận", whyB);
const c1 = acquire({ uid: "c", lane: "run", limit: 2 }).then((s) => { order.push("c1"); return s; });
held[0]();
await new Promise((r) => setTimeout(r, 5));
ok(order[0] === "c1", "có chỗ: tài khoản đang chạy ít lượt nhất được trước", order.join());
held[0]();
ok(gateStats().running === 3, "trả chỗ hai lần không làm sai số đếm", gateStats().running);
const ctl = new AbortController();
const d1 = acquire({ uid: "d", lane: "run", limit: 2, signal: ctl.signal });
ctl.abort();
ok((await d1) === "cancelled" && queuedOf("d") === 0, "Dừng lúc đang chờ: rời hàng ngay");
ok((await acquire({ uid: "e", lane: "run", limit: 2, maxWaitMs: 20 })) === "timeout", "chờ quá hạn: báo hết giờ, không treo");
for (const s of [held[1], b1, await c1]) s();
for (const s of await Promise.all([a3, b2])) s();
ok(gateStats().running === 0 && gateStats().waiting === 0, "xong hết: không còn lượt chạy hay chờ", JSON.stringify(gateStats()));

// ---- qua API ----
let cookie = "";
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b && JSON.stringify(b) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro")) cookie = c.split(";")[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
const email = `gate-${Date.now()}@synchro.test`;
await call("POST", "/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName: "Gate Tester", birthDate: "2000-01-01" } });
await call("POST", "/api/auth/login", { email, password: "Member-pass-123" });
const me = await call("GET", "/api/auth/me");
const uid = me.j?.user?.id;
ok(!!uid, "có tài khoản thử riêng", JSON.stringify(me.j));
const R = createRequire(path.join(process.cwd(), "package.json"));
const db = new (R("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db"));
db.pragma("busy_timeout = 5000");
db.prepare("INSERT INTO settings (key, value) VALUES (?, '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run(`turns_limit:${uid}`);
try {
  const ask = (i) => call("POST", "/api/llm", { async: true, skills: true, system: "", model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: `#slow câu ${i}` }], conv: `gate-${Date.now()}-${i}` });
  const rs = [];
  for (const i of [0, 1, 2, 3]) rs.push(await ask(i));
  ok(rs.every((r) => r.s === 200 && /^run_/.test(r.j?.run ?? "")), "gửi quá giới hạn vẫn được nhận và trả mã lượt", JSON.stringify(rs.map((r) => r.s)));
  const runs = rs.map((r) => r.j.run);
  const look = async (id) => (await call("GET", `/api/runs/${id}?json=1`)).j?.run;
  await new Promise((r) => setTimeout(r, 400));
  const states = await Promise.all(runs.map(look));
  const queued = states.filter((r) => r?.status === "running" && r.events.some((e) => /xếp hàng/.test(e.text)));
  ok(queued.length === 2, "phần vượt giới hạn hiện rõ đang xếp hàng", JSON.stringify(states.map((r) => r?.events?.map((e) => e.text))));
  // Dừng một lượt đang chờ: kết thúc ngay, không gọi model.
  const stop = await call("DELETE", `/api/runs/${queued[0].id}`);
  ok(stop.s === 200, "dừng được lượt đang chờ", JSON.stringify(stop));
  let st = null;
  for (let i = 0; i < 40 && st?.status !== "done"; i++) { st = await look(queued[0].id); await new Promise((r) => setTimeout(r, 100)); }
  ok(st?.status === "done" && st.result?.cancelled === true, "lượt đang chờ bị dừng kết thúc là đã dừng", JSON.stringify(st?.result));
  // Giới hạn riêng 2 nên hàng chờ tối đa 4: 1 lượt đang chờ + 3 lượt nữa là đầy, lượt kế tiếp bị từ chối rõ ràng.
  for (const i of [4, 5, 6]) { const r = await ask(i); if (r.j?.run) runs.push(r.j.run); }
  const over = await ask(7);
  ok(over.s === 429 && over.j?.turnQueue === true && /quá nhiều lượt/.test(over.j?.error ?? ""), "hàng đầy: từ chối với lời nhắn dễ hiểu", JSON.stringify(over));
  for (const id of runs) {
    let r = null;
    for (let i = 0; i < 300 && r?.status !== "done" && r?.status !== "error"; i++) { r = await look(id); if (r?.status === "running") await new Promise((ok2) => setTimeout(ok2, 200)); }
    ok(r?.status === "done", "lượt trong hàng tự chạy khi có chỗ và xong", JSON.stringify(r?.result).slice(0, 200));
  }
} finally {
  db.prepare("DELETE FROM settings WHERE key = ?").run(`turns_limit:${uid}`);
  db.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
