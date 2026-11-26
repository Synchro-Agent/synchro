// Autopilot (trước đây là Hộp thư): người dùng giao một việc chạy ngay, một lần vào lúc đã hẹn, mỗi N giờ, mỗi ngày,
// các ngày làm việc, mỗi tuần hoặc theo cron (server/schedule.ts). Đến giờ, bộ hẹn giờ trên máy chủ tạo một lượt chạy
// bền (runs.ts) đi đúng đường của một lượt chat bình thường (chatExec: cùng định tuyến model, cùng hạn mức của chính
// người dùng, skill, connector, web, trình duyệt, chạy code, artifact, ảnh, tệp). Máy người dùng tắt hay đóng tab vẫn
// chạy. Xong thì kết quả thành một đoạn chat thường để hỏi tiếp, có thông báo trong app và email nếu người dùng bật
// (autopilot.ts). Mỗi lần đến hạn chỉ chạy một lần (giành lượt bằng câu lệnh UPDATE có điều kiện).
// - Trình duyệt: "auto" dùng trình duyệt của Synchro trên máy chủ, Chrome của người dùng khi cần tài khoản họ đã đăng nhập và Chrome đang
//   kết nối; "user" chờ Chrome của người dùng kết nối (tối đa CHROME_WAIT_MS) rồi mới chạy; "synchro" chỉ dùng trình duyệt của máy chủ.
// - Nhớ: mỗi lần chạy nhận kết quả các lần trước và các đề xuất đã gửi (so sánh, không lặp lại).
// - Lỗi (model quá tải, mất mạng…): tự chạy lại tối đa MAX_RETRY lần, cách RETRY_MS. Hết hạn mức thì không chạy lại.
// - Đề xuất chờ duyệt (proposals): việc cần người dùng đồng ý (tạo skill, hành động có tác động, trang web mới, công cụ để "hỏi trước")
//   không tự làm mà vào mục Cần duyệt của Autopilot; người dùng duyệt thì Synchro làm (automate.ts).
import "server-only";
import { parseOrch, type OrchState } from "../shared/orchestra";
import crypto from "node:crypto";
import { can, db, getSetting, getUser, setSetting } from "./authstore";
import { getRun, startRun } from "./runs";
import { extLive } from "./browserext";
import { TOO_OLD } from "../shared/taskerr";
import { checkSchedule, cleanSchedule, localTime, nextRun, scheduleDesc, ScheduleError } from "./schedule";
import type { Schedule } from "./schedule";
import { deliverResult, storedOf } from "./autopilot";

export { cleanSchedule, localTime, nextRun, scheduleDesc, type Schedule };
export type BrowserPref = "auto" | "synchro" | "user";
/** chat: lượt chat đủ công cụ (web, trình duyệt, Chrome, connector, skill, chạy code, artifact, ảnh); code: Synchro
 *  Code trong workspace riêng của việc (sửa tệp, lệnh, git, PR). */
export type Engine = "chat" | "code";
/** schedule: JSON của lịch cộng cách báo kết quả (autopilot.ts Stored). */
export type TaskRow = {
  id: string; owner: string; title: string; prompt: string; schedule: string; model: string | null; enabled: number;
  next_run_at: number | null; last_run_at: number | null; created_at: number; browser: BrowserPref; memory: number;
  wait_since: number | null; retries: number; engine: Engine;
};
const scheduleOf = (r: Pick<TaskRow, "schedule">): Schedule => {
  const { notify: _n, lang: _l, ...s } = storedOf(r);
  return s;
};
export type LastRun = { run: string; status: string; at: number; chat?: number } | null;
export type PublicTask = Omit<TaskRow, "schedule" | "enabled" | "owner" | "memory"> & {
  schedule: Schedule; enabled: boolean; memory: boolean; email: boolean; runs: number; last: LastRun; pending: number;
  sid: string | null;
};
export const TASK_LIMITS = { perUser: 30, prompt: 8000, title: 120, minHourlyGapMs: 55 * 60_000 };
export const MAX_RETRY = 2;
const RETRY_MS = () => Number(process.env.SYNCHRO_TASK_RETRY_MS) || 10 * 60_000;
// Giá trị "Tự động" của bộ chọn model (router.ts AUTO); không nhập router.ts vào đây vì nó kéo theo cả bộ định tuyến.
const AUTO_MODEL = "auto";
const CHROME_WAIT_MS = () => Number(process.env.SYNCHRO_CHROME_WAIT_MS) || 12 * 3600_000;

