// Việc tự động (tác vụ nền) và lịch chạy, chỉ chạy ở máy chủ: người dùng giao một việc chạy một lần, mỗi N giờ, mỗi ngày,
// các ngày làm việc hoặc mỗi tuần. Đến giờ, bộ hẹn giờ tạo một lượt chạy bền (runs.ts) như một lượt chat bình thường (skill, connector,
// tìm web, trình duyệt, chạy code theo quyền); kết quả vào Hộp thư. Máy người dùng tắt hay đóng trang vẫn chạy. Giờ hẹn tính theo múi giờ
// của người tạo. Mỗi lần đến hạn chỉ chạy một lần (giành lượt bằng câu lệnh UPDATE có điều kiện).
// - Trình duyệt: "auto" dùng trình duyệt của Synchro trên máy chủ, Chrome của người dùng khi cần tài khoản họ đã đăng nhập và Chrome đang
//   kết nối; "user" chờ Chrome của người dùng kết nối (tối đa CHROME_WAIT_MS) rồi mới chạy; "synchro" chỉ dùng trình duyệt của máy chủ.
// - Nhớ: mỗi lần chạy nhận kết quả các lần trước và các đề xuất đã gửi (so sánh, không lặp lại).
// - Lỗi (model quá tải, mất mạng…): tự chạy lại tối đa MAX_RETRY lần, cách RETRY_MS.
// - Đề xuất chờ duyệt (proposals): việc cần người dùng đồng ý (tạo skill, hành động có tác động, trang web mới, công cụ để "hỏi trước")
//   không tự làm mà vào Hộp thư; người dùng duyệt thì Synchro làm (automate.ts).
import "server-only";
import crypto from "node:crypto";
import { can, db, getUser } from "./authstore";
import { getRun, startRun } from "./runs";
import { extLive } from "./browserext";
import { TOO_OLD } from "../shared/taskerr";

export type Schedule = { kind: "once" | "hourly" | "daily" | "weekdays" | "weekly"; time?: string; weekday?: number; every?: number; tz: string };
export type BrowserPref = "auto" | "synchro" | "user";
/** chat: lượt chat đủ công cụ (web, trình duyệt, Chrome, connector, skill, chạy code); code: Synchro Code trong workspace riêng của việc (sửa tệp, lệnh, git, PR). */
export type Engine = "chat" | "code";
export type TaskRow = {
  id: string; owner: string; title: string; prompt: string; schedule: string; model: string | null; enabled: number; next_run_at: number | null; last_run_at: number | null; created_at: number;
  browser: BrowserPref; memory: number; wait_since: number | null; retries: number; engine: Engine;
};
export type LastRun = { run: string; status: string; at: number } | null;
export type PublicTask = Omit<TaskRow, "schedule" | "enabled" | "owner" | "memory"> & { schedule: Schedule; enabled: boolean; memory: boolean; runs: number; last: LastRun; pending: number; sid: string | null };
export const TASK_LIMITS = { perUser: 30, prompt: 8000, title: 120, minHourlyGapMs: 55 * 60_000 };
export const MAX_RETRY = 2;
const RETRY_MS = () => Number(process.env.SYNCHRO_TASK_RETRY_MS) || 10 * 60_000;
const CHROME_WAIT_MS = () => Number(process.env.SYNCHRO_CHROME_WAIT_MS) || 12 * 3600_000;

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
      CREATE INDEX IF NOT EXISTS task_runs_owner ON task_runs(owner, at);
      CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, link TEXT, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS notices_owner ON notices(owner, at);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT, run_id TEXT, kind TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT, at INTEGER NOT NULL, decided_at INTEGER);
      CREATE INDEX IF NOT EXISTS proposals_owner ON proposals(owner, status, at)`);
    // Cột thêm sau: trình duyệt, nhớ kết quả cũ, chờ Chrome, số lần thử lại; loại lượt (chạy theo lịch / làm việc đã duyệt), ghi chú, đã xét thử lại.
    const add = (table: string, cols: [string, string][]) => {
      const have = new Set((d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      for (const [c, def] of cols) if (!have.has(c)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${def}`);
    };
    add("tasks", [["browser", "TEXT NOT NULL DEFAULT 'auto'"], ["memory", "INTEGER NOT NULL DEFAULT 1"], ["wait_since", "INTEGER"], ["retries", "INTEGER NOT NULL DEFAULT 0"], ["engine", "TEXT NOT NULL DEFAULT 'chat'"]]);
    add("task_runs", [["kind", "TEXT NOT NULL DEFAULT 'run'"], ["note", "TEXT"], ["retried", "INTEGER NOT NULL DEFAULT 0"], ["result", "TEXT"]]);
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
const DAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
/** "08:00 Thứ Năm 29/10/2026" theo múi giờ của việc. */
export const localTime = (tz: string, t: number) => { const p = parts(tz, t), z = (n: number) => String(n).padStart(2, "0"); return `${z(p.h)}:${z(p.mi)} ${DAYS[p.wd]} ${z(p.d)}/${z(p.mo + 1)}/${p.y}`; };
export const scheduleDesc = (s: Schedule) => s.kind === "once" ? "một lần" : s.kind === "hourly" ? (s.every && s.every > 1 ? `mỗi ${s.every} giờ` : "mỗi giờ")
  : s.kind === "daily" ? `mỗi ngày lúc ${s.time}` : s.kind === "weekdays" ? `thứ Hai tới thứ Sáu lúc ${s.time}` : `${DAYS[s.weekday ?? 1]} hằng tuần lúc ${s.time}`;

