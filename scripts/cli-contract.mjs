#!/usr/bin/env node
// Kiểm tra hợp đồng với CLI thật: chạy từng CLI đã cài (claude, codex, agy, grok) qua đúng mã engine của production (engineFor, engineEnv, cầu nối MCP mcpbridge.ts),
// cho một tài khoản, prompt tối thiểu, rồi in bảng pass / fail / skip. Những điều mock không chứng minh được: CLI thật có thấy công cụ không, tham số lồng nhau và $ref có tới đủ
// không, công cụ 6 phút và thẻ duyệt 10 phút có sống qua không, nối phiên có nhớ không, tên công cụ dài có gọi được không, tiến trình khởi động sẵn có thật sự nhanh hơn không.
//
// Chạy trên máy chủ, bằng đúng user của web, từ thư mục app (mọi lượt ở đây tính vào gói của tài khoản đó):
//   su - synchro -c "cd /var/www/synchro && node scripts/cli-contract.mjs <account-scope>"
// account-scope: id người dùng (tên thư mục trong <engine>/logins/<cli>/). Nên dùng tài khoản thử hoặc lúc tài khoản rảnh: agy và grok giữ cầu nối trong cấu hình chung của tài
// khoản, khóa lượt nằm trong tiến trình của web nên script này không biết lượt đang chạy ở web, và ngược lại.
// Tùy chọn: --only=claude,grok   --quick (bỏ hai bài chờ lâu)   --slow-min=6   --hold-min=10   --model=claude:haiku,grok:grok-3   --verbose
//   --image: tạo một ảnh thật bằng mỗi CLI đã đăng nhập (agy, grok, codex; Claude Code không có công cụ tạo ảnh). Mặc định tắt vì tốn hạn mức ảnh của gói.
//            Đây là cách kiểm chứng những điều còn chưa biết: Grok lưu ảnh ở đâu, Codex gói trả phí có ghi vào generated_images/<thread_id>/ không (app/ai/imagegen.ts).
// Thời gian: CLI chạy song song, mỗi CLI tối đa khoảng 20 phút (hai bài chờ lâu). Mỗi CLI khoảng 8 lượt ngắn, thêm 3 lượt với Claude.
//
// Không đụng dữ liệu thật: DATA_DIR trỏ sang thư mục tạm, chỉ chép token đã mã hóa của đúng tài khoản này (và secret.key nếu có), xóa khi thoát. Cơ sở dữ liệu thật không được mở.
// Không in bí mật: mọi ghi chú qua redact, địa chỉ cầu nối bị che, không in biến môi trường. Lỗi chỉ cắt ngắn một dòng.
// Mã thoát: 0 không có fail, 1 có fail, 2 sai cách dùng, 130 bị ngắt.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a === undefined ? d : a.includes("=") ? a.slice(a.indexOf("=") + 1) : true; };
const scope = argv.find((x) => !x.startsWith("--"));
if (!scope) { process.stderr.write("Usage: node scripts/cli-contract.mjs <account-scope> [--only=claude,grok] [--quick] [--slow-min=6] [--hold-min=10] [--model=claude:haiku] [--verbose]\n"); process.exit(2); }
const QUICK = !!opt("quick", false), VERBOSE = !!opt("verbose", false), IMAGE = !!opt("image", false);
const SLOW_MIN = Number(opt("slow-min", 6)), HOLD_MIN = Number(opt("hold-min", 10));
const ONLY = opt("only", "") ? String(opt("only", "")).split(",") : null;
const MODELS = Object.fromEntries(String(opt("model", "")).split(",").filter(Boolean).map((x) => x.split(":")));
// CLI giả lập không có model thật: nhắc gọi công cụ bằng cú pháp của mock, và không chấm những gì cần trí nhớ của model.
const MOCK = process.env.CONTRACT_MOCK === "1";

