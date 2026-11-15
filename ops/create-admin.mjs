// Tạo (hoặc đặt lại mật khẩu cho) tài khoản quản trị viên trực tiếp trong data/synchro.db.
// Web không cho đăng ký bằng mật khẩu với email quản trị, nên đây là cách duy nhất ngoài đăng nhập Google/GitHub/Apple.
// Dùng: node ops/create-admin.mjs [email]   (trên VPS: chạy bằng user synchro trong /var/www/synchro)
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { migrate } from "../db/migrate.mjs";

const DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
// Chủ sở hữu (OWNER_EMAILS) cũng là quản trị viên.
const admins = `${process.env.ADMIN_EMAILS ?? "nguyenhuulamtung@gmail.com"},${process.env.OWNER_EMAILS ?? ""}`.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const email = (process.argv[2] ?? admins[0]).trim().toLowerCase();
if (!admins.includes(email)) { console.error(`${email} không nằm trong ADMIN_EMAILS (${admins.join(", ")}).`); process.exit(1); }

// Một readline duy nhất cho cả hai câu hỏi; ký tự gõ vào không hiện ra màn hình.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let prompt = "";
rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(prompt); };
const lines = rl[Symbol.asyncIterator]();
async function ask(q) {
  prompt = q;
  rl.output.write(q);
  const { value = "" } = await lines.next();
  rl.output.write("\n");
  return value;
}

const pw = await ask("Mật khẩu mới (ít nhất 8 ký tự): ");
const again = await ask("Nhập lại mật khẩu: ");
rl.close();
if (pw.length < 8) { console.error("Mật khẩu quá ngắn."); process.exit(1); }
if (again !== pw) { console.error("Hai lần nhập không khớp."); process.exit(1); }

const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(pw.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
const hash = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "synchro.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
// Cùng bộ chạy migration với máy chủ: cơ sở dữ liệu mới thì tạo đủ bảng, cơ sở dữ liệu có sẵn thì chỉ thêm phần còn thiếu.
migrate(db, { dir: fileURLToPath(new URL("../db/migrations/", import.meta.url)) });

const now = Date.now();
const u = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
const id = u?.id ?? crypto.randomUUID();
if (u) db.prepare("UPDATE users SET password_hash = ?, email_verified = 1, status = 'active' WHERE id = ?").run(hash, id);
else db.prepare("INSERT INTO users (id, email, name, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(id, email, email.split("@")[0], hash, now);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
db.prepare("INSERT INTO audit (at, action, actor_id, actor_email, target_id, target_email, detail) VALUES (?, ?, ?, ?, ?, ?, 'cli')").run(now, u ? "admin_password_reset" : "admin_created", id, email, id, email);
console.log(u ? `Đã đặt lại mật khẩu cho ${email}.` : `Đã tạo tài khoản quản trị ${email}.`);