/** Lần chạy kế tiếp sau thời điểm `after` (null: không còn lần nào, ví dụ việc một lần đã chạy). */
export function nextRun(s: Schedule, after: number, ranOnce = false): number | null {
  if (s.kind === "once") return ranOnce ? null : after;
  if (s.kind === "hourly") return after + (s.every ?? 1) * 60 * 60_000;
  const [hh, mm] = (s.time ?? "08:00").split(":").map(Number);
  const now = parts(s.tz, after);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(now.y, now.mo, now.d + add));
    const t = localToUtc(s.tz, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (t <= after) continue;
    const wd = parts(s.tz, t).wd;
    if (s.kind === "weekly" && wd !== (s.weekday ?? 1)) continue;
    if (s.kind === "weekdays" && (wd === 0 || wd === 6)) continue;
    return t;
  }
  return null;
}

export function cleanSchedule(x: unknown): Schedule {
  const o = (x ?? {}) as Partial<Schedule>;
  const kind = o.kind === "hourly" || o.kind === "daily" || o.kind === "weekdays" || o.kind === "weekly" ? o.kind : "once";
  const time = typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : "08:00";
  const weekday = Number.isInteger(o.weekday) && (o.weekday as number) >= 0 && (o.weekday as number) <= 6 ? (o.weekday as number) : 1;
  const every = Number.isInteger(o.every) && (o.every as number) >= 1 && (o.every as number) <= 12 ? (o.every as number) : 1;
  return { kind, ...(kind === "daily" || kind === "weekdays" || kind === "weekly" ? { time } : {}), ...(kind === "weekly" ? { weekday } : {}), ...(kind === "hourly" && every > 1 ? { every } : {}), tz: validTz(o.tz) };
}
export const cleanBrowser = (x: unknown, cur: BrowserPref = "auto"): BrowserPref => (x === "auto" || x === "synchro" || x === "user" ? x : cur);
export const cleanEngine = (x: unknown, cur: Engine = "chat"): Engine => (x === "chat" || x === "code" ? x : cur);
/** Mã phiên workspace (số) riêng cho mỗi việc tự động chạy bằng Synchro Code, cố định giữa các lần chạy (repo, tệp giữ lại). */
export const taskSid = (taskId: string) => "9" + String(parseInt(crypto.createHash("sha1").update(taskId).digest("hex").slice(0, 12), 16) % 1e14).padStart(14, "0");
// Synchro Code cần quyền của quản trị viên.
const codeOk = (uid: string, engine: Engine) => { if (engine === "code") { const u = getUser(uid); if (!u || !can(u, "code")) fail("Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code, nên việc này chưa chạy bằng Synchro Code được.", 403); } };

function lastOf(d: ReturnType<typeof init>, taskId: string, uid: string): LastRun {
  const r = d.prepare("SELECT run_id, at FROM task_runs WHERE task_id = ? AND kind = 'run' ORDER BY at DESC LIMIT 1").get(taskId) as { run_id: string; at: number } | undefined;
  return r ? { run: r.run_id, at: r.at, status: getRun(r.run_id, uid)?.status ?? "error" } : null;
}
const pub = (d: ReturnType<typeof init>, r: TaskRow, runs = 0, pending = 0): PublicTask => {
  const { schedule, enabled, owner, memory, ...rest } = r;
  return { ...rest, schedule: JSON.parse(schedule), enabled: !!enabled, memory: !!memory, runs, pending, last: lastOf(d, r.id, owner), sid: r.engine === "code" ? taskSid(r.id) : null };
};
const one = (d: ReturnType<typeof init>, id: string) => pub(d, d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);

export function listTasks(uid: string): PublicTask[] {
  const d = init();
  const n = new Map((d.prepare("SELECT task_id, COUNT(*) AS n FROM task_runs WHERE owner = ? AND kind = 'run' GROUP BY task_id").all(uid) as { task_id: string; n: number }[]).map((x) => [x.task_id, x.n]));
  const p = new Map((d.prepare("SELECT task_id, COUNT(*) AS n FROM proposals WHERE owner = ? AND status = 'pending' GROUP BY task_id").all(uid) as { task_id: string; n: number }[]).map((x) => [x.task_id, x.n]));
  return (d.prepare("SELECT * FROM tasks WHERE owner = ? ORDER BY created_at DESC").all(uid) as TaskRow[]).map((r) => pub(d, r, n.get(r.id) ?? 0, p.get(r.id) ?? 0));
}
export const getTask = (uid: string, id: string) => (init().prepare("SELECT * FROM tasks WHERE id = ? AND owner = ?").get(id, uid) as TaskRow | undefined) ?? null;

type TaskIn = { title?: unknown; prompt?: unknown; schedule?: unknown; model?: unknown; browser?: unknown; memory?: unknown; enabled?: unknown; engine?: unknown };
const cleanModel = (x: unknown) => (typeof x === "string" && x && x.length <= 120 ? x : null);

export function createTask(uid: string, x: TaskIn) {
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : fail("Việc tự động cần có tên.");
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt ? x.prompt.trim() : fail("Yêu cầu của việc tự động trống hoặc quá dài (tối đa 8.000 ký tự).");
  const d = init();
  if ((d.prepare("SELECT COUNT(*) AS n FROM tasks WHERE owner = ?").get(uid) as { n: number }).n >= TASK_LIMITS.perUser) fail(`Mỗi tài khoản có tối đa ${TASK_LIMITS.perUser} việc tự động.`);
  const s = cleanSchedule(x.schedule);
  const engine = cleanEngine(x.engine);
  codeOk(uid, engine);
  const now = Date.now();
  const id = "task_" + crypto.randomBytes(8).toString("base64url");
  d.prepare("INSERT INTO tasks (id, owner, title, prompt, schedule, model, enabled, next_run_at, created_at, browser, memory, engine) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)")
    .run(id, uid, title, prompt, JSON.stringify(s), cleanModel(x.model), nextRun(s, now), now, cleanBrowser(x.browser), x.memory === false ? 0 : 1, engine);
  return one(d, id);
}