export class TaskError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new TaskError(m, status); };

// Bảng tasks, task_runs (kể cả cột thêm sau: trình duyệt, nhớ kết quả cũ, chờ Chrome, số lần thử lại; loại lượt, ghi chú, đã xét thử lại),
// notices, proposals: db/migrations/001_baseline.sql, 002_reconcile.columns.json (bộ chạy migration tạo khi mở cơ sở dữ liệu).
let ready = false;
function init() {
  const d = db();
  if (!ready) {
    // Công cụ gửi đề xuất đổi tên theo Autopilot: hướng dẫn của việc đã tạo từ trước (bộ lên kế hoạch viết tên công cụ
    // vào đó) đổi một lần sang tên mới, nếu không model đọc thấy tên công cụ không còn trong danh sách công cụ của
    // lượt.
    if (getSetting("autopilot_tool_renamed", "") !== "1") {
      d.prepare("UPDATE tasks SET prompt = REPLACE(prompt, 'inbox_propose', 'autopilot_propose') WHERE prompt LIKE ?")
        .run("%inbox_propose%");
      setSetting("autopilot_tool_renamed", "1");
    }
    ready = true;
  }
  return d;
}

export const cleanBrowser = (x: unknown, cur: BrowserPref = "auto"): BrowserPref => (x === "auto" || x === "synchro" || x === "user" ? x : cur);
export const cleanEngine = (x: unknown, cur: Engine = "chat"): Engine => (x === "chat" || x === "code" ? x : cur);
/** Mã phiên workspace (số) riêng cho mỗi việc tự động chạy bằng Synchro Code, cố định giữa các lần chạy (repo, tệp giữ lại). */
export const taskSid = (taskId: string) => "9" + String(parseInt(crypto.createHash("sha1").update(taskId).digest("hex").slice(0, 12), 16) % 1e14).padStart(14, "0");
// Synchro Code cần quyền của quản trị viên.
const codeOk = (uid: string, engine: Engine) => { if (engine === "code") { const u = getUser(uid); if (!u || !can(u, "code")) fail("Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code, nên việc này chưa chạy bằng Synchro Code được.", 403); } };

// Lần chạy gần nhất của việc; chat: đoạn chat chứa kết quả (nút "Mở đoạn chat" trên thẻ việc).
function lastOf(d: ReturnType<typeof init>, taskId: string, uid: string): LastRun {
  const sql = "SELECT run_id, at, result FROM task_runs WHERE task_id = ? AND kind = 'run' ORDER BY at DESC LIMIT 1";
  const r = d.prepare(sql).get(taskId) as { run_id: string; at: number; result: string | null } | undefined;
  if (!r) return null;
  const k = r.result ? parseKept(r.result) : null;
  const status = k?.status ?? getRun(r.run_id, uid)?.status ?? "error";
  return { run: r.run_id, at: r.at, status, ...(k?.chat ? { chat: k.chat } : {}) };
}
const pub = (d: ReturnType<typeof init>, r: TaskRow, runs = 0, pending = 0): PublicTask => {
  const { schedule: _s, enabled, owner, memory, ...rest } = r;
  return {
    ...rest, schedule: scheduleOf(r), enabled: !!enabled, memory: !!memory, email: storedOf(r).notify === "email", runs,
    pending,
    last: lastOf(d, r.id, owner), sid: r.engine === "code" ? taskSid(r.id) : null,
  };
};
const one = (d: ReturnType<typeof init>, id: string) => pub(d, d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);