// ---- môi trường như web (Next đọc các tệp này lúc chạy), nhưng dữ liệu tạm
for (const f of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  let t = ""; try { t = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  for (const l of t.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const realData = process.env.DATA_DIR ?? path.join(ROOT, "data");
process.env.SYNCHRO_ENGINE_HOME ??= path.join(realData, "engine");
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-contract-"));
fs.chmodSync(tmpData, 0o700);
{
  const safe = scope.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "default";
  const tok = path.join(realData, "engine-tokens", `claude-${safe}.enc`);
  if (fs.existsSync(tok)) { fs.mkdirSync(path.join(tmpData, "engine-tokens"), { mode: 0o700 }); fs.copyFileSync(tok, path.join(tmpData, "engine-tokens", path.basename(tok))); }
  const key = path.join(realData, "secret.key");
  if (fs.existsSync(key)) fs.copyFileSync(key, path.join(tmpData, "secret.key"));
}
process.env.DATA_DIR = tmpData;
// Bản dịch TypeScript tạm của loadTs nằm trong node_modules/.cache: xóa khi thoát.
const cacheDir = path.join(ROOT, "node_modules", ".cache");
const cacheBefore = new Set((() => { try { return fs.readdirSync(cacheDir); } catch { return []; } })());

const out = (s) => process.stdout.write(s + "\n"), log = (s) => process.stderr.write(s + "\n");
// [timing] của engine chỉ hiện khi --verbose (qua clean, phòng khi có gì lọt).
const origLog = console.log;
let clean = (s) => String(s);
for (const k of ["log", "warn", "error", "info"]) console[k] = (...a) => { if (VERBOSE) origLog(clean(a.join(" "))); };

const { loadTs } = await import("../tests/lib/ts.mjs");
const mods = await loadTs(["ai/cli_auth", "ai/cli_runtime", "ai/selector", "ai/cli_pool", "ai/errors", "mcpbridge"]);
const { "ai/cli_auth": A, "ai/cli_runtime": R, "ai/selector": S, "ai/cli_pool": P, "ai/errors": X, mcpbridge: B } = mods;
clean = (s) => X.redact(String(s ?? "")).replace(/\/api\/mcp\/bridge\/[\w-]+/g, "/api/mcp/bridge/[token]").replace(/sk-ant[\w-]+/g, "[token]").replace(/\s+/g, " ").trim().slice(0, 220);

// ---- công cụ thử
const NESTED_ARGS = { order: { customer: { name: "Ada", address: { city: "Hanoi", zip: "10000" } }, items: [{ sku: "A1", qty: 2, options: { gift: true, tags: ["red", "blue"] } }, { sku: "B2", qty: 1, options: { gift: false, tags: [] } }] } };
const REF_ARGS = { home: { city: "Hanoi", zip: "10000" }, work: { city: "Hue", zip: "53000" } };
const LONG_NAME = "contract_tool_with_a_name_that_is_well_over_fifty_chars";
const TOOL = {
  ping: { name: "contract_ping", description: "Contract test: echo a number.", input_schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] } },
  nested: { name: "contract_nested", description: "Contract test: takes a nested order.", input_schema: { type: "object", required: ["order"], properties: { order: { type: "object", required: ["customer", "items"], properties: {
    customer: { type: "object", required: ["name", "address"], properties: { name: { type: "string" }, address: { type: "object", required: ["city", "zip"], properties: { city: { type: "string" }, zip: { type: "string" } } } } },
    items: { type: "array", items: { type: "object", required: ["sku", "qty", "options"], properties: { sku: { type: "string" }, qty: { type: "integer" }, options: { type: "object", properties: { gift: { type: "boolean" }, tags: { type: "array", items: { type: "string" } } } } } } },
  } } } } },
  ref: { name: "contract_ref", description: "Contract test: schema uses $ref and $defs.", input_schema: { type: "object", required: ["home"], $defs: { Address: { type: "object", required: ["city", "zip"], properties: { city: { type: "string" }, zip: { type: "string" } } } }, properties: { home: { $ref: "#/$defs/Address" }, work: { $ref: "#/$defs/Address" } } } },
  slow: { name: "contract_slow", description: "Contract test: a job that takes several minutes before it returns a token.", input_schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] } },
  hold: { name: "contract_hold", description: "Contract test: waits for a person to approve, which can take many minutes, then returns a token.", input_schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] } },
  long: { name: LONG_NAME, description: "Contract test: a tool with a long name.", input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
};
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const shape = (v) => clean(JSON.stringify(v));

