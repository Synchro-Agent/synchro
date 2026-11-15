#!/usr/bin/env node
// Khóa R2 của sao lưu liên tục (Cài đặt → Sức khỏe hệ thống) cho ops/backup-offsite.sh. Chạy bằng web user, không bao giờ bằng root:
//   runuser -u synchro -- node ops/r2-creds.mjs <thư mục dữ liệu>
// In 5 dòng (Account ID, bucket, Access Key ID, Secret Access Key, thư mục) ra stdout cho root đọc qua ống, không qua tham số dòng lệnh.
// Mỗi dòng phải khớp đúng định dạng như server/litestream.ts kiểm khi lưu: root nhận dữ liệu từ web user nên không tin chuỗi lạ (xuống dòng, ký tự shell).
// Chưa cấu hình hoặc chưa bật: thoát mã 3, không in gì.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const Database = require("better-sqlite3");
const DATA = process.argv[2] || process.env.DATA_DIR || path.join(process.cwd(), "data");
const env = (() => { try { return fs.readFileSync(path.join(process.cwd(), ".env.production"), "utf8"); } catch { return ""; } })();
const fromEnv = (k) => process.env[k] || (new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");

// Cùng cách giải mã với server/providers.ts (AES-256-GCM, khóa từ DATA_KEY hoặc data/secret.key).
function master() {
  let raw = fromEnv("DATA_KEY");
  if (!raw) raw = fs.readFileSync(path.join(DATA, "secret.key"), "utf8").trim();
  return crypto.createHash("sha256").update(`synchro-api:${raw}`).digest();
}
function open(box) {
  const [iv, tag, enc] = box.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", master(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

const db = new Database(path.join(DATA, "synchro.db"), { readonly: true, fileMustExist: true });
let s;
try { s = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'backup_r2'").get()?.value ?? "null"); } finally { db.close(); }
if (!s || !s.enabled || !s.accountId || !s.bucket || !s.accessKeyId || !s.secret) process.exit(3);
const out = [s.accountId, s.bucket, s.accessKeyId, open(s.secret), s.prefix || "synchro"];
const RE = [/^[0-9a-f]{32}$/i, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, /^[A-Za-z0-9]{16,128}$/, /^[A-Za-z0-9/+=_-]{16,256}$/, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/];
if (!out.every((v, i) => RE[i].test(v)) || out[4].includes("..")) { console.error("Cấu hình R2 không đúng định dạng."); process.exit(4); }
process.stdout.write(out.join("\n") + "\n");
