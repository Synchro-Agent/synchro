// Bộ nhớ của lượt Synchro Code: lượt đã xong tự rời bộ nhớ khi hết hạn giữ (không đợi lượt mới hay người hỏi), lượt đã lưu trọn vào phiên chỉ giữ
// thêm ít phút, bộ đệm đếm đúng số byte đã giữ. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-agentmem-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"); process.env.SKILLS_DIR = path.join(tmp, "data", "skills"); process.env.DATA_KEY = "k";
process.env.SYNCHRO_AGENT_KEEP_MS = "400"; process.env.SYNCHRO_AGENT_SAVED_KEEP_MS = "80";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const { authstore: AS, agentruns: A, codestore: C } = await loadTs(["authstore", "agentruns", "codestore"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const node = (id) => ({ id, parent: 0, user: "u", ai: "", done: false, steps: [] });

try {
  const u = AS.createUser({ email: "a@agentmem.test", name: "A", verified: true });
  console.log("1. Lượt đã lưu trọn vào phiên: rời bộ nhớ sau hạn giữ ngắn, trình duyệt lấy kết quả từ phiên");
  {
    const run = A.startAgentRun({ uid: u.id, sid: "2100", node: node(1), title: "t" }, async (emit) => { emit({ t: "text", text: "xin chào" }); emit({ t: "done", text: "xong" }); });
    await sleep(20);
    ok(run.ended > 0 && run.saved === true, "lượt xong và đã lưu", { ended: run.ended, saved: run.saved });
    ok(A.latestRun(u.id, "2100") === run, "ngay sau khi xong vẫn nối lại được");
    ok(C.getSession(u.id, 2100)?.data?.nodes?.[0]?.done === true, "phiên đã có kết quả cuối", C.getSession(u.id, 2100)?.data);
    await sleep(150);
    ok(A.runStats().runs === 0, "hết hạn giữ: tự rời bộ nhớ mà không cần sweep", A.runStats());
  }
  console.log("2. Lượt không lưu được vào phiên (không có lượt để lưu): giữ đủ hạn dài rồi cũng tự rời bộ nhớ");
  {
    const run = A.startAgentRun({ uid: u.id, sid: "2200", node: null }, async (emit) => { emit({ t: "done", text: "xong" }); });
    await sleep(150);
    ok(!run.saved && A.runStats().runs === 1, "chưa tới hạn dài: còn giữ (bộ đệm là bản duy nhất)", A.runStats());
    await sleep(400);
    ok(A.runStats().runs === 0, "quá hạn dài: tự rời bộ nhớ", A.runStats());
  }
  console.log("3. Bộ đệm đếm đúng số byte, không tính trần 200 KB mỗi sự kiện");
  {
    const big = "x".repeat(3_000_000);
    const run = A.startAgentRun({ uid: u.id, sid: "2300", node: null }, async (emit) => {
      for (let i = 0; i < 8; i++) emit({ t: "result", id: `r${i}`, ok: true, summary: "s", output: big });
    });
    await sleep(20);
    const kept = run.lines.reduce((n, l) => n + JSON.stringify(l.e).length, 0);
    ok(Math.abs(run.bytes - kept) < 100, `số byte đếm khớp phần thực giữ (${run.bytes} / ${kept})`, { bytes: run.bytes, kept });
    ok(kept < 16_500_000, `phần giữ không vượt trần ~16 MB (${(kept / 1e6).toFixed(1)} MB)`, kept);
    ok(run.lines.length === 8 && run.lines.every((l) => l.e.summary === "s"), "vẫn giữ tóm tắt của mọi kết quả");
  }
  console.log("4. Người xem đi mất (ghi vào luồng lỗi): thôi nghe và tắt hẹn giờ ping");
  {
    const live = new Set(), realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
    globalThis.setInterval = (f, ms, ...a) => { const t = realSI(f, ms, ...a); live.add(t); return t; };
    globalThis.clearInterval = (t) => { live.delete(t); realCI(t); };
    let release;
    const run = A.startAgentRun({ uid: u.id, sid: "2400", node: null }, (emit) => new Promise((ok) => { release = () => { emit({ t: "text", text: "sau khi người xem đi" }); ok(); }; }));
    const res = A.runStream(run, 0, new AbortController().signal);
    const reader = res.body.getReader();
    await reader.read();
    const ping = [...live];
    ok(run.listeners.size === 1, "đang có một người nghe");
    const C = globalThis.ReadableStreamDefaultController.prototype, real = C.enqueue;
    C.enqueue = function () { throw new TypeError("Invalid state: Controller is already closed"); };
    release();
    await sleep(20);
    C.enqueue = real;
    ok(run.listeners.size === 0, "ghi lỗi: thôi nghe ngay, không giữ lượt", run.listeners.size);
    ok(ping.length > 0 && ping.every((t) => !live.has(t)), "hẹn giờ ping đã tắt", { ping: ping.length, live: live.size });
    globalThis.setInterval = realSI; globalThis.clearInterval = realCI;
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
