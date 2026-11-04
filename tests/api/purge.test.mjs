// Xóa tài khoản: quét mọi bảng khai báo trong app/ và db/schema.sql có cột người dùng; tệp trên đĩa; đăng nhập CLI; tệp tải lên có chủ.
// Tự chạy được, không cần máy chủ: thư mục dữ liệu và nhà engine riêng cho lượt kiểm thử, Synchro không gọi dịch vụ workspace.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-purge-"));
const DATA = (process.env.DATA_DIR = path.join(tmp, "data"));
const HOME = (process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine"));
process.env.DATA_KEY = "purge-test-key";
process.env.SKILLS_DIR = path.join(DATA, "skills");
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(DATA, { recursive: true });

const { purge: P, authstore: AS, "fileproc/owners": OWN, "ai/cli_runtime": R } = await loadTs(["purge", "authstore", "fileproc/owners", "ai/cli_runtime"]);
const A = AS.createUser({ email: "a@purge.test", name: "A", verified: true }), B = AS.createUser({ email: "b@purge.test", name: "B", verified: true });
const d = AS.db();

// Mọi bảng khai báo trong mã nguồn (kể cả bảng mô-đun chỉ tạo khi cần), kèm cột.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx|sql)$/.test(e.name) ? [path.join(dir, e.name)] : []));
for (const f of [...walk("app"), ...walk("db")]) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < s.length && depth) { if (s[i] === "(") depth++; else if (s[i] === ")") depth--; i++; }
    try { d.exec(`CREATE TABLE IF NOT EXISTS ${m[1]} (${s.slice(m.index + m[0].length, i - 1)})`); } catch (e) { console.log("    (bỏ qua", m[1], e.message, ")"); }
  }
}

console.log("1. Quét mọi bảng có cột người dùng");
d.pragma("foreign_keys = OFF");
const USER_COLS = ["user_id", "owner"];
const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
const withUser = [];
let n = 0;
for (const t of tables) {
  const info = d.prepare(`PRAGMA table_info("${t}")`).all();
  const col = info.find((c) => USER_COLS.includes(c.name));
  if (!col) continue;
  withUser.push({ t, col: col.name });
  for (const uid of [A.id, B.id]) {
    const vals = info.map((c) => (USER_COLS.includes(c.name) ? uid : /(^|_)at$/.test(c.name) ? Date.now() : c.type.toUpperCase().includes("INT") ? ++n : `k${++n}`));
    d.prepare(`INSERT INTO "${t}" (${info.map((c) => `"${c.name}"`).join(",")}) VALUES (${info.map(() => "?").join(",")})`).run(...vals);
  }
}
ok(withUser.length >= 30, `tìm thấy ${withUser.length} bảng có cột người dùng`, withUser.map((x) => x.t).join());
for (const must of ["runs", "user_memory", "brain_notes", "brain_links", "brain_queue", "brain_state", "brain_log", "instructions_history", "code_sessions", "code_prefs", "code_prs", "engine_sessions", "engine_turns", "engine_api_optin", "tool_refs", "speech_items", "notices", "proposals", "task_runs", "skill_scans", "skill_patches", "artifacts", "apps", "connectors", "outputs", "file_owners"])
  ok(withUser.some((x) => x.t === must), `bảng ${must} nằm trong phần quét`);
d.pragma("foreign_keys = ON");

// Dấu vết ngoài cột người dùng
AS.setSetting(`mem:${A.id}`, "{}"); AS.setSetting(`mem:${B.id}`, "{}");
d.prepare("INSERT INTO app_data (ref, owner, key, value, size, updated_by, updated_at) VALUES ('app:khac', '', 'k', 'v', 1, ?, 0)").run(A.id);
AS.audit("login", { actor: A, ip: "1.2.3.4" });
AS.audit("login", { actor: B, ip: "5.6.7.8" });
AS.audit("account_deleted", { actor: A, target: A, ip: "1.2.3.4" });

console.log("2. Tệp trên đĩa và đăng nhập CLI");
const logins = (u, cli) => path.join(HOME, "logins", cli, u);
const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "x"); };
for (const u of [A.id, B.id]) {
  touch(path.join(DATA, "outputs", u, "f1"));
  touch(path.join(DATA, "speech", u, "a.mp3"));
  touch(path.join(DATA, "skills", u, "s1", "v1", "SKILL.md"));
  touch(path.join(HOME, "work", u, "note.txt"));
  for (const cli of R.CLIS) touch(path.join(logins(u, cli), "auth.json"));
  touch(path.join(DATA, "engine-tokens", `claude-${u}.enc`));
  touch(path.join(DATA, "engine-tokens", `codex-${u}.login`));
}
// Tệp tải lên: một tệp riêng của A, một tệp cả hai cùng có, một tệp riêng của B.
const CACHE = path.join(process.cwd(), ".cache", "files");
const fid = (c) => c.repeat(40);
const ids = { onlyA: fid("a"), shared: fid("c"), onlyB: fid("b") };
for (const id of Object.values(ids)) { touch(path.join(CACHE, id + ".bin")); touch(path.join(CACHE, id + ".json")); }
d.exec("DELETE FROM file_owners");
OWN.claimFile(A.id, ids.onlyA, 1); OWN.claimFile(A.id, ids.shared, 1); OWN.claimFile(B.id, ids.shared, 1); OWN.claimFile(B.id, ids.onlyB, 1);

