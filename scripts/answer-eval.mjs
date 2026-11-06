#!/usr/bin/env node
// Chấm chất lượng trả lời trên CLI thật: chạy bộ câu cố định tests/evals/answer-set.json (tiếng Việt và tiếng Anh: nguy hiểm, sức khỏe, pháp lý, tiền bạc, viết, câu thường, câu bẫy) qua đúng engine của
// production, đúng phần hướng dẫn chất lượng (đường nhanh hoặc lượt đầy đủ theo bộ định tuyến), rồi in câu trả lời của từng CLI cạnh nhau để người đọc chấm theo mục "Cần kiểm tra". Script không tự chấm điểm.
//
// Chạy trên máy chủ, bằng đúng user của web, từ thư mục app. MỖI CÂU NHÂN MỖI CLI LÀ MỘT LƯỢT THẬT CỦA GÓI (đủ bộ: khoảng 90 lượt mỗi CLI), nên bắt đầu bằng --ids hoặc --kinds, dùng tài khoản thử:
//   su - synchro -c "cd /var/www/synchro && node scripts/answer-eval.mjs <account-scope> --kinds=crisis --out=/tmp/answers.md"
// Tùy chọn: --only=claude,grok   --kinds=crisis,health,legal,money,writing,ordinary,trap   --ids=crisis-vi-01,money-en-02   --lang=vi|en   --model=claude:haiku,codex:gpt-6-luna   --tz=Asia/Ho_Chi_Minh   --out=tệp.md   --list (chỉ in danh sách, không gọi CLI)
//
// Lượt ở đây KHÔNG có công cụ (không web, không connector, không skill). Lượt đầy đủ trong sản phẩm còn có thêm hướng dẫn và công cụ: câu cần tìm web ở đây sẽ phải nói thật là chưa tìm được.
// Claude chọn model theo bộ định tuyến thật (Haiku, Sonnet, Opus); CLI khác dùng model mặc định của gói, hoặc --model.
// Không đụng dữ liệu thật: DATA_DIR trỏ sang thư mục tạm, chỉ chép token đã mã hóa của đúng tài khoản này (như cli-contract.mjs), xóa khi thoát. Không in bí mật: lỗi đi qua redact.
// Mã thoát: 0 chạy xong (dù có CLI lỗi, xem trong bảng), 2 sai cách dùng, 130 bị ngắt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a === undefined ? d : a.includes("=") ? a.slice(a.indexOf("=") + 1) : true; };
const csv = (k) => (opt(k, "") ? String(opt(k, "")).split(",").filter(Boolean) : null);
const set = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "evals", "answer-set.json"), "utf8"));
const kinds = csv("kinds"), ids = csv("ids"), lang = opt("lang", ""), TZ = opt("tz", "") || undefined;
const items = set.items.filter((x) => (!kinds || kinds.includes(x.kind)) && (!ids || ids.includes(x.id)) && (!lang || x.lang === lang));
if (opt("list", false)) { for (const x of items) process.stdout.write(`${x.id}\t${x.kind}\t${x.prompt}\n`); process.exit(0); }
const scope = argv.find((x) => !x.startsWith("--"));
if (!scope) { process.stderr.write("Usage: node scripts/answer-eval.mjs <account-scope> [--only=claude,grok] [--kinds=crisis,health] [--ids=crisis-vi-01] [--lang=vi] [--model=claude:haiku] [--out=answers.md] [--list]\n"); process.exit(2); }
if (!items.length) { process.stderr.write("Không có câu nào khớp bộ lọc.\n"); process.exit(2); }
const ONLY = csv("only"), OUT = opt("out", "");
const MODELS = Object.fromEntries(String(opt("model", "")).split(",").filter(Boolean).map((x) => x.split(":")));

// ---- môi trường như web, dữ liệu tạm (giống cli-contract.mjs)
for (const f of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  let t = ""; try { t = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  for (const l of t.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const realData = process.env.DATA_DIR ?? path.join(ROOT, "data");
process.env.SYNCHRO_ENGINE_HOME ??= path.join(realData, "engine");
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-answers-"));
fs.chmodSync(tmpData, 0o700);
{
  const safe = scope.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "default";
  const tok = path.join(realData, "engine-tokens", `claude-${safe}.enc`);
  if (fs.existsSync(tok)) { fs.mkdirSync(path.join(tmpData, "engine-tokens"), { mode: 0o700 }); fs.copyFileSync(tok, path.join(tmpData, "engine-tokens", path.basename(tok))); }
  const key = path.join(realData, "secret.key");
  if (fs.existsSync(key)) fs.copyFileSync(key, path.join(tmpData, "secret.key"));
}
process.env.DATA_DIR = tmpData;
const cacheDir = path.join(ROOT, "node_modules", ".cache");
const cacheBefore = new Set((() => { try { return fs.readdirSync(cacheDir); } catch { return []; } })());
const cleanup = () => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  try { for (const d of fs.readdirSync(cacheDir)) if (d.startsWith("synchro-ts-") && !cacheBefore.has(d)) fs.rmSync(path.join(cacheDir, d), { recursive: true, force: true }); } catch {}
};
const out = (s) => { if (OUT) fs.appendFileSync(String(OUT), s + "\n"); else process.stdout.write(s + "\n"); };
const log = (s) => process.stderr.write(s + "\n");
for (const k of ["log", "warn", "info"]) console[k] = () => {};
if (OUT) fs.writeFileSync(String(OUT), "");

const { loadTs } = await import("../tests/lib/ts.mjs");
const { "ai/cli_auth": A, "ai/cli_runtime": R, "ai/selector": S, "ai/errors": X, router: RT, chatengine: CE } = await loadTs(["ai/cli_auth", "ai/cli_runtime", "ai/selector", "ai/errors", "router", "chatengine"]);
const NAME = { claude: "Claude", codex: "ChatGPT", agy: "Gemini", grok: "Grok" };
const master = new AbortController();
let stopped = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopped = true; master.abort(); });

