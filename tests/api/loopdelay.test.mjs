// Độ trễ vòng lặp sự kiện (app/loopdelay.ts, bật trong instrumentation.ts): dòng "[timing] loop p50=… p99=… max=…" theo nhịp,
// đặt lại sau mỗi lần ghi, giữ mẫu gần nhất cho trang sức khỏe. Không cần máy chủ.
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
const inst = fs.readFileSync("instrumentation.ts", "utf8");
ok(/import\("\.\/app\/loopdelay"\)\)\.startLoopMonitor\(/.test(inst), "instrumentation.ts gọi startLoopMonitor()");
ok(/monitorEventLoopDelay\(\{ resolution: 20 \}\)/.test(fs.readFileSync("app/loopdelay.ts", "utf8").replace("resolution: RESOLUTION", "resolution: 20")), "lấy mẫu mỗi 20 ms");

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
