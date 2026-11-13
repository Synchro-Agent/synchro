// Blueprint G2.2 / G2.3: lượt có công cụ không còn luôn khởi động lạnh.
// - Cầu nối sống theo cuộc trò chuyện (mcpbridge): một địa chỉ cho cả cuộc trò chuyện, trỏ vào cầu nối của lượt đang chạy.
// - Claude Code: tiến trình dựng sẵn phục vụ lượt có công cụ qua địa chỉ sống; đổi bộ công cụ thì không dùng nhầm tiến trình cũ.
// - Codex: một app-server cho mỗi tài khoản, lượt gửi qua JSON-RPC; hỏng thì về codex exec (ghi nhật ký); vẫn chặn công cụ chạy trên máy chủ.
// Đo thời gian tới chữ đầu của lượt có công cụ trên CLI giả lập có thời gian khởi động. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-warmtools-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin");
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.DATA_KEY = "warm-tools-test";
process.env.SYNCHRO_CLAUDE_POOL_MAX = "4"; process.env.SYNCHRO_CODEX_SERVER_MAX = "3";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.SYNCHRO_ENGINE_BWRAP; delete process.env.SYNCHRO_CODEX_SERVER;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); fs.mkdirSync(BIN, { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
// Thời gian khởi động giả lập của CLI: Claude Code ~1,7 giây đo trên máy chủ thật; Codex exec đọc cấu hình, đăng nhập, nối MCP.
const START_MS = 1200;
const cfg = (o = {}) => fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", startMs: START_MS, codexStartMs: START_MS, ...o }));
cfg();
const BR = 4300 + Math.floor(Math.random() * 400);
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${BR}`;
const { "ai/cli_engines": CE, "ai/codex_server": CS, mcpbridge: MB } = await loadTs(["ai/cli_engines", "ai/codex_server", "mcpbridge"]);
const srv = http.createServer(async (q, a) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const r = await MB.bridgeRoute(new Request(`http://x${q.url}`, { method: q.method, headers: { "content-type": "application/json", accept: q.headers.accept ?? "" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), q.url.split("/").pop());
  a.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }); a.end(await r.text());
}).listen(BR, "127.0.0.1");
srv.unref();
const rpc = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
const T1 = [{ name: "dem", description: "đếm", input_schema: {} }], T2 = [...T1, { name: "them", description: "thêm", input_schema: {} }];
let calls = [];
const bridge = (conv, tools = T1, tag = "") => MB.openBridge({ uid: "u1", conv, tools, call: async (name) => { calls.push(`${tag}${name}`); return { content: `ket qua ${tag}${name}`, is_error: false }; } });
const mcpOf = (b) => ({ url: b.url, alive: b.alive, live: b.live });
async function run(eng, req) {
  const t0 = Date.now(), o = { first: 0, text: "", final: null, err: null, code: null, session: null, state: null, ms: 0 };
  for await (const e of eng.runTurn(req)) {
    if (e.kind === "text") { o.first ||= Date.now() - t0; o.text += e.text; }
    else if (e.kind === "final") o.final = e.text;
    else if (e.kind === "error") { o.err = e.message; o.code = e.code; }
    else if (e.kind === "session") o.session = e.id;
    else if (e.kind === "pool") o.state = e.state;
  }
  o.ms = Date.now() - t0;
  return o;
}
const warns = [];
const warn0 = console.warn;
console.warn = (...a) => { warns.push(a.join(" ")); };
const timings = [];

