// Chỉ mục cho các truy vấn chạy thường xuyên: mỗi mô-đun tạo chỉ mục của mình khi mở bảng (CREATE INDEX IF NOT EXISTS), và kế hoạch truy vấn
// dùng đúng chỉ mục đó thay vì quét cả bảng. Tự chạy được, không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-idx-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

try {
  const { authstore: A, brain: BR, usage: US, runs: RU, outputs: OU, chatstore: CS } = await loadTs(["authstore", "brain", "usage", "runs", "outputs", "chatstore"]);
  const u = A.createUser({ email: "a@idx.test", name: "A", verified: true });
  BR.getNote(u.id, "x"); US.getConfig(); RU.sweepRuns(); OU.sweepOutputs(); CS.changesSince(u.id, 0);
  const d = A.db();
  const cols = (idx) => d.prepare(`PRAGMA index_info("${idx}")`).all().map((c) => c.name).join(",");
  const plan = (sql, ...a) => d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...a).map((r) => r.detail).join(" | ");

  console.log("1. Chỉ mục có đúng cột");
  const want = {
    brain_notes_updated: "user_id,updated_at", usage_events_at: "at", runs_updated: "updated_at", runs_conv: "user_id,conv",
    outputs_name: "user_id,name,created_at", sessions_expires: "expires_at", user_items_meta: "user_id,rev,kind,id,upd,deleted,size",
  };
  for (const [idx, c] of Object.entries(want)) ok(cols(idx) === c, `${idx} (${c})`, cols(idx));

  console.log("2. Truy vấn dùng chỉ mục");
  ok(/USING (COVERING )?INDEX usage_events_at/.test(plan("DELETE FROM usage_events WHERE at < ?", 1)), "dọn usage_events cũ theo at", plan("SELECT id FROM usage_events WHERE at < ?", 1));
  ok(/USING (COVERING )?INDEX runs_updated/.test(plan("SELECT id FROM runs WHERE updated_at < ?", 1)), "dọn runs cũ theo updated_at", plan("SELECT id FROM runs WHERE updated_at < ?", 1));
  ok(/USING (COVERING )?INDEX runs_conv/.test(plan("SELECT id FROM runs WHERE user_id = ? AND conv = ?", "u", "c")), "lượt của một đoạn chat", plan("SELECT id FROM runs WHERE user_id = ? AND conv = ?", "u", "c"));
  ok(/USING (COVERING )?INDEX sessions_expires/.test(plan("SELECT id FROM sessions WHERE expires_at < ?", 1)), "phiên hết hạn", plan("SELECT id FROM sessions WHERE expires_at < ?", 1));
  ok(/USING (COVERING )?INDEX outputs_name/.test(plan("SELECT id FROM outputs WHERE user_id = ? AND name = ? ORDER BY created_at DESC", "u", "n")), "tệp kết quả theo tên", plan("SELECT id FROM outputs WHERE user_id = ? AND name = ? ORDER BY created_at DESC", "u", "n"));
  ok(/USING (COVERING )?INDEX brain_notes_updated/.test(plan("SELECT id FROM brain_notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20", "u")), "ghi chú mới sửa gần nhất", plan("SELECT id FROM brain_notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20", "u"));
  const meta = plan("SELECT kind, id, upd, rev, deleted, size FROM user_items WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT 2000", "u", 0);
  ok(/USING COVERING INDEX user_items_meta/.test(meta), "danh sách thay đổi đồng bộ chỉ đọc chỉ mục, không mở dòng có data", meta);

  console.log("3. Mở lại không lỗi (IF NOT EXISTS)");
  const n = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index'").get().n;
  d.exec(fs.readFileSync("db/schema.sql", "utf8"));
  ok(d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index'").get().n === n, "chạy lại schema.sql không thêm chỉ mục trùng");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
