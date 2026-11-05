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
console.log("4. CLI mồ côi: chỉ tiến trình có chủ đã chết");
{
  const { "ai/cli_runtime": RT } = await loadTs(["ai/cli_runtime"]);
  const got = RT.orphansOf("101 500\n102 600\nrác\n103 500\n\n", (pid) => pid === 600);
  ok(got.join() === "101,103", "tiến trình của máy chủ còn sống không bị đụng tới (lúc triển khai có thể có hai máy chủ)", got);
}

console.log("5. Antigravity: câu dài hiện từng phần, Dừng được, không lộ đường dẫn máy chủ");
{
  const tok = path.join(HOME, "logins", "agy", U, ".gemini/antigravity-cli/antigravity-oauth-token");
  fs.mkdirSync(path.dirname(tok), { recursive: true, mode: 0o700 }); fs.writeFileSync(tok, "{}"); fs.writeFileSync(path.join(DATA, "engine-tokens", `agy-${U}.login`), "1");
  A.forget("agy", U);
  const envA = A.engineEnv("agy", U);
  const longAsk = "#longtext";
  const parts = [], t0 = Date.now();
  let final = "";
  for await (const e of new E.AntigravityEngine().runTurn({ prompt: longAsk, env: envA, workdir: work })) { if (e.kind === "text") parts.push(e.text); else if (e.kind === "final") final = e.text; }
  ok(parts.length > 5 && parts.join("").startsWith(final.slice(0, 200)) && parts.join("").endsWith(final.slice(-200)), `chữ về nhiều đoạn, ghép lại đủ cả câu: ${parts.length} đoạn`, parts.length);
  ok(Date.now() - t0 < 6000, "hiện xong trong vài giây");
  ok(!parts.join("").includes(HOME) && parts.join("").includes("anh.png"), "đường dẫn máy chủ dù nằm ngang chỗ cắt vẫn được che", parts.join("").slice(0, 200));
  const ctl = new AbortController(), seen = [];
  let errCode = null, finalA = null;
  for await (const e of new E.AntigravityEngine().runTurn({ prompt: longAsk, env: envA, workdir: work, signal: ctl.signal })) {
    if (e.kind === "text") { seen.push(e.text); ctl.abort(); } else if (e.kind === "final") finalA = e.text; else if (e.kind === "error") errCode = e.code;
  }
  ok(seen.length === 1 && errCode === "aborted" && finalA === null, "Dừng giữa lúc hiện: dừng ngay, không đổ nốt phần còn lại", JSON.stringify({ n: seen.length, errCode }));
  const short = [];
  for await (const e of new E.AntigravityEngine().runTurn({ prompt: "chào", env: envA, workdir: work })) if (e.kind === "text") short.push(e.text);
  ok(short.length === 1, "câu ngắn: hiện một lần như cũ", short.length);
}

console.log("6. Tệp đính kèm trên máy chủ");
{
  const { authstore: AU } = await loadTs(["authstore"]);
  const user = AU.createUser({ email: `att${Date.now()}@synchro.test`, name: "A", verified: true });
  const d = path.join(HOME, "logins", "agy", user.id), t = path.join(d, ".gemini/antigravity-cli/antigravity-oauth-token");
  fs.mkdirSync(path.dirname(t), { recursive: true, mode: 0o700 }); fs.writeFileSync(t, "{}"); fs.writeFileSync(path.join(DATA, "engine-tokens", `agy-${user.id}.login`), "1");
  A.forget("agy", user.id);
  await A.status("agy", user.id, { fresh: true }).catch(() => {});
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const msg = [{ role: "user", content: [{ type: "image", media_type: "image/png", data: png }, { type: "text", text: "ảnh gì đây" }] }];
  const att = path.join(HOME, "work", S.safeScopeForTest?.(user.id) ?? user.id, "att");
  const files = () => { const w = (x) => (fs.existsSync(x) ? fs.readdirSync(x, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? w(path.join(x, e.name)) : [e.name])) : []); return w(att); };
  const seenByCli = [];
  let r = await S.subTurn({ user, model: "sub-agy/gemini-3-flash", system: "", messages: [{ role: "user", content: [msg[0].content[0], { type: "text", text: "#media ảnh gì đây" }] }], ephemeral: true, conv: "an-danh" });
  seenByCli.push(r.json?.text ?? "");
  ok(r.status === 200 && /view_file/.test(seenByCli[0]), "đoạn chat ẩn danh: trong lượt CLI vẫn đọc được tệp", seenByCli[0]);
  ok(!files().length, "đoạn chat ẩn danh: tệp đính kèm bị xóa ngay khi xong lượt", JSON.stringify({ s: r.status, f: files(), e: r.json?.error }));
  r = await S.subTurn({ user, model: "sub-agy/gemini-3-flash", system: "", messages: msg, conv: "co-luu" });
  ok(r.status === 200 && files().length >= 1, "đoạn chat thường: tệp còn cho lượt sau", JSON.stringify({ s: r.status, f: files() }));
  await S.subTurn({ user, model: "sub-agy/gemini-3-flash", system: "", messages: msg, conv: "giu-lai" });
  const n = files().length;
  await S.removeConvSessions(user.id, "co-luu");
  ok(files().length === n - 1 && n >= 2, "xóa đoạn chat: xóa đúng tệp của đoạn đó, đoạn khác không đụng tới", JSON.stringify({ n, now: files().length }));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