async function ask(cli, it, o) {
  const q = { text: it.prompt, attachments: 0, turns: 1, studio: false };
  const fast = RT.needsNoTools(q), effort = RT.autoEffort(q);
  const route = RT.routeModel(q, ["sub-claude/haiku", "sub-claude/sonnet", "sub-claude/opus"]);
  const model = MODELS[cli] ?? (cli === "claude" ? route.model.split("/")[1] : undefined);
  const system = `Bạn là một trợ lý AI hữu ích.\n\n${CE.answerRules(fast)}`;
  // Đúng như lượt thật: khối đầu mối trợ giúp đi cùng tin nhắn. Không có --tz thì đoán nơi theo ngôn ngữ, như người gọi không gửi múi giờ.
  const help = CE.crisisHelp(it.prompt, TZ);
  const ac = new AbortController(), t0 = Date.now(), timer = setTimeout(() => ac.abort(), 240_000);
  const stop = () => ac.abort();
  master.signal.addEventListener("abort", stop, { once: true });
  const r = { cli, model: model ?? "mặc định của gói", effort, fast, text: "", error: null, firstMs: null, ms: 0, chunks: 0 };
  let session = null, finalText = null;
  try {
    for await (const e of S.engineFor(cli).runTurn({ prompt: help ? `${it.prompt}\n\n${help}` : it.prompt, system, model, effort, workdir: o.workdir, env: o.env, signal: ac.signal, pool: false })) {
      if (e.kind === "text") { r.text += e.text; r.chunks++; r.firstMs ??= Date.now() - t0; }
      else if (e.kind === "session") session = e.id;
      else if (e.kind === "final") finalText = e.text;
      else if (e.kind === "error") r.error = X.redact(String(e.message)).slice(0, 300);
    }
    if (finalText !== null) r.text = finalText;
  } catch (e) { r.error = X.redact(String(e?.message)).slice(0, 300); }
  finally { clearTimeout(timer); master.signal.removeEventListener("abort", stop); }
  r.ms = Date.now() - t0;
  // Câu hỏi thử không được nằm lại trong lịch sử phiên của tài khoản.
  if (session) await R.removeSessionFiles(A.scopeDir(cli, scope), session).catch(() => {});
  return r;
}

let code = 0;
try {
  const clis = [];
  for (const cli of R.CLIS.filter((c) => !ONLY || ONLY.includes(c))) {
    const st = await A.status(cli, scope, { fresh: true }).catch(() => null);
    if (st?.installed && st.loggedIn) clis.push(cli); else log(`[${cli}] chưa cài hoặc chưa đăng nhập: bỏ qua`);
  }
  if (!clis.length) { log("Không có CLI nào dùng được cho tài khoản này."); code = 2; }
  else {
    const envs = Object.fromEntries(clis.map((c) => [c, { env: A.engineEnv(c, scope), workdir: path.join(R.engineHome(), "work", A.safeScope(scope)) }]));
    for (const c of clis) R.makeDir(envs[c].workdir);
    log(`${items.length} câu, ${clis.join(", ")}: ${items.length * clis.length} lượt thật của gói.`);
    out(`# Câu trả lời trên CLI thật\n\nTài khoản ${scope.slice(0, 8)}…, ${new Date().toISOString()}. Lượt không có công cụ.\n`);
    const tally = new Map(clis.map((c) => [c, { n: 0, err: 0, first: [] }]));
    for (const [i, it] of items.entries()) {
      if (stopped) break;
      log(`[${i + 1}/${items.length}] ${it.id}`);
      const q = { text: it.prompt, attachments: 0, turns: 1, studio: false };
      out(`\n## ${it.id} · ${it.kind} · ${it.lang}\n\n**Câu hỏi:** ${it.prompt}\n\n**Định tuyến:** ${RT.needsNoTools(q) ? "đường nhanh" : "lượt đầy đủ"}, việc ${RT.taskOf(q)}, nỗ lực ${RT.autoEffort(q)}${RT.hasHighStakes(q) ? ", có rủi ro" : ""}${RT.isCrisis(it.prompt) ? ", nguy hiểm tức thời" : ""}\n\n**Cần kiểm tra:** ${it.review}`);
      const rs = await Promise.all(clis.map((c) => ask(c, it, envs[c])));
      for (const r of rs) {
        const t = tally.get(r.cli);
        t.n++; if (r.error) t.err++; else if (r.firstMs !== null) t.first.push(r.firstMs);
        out(`\n### ${NAME[r.cli]} (${r.model}, ${r.effort}, chữ đầu ${r.firstMs === null ? "không có" : `${(r.firstMs / 1000).toFixed(1)} s`}, ${r.chunks} đợt chữ, xong ${(r.ms / 1000).toFixed(1)} s)\n\n${r.error ? `LỖI: ${r.error}` : r.text.trim() || "(trống)"}`);
      }
    }
    const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
    out(`\n## Tổng\n\n| CLI | Lượt | Lỗi | Chữ đầu, trung vị |\n|---|---|---|---|`);
    for (const c of clis) { const t = tally.get(c), m = med(t.first); out(`| ${NAME[c]} | ${t.n} | ${t.err} | ${m === null ? "-" : `${(m / 1000).toFixed(1)} s`} |`); }
    if (stopped) { code = 130; log("Bị ngắt: phần đã chạy vẫn có trong kết quả."); }
    if (OUT) log(`Đã ghi ${OUT}`);
  }
} finally { cleanup(); }
process.exit(code);
