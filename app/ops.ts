// Theo dõi vận hành ngay trong sản phẩm, không dùng dịch vụ ngoài: lỗi máy chủ, thư gửi lỗi, CLI bị từ chối đăng nhập, khởi động lại (chỉ chạy ở máy chủ).
// Trang Cài đặt → Sức khỏe hệ thống đọc từ đây; lỗi đã làm sạch (opsredact.ts), giữ 30 ngày, không có nội dung chat.
// Sao lưu và watchdog chạy bằng root ngoài tiến trình web nên ghi kết quả ở OPS_DIR (web chỉ đọc): scripts/backup.sh, scripts/watchdog.sh.
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, ADMIN_EMAILS, getSetting, setSetting } from "./authstore";
import { formatArgs, redactLine } from "./opsredact";

export const OPS_DIR = () => process.env.SYNCHRO_OPS_DIR || "/var/lib/synchro-ops";
const DAY = 86_400_000, KEEP = 30 * DAY;
export type OpsKind = "error" | "mail_ok" | "mail_fail" | "cli_auth" | "boot" | "parser" | "csp";
export type OpsRow = { id: number; at: number; first_at: number; kind: OpsKind; source: string; detail: string; n: number; user_id: string | null };

let ready = false, writes = 0, windowAt = 0, inWindow = 0;
function t() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS ops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, first_at INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
        detail TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, user_id TEXT);
      CREATE INDEX IF NOT EXISTS ops_kind_at ON ops_events(kind, at)`);
    d.prepare("DELETE FROM ops_events WHERE at < ?").run(Date.now() - KEEP);
    ready = true;
  }
  return d;
}

/** Ghi một sự kiện. Không bao giờ ném lỗi; lỗi giống hệt trong vòng một giờ gộp thành một dòng có bộ đếm; tối đa 120 lần ghi mỗi phút để vòng lặp lỗi không làm đầy đĩa. */
export function opsEvent(kind: OpsKind, source: string, detail = "", uid?: string | null) {
  try {
    const now = Date.now();
    if (now - windowAt > 60_000) { windowAt = now; inWindow = 0; }
    if (++inWindow > 120) return;
    const d = t(), text = redactLine(detail), who = uid ?? null;
    const r = d.prepare("UPDATE ops_events SET at = ?, n = n + 1 WHERE id = (SELECT id FROM ops_events WHERE kind = ? AND source = ? AND detail = ? AND COALESCE(user_id, '') = ? AND at > ? ORDER BY id DESC LIMIT 1)").run(now, kind, source, text, who ?? "", now - 3_600_000);
    if (!r.changes) d.prepare("INSERT INTO ops_events (at, first_at, kind, source, detail, user_id) VALUES (?, ?, ?, ?, ?, ?)").run(now, now, kind, source, text, who);
    if (++writes % 500 === 0) d.prepare("DELETE FROM ops_events WHERE at < ? OR id <= (SELECT MAX(id) FROM ops_events) - 20000").run(now - KEEP);
  } catch { /* cơ sở dữ liệu lỗi: không còn nơi ghi, và không được làm hỏng lời gọi đang chạy */ }
}

/** Mọi console.error của máy chủ thành sự kiện "error", kèm lỗi không ai bắt. uncaughtExceptionMonitor không đổi cách Node xử lý lỗi (vẫn dừng như cũ). */
export function captureConsole() {
  const g = globalThis as unknown as { __synchroOpsConsole?: boolean };
  if (g.__synchroOpsConsole) return;
  g.__synchroOpsConsole = true;
  const orig = console.error.bind(console);
  let inside = false;
  console.error = (...a: unknown[]) => {
    orig(...a);
    if (inside) return;
    inside = true;
    try {
      const s = formatArgs(a);
      // Lỗi gửi thư đã ghi riêng ở mailer.ts, kèm loại thư.
      if (!s.startsWith("[mail]")) opsEvent("error", /^\[([\w-]+)\]/.exec(s)?.[1] ?? "server", s.replace(/^\[[\w-]+\]\s*/, ""));
    } finally { inside = false; }
  };
  process.on("uncaughtExceptionMonitor", (e) => opsEvent("error", "uncaught", formatArgs([e])));
  opsEvent("boot", "web", process.env.npm_package_version ?? "");
}

const readJson = <T>(f: string): T | null => { try { return JSON.parse(fs.readFileSync(f, "utf8")) as T; } catch { return null; } };
function diskOf(p: string) {
  try { const v = fs.statfsSync(p); return { path: p, freeMB: Math.round((v.bavail * v.bsize) / 1048576), totalMB: Math.round((v.blocks * v.bsize) / 1048576) }; } catch { return null; }
}
const fileMB = (f: string) => { try { return Math.round(fs.statSync(f).size / 1048576); } catch { return 0; } };
const sum = (sql: string, ...a: unknown[]) => { try { return (db().prepare(sql).get(...a) as { n: number | null }).n ?? 0; } catch { return 0; } };

export type BackupStatus = { ok: boolean; at: number; lastOkAt?: number; snapshot?: string; sizeMB?: number; integrity?: string; tables?: number; users?: number; hasKey?: boolean; keyOk?: boolean | null; uploads?: number; missingUploads?: number; checked?: number; corrupt?: number; offsite?: boolean; offsiteOk?: boolean; error?: string };
export type WatchdogState = { at: number; fails: number; status: string; lastRestartAt?: number; restarts24?: number };
type WatchdogEvent = { at: number; event: string; detail?: string };

const BACKUP_STALE_MS = 36 * 3_600_000;
const WATCHDOG_STALE_MS = 5 * 60_000;
const DISK_WARN_MB = 5000, DISK_CRIT_MB = 2000;

export type Problem = { code: string; level: "crit" | "warn"; n?: number; at?: number };

/** Những gì quản trị viên cần xử lý. Mã để giao diện viết thành câu theo ngôn ngữ; cũng là khóa để cảnh báo không lặp lại. */
export function opsProblems(r: Pick<ReturnType<typeof opsSnapshot>, "disks" | "mail" | "cli" | "backup" | "watchdog" | "errors24">): Problem[] {
  const out: Problem[] = [];
  const low = Math.min(...r.disks.map((x) => x.freeMB), Infinity);
  if (low < DISK_CRIT_MB) out.push({ code: "disk_crit", level: "crit", n: low }); else if (low < DISK_WARN_MB) out.push({ code: "disk_low", level: "warn", n: low });
  if (r.mail.failed24 && (!r.mail.lastOkAt || (r.mail.lastFailAt ?? 0) > r.mail.lastOkAt)) out.push({ code: "mail_failing", level: "crit", n: r.mail.failed24, at: r.mail.lastFailAt ?? undefined });
  if (!r.backup) out.push({ code: "backup_none", level: "warn" });
  else if (!r.backup.ok) out.push({ code: "backup_failed", level: "crit", at: r.backup.at });
  else if (Date.now() - (r.backup.lastOkAt ?? r.backup.at) > BACKUP_STALE_MS) out.push({ code: "backup_stale", level: "crit", at: r.backup.lastOkAt ?? r.backup.at });
  else if (r.backup.integrity !== "ok") out.push({ code: "backup_integrity", level: "crit", at: r.backup.at });
  if (r.backup?.missingUploads) out.push({ code: "backup_uploads", level: "warn", n: r.backup.missingUploads });
  if (r.backup?.corrupt) out.push({ code: "backup_corrupt", level: "crit", n: r.backup.corrupt });
  if (r.backup?.keyOk === false) out.push({ code: "backup_key", level: "crit" });
  if (!r.watchdog || Date.now() - r.watchdog.at > WATCHDOG_STALE_MS) out.push({ code: "watchdog_off", level: "warn", at: r.watchdog?.at });
  else if (r.watchdog.restarts24) out.push({ code: "watchdog_restarts", level: "warn", n: r.watchdog.restarts24 });
  const users = r.cli.reduce((a, c) => Math.max(a, c.users24), 0);
  if (users >= 3) out.push({ code: "cli_auth", level: "crit", n: users });
  if (r.errors24 >= 200) out.push({ code: "errors_many", level: "warn", n: r.errors24 });
  return out;
}

/** Số liệu đồng bộ (không gọi mạng): dùng cho cả trang sức khỏe lẫn bộ cảnh báo chạy nền. */
export function opsSnapshot() {
  const d = t(), now = Date.now();
  const ops = OPS_DIR();
  const disks = [{ key: "data", ...diskOf(DATA_DIR) }, { key: "workspace", ...diskOf("/srv/synchro-ws") }].filter((x) => x.path) as { key: string; path: string; freeMB: number; totalMB: number }[];
  const seen = new Set<string>();
  const uniqueDisks = disks.filter((x) => { const k = `${x.freeMB}/${x.totalMB}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const count = (kind: OpsKind, since: number) => sum("SELECT COALESCE(SUM(n), 0) n FROM ops_events WHERE kind = ? AND at > ?", kind, since);
  const lastAt = (kind: OpsKind) => (d.prepare("SELECT MAX(at) a FROM ops_events WHERE kind = ?").get(kind) as { a: number | null }).a;
  const failures = d.prepare("SELECT at, source, detail, n FROM ops_events WHERE kind = 'mail_fail' ORDER BY at DESC LIMIT 12").all() as Pick<OpsRow, "at" | "source" | "detail" | "n">[];
  const mail = { sent24: count("mail_ok", now - DAY), sent7: count("mail_ok", now - 7 * DAY), failed24: count("mail_fail", now - DAY), failed7: count("mail_fail", now - 7 * DAY), lastOkAt: lastAt("mail_ok"), lastFailAt: lastAt("mail_fail"), failures, smtp: !!process.env.SMTP_URL };
  const cliRows = d.prepare(`SELECT source, COUNT(DISTINCT CASE WHEN at > ? THEN user_id END) users24, COUNT(DISTINCT user_id) users7, COALESCE(SUM(CASE WHEN at > ? THEN n ELSE 0 END), 0) n24, COALESCE(SUM(n), 0) n7, MAX(at) last
    FROM ops_events WHERE kind = 'cli_auth' AND at > ? GROUP BY source ORDER BY last DESC`).all(now - DAY, now - DAY, now - 7 * DAY) as { source: string; users24: number; users7: number; n24: number; n7: number; last: number }[];
  const cliRecent = d.prepare(`SELECT o.at, o.source, o.n, u.email FROM ops_events o LEFT JOIN users u ON u.id = o.user_id WHERE o.kind = 'cli_auth' ORDER BY o.at DESC LIMIT 12`).all() as { at: number; source: string; n: number; email: string | null }[];
  const errors = d.prepare("SELECT id, at, first_at, source, detail, n FROM ops_events WHERE kind = 'error' ORDER BY at DESC LIMIT 40").all() as Omit<OpsRow, "kind" | "user_id">[];
  const csp = d.prepare("SELECT at, source, detail, n FROM ops_events WHERE kind = 'csp' ORDER BY at DESC LIMIT 8").all() as Pick<OpsRow, "at" | "source" | "detail" | "n">[];
  const backup = readJson<BackupStatus>(path.join(ops, "backup-status.json"));
  const watchdog = readJson<WatchdogState>(path.join(ops, "watchdog-state.json"));
  let wdEvents: WatchdogEvent[] = [];
  try { wdEvents = fs.readFileSync(path.join(ops, "watchdog.jsonl"), "utf8").trim().split("\n").slice(-10).reverse().flatMap((l) => { try { return [JSON.parse(l) as WatchdogEvent]; } catch { return []; } }); } catch { /* chưa có */ }
  const runs24 = sum("SELECT COUNT(*) n FROM runs WHERE created_at > ?", now - DAY), runsFailed24 = sum("SELECT COUNT(*) n FROM runs WHERE status = 'error' AND created_at > ?", now - DAY);
  return {
    now, disks: uniqueDisks, mail, cli: cliRows, cliRecent, errors, errors24: count("error", now - DAY), csp, backup, watchdog, wdEvents, runs24, runsFailed24,
    boots24: count("boot", now - DAY), lastBootAt: lastAt("boot"),
    storage: {
      dbMB: fileMB(path.join(DATA_DIR, "synchro.db")) + fileMB(path.join(DATA_DIR, "synchro.db-wal")),
      uploadsMB: Math.round(sum("SELECT SUM(s) n FROM (SELECT MAX(size) s FROM file_owners GROUP BY file_id)") / 1048576),
      outputsMB: Math.round(sum("SELECT SUM(size) n FROM outputs") / 1048576),
    },
  };
}

