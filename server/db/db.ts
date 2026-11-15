// Kết nối SQLite dùng chung (data/synchro.db): mở một lần cho cả tiến trình, câu lệnh giữ sẵn cho đường nóng.
// Dữ liệu nằm trong data/synchro.db; thư mục data/ không vào git và không bị rsync ghi đè khi deploy.
import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DISK_FULL, diskLow } from "../diskfloor";
import { AuthError } from "../auth/errors";
import { migrate } from "../../db/migrate.mjs";

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

const g = globalThis as unknown as { __synchroDb?: Database.Database };
export function db() {
  if (g.__synchroDb) return g.__synchroDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "synchro.db"));
  d.pragma("journal_mode = WAL");
  // WAL: synchronous=NORMAL vẫn an toàn khi tiến trình chết (chỉ mất giao dịch cuối khi mất điện), không fsync mỗi lần ghi.
  // Bộ đệm trang 64 MB (số âm = KiB) và đọc qua mmap tới 256 MB: truy vấn lặp lại không đọc lại đĩa.
  d.pragma("synchronous = NORMAL");
  d.pragma("cache_size = -65536");
  d.pragma("mmap_size = 268435456");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  // Mọi bảng, chỉ mục, cột của mọi mô-đun: db/migrations/ theo PRAGMA user_version (db/migrate.mjs). Lỗi thì ném ra, không mở kết nối dở.
  try { migrate(d); } catch (e) { d.close(); throw e; }
  // Mốc bật xác minh email: tài khoản tạo trước mốc này giữ nguyên quyền như cũ, không phải làm gì thêm.
  d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('verify_since', ?)").run(String(Date.now()));
  healAdminEmails(d);
  return (g.__synchroDb = d);
}
// Câu lệnh đã biên dịch sẵn cho các truy vấn lặp lại trên đường nóng (mỗi yêu cầu: phiên, tài khoản, cài đặt). db().prepare() mỗi lần là
// phân tích lại câu SQL. Chỉ dùng cho câu SQL cố định (không ghép giá trị vào chuỗi) và cho get / run / all: một câu lệnh đang iterate() thì
// không dùng lại được giữa chừng. Gắn với đúng kết nối đang mở; tối đa STMT_MAX câu (quá thì bỏ hết, phòng ai đó ghép chuỗi động).
const STMT_MAX = 500;
const sg = globalThis as unknown as { __synchroStmts?: { d: Database.Database; m: Map<string, Database.Statement> } };
export function stmt(sql: string): Database.Statement {
  const d = db();
  let c = sg.__synchroStmts;
  if (!c || c.d !== d) c = sg.__synchroStmts = { d, m: new Map() };
  let st = c.m.get(sql);
  if (!st) {
    st = d.prepare(sql);
    if (c.m.size >= STMT_MAX) c.m.clear();
    c.m.set(sql, st);
  }
  return st;
}
/** Số câu lệnh đang giữ (kiểm thử). */
export const stmtCacheSize = () => sg.__synchroStmts?.m.size ?? 0;
/** Bản cũ đánh dấu chưa xác minh khi quản trị viên đổi email hộ, nên tài khoản lâu năm bị coi như vừa đăng ký. Sửa một lần: chỉ đúng tài khoản còn giữ địa chỉ quản trị viên đã đặt. */
export function healAdminEmails(d: Database.Database) {
  if (d.prepare("SELECT 1 FROM settings WHERE key = 'admin_email_healed'").get()) return;
  d.prepare("UPDATE users SET email_verified = 1 WHERE email_verified = 0 AND EXISTS (SELECT 1 FROM audit a WHERE a.action = 'admin_set_email' AND a.target_id = users.id AND lower(a.detail) = lower(users.email))").run();
  d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_email_healed', ?)").run(String(Date.now()));
}
/** Mọi đường ghi dữ liệu người dùng vào cơ sở dữ liệu đều qua đây: đĩa đầy thì SQLite ngừng ghi và cả trang hỏng cho mọi người. Đọc và xóa không bị chặn. */
export const needDisk = () => { if (diskLow(DATA_DIR)) throw new AuthError(DISK_FULL, 507); };
