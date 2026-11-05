// Lỗi của CLI: giới hạn chi tiêu không phải mất đăng nhập, lỗi sau một phần câu trả lời của Grok không được coi là xong, hạn tuần là của cả gói.
// Lỗi giữa lượt chạy trên CLI giả lập (chưa thấy trên Grok thật). Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-clierr-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin"), DATA = path.join(tmp, "data");
process.env.DATA_DIR = DATA; process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.SYNCHRO_ENGINE_USER = ""; process.env.DATA_KEY = "clierr-test"; delete process.env.SYNCHRO_ENGINE_BWRAP;
fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9" }));
const { "ai/errors": X, "ai/cli_engines": E, "ai/subs": S, "ai/cli_auth": A } = await loadTs(["ai/errors", "ai/cli_engines", "ai/subs", "ai/cli_auth"]);

console.log("1. Giới hạn chi tiêu là hết hạn mức");
for (const m of ["API error 403: spending-limit", "HTTP 403 personal-team-blocked:spending-limit", "You are out of extra usage"]) ok(X.classify(m) === "quota", m, X.classify(m));
ok(X.classify("spending limit reached", 403) === "quota", "có mã 403 kèm chữ giới hạn chi tiêu vẫn là hạn mức");
ok(X.classify("API error 403: forbidden") === "auth" && X.classify("xyz", 403) === "auth", "403 khác vẫn là đăng nhập");

console.log("2. Grok lỗi sau một phần câu trả lời");
const U = "clierr", tok = path.join(HOME, "logins", "grok", U, ".grok/auth.json");
fs.mkdirSync(path.dirname(tok), { recursive: true, mode: 0o700 }); fs.writeFileSync(tok, "{}"); fs.writeFileSync(path.join(DATA, "engine-tokens", `grok-${U}.login`), "1");
A.forget("grok", U);
const env = A.engineEnv("grok", U), work = path.join(HOME, "work", U); fs.mkdirSync(work, { recursive: true });
const run = async (prompt) => {
  const o = { text: "", final: null, err: null, code: null };
  for await (const e of new E.GrokEngine().runTurn({ prompt, env, workdir: work })) {
    if (e.kind === "text") o.text += e.text; else if (e.kind === "final") o.final = e.text; else if (e.kind === "error") { o.err = e.message; o.code = e.code; }
  }
  return o;
};
let r = await run("[mock:midquota] viết đi");
ok(r.final === null && r.code === "quota" && /Phần đầu/.test(r.text), "hết hạn mức giữa chừng: báo lỗi hạn mức, không coi là xong, phần đã có vẫn còn", r);
r = await run("[mock:midrecover] viết đi");
ok(r.err === null && r.final === "Phần đầu và phần cuối", "lỗi thoáng qua rồi viết tiếp: vẫn là xong", r);

console.log("3. Hạn tuần của gói");
ok(S.noteQuota("claude", "u1", "sonnet", "You've hit your weekly limit") === "plan", "“weekly limit” trần: cả gói");
ok(S.noteQuota("claude", "u2", "opus", "You've hit your Opus weekly limit") === "model", "“Opus weekly limit”: riêng model");
ok(S.noteQuota("claude", "u3", "sonnet", "You've hit your limit") === "model", "câu chung chung: giữ như cũ");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