export function updateTask(uid: string, id: string, x: TaskIn) {
  const d = init();
  const r = getTask(uid, id);
  if (!r) return fail("Không tìm thấy việc tự động.", 404);
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : r.title;
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt ? x.prompt.trim() : r.prompt;
  const s = x.schedule !== undefined ? cleanSchedule(x.schedule) : (JSON.parse(r.schedule) as Schedule);
  const enabled = typeof x.enabled === "boolean" ? x.enabled : !!r.enabled;
  const model = x.model !== undefined ? cleanModel(x.model) ?? r.model : r.model;
  // Đổi lịch hoặc bật lại thì tính lại lần chạy kế tiếp từ bây giờ.
  const next = enabled ? (x.schedule !== undefined || !r.enabled ? nextRun(s, Date.now(), s.kind === "once" && !!r.last_run_at && x.schedule === undefined) : r.next_run_at) : r.next_run_at;
  const engine = cleanEngine(x.engine, r.engine);
  if (engine !== r.engine) codeOk(uid, engine);
  d.prepare("UPDATE tasks SET title = ?, prompt = ?, schedule = ?, enabled = ?, model = ?, next_run_at = ?, browser = ?, memory = ?, wait_since = ?, engine = ? WHERE id = ?")
    .run(title, prompt, JSON.stringify(s), enabled ? 1 : 0, model, next, cleanBrowser(x.browser, r.browser), typeof x.memory === "boolean" ? (x.memory ? 1 : 0) : r.memory, enabled ? r.wait_since : null, engine, id);
  return one(d, id);
}

export function deleteTask(uid: string, id: string) {
  const d = init();
  const ok = d.prepare("DELETE FROM tasks WHERE id = ? AND owner = ?").run(id, uid).changes > 0;
  if (ok) { d.prepare("DELETE FROM task_runs WHERE task_id = ?").run(id); d.prepare("DELETE FROM proposals WHERE task_id = ? AND status = 'pending'").run(id); }
  return ok;
}
export function removeUserTasks(uid: string) {
  const d = init();
  for (const t of ["tasks", "task_runs", "notices", "proposals"]) d.prepare(`DELETE FROM ${t} WHERE owner = ?`).run(uid);
}

// ---------------------------------------------------------------- chạy
const SYSTEM = `Bạn là Synchro đang tự chạy một việc tự động người dùng đã giao. Việc chạy trên máy chủ của Synchro theo lịch; người dùng không ngồi xem và không trả lời câu hỏi giữa chừng (có thể họ đang ngủ, máy họ đã tắt). Kết quả của bạn vào Hộp thư để họ đọc sau.
- Tự làm trọn vẹn tới khi có kết quả dùng được: tự tra cứu (tìm trên web, trình duyệt, connector, chạy code), một nguồn lỗi hay bị chặn thì tự thử nguồn / cách khác. Không hỏi lại người dùng.
- Số liệu phải có nguồn và thời điểm (giá lúc mấy giờ, ở trang nào). Không bịa; thiếu dữ liệu thì nói rõ thiếu gì và vì sao.
- Có <previous_runs>: so sánh với các lần trước (thay đổi, xu hướng), không lặp lại mục đã báo hay đã đề xuất trước đó trừ khi có điều mới.
- Việc cần người dùng đồng ý trước (tạo skill, gửi tin nhắn / email, đăng bài, mua bán, đặt lệnh, xóa hay sửa dữ liệu của họ, thay đổi gì đó bằng tài khoản của họ): không tự làm; gọi inbox_propose để gửi đề xuất vào Hộp thư, người dùng duyệt thì Synchro làm.
- Phân tích, nhận định hay gợi ý (đầu tư, giao dịch, sức khỏe, pháp lý…): đưa thẳng gợi ý cụ thể người dùng cần (ví dụ mua / bán / giữ, vùng giá, mức cắt lỗ), kèm dữ liệu và lập luận làm căn cứ, mức độ chắc chắn và rủi ro chính trong một hai câu.
- Kết quả cuối viết bằng ngôn ngữ người dùng dùng trong yêu cầu, Markdown: dòng đầu tóm tắt điều quan trọng nhất, rồi chi tiết (tiêu đề, gạch đầu dòng, bảng), cuối cùng là mục "Nguồn". Không đặt vào artifact trừ khi việc là làm trang web, ứng dụng hay tài liệu.`;
const STATUS: Record<string, string> = { pending: "chờ duyệt", done: "đã duyệt", approved: "đã duyệt", failed: "đã duyệt nhưng lỗi", rejected: "người dùng bỏ qua" };

