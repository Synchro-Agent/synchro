// Blueprint G1: HOME riêng cho mỗi lượt Antigravity / Grok có công cụ. Hai lượt cùng tài khoản chạy cùng lúc (không còn "Đang chờ lượt … khác"), cầu nối nằm trong HOME
// của lượt, token được làm mới trong lượt về đúng thư mục đăng nhập và không bao giờ bị token cũ hơn đè lên (20 cặp lượt song song với máy chủ token giả lập có xoay vòng
// refresh token và phát hiện dùng lại). Dựng lỗi hay tắt (SYNCHRO_CLI_TURN_HOME=0) thì về cách cũ: cấu hình chung + khóa. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 900)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-turnhome-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin"), DATA = path.join(tmp, "data");
process.env.DATA_DIR = DATA; process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.SYNCHRO_ENGINE_USER = ""; process.env.DATA_KEY = "turnhome-test"; delete process.env.SYNCHRO_ENGINE_BWRAP;
delete process.env.SYNCHRO_CLI_TURN_HOME;
process.env.SYNCHRO_AGY_TICK_MS = "60000";
process.env.SYNCHRO_TURN_HOME_SYNC_MS = "300";
fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true });
for (const f of fs.readdirSync("tools/mock-cli")) { fs.copyFileSync(path.join("tools/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
const TOKSRV = path.join(tmp, "token-server.json"), GRACE = 1500;
const cfg = (extra = {}) => fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9", tokenServer: TOKSRV, tokenGraceMs: GRACE, tokenTtlMs: 1, ...extra }));
cfg();
const BR = 4300 + Math.floor(Math.random() * 400);
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${BR}`;
const { "ai/cli_engines": E, "ai/cli_auth": A, "ai/turnhome": TH, "ai/cli_runtime": RT, mcpbridge: M } = await loadTs(["ai/cli_engines", "ai/cli_auth", "ai/turnhome", "ai/cli_runtime", "mcpbridge"]);
const srv = http.createServer(async (q, a) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const r = await M.bridgeRoute(new Request(`http://x${q.url}`, { method: q.method, headers: { "content-type": "application/json", accept: q.headers.accept ?? "" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), q.url.split("/").pop());
  a.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }); a.end(await r.text());
}).listen(BR, "127.0.0.1");
srv.unref();
const tools = [{ name: "dem", description: "", input_schema: {} }, { name: "khac", description: "", input_schema: {} }];
let calls = 0;
const bridge = () => M.openBridge({ uid: "u", tools, call: async (name) => { calls++; return { content: `ket qua ${name} #${calls}`, is_error: false }; } });

const work = path.join(HOME, "work", "u"); fs.mkdirSync(work, { recursive: true });
const turnDirs = (d) => fs.readdirSync(d).filter((n) => n.startsWith(RT.TURN_HOME_PREFIX));
const readTok = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const server = () => JSON.parse(fs.readFileSync(TOKSRV, "utf8"));
/** Tài khoản mới với token giả lập đã hết hạn (mọi lượt đều làm mới) và máy chủ token biết đúng refresh token đó. */
function account(cli, U) {
  const dir = A.scopeDir(cli, U);
  const tok = cli === "agy" ? path.join(dir, ".gemini/antigravity-cli/antigravity-oauth-token") : path.join(dir, ".grok/auth.json");
  fs.mkdirSync(path.dirname(tok), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tok, JSON.stringify({ mock_oauth: true, rt: "rt-0", gen: 0, exp: 0 }));
  fs.writeFileSync(TOKSRV, JSON.stringify({ current: "rt-0", gen: 0 }));
  fs.writeFileSync(path.join(DATA, "engine-tokens", `${cli}-${U}.login`), "1");
  A.forget(cli, U);
  return { dir, tok, env: A.engineEnv(cli, U) };
}
const Eng = { agy: () => new E.AntigravityEngine(), grok: () => new E.GrokEngine() };
async function turn(cli, env, prompt, br, extra = {}) {
  const o = { final: null, err: null, code: null, waits: [], t0: Date.now(), t: 0 };
  for await (const e of Eng[cli]().runTurn({ prompt, env, workdir: work, mcp: { url: br.url, onPark: br.onPark }, ...extra })) {
    if (e.kind === "final") o.final = e.text;
    else if (e.kind === "error") { o.err = e.message; o.code = e.code; }
    else if (e.kind === "status" && e.wait) o.waits.push(e.text);
  }
  o.t = Date.now() - o.t0;
  return o;
}

