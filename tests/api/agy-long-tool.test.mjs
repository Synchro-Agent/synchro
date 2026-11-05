// Antigravity cắt mỗi lần chờ công cụ hay chờ duyệt ở khoảng 190 giây (đo trên agy 1.5.0): CLI giả lập cắt y như vậy (rút ngắn), công cụ chạy lâu hơn hạn vẫn phải ra kết quả thật
// nhờ job_id và wait_for_result. Không kiểm được trên agy thật ở đây. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 800)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-agylong-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin"), DATA = path.join(tmp, "data");
process.env.DATA_DIR = DATA; process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.SYNCHRO_ENGINE_USER = ""; process.env.DATA_KEY = "agylong-test"; delete process.env.SYNCHRO_ENGINE_BWRAP;
fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
const LIMIT = 400; // agy thật: 190 giây
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", toolLimitMs: LIMIT }));
const BR = 4300 + Math.floor(Math.random() * 400);
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${BR}`;
const { "ai/cli_engines": E, "ai/cli_auth": A, mcpbridge: M } = await loadTs(["ai/cli_engines", "ai/cli_auth", "mcpbridge"]);
const srv = http.createServer(async (q, a) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const r = await M.bridgeRoute(new Request(`http://x${q.url}`, { method: q.method, headers: { "content-type": "application/json", accept: q.headers.accept ?? "" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), q.url.split("/").pop());
  a.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }); a.end(await r.text());
}).listen(BR, "127.0.0.1");
srv.unref();

const U = "agylong";
const dir = path.join(HOME, "logins", "agy", U), tok = path.join(dir, ".gemini/antigravity-cli/antigravity-oauth-token");
fs.mkdirSync(path.dirname(tok), { recursive: true, mode: 0o700 }); fs.writeFileSync(tok, "{}"); fs.writeFileSync(path.join(DATA, "engine-tokens", `agy-${U}.login`), "1");
A.forget("agy", U);
const env = A.engineEnv("agy", U), work = path.join(HOME, "work", U); fs.mkdirSync(work, { recursive: true });
const tools = [{ name: "chay_lau", description: "", input_schema: {} }, { name: "duyet", description: "", input_schema: {} }];
const runTurn = async (prompt, bridge, signal) => {
  let final = "", err = null;
  for await (const e of new E.AntigravityEngine().runTurn({ prompt, env, workdir: work, signal, mcp: { url: bridge.url, alive: bridge.alive, onPark: bridge.onPark } })) {
    if (e.kind === "final") final = e.text; else if (e.kind === "error") err = e.message;
  }
  return { final, err };
};

console.log("1. Công cụ chạy lâu hơn hạn của agy");
{
  let done = 0;
  const call = async (name) => { await sleep(1500); done++; return { content: `kết quả thật của ${name}`, is_error: false }; };
  const noHold = M.openBridge({ uid: U, tools, call });
  const a = await runTurn("#tool=chay_lau", noHold);
  ok(/lỗi/.test(a.final) && !/kết quả thật/.test(a.final), "không có hold: CLI tự cắt, model thấy lỗi (đúng lỗi gốc)", a);
  noHold.close();
  await sleep(1300);
  const held = M.openBridge({ uid: U, tools, hold: 150, call });
  const b = await runTurn("#tool=chay_lau", held);
  ok(/kết quả thật của chay_lau/.test(b.final) && /đã chờ \d+ lần/.test(b.final) && !b.err, "có hold: model gọi wait_for_result, nhận kết quả thật", b);
  ok(!held.pendingJobs().length, "không còn việc treo sau khi đã lấy kết quả", held.pendingJobs());
  held.close();
}
console.log("2. Chờ người dùng duyệt lâu hơn hạn của agy");
{
  let answer = () => {};
  const held = M.openBridge({ uid: U, tools, hold: 150, call: () => new Promise((r) => { answer = () => r({ content: "đã được duyệt và chạy", is_error: false }); }) });
  const p = runTurn("#tool=duyet", held);
  await sleep(1300);
  answer();
  const r = await p;
  ok(/đã được duyệt và chạy/.test(r.final) && !r.err, "câu trả lời duyệt tới sau nhiều lần chờ vẫn tới được model", r);
  held.close();
}
console.log("3. Model bỏ lửng, kết thúc lượt khi job chưa xong");
{
  const held = M.openBridge({ uid: U, tools, hold: 100, call: async () => { await sleep(500); return { content: "kết quả muộn", is_error: false }; } });
  const r = await runTurn("#tool=chay_lau [mock:nowait]", held);
  const pend = held.pendingJobs();
  ok(pend.length === 1 && pend[0].name === "chay_lau", "cầu nối biết còn việc chưa lấy kết quả, lượt chat nhắc model", pend);
  const nudge = `Còn công cụ chưa lấy kết quả (${pend.map((x) => `${x.name}: job_id ${x.id}`).join("; ")})`;
  const r2 = await runTurn(`${r.final}\n#tool=chay_khac [mock:nowait]\n${nudge}`, held);
  ok(/kết quả muộn/.test(r2.final) && !held.pendingJobs().length, "lần chạy CLI sau trên cùng cầu nối lấy được kết quả", r2);
  held.close();
}
console.log("4. Bấm Dừng khi đang chờ");
{
  const stop = new AbortController();
  let seen = false;
  const held = M.openBridge({ uid: U, tools, hold: 100, call: (_n, _i, cancel) => new Promise((res) => { cancel.addEventListener("abort", () => { seen = true; res({ content: "đã hủy", is_error: true }); }, { once: true }); }) });
  const t0 = Date.now();
  const p = runTurn("#tool=chay_lau", held, stop.signal);
  await sleep(500);
  stop.abort();
  const r = await p;
  ok(Date.now() - t0 < 5000 && (r.err !== null || !r.final), "Dừng: CLI dừng ngay, không chờ công cụ", r);
  held.close();
  ok(seen, "đóng cầu nối sau Dừng: công cụ nhận tín hiệu hủy", seen);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