/** Kết quả các lần chạy trước và đề xuất đã gửi của việc này (để so sánh, không lặp lại). */
function previous(r: TaskRow) {
  const d = init();
  const tz = (JSON.parse(r.schedule) as Schedule).tz;
  const runs = (d.prepare("SELECT run_id, at FROM task_runs WHERE task_id = ? AND kind = 'run' ORDER BY at DESC LIMIT 6").all(r.id) as { run_id: string; at: number }[])
    .map((x) => ({ at: x.at, run: getRun(x.run_id, r.owner) })).filter((x) => x.run?.status === "done").slice(0, 3)
    .map((x) => `[Lần chạy lúc ${localTime(tz, x.at)}]\n${String((x.run!.result as { text?: string } | null)?.text ?? "").replace(/<artifact[\s\S]*?<\/artifact>/g, "(artifact)").slice(0, 2500)}`);
  const props = (d.prepare("SELECT kind, title, status FROM proposals WHERE task_id = ? ORDER BY at DESC LIMIT 40").all(r.id) as { kind: string; title: string; status: string }[])
    .map((p) => `- [${STATUS[p.status] ?? p.status}] ${p.kind === "skill" ? "Skill: " : ""}${p.title}`);
  if (!runs.length && !props.length) return "";
  return `<previous_runs>\n${runs.join("\n\n")}${props.length ? `\n\nĐề xuất đã gửi trước đây:\n${props.join("\n")}` : ""}\n</previous_runs>\n\n`;
}

export type TaskCtx = { id: string; browser: BrowserPref; chrome: boolean };
/** Nội dung gửi bộ chạy chat cho một lần chạy của việc (lần theo lịch, chạy ngay, thử lại) hay việc người dùng đã duyệt (action). */
function taskBody(r: TaskRow, o: { chrome: boolean; note?: string; action?: { title: string; instructions: string }; allow?: string[] }) {
  const s = JSON.parse(r.schedule) as Schedule;
  const now = Date.now();
  const n = (init().prepare("SELECT COUNT(*) AS n FROM task_runs WHERE task_id = ? AND kind = 'run'").get(r.id) as { n: number }).n;
  const ctx = `<automation>\nViệc: ${r.title}\nLịch: ${scheduleDesc(s)}\nBây giờ: ${localTime(s.tz, now)} (${s.tz})${o.action ? "" : `\nLần chạy thứ ${n + 1}`}${o.note ? `\nGhi chú: ${o.note}` : ""}${r.engine === "code" ? "\nNơi làm: workspace riêng của việc này trong Synchro Code, giữ nguyên giữa các lần chạy (repo đã clone, tệp đã tạo lần trước vẫn còn). Làm việc với repo GitHub của người dùng bằng git / gh như trong Synchro Code; thay đổi lớn thì làm trên nhánh mới và mở pull request để người dùng duyệt." : ""}\n</automation>`;
  const content = o.action
    ? `Người dùng đã duyệt đề xuất "${o.action.title}" của việc tự động này. Hãy làm đúng việc đã được duyệt dưới đây, rồi báo lại ngắn gọn đã làm gì và kết quả ra sao.\n\n${o.action.instructions}`
    : `${r.memory ? previous(r) : ""}${r.prompt}`;
  return {
    system: `${SYSTEM}\n\n${ctx}`, messages: [{ role: "user", content }], skills: true, max_tokens: 8000, web: true,
    ...(r.model ? { model: r.model } : {}), feature: "chat", conv: `task-${r.id}`,
    task: { id: r.id, browser: r.browser, chrome: o.chrome } satisfies TaskCtx,
    ...(r.engine === "code" ? { sid: taskSid(r.id), allow: o.allow ?? [] } : {}),
  };
}
function launch(r: TaskRow, o: { chrome: boolean; note?: string; action?: { title: string; instructions: string }; allow?: string[] }): string | null {
  const user = getUser(r.owner);
  if (!user || user.status !== "active") return null;
  const runId = startRun(user, r.engine === "code" ? "agent" : "chat", taskBody(r, o), `task-${r.id}`);
  init().prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at, kind, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(runId, r.id, r.owner, o.action ? `Đã duyệt: ${o.action.title}`.slice(0, 200) : r.title, Date.now(), o.action ? "action" : "run", o.note ?? null);
  return runId;
}
// Quản trị viên tắt "Your Chrome" cho tài khoản: không chờ Chrome, việc đặt dùng Chrome chạy bằng trình duyệt của Synchro.
const chromeLocked = (uid: string) => { const u = getUser(uid); return !!u && !can(u, "chrome"); };
const LOCKED_NOTE = "Quản trị viên chưa cho phép tài khoản này dùng Chrome của người dùng: làm bằng trình duyệt của Synchro.";
const chromeOn = async (uid: string) => !chromeLocked(uid) && (await extLive(uid).catch(() => ({ connected: false }))).connected;

/** Người dùng đã tự chạy lại (nút "Chạy lại" / "Chạy ngay"): các lần lỗi trước của việc này không được bộ hẹn giờ tự chạy lại nữa,
 *  nếu không việc có tác dụng phụ (gửi tin, đăng bài) sẽ chạy hai lần. retried = 2: đã xử lý, không thử lại. */