// Cùng một bộ thử cho hai cách chạy: ngay trong tiến trình (không có user riêng của engine) và bằng tiến trình node riêng (như khi có user của engine).
for (const spawn of [false, true]) {
  if (spawn) process.env.SYNCHRO_TURN_HOME_SPAWN = "1";
  console.log(`1. Dựng HOME riêng (${spawn ? "tiến trình riêng" : "trong tiến trình"}): cầu nối chỉ trong HOME của lượt, phiên và đăng nhập liên kết về thư mục đăng nhập`);
  const base = path.join(HOME, "logins", "agy", `unit-${spawn ? "s" : "i"}`);
  fs.mkdirSync(path.join(base, ".gemini/config"), { recursive: true });
  fs.mkdirSync(path.join(base, ".gemini/antigravity-cli/cache"), { recursive: true });
  fs.writeFileSync(path.join(base, ".gemini/antigravity-cli/antigravity-oauth-token"), "T0");
  fs.writeFileSync(path.join(base, ".gemini/oauth_creds.json"), "C0");
  fs.writeFileSync(path.join(base, ".gemini/settings.json"), "{}");
  fs.writeFileSync(path.join(base, ".gemini/config/mcp_config.json"), JSON.stringify({ mcpServers: { other: { serverUrl: "http://o" }, synchro: { serverUrl: "http://old" } } }));
  const open = (own = {}) => TH.openTurnHome("agy", { env: { HOME: base } }, own);
  const h = await open({ ".gemini/config/mcp_config.json": { mode: "json-mcp", name: "synchro", entry: { serverUrl: "http://new/secret" } }, ".gemini/config/hooks.json": { mode: "write", text: "{\"h\":1}" } });
  const L = (r) => fs.lstatSync(path.join(h.dir, r));
  const cfgT = JSON.parse(fs.readFileSync(path.join(h.dir, ".gemini/config/mcp_config.json"), "utf8"));
  ok(path.dirname(h.dir) === base && h.env.HOME === h.dir && RT.turnHomeBase(h.dir) === base, "HOME của lượt là thư mục con của thư mục đăng nhập", h);
  ok(L(".gemini").isDirectory() && L(".gemini/config").isDirectory() && L(".gemini/antigravity-cli").isSymbolicLink() && L(".gemini/oauth_creds.json").isSymbolicLink() && L(".gemini/settings.json").isSymbolicLink(), "chỉ thư mục cấu hình là thật; phiên, đăng nhập, cài đặt là liên kết về thư mục đăng nhập");
  ok(fs.existsSync(path.join(base, ".gemini/antigravity-cli/conversations")) && fs.existsSync(path.join(base, ".gemini/antigravity-cli/brain")), "thư mục phiên / ảnh có sẵn trong thư mục đăng nhập (hai lượt không tạo hai bản)");
  ok(cfgT.mcpServers.synchro.serverUrl === "http://new/secret" && cfgT.mcpServers.other.serverUrl === "http://o" && (fs.statSync(path.join(h.dir, ".gemini/config/mcp_config.json")).mode & 0o077) === 0, "mcp_config.json của lượt: giữ máy chủ khác, thay cầu nối, quyền 0600", cfgT);
  ok(JSON.parse(fs.readFileSync(path.join(base, ".gemini/config/mcp_config.json"), "utf8")).mcpServers.synchro.serverUrl === "http://old", "cấu hình chung của tài khoản không bị đụng tới");
  // CLI làm mới token ghi tệp tạm rồi đổi tên (thay liên kết), tạo tệp mới và thư mục mới; phiên ghi qua liên kết.
  const swap = (dir, rel, text) => { fs.writeFileSync(path.join(dir, `${rel}.tmp`), text); fs.renameSync(path.join(dir, `${rel}.tmp`), path.join(dir, rel)); };
  swap(h.dir, ".gemini/oauth_creds.json", "C1");
  fs.mkdirSync(path.join(h.dir, ".newdir")); fs.writeFileSync(path.join(h.dir, ".newdir/x"), "x");
  fs.writeFileSync(path.join(h.dir, ".gemini/antigravity-cli/conversations/c1.pb"), "phiên");
  await h.close();
  ok(fs.readFileSync(path.join(base, ".gemini/oauth_creds.json"), "utf8") === "C1", "token làm mới trong lượt (đổi tên đè liên kết) về thư mục đăng nhập");
  ok(fs.readFileSync(path.join(base, ".newdir/x"), "utf8") === "x" && fs.readFileSync(path.join(base, ".gemini/antigravity-cli/conversations/c1.pb"), "utf8") === "phiên", "thư mục mới và phiên mới ở đúng thư mục đăng nhập");
  ok(!turnDirs(base).length && !fs.existsSync(h.dir), "HOME của lượt đã bỏ", turnDirs(base));
  // Trong lượt: tệp đăng nhập vừa làm mới được đưa về ngay (không chờ lượt xong) và liên kết được đặt lại.
  {
    const h1 = await open();
    swap(h1.dir, ".gemini/oauth_creds.json", "C2");
    await sleep(1500);
    ok(fs.readFileSync(path.join(base, ".gemini/oauth_creds.json"), "utf8") === "C2" && fs.lstatSync(path.join(h1.dir, ".gemini/oauth_creds.json")).isSymbolicLink(), "token làm mới giữa lượt về thư mục đăng nhập trong vài giây và liên kết được đặt lại");
    await h1.close();
  }
  for (const copy of [false, true]) {
    if (copy) process.env.SYNCHRO_TURN_HOME_COPY = "1";
    const mode = copy ? "chép" : "liên kết";
    // Hai lượt cùng làm mới: lần làm mới sau cùng (mtime mới hơn) thắng, dù đưa về theo thứ tự nào.
    for (const order of [["a", "b"], ["b", "a"]]) {
      fs.writeFileSync(path.join(base, ".gemini/oauth_creds.json"), "C1");
      const ha = await open(), hb = await open();
      if (copy) ok(fs.lstatSync(path.join(ha.dir, ".gemini/oauth_creds.json")).isFile(), "chế độ chép: tệp đăng nhập là bản chép");
      swap(ha.dir, ".gemini/oauth_creds.json", "A-old"); await sleep(30); swap(hb.dir, ".gemini/oauth_creds.json", "B-new");
      const hs = { a: ha, b: hb };
      await hs[order[0]].close(); await hs[order[1]].close();
      ok(fs.readFileSync(path.join(base, ".gemini/oauth_creds.json"), "utf8") === "B-new", `${mode}: hai lượt cùng làm mới, đưa về theo thứ tự ${order.join("→")}: giữ token làm mới sau cùng`);
    }
    // Lượt không đổi token: không đè token người khác vừa ghi. Đăng xuất giữa lượt: không hồi sinh đăng nhập.
    const h1 = await open(), h2 = await open();
    fs.writeFileSync(path.join(base, ".gemini/oauth_creds.json"), "OTHER");
    await h2.close();
    ok(fs.readFileSync(path.join(base, ".gemini/oauth_creds.json"), "utf8") === "OTHER", `${mode}: lượt không làm mới token thì không đè token người khác vừa ghi`);
    swap(h1.dir, ".gemini/oauth_creds.json", "LATE");
    fs.rmSync(path.join(base, ".gemini/oauth_creds.json"));
    await h1.close();
    ok(!fs.existsSync(path.join(base, ".gemini/oauth_creds.json")), `${mode}: đăng xuất giữa lượt: token của lượt không hồi sinh đăng nhập`);
    fs.writeFileSync(path.join(base, ".gemini/oauth_creds.json"), "C1");
    delete process.env.SYNCHRO_TURN_HOME_COPY;
  }
  // Grok: config.toml của tài khoản bỏ mục synchro cũ, giữ phần khác.
  {
    const gb = path.join(HOME, "logins", "grok", `unit-${spawn ? "s" : "i"}`);
    fs.mkdirSync(path.join(gb, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(gb, ".grok/config.toml"), 'model = "grok-4.7"\n\n[mcp_servers.synchro]\nurl = "http://old"\n\n[mcp_servers.synchro.headers]\nx = "1"\n\n[mcp_servers.khac]\nurl = "http://k"\n');
    const h = await TH.openTurnHome("grok", { env: { HOME: gb, GROK_HOME: path.join(gb, ".grok") } }, { ".grok/config.toml": { mode: "toml-drop", name: "synchro" } });
    const t = fs.readFileSync(path.join(h.dir, ".grok/config.toml"), "utf8");
    ok(!t.includes("http://old") && !t.includes('x = "1"') && t.includes("http://k") && t.includes("grok-4.7") && h.env.GROK_HOME === path.join(h.dir, ".grok"), "grok: config.toml của lượt bỏ cầu nối cũ, giữ phần khác; GROK_HOME trỏ vào HOME của lượt", t);
    await h.close();
    ok(fs.readFileSync(path.join(gb, ".grok/config.toml"), "utf8").includes("http://old"), "grok: cấu hình chung không bị đụng tới");
  }
  delete process.env.SYNCHRO_TURN_HOME_SPAWN;
}

async function pairs(cli, copy) {
  const name = cli === "agy" ? "Antigravity" : "Grok", mode = copy ? "chế độ chép" : "chế độ liên kết";
  if (copy) process.env.SYNCHRO_TURN_HOME_COPY = "1";
  console.log(`2. ${name} (${mode}): 20 cặp lượt có công cụ song song cùng tài khoản, token xoay vòng mỗi lượt`);
  const U = `pair-${cli}-${copy ? "c" : "l"}`, { dir, tok, env } = account(cli, U);
  const bad = [], waited = [], stale = [];
  const b = bridge();
  for (let i = 0; i < 20; i++) {
    const r = await Promise.all([turn(cli, env, `cặp ${i} lượt 1`, b), turn(cli, env, `cặp ${i} lượt 2`, b)]);
    for (const x of r) { if (x.err || !x.final) bad.push(x); if (x.waits.length) waited.push(x.waits); }
    await TH.settled(dir);
    const t = readTok(tok), s = server();
    if (!t || t.rt !== s.current) stale.push({ i, base: t?.rt, current: s.current });
  }
  const s = server();
  ok(!bad.length, "40 lượt đều xong, không lượt nào lỗi đăng nhập", bad.slice(0, 3));
  ok(!waited.length, `không lượt nào hiện "Đang chờ lượt ${name} khác"`, waited.slice(0, 3));
  ok(!stale.length && !s.revoked && s.gen >= 20, `sau mỗi cặp, thư mục đăng nhập giữ đúng refresh token hiện hành (đã xoay ${s.gen} lần, không bị thu hồi)`, { stale: stale.slice(0, 3), gen: s.gen, revoked: s.revoked });
  ok(/\[công cụ Synchro: 2\]/.test((await turn(cli, env, "kiểm cầu nối", b)).final ?? ""), "CLI đọc được cầu nối của lượt trong HOME riêng");
  await TH.settled(dir);
  ok(!turnDirs(dir).length, "không còn HOME của lượt nào sau khi xong", turnDirs(dir));
  delete process.env.SYNCHRO_TURN_HOME_COPY;
  b.close();
}
for (const cli of ["agy", "grok"]) {
  for (const copy of [false, true]) await pairs(cli, copy);
  // 20 cặp cùng lúc (40 lượt chồng nhau) với token vừa hết hạn, token mới sống 60 giây như thật: đợt đầu cùng làm mới, lượt khởi động sau phải đọc được token mới
  // (không làm mới bằng token cũ đã quá hạn ân hạn). Rồi chờ quá hạn ân hạn: token cũ hơn mà nằm lại hay bị đưa về sẽ làm lượt sau lỗi và hãng thu hồi cả họ token.
  // (Token sống 1 ms thì lượt khởi động sau làm mới tiếp từ token mới, lượt đầu còn cầm token cũ hai đời: hãng giả lập thu hồi cả khi dùng chung một HOME như trước, không phải lỗi của HOME riêng.)
  console.log(`2b. ${cli}: 40 lượt chồng nhau (chế độ liên kết, mặc định)`);
  cfg({ tokenTtlMs: 60_000 });
  const { dir, tok, env } = account(cli, `burst-${cli}`);
  const b = bridge();
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => turn(cli, env, `dồn ${i}`, b)));
  cfg();
  await TH.settled(dir);
  await sleep(GRACE + 300);
  const after = await turn(cli, env, "sau khi dồn", b);
  await TH.settled(dir);
  const s2 = server(), t2 = readTok(tok);
  ok(burst.every((x) => x.final && !x.err) && !burst.some((x) => x.waits.length), "40 lượt chồng nhau đều xong, không xếp hàng, không lỗi đăng nhập", burst.filter((x) => x.err).slice(0, 2));
  ok(after.final && !after.err && !s2.revoked && t2?.rt === s2.current && typeof t2.exp === "number", "quá hạn ân hạn vẫn chạy được: token ở thư mục đăng nhập là token mới nhất, tệp nguyên vẹn", { after, s2: { ...s2, log: s2.log?.length }, t2 });
  ok(!turnDirs(dir).length, "không còn HOME của lượt nào", turnDirs(dir));
  b.close();
}

