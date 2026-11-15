// Bộ chạy migration của cơ sở dữ liệu (data/synchro.db): mọi bảng, chỉ mục, cột đều khai trong db/migrations/NNN_tên.*, số phiên bản
// đã áp dụng nằm ở PRAGMA user_version. Dùng chung cho máy chủ (server/db/db.ts), ops/create-admin.mjs và kiểm thử. Chạy đồng bộ,
// nhận một kết nối better-sqlite3 đã mở (busy_timeout đã đặt), không tự mở hay đóng gì.
//
// Hai loại tệp, đều chạy đồng bộ (db() đồng bộ, không chờ được import() động):
//   NNN_tên.sql           câu lệnh SQL, chỉ CREATE … IF NOT EXISTS / DROP INDEX IF EXISTS (xem db/migrations/README.md).
//   NNN_tên.columns.json  [{ table, column, def }]: thêm cột nếu bảng chưa có (PRAGMA table_info), không bao giờ sửa hay bỏ cột.
//
// Mỗi tệp đã được thỏa sẵn (mọi bảng / chỉ mục / trigger nó tạo đều có, mọi chỉ mục nó bỏ đều không còn, mọi cột nó thêm đều có) thì
// chỉ ghi số phiên bản, không chạy câu lệnh nào: cơ sở dữ liệu có sẵn từ trước khi có bộ chạy này (user_version 0) đi lên phiên bản
// mới mà không dữ liệu nào bị đụng tới. Thiếu gì thì chạy tệp đó; mọi câu lệnh đều không làm gì với cái đã có.
import fs from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = () => path.join(process.cwd(), "db", "migrations");
const FILE = /^(\d{3})_[\w-]+\.(sql|columns\.json)$/;

/** Danh sách tệp migration theo số thứ tự. Trùng số thì báo lỗi, không đoán. */
export function listMigrations(dir = MIGRATIONS_DIR()) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const m = FILE.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (out.some((x) => x.n === n)) throw new Error(`migrate: hai tệp cùng số ${m[1]} trong ${dir}`);
    out.push({ n, name, kind: m[2] === "sql" ? "sql" : "columns", file: path.join(dir, name) });
  }
  return out.sort((a, b) => a.n - b.n);
}

const ident = (s) => {
  if (!/^\w+$/.test(s)) throw new Error(`migrate: tên không hợp lệ: ${s}`);
  return s;
};
const columnsOf = (d, table) => new Set(d.prepare(`PRAGMA table_info("${ident(table)}")`).all().map((c) => c.name));
const objects = (d) => new Set(d.prepare("SELECT type || ':' || name AS k FROM sqlite_master").all().map((r) => r.k));

/** Các đối tượng một tệp .sql tạo / bỏ (bỏ qua chú thích dòng). */
export function sqlTargets(sql) {
  const s = sql.replace(/--[^\n]*/g, "");
  const create = [...s.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/gi)].map((m) => `${m[1].toLowerCase()}:${m[2]}`);
  const drop = [...s.matchAll(/DROP\s+INDEX\s+IF\s+EXISTS\s+"?(\w+)"?/gi)].map((m) => `index:${m[1]}`);
  return { create, drop };
}

/** Áp dụng một tệp. Trả về số thứ đã tạo / thêm (0: đã thỏa sẵn, chỉ ghi số phiên bản). */
function apply(d, m) {
  if (m.kind === "sql") {
    const sql = fs.readFileSync(m.file, "utf8");
    const { create, drop } = sqlTargets(sql);
    const have = objects(d);
    const missing = create.filter((k) => !have.has(k)).length + drop.filter((k) => have.has(k)).length;
    if (missing) d.exec(sql);
    return missing;
  }
  const cols = JSON.parse(fs.readFileSync(m.file, "utf8"));
  let added = 0;
  const seen = new Map();
  for (const { table, column, def } of cols) {
    if (!seen.has(table)) seen.set(table, columnsOf(d, table));
    const have = seen.get(table);
    if (!have.size) throw new Error(`migrate: ${m.name}: chưa có bảng ${table}`);
    if (have.has(column)) continue;
    d.exec(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(column)} ${def}`);
    have.add(column);
    added++;
  }
  return added;
}

/**
 * Đưa cơ sở dữ liệu lên phiên bản mới nhất. Cả lượt chạy là một giao dịch BEGIN IMMEDIATE: tiến trình kia (deploy xanh/lam dùng chung
 * một cơ sở dữ liệu) đợi tới khi xong rồi đọc lại user_version trong giao dịch của mình, nên mỗi tệp chỉ chạy một lần. Lỗi thì ROLLBACK
 * và ném lỗi (máy chủ không khởi động được, deploy quay lại bản cũ, bản cũ vẫn chạy với cơ sở dữ liệu như trước).
 * Cơ sở dữ liệu mới hơn mã (đã quay lại bản cũ sau khi migrate): ghi nhật ký rồi chạy tiếp, không hạ phiên bản.
 */
export function migrate(d, { dir = MIGRATIONS_DIR(), log = (s) => console.log(s) } = {}) {
  const list = listMigrations(dir);
  const latest = list.length ? list[list.length - 1].n : 0;
  const version = () => Number(d.pragma("user_version", { simple: true })) || 0;
  const from = version();
  if (from > latest) log(`[migrate] cơ sở dữ liệu ở phiên bản ${from}, mã này chỉ biết tới ${latest}: giữ nguyên, chạy tiếp`);
  if (from >= latest) return { from, to: from, applied: [] };
  const run = d.transaction(() => {
    const cur = version();
    const existing = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n > 0;
    const applied = [];
    for (const m of list) {
      if (m.n <= cur) continue;
      applied.push({ name: m.name, changed: apply(d, m) });
      d.pragma(`user_version = ${m.n}`);
    }
    return { from: cur, to: version(), applied, existing };
  });
  const r = run.immediate();
  // Cơ sở dữ liệu mới tinh thì im lặng; cơ sở dữ liệu đã có dữ liệu thì ghi rõ đã làm gì.
  if (r.existing && r.applied.length) log(`[migrate] user_version ${r.from} → ${r.to}: ${r.applied.map((a) => `${a.name} ${a.changed ? `(${a.changed} thay đổi)` : "(đã có sẵn, chỉ ghi số phiên bản)"}`).join(", ")}`);
  return { from: r.from, to: r.to, applied: r.applied };
}
