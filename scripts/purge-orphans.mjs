// Dọn một lần dữ liệu của các tài khoản ĐÃ XÓA trước khi có purgeUser (server/purge.ts): dòng SQLite có user_id / owner không còn trong bảng users, thư mục
// trên đĩa, đăng nhập CLI. Mặc định chỉ liệt kê. Chạy tay trên máy chủ, SAU một bản sao lưu (scripts/backup.sh), xem kỹ danh sách rồi mới --apply:
//   cd /var/www/synchro && set -a && . ./.env.production && set +a && node scripts/purge-orphans.mjs [--apply]
// Thư mục đăng nhập CLI thuộc user riêng của engine nên --apply phải chạy bằng root.
// Chỉ coi là "của tài khoản đã xóa" khi mã có đúng dạng UUID (crypto.randomUUID ở createUser): giá trị khác ("", "default", tên kho…) không đụng tới.
// --uploads-days=N (tùy chọn): xóa thêm tệp tải lên chưa có chủ và không đổi trong N ngày (tệp từ trước khi có file_owners, không biết của ai).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const R = createRequire(path.join(process.cwd(), "package.json"));
const apply = process.argv.includes("--apply");
const uploadsDays = Number(process.argv.find((a) => a.startsWith("--uploads-days="))?.split("=")[1]) || 0;
const DATA = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const ENGINE = process.env.SYNCHRO_ENGINE_HOME ?? path.join(DATA, "engine");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const db = new (R("better-sqlite3"))(path.join(DATA, "synchro.db"));
db.pragma("busy_timeout = 10000");
const live = new Set(db.prepare("SELECT id FROM users").all().map((r) => r.id));
// Bảng users trống hay gần như trống thì nghi nhầm cơ sở dữ liệu: không làm gì.
if (live.size < 1) { console.error("Bảng users trống: dừng."); process.exit(1); }

const orphan = (v) => typeof v === "string" && UUID.test(v) && !live.has(v);
let rows = 0;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
const ids = new Set();
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
  for (const c of ["user_id", "owner"]) {
    if (!cols.includes(c)) continue;
    const found = db.prepare(`SELECT "${c}" AS v, COUNT(*) AS n FROM "${t}" GROUP BY "${c}"`).all().filter((r) => orphan(r.v));
    if (!found.length) continue;
    const n = found.reduce((a, r) => a + r.n, 0);
    rows += n;
    found.forEach((r) => ids.add(r.v));
    console.log(`${t}.${c}: ${n} dòng của ${found.length} tài khoản đã xóa`);
    if (apply) { const del = db.prepare(`DELETE FROM "${t}" WHERE "${c}" = ?`); db.transaction(() => found.forEach((r) => del.run(r.v)))(); }
  }
}

const dirs = [];
const scan = (root) => { let list = []; try { list = fs.readdirSync(root); } catch { return; } for (const n of list) if (orphan(n)) { dirs.push(path.join(root, n)); ids.add(n); } };
for (const sub of ["outputs", "speech", "skills"]) scan(path.join(DATA, sub));
scan(path.join(ENGINE, "work"));
for (const cli of ["claude", "codex", "agy", "grok"]) scan(path.join(ENGINE, "logins", cli));
scan("/srv/synchro-ws");
scan("/srv/synchro-ws/_keep");
const files = [];
try { for (const n of fs.readdirSync(path.join(DATA, "engine-tokens"))) { const m = /^(?:claude|codex|agy|grok)-(.+)\.(?:enc|login)$/.exec(n); if (m && orphan(m[1])) { files.push(path.join(DATA, "engine-tokens", n)); ids.add(m[1]); } } } catch { /* chưa có */ }
for (const d of dirs) console.log(`thư mục: ${d}`);
for (const f of files) console.log(`tệp: ${f}`);

// Tệp tải lên có chủ đã xóa hết.
const UP = path.join(process.cwd(), ".cache", "files");
const has = tables.includes("file_owners");
const owned = has ? new Set(db.prepare("SELECT DISTINCT file_id AS v FROM file_owners").all().map((r) => r.v)) : new Set();
const stale = [];
if (uploadsDays > 0 && has) {
  const cut = Date.now() - uploadsDays * 86_400_000;
  try { for (const n of fs.readdirSync(UP)) { const m = /^([a-f0-9]{40})\.(bin|json)$/.exec(n); if (m && !owned.has(m[1]) && fs.statSync(path.join(UP, n)).mtimeMs < cut) stale.push(path.join(UP, n)); } } catch { /* chưa có */ }
  console.log(`tệp tải lên chưa có chủ, quá ${uploadsDays} ngày: ${stale.length}`);
}

console.log(`\nTổng: ${ids.size} tài khoản đã xóa, ${rows} dòng, ${dirs.length} thư mục, ${files.length} tệp.`);
if (!apply) { console.log("Chưa xóa gì. Thêm --apply để xóa."); process.exit(0); }
for (const p of [...dirs, ...files, ...stale]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { console.error("Không xóa được", p, e.message); } }
console.log("Đã xóa.");
