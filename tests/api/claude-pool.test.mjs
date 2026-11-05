// Đường nhanh của Claude Code: tiến trình khởi động sẵn (cli_pool.ts) trên CLI giả lập có thời gian khởi động thật. Đo bằng chính các mốc [timing], kiểm tra cô lập theo tài khoản,
// giới hạn số tiến trình, rơi về cách cũ khi CLI không xử lý được stream-json, và lượt chat đầy đủ qua chatPost. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-pool-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SYNCHRO_ENGINE_HOME = HOME;
process.env.DATA_KEY = "pool-test-key";
process.env.SYNCHRO_CLAUDE_POOL_MAX = "4";
delete process.env.SYNCHRO_ENGINE_USER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
const SRC = path.join(process.cwd(), "scripts", "mock-cli");
for (const f of ["claude", "mock-cli-common.cjs"]) fs.copyFileSync(path.join(SRC, f), path.join(BIN, f));
fs.chmodSync(path.join(BIN, "claude"), 0o755);
const START_MS = 500;
const cfg = (o = {}) => fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: START_MS, ...o }));
cfg();

const BR = 4800 + Math.floor(Math.random() * 400);
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${BR}`;
const { "ai/cli_engines": CE, "ai/cli_pool": PO, "ai/subs": SUBS, chatengine: CH, authstore: AU, "ai/cli_auth": A, skillstudio: ST, mcpbridge: MB } =
  await loadTs(["ai/cli_engines", "ai/cli_pool", "ai/subs", "chatengine", "authstore", "ai/cli_auth", "skillstudio", "mcpbridge"]);
http.createServer(async (q, a) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const r = await MB.bridgeRoute(new Request(`http://x${q.url}`, { method: q.method, headers: { "content-type": "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), q.url.split("/").pop());
  a.writeHead(r.status, { "content-type": "application/json" }); a.end(await r.text());
}).listen(BR, "127.0.0.1").unref();

const eng = new CE.ClaudeCodeEngine();
const acct = (n) => { const d = path.join(HOME, "logins", "claude", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, ".mock-login"), "1"); return { CLAUDE_CONFIG_DIR: d }; };
const work = (n) => path.join(HOME, "work", n);
const run = async (req) => {
  const t0 = Date.now(); let first = 0, text = "", session = null, state = null, err = null, final = null;
  for await (const e of eng.runTurn({ pool: true, ...req })) {
    if (e.kind === "text") { first ||= Date.now() - t0; text += e.text; }
    else if (e.kind === "session") session = e.id;
    else if (e.kind === "pool") state = e.state;
    else if (e.kind === "error") err = e;
    else if (e.kind === "final") final = e.text;
  }
  return { first, text, session, state, err, final };
};
const pid = (r) => Number(/PID (\d+)/.exec(r.final ?? r.text)?.[1] ?? 0);