console.log("3. Hai đoạn chat cùng tài khoản gọi công cụ cùng lúc: lượt sau không chờ lượt trước");
{
  cfg({ tokenServer: undefined });
  for (const cli of ["agy", "grok"]) {
    const { env } = account(cli, `par-${cli}`);
    const b1 = bridge(), b2 = bridge();
    const long = turn(cli, env, cli === "agy" ? "[mock:keepsession=3000] dài" : "[mock:holdgrok] dài", b1);
    await sleep(400);
    const quick = await turn(cli, env, "#tool=dem", b2);
    const l = await long;
    ok(quick.final && /ket qua dem/.test(quick.final) && !quick.waits.length && quick.t < 2500 && l.final, `${cli}: lượt có công cụ thứ hai chạy ngay (${quick.t} ms), gọi được công cụ qua cầu nối của chính nó`, { quick, l });
    b1.close(); b2.close();
  }
}

console.log("4. Đường dự phòng: tắt HOME riêng hoặc dựng lỗi thì về cấu hình chung + khóa");
{
  const { env, dir } = account("grok", "fb-grok");
  const br = bridge();
  process.env.SYNCHRO_CLI_TURN_HOME = "0";
  const long = turn("grok", env, "[mock:holdgrok] dài", br);
  await sleep(1200);
  const busy = await turn("grok", env, "chào", br, { lockMs: 400 });
  delete process.env.SYNCHRO_CLI_TURN_HOME;
  ok(busy.waits.some((w) => /Đang chờ lượt Grok/.test(w)) && busy.code === "busy", "SYNCHRO_CLI_TURN_HOME=0: cách cũ, lượt thứ hai chờ khóa của tài khoản", busy);
  ok((await long).final, "lượt giữ khóa vẫn xong");
  // Không tạo được HOME riêng (thư mục đăng nhập không ghi được ở gốc): lượt vẫn chạy bằng cấu hình chung, có ghi nhật ký.
  const logs = [], warn = console.warn;
  console.warn = (...a) => { logs.push(a.join(" ")); };
  fs.chmodSync(dir, 0o500);
  let r;
  try { r = await turn("grok", env, "#tool=dem", br); } finally { fs.chmodSync(dir, 0o700); console.warn = warn; }
  ok(r.final && /ket qua dem/.test(r.final) && logs.some((l) => /\[turnhome\] grok: không dựng được HOME riêng/.test(l)), "dựng HOME riêng lỗi: lượt chạy bằng cách cũ, có ghi nhật ký", { r, logs });
  ok(!fs.readFileSync(path.join(dir, ".grok/config.toml"), "utf8").includes("synchro"), "cách cũ vẫn gỡ cầu nối khỏi cấu hình chung khi xong");
  br.close();
}

console.log("5. Hộp cô lập (bwrap): HOME của lượt gắn cả thư mục đăng nhập để liên kết còn dùng được");
{
  const lg = path.join(HOME, "logins"), base = path.join(lg, "agy", "u1"), t = path.join(base, `${RT.TURN_HOME_PREFIX}abc`);
  process.env.SYNCHRO_ENGINE_BWRAP = "1";
  const b = RT.isolate("/x/agy", ["-p", "x"], { HOME: t }, path.join(HOME, "work", "u1"));
  delete process.env.SYNCHRO_ENGINE_BWRAP;
  const j = b.argv.join(" ");
  ok(j.includes(`--bind ${base} ${base}`) && !j.includes(`--bind ${t} `) && b.env.HOME === t, "gắn thư mục đăng nhập, HOME vẫn là HOME của lượt", j);
}

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
