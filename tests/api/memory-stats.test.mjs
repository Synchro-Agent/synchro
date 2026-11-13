// Theo dõi bộ nhớ máy chủ: dòng [timing] mem trong nhật ký, 48 mẫu gần nhất cho trang Sức khỏe hệ thống, số liệu các bộ đệm lớn. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-memstat-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { memstat: M } = await loadTs(["memstat", "artimg", "agentruns", "skillroute"]);
try {
  const logs = [], real = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  M.registerMemStat("hong", () => { throw new Error("x"); });
  // Số liệu đo bất đồng bộ (G3.4: RSS cây tiến trình CLI): dòng nhật ký ghi sau khi đo xong; đo lỗi thì bỏ, không mất cả dòng.
  M.registerMemProbe("cli", async () => ({ n: 2, sumMB: 812, maxMB: 455 }));
  M.registerMemProbe("hong2", async () => { throw new Error("y"); });
  const s = M.sampleMem();
  const early = logs.length;
  for (let i = 0; i < 50 && !logs.length; i++) await new Promise((r) => setTimeout(r, 10));
  console.log = real;
  ok(early === 0, "sampleMem trả mẫu ngay, chưa chặn chờ đo");
  ok(s.heapUsed > 0 && s.rss >= s.heapUsed, "mẫu có heap và RSS (MB)", s);
  ok(/^\[timing\] mem heapUsed=\d+MB heapTotal=\d+MB external=\d+MB arrayBuffers=\d+MB rss=\d+MB/.test(logs[0] ?? ""), "dòng nhật ký đúng dạng", logs[0]);
  ok(/artImages=n:0\/MB:0/.test(logs[0]) && /codeRuns=runs:0\/MB:0/.test(logs[0]) && /skillIndex=skills:\d+/.test(logs[0]), "dòng nhật ký có số liệu các bộ đệm", logs[0]);
  ok(!/hong=/.test(logs[0]), "bộ đệm lỗi số liệu không làm hỏng dòng nhật ký", logs[0]);
  ok(/ cli=n:2\/sumMB:812\/maxMB:455/.test(logs[0]) && !/hong2=/.test(logs[0]), "dòng nhật ký có RSS cây CLI (cli=n/sumMB/maxMB), đo lỗi thì bỏ", logs[0]);
  for (let i = 0; i < 60; i++) M.sampleMem(false);
  const r = M.memReport();
  ok(r.history.length === 48, `giữ 48 mẫu gần nhất (${r.history.length})`, r.history.length);
  ok(r.heapLimit > 0 && r.now.heapUsed <= r.heapLimit, `có giới hạn heap (${r.heapLimit} MB)`, r);
  ok(r.caches.artImages && r.caches.codeRuns && r.caches.skillIndex, "trang sức khỏe thấy các bộ đệm", Object.keys(r.caches));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
