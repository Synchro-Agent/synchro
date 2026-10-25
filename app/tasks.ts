// Tác vụ nền và lịch chạy (chỉ chạy ở máy chủ): người dùng hẹn một yêu cầu chạy một lần, mỗi giờ, mỗi ngày hoặc mỗi tuần.
// Đến giờ, bộ hẹn giờ tạo một lượt chạy bền (runs.ts) như một lượt chat bình thường (có skill, connector, chạy code theo quyền);
// kết quả vào Hộp thư. Giờ hẹn tính theo múi giờ của người tạo. Mỗi lần đến hạn chỉ chạy một lần (giành lượt bằng câu lệnh UPDATE có điều kiện).
import crypto from "node:crypto";
import { db, getUser } from "./authstore";
import { getRun, startRun } from "./runs";

export type Schedule = { kind: "once" | "hourly" | "daily" | "weekly"; time?: string; weekday?: number; tz: string };
export type TaskRow = { id: string; owner: string; title: string; prompt: string; schedule: string; model: string | null; enabled: number; next_run_at: number | null; last_run_at: number | null; created_at: number };
export type PublicTask = Omit<TaskRow, "schedule" | "enabled" | "owner"> & { schedule: Schedule; enabled: boolean; runs: number };
export const TASK_LIMITS = { perUser: 30, prompt: 8000, title: 120, minHourlyGapMs: 55 * 60_000 };