// Tiếng Việt, tiếng Anh: Hộp thư tự dịch theo ngôn ngữ của người đọc, còn email gửi cả hai vì máy chủ không biết ngôn ngữ của quản trị viên.
const ALERT_TEXT: Record<string, [string, string, string, string]> = {
  disk_crit: ["Đĩa máy chủ sắp đầy", "Đĩa còn rất ít chỗ trống: Synchro từ chối tệp mới và cơ sở dữ liệu có thể ngừng ghi.", "The server disk is almost full", "Very little disk space is left: Synchro refuses new files and the database may stop writing."],
  mail_failing: ["Gửi email đang lỗi", "Thư gần nhất gửi không được, nên email đặt lại mật khẩu và xác minh có thể không tới người dùng.", "Email sending is failing", "The latest emails could not be sent, so password reset and verification emails may not reach people."],
  backup_failed: ["Sao lưu lỗi", "Lần sao lưu gần nhất thất bại.", "Backup failed", "The last backup failed."],
  backup_stale: ["Sao lưu đã quá cũ", "Không có bản sao lưu mới trong hơn 36 giờ.", "Backups are out of date", "No new backup in over 36 hours."],
  backup_corrupt: ["Bản sao lưu có tệp hỏng", "Một số tệp tải lên trong bản sao lưu mới nhất không khớp mã băm: nội dung đã hỏng.", "The backup contains damaged files", "Some uploaded files in the newest backup don't match their checksum: their content is damaged."],
  backup_key: ["Bản sao lưu không giải mã được", "Khóa mã hóa trong bản sao lưu mới nhất không mở được dữ liệu đã mã hóa: khôi phục từ bản này sẽ mất token và đăng nhập đã lưu.", "The backup can't be decrypted", "The encryption key in the newest backup can't open the encrypted data: restoring from it would lose saved tokens and sign-ins."],
  backup_integrity: ["Bản sao lưu mới nhất không đạt kiểm tra", "Bản sao lưu mới nhất không qua kiểm tra toàn vẹn.", "The newest backup failed its check", "The newest backup failed its integrity check."],
  cli_auth: ["Nhiều người bị từ chối đăng nhập gói AI", "Từ 3 người trở lên bị hãng từ chối đăng nhập trong 24 giờ qua. Có thể CLI hoặc hãng vừa đổi gì đó.", "Several people were refused an AI plan sign-in", "Three or more people were refused sign-in by a vendor in the last 24 hours. A CLI or vendor may have changed something."],
};

