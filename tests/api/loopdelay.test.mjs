// Độ trễ vòng lặp sự kiện (server/loopdelay.ts, bật trong instrumentation.ts): dòng "[timing] loop p50=… p99=… max=…" theo nhịp,
// đặt lại sau mỗi lần ghi, giữ mẫu gần nhất cho trang sức khỏe; ô "Độ trễ vòng lặp (p99)" ở Cài đặt → Sức khỏe hệ thống.
// Phần 1–2 không cần máy chủ; phần 3 chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL).
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const block = (ms) => { const t = Date.now(); while (Date.now() - t < ms); };

console.log("1. Đo và ghi nhật ký");
const { loopdelay: L } = await loadTs(["loopdelay"]);
ok(L.loopReport() === null && L.sampleLoop(false) === null, "chưa bật thì không có số đo");
const lines = [];
const log0 = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.startsWith("[timing] loop")) lines.push(s); else log0(...a); };
try {
  L.startLoopMonitor(500);
  const first = globalThis.__synchroLoop;
  L.startLoopMonitor(500);
  ok(first && globalThis.__synchroLoop === first, "gọi lại không tạo bộ đo thứ hai");
  await sleep(100);
  const live = L.loopReport();
  ok(live?.live === true && Number.isFinite(live.p99), "phút đầu (chưa có mẫu): số đo từ lúc bật", live);
  block(250);
  for (let i = 0; i < 40 && !lines.length; i++) await sleep(50);
} finally { console.log = log0; }
const re = /^\[timing\] loop p50=(\d+(?:\.\d)?) p99=(\d+(?:\.\d)?) max=(\d+(?:\.\d)?)$/;
const m = re.exec(lines[0] ?? "");
ok(m, "dòng [timing] loop p50=… p99=… max=… (ms) theo nhịp", lines);
ok(m && Number(m[3]) >= 200 && Number(m[3]) < 2000 && Number(m[1]) < Number(m[3]), "lần chặn 250 ms hiện ở max, p50 nhỏ hơn nhiều (đã trừ chu kỳ 20 ms)", lines[0]);
const rep = L.loopReport();
const last = re.exec(lines.at(-1) ?? "");
ok(rep && rep.live === false && last && rep.max === Number(last[3]) && rep.p99 === Number(last[2]), "trang sức khỏe lấy mẫu vừa ghi", { rep, lines });
clearInterval(globalThis.__synchroLoop.timer);
const next = L.sampleLoop(false);
ok(next && next.max < 100, "sau mỗi lần ghi bộ đếm được đặt lại", next);

console.log("2. Bật lúc máy chủ khởi động");
const inst = fs.readFileSync("instrumentation-node.ts", "utf8");
{ const entry = fs.readFileSync("instrumentation.ts", "utf8"); ok(/NEXT_RUNTIME === "nodejs"[\s\S]*import\("\.\/instrumentation-node"\)\)\.registerNode\(\)/.test(entry), "instrumentation.ts (điểm vào thật của Next) gọi registerNode() ở runtime Node"); }
ok(/import\("\.\/server\/loopdelay"\)\)\.startLoopMonitor\(/.test(inst), "instrumentation-node.ts gọi startLoopMonitor()");
ok(/monitorEventLoopDelay\(\{ resolution: 20 \}\)/.test(fs.readFileSync("server/loopdelay.ts", "utf8").replace("resolution: RESOLUTION", "resolution: 20")), "lấy mẫu mỗi 20 ms");

console.log("3. Cài đặt → Sức khỏe hệ thống");
const { "i18n-vi": V } = await loadTs(["i18n-vi"]);
ok(V.EN2VI["Event-loop delay (p99)"] === "Độ trễ vòng lặp (p99)", "nhãn ô có bản tiếng Việt", V.EN2VI["Event-loop delay (p99)"]);
ok(/\["Event-loop delay \(p99\)", `\$\{h\.loop\.p99/.test(fs.readFileSync("ui/healthui.tsx", "utf8")), "trang sức khỏe có ô Event-loop delay (p99)");
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
if (!cookie) {
  const r = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
}
const hr = await fetch(`${B}/api/admin/health`, { headers: { cookie } });
const h = await hr.json().catch(() => null);
const lp = h?.loop;
ok(hr.status === 200 && lp && [lp.p50, lp.p99, lp.max].every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) && lp.p50 <= lp.p99 && lp.p99 <= lp.max, `/api/admin/health có loop: p99 = ${lp?.p99} ms`, { status: hr.status, loop: lp });
ok(typeof lp?.live === "boolean" && typeof lp?.windowSec === "number", "kèm khoảng đo và cờ live (phút đầu sau khởi động)", lp);
const anon = await fetch(`${B}/api/admin/health`);
ok(anon.status === 401, "chỉ quản trị viên xem được", anon.status);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