export class TaskError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new TaskError(m, status); };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL,
      model TEXT, enabled INTEGER NOT NULL DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(enabled, next_run_at);
      CREATE TABLE IF NOT EXISTS task_runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS task_runs_owner ON task_runs(owner, at)`);
    ready = true;
  }
  return d;
}

// ---------------------------------------------------------------- giờ theo múi giờ người dùng
const validTz = (tz: unknown) => { try { if (typeof tz === "string" && tz.length < 64) { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } } catch {} return "Asia/Ho_Chi_Minh"; };
// Độ lệch (phút) của múi giờ so với UTC tại thời điểm t.
function offsetMin(tz: string, t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000);
}
// Giờ địa phương (năm, tháng, ngày, giờ, phút ở múi giờ tz) → thời điểm UTC.
function localToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, mo, d, h, mi);
  const t = guess - offsetMin(tz, guess) * 60_000;
  return guess - offsetMin(tz, t) * 60_000;
}
const parts = (tz: string, t: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
};

/** Lần chạy kế tiếp sau thời điểm `after` (null: không còn lần nào, ví dụ tác vụ một lần đã chạy). */
export function nextRun(s: Schedule, after: number, ranOnce = false): number | null {
  if (s.kind === "once") return ranOnce ? null : after;
  if (s.kind === "hourly") return after + 60 * 60_000;
  const [hh, mm] = (s.time ?? "08:00").split(":").map(Number);
  const now = parts(s.tz, after);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(now.y, now.mo, now.d + add));
    const t = localToUtc(s.tz, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (t <= after) continue;
    if (s.kind === "weekly" && parts(s.tz, t).wd !== (s.weekday ?? 1)) continue;
    return t;
  }
  return null;
}

function cleanSchedule(x: unknown): Schedule {
  const o = (x ?? {}) as Partial<Schedule>;
  const kind = o.kind === "hourly" || o.kind === "daily" || o.kind === "weekly" ? o.kind : "once";
  const time = typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : "08:00";
  const weekday = Number.isInteger(o.weekday) && (o.weekday as number) >= 0 && (o.weekday as number) <= 6 ? (o.weekday as number) : 1;
  return { kind, ...(kind === "daily" || kind === "weekly" ? { time } : {}), ...(kind === "weekly" ? { weekday } : {}), tz: validTz(o.tz) };
}

const pub = (r: TaskRow, runs = 0): PublicTask => {
  const { schedule, enabled, owner: _o, ...rest } = r;
  return { ...rest, schedule: JSON.parse(schedule), enabled: !!enabled, runs };
};

export function listTasks(uid: string): PublicTask[] {
  const d = init();
  const n = new Map((d.prepare("SELECT task_id, COUNT(*) AS n FROM task_runs WHERE owner = ? GROUP BY task_id").all(uid) as { task_id: string; n: number }[]).map((x) => [x.task_id, x.n]));
  return (d.prepare("SELECT * FROM tasks WHERE owner = ? ORDER BY created_at DESC").all(uid) as TaskRow[]).map((r) => pub(r, n.get(r.id) ?? 0));
}

export function createTask(uid: string, x: { title?: unknown; prompt?: unknown; schedule?: unknown; model?: unknown }) {
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : fail("Tác vụ cần có tên.");
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt ? x.prompt.trim() : fail("Yêu cầu của tác vụ trống hoặc quá dài (tối đa 8.000 ký tự).");
  const d = init();
  if ((d.prepare("SELECT COUNT(*) AS n FROM tasks WHERE owner = ?").get(uid) as { n: number }).n >= TASK_LIMITS.perUser) fail(`Mỗi tài khoản có tối đa ${TASK_LIMITS.perUser} tác vụ.`);
  const s = cleanSchedule(x.schedule);
  const now = Date.now();
  const id = "task_" + crypto.randomBytes(8).toString("base64url");
  const model = typeof x.model === "string" && x.model.length <= 120 ? x.model : null;
  d.prepare("INSERT INTO tasks (id, owner, title, prompt, schedule, model, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(id, uid, title, prompt, JSON.stringify(s), model, nextRun(s, now), now);
  return pub(d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
}

export function updateTask(uid: string, id: string, x: { title?: unknown; prompt?: unknown; schedule?: unknown; enabled?: unknown; model?: unknown }) {
  const d = init();
  const r = d.prepare("SELECT * FROM tasks WHERE id = ? AND owner = ?").get(id, uid) as TaskRow | undefined;
  if (!r) return fail("Không tìm thấy tác vụ.", 404);
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : r.title;
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt ? x.prompt.trim() : r.prompt;
  const s = x.schedule !== undefined ? cleanSchedule(x.schedule) : (JSON.parse(r.schedule) as Schedule);
  const enabled = typeof x.enabled === "boolean" ? x.enabled : !!r.enabled;
  const model = typeof x.model === "string" && x.model.length <= 120 ? x.model : r.model;
  // Đổi lịch hoặc bật lại thì tính lại lần chạy kế tiếp từ bây giờ.
  const next = enabled ? (x.schedule !== undefined || !r.enabled ? nextRun(s, Date.now(), s.kind === "once" && !!r.last_run_at && x.schedule === undefined) : r.next_run_at) : r.next_run_at;
  d.prepare("UPDATE tasks SET title = ?, prompt = ?, schedule = ?, enabled = ?, model = ?, next_run_at = ? WHERE id = ?").run(title, prompt, JSON.stringify(s), enabled ? 1 : 0, model, next, id);
  return pub(d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
}

export function deleteTask(uid: string, id: string) {
  const d = init();
  const ok = d.prepare("DELETE FROM tasks WHERE id = ? AND owner = ?").run(id, uid).changes > 0;
  if (ok) d.prepare("DELETE FROM task_runs WHERE task_id = ?").run(id);
  return ok;
}

// ---------------------------------------------------------------- chạy
const SYSTEM = "Bạn là trợ lý của Synchro đang chạy một tác vụ nền theo lịch người dùng đã hẹn. Người dùng không ở đó để trả lời câu hỏi: hãy tự làm trọn vẹn, ngắn gọn, có tiêu đề rõ ràng, nêu điểm chính trước. Khi thiếu dữ liệu thì nói rõ thiếu gì thay vì bịa. Trình bày kết quả trực tiếp bằng Markdown (tiêu đề, gạch đầu dòng, bảng), không đặt vào artifact trừ khi yêu cầu là làm trang web, ứng dụng hay văn bản hành chính.";
function launch(r: TaskRow): string | null {
  const user = getUser(r.owner);
  if (!user || user.status !== "active") return null;
  const runId = startRun(user, "chat", { system: SYSTEM, messages: [{ role: "user", content: r.prompt }], skills: true, max_tokens: 4000, ...(r.model ? { model: r.model } : {}), feature: "chat", conv: `task-${r.id}` }, `task-${r.id}`);
  init().prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at) VALUES (?, ?, ?, ?, ?)").run(runId, r.id, r.owner, r.title, Date.now());
  return runId;
}

/** Chạy ngay (nút "Chạy ngay"), không đổi lịch. */
export function runNow(uid: string, id: string) {
  const r = init().prepare("SELECT * FROM tasks WHERE id = ? AND owner = ?").get(id, uid) as TaskRow | undefined;
  if (!r) return fail("Không tìm thấy tác vụ.", 404);
  const run = launch(r);
  if (!run) return fail("Tài khoản không còn hoạt động.", 403);
  init().prepare("UPDATE tasks SET last_run_at = ? WHERE id = ?").run(Date.now(), id);
  return run;
}

/** Một nhịp của bộ hẹn giờ: chạy các tác vụ đến hạn. Mỗi tác vụ được "giành" trước khi chạy để không bao giờ chạy hai lần. */
export function tick(now = Date.now()) {
  const d = init();
  const due = d.prepare("SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 20").all(now) as TaskRow[];
  let n = 0;
  for (const r of due) {
    const s = JSON.parse(r.schedule) as Schedule;
    // Máy chủ tắt lâu bỏ lỡ nhiều lần: chỉ chạy một lần rồi hẹn lần kế tiếp tính từ bây giờ.
    const next = nextRun(s, Math.max(now, r.next_run_at ?? now), true);
    const claimed = d.prepare("UPDATE tasks SET next_run_at = ?, last_run_at = ?, enabled = ? WHERE id = ? AND next_run_at = ?").run(next, now, next === null ? 0 : 1, r.id, r.next_run_at).changes === 1;
    if (claimed && launch(r)) n++;
  }
  return n;
}

const g = globalThis as unknown as { __synchroTasks?: ReturnType<typeof setInterval> };
/** Bật bộ hẹn giờ (gọi một lần lúc máy chủ khởi động). */
export function startScheduler(everyMs = 30_000) {
  if (g.__synchroTasks) return;
  g.__synchroTasks = setInterval(() => {
    try { const n = tick(); if (n) console.log(`[tasks] chạy ${n} tác vụ đến hạn`); } catch (e) { console.error("[tasks]", e); }
  }, everyMs);
  g.__synchroTasks.unref?.();
}

// ---------------------------------------------------------------- hộp thư
export type InboxItem = { run: string; task: string; title: string; at: number; read: boolean; status: string; text: string; error?: string };
export function inbox(uid: string, limit = 50): { items: InboxItem[]; unread: number } {
  const d = init();
  const rows = d.prepare("SELECT * FROM task_runs WHERE owner = ? ORDER BY at DESC LIMIT ?").all(uid, limit) as { run_id: string; task_id: string; title: string; at: number; read: number }[];
  const items = rows.map((r) => {
    const run = getRun(r.run_id, uid);
    const res = (run?.result ?? {}) as { text?: string; error?: string };
    return { run: r.run_id, task: r.task_id, title: r.title, at: r.at, read: !!r.read, status: run?.status ?? "error", text: String(res.text ?? "").slice(0, 60_000), ...(res.error ? { error: String(res.error) } : !run ? { error: "Kết quả đã quá 7 ngày nên không còn lưu." } : {}) };
  });
  const all: InboxItem[] = items;
  // Chỉ tính chưa đọc khi đã có kết quả (đang chạy thì chưa báo).
  const unread = all.filter((x) => !x.read && x.status !== "running").length;
  return { items: all, unread };
}
export function markRead(uid: string, runs: string[] | "all") {
  const d = init();
  if (runs === "all") d.prepare("UPDATE task_runs SET read = 1 WHERE owner = ?").run(uid);
  else for (const r of runs.slice(0, 200)) d.prepare("UPDATE task_runs SET read = 1 WHERE owner = ? AND run_id = ?").run(uid, r);
}
