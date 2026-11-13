// Sao lưu liên tục cơ sở dữ liệu (data/synchro.db) lên Cloudflare R2 bằng Litestream. Chỉ chạy ở máy chủ.
// Quản trị viên dán Account ID, bucket, khóa truy cập R2 ở Cài đặt → Sức khỏe hệ thống → Sao lưu liên tục (docs/backup-r2.md).
// Khóa bí mật mã hóa như khóa API (providers.ts), chỉ đưa cho tiến trình litestream qua biến môi trường; tệp cấu hình (quyền 0600) không chứa khóa.
// Máy chủ tự chạy "litestream replicate" khi đã bật và có tệp chạy (workspace/setup.sh cài bản cố định, kiểm sha256), chạy lại khi đổi cấu hình
// hoặc khi tiến trình chết, dừng khi máy chủ tắt. Bản sao lưu hằng đêm (scripts/backup.sh) vẫn chạy như cũ: đây là lớp thêm, mất máy vẫn còn dữ liệu.
// "Kiểm tra khôi phục": khôi phục bản mới nhất trên R2 vào tệp tạm, chạy PRAGMA integrity_check và đếm dòng các bảng chính, so với dữ liệu đang chạy.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { AuthError, DATA_DIR, db, getSetting, setSetting } from "./authstore";
import { openSecret, sealSecret } from "./providers";
import { isPrimary } from "./role";

const SEC = 1000, MIN = 60 * SEC;
export const DB_PATH = () => path.join(DATA_DIR, "synchro.db");
const DIR = () => path.join(DATA_DIR, "litestream");
const CONFIG = () => path.join(DIR(), "litestream.yml");
const PIDFILE = () => path.join(DIR(), "replicate.pid");
/** Bảng đếm dòng khi kiểm tra khôi phục: tài khoản, phiên, nhật ký, lượt chạy và cài đặt là thứ mất là đau nhất. */
const COUNT_TABLES = ["users", "sessions", "identities", "settings", "code_sessions", "brain_notes", "artifacts", "tasks", "runs", "audit"];

type Stored = { enabled: boolean; accountId: string; bucket: string; accessKeyId: string; secret: string; prefix: string };
function stored(): Stored {
  let s: Partial<Stored> = {};
  try { s = JSON.parse(getSetting("backup_r2", "null")) ?? {}; } catch {}
  return { enabled: !!s.enabled, accountId: s.accountId ?? "", bucket: s.bucket ?? "", accessKeyId: s.accessKeyId ?? "", secret: s.secret ?? "", prefix: s.prefix || "synchro" };
}
/** Kiểm thử và chạy giả lập: thay R2 bằng một thư mục (litestream hỗ trợ bản sao dạng tệp), không cần khóa. Không có ở máy chủ thật. */
const fileReplica = () => process.env.SYNCHRO_LITESTREAM_FILE_REPLICA || "";
const configured = (s = stored()) => !!fileReplica() || !!(s.accountId && s.bucket && s.accessKeyId && s.secret);

/** Tệp chạy litestream: LITESTREAM_BIN, hoặc nơi workspace/setup.sh cài, hoặc trong PATH. null: máy này chưa cài. */
export function litestreamBin(): string | null {
  const cands = [process.env.LITESTREAM_BIN, "/usr/local/bin/litestream", "/usr/bin/litestream", ...(process.env.PATH ?? "").split(path.delimiter).map((d) => d && path.join(d, "litestream"))].filter(Boolean) as string[];
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* không có */ } }
  return null;
}