export function listTasks(uid: string): PublicTask[] {
  const d = init();
  const n = new Map((d.prepare("SELECT task_id, COUNT(*) AS n FROM task_runs WHERE owner = ? AND kind = 'run' GROUP BY task_id").all(uid) as { task_id: string; n: number }[]).map((x) => [x.task_id, x.n]));
  const p = new Map((d.prepare("SELECT task_id, COUNT(*) AS n FROM proposals WHERE owner = ? AND status = 'pending' GROUP BY task_id").all(uid) as { task_id: string; n: number }[]).map((x) => [x.task_id, x.n]));
  return (d.prepare("SELECT * FROM tasks WHERE owner = ? ORDER BY created_at DESC").all(uid) as TaskRow[]).map((r) => pub(d, r, n.get(r.id) ?? 0, p.get(r.id) ?? 0));
}
export const getTask = (uid: string, id: string) => (init().prepare("SELECT * FROM tasks WHERE id = ? AND owner = ?").get(id, uid) as TaskRow | undefined) ?? null;

type TaskIn = {
  title?: unknown; prompt?: unknown; schedule?: unknown; model?: unknown; browser?: unknown; memory?: unknown;
  enabled?: unknown; engine?: unknown; email?: unknown; lang?: unknown;
};
const cleanModel = (x: unknown) => (typeof x === "string" && x && x.length <= 120 ? x : null);
const cleanLang = (x: unknown, cur?: "vi" | "en") => (x === "vi" || x === "en" ? x : cur);
const stored = (s: Schedule, email: boolean, lang?: "vi" | "en"): string =>
  JSON.stringify({ ...s, ...(email ? { notify: "email" } : {}), ...(lang ? { lang } : {}) });