/** Chạy nền mỗi giờ: vấn đề nghiêm trọng mới thì báo vào Hộp thư và email của quản trị viên, mỗi loại tối đa một lần mỗi ngày. */
export async function opsWatch() {
  const list = opsProblems(opsSnapshot()).filter((p) => p.level === "crit" && ALERT_TEXT[p.code]);
  if (!list.length) return;
  const fresh = list.filter((p) => Date.now() - Number(getSetting(`ops:alert:${p.code}`, "0")) > DAY);
  if (!fresh.length) return;
  const { addNotice } = await import("./tasks");
  const { sendMail } = await import("./mailer");
  const { opsAlertMail } = await import("./mailtpl");
  const base = (process.env.APP_URL ?? "https://synchro.net.nz").replace(/\/$/, "");
  const admins = db().prepare(`SELECT id, email, name FROM users WHERE email_verified = 1 AND status = 'active' AND email IN (${[...ADMIN_EMAILS].map(() => "?").join(",") || "''"})`).all(...ADMIN_EMAILS) as { id: string; email: string; name: string }[];
  for (const p of fresh) {
    const [title, text, titleEn, textEn] = ALERT_TEXT[p.code];
    setSetting(`ops:alert:${p.code}`, String(Date.now()));
    for (const a of admins) {
      addNotice(a.id, title, `${text} Xem chi tiết ở Cài đặt → Sức khỏe hệ thống.`, "settings:Health");
      // Thư lỗi thì báo bằng thư cũng vô ích: Hộp thư ở trên là đủ.
      if (p.code !== "mail_failing") sendMail(a.email, opsAlertMail({ base, title, text, titleEn, textEn }), "alert");
    }
  }
}
