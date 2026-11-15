// authstore.stmt(sql): câu lệnh đã biên dịch được giữ lại cho đường nóng (phiên, tài khoản, cài đặt mỗi yêu cầu), không phân tích lại SQL.
// Tự chạy được, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-stmt-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

try {
  const { authstore: A } = await loadTs(["authstore"]);
  const u = A.createUser({ email: "a@stmt.test", name: "A", verified: true });

  console.log("1. Cùng câu SQL: cùng một câu lệnh");
  const s1 = A.stmt("SELECT * FROM users WHERE id = ?"), s2 = A.stmt("SELECT * FROM users WHERE id = ?");
  ok(s1 === s2, "lần gọi thứ hai dùng lại câu lệnh đã biên dịch");
  ok(A.stmt("SELECT id FROM users WHERE id = ?") !== s1, "câu SQL khác: câu lệnh khác");
  ok(s1.get(u.id).email === "a@stmt.test", "câu lệnh giữ lại vẫn chạy đúng");

  console.log("2. Đường nóng dùng câu lệnh giữ sẵn");
  const before = A.stmtCacheSize();
  for (let i = 0; i < 50; i++) { A.getUser(u.id); A.getSetting("x", "d"); A.findByEmail("a@stmt.test"); }
  const mid = A.stmtCacheSize();
  ok(mid > before, `getUser / getSetting / findByEmail dùng stmt (${before} → ${mid})`);
  for (let i = 0; i < 50; i++) { A.getUser(u.id); A.getSetting("x", "d"); }
  ok(A.stmtCacheSize() === mid, "gọi lặp lại không thêm câu lệnh mới");
  A.setSetting("x", "v1");
  ok(A.getSetting("x", "d") === "v1", "ghi rồi đọc lại cài đặt qua câu lệnh giữ sẵn");
  const src = fs.readFileSync("server/authstore.ts", "utf8"), cur = src.slice(src.indexOf("export function current("), src.indexOf("export function sessionUser("));
  ok(cur.includes("stmt(") && !cur.includes("db().prepare("), "current() (mỗi yêu cầu) không còn db().prepare");

  console.log("3. Lỗi biên dịch không được giữ, trần số câu lệnh");
  const n0 = A.stmtCacheSize();
  let threw = false; try { A.stmt("SELECT * FROM bang_khong_co"); } catch { threw = true; }
  ok(threw && A.stmtCacheSize() === n0, "bảng không có: ném lỗi như db().prepare, không giữ gì");
  for (let i = 0; i < 520; i++) A.stmt(`SELECT ${i} AS n`);
  ok(A.stmtCacheSize() <= 500, "tối đa 500 câu lệnh", A.stmtCacheSize());
  ok(A.stmt("SELECT 7 AS n").get().n === 7, "vẫn chạy đúng sau khi bỏ bớt");

  console.log("4. Nhanh hơn biên dịch lại mỗi lần");
  const d = A.db(), N = 20000;
  let t = performance.now(); for (let i = 0; i < N; i++) d.prepare("SELECT * FROM users WHERE id = ?").get(u.id); const raw = performance.now() - t;
  t = performance.now(); for (let i = 0; i < N; i++) A.stmt("SELECT * FROM users WHERE id = ?").get(u.id); const cached = performance.now() - t;
  console.log(`    ${N} lần: prepare mỗi lần ${raw.toFixed(1)} ms, stmt ${cached.toFixed(1)} ms`);
  ok(cached < raw, "stmt nhanh hơn", { raw, cached });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