/** Lỗi của lịch (cron sai, giờ hẹn đã qua) thành lời báo 400 của việc. */
function checkUser(s: Schedule) {
  try { checkSchedule(s); } catch (e) { if (e instanceof ScheduleError) fail(e.message); throw e; }
}
/** Lịch người dùng vừa đặt, đã kiểm tra. */
function userSchedule(x: unknown): Schedule {
  const s = cleanSchedule(x);
  checkUser(s);
  return s;
}
// So hai lịch đã chuẩn hóa, không phụ thuộc thứ tự khóa của JSON đã lưu.
const schedKey = (s: Schedule) => JSON.stringify(Object.entries(s).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function createTask(uid: string, x: TaskIn) {
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : fail("Việc tự động cần có tên.");
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt ? x.prompt.trim() : fail("Yêu cầu của việc tự động trống hoặc quá dài (tối đa 8.000 ký tự).");
  const d = init();
  if ((d.prepare("SELECT COUNT(*) AS n FROM tasks WHERE owner = ?").get(uid) as { n: number }).n >= TASK_LIMITS.perUser) fail(`Mỗi tài khoản có tối đa ${TASK_LIMITS.perUser} việc tự động.`);
  const s = userSchedule(x.schedule);
  const engine = cleanEngine(x.engine);
  codeOk(uid, engine);
  const now = Date.now();
  const id = "task_" + crypto.randomBytes(8).toString("base64url");
  d.prepare("INSERT INTO tasks (id, owner, title, prompt, schedule, model, enabled, next_run_at, created_at, browser, memory, engine) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)")
    .run(id, uid, title, prompt, stored(s, x.email === true, cleanLang(x.lang)), cleanModel(x.model), nextRun(s, now),
      now, cleanBrowser(x.browser), x.memory === false ? 0 : 1, engine);
  return one(d, id);
}

export function updateTask(uid: string, id: string, x: TaskIn) {
  const d = init();
  const r = getTask(uid, id);
  if (!r) return fail("Không tìm thấy việc tự động.", 404);
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, TASK_LIMITS.title) : r.title;
  const prompt = typeof x.prompt === "string" && x.prompt.trim() && x.prompt.length <= TASK_LIMITS.prompt
    ? x.prompt.trim() : r.prompt;
  const cur = scheduleOf(r);
  const s = x.schedule !== undefined ? cleanSchedule(x.schedule) : cur;
  // Form sửa việc luôn gửi lại lịch, kể cả khi người dùng chỉ đổi tên hay tắt email: chỉ kiểm tra lịch và tính lại lần
  // chạy khi lịch thật sự đổi. Nếu không, việc một lần đã chạy xong (giờ hẹn đã qua) không sửa được gì nữa, còn việc
  // mỗi vài giờ bị lùi lần chạy kế tiếp mỗi lần sửa tên.
  const moved = schedKey(s) !== schedKey(cur);
  if (moved) checkUser(s);
  const ran = !!r.last_run_at;
  // Việc một lần đã chạy xong (bộ hẹn giờ đã tắt nó) mà người dùng chọn giờ mới: hẹn lại theo giờ mới.
  const rearm = moved && s.kind === "once" && ran && !r.enabled && x.enabled === undefined;
  const enabled = typeof x.enabled === "boolean" ? x.enabled : rearm || !!r.enabled;
  // Bật lại việc một lần đã hẹn giờ mà chưa chạy, giờ hẹn đã qua trong lúc tạm dừng: báo giờ đã qua để người dùng chọn
  // lại, không chạy ngay một việc có thể có tác dụng phụ mà người dùng tưởng đã hết hạn.
  if (enabled && !r.enabled && !moved && !ran && s.kind === "once" && s.at) checkUser(s);
  const was = storedOf(r);
  const model = x.model !== undefined ? cleanModel(x.model) ?? r.model : r.model;
  // Đổi lịch hoặc bật lại thì tính lại lần chạy kế tiếp từ bây giờ.
  const next = !enabled ? r.next_run_at
    : moved || !r.enabled ? nextRun(s, Date.now(), s.kind === "once" && ran && !moved) : r.next_run_at;
  const engine = cleanEngine(x.engine, r.engine);
  if (engine !== r.engine) codeOk(uid, engine);
  const plan = stored(s, typeof x.email === "boolean" ? x.email : was.notify === "email", cleanLang(x.lang, was.lang));
  d.prepare("UPDATE tasks SET title = ?, prompt = ?, schedule = ?, enabled = ?, model = ?, next_run_at = ?,"
    + " browser = ?, memory = ?, wait_since = ?, engine = ? WHERE id = ?")
    .run(title, prompt, plan, enabled ? 1 : 0, model, next, cleanBrowser(x.browser, r.browser),
      typeof x.memory === "boolean" ? (x.memory ? 1 : 0) : r.memory, enabled ? r.wait_since : null, engine, id);
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
const SYSTEM = `Bạn là Synchro đang tự chạy một việc người dùng đã giao cho Autopilot. Việc chạy trên máy chủ của \
Synchro (theo lịch, hoặc vì người dùng bấm Chạy ngay); người dùng không ngồi xem và không trả lời câu hỏi giữa chừng \
(có thể họ đang ngủ, đã đóng tab hay gập máy). Kết quả của bạn thành một đoạn chat thường để họ đọc và hỏi tiếp sau.
- Bạn có đủ mọi khả năng như trong chat thường: tìm trên web, trình duyệt, connector, skill, chạy code, artifact \
(trang web, ứng dụng, tài liệu, bản trình bày, biểu đồ), tạo ảnh, tạo tệp. Dùng đúng thứ việc cần, như khi người dùng \
nhắn trực tiếp.
- Tự làm trọn vẹn tới khi có kết quả dùng được: một nguồn lỗi hay bị chặn thì tự thử nguồn / cách khác. Không hỏi lại \
người dùng.
- Số liệu phải có nguồn và thời điểm (giá lúc mấy giờ, ở trang nào). Không bịa; thiếu dữ liệu thì nói rõ thiếu gì và vì sao.
- Có <previous_runs>: so sánh với các lần trước (thay đổi, xu hướng), không lặp lại mục đã báo hay đã đề xuất trước đó trừ khi có điều mới.
- Việc cần người dùng đồng ý trước (tạo skill, gửi tin nhắn / email, đăng bài, mua bán, đặt lệnh, xóa hay sửa dữ liệu \
của họ, thay đổi gì đó bằng tài khoản của họ): không tự làm; gọi autopilot_propose để gửi đề xuất vào mục Cần duyệt \
của Autopilot, người dùng duyệt thì Synchro làm.
- Phân tích, nhận định hay gợi ý (đầu tư, giao dịch, sức khỏe, pháp lý…): đưa thẳng gợi ý cụ thể người dùng cần (ví dụ mua / bán / giữ, vùng giá, mức cắt lỗ), kèm dữ liệu và lập luận làm căn cứ, mức độ chắc chắn và rủi ro chính trong một hai câu.
- Kết quả cuối viết bằng ngôn ngữ người dùng dùng trong yêu cầu, Markdown: dòng đầu tóm tắt điều quan trọng nhất, rồi \
chi tiết (tiêu đề, gạch đầu dòng, bảng), cuối cùng là mục "Nguồn". Sản phẩm người dùng yêu cầu (trang web, tài liệu, \
bản trình bày, ảnh, tệp) thì làm thành artifact, ảnh hay tệp như trong chat thường.`;
const STATUS: Record<string, string> = { pending: "chờ duyệt", done: "đã duyệt", approved: "đã duyệt", failed: "đã duyệt nhưng lỗi", rejected: "người dùng bỏ qua" };

/** Kết quả các lần chạy trước và đề xuất đã gửi của việc này (để so sánh, không lặp lại). */
function previous(r: TaskRow) {
  const d = init();
  const tz = scheduleOf(r).tz;
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
  const s = scheduleOf(r);
  const now = Date.now();
  const n = (init().prepare("SELECT COUNT(*) AS n FROM task_runs WHERE task_id = ? AND kind = 'run'").get(r.id) as { n: number }).n;
  const ctx = `<automation>\nViệc: ${r.title}\nLịch: ${scheduleDesc(s)}\nBây giờ: ${localTime(s.tz, now)} (${s.tz})${o.action ? "" : `\nLần chạy thứ ${n + 1}`}${o.note ? `\nGhi chú: ${o.note}` : ""}${r.engine === "code" ? "\nNơi làm: workspace riêng của việc này trong Synchro Code, giữ nguyên giữa các lần chạy (repo đã clone, tệp đã tạo lần trước vẫn còn). Làm việc với repo GitHub của người dùng bằng git / gh như trong Synchro Code; thay đổi lớn thì làm trên nhánh mới và mở pull request để người dùng duyệt." : ""}\n</automation>`;
  const content = o.action
    ? `Người dùng đã duyệt đề xuất "${o.action.title}" của việc tự động này. Hãy làm đúng việc đã được duyệt dưới đây, rồi báo lại ngắn gọn đã làm gì và kết quả ra sao.\n\n${o.action.instructions}`
    : `${r.memory ? previous(r) : ""}${r.prompt}`;
  return {
    // tz: dòng "bây giờ" của lời nhắc theo múi giờ của việc, như chat thường theo múi giờ của trình duyệt.
    system: `${SYSTEM}\n\n${ctx}`, messages: [{ role: "user", content }], skills: true, max_tokens: 8000, web: true,
    tz: s.tz,
    // Chưa chọn model thì Tự động, đúng như chat thường (cùng bộ chọn model, cùng cách hạ xuống gói subscription khi
    // hết hạn mức API), nên được định tuyến theo việc và việc nhiều nhánh được chia cho nhóm Orchestra như ở khung
    // chat.
    model: r.model ?? AUTO_MODEL, feature: "chat", conv: `task-${r.id}`,
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
/** Chạy việc người dùng vừa duyệt (đề xuất kind "action"): một lượt riêng của việc, kết quả vào Autopilot. */
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
    const s = scheduleOf(r);
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

// Thông báo vào Autopilot không cần chạy model (ví dụ có người @nhắc tên bạn trong bình luận của ứng dụng).
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
  const pend = d.prepare("SELECT COUNT(*) AS n FROM proposals WHERE owner = ? AND status = 'pending'");
  if ((pend.get(owner) as { n: number }).n >= PROPOSAL_LIMITS.pending) {
    fail("Autopilot đã có quá nhiều đề xuất chờ duyệt.", 429);
  }
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

// ---------------------------------------------------------------- kết quả (danh sách Kết quả của Autopilot)
/** chat: mã đoạn chat chứa kết quả (đã tạo ở máy chủ, đồng bộ về mọi thiết bị) để mở và hỏi tiếp. */
export type InboxItem = {
  run: string; task: string; title: string; at: number; read: boolean; status: string; text: string; error?: string;
  kind?: "task" | "notice" | "action"; link?: string; note?: string; model?: string; proposals?: number; chat?: number;
  orch?: OrchState;
};
type RunRow = {
  run_id: string; task_id: string; title: string; at: number; read: number; kind: string; note: string | null;
  result: string | null; retried: number;
};
// orch: sơ đồ tổ chức lúc xong khi lần chạy chia việc cho nhiều model (Orchestra), để Autopilot hiện lại nhật ký
// làm việc của nhóm.
type Kept = { status: string; text?: string; error?: string; model?: string; chat?: number; orch?: OrchState };
const parseKept = (s: string): Kept | null => {
  try { return JSON.parse(s) as Kept; } catch (e) { console.error("[autopilot] dòng kết quả hỏng", e); return null; }
};
export const INBOX_KEEP = 1000;
// Quá cũ: không còn biết lần đó xong hay lỗi, nên ghi "expired" chứ không phải "error" (không hiện như lần chạy lỗi,
// không nút Chạy lại).
const EXPIRED = JSON.stringify({ status: "expired", error: TOO_OLD });
/** Lần chạy lỗi mà bộ hẹn giờ sẽ tự chạy lại (cùng điều kiện với tick): chưa phải kết quả cuối của lần đến hạn đó. */
function retryAhead(d: ReturnType<typeof init>, uid: string, row: RunRow, run: { status: string; result: unknown }) {
  if (row.kind !== "run" || run.status !== "error" || row.retried !== 0) return false;
  const err = run.result as { usageLimit?: boolean } | null;
  if (!err || err.usageLimit) return false;
  const t = getTask(uid, row.task_id);
  if (!t || t.retries >= MAX_RETRY) return false;
  const newer = "SELECT 1 FROM task_runs WHERE task_id = ? AND kind = 'run' AND at > ? AND run_id != ? LIMIT 1";
  return !d.prepare(newer).get(row.task_id, row.at, row.run_id);
}
// Lượt chạy chỉ được giữ 7 ngày (runs.ts) nên kết quả cuối được chép sang dòng kết quả ngay khi xong: báo cáo tuần
// trước vẫn đọc được. Mỗi người giữ tối đa INBOX_KEEP kết quả đầy đủ; cũ hơn thì còn dòng và thời gian, không còn nội
// dung.
// Lần chép đầu tiên cũng là lúc gửi kết quả cho người dùng (đoạn chat để hỏi tiếp, email nếu bật): câu UPDATE chỉ ăn
// khi result còn NULL, nên nhịp hẹn giờ và trang Autopilot cùng gọi tới cũng chỉ gửi một lần.
// Lần lỗi còn được tự chạy lại thì chưa báo gì (không email, không thông báo trong app, dòng kết quả coi như đã đọc):
// một lần đến hạn chỉ báo một lần, ở lần thử cuối, thay vì ba email lỗi rồi một email thành công.
function keepResult(uid: string, r: Pick<RunRow, "run_id">): Kept | null {
  const run = getRun(r.run_id, uid);
  if (run?.status === "running") return null;
  const res = (run?.result ?? {}) as { text?: string; error?: string; model?: string; orchestra?: unknown };
  const orch = res.orchestra ? parseOrch(JSON.stringify(res.orchestra)) : null;
  let k: Kept = run
    ? {
      status: run.status, text: String(res.text ?? "").slice(0, 60_000),
      ...(res.error ? { error: String(res.error) } : {}),
      ...(typeof res.model === "string" ? { model: res.model } : {}), ...(orch ? { orch } : {}),
    }
    : { status: "expired", error: TOO_OLD };
  const d = init();
  const first = d.prepare("UPDATE task_runs SET result = ? WHERE run_id = ? AND owner = ? AND result IS NULL")
    .run(JSON.stringify(k), r.run_id, uid).changes === 1;
  if (!first) {
    const cur = d.prepare("SELECT result FROM task_runs WHERE run_id = ? AND owner = ?")
      .get(r.run_id, uid) as { result: string | null } | undefined;
    return cur?.result ? parseKept(cur.result) : k;
  }
  const row = d.prepare("SELECT * FROM task_runs WHERE run_id = ?").get(r.run_id) as RunRow | undefined;
  const held = !!run && !!row && retryAhead(d, uid, row, run);
  if (held) d.prepare("UPDATE task_runs SET read = 1 WHERE run_id = ?").run(r.run_id);
  else if (run && row) {
    const chat = deliverResult({
      uid, run: r.run_id, title: row.title, at: row.at, kind: row.kind, task: getTask(uid, row.task_id),
      status: run.status, result: run.result, doneAt: run.updatedAt,
    });
    if (chat) {
      k = { ...k, chat };
      d.prepare("UPDATE task_runs SET result = ? WHERE run_id = ?").run(JSON.stringify(k), r.run_id);
    }
  }
  d.prepare("UPDATE task_runs SET result = ? WHERE owner = ? AND run_id IN (SELECT run_id FROM task_runs"
    + " WHERE owner = ? AND result IS NOT NULL ORDER BY at DESC LIMIT -1 OFFSET ?)").run(EXPIRED, uid, uid, INBOX_KEEP);
  return k;
}
/** Nhịp đều của máy chủ: chép kết quả của các lượt vừa xong và gửi cho người dùng, kể cả khi không ai mở Autopilot
 *  (tab đã đóng). */
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

/** Mục mới để báo (thông báo trong app, thông báo của trình duyệt): loại, trạng thái và đoạn chat kết quả để báo đúng
 *  lời (xong, lỗi, thông báo) và mở thẳng đoạn chat. */
export type Fresh = {
  run: string; title: string; proposals: number; kind: "task" | "action" | "notice"; status: string; chat?: number;
};
/** Số trên thanh bên: chỉ đếm và vài dòng mới nhất để báo thông báo, không gửi nội dung kết quả. */
export function inboxCount(uid: string): { unread: number; pending: number; fresh: Fresh[] } {
  const d = init(), unread = unreadCount(uid);
  const sql = `SELECT run_id, title, at, kind, result FROM task_runs WHERE ${UNREAD_RUNS} UNION ALL`
    + " SELECT id AS run_id, title, at, 'notice' AS kind, NULL AS result FROM notices WHERE owner = ? AND read = 0"
    + " ORDER BY at DESC LIMIT 20";
  type Row = { run_id: string; title: string; at: number; kind: string; result: string | null };
  const rows = unread ? d.prepare(sql).all(uid, uid) as Row[] : [];
  const n = d.prepare("SELECT COUNT(*) AS n FROM proposals WHERE owner = ? AND run_id = ?");
  const fresh = rows.map((r): Fresh => {
    const k = r.result ? parseKept(r.result) : null;
    const kind = r.kind === "notice" ? "notice" : r.kind === "action" ? "action" : "task";
    // Lượt vừa xong mà nhịp hẹn giờ chưa kịp chép kết quả: trạng thái lấy thẳng từ lượt chạy.
    const status = kind === "notice" ? "done" : k?.status ?? getRun(r.run_id, uid)?.status ?? "done";
    return {
      run: r.run_id, title: r.title, proposals: (n.get(uid, r.run_id) as { n: number }).n, kind, status,
      ...(k?.chat ? { chat: k.chat } : {}),
    };
  });
  return { unread, pending: pendingCount(uid), fresh };
}

/** Một trang Autopilot, mới nhất trước. before: mốc thời gian của dòng cuối trang trước. */
export function inbox(uid: string, o: { limit?: number; before?: number } = {}): { items: InboxItem[]; unread: number; pending: number; more: boolean } {
  const d = init(), limit = Math.min(Math.max(o.limit ?? 50, 1), 100), before = o.before && o.before > 0 ? o.before : Number.MAX_SAFE_INTEGER;
  const rows = d.prepare("SELECT * FROM task_runs WHERE owner = ? AND at < ? ORDER BY at DESC LIMIT ?").all(uid, before, limit + 1) as RunRow[];
  const props = new Map((d.prepare("SELECT run_id, COUNT(*) AS n FROM proposals WHERE owner = ? AND run_id IS NOT NULL GROUP BY run_id").all(uid) as { run_id: string; n: number }[]).map((x) => [x.run_id, x.n]));
  const items = rows.map((r): InboxItem => {
    const k = (r.result ? parseKept(r.result) : null) ?? keepResult(uid, r);
    return {
      run: r.run_id, task: r.task_id, title: r.title, at: r.at, read: !!r.read, status: k?.error === TOO_OLD ? "expired" : k?.status ?? "running", text: k?.text ?? "", kind: r.kind === "action" ? "action" : "task",
      ...(r.note ? { note: r.note } : {}), ...(k?.model ? { model: k.model } : {}), ...(props.get(r.run_id) ? { proposals: props.get(r.run_id) } : {}), ...(k?.error ? { error: k.error } : {}),
      ...(k?.chat ? { chat: k.chat } : {}), ...(k?.orch ? { orch: k.orch } : {}),
    };
  });
  const notes = (d.prepare("SELECT * FROM notices WHERE owner = ? AND at < ? ORDER BY at DESC LIMIT ?").all(uid, before, limit + 1) as { id: string; title: string; text: string; link: string | null; at: number; read: number }[])
    .map((n): InboxItem => ({ run: n.id, task: "", title: n.title, at: n.at, read: !!n.read, status: "done", text: n.text, kind: "notice", ...(n.link ? { link: n.link } : {}) }));
  // Việc đang chờ Chrome của người dùng kết nối lại: hiện như một dòng "đang chờ" ở đầu Autopilot (chỉ ở trang đầu).
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
/** Chọn hàng loạt trong Autopilot: đánh dấu chưa đọc. */
export function markUnread(uid: string, runs: string[]) {
  const d = init();
  for (const r of runs.slice(0, 200)) { d.prepare("UPDATE task_runs SET read = 0 WHERE owner = ? AND run_id = ?").run(uid, r); d.prepare("UPDATE notices SET read = 0 WHERE owner = ? AND id = ?").run(uid, r); }
}
/** Gỡ mục khỏi danh sách Kết quả (chỉ dòng của chủ; việc tự động và lịch chạy giữ nguyên). Giao diện không cho gỡ
 *  mục đang chạy. */
export function removeItems(uid: string, runs: string[]) {
  const d = init();
  let n = 0;
  for (const r of runs.slice(0, 200)) {
    n += d.prepare("DELETE FROM task_runs WHERE owner = ? AND run_id = ?").run(uid, r).changes;
    n += d.prepare("DELETE FROM notices WHERE owner = ? AND id = ?").run(uid, r).changes;
  }
  return n;
}