export function supersede(taskId: string, newRun: string) {
  return init().prepare("UPDATE task_runs SET retried = 2 WHERE task_id = ? AND kind = 'run' AND retried = 0 AND run_id != ?").run(taskId, newRun).changes;
}
/** Chạy ngay (nút "Chạy ngay"), không đổi lịch. Việc đặt dùng Chrome của người dùng thì Chrome phải đang kết nối. */
export async function runNow(uid: string, id: string) {
  const r = getTask(uid, id);
  if (!r) return fail("Không tìm thấy việc tự động.", 404);
  const chrome = await chromeOn(uid);
  if (r.browser === "user" && !chrome && chromeLocked(uid)) fail("Quản trị viên chưa cho phép tài khoản của bạn dùng Chrome của bạn với Synchro. Đổi trình duyệt của việc này sang Tự chọn hoặc Trình duyệt của Synchro.", 403);
  if (r.browser === "user" && !chrome) fail("Việc này đặt chạy bằng Chrome của bạn nhưng Chrome chưa kết nối với Synchro. Mở Chrome có cài tiện ích Synchro rồi thử lại, hoặc đổi trình duyệt của việc thành Tự chọn.", 409);
  const run = launch(r, { chrome });
  if (!run) return fail("Tài khoản không còn hoạt động.", 403);
  init().prepare("UPDATE tasks SET last_run_at = ?, wait_since = NULL WHERE id = ?").run(Date.now(), id);
  supersede(r.id, run);
  return run;
}
/** Chạy việc người dùng vừa duyệt (đề xuất kind "action"): một lượt riêng của việc, kết quả vào Hộp thư. */
export async function runApproved(uid: string, taskId: string | null, title: string, instructions: string, allow: string[] = []) {
  const r = taskId ? getTask(uid, taskId) : null;
  const base: TaskRow = r ?? { id: taskId ?? "manual", owner: uid, title, prompt: instructions, schedule: JSON.stringify(cleanSchedule({})), model: null, enabled: 0, next_run_at: null, last_run_at: null, created_at: Date.now(), browser: "auto", memory: 0, wait_since: null, retries: 0, engine: "chat" };
  const run = launch(base, { chrome: await chromeOn(uid), action: { title, instructions }, allow });
  if (!run) return fail("Tài khoản không còn hoạt động.", 403);
  return run;
}

/** Một nhịp của bộ hẹn giờ: chạy các việc đến hạn, việc đang chờ Chrome, và chạy lại lần lỗi. Mỗi việc được "giành" trước khi chạy để không bao giờ chạy hai lần. */
export async function tick(now = Date.now()) {
  const d = init();
  let n = 0;
  const due = d.prepare("SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 20").all(now) as TaskRow[];
  for (const r of due) {
    const s = JSON.parse(r.schedule) as Schedule;
    // Máy chủ tắt lâu bỏ lỡ nhiều lần: chỉ chạy một lần rồi hẹn lần kế tiếp tính từ bây giờ.
    const next = nextRun(s, Math.max(now, r.next_run_at ?? now), true);
    const claimed = d.prepare("UPDATE tasks SET next_run_at = ?, last_run_at = ?, enabled = ?, retries = 0 WHERE id = ? AND next_run_at = ?").run(next, now, next === null ? 0 : 1, r.id, r.next_run_at).changes === 1;
    if (!claimed) continue;
    const chrome = r.browser === "synchro" ? false : await chromeOn(r.owner);
    // Việc cần Chrome của người dùng mà Chrome đang tắt (máy ngủ): chờ tới khi Chrome kết nối lại.
    if (r.browser === "user" && !chrome && !chromeLocked(r.owner)) { d.prepare("UPDATE tasks SET wait_since = ? WHERE id = ?").run(now, r.id); continue; }
    if (launch(r, { chrome, note: r.browser === "user" && !chrome ? LOCKED_NOTE : undefined })) n++;
  }
  // Việc đang chờ Chrome: Chrome kết nối thì chạy; chờ quá lâu thì chạy bằng trình duyệt của Synchro (ghi rõ trong kết quả).
  for (const r of d.prepare("SELECT * FROM tasks WHERE wait_since IS NOT NULL").all() as TaskRow[]) {
    const chrome = await chromeOn(r.owner);
    const late = now - (r.wait_since ?? now) >= CHROME_WAIT_MS() || chromeLocked(r.owner);
    if (!chrome && !late) continue;
    if (d.prepare("UPDATE tasks SET wait_since = NULL WHERE id = ? AND wait_since = ?").run(r.id, r.wait_since).changes !== 1) continue;
    const waited = Math.round((now - (r.wait_since ?? now)) / 60_000), span = waited >= 90 ? `${Math.round(waited / 60)} giờ` : `${Math.max(waited, 1)} phút`;
    if (launch(r, { chrome, note: !chrome && chromeLocked(r.owner) ? LOCKED_NOTE : chrome ? (waited >= 2 ? `Đã chờ Chrome của người dùng kết nối lại ${span} rồi mới chạy.` : undefined) : `Chrome của người dùng không kết nối suốt ${span}: làm bằng trình duyệt của Synchro, phần cần tài khoản của người dùng thì ghi rõ chưa làm được.` })) n++;
  }
  // Lần chạy lỗi (model quá tải, mất mạng…): chạy lại sau RETRY_MS, tối đa MAX_RETRY lần cho mỗi lần đến hạn.
  // Đã có lần chạy mới hơn của cùng việc (người dùng bấm Chạy lại, lịch đã chạy tiếp): lần lỗi cũ không chạy lại nữa.
  const newer = d.prepare("SELECT 1 FROM task_runs WHERE task_id = ? AND kind = 'run' AND at > ? AND run_id != ? LIMIT 1");
  for (const x of d.prepare("SELECT run_id, task_id, owner, at FROM task_runs WHERE kind = 'run' AND retried = 0 AND at > ?").all(now - 24 * 3600_000) as { run_id: string; task_id: string; owner: string; at: number }[]) {
    if (newer.get(x.task_id, x.at, x.run_id)) { d.prepare("UPDATE task_runs SET retried = 2 WHERE run_id = ?").run(x.run_id); continue; }
    const run = getRun(x.run_id, x.owner);
    if (run?.status === "running") continue;
    const r = getTask(x.owner, x.task_id);
    const err = run?.status === "error" ? (run.result as { error?: string; usageLimit?: boolean } | null) : null;
    if (!run || !r || run.status === "done" || !err || err.usageLimit || r.retries >= MAX_RETRY) { d.prepare("UPDATE task_runs SET retried = 2 WHERE run_id = ?").run(x.run_id); continue; }
    if (now - run.updatedAt < RETRY_MS()) continue;
    if (d.prepare("UPDATE task_runs SET retried = 1 WHERE run_id = ? AND retried = 0").run(x.run_id).changes !== 1) continue;
    d.prepare("UPDATE tasks SET retries = retries + 1 WHERE id = ?").run(r.id);
    const chrome = r.browser === "synchro" ? false : await chromeOn(r.owner);
    if (launch(r, { chrome, note: `Thử lại lần ${r.retries + 1}/${MAX_RETRY} vì lần trước lỗi: ${String(err.error ?? "").slice(0, 200)}` })) n++;
  }
  return n;
}