await P.purgeUser(A.id);

console.log("3. Sau khi xóa A");
for (const { t, col } of withUser) {
  const a = d.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE "${col}" = ?`).get(A.id).n, b = d.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE "${col}" = ?`).get(B.id).n;
  ok(a === 0, `${t}: không còn dòng của A`, a);
  ok(b >= 1, `${t}: dòng của B còn nguyên`, b);
}
ok(AS.getSetting(`mem:${A.id}`, "") === "" && AS.getSetting(`mem:${B.id}`, "") !== "", "cài đặt bộ nhớ của A đã xóa, của B còn");
ok(d.prepare("SELECT updated_by v FROM app_data WHERE ref = 'app:khac'").get().v === "", "dữ liệu chung trong ứng dụng người khác: bỏ dấu người ghi");
ok(!d.prepare("SELECT 1 FROM audit WHERE action = 'login' AND (actor_email = ? OR ip = '1.2.3.4')").get(A.email), "nhật ký: bỏ email, IP của A");
ok(!!d.prepare("SELECT 1 FROM audit WHERE action = 'login' AND actor_email = ? AND ip = '5.6.7.8'").get(B.email), "nhật ký: của B giữ nguyên");
ok(!!d.prepare("SELECT 1 FROM audit WHERE action = 'account_deleted' AND actor_email = ?").get(A.email), "nhật ký: dòng đã xóa tài khoản vẫn giữ email");
for (const [name, a, b] of [["outputs", path.join(DATA, "outputs", A.id), path.join(DATA, "outputs", B.id)], ["âm thanh", path.join(DATA, "speech", A.id), path.join(DATA, "speech", B.id)], ["skill", path.join(DATA, "skills", A.id), path.join(DATA, "skills", B.id)], ["thư mục làm việc CLI", path.join(HOME, "work", A.id), path.join(HOME, "work", B.id)]])
  ok(!fs.existsSync(a) && fs.existsSync(b), `${name}: của A đã xóa, của B còn`);
for (const cli of R.CLIS) ok(!fs.existsSync(logins(A.id, cli)) && fs.existsSync(path.join(logins(B.id, cli), "auth.json")), `đăng nhập ${cli}: của A đã xóa, của B còn`);
ok(!fs.existsSync(path.join(DATA, "engine-tokens", `claude-${A.id}.enc`)) && fs.existsSync(path.join(DATA, "engine-tokens", `claude-${B.id}.enc`)), "token Claude đã lưu: của A đã xóa, của B còn");
ok(!fs.existsSync(path.join(CACHE, ids.onlyA + ".bin")), "tệp tải lên chỉ A có: đã xóa khỏi đĩa");
ok(fs.existsSync(path.join(CACHE, ids.shared + ".bin")) && fs.existsSync(path.join(CACHE, ids.onlyB + ".bin")), "tệp B cũng có: vẫn còn");

console.log("4. Mã tài khoản lạ không xóa thư mục chung");
for (const bad of ["", ".", "..", "a/b", "../x"]) {
  let threw = false;
  await P.purgeUser(bad).catch(() => { threw = true; });
  ok(threw, `từ chối mã "${bad}"`);
}
ok(fs.existsSync(path.join(DATA, "outputs", B.id)) && fs.existsSync(path.join(DATA, "skills", B.id)), "dữ liệu người khác không bị ảnh hưởng");

console.log("5. Tệp tải lên có chủ");
{
  const X = AS.createUser({ email: "x@purge.test", name: "X", verified: true }), Y = AS.createUser({ email: "y@purge.test", name: "Y", verified: true });
  ok(OWN.mayUse(B.id, ids.shared) && OWN.mayUse(B.id, ids.onlyB), "chủ tệp đọc được");
  ok(!OWN.mayUse(X.id, ids.onlyB), "người khác biết mã băm vẫn không đọc được");
  const legacy = fid("d");
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(path.join(CACHE, legacy + ".json"), "{}");
  ok(!OWN.mayUse(X.id, fid("9")), "tệp đã bị xóa hẳn: biết mã băm cũng không nhận làm chủ được");
  ok(OWN.mayUse(X.id, legacy), "tệp cũ chưa có chủ: người đầu tiên dùng thành chủ (không làm hỏng lịch sử chat cũ)");
  ok(!OWN.mayUse(Y.id, legacy), "… rồi người khác không đọc được");
  process.env.SYNCHRO_UPLOAD_QUOTA_MB = "1";
  OWN.claimFile(Y.id, fid("e"), 900_000);
  let threw = null;
  try { OWN.checkQuota(Y.id, 200_000); } catch (e) { threw = e; }
  ok(threw?.status === 413, "vượt hạn mức tải lên → 413", threw);
  try { OWN.checkQuota(Y.id, 100_000); threw = null; } catch (e) { threw = e; }
  ok(!threw, "còn trong hạn mức thì nhận");
  delete process.env.SYNCHRO_UPLOAD_QUOTA_MB;
}

// Dọn tệp giả của lượt kiểm thử trong .cache/files của thư mục dự án.
for (const c of ["a", "b", "c", "d", "e"]) for (const x of [".bin", ".json"]) fs.rmSync(path.join(CACHE, fid(c) + x), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