// ---- cấu hình ----
const yq = (s: string) => JSON.stringify(s); // chuỗi YAML an toàn (JSON là YAML hợp lệ)
/** Tệp cấu hình cho litestream: không có khóa bí mật (đi qua biến môi trường của tiến trình con). */
export function renderConfig(s: Stored, dbPath = DB_PATH(), replicaDir = fileReplica()): string {
  const replica = replicaDir
    ? [`      type: file`, `      path: ${yq(replicaDir)}`]
    : [`      type: s3`, `      bucket: ${yq(s.bucket)}`, `      path: ${yq(s.prefix)}`, `      endpoint: ${yq(`https://${s.accountId}.r2.cloudflarestorage.com`)}`, `      region: auto`, `      force-path-style: true`];
  return [
    "# Do Synchro tạo (app/litestream.ts), sửa ở Cài đặt → Sức khỏe hệ thống. Khóa truy cập đi qua biến môi trường, không nằm ở đây.",
    "logging:", "  level: info", "  type: json",
    "dbs:", `  - path: ${yq(dbPath)}`, "    replica:", ...replica, "      sync-interval: 1s", "",
  ].join("\n");
}
/** Biến môi trường cho tiến trình con: chỉ những gì litestream cần, không mang theo khóa khác của máy chủ. */
export function childEnv(s: Stored): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) as NodeJS.ProcessEnv;
  if (!fileReplica() && s.secret) { env.LITESTREAM_ACCESS_KEY_ID = s.accessKeyId; env.LITESTREAM_SECRET_ACCESS_KEY = openSecret(s.secret); }
  return env;
}
function writeConfig(s: Stored) {
  fs.mkdirSync(DIR(), { recursive: true, mode: 0o700 });
  fs.chmodSync(DIR(), 0o700);
  const tmp = `${CONFIG()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, renderConfig(s), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CONFIG());
}

// ---- tiến trình ----
type LogLine = { at: number; level: string; msg: string };
type St = { child: ChildProcess | null; startedAt: number | null; restarts: number; errors: LogLine[]; lastLog: LogLine | null; timer: ReturnType<typeof setTimeout> | null; backoff: number; stopping: boolean; hooked: boolean; status?: { at: number; v: ReplStatus } };
const st = ((globalThis as { __synchroLitestream?: St }).__synchroLitestream ??= { child: null, startedAt: null, restarts: 0, errors: [], lastLog: null, timer: null, backoff: 5 * SEC, stopping: false, hooked: false });
const note = (level: string, msg: string) => {
  const l = { at: Date.now(), level, msg: msg.replace(/(secret|key)[^\s"]*["=:]\s*"?[^\s",}]+/gi, "$1=…").slice(0, 400) };
  st.lastLog = l;
  if (level === "ERROR" || level === "WARN") { st.errors.push(l); st.errors.splice(0, st.errors.length - 10); }
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Tiến trình của lần chạy trước (máy chủ bị giết đột ngột) còn sống: dừng, không để hai tiến trình cùng sao lưu một cơ sở dữ liệu. */
function killStale() {
  try {
    const pid = Number(fs.readFileSync(PIDFILE(), "utf8"));
    if (pid > 1 && pid !== st.child?.pid && alive(pid)) process.kill(pid, "SIGTERM");
  } catch { /* không có */ }
  try { fs.rmSync(PIDFILE(), { force: true }); } catch { /* bỏ qua */ }
}
function hook() {
  if (st.hooked) return;
  st.hooked = true;
  // Máy chủ tắt (pm2 restart, deploy): dừng litestream cùng lúc. "exit" chạy đồng bộ nên gửi tín hiệu ngay tại đây.
  process.on("exit", () => { try { st.child?.kill("SIGTERM"); } catch { /* đã dừng */ } });
}

export function startLitestream(): { ok: boolean; reason?: string } {
  const s = stored(), bin = litestreamBin();
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (!configured(s)) return { ok: false, reason: "not_configured" };
  if (!bin) return { ok: false, reason: "no_binary" };
  if (st.child) return { ok: true };
  hook();
  killStale();
  writeConfig(s);
  st.stopping = false;
  const child = spawn(bin, ["replicate", "-config", CONFIG()], { env: childEnv(s), stdio: ["ignore", "pipe", "pipe"] });
  st.child = child; st.startedAt = Date.now();
  if (child.pid) try { fs.writeFileSync(PIDFILE(), String(child.pid), { mode: 0o600 }); } catch { /* không ghi được thì thôi */ }
  let buf = "";
  const onData = (d: Buffer) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const j = JSON.parse(line) as { level?: string; msg?: string; error?: string; err?: string }; note(String(j.level ?? "INFO").toUpperCase(), [j.msg, j.error ?? j.err].filter(Boolean).join(": ")); }
      catch { note(/error|fail/i.test(line) ? "ERROR" : "INFO", line); }
    }
  };
  child.stdout?.on("data", onData); child.stderr?.on("data", onData);
  child.on("error", (e) => note("ERROR", `không chạy được litestream: ${e.message}`));
  child.on("exit", (code, sig) => {
    if (st.child === child) { st.child = null; st.startedAt = null; }
    try { if (Number(fs.readFileSync(PIDFILE(), "utf8")) === child.pid) fs.rmSync(PIDFILE(), { force: true }); } catch { /* bỏ qua */ }
    if (st.stopping) return;
    note("ERROR", `litestream dừng (${sig ?? `mã ${code}`})`);
    // Chết ngoài ý muốn: chạy lại, chờ lâu dần (tối đa 5 phút) để lỗi cấu hình không làm máy chủ quay vòng.
    st.restarts++;
    clearTimeout(st.timer ?? undefined);
    st.timer = setTimeout(() => { st.timer = null; startLitestream(); }, st.backoff);
    st.timer.unref?.();
    st.backoff = Math.min(st.backoff * 2, 5 * MIN);
  });
  // Chạy ổn một phút thì đặt lại thời gian chờ.
  setTimeout(() => { if (st.child === child) st.backoff = 5 * SEC; }, MIN).unref?.();
  return { ok: true };
}

export async function stopLitestream() {
  st.stopping = true;
  clearTimeout(st.timer ?? undefined); st.timer = null;
  const c = st.child;
  if (!c) return;
  await new Promise<void>((ok) => {
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* đã dừng */ } ok(); }, 10 * SEC);
    c.once("exit", () => { clearTimeout(t); ok(); });
    try { c.kill("SIGTERM"); } catch { clearTimeout(t); ok(); }
  });
  st.child = null; st.startedAt = null;
}
export async function restartLitestream() { await stopLitestream(); st.backoff = 5 * SEC; st.status = undefined; return startLitestream(); }
/** Gọi một lần khi máy chủ khởi động (instrumentation.ts). */
export function startOnBoot() { try { const r = startLitestream(); if (r.ok) console.log("[backup] litestream đang sao lưu liên tục"); } catch (e) { console.error("[backup]", e); } }

// ---- cài đặt của quản trị viên ----
const ACCOUNT_RE = /^[0-9a-f]{32}$/i, BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, KEY_ID_RE = /^[A-Za-z0-9]{16,128}$/, SECRET_RE = /^[A-Za-z0-9/+=_-]{16,256}$/, PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** secret "": giữ khóa đã lưu. Bật khi chưa đủ thông tin thì từ chối. Đổi gì cũng chạy lại tiến trình theo cấu hình mới. */
export async function saveLitestream(v: { enabled?: unknown; accountId?: unknown; bucket?: unknown; accessKeyId?: unknown; secret?: unknown; prefix?: unknown; clear?: unknown }) {
  if (v.clear === true) { setSetting("backup_r2", "null"); await stopLitestream(); return; }
  const cur = stored(), next = { ...cur };
  const str = (x: unknown) => String(x ?? "").trim();
  if (v.accountId !== undefined) { const x = str(v.accountId).toLowerCase(); if (x && !ACCOUNT_RE.test(x)) throw new AuthError("Account ID của Cloudflare gồm 32 ký tự 0-9, a-f.", 400); next.accountId = x; }
  if (v.bucket !== undefined) { const x = str(v.bucket); if (x && !BUCKET_RE.test(x)) throw new AuthError("Tên bucket R2 chỉ gồm chữ thường, số và dấu gạch ngang (3 đến 63 ký tự).", 400); next.bucket = x; }
  if (v.accessKeyId !== undefined) { const x = str(v.accessKeyId); if (x && !KEY_ID_RE.test(x)) throw new AuthError("Access Key ID không hợp lệ.", 400); next.accessKeyId = x; }
  if (typeof v.secret === "string" && v.secret.trim()) { const x = v.secret.trim(); if (!SECRET_RE.test(x)) throw new AuthError("Secret Access Key không hợp lệ.", 400); next.secret = sealSecret(x); }
  if (v.prefix !== undefined) { const x = str(v.prefix) || "synchro"; if (!PREFIX_RE.test(x) || x.includes("..")) throw new AuthError("Thư mục trong bucket không hợp lệ.", 400); next.prefix = x; }
  if (typeof v.enabled === "boolean") next.enabled = v.enabled;
  if (next.enabled && !configured(next)) throw new AuthError("Hãy điền đủ Account ID, bucket, Access Key ID và Secret Access Key trước khi bật.", 400);
  setSetting("backup_r2", JSON.stringify(next));
  // Deploy xanh/lam: chỉ tiến trình primary chạy litestream; bản mới chưa nhận vai thì chỉ lưu, lúc nhận vai sẽ bật theo cài đặt này.
  if (next.enabled) { if (isPrimary()) await restartLitestream(); } else await stopLitestream();
}

// ---- trạng thái ----
type ReplStatus = { localTxid: string | null; replicaTxid: string | null; lastSyncAt: number | null; walSize: string | null; error?: string };
const run = (bin: string, args: string[], env: NodeJS.ProcessEnv, ms = 30 * SEC) => new Promise<{ code: number; out: string; err: string }>((ok) => {
  execFile(bin, args, { env, timeout: ms, maxBuffer: 8 << 20 }, (e, out, err) => ok({ code: e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) }));
});
const hexN = (h: string | null) => (h ? parseInt(h, 16) : 0);
// litestream in "-" khi chưa có giao dịch nào (vừa khởi động): coi như chưa biết.
const tx = (h: unknown) => (typeof h === "string" && /^[0-9a-f]{1,16}$/i.test(h) ? h : null);
async function replStatus(): Promise<ReplStatus> {
  const bin = litestreamBin(), s = stored();
  if (!bin || !configured(s)) return { localTxid: null, replicaTxid: null, lastSyncAt: null, walSize: null };
  // Lệnh đọc cũng cần cấu hình hiện tại (kể cả khi chưa bật).
  writeConfig(s);
  const env = childEnv(s);
  const [a, b] = await Promise.all([run(bin, ["status", "-json", "-config", CONFIG(), DB_PATH()], env), run(bin, ["ltx", "-json", "-level", "all", "-config", CONFIG(), DB_PATH()], env)]);
  let localTxid: string | null = null, walSize: string | null = null, replicaTxid: string | null = null, lastSyncAt: number | null = null, error: string | undefined;
  try { const j = (JSON.parse(a.out) as { local_txid?: string; wal_size?: string }[])[0]; localTxid = tx(j?.local_txid); walSize = j?.wal_size ?? null; } catch { error = (a.err || a.out).trim().slice(0, 300) || undefined; }
  try {
    const files = JSON.parse(b.out) as { max_txid: string; timestamp: string }[];
    for (const f of files) { if (!tx(f.max_txid)) continue; if (!replicaTxid || hexN(f.max_txid) > hexN(replicaTxid)) replicaTxid = f.max_txid; const t = Date.parse(f.timestamp); if (Number.isFinite(t) && (!lastSyncAt || t > lastSyncAt)) lastSyncAt = t; }
  } catch { error = error ?? ((b.err || b.out).trim().slice(0, 300) || undefined); }
  return { localTxid, replicaTxid, lastSyncAt, walSize, ...(error ? { error } : {}) };
}
/** Cho Cài đặt → Sức khỏe hệ thống. Không có khóa bí mật. Gọi R2 tối đa mỗi 20 giây. */
export async function litestreamAdmin() {
  const s = stored(), bin = litestreamBin();
  if (configured(s) && bin && (!st.status || Date.now() - st.status.at > 20 * SEC)) st.status = { at: Date.now(), v: await replStatus().catch((e) => ({ localTxid: null, replicaTxid: null, lastSyncAt: null, walSize: null, error: String((e as Error).message) })) };
  const r = configured(s) && bin ? st.status?.v ?? null : null;
  const lagTx = r?.localTxid && r.replicaTxid ? Math.max(0, hexN(r.localTxid) - hexN(r.replicaTxid)) : null;
  return {
    enabled: s.enabled, accountId: s.accountId, bucket: s.bucket, accessKeyId: s.accessKeyId, hasSecret: !!s.secret, prefix: s.prefix, testReplica: !!fileReplica(),
    binary: bin,
    running: !!st.child, pid: st.child?.pid ?? null, startedAt: st.startedAt, restarts: st.restarts,
    errors: [...st.errors].reverse(), lastLog: st.lastLog,
    localTxid: r?.localTxid ?? null, replicaTxid: r?.replicaTxid ?? null, lastSyncAt: r?.lastSyncAt ?? null, walSize: r?.walSize ?? null, statusError: r?.error ?? null,
    lagTx, lagSec: lagTx && r?.lastSyncAt ? Math.round((Date.now() - r.lastSyncAt) / 1000) : lagTx === 0 ? 0 : null,
  };
}

// ---- kiểm tra khôi phục ----
export type DrillResult = { ok: boolean; ms: number; integrity: string; sizeMB: number; txid: string | null; tables: { name: string; restored: number | null; live: number | null }[]; error?: string };
export async function restoreDrill(): Promise<DrillResult> {
  const s = stored(), bin = litestreamBin(), t0 = Date.now();
  if (!configured(s)) throw new AuthError("Chưa cấu hình sao lưu liên tục.", 400);
  if (!bin) throw new AuthError("Máy chủ chưa cài litestream. Chạy lại workspace/setup.sh trên máy chủ.", 400);
  writeConfig(s);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-restore-"));
  fs.chmodSync(dir, 0o700);
  const out = path.join(dir, `drill-${crypto.randomBytes(4).toString("hex")}.db`);
  try {
    const r = await run(bin, ["restore", "-config", CONFIG(), "-o", out, DB_PATH()], childEnv(s), 15 * MIN);
    if (r.code !== 0 || !fs.existsSync(out)) return { ok: false, ms: Date.now() - t0, integrity: "—", sizeMB: 0, txid: null, tables: [], error: (r.err || r.out).trim().split("\n").filter((l) => !/^\s*$/.test(l)).slice(-3).join(" ").slice(0, 400) || "Litestream không khôi phục được (không rõ lý do)." };
    const rd = new Database(out, { readonly: true, fileMustExist: true });
    try {
      const integrity = (rd.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]).map((x) => x.integrity_check).join("; ").slice(0, 400);
      const has = (d: Database.Database, n: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
      const cnt = (d: Database.Database, n: string) => (has(d, n) ? (d.prepare(`SELECT COUNT(*) n FROM "${n}"`).get() as { n: number }).n : null);
      const tables = COUNT_TABLES.map((n) => ({ name: n, restored: cnt(rd, n), live: cnt(db(), n) }));
      return { ok: integrity === "ok" && tables[0].restored !== null, ms: Date.now() - t0, integrity, sizeMB: Math.round(fs.statSync(out).size / 1048576 * 10) / 10, txid: st.status?.v.replicaTxid ?? null, tables };
    } finally { rd.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