// Thông báo vào Hộp thư không cần chạy model (ví dụ có người @nhắc tên bạn trong bình luận của ứng dụng).
export function addNotice(owner: string, title: string, text: string, link?: string) {
  const id = "ntc_" + crypto.randomBytes(8).toString("base64url");
  init().prepare("INSERT INTO notices (id, owner, title, text, link, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, owner, title.slice(0, 200), text.slice(0, 4000), link ?? null, Date.now());
  return id;
}
// Việc khác chạy theo nhịp của bộ hẹn giờ, đăng ký từ mô-đun của chúng.
const gh = globalThis as unknown as { __synchroTickHooks?: Map<string, (now: number) => void> };
const hooks = (gh.__synchroTickHooks ??= new Map());
export const onTick = (name: string, f: (now: number) => void) => { hooks.set(name, f); };

const g = globalThis as unknown as { __synchroTasks?: ReturnType<typeof setInterval>; __synchroTicking?: boolean };
/** Bật bộ hẹn giờ (gọi một lần lúc máy chủ khởi động). */
export function startScheduler(everyMs = 30_000) {
  if (g.__synchroTasks) return;
  g.__synchroTasks = setInterval(() => {
    // Nhịp trước chưa xong (đang hỏi trạng thái Chrome…) thì bỏ qua nhịp này.
    if (!g.__synchroTicking) {
      g.__synchroTicking = true;
      tick().then((n) => { if (n) console.log(`[tasks] chạy ${n} việc tự động`); }, (e) => console.error("[tasks]", e)).finally(() => { g.__synchroTicking = false; });
    }
    for (const [name, f] of hooks) try { f(Date.now()); } catch (e) { console.error(`[${name}]`, e); }
  }, everyMs);
  g.__synchroTasks.unref?.();
}
/** Tắt êm khi deploy (drain.ts): không bắt đầu việc tự động nào nữa; tiến trình primary mới chạy bộ hẹn giờ của nó. */
export function stopScheduler() {
  if (g.__synchroTasks) clearInterval(g.__synchroTasks);
  g.__synchroTasks = undefined;
}

// ---------------------------------------------------------------- đề xuất chờ duyệt
export type ProposalKind = "skill" | "action" | "site" | "tool";
export type ProposalStatus = "pending" | "running" | "done" | "failed" | "rejected";
export type Proposal = { id: string; task: string | null; taskTitle: string | null; run: string | null; kind: ProposalKind; title: string; summary: string; payload: Record<string, unknown>; status: ProposalStatus; result: string | null; at: number; decidedAt: number | null };
type PRow = { id: string; owner: string; task_id: string | null; run_id: string | null; kind: ProposalKind; key: string; title: string; summary: string; payload: string; status: ProposalStatus; result: string | null; at: number; decided_at: number | null; task_title?: string | null };
export const PROPOSAL_LIMITS = { perRun: 10, pending: 200 };
const ppub = (r: PRow): Proposal => ({ id: r.id, task: r.task_id, taskTitle: r.task_title ?? null, run: r.run_id, kind: r.kind, title: r.title, summary: r.summary, payload: JSON.parse(r.payload), status: r.status, result: r.result, at: r.at, decidedAt: r.decided_at });
const PSEL = "SELECT p.*, t.title AS task_title FROM proposals p LEFT JOIN tasks t ON t.id = p.task_id";

/** Ghi một đề xuất. key: định danh để không đề xuất trùng (tên skill, trang web, công cụ + tham số, tên việc).
 *  Trùng: đề xuất đang chờ; đề xuất người dùng đã bỏ qua; đề xuất đã duyệt (skill: khi skill vẫn còn — doneGone = người dùng đã xóa skill đó).
 *  Hành động và công cụ lặp lại theo lịch (gửi bản tin mỗi ngày…) chỉ tính trùng trong 20 giờ. */
export function propose(owner: string, o: { task: string | null; run: string | null; kind: ProposalKind; key: string; title: string; summary: string; payload: Record<string, unknown>; doneGone?: boolean }): { id: string; dup?: Proposal } {
  const d = init();
  const after = o.kind === "action" || o.kind === "tool" ? Date.now() - 20 * 3600_000 : 0;
  const dup = d.prepare(`${PSEL} WHERE p.owner = ? AND p.kind = ? AND p.key = ? AND (p.status IN ('pending', 'running') OR (p.status = 'rejected' AND COALESCE(p.decided_at, p.at) > ?)
    OR (p.status = 'done' AND ? = 0 AND COALESCE(p.decided_at, p.at) > ?)) ORDER BY p.at DESC LIMIT 1`).get(owner, o.kind, o.key, after, o.doneGone ? 1 : 0, after) as PRow | undefined;
  if (dup) return { id: dup.id, dup: ppub(dup) };
  if (o.run && (d.prepare("SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?").get(o.run) as { n: number }).n >= PROPOSAL_LIMITS.perRun) fail(`Mỗi lần chạy gửi tối đa ${PROPOSAL_LIMITS.perRun} đề xuất.`, 429);
  if ((d.prepare("SELECT COUNT(*) AS n FROM proposals WHERE owner = ? AND status = 'pending'").get(owner) as { n: number }).n >= PROPOSAL_LIMITS.pending) fail("Hộp thư đã có quá nhiều đề xuất chờ duyệt.", 429);
  const id = "prp_" + crypto.randomBytes(8).toString("base64url");
  d.prepare("INSERT INTO proposals (id, owner, task_id, run_id, kind, key, title, summary, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, owner, o.task, o.run, o.kind, o.key.slice(0, 300), o.title.slice(0, 200), o.summary.slice(0, 4000), JSON.stringify(o.payload), Date.now());
  return { id };
}
export function listProposals(uid: string, o: { all?: boolean; run?: string; limit?: number } = {}): Proposal[] {
  const d = init();
  if (o.run) return (d.prepare(`${PSEL} WHERE p.owner = ? AND p.run_id = ? ORDER BY p.at`).all(uid, o.run) as PRow[]).map(ppub);
  return (d.prepare(`${PSEL} WHERE p.owner = ? ${o.all ? "" : "AND p.status = 'pending'"} ORDER BY p.status = 'pending' DESC, COALESCE(p.decided_at, p.at) DESC LIMIT ?`).all(uid, o.limit ?? 100) as PRow[]).map(ppub);
}
export const getProposal = (uid: string, id: string) => { const r = init().prepare(`${PSEL} WHERE p.id = ? AND p.owner = ?`).get(id, uid) as PRow | undefined; return r ? ppub(r) : null; };
/** Chốt đề xuất: chỉ đổi được khi còn "pending" (hai thiết bị cùng bấm duyệt thì chỉ một lần có hiệu lực). */
export function claimProposal(uid: string, id: string, to: "running" | "rejected") {
  return init().prepare("UPDATE proposals SET status = ?, decided_at = ? WHERE id = ? AND owner = ? AND status = 'pending'").run(to, Date.now(), id, uid).changes === 1;
}
export function settleProposal(uid: string, id: string, status: ProposalStatus, result: string | null, payload?: Record<string, unknown>) {
  init().prepare(`UPDATE proposals SET status = ?, result = ?, decided_at = ?${payload ? ", payload = ?" : ""} WHERE id = ? AND owner = ?`)
    .run(...[status, result?.slice(0, 8000) ?? null, Date.now(), ...(payload ? [JSON.stringify(payload)] : []), id, uid]);
}

// ---------------------------------------------------------------- hộp thư
export type InboxItem = { run: string; task: string; title: string; at: number; read: boolean; status: string; text: string; error?: string; kind?: "task" | "notice" | "action"; link?: string; note?: string; model?: string; proposals?: number };
type RunRow = { run_id: string; task_id: string; title: string; at: number; read: number; kind: string; note: string | null; result: string | null };
type Kept = { status: string; text?: string; error?: string; model?: string };
export const INBOX_KEEP = 1000;
// Quá cũ: không còn biết lần đó xong hay lỗi, nên ghi "expired" chứ không phải "error" (không hiện như lần chạy lỗi, không nút Chạy lại).
const EXPIRED = JSON.stringify({ status: "expired", error: TOO_OLD });
// Lượt chạy chỉ được giữ 7 ngày (runs.ts) nên kết quả cuối được chép sang dòng Hộp thư ngay khi xong: báo cáo tuần trước vẫn đọc được.
// Mỗi người giữ tối đa INBOX_KEEP kết quả đầy đủ; cũ hơn thì còn dòng và thời gian, không còn nội dung.
function keepResult(uid: string, r: Pick<RunRow, "run_id">): Kept | null {
  const run = getRun(r.run_id, uid);
  if (run?.status === "running") return null;
  const res = (run?.result ?? {}) as { text?: string; error?: string; model?: string };
  const k: Kept = run ? { status: run.status, text: String(res.text ?? "").slice(0, 60_000), ...(res.error ? { error: String(res.error) } : {}), ...(typeof res.model === "string" ? { model: res.model } : {}) } : { status: "expired", error: TOO_OLD };
  const d = init();
  d.prepare("UPDATE task_runs SET result = ? WHERE run_id = ? AND owner = ?").run(JSON.stringify(k), r.run_id, uid);
  d.prepare("UPDATE task_runs SET result = ? WHERE owner = ? AND run_id IN (SELECT run_id FROM task_runs WHERE owner = ? AND result IS NOT NULL ORDER BY at DESC LIMIT -1 OFFSET ?)").run(EXPIRED, uid, uid, INBOX_KEEP);
  return k;
}
/** Nhịp đều của máy chủ: chép kết quả của các lượt vừa xong, kể cả khi không ai mở Hộp thư. */
export function archiveInbox(max = 50) {
  const rows = init().prepare("SELECT run_id, owner FROM task_runs WHERE result IS NULL ORDER BY at LIMIT ?").all(max) as { run_id: string; owner: string }[];
  for (const r of rows) keepResult(r.owner, r);
}
onTick("inbox-archive", () => archiveInbox());

const UNREAD_RUNS = "owner = ? AND read = 0 AND NOT (result IS NULL AND run_id IN (SELECT id FROM runs WHERE status = 'running'))";
const unreadCount = (uid: string) => {
  const d = init();
  getRun("", uid); // tạo bảng runs nếu máy chủ vừa khởi động
  return (d.prepare(`SELECT COUNT(*) AS n FROM task_runs WHERE ${UNREAD_RUNS}`).get(uid) as { n: number }).n + (d.prepare("SELECT COUNT(*) AS n FROM notices WHERE owner = ? AND read = 0").get(uid) as { n: number }).n;
};
const pendingCount = (uid: string) => (init().prepare("SELECT COUNT(*) AS n FROM proposals WHERE owner = ? AND status = 'pending'").get(uid) as { n: number }).n;

/** Số trên thanh bên: chỉ đếm và vài dòng mới nhất để báo thông báo, không gửi nội dung kết quả. */
export function inboxCount(uid: string) {
  const d = init(), unread = unreadCount(uid);
  const rows = unread ? d.prepare(`SELECT run_id, title, at FROM task_runs WHERE ${UNREAD_RUNS} UNION ALL SELECT id AS run_id, title, at FROM notices WHERE owner = ? AND read = 0 ORDER BY at DESC LIMIT 20`).all(uid, uid) as { run_id: string; title: string; at: number }[] : [];
  const n = d.prepare("SELECT COUNT(*) AS n FROM proposals WHERE owner = ? AND run_id = ?");
  return { unread, pending: pendingCount(uid), fresh: rows.map((r) => ({ run: r.run_id, title: r.title, proposals: (n.get(uid, r.run_id) as { n: number }).n })) };
}

/** Một trang Hộp thư, mới nhất trước. before: mốc thời gian của dòng cuối trang trước. */
export function inbox(uid: string, o: { limit?: number; before?: number } = {}): { items: InboxItem[]; unread: number; pending: number; more: boolean } {
  const d = init(), limit = Math.min(Math.max(o.limit ?? 50, 1), 100), before = o.before && o.before > 0 ? o.before : Number.MAX_SAFE_INTEGER;
  const rows = d.prepare("SELECT * FROM task_runs WHERE owner = ? AND at < ? ORDER BY at DESC LIMIT ?").all(uid, before, limit + 1) as RunRow[];
  const props = new Map((d.prepare("SELECT run_id, COUNT(*) AS n FROM proposals WHERE owner = ? AND run_id IS NOT NULL GROUP BY run_id").all(uid) as { run_id: string; n: number }[]).map((x) => [x.run_id, x.n]));
  const items = rows.map((r): InboxItem => {
    let k: Kept | null = null;
    if (r.result) { try { k = JSON.parse(r.result) as Kept; } catch {} }
    k ??= keepResult(uid, r);
    return {
      run: r.run_id, task: r.task_id, title: r.title, at: r.at, read: !!r.read, status: k?.error === TOO_OLD ? "expired" : k?.status ?? "running", text: k?.text ?? "", kind: r.kind === "action" ? "action" : "task",
      ...(r.note ? { note: r.note } : {}), ...(k?.model ? { model: k.model } : {}), ...(props.get(r.run_id) ? { proposals: props.get(r.run_id) } : {}), ...(k?.error ? { error: k.error } : {}),
    };
  });
  const notes = (d.prepare("SELECT * FROM notices WHERE owner = ? AND at < ? ORDER BY at DESC LIMIT ?").all(uid, before, limit + 1) as { id: string; title: string; text: string; link: string | null; at: number; read: number }[])
    .map((n): InboxItem => ({ run: n.id, task: "", title: n.title, at: n.at, read: !!n.read, status: "done", text: n.text, kind: "notice", ...(n.link ? { link: n.link } : {}) }));
  // Việc đang chờ Chrome của người dùng kết nối lại: hiện như một dòng "đang chờ" ở đầu Hộp thư (chỉ ở trang đầu).
  const waits = o.before ? [] : (d.prepare("SELECT id, title, wait_since FROM tasks WHERE owner = ? AND wait_since IS NOT NULL").all(uid) as { id: string; title: string; wait_since: number }[])
    .map((t): InboxItem => ({ run: `wait_${t.id}`, task: t.id, title: t.title, at: t.wait_since, read: true, status: "waiting", text: "", kind: "task" }));
  const merged = [...items, ...notes].sort((a, b) => b.at - a.at);
  const all = [...waits, ...merged.slice(0, limit)].sort((a, b) => b.at - a.at);
  return { items: all, unread: unreadCount(uid), pending: pendingCount(uid), more: merged.length > limit };
}
export function markRead(uid: string, runs: string[] | "all") {
  const d = init();
  if (runs === "all") { d.prepare("UPDATE task_runs SET read = 1 WHERE owner = ?").run(uid); d.prepare("UPDATE notices SET read = 1 WHERE owner = ?").run(uid); }
  else for (const r of runs.slice(0, 200)) { d.prepare("UPDATE task_runs SET read = 1 WHERE owner = ? AND run_id = ?").run(uid, r); d.prepare("UPDATE notices SET read = 1 WHERE owner = ? AND id = ?").run(uid, r); }
}
/** Chọn hàng loạt trong Hộp thư: đánh dấu chưa đọc. */
export function markUnread(uid: string, runs: string[]) {
  const d = init();
  for (const r of runs.slice(0, 200)) { d.prepare("UPDATE task_runs SET read = 0 WHERE owner = ? AND run_id = ?").run(uid, r); d.prepare("UPDATE notices SET read = 0 WHERE owner = ? AND id = ?").run(uid, r); }
}
/** Gỡ mục khỏi Hộp thư (chỉ dòng trong Hộp thư của chủ; việc tự động và lịch chạy giữ nguyên). Giao diện không cho gỡ mục đang chạy. */
export function removeItems(uid: string, runs: string[]) {
  const d = init();
  let n = 0;
  for (const r of runs.slice(0, 200)) {
    n += d.prepare("DELETE FROM task_runs WHERE owner = ? AND run_id = ?").run(uid, r).changes;
    n += d.prepare("DELETE FROM notices WHERE owner = ? AND id = ?").run(uid, r).changes;
  }
  return n;
}
