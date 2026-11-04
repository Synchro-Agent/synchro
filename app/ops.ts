// Sổ vận hành của máy chủ (không dùng dịch vụ ngoài): lỗi trình duyệt và máy chủ đã làm sạch, số lượt lỗi theo từng CLI, sao lưu gần nhất; quản trị viên xem ở Cài đặt → Quản trị,
// và nhận email khi có chuyện (qua mailer.ts, cần DNS thư đã khai báo). Không lưu mã người dùng, tin nhắn hay nội dung trả lời.
import fs from "node:fs";
import path from "node:path";
import { ADMIN_EMAILS, DATA_DIR, db, getSetting, setSetting } from "./authstore";
import { redact } from "./opsredact";

const H = 3600_000, KEEP_EVENTS = 500, KEEP_HOURS = 24 * 8;
/** Bản sao lưu cũ hơn mức này (cron hằng đêm, chừa 2 giờ) là có chuyện. */
export const BACKUP_MAX_AGE_H = 26;
/** Tệp scripts/backup.sh chạm vào sau mỗi bản tốt: nằm trong thư mục dữ liệu vì thư mục sao lưu chỉ root đọc được. */
const BACKUP_MARK = () => path.join(DATA_DIR, ".backup-ok");

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS ops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, msg TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ops_runs (hour INTEGER NOT NULL, engine TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0, auth INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, engine));`);
    ready = true;
  }
  return d;
}

export function recordOps(kind: "browser" | "server", msg: unknown) {
  try {
    const d = init();
    d.prepare("INSERT INTO ops_events (at, kind, msg) VALUES (?, ?, ?)").run(Date.now(), kind, redact(msg, 800));
    d.prepare("DELETE FROM ops_events WHERE id <= (SELECT MAX(id) FROM ops_events) - ?").run(KEEP_EVENTS);
  } catch (e) { console.error("[ops]", e); }
}

/** "sub-claude/sonnet" → "claude"; khóa API "openai/…" → "openai". */
export const engineOf = (model: unknown) => { const m = typeof model === "string" ? model : ""; return (m.split("/")[0] || "unknown").replace(/^sub-/, "").slice(0, 24); };

/** Kết quả một lượt chạy nền. Hết hạn mức và lỗi do yêu cầu (4xx) không phải sự cố; đăng nhập gói hỏng tính riêng. */
export function noteRun(kind: string, model: unknown, http: number, json: unknown) {
  if (kind !== "chat") return;
  try {
    const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
    if (j.cancelled || j.planLimit) return;
    const auth = !!j.relogin, fail = !auth && http >= 500, ok = http >= 200 && http < 300;
    if (!auth && !fail && !ok) return;
    const engine = engineOf(j.relogin ? `sub-${String(j.relogin)}/` : j.route ?? j.model ?? model), hour = Math.floor(Date.now() / H);
    const d = init();
    d.prepare("INSERT INTO ops_runs (hour, engine, ok, fail, auth) VALUES (?, ?, ?, ?, ?) ON CONFLICT(hour, engine) DO UPDATE SET ok = ok + excluded.ok, fail = fail + excluded.fail, auth = auth + excluded.auth").run(hour, engine, ok ? 1 : 0, fail ? 1 : 0, auth ? 1 : 0);
    d.prepare("DELETE FROM ops_runs WHERE hour < ?").run(hour - KEEP_HOURS);
  } catch (e) { console.error("[ops]", e); }
}

export function backupAge(now = Date.now()): number | null {
  try { return (now - fs.statSync(BACKUP_MARK()).mtimeMs) / H; } catch { return null; }
}

export type OpsStatus = {
  backup: { ageHours: number | null; stale: boolean };
  engines: { engine: string; ok: number; fail: number; auth: number }[];
  errors: { at: number; kind: string; msg: string }[];
  errors24h: number;
};

export function opsStatus(now = Date.now()): OpsStatus {
  const d = init(), age = backupAge(now), hour = Math.floor(now / H);
  return {
    backup: { ageHours: age === null ? null : Math.round(age * 10) / 10, stale: age !== null && age > BACKUP_MAX_AGE_H },
    engines: d.prepare("SELECT engine, SUM(ok) ok, SUM(fail) fail, SUM(auth) auth FROM ops_runs WHERE hour >= ? GROUP BY engine ORDER BY engine").all(hour - 24) as OpsStatus["engines"],
    errors: d.prepare("SELECT at, kind, msg FROM ops_events ORDER BY id DESC LIMIT 30").all() as OpsStatus["errors"],
    errors24h: (d.prepare("SELECT COUNT(*) n FROM ops_events WHERE at >= ?").get(now - 24 * H) as { n: number }).n,
  };
}

/** Những việc đáng báo ngay, tính từ số liệu một giờ qua. Tách riêng để kiểm thử. */
export function alertsFrom(s: { backupAge: number | null; neverBackedUpH: number; hour: { engine: string; ok: number; fail: number; auth: number }[]; errorsHour: number }): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (s.backupAge !== null && s.backupAge > BACKUP_MAX_AGE_H) out.push({ key: "backup", text: `Bản sao lưu gần nhất đã ${Math.round(s.backupAge)} giờ. Xem /var/log/synchro-backup.log.` });
  if (s.backupAge === null && s.neverBackedUpH > BACKUP_MAX_AGE_H) out.push({ key: "backup", text: `Sau ${Math.round(s.neverBackedUpH)} giờ vẫn chưa ghi nhận bản sao lưu nào. Kiểm tra cron của scripts/backup.sh.` });
  for (const e of s.hour) {
    if (e.auth >= 3) out.push({ key: `auth:${e.engine}`, text: `${e.engine}: ${e.auth} lượt báo hỏng đăng nhập gói trong một giờ qua.` });
    if (e.fail >= 5 && e.fail >= e.ok) out.push({ key: `fail:${e.engine}`, text: `${e.engine}: ${e.fail} lượt lỗi, ${e.ok} lượt thành công trong một giờ qua.` });
  }
  if (s.errorsHour >= 30) out.push({ key: "errors", text: `${s.errorsHour} lỗi giao diện và máy chủ trong một giờ qua.` });
  return out;
}

const REPEAT = 12 * H;
let lastCheck = 0;
/** Gọi theo nhịp bộ hẹn giờ; 5 phút mới tính một lần, mỗi loại cảnh báo gửi tối đa 12 giờ một lần. */
export function checkOps(now = Date.now()) {
  if (now - lastCheck < 5 * 60_000) return;
  lastCheck = now;
  try {
    const d = init(), hour = Math.floor(now / H);
    const first = Number(getSetting("ops:first-seen", "0")) || (setSetting("ops:first-seen", String(now)), now);
    const list = alertsFrom({
      backupAge: backupAge(now), neverBackedUpH: process.env.MAIL_CAPTURE_DIR ? 0 : (now - first) / H,
      hour: d.prepare("SELECT engine, SUM(ok) ok, SUM(fail) fail, SUM(auth) auth FROM ops_runs WHERE hour >= ? GROUP BY engine").all(hour - 1) as OpsStatus["engines"],
      errorsHour: (d.prepare("SELECT COUNT(*) n FROM ops_events WHERE at >= ?").get(now - H) as { n: number }).n,
    }).filter((a) => now - Number(getSetting(`ops:alert:${a.key}`, "0")) > REPEAT);
    if (!list.length) return;
    for (const a of list) { setSetting(`ops:alert:${a.key}`, String(now)); console.error(`[ops] ${a.text}`); }
    void import("./mailer").then(({ sendMail }) => {
      const text = `${list.map((a) => `- ${a.text}`).join("\n")}\n\nChi tiết ở Cài đặt → Quản trị → Tình trạng hệ thống.`;
      for (const to of ADMIN_EMAILS) sendMail(to, { subject: `Synchro cần bạn xem: ${list[0].text.slice(0, 70)}`, text, html: `<pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` });
    }).catch((e) => console.error("[ops]", e));
  } catch (e) { console.error("[ops]", e); }
}