// ---- cầu nối: đúng bridgeRoute của production sau một máy chủ HTTP nhỏ (production là route của Next, cùng hàm xử lý và cùng nhịp SSE)
const rec = new Map();
const srv = http.createServer(async (req, res) => {
  const m = /^\/api\/mcp\/bridge\/([\w-]+)$/.exec(req.url ?? "");
  if (!m) { res.writeHead(404); res.end(); return; }
  const chunks = [];
  try {
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try { const j = JSON.parse(body.toString() || "null"); for (const x of Array.isArray(j) ? j : [j]) if (x?.method === "tools/list") rec.get(m[1]).listed++; } catch {}
    const h = {}; for (const k of ["content-type", "accept", "mcp-session-id"]) if (req.headers[k]) h[k] = String(req.headers[k]);
    const r = await B.bridgeRoute(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: h, body: req.method === "POST" ? body : undefined }), m[1]);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) {
      const rd = r.body.getReader();
      res.on("close", () => { void rd.cancel().catch(() => {}); });
      for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(value); }
    }
    res.end();
  } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(); if (VERBOSE) log(clean(e.message)); }
});
srv.requestTimeout = 0; srv.headersTimeout = 0; srv.timeout = 0;
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
process.env.SYNCHRO_INTERNAL_URL = `http://127.0.0.1:${srv.address().port}`;

