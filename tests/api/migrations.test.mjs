// Bộ chạy migration (db/migrate.mjs, db/migrations): cơ sở dữ liệu trống, cơ sở dữ liệu đúng lược đồ của mã cũ (tests/fixtures/schema-v0.sql),
// cơ sở dữ liệu cũ hơn nữa (thiếu cột, thiếu bảng), chạy hai lần, phiên bản mới hơn mã, hai tiến trình cùng lúc, lỗi thì quay lại.
// Tự chạy được, không cần máy chủ.
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listMigrations, migrate, sqlTargets } from "../../db/migrate.mjs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 800)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-mig-"));
const quiet = { log: () => {} };
const FIXTURE = fs.readFileSync("tests/fixtures/schema-v0.sql", "utf8");
const list = listMigrations();
const LATEST = list.at(-1).n;
const version = (d) => d.pragma("user_version", { simple: true });

// Lược đồ so được: mỗi bảng các cột theo thứ tự (tên, kiểu, NOT NULL, mặc định, khóa chính, cột ẩn), mỗi chỉ mục các cột và UNIQUE / partial,
// trigger theo câu SQL (bỏ IF NOT EXISTS, gộp khoảng trắng).
const shape = (d, { order = true } = {}) => {
  const o = {};
  for (const r of d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    if (r.type === "table") {
      const cols = d.prepare(`PRAGMA table_xinfo("${r.name}")`).all().map(({ cid, ...c }) => c);
      o[`table:${r.name}`] = order ? cols : cols.sort((a, b) => a.name.localeCompare(b.name));
    } else if (r.type === "index") {
      const meta = d.prepare(`PRAGMA index_list("${r.tbl_name}")`).all().find((x) => x.name === r.name);
      o[`index:${r.name}`] = { on: r.tbl_name, cols: d.prepare(`PRAGMA index_xinfo("${r.name}")`).all().map((c) => [c.name, c.desc, c.coll, c.key]), unique: meta.unique, partial: meta.partial };
    } else o[`${r.type}:${r.name}`] = r.sql.replace(/\s+/g, " ").replace(/ IF NOT EXISTS/i, "");
  }
  return o;
};
const diff = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: ${JSON.stringify(a[k])?.slice(0, 200)} ≠ ${JSON.stringify(b[k])?.slice(0, 200)}`);
  return out;
};
const v0 = () => { const d = new Database(":memory:"); d.exec(FIXTURE); return d; };
// Lược đồ của mã đã phát hành (001, 002) cộng các bảng mới mà các tệp sau 002 tạo: đó là lược đồ mọi cơ sở dữ liệu
// phải có sau khi migrate.
const ADDED = list.filter((m) => m.n > 2);
const full = () => {
  const d = v0();
  for (const m of ADDED) if (m.kind === "sql") d.exec(fs.readFileSync(m.file, "utf8"));
  return d;
};
const want = shape(full());
const countOf = (sh, t) => Object.keys(sh).filter((k) => k.startsWith(`${t}:`)).length;

// Mỗi bảng vài dòng: giá trị theo kiểu cột, cột khóa ngoại tới users trỏ đúng tài khoản có thật.
const fill = (d, rows = 2) => {
  d.pragma("foreign_keys = OFF"); d.pragma("ignore_check_constraints = ON");
  let n = 0;
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    const info = d.prepare(`PRAGMA table_info("${name}")`).all();
    for (let i = 0; i < rows; i++) {
      const vals = info.map((c) => (c.name === "id" && name === "usage_config" ? 1 : /INT|REAL/i.test(c.type) ? ++n : `${name}-${c.name}-${++n}`));
      d.prepare(`INSERT INTO "${name}" (${info.map((c) => `"${c.name}"`).join(",")}) VALUES (${info.map(() => "?").join(",")})`).run(...vals);
      if (name === "usage_config") break;
    }
  }
  d.pragma("foreign_keys = ON"); d.pragma("ignore_check_constraints = OFF");
};
// Dấu dữ liệu của mỗi bảng: số dòng và nội dung các cột có sẵn trước khi migrate.
const snapshot = (d, only) => {
  const o = {};
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    if (only && !only[name]) continue;
    const cols = (only?.[name] ?? d.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name)).map((c) => `"${c}"`).join(",");
    o[name] = JSON.stringify(d.prepare(`SELECT ${cols} FROM "${name}" ORDER BY rowid`).all());
  }
  return o;
};

try {
  console.log("1. Tệp migration đúng quy tắc (db/migrations/README.md)");
  ok(list.length >= 2 && list.every((m, i) => m.n === i + 1), `đánh số liền từ 001 (${list.map((m) => m.name).join(", ")})`);
  const ALLOWED = /^(CREATE (TABLE|INDEX|UNIQUE INDEX|TRIGGER) IF NOT EXISTS|DROP INDEX IF EXISTS)\b/i;
  for (const m of list) {
    const raw = fs.readFileSync(m.file, "utf8");
    if (m.kind === "sql") {
      // Bỏ chú thích, chuỗi và thân trigger (BEGIN … END) rồi tách câu theo dấu chấm phẩy.
      const s = raw.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''").replace(/\bBEGIN\b[\s\S]*?\bEND\b/gi, "BEGIN END");
      const stmts = s.split(";").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean);
      const bad = stmts.filter((x) => !ALLOWED.test(x));
      ok(!bad.length && stmts.length > 0, `${m.name}: ${stmts.length} câu, chỉ CREATE … IF NOT EXISTS / DROP INDEX IF EXISTS`, bad.join(" | "));
      const { create } = sqlTargets(raw);
      ok(create.length === new Set(create).size, `${m.name}: không khai trùng tên`, create.filter((k, i) => create.indexOf(k) !== i));
    } else {
      const cols = JSON.parse(raw);
      const bad = cols.filter((c) => !/^\w+$/.test(c.table) || !/^\w+$/.test(c.column) || /PRIMARY|UNIQUE|REFERENCES/i.test(c.def) || (/NOT NULL/i.test(c.def) && !/DEFAULT\s+('[^']*'|-?\d+(\.\d+)?)/i.test(c.def)));
      ok(cols.length > 0 && !bad.length, `${m.name}: ${cols.length} cột, cột nào cũng cho NULL hoặc có DEFAULT hằng số`, bad);
    }
  }
  ok(countOf(want, "table") >= 80 && countOf(want, "index") >= 40 && countOf(want, "trigger") >= 1, `lược đồ mẫu đủ lớn (${countOf(want, "table")} bảng, ${countOf(want, "index")} chỉ mục, ${countOf(want, "trigger")} trigger)`);

  console.log("2. Cơ sở dữ liệu trống");
  {
    const d = new Database(path.join(tmp, "empty.db"));
    const r = migrate(d, quiet);
    ok(r.from === 0 && r.to === LATEST && version(d) === LATEST, `user_version 0 → ${LATEST}`, r);
    const dd = diff(shape(d), want);
    ok(!dd.length, "lược đồ giống hệt lược đồ của mã cũ (tên, kiểu, NOT NULL, mặc định, khóa chính, thứ tự cột, chỉ mục, trigger)", dd.join("\n"));
    const again = migrate(d, quiet);
    ok(again.applied.length === 0 && version(d) === LATEST, "chạy lần hai: không làm gì", again);
    d.close();
  }

  console.log("3. Cơ sở dữ liệu đang chạy (lược đồ của mã cũ, user_version 0, có dữ liệu)");
  {
    const file = path.join(tmp, "current.db");
    const d = new Database(file);
    d.exec(FIXTURE);
    fill(d);
    const before = snapshot(d), sqlBefore = d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
    const logs = [];
    const r = migrate(d, { log: (s) => logs.push(s) });
    const old = r.applied.filter((a) => !ADDED.some((m) => m.name === a.name));
    ok(r.to === LATEST && r.applied.length === list.length && old.every((a) => a.changed === 0),
      "mọi tệp của mã đã phát hành có sẵn: chỉ ghi số phiên bản", r);
    ok(ADDED.every((m) => r.applied.find((a) => a.name === m.name)?.changed > 0), "tệp mới tạo bảng của nó", r);
    const targets = (m) => sqlTargets(fs.readFileSync(m.file, "utf8")).create.map((k) => k.split(":")[1]);
    const newNames = new Set(ADDED.flatMap((m) => (m.kind === "sql" ? targets(m) : [])));
    const tableOf = (name) => name.replace(/^sqlite_autoindex_(\w+)_\d+$/, "$1");
    const sqlAfter = d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all()
      .filter((x) => !newNames.has(tableOf(x.name)));
    ok(JSON.stringify(sqlAfter) === JSON.stringify(sqlBefore), "sqlite_master của các bảng có sẵn không đổi một ký tự");
    const after = Object.fromEntries(Object.entries(snapshot(d)).filter(([k]) => !newNames.has(k)));
    ok(JSON.stringify(after) === JSON.stringify(before), "dữ liệu mọi bảng y nguyên");
    ok(logs.length === 1 && /chỉ ghi số phiên bản/.test(logs[0]), "ghi nhật ký một dòng vì đây là cơ sở dữ liệu có sẵn", logs);
    d.close();
  }

  console.log("4. Cơ sở dữ liệu cũ hơn: thiếu cột thêm sau, thiếu bảng mô-đun chưa từng dùng, còn chỉ mục đã bỏ");
  {
    const d = new Database(path.join(tmp, "ancient.db"));
    d.exec(FIXTURE);
    fill(d);
    const added = JSON.parse(fs.readFileSync(list.find((m) => m.kind === "columns").file, "utf8"));
    for (const { table, column } of added) d.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
    const gone = ["skill_studio_user", "email_changes", "plugin_meta", "run_events", "vec_items"];
    d.exec("DROP TRIGGER runs_drop_events");
    for (const t of gone) d.exec(`DROP TABLE "${t}"`);
    d.exec("CREATE TABLE vec_items (scope TEXT NOT NULL, owner TEXT NOT NULL, item TEXT NOT NULL, user_id TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL, hash TEXT NOT NULL, src_at INTEGER NOT NULL, vec BLOB, at INTEGER NOT NULL, PRIMARY KEY (scope, item)); CREATE INDEX vec_items_owner ON vec_items(owner)");
    d.prepare("INSERT INTO vec_items VALUES ('s', 'o', 'i', 'u', 'm', 3, 'h', 1, NULL, 2)").run();
    const kept = Object.fromEntries(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => [name, d.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name)]));
    const before = snapshot(d, kept);
    const r = migrate(d, quiet);
    ok(r.to === LATEST && r.applied.every((a) => a.changed > 0), "cả hai tệp đều chạy", r);
    ok(r.applied.find((a) => a.name.endsWith(".columns.json"))?.changed === added.length, `thêm lại đủ ${added.length} cột`, r);
    const dd = diff(shape(d, { order: false }), shape(full(), { order: false }));
    ok(!dd.length, "mọi bảng, cột (kiểu, NOT NULL, mặc định), chỉ mục, trigger như lược đồ mới; chỉ mục cũ vec_items_owner đã bỏ", dd.join("\n"));
    const after = snapshot(d, kept);
    ok(JSON.stringify(after) === JSON.stringify(before), "dữ liệu có sẵn y nguyên", Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => `${k}: ${before[k].slice(0, 150)} → ${after[k]?.slice(0, 150)}`).join("\n"));
    const t = d.prepare("SELECT browser, memory, retries, engine FROM tasks LIMIT 1").get();
    ok(t.browser === "auto" && t.memory === 1 && t.retries === 0 && t.engine === "chat", "dòng cũ nhận giá trị mặc định của cột mới", t);
    ok(d.prepare("SELECT settings FROM connectors LIMIT 1").get().settings === "{}" && d.prepare("SELECT auto_tag FROM plugins LIMIT 1").get().auto_tag === 1, "connectors.settings = '{}', plugins.auto_tag = 1 cho dòng cũ");
    d.prepare("INSERT INTO run_events VALUES (?, 1, 1, 'k', 't')").run(d.prepare("SELECT id FROM runs LIMIT 1").get().id);
    d.prepare("DELETE FROM runs").run();
    ok(d.prepare("SELECT COUNT(*) AS n FROM run_events").get().n === 0, "trigger runs_drop_events tạo lại và chạy");
    d.close();
  }

  console.log("5. Phiên bản mới hơn mã (đã quay lại bản trước)");
  {
    const d = new Database(path.join(tmp, "newer.db"));
    migrate(d, quiet);
    d.pragma("user_version = 99");
    const logs = [];
    let r, err;
    try { r = migrate(d, { log: (s) => logs.push(s) }); } catch (e) { err = e; }
    ok(!err && r.to === 99 && version(d) === 99, "không lỗi, giữ nguyên phiên bản 99", err?.message ?? r);
    ok(logs.some((s) => /99/.test(s)), "ghi nhật ký", logs);
    d.close();
  }

  console.log("6. Lỗi giữa chừng: quay lại hết");
  {
    const dir = path.join(tmp, "bad-migrations");
    fs.mkdirSync(dir);
    fs.copyFileSync(list[0].file, path.join(dir, list[0].name));
    fs.writeFileSync(path.join(dir, "002_bad.sql"), "CREATE TABLE IF NOT EXISTS zz_new (a TEXT);\nCREATE TABLE IF NOT EXISTS zz_broken (;\n");
    const d = new Database(path.join(tmp, "bad.db"));
    let err;
    try { migrate(d, { dir, ...quiet }); } catch (e) { err = e; }
    ok(!!err, "ném lỗi", "không lỗi");
    ok(version(d) === 0 && d.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n === 0, "user_version vẫn 0, không còn bảng nào của lượt chạy hỏng (kể cả của 001)", { v: version(d), n: d.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n });
    ok(!d.inTransaction, "không kẹt giao dịch");
    d.close();
  }

  console.log("7. Hai tiến trình cùng migrate một cơ sở dữ liệu (deploy xanh/lam)");
  {
    const file = path.join(tmp, "race.db");
    // Như cơ sở dữ liệu thật: tệp đã có sẵn ở chế độ WAL, hai tiến trình mở cùng lúc.
    { const d = new Database(file); d.pragma("journal_mode = WAL"); d.close(); }
    const code = `import Database from "better-sqlite3"; import { migrate } from ${JSON.stringify(pathToFileURL(path.resolve("db/migrate.mjs")).href)};
      const d = new Database(${JSON.stringify(file)}); d.pragma("busy_timeout = 5000"); d.pragma("journal_mode = WAL");
      await new Promise((r) => setTimeout(r, Math.max(0, ${Date.now() + 1500} - Date.now())));
      console.log(JSON.stringify(migrate(d, { log: () => {} })));`;
    const one = () => new Promise((res) => {
      let out = "";
      const p = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd() });
      p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (out += b));
      p.on("close", (c) => res({ c, out }));
    });
    const rs = await Promise.all([one(), one()]);
    ok(rs.every((r) => r.c === 0), "cả hai tiến trình chạy xong không lỗi", rs);
    const applied = rs.flatMap((r) => { try { return JSON.parse(r.out.trim().split("\n").pop()).applied; } catch { return []; } });
    ok(applied.length === list.length, `mỗi tệp chạy đúng một lần (${applied.length}/${list.length})`, rs);
    const d = new Database(file);
    ok(version(d) === LATEST && !diff(shape(d), want).length, "phiên bản mới nhất, lược đồ đúng", diff(shape(d), want));
    d.close();
  }

  console.log("8. Máy chủ: db() chạy migration khi mở");
  {
    process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k"; process.env.SKILLS_DIR = path.join(tmp, "data", "skills");
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    const { authstore: A, tasks: T, "runs/store-sqlite": RS } = await loadTs(["authstore", "tasks", "runs/store-sqlite"]);
    const d = A.db();
    ok(version(d) === LATEST, `data/synchro.db ở phiên bản ${LATEST}`, version(d));
    ok(!diff(shape(d), want).length, "lược đồ đúng", diff(shape(d), want).join("\n"));
    const u = A.createUser({ email: "m@mig.test", name: "M", verified: true });
    ok(!!d.prepare("SELECT 1 FROM settings WHERE key = 'verify_since'").get() && !!d.prepare("SELECT 1 FROM settings WHERE key = 'admin_email_healed'").get(), "việc sửa dữ liệu trong db() vẫn chạy (verify_since, admin_email_healed)");
    ok(Array.isArray(T.listTasks(u.id)), "mô-đun dùng bảng của mình mà không tự tạo bảng (tasks)");
    ok(typeof RS.sweepRuns === "function" ? (RS.sweepRuns(), true) : true, "dọn lượt cũ của runs vẫn chạy");
    ok(A.getSetting("run_events_migrated", "") === "1", "chuyển sự kiện cũ một lần (run_events_migrated) vẫn chạy khi mở bảng runs");
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
