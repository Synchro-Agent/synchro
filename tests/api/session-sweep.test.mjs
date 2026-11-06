// Bấm Dừng lượt Antigravity (CLI chỉ báo mã phiên khi xong lượt): phiên không được nằm lại trong thư mục đăng nhập, cả đoạn chat ẩn danh lẫn đoạn chat thường.
// Lượt xong bình thường thì phiên vẫn còn để nối tiếp. CLI giả lập, tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-sweep-")));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin"), DATA = path.join(tmp, "data");
process.env.DATA_DIR = DATA; process.env.SYNCHRO_ENGINE_HOME = HOME; process.env.SYNCHRO_ENGINE_USER = ""; process.env.DATA_KEY = "sweep-test"; delete process.env.SYNCHRO_ENGINE_BWRAP;
fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9" }));
const { "ai/subs": S, "ai/cli_auth": A, authstore: AS } = await loadTs(["ai/subs", "ai/cli_auth", "authstore"]);
const user = AS.createUser({ email: "sweep@synchro.test", name: "S", verified: true, passwordHash: "x" });
// Đăng nhập giả lập: như CLI thật, có tệp đăng nhập trong thư mục riêng của tài khoản.
const login = path.join(HOME, "logins", "agy", user.id);
const tok = path.join(login, ".gemini/antigravity-cli/antigravity-oauth-token");
fs.mkdirSync(path.dirname(tok), { recursive: true, mode: 0o700 }); fs.writeFileSync(tok, "{}");
fs.writeFileSync(path.join(DATA, "engine-tokens", `agy-${user.id}.login`), "1");
A.forget("agy", user.id);
await A.status?.("agy", user.id, { fresh: true }).catch?.(() => {});
const conv = () => { const out = []; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".pb")) out.push(e.name); } }; walk(login); return out; };
const wait = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const turn = (prompt, extra = {}) => S.subTurn({ user, model: "sub-agy/gemini-3-flash", system: "", messages: [{ role: "user", content: prompt }], ...extra });
try {
  let c = new AbortController();
  let p = turn("[mock:keepsession=8000] bí mật ẩn danh", { ephemeral: true, conv: "c-inc", signal: c.signal });
  ok(await wait(() => conv().length > 0), "phiên đã nằm trên đĩa khi lượt đang chạy", conv());
  c.abort();
  await p;
  ok(await wait(() => conv().length === 0), "dừng lượt ẩn danh: phiên không còn trên đĩa", conv());

  c = new AbortController();
  p = turn("[mock:keepsession=8000] bí mật thường", { conv: "c-normal", signal: c.signal });
  ok(await wait(() => conv().length > 0), "lượt đoạn chat thường: phiên trên đĩa khi đang chạy", conv());
  c.abort();
  await p;
  ok(await wait(() => conv().length === 0), "dừng lượt thường trước khi có mã phiên: không để lại phiên mồ côi", conv());

  // Lượt thường xong bình thường: phiên báo về, không bị dọn, nối tiếp được.
  const done = await turn("[mock:keepsession=200] xong bình thường", { conv: "c-ok" });
  await new Promise((r) => setTimeout(r, 800));
  ok(done.status === 200 && conv().length === 1, "lượt xong bình thường: phiên còn nguyên", JSON.stringify({ s: done.status, f: conv() }));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