const master = new AbortController();
const sleep = (ms, sig) => new Promise((ok) => { const t = setTimeout(ok, ms); sig?.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
const SYS = "You are being run by an automated test. Follow each instruction exactly and keep every reply as short as possible. Use tools only when told to.";
const COMMON = "The tool may be listed with a prefix, or be reachable through a tool-search or call-tool helper.";

function openTools(tools, handler, hold) {
  const calls = [];
  const br = B.openBridge({ uid: scope, tools, ...(hold ? { hold } : {}), call: async (name, input) => { calls.push({ name, input, at: Date.now() }); return { content: await handler(name, input), is_error: false }; } });
  const info = { listed: 0, calls };
  rec.set(br.url.split("/").pop(), info);
  return { ...br, info };
}
/** Một lượt qua đúng engine của production. */
async function turn(cli, o) {
  const ac = new AbortController(), t0 = Date.now();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 240_000);
  const stop = () => ac.abort();
  master.signal.addEventListener("abort", stop, { once: true });
  const r = { text: "", session: null, error: null, pool: null, firstMs: null, denied: null, ms: 0, timedOut: false };
  try {
    const events = S.engineFor(cli).runTurn({
      prompt: o.prompt, system: SYS, model: o.model, effort: "low", sessionId: o.sessionId, workdir: o.workdir, env: o.env, signal: ac.signal,
      mcp: o.bridge ? { url: o.bridge.url } : undefined, alive: o.bridge?.alive, pool: !!o.pool, web: !!o.web,
    });
    let finalText = null;
    for await (const e of events) {
      if (e.kind === "text") { r.text += e.text; r.firstMs ??= Date.now() - t0; }
      else if (e.kind === "session") r.session = e.id;
      else if (e.kind === "pool") r.pool = e.state;
      else if (e.kind === "search") r.searches = (r.searches ?? 0) + 1;
      else if (e.kind === "sources") r.sources = (r.sources ?? 0) + e.items.length;
      else if (e.kind === "final") { finalText = e.text; if (e.denied?.length) r.denied = e.denied; }
      else if (e.kind === "error") r.error = { message: clean(e.message), code: e.code };
    }
    if (finalText !== null) r.text = finalText;
  } catch (e) { r.error = { message: clean(e?.message), code: "other" }; }
  finally { clearTimeout(timer); master.signal.removeEventListener("abort", stop); o.bridge?.close(); }
  r.ms = Date.now() - t0;
  r.timedOut = !r.error ? false : r.error.code === "aborted" && !master.signal.aborted;
  return r;
}

// ---- các bài kiểm
const CHECKS = ["tools listed", "nested args", "$ref args", "resume keeps context", "tools after resume", "names over 50 chars", "warm process", "web search", "long hold", "approval hold", "real image"];
const CLIS = R.CLIS.filter((c) => !ONLY || ONLY.includes(c));
const table = new Map(CLIS.map((c) => [c, new Map()]));
const versions = new Map();
const put = (cli, check, st, note = "") => { table.get(cli).set(check, { st, note: clean(note) }); log(`[${cli}] ${check}: ${st}${note ? ` (${clean(note)})` : ""}`); };
class Stop extends Error {}
const say = (name, args) => `Call the tool ${name} exactly once with exactly these arguments: ${JSON.stringify(args)}. ${COMMON}${MOCK ? ` #tool=${name} #args=${JSON.stringify(args)}` : ""}`;
const why = (r, calls) => [r.error ? `error: ${r.error.message}` : "", r.timedOut ? "timed out" : "", r.denied ? `CLI denied: ${r.denied.join(", ")}` : "", calls !== undefined ? `tool calls=${calls}` : "", `${Math.round(r.ms / 1000)}s`].filter(Boolean).join("; ");
/** Hết hạn mức hay mất đăng nhập: các bài còn lại không kiểm được gì, không tốn thêm lượt. */
const fatal = (cli, r) => { if (r.error?.code === "quota" || r.error?.code === "auth") throw new Stop(r.error.code === "quota" ? "plan out of quota" : "sign-in rejected"); };

async function runCli(cli) {
  const st = await Promise.race([A.status(cli, scope, { fresh: true }), new Promise((ok) => setTimeout(() => ok({ timeout: true }), 90_000))]);
  if (st.timeout) { for (const c of CHECKS) put(cli, c, "skip", "status check timed out"); return; }
  versions.set(cli, st.version ?? "");
  if (!st.installed) { for (const c of CHECKS) table.get(cli).set(c, { st: "skip", note: "" }); log(`[${cli}] not installed: skip`); return; }
  if (!st.loggedIn) { for (const c of CHECKS) table.get(cli).set(c, { st: "skip", note: "" }); log(`[${cli}] not signed in for this account: skip`); return; }
  const env = A.engineEnv(cli, scope), workdir = path.join(R.engineHome(), "work", A.safeScope(scope));
  await R.makeDir(workdir);
  // Model rẻ nhất biết chắc tên; CLI khác dùng mặc định của gói, hoặc --model.
  const model = MODELS[cli] ?? (cli === "claude" ? "haiku" : undefined);
  const base = { env, workdir, model };
  const replyOk = (name) => () => `ok ${name}`;
  const toolsBase = [TOOL.ping, TOOL.nested, TOOL.slow, TOOL.hold];
  try {
    if (master.signal.aborted) throw new Stop("interrupted");
    // 1. Công cụ: CLI hỏi tools/list và model kể đủ tên.
    {
      const b = openTools(toolsBase, replyOk("x"));
      const r = await turn(cli, { ...base, bridge: b, prompt: `Without calling any of them, reply with a comma separated list of every tool name you can use from the MCP server called synchro. If tools are discovered through a search helper, use it. Reply with the names only.` });
      fatal(cli, r);
      const miss = toolsBase.filter((t) => !r.text.includes(t.name)).map((t) => t.name);
      put(cli, "tools listed", b.info.listed && (MOCK || !miss.length) ? "pass" : "fail", b.info.listed ? (miss.length && !MOCK ? `reply is missing ${miss.join(", ")}; ${why(r)}` : why(r)) : `CLI never asked tools/list; ${why(r)}`);
    }
    // 2. Tham số lồng nhau tới nguyên vẹn. Chấm ở phía máy chủ, không tin lời model.
    {
      const b = openTools(toolsBase, replyOk("nested"));
      const r = await turn(cli, { ...base, bridge: b, prompt: `${say(TOOL.nested.name, NESTED_ARGS)} Then reply with the single word DONE.` });
      fatal(cli, r);
      const c = b.info.calls.filter((x) => x.name === TOOL.nested.name);
      put(cli, "nested args", c.length && same(c[0].input, NESTED_ARGS) ? "pass" : "fail", c.length ? (same(c[0].input, NESTED_ARGS) ? why(r) : `received ${shape(c[0].input)}`) : `tool not called; ${why(r)}`);
    }
    // 3. $ref: cầu nối riêng, vì một lược đồ hãng từ chối có thể làm hỏng cả lượt, không được làm sai các bài khác.
    {
      const b = openTools([TOOL.ping, TOOL.ref], replyOk("ref"));
      const r = await turn(cli, { ...base, bridge: b, prompt: `${say(TOOL.ref.name, REF_ARGS)} Then reply with the single word DONE.` });
      fatal(cli, r);
      const c = b.info.calls.filter((x) => x.name === TOOL.ref.name);
      put(cli, "$ref args", c.length && same(c[0].input, REF_ARGS) ? "pass" : "fail", c.length ? (same(c[0].input, REF_ARGS) ? why(r) : `received ${shape(c[0].input)}`) : `tool not called; ${why(r)}`);
    }
    // 4. Nối phiên: lượt sau có cầu nối mới (như production, mỗi lượt một mã) mà vẫn nhớ, và vẫn gọi được công cụ.
    {
      const word = `word${crypto.randomBytes(3).toString("hex")}`;
      const a = await turn(cli, { ...base, bridge: openTools([TOOL.ping], replyOk("ping")), prompt: `Remember this code word for later: ${word}. Reply only with OK.` });
      fatal(cli, a);
      if (!a.session) { put(cli, "resume keeps context", "fail", `no session id; ${why(a)}`); put(cli, "tools after resume", "skip", "no session"); }
      else {
        const b2 = openTools([TOOL.ping], replyOk("ping"));
        const b = await turn(cli, { ...base, sessionId: a.session, bridge: b2, prompt: `${say(TOOL.ping.name, { n: 2 })} Then reply with the code word I gave you in my previous message, and nothing else.` });
        fatal(cli, b);
        put(cli, "resume keeps context", MOCK ? (b.session === a.session ? "pass" : "fail") : b.text.includes(word) ? "pass" : "fail", b.text.includes(word) || MOCK ? why(b) : `word not in reply; ${why(b)}`);
        put(cli, "tools after resume", b2.info.calls.some((x) => x.name === TOOL.ping.name) ? "pass" : "fail", why(b, b2.info.calls.length));
      }
    }
    // 5. Tên công cụ dài: cầu nối riêng, vì tên quá dài có thể làm hỏng cả lượt.
    {
      const b = openTools([TOOL.ping, TOOL.long], replyOk("long"));
      const r = await turn(cli, { ...base, bridge: b, prompt: `${say(TOOL.long.name, { ok: true })} Then reply with the single word DONE.` });
      fatal(cli, r);
      put(cli, "names over 50 chars", b.info.calls.some((x) => x.name === TOOL.long.name) ? "pass" : "fail", `${LONG_NAME.length} chars; ${why(r, b.info.calls.length)}`);
    }
    // 6. Tiến trình khởi động sẵn của Claude Code: có dùng trúng không, nhớ qua nhiều lượt không, và nhanh hơn bao nhiêu so với mỗi lượt một tiến trình.
    if (cli !== "claude") put(cli, "warm process", "skip", "");
    else {
      const prompt = "Reply with the single word PONG.";
      const cold = await turn(cli, { ...base, prompt });
      fatal(cli, cold);
      S.engineFor(cli).prestart({ system: SYS, model, effort: "low", env, workdir });
      await sleep(MOCK ? 300 : 6000, master.signal);
      const word = `word${crypto.randomBytes(3).toString("hex")}`;
      const a = await turn(cli, { ...base, pool: true, prompt: `Remember this code word for later: ${word}. Reply only with OK.` });
      fatal(cli, a);
      const b = a.session ? await turn(cli, { ...base, pool: true, sessionId: a.session, prompt: "What was the code word? Reply only with it." }) : a;
      fatal(cli, b);
      const pass = a.pool === "hit" && b.pool === "hit" && !a.error && !b.error && (MOCK || b.text.includes(word));
      put(cli, "warm process", pass ? "pass" : "fail", `first text cold=${cold.firstMs}ms warm=${a.firstMs}ms next=${b.firstMs}ms; pool=${a.pool}/${b.pool}${pass ? "" : `; ${why(a)}; ${why(b)}`}`);
      P.dropAll();
    }
    // 8. Tạo một ảnh thật qua đúng mã production: chạy trước hai bài chờ lâu; tốn hạn mức ảnh nên chỉ khi có --image.
    if (!IMAGE) put(cli, "real image", "skip", "");
    else if (cli === "claude") put(cli, "real image", "skip", "Claude Code has no image generator");
    else {
      const t0 = Date.now(), { "ai/imagegen": I, "ai/imagefiles": F } = await loadTs(["ai/imagegen", "ai/imagefiles"]);
      const r = await I.runBackend(cli, { uid: scope, prompt: "a small red apple on a white table", signal: master.signal });
      const f = r.files?.[0], kind = f && F.imageKind(f.data);
      put(cli, "real image", kind ? "pass" : "fail", kind ? `${kind.mime} ${Math.round(f.data.length / 1024)} KB; ${Math.round((Date.now() - t0) / 1000)}s` : `${r.fail?.kind ?? "no file"}: ${r.fail?.detail ?? ""}; ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    // 6b. Tìm web bằng công cụ dựng sẵn của CLI: phải có nguồn để hiện cho người dùng, không chỉ là câu trả lời.
    if (master.signal.aborted) throw new Stop("interrupted");
    {
      const r = await turn(cli, { ...base, web: true, prompt: `Use your web search tool to find the official home page of the Rust programming language, then reply with its URL and nothing else.${MOCK ? " #web [mock:twomsg]" : ""}` });
      fatal(cli, r);
      // Claude Code, Grok báo cả lượt tìm và nguồn. Codex chỉ báo lượt tìm, nguồn nằm trong câu trả lời. Antigravity in một object khi xong nên chỉ xem được câu trả lời.
      const url = MOCK || /rust-lang\.org/.test(r.text);
      const pass = cli === "agy" ? url : cli === "codex" ? !!r.searches && url : !!r.searches && !!r.sources;
      put(cli, "web search", pass ? "pass" : "fail", `${r.searches ?? 0} searches, ${r.sources ?? 0} sources${r.error ? `; ${r.error.message}` : ""}`);
    }
    // 7. Hai bài chờ lâu: công cụ im lặng nhiều phút (có nhịp SSE của cầu nối như production) rồi trả mã; model phải đọc được đúng mã đó, CLI không được tự gọi lại.
    for (const [check, tool, min] of [["long hold", TOOL.slow, SLOW_MIN], ["approval hold", TOOL.hold, HOLD_MIN]]) {
      if (QUICK) { put(cli, check, "skip", "--quick"); continue; }
      if (master.signal.aborted) throw new Stop("interrupted");
      const token = `TOKEN${crypto.randomBytes(4).toString("hex")}`;
      // Antigravity tự cắt lần chờ ở khoảng 190 giây: như production, cầu nối trả job_id và model gọi wait_for_result (B.AGY_WAIT_NOTE).
      const agy = cli === "agy";
      const b = openTools(toolsBase, async () => { await sleep(min * 60_000, master.signal); return `Result token: ${token}`; }, agy ? B.BRIDGE_HOLD.agy : undefined);
      const r = await turn(cli, { ...base, bridge: b, timeoutMs: (min + 6) * 60_000, prompt: `${say(tool.name, { label: "go" })} It takes several minutes, so wait for it.${agy ? ` ${B.AGY_WAIT_NOTE.trim()}` : ""} Then reply with the token it returns and nothing else.` });
      fatal(cli, r);
      const got = r.text.includes(token), n = b.info.calls.length;
      put(cli, check, got && n === 1 ? "pass" : "fail", `${min} min; ${got ? "" : "token not in reply; "}${n > 1 ? "CLI called the tool again; " : ""}${why(r, n)}`);
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    for (const c of CHECKS) if (!table.get(cli).has(c)) put(cli, c, "skip", e.message);
  }
}

// ---- dọn dẹp, in bảng, thoát
function cleanup() {
  try { P.dropAll(); } catch {}
  try { srv.close(); srv.closeAllConnections?.(); } catch {}
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  try { for (const d of fs.readdirSync(cacheDir)) if (d.startsWith("synchro-ts-") && !cacheBefore.has(d)) fs.rmSync(path.join(cacheDir, d), { recursive: true, force: true }); } catch {}
}
function report() {
  const w = Math.max(...CHECKS.map((c) => c.length)) + 2, pad = (s, n) => String(s).padEnd(n);
  out("");
  out(`CLI contract, account ${scope.slice(0, 8)}…`);
  out(pad("", w) + CLIS.map((c) => pad(c, 8)).join(""));
  for (const c of CHECKS) out(pad(c, w) + CLIS.map((x) => pad(table.get(x).get(c)?.st ?? "skip", 8)).join(""));
  const notes = CLIS.flatMap((x) => CHECKS.flatMap((c) => { const v = table.get(x).get(c); return v?.note ? [`  ${x} / ${c}: ${v.st}: ${v.note}`] : []; }));
  if (notes.length) { out(""); out("Notes"); notes.forEach(out); }
  const v = CLIS.filter((c) => versions.get(c)).map((c) => `${c} ${clean(versions.get(c))}`);
  if (v.length) { out(""); out(`Versions: ${v.join(", ")}`); }
}
let leaving = false;
function onSignal() {
  if (leaving) return;
  leaving = true;
  master.abort();
  // Cho engine gỡ cầu nối khỏi cấu hình tài khoản (agy, grok) rồi mới thoát; quá 20 giây thì thoát luôn.
  setTimeout(() => { report(); cleanup(); process.exit(130); }, 20_000).unref?.();
}
process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);

let code = 0;
try {
  log(`Running ${CLIS.join(", ")}${QUICK ? " (quick)" : `; long checks take about ${Math.ceil(SLOW_MIN + HOLD_MIN)} minutes`}.`);
  await Promise.all(CLIS.map((c) => runCli(c).catch((e) => { for (const k of CHECKS) if (!table.get(c).has(k)) put(c, k, "fail", `script error: ${e?.message}`); })));
  report();
  code = master.signal.aborted ? 130 : CLIS.some((x) => [...table.get(x).values()].some((v) => v.st === "fail")) ? 1 : 0;
} catch (e) {
  log(`Contract script failed: ${clean(e?.message)}`);
  code = 1;
} finally { cleanup(); }
process.exit(code);