try {
  console.log("1. Tiến trình khởi động sẵn bỏ được thời gian khởi động");
  const a = acct("a"), base = { env: a, workdir: work("a"), model: "haiku", system: "Trả lời ngắn." };
  const cold = await run({ ...base, prompt: "#pid một" });
  ok(cold.state === "cold" && !cold.err && pid(cold) && cold.first >= START_MS, `lần đầu phải khởi động: chữ đầu sau ${cold.first} ms`, JSON.stringify(cold));
  const conv = await run({ ...base, prompt: "#pid hai", sessionId: cold.session });
  ok(conv.state === "hit" && pid(conv) === pid(cold) && /lượt 2/.test(conv.final), `câu nối tiếp dùng lại đúng tiến trình, CLI nhớ hội thoại: ${conv.final}`, JSON.stringify(conv));
  ok(conv.first < START_MS, `câu nối tiếp không chờ khởi động: chữ đầu sau ${conv.first} ms`, conv.first);
  await sleep(START_MS + 200);
  const spare = await run({ ...base, prompt: "#pid đoạn chat mới" });
  ok(spare.state === "hit" && pid(spare) !== pid(cold) && spare.session !== cold.session && /lượt 1/.test(spare.final), "đoạn chat mới dùng tiến trình đợi sẵn, phiên riêng", JSON.stringify(spare));
  ok(spare.first < START_MS, `đoạn chat mới cũng không chờ khởi động: chữ đầu sau ${spare.first} ms`, spare.first);

  console.log("2. Cô lập theo tài khoản, model, hướng dẫn");
  const b = acct("b");
  await sleep(100);
  const other = await run({ env: b, workdir: work("b"), model: "haiku", system: "Trả lời ngắn.", prompt: "#pid tài khoản khác" });
  ok(other.state === "cold" && ![pid(cold), pid(spare)].includes(pid(other)), "tài khoản khác không dùng tiến trình của tài khoản này", JSON.stringify(other));
  const m2 = await run({ ...base, model: "sonnet", prompt: "#pid model khác" });
  ok(m2.state === "cold", "model khác: tiến trình khác");
  const s2 = await run({ ...base, system: "Hướng dẫn khác.", prompt: "#pid hướng dẫn khác" });
  ok(s2.state === "cold", "hướng dẫn hệ thống khác: tiến trình khác");

  console.log("3. Giới hạn số tiến trình");
  await sleep(300);
  ok(PO.poolSize() <= 4, `không vượt mức tối đa: ${PO.poolSize()}`, PO.poolSize());
  PO.dropAll();
  await sleep(100);
  ok(PO.poolSize() === 0, "tắt hết được");
  process.env.SYNCHRO_CLAUDE_POOL_MAX = "0";
  const off = await run({ ...base, prompt: "#pid tắt hồ" });
  ok(off.state === null && pid(off) && !off.err, "SYNCHRO_CLAUDE_POOL_MAX=0: chạy như cũ, mỗi lượt một tiến trình", JSON.stringify(off));
  process.env.SYNCHRO_CLAUDE_POOL_MAX = "4";

  console.log("4. Lượt có công cụ nối tiếp phiên: tiến trình cũ không dùng lại");
  const t1 = await run({ ...base, prompt: "#pid mở phiên" });
  const t2 = await run({ ...base, prompt: "lượt có công cụ", sessionId: t1.session, pool: false });
  ok(!t2.err, "lượt thường nối tiếp phiên chạy được", JSON.stringify(t2));
  const t3 = await run({ ...base, prompt: "#pid sau công cụ", sessionId: t1.session });
  ok(t3.state === "cold" && pid(t3) !== pid(t1) && /lượt 3/.test(t3.final), `tiến trình cũ đã bị bỏ, khởi động lại với --resume nên đủ hội thoại: ${t3.final}`, JSON.stringify(t3));

  console.log("5. Tài khoản đăng xuất: tiến trình giữ đăng nhập cũ bị tắt");
  await sleep(200);
  PO.dropAccount(a.CLAUDE_CONFIG_DIR);
  await sleep(200);
  ok(PO.poolSize() === 0, "không còn tiến trình nào của tài khoản", PO.poolSize());

  console.log("6. Dừng và treo");
  {
    const ac = new AbortController();
    const p = run({ ...base, prompt: "[mock:hang] chờ", signal: ac.signal });
    await sleep(START_MS + 200);
    ac.abort();
    const r = await p;
    ok(r.err?.code === "aborted", "bấm Dừng: báo aborted", JSON.stringify(r));
    await sleep(200);
    ok(PO.poolSize() <= 1, "tiến trình đang chạy lượt bị dừng thì bị tắt", PO.poolSize());
    PO.dropAll();
  }

  console.log("7. Lượt báo lỗi không giữ tiến trình");
  {
    const r = await run({ ...base, prompt: "[mock:quota] chào" });
    ok(r.err?.code === "quota", "hết hạn mức: báo đúng loại lỗi", JSON.stringify(r));
    await sleep(100);
    ok(PO.poolSize() === 0, "tiến trình của lượt lỗi không được giữ lại", PO.poolSize());
  }

  console.log("8. CLI chỉ in init ở lượt đầu: mã phiên vẫn có");
  {
    cfg({ initOnce: true });
    const r1 = await run({ ...base, prompt: "#pid một" });
    const r2 = await run({ ...base, prompt: "#pid hai", sessionId: r1.session });
    ok(r2.state === "hit" && r2.session === r1.session, "đọc mã phiên từ result", JSON.stringify(r2));
    PO.dropAll(); cfg();
  }

  console.log("9. CLI không xử lý được stream-json: rơi về cách cũ");
  {
    cfg({ dieStream: true });
    const r = await run({ ...base, prompt: "#pid thoát ngay" });
    ok(!r.err && pid(r), "CLI thoát ngay khi có cờ stream-json: lượt vẫn trả lời bằng tiến trình thường", JSON.stringify(r));
    const r2 = await run({ ...base, prompt: "#pid lần hai" });
    const r3 = await run({ ...base, prompt: "#pid lần ba" });
    ok(!r2.err && !r3.err && !PO.poolOn(), "hỏng ba lần liên tiếp: tạm tắt hồ", JSON.stringify([r2, r3, PO.poolOn()]));
    const r4 = await run({ ...base, prompt: "#pid khi hồ tắt" });
    ok(r4.state === null && !r4.err, "hồ đang tắt: chạy thẳng cách cũ, không tốn thêm thời gian", JSON.stringify(r4));
    PO.dropAll(); cfg();
  }

  console.log("9b. CLI nhận cờ nhưng không phản hồi tin nhắn: hết giờ thì rơi về cách cũ");
  {
    cfg({ deafStream: true });
    PO.dropAll();
    process.env.SYNCHRO_CLAUDE_POOL_FIRST_SEC = "1";
    const t0 = Date.now();
    const r = await run({ ...base, prompt: "#pid điếc" });
    delete process.env.SYNCHRO_CLAUDE_POOL_FIRST_SEC;
    ok(!r.err && pid(r) && Date.now() - t0 < 5000, `lượt vẫn trả lời bằng tiến trình thường sau ${Date.now() - t0} ms`, JSON.stringify(r));
    PO.dropAll(); cfg();
  }

  console.log("10. Lượt chat thật qua chatPost: câu chào đi đường nhanh, lượt sau vẫn có công cụ");
  {
    ST.getTag("x");
    const user = AU.createUser({ email: `pool${Date.now()}@synchro.test`, name: "Pool", verified: true });
    await A.startLogin("claude", user.id, "oauth");
    await A.submitCode("claude", user.id, "MOCK-CLAUDE-OK");
    await A.status("claude", user.id, { fresh: true });
    const conv = `pool-${Date.now()}`;
    const post = async (messages, extra = {}) => { const res = await CH.chatPost({ skills: true, model: "sub-claude/haiku", conv, messages, ...extra }, { user }, { feature: "chat" }); return { s: res.status, j: await res.json() }; };
    const u1 = { role: "user", content: "Xin chào" };
    let r = await post([u1]);
    ok(r.s === 200 && !/công cụ Synchro/.test(r.j.text) && /lượt 1/.test(r.j.text), "câu chào: không cầu nối MCP", JSON.stringify(r.j).slice(0, 300));
    ok(SUBS.sessionPlain(user.id, conv, "claude"), "phiên chưa gọi công cụ");
    const u2 = { role: "user", content: "Viết báo cáo về mùa thu" };
    r = await post([u1, { role: "assistant", content: r.j.text }, u2]);
    ok(r.s === 200 && /công cụ Synchro: \d+/.test(r.j.text) && /lượt 2/.test(r.j.text), "lượt sau: đủ công cụ, nối đúng phiên", JSON.stringify(r.j).slice(0, 300));
    const a3 = r.j.text;
    const u3 = { role: "user", content: `Thủ đô của Úc là gì? needtools` };
    fs.writeFileSync(path.join(BIN, ".keep"), "");
    r = await post([u1, { role: "assistant", content: "x" }, u2, { role: "assistant", content: a3 }, u3], { conv: `${conv}-m` });
    ok(r.s === 200 && !/CAN_CONG_CU/.test(r.j.text) && /công cụ Synchro: \d+/.test(r.j.text), "model báo cần công cụ: chạy lại lượt đầy đủ, người dùng không thấy dấu hiệu", JSON.stringify(r.j).slice(0, 300));
    // Nhờ viết ngắn: đường nhanh, tiến trình khởi động sẵn đúng model và nỗ lực; không đụng tới lượt có công cụ.
    {
      PO.dropAll();
      const w = `${conv}-w`, ask = { role: "user", content: "Viết bài thơ về mùa thu" };
      const res = await CH.chatPost({ skills: true, model: "sub-claude/haiku", effort: "medium", conv: w, messages: [ask] }, { user }, { feature: "chat" });
      const j = await res.json();
      ok(res.status === 200 && !/công cụ Synchro/.test(j.text), "nhờ viết ngắn: không cầu nối MCP", JSON.stringify(j).slice(0, 300));
      ok(PO.poolSize() >= 1, "lượt nhờ viết chạy trong hồ tiến trình", PO.poolSize());
      const res2 = await CH.chatPost({ skills: true, model: "sub-claude/haiku", effort: "medium", conv: w, messages: [ask, { role: "assistant", content: j.text }, { role: "user", content: "ngắn hơn đi" }] }, { user }, { feature: "chat" });
      const j2 = await res2.json();
      ok(res2.status === 200 && !/công cụ Synchro/.test(j2.text) && /lượt 2/.test(j2.text), "chỉnh tiếp bài viết: vẫn đường nhanh, nối đúng phiên", JSON.stringify(j2).slice(0, 300));
    }
    r = await post([u1], { conv: `${conv}-p`, pickedSkills: ["abc"] });
    ok(r.s === 200, "có skill tự chọn: vẫn chạy", JSON.stringify(r.j).slice(0, 200));
    r = await post([{ role: "user", content: "#pid chào" }], { conv: `${conv}-s` });
    const big = Number(/hệ thống (\d+) ký tự/.exec(r.j.text)?.[1] ?? 0);
    PO.dropAll();
    const res = await CH.chatPost({ skills: true, model: "sub-claude/haiku", conv: `${conv}-f`, messages: u1 ? [{ role: "user", content: "Xin chào" }] : [] }, { user }, { feature: "chat" });
    ok(res.status === 200 && big > 2000, `lượt đầy đủ có hướng dẫn dài (${big} ký tự)`, big);
  }
} finally {
  PO.dropAll();
  await sleep(100);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