try {
  console.log("1. Cầu nối sống theo cuộc trò chuyện");
  {
    const b1 = bridge("c-live", T1, "A:");
    ok(b1.live && /\/api\/mcp\/bridge\/live-/.test(b1.live.url) && b1.live.url !== b1.url && b1.live.key, "lượt có cuộc trò chuyện: có thêm địa chỉ sống, khác địa chỉ của lượt", b1.live);
    const l1 = await rpc(b1.live.url, "tools/list");
    const c1 = await rpc(b1.live.url, "tools/call", { name: "dem", arguments: {} });
    ok(l1.result.tools.map((t) => t.name).join() === "dem" && /ket qua A:dem/.test(c1.result.content[0].text), "địa chỉ sống trỏ vào cầu nối của lượt đang chạy", { l1, c1 });
    b1.close();
    const l2 = await rpc(b1.live.url, "tools/list"), c2 = await rpc(b1.live.url, "tools/call", { name: "dem", arguments: {} });
    ok(l2.result.tools.length === 1 && c2.result.isError === true && !calls.includes("A:dem2"), "giữa hai lượt: vẫn liệt kê công cụ, mọi lời gọi bị từ chối", c2);
    const b2 = bridge("c-live", T2, "B:");
    const c3 = await rpc(b2.live.url, "tools/call", { name: "dem", arguments: {} });
    ok(b2.live.url === b1.live.url && b2.live.key !== b1.live.key && /ket qua B:dem/.test(c3.result.content[0].text), "lượt sau cùng cuộc trò chuyện: cùng địa chỉ, trỏ vào cầu nối mới; bộ công cụ khác thì mã khác", { b2: b2.live, c3 });
    const other = MB.openBridge({ uid: "u2", conv: "c-live", tools: T1, call: async () => ({ content: "", is_error: false }) });
    ok(other.live.url !== b2.live.url, "người dùng khác, cùng mã cuộc trò chuyện: địa chỉ sống khác");
    const noConv = bridge(undefined);
    ok(noConv.live === undefined, "lượt không thuộc cuộc trò chuyện (ẩn danh): không có địa chỉ sống");
    b2.close(); other.close(); noConv.close();
    MB.dropLiveBridge("u1", "c-live");
    ok((await (await fetch(b1.live.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status) === 404, "xóa cuộc trò chuyện: địa chỉ sống hết hiệu lực");
  }

  console.log("2. Claude Code: lượt có công cụ dùng tiến trình dựng sẵn qua địa chỉ sống");
  {
    const eng = new CE.ClaudeCodeEngine();
    const d = path.join(HOME, "logins", "claude", "a"); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, ".mock-login"), "1");
    const base = { env: { CLAUDE_CONFIG_DIR: d }, workdir: path.join(HOME, "work", "a"), model: "haiku", system: "Trả lời ngắn.", pool: true };
    calls = [];
    const b1 = bridge("c-claude", T1, "1:");
    const cold = await run(eng, { ...base, prompt: "#tool=dem lượt một", mcp: mcpOf(b1) });
    b1.close();
    const b2 = bridge("c-claude", T1, "2:");
    const warm = await run(eng, { ...base, prompt: "#tool=dem lượt hai", sessionId: cold.session, mcp: mcpOf(b2) });
    b2.close();
    // Cũ (không có địa chỉ sống): mỗi lượt có công cụ một tiến trình mới.
    const b3 = bridge("c-claude-old", T1, "3:");
    const old = await run(eng, { ...base, prompt: "#tool=dem lượt cũ", mcp: { url: b3.url, alive: b3.alive } });
    b3.close();
    timings.push(["Claude, lượt có công cụ, cách cũ (khởi động lạnh)", old.first], ["Claude, lượt có công cụ, lượt đầu qua hồ (lạnh)", cold.first], ["Claude, lượt có công cụ, lượt sau qua hồ (ấm)", warm.first]);
    ok(cold.state === "cold" && /đã dùng dem: ket qua 1:dem/.test(cold.final ?? ""), "lượt đầu: khởi động tiến trình, gọi công cụ qua địa chỉ sống tới cầu nối của lượt", cold);
    ok(warm.state === "hit" && /đã dùng dem: ket qua 2:dem/.test(warm.final ?? "") && /lượt 2/.test(warm.final ?? ""), "lượt sau: dùng lại tiến trình (hit), công cụ tới cầu nối của lượt mới, nối đúng phiên", warm);
    ok(warm.first < START_MS && old.first >= START_MS, `chữ đầu của lượt có công cụ: ấm ${warm.first} ms, lạnh ${old.first} ms (CLI giả lập khởi động ${START_MS} ms)`, { warm: warm.first, old: old.first });
    const b4 = bridge("c-claude", T2, "4:");
    const changed = await run(eng, { ...base, prompt: "#tool=them lượt ba", sessionId: warm.session, mcp: mcpOf(b4) });
    b4.close();
    ok(changed.state === "cold" && /ket qua 4:them/.test(changed.final ?? ""), "bộ công cụ đổi: không dùng tiến trình đã liệt kê bộ cũ", changed);
    const files = fs.readdirSync(base.workdir).filter((f) => f.startsWith(".synchro-live-"));
    ok(files.length >= 1 && files.every((f) => (fs.statSync(path.join(base.workdir, f)).mode & 0o077) === 0) && !files.some((f) => fs.readFileSync(path.join(base.workdir, f), "utf8").includes(b1.url)), "tệp cấu hình MCP của tiến trình dựng sẵn: quyền 0600, chỉ có địa chỉ sống", files);
  }

  console.log("3. Codex: một app-server cho mỗi tài khoản");
  const acct = (n) => { const d = path.join(HOME, "logins", "codex", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "auth.json"), "{}"); return { CODEX_HOME: d }; };
  const inits = (env) => { try { return fs.readFileSync(path.join(env.CODEX_HOME, "mock-appserver.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
  const eng = new CE.CodexEngine();
  {
    const env = acct("x"), w = path.join(HOME, "work", "x");
    const r1 = await run(eng, { prompt: "chào", system: "Trả lời bằng tiếng Việt.", env, workdir: w });
    const r2 = await run(eng, { prompt: "nhớ không?", sessionId: r1.session, env, workdir: w });
    const log = inits(env), pids = new Set(log.filter((x) => x.method === "initialize").map((x) => x.pid));
    ok(r1.session && /lượt 1/.test(r1.final ?? "") && r1.state === "cold", "lượt đầu: khởi động app-server, mở thread, có trả lời", r1);
    ok(r2.session === r1.session && /lượt 2/.test(r2.final ?? "") && r2.state === "hit" && pids.size === 1, "lượt sau: cùng app-server (một tiến trình), nối đúng thread", { r2, pids: [...pids] });
    ok(r2.text && r2.text === r2.final, "chữ hiện dần (item/agentMessage/delta), không phải chờ cả đoạn", r2);
    const y = acct("y");
    await run(eng, { prompt: "chào", env: y, workdir: path.join(HOME, "work", "y") });
    ok(CS.codexServerStats().servers === 2 && inits(y).some((x) => x.method === "initialize") && !inits(y).some((x) => pids.has(x.pid)), "tài khoản khác: app-server riêng (không dùng chung đăng nhập)", CS.codexServerStats());
    const flags = await run(eng, { prompt: "[mock:argv] cờ", env, workdir: w });
    ok(/"approval":"never","sandbox":"read-only","shell":false/.test(flags.final ?? ""), "cờ an toàn như codex exec: không ai duyệt, hộp cát chỉ đọc, tắt shell", flags.final);
    const native = await run(eng, { prompt: "[mock:codexnative] vẽ", env, workdir: w });
    ok(native.final === "NATIVE_OFF", "image_gen dựng sẵn vẫn tắt", native);
  }

  console.log("4. Codex: lượt có công cụ qua địa chỉ sống, đo chữ đầu");
  {
    const env = acct("t"), w = path.join(HOME, "work", "t");
    calls = [];
    // Cách cũ: codex exec với CODEX_HOME riêng của lượt, khởi động lạnh mỗi lượt.
    process.env.SYNCHRO_CODEX_SERVER = "0";
    const bo = bridge("c-codex-old", T1, "o:");
    const old = await run(eng, { prompt: "#tool=dem cũ", env, workdir: w, mcp: { url: bo.url, alive: bo.alive } });
    bo.close();
    delete process.env.SYNCHRO_CODEX_SERVER;
    const b1 = bridge("c-codex", T1, "1:");
    const r1 = await run(eng, { prompt: "#tool=dem một", env, workdir: w, mcp: mcpOf(b1) });
    b1.close();
    const b2 = bridge("c-codex", T1, "2:");
    const r2 = await run(eng, { prompt: "#tool=dem hai", sessionId: r1.session, env, workdir: w, mcp: mcpOf(b2) });
    b2.close();
    const b3 = bridge("c-codex-2", T1, "3:");
    const r3 = await run(eng, { prompt: "#tool=dem đoạn chat khác", env, workdir: w, mcp: mcpOf(b3) });
    b3.close();
    timings.push(["Codex, lượt có công cụ, codex exec (cách cũ)", old.first], ["Codex, lượt có công cụ, app-server lần đầu (lạnh)", r1.first], ["Codex, lượt có công cụ, app-server lượt sau (ấm)", r2.first], ["Codex, lượt có công cụ, đoạn chat mới trên app-server ấm", r3.first]);
    ok(/ket qua o:dem/.test(old.final ?? "") && old.first >= START_MS, `cách cũ vẫn chạy (chữ đầu ${old.first} ms)`, old);
    ok(/ket qua 1:dem/.test(r1.final ?? "") && /ket qua 2:dem/.test(r2.final ?? "") && /lượt 2/.test(r2.final ?? "") && r2.state === "hit", "công cụ của từng lượt tới đúng cầu nối của lượt đó, thread đã nạp được dùng lại", { r1, r2 });
    ok(r2.first < START_MS && r3.first < START_MS && /ket qua 3:dem/.test(r3.final ?? ""), `chữ đầu lượt có công cụ trên app-server ấm: ${r2.first} ms (nối tiếp), ${r3.first} ms (đoạn chat mới); exec lạnh ${old.first} ms`, { r2: r2.first, r3: r3.first });
    // Cầu nối không có địa chỉ sống (vd. lượt ẩn danh): về codex exec, vẫn chạy được.
    warns.length = 0;
    const bn = bridge(undefined, T1, "n:");
    const rn = await run(eng, { prompt: "#tool=dem ẩn danh", env, workdir: w, mcp: { url: bn.url, alive: bn.alive } });
    bn.close();
    ok(/ket qua n:dem/.test(rn.final ?? "") && warns.some((x) => /\[codex-server\] chạy codex exec/.test(x)), "không có địa chỉ sống: chạy codex exec cho lượt đó, có ghi nhật ký", { rn, warns });
    // Bộ công cụ đổi với thread đã nạp: exec cho lượt đó.
    warns.length = 0;
    const b4 = bridge("c-codex", T2, "4:");
    const r4 = await run(eng, { prompt: "#tool=them ba", sessionId: r2.session, env, workdir: w, mcp: mcpOf(b4) });
    b4.close();
    ok(/ket qua 4:them/.test(r4.final ?? "") && warns.some((x) => /bộ công cụ khác/.test(x)), "bộ công cụ đổi so với thread đã nạp: về exec cho lượt đó", { r4, warns });
  }

  console.log("5. Codex: an toàn và đường dự phòng");
  {
    const env = acct("s"), w = path.join(HOME, "work", "s");
    await run(eng, { prompt: "chào", env, workdir: w });
    const before = CS.codexServerStats().starts;
    const sh = await run(eng, { prompt: "[mock:shell] đọc ../../logins/*", env, workdir: w });
    await sleep(1200);
    ok(sh.code === "other" && /chạy lệnh trực tiếp trên máy chủ/.test(sh.err ?? "") && !fs.existsSync(path.join(env.CODEX_HOME, "shell-ran")), "Codex định chạy lệnh trên máy chủ: dừng lượt, tắt app-server trước khi lệnh xong", sh);
    const again = await run(eng, { prompt: "chào lại", env, workdir: w });
    ok(again.final && CS.codexServerStats().starts === before + 1, "lượt sau khởi động app-server mới", CS.codexServerStats());
    // Dừng giữa lượt: turn/interrupt.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 250);
    const st = await run(eng, { prompt: "[mock:slowcodex] dừng giữa chừng", env, workdir: w, signal: ac.signal });
    ok(st.code === "aborted" && !st.final, "bấm Dừng: lượt dừng (turn/interrupt), không có câu trả lời", st);
    const after = await run(eng, { prompt: "chào sau khi dừng", env, workdir: w });
    ok(after.final && after.state === "hit", "app-server vẫn dùng tiếp được sau khi dừng một lượt", after);
    // app-server không nhận thread/start (bản CLI khác): về exec.
    for (const mode of ["thread", "init"]) {
      CS.dropAllCodexServers();
      cfg({ appServerFail: mode });
      warns.length = 0;
      const r = await run(eng, { prompt: "chào", env, workdir: w });
      ok(r.final && /lượt/.test(r.final) && warns.some((x) => /\[codex-server\] chạy codex exec/.test(x)), `app-server hỏng (${mode}): lượt chạy bằng codex exec, có ghi nhật ký`, { r, warns });
    }
    cfg();
    process.env.SYNCHRO_CODEX_SERVER = "0";
    CS.dropAllCodexServers();
    const off = await run(eng, { prompt: "chào", env, workdir: w });
    delete process.env.SYNCHRO_CODEX_SERVER;
    ok(off.final && CS.codexServerStats().servers === 0, "SYNCHRO_CODEX_SERVER=0: không mở app-server", CS.codexServerStats());
  }
} finally {
  console.warn = warn0;
  CS.dropAllCodexServers();
}
console.log("\nThời gian tới chữ đầu (CLI giả lập khởi động " + START_MS + " ms):");
for (const [k, v] of timings) console.log(`  ${k}: ${v} ms`);
srv.close();
await sleep(300);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
