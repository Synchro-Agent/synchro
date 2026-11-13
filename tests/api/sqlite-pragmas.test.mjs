// Kết nối SQLite chính (authstore.db()): WAL, synchronous=NORMAL, bộ đệm 64 MB, mmap 256 MB, khóa ngoại, chờ khóa 5 giây.
// Tự chạy được, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-pragma-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

try {
  const { authstore: A } = await loadTs(["authstore"]);
  const d = A.db();
  const p = (k) => d.pragma(k, { simple: true });
  console.log("1. Các pragma của kết nối");
  ok(p("journal_mode") === "wal", "journal_mode = wal", p("journal_mode"));
  ok(p("synchronous") === 1, "synchronous = NORMAL (1)", p("synchronous"));
  ok(p("cache_size") === -65536, "cache_size = -65536 (64 MB)", p("cache_size"));
  ok(p("mmap_size") === 268435456, "mmap_size = 256 MB", p("mmap_size"));
  ok(p("foreign_keys") === 1 && p("busy_timeout") === 5000, "khóa ngoại bật, chờ khóa 5 giây");
  console.log("2. Ghi và đọc lại bình thường");
  const u = A.createUser({ email: "a@pragma.test", name: "A", verified: true });
  ok(A.getUser(u.id)?.email === "a@pragma.test", "tạo rồi đọc tài khoản");
  ok(fs.existsSync(path.join(process.env.DATA_DIR, "synchro.db-wal")), "có tệp -wal (đang ở chế độ WAL)");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
