// Lịch chạy của Autopilot (tasks.ts): một lần (ngay hoặc vào một lúc đã hẹn), mỗi N giờ, mỗi ngày, thứ Hai–thứ Sáu, mỗi
// tuần, hoặc biểu thức cron 5 trường. Mọi giờ hẹn tính theo múi giờ của việc (mặc định Asia/Ho_Chi_Minh), không theo
// giờ của máy chủ. Tách khỏi tasks.ts để bộ lên kế hoạch (automate.ts) và kiểm thử dùng chung mà không kéo theo phần
// chạy lượt.
import "server-only";

export type ScheduleKind = "once" | "hourly" | "daily" | "weekdays" | "weekly" | "cron";
/** at: giờ địa phương "YYYY-MM-DDTHH:MM" của việc một lần đã hẹn (không có: chạy ngay);
 *  cron: "phút giờ ngày tháng thứ". */
export type Schedule = {
  kind: ScheduleKind; time?: string; weekday?: number; every?: number; at?: string; cron?: string; tz: string;
};

export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
export class ScheduleError extends Error {}

export const validTz = (tz: unknown) => {
  try {
    if (typeof tz === "string" && tz.length < 64) { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; }
  } catch { /* múi giờ lạ do trình duyệt gửi: dùng múi giờ mặc định thay vì từ chối cả việc */ }
  return DEFAULT_TZ;
};
const FMT = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    FMT.set(tz, f);
  }
  return f;
};
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Năm, tháng (0–11), ngày, giờ, phút, giây, thứ (0 = Chủ nhật) của thời điểm t ở múi giờ tz. */
export const parts = (tz: string, t: number) => {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const wd = WD.indexOf(p.weekday);
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd };
};
// Độ lệch (phút) của múi giờ so với UTC tại thời điểm t.
function offsetMin(tz: string, t: number) {
  const p = parts(tz, t);
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000) / 60_000);
}
/** Giờ địa phương (năm, tháng 0–11, ngày, giờ, phút ở múi giờ tz) → thời điểm UTC. */
export function localToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, mo, d, h, mi);
  const t = guess - offsetMin(tz, guess) * 60_000;
  return guess - offsetMin(tz, t) * 60_000;
}
const AT_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
/** Giờ hẹn "YYYY-MM-DDTHH:MM" của việc một lần → thời điểm UTC (null: không đúng định dạng). */
export function atUtc(s: Pick<Schedule, "at" | "tz">): number | null {
  const m = s.at ? AT_RE.exec(s.at) : null;
  return m ? localToUtc(s.tz, +m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// ---------------------------------------------------------------- cron 5 trường
const NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// Mỗi trường một câu báo lỗi trọn vẹn (giao diện dịch theo nguyên câu).
const FIELDS = [
  [0, 59, "Trường phút của cron không hợp lệ (cho phép 0–59, *, dấu phẩy, a-b, /bước)."],
  [0, 23, "Trường giờ của cron không hợp lệ (cho phép 0–23, *, dấu phẩy, a-b, /bước)."],
  [1, 31, "Trường ngày của cron không hợp lệ (cho phép 1–31, *, dấu phẩy, a-b, /bước)."],
  [1, 12, "Trường tháng của cron không hợp lệ (cho phép 1–12 hoặc JAN–DEC, *, dấu phẩy, a-b, /bước)."],
  [0, 7, "Trường thứ của cron không hợp lệ (cho phép 0–7 hoặc SUN–SAT, *, dấu phẩy, a-b, /bước)."],
] as const;
type Cron = {
  min: number[]; hour: number[]; dom: Set<number>; mon: Set<number>; dow: Set<number>; anyDom: boolean; anyDow: boolean;
};

function field(src: string, i: number): number[] {
  const [lo, hi, msg] = FIELDS[i];
  const bad = (): never => { throw new ScheduleError(msg); };
  const num = (x: string) => {
    const n = /^\d+$/.test(x) ? Number(x) : NAMES[x.toLowerCase()];
    return n === undefined || n < lo || n > hi ? bad() : n;
  };
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS === undefined ? 1 : /^\d+$/.test(stepS) && +stepS > 0 ? +stepS : bad();
    let a: number, b: number;
    if (range === "*") { a = lo; b = hi; }
    else if (range.includes("-")) { const [x, y] = range.split("-"); a = num(x); b = num(y); if (a > b) bad(); }
    else { a = num(range); b = stepS === undefined ? a : hi; }
    for (let n = a; n <= b; n += step) out.add(i === 4 && n === 7 ? 0 : n);
  }
  return [...out].sort((x, y) => x - y);
}
/** Đọc biểu thức cron; ném ScheduleError kèm câu giải thích khi sai. Phút phải là một số: Autopilot chạy tối đa mỗi giờ
 *  một lần (mỗi lần là một lượt chat đủ công cụ, tính vào hạn mức của chính người dùng). */
export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) {
    throw new ScheduleError("Cron cần đúng 5 trường: phút giờ ngày tháng thứ (ví dụ \"30 8 * * 1-5\").");
  }
  const [min, hour, dom, mon, dow] = f.map((x, i) => field(x, i));
  if (min.length !== 1) {
    throw new ScheduleError("Autopilot chạy tối đa mỗi giờ một lần: trường phút của cron phải là một số (0–59).");
  }
  // Như Vixie cron / cronie: trường ngày hay thứ bắt đầu bằng "*" (kể cả "*/2") coi như không hạn chế khi chọn cách
  // ghép hai trường, nên "0 9 */2 * 1" là ngày lẻ VÀ thứ Hai, không phải ngày lẻ HOẶC thứ Hai.
  const anyDom = f[2].startsWith("*"), anyDow = f[4].startsWith("*");
  return { min, hour, dom: new Set(dom), mon: new Set(mon), dow: new Set(dow), anyDom, anyDow };
}
// Như cron chuẩn: hạn chế cả ngày lẫn thứ thì chỉ cần khớp một trong hai; một trong hai trường bắt đầu bằng "*" thì
// phải khớp cả hai (trường "*" trần chứa mọi giá trị nên luôn khớp).
const dayOk = (c: Cron, d: number, wd: number) =>
  c.anyDom || c.anyDow ? c.dom.has(d) && c.dow.has(wd) : c.dom.has(d) || c.dow.has(wd);
function nextCron(c: Cron, tz: string, after: number): number | null {
  const now = parts(tz, after);
  // Một năm rưỡi là đủ cho mọi biểu thức có ngày thật (ngày 29/2 tối đa 4 năm thì coi như không còn lần nào trong
  // tầm nhìn này).
  for (let add = 0; add <= 550; add++) {
    const day = new Date(Date.UTC(now.y, now.mo, now.d + add));
    if (!c.mon.has(day.getUTCMonth() + 1) || !dayOk(c, day.getUTCDate(), day.getUTCDay())) continue;
    for (const h of c.hour) {
      const t = localToUtc(tz, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, c.min[0]);
      if (t > after) return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------- lần chạy kế tiếp
/** Lần chạy kế tiếp sau thời điểm `after` (null: không còn lần nào, ví dụ việc một lần đã chạy). */
export function nextRun(s: Schedule, after: number, ranOnce = false): number | null {
  if (s.kind === "once") return ranOnce ? null : Math.max(after, atUtc(s) ?? after);
  if (s.kind === "hourly") return after + (s.every ?? 1) * 60 * 60_000;
  if (s.kind === "cron") {
    try { return nextCron(parseCron(s.cron ?? ""), s.tz, after); } catch (e) {
      // checkSchedule đã đọc thử cron lúc tạo / sửa việc, nên chỉ tới đây khi dòng trong cơ sở dữ liệu bị sửa tay: coi
      // như không còn lần chạy (bộ hẹn giờ tắt việc) thay vì làm hỏng cả nhịp hẹn giờ.
      console.error("[schedule] cron hỏng trong việc đã lưu", s.cron, e);
      return null;
    }
  }
  const [hh, mm] = (s.time ?? "08:00").split(":").map(Number);
  const now = parts(s.tz, after);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(now.y, now.mo, now.d + add));
    const t = localToUtc(s.tz, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (t <= after) continue;
    const wd = day.getUTCDay();
    if (s.kind === "weekly" && wd !== (s.weekday ?? 1)) continue;
    if (s.kind === "weekdays" && (wd === 0 || wd === 6)) continue;
    return t;
  }
  return null;
}

const KINDS: ScheduleKind[] = ["once", "hourly", "daily", "weekdays", "weekly", "cron"];
/** Lịch do trình duyệt hay model gửi → lịch hợp lệ. Giá trị lạ về mặc định, không ném lỗi (bộ lên kế hoạch dùng hàm
 *  này); kiểm tra chặt (cron sai, giờ hẹn đã qua) nằm ở checkSchedule lúc tạo / sửa việc. */
export function cleanSchedule(x: unknown): Schedule {
  const o = (x ?? {}) as Partial<Schedule>;
  const kind = KINDS.includes(o.kind as ScheduleKind) ? (o.kind as ScheduleKind) : "once";
  const time = typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : "08:00";
  const int = (v: unknown, lo: number, hi: number, d: number) =>
    (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const weekday = int(o.weekday, 0, 6, 1), every = int(o.every, 1, 12, 1);
  // "2026-12-01 08:30" (model hay viết cách) cũng nhận.
  const at = typeof o.at === "string" ? o.at.trim().replace(" ", "T").slice(0, 16) : "";
  const cron = typeof o.cron === "string" ? o.cron.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  return {
    kind,
    ...(kind === "daily" || kind === "weekdays" || kind === "weekly" ? { time } : {}),
    ...(kind === "weekly" ? { weekday } : {}),
    ...(kind === "hourly" && every > 1 ? { every } : {}),
    ...(kind === "once" && AT_RE.test(at) ? { at } : {}),
    ...(kind === "cron" ? { cron: cron || "0 8 * * *" } : {}),
    tz: validTz(o.tz),
  };
}
/** Kiểm tra lịch người dùng vừa đặt: cron đọc được và còn lần chạy, giờ hẹn một lần chưa qua (cho trễ một phút vì
 *  lúc bấm Lưu). */
export function checkSchedule(s: Schedule, now = Date.now()) {
  if (s.kind === "cron") {
    parseCron(s.cron ?? "");
    if (nextRun(s, now) === null) {
      throw new ScheduleError("Biểu thức cron này không có lần chạy nào trong 18 tháng tới.");
    }
  }
  const at = s.kind === "once" ? atUtc(s) : null;
  if (at !== null && at < now - 60_000) {
    const msg = "Giờ hẹn đã qua. Hãy chọn một thời điểm trong tương lai, hoặc chọn \"Một lần, chạy ngay\".";
    throw new ScheduleError(msg);
  }
}

const DAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const z = (n: number) => String(n).padStart(2, "0");
/** "08:00 Thứ Năm 29/10/2026" theo múi giờ của việc. */
export const localTime = (tz: string, t: number) => {
  const p = parts(tz, t);
  return `${z(p.h)}:${z(p.mi)} ${DAYS[p.wd]} ${z(p.d)}/${z(p.mo + 1)}/${p.y}`;
};
/** Lịch bằng lời (tiếng Việt) cho lời nhắc của model và email. */
// "2026-12-01T08:30" → "một lần lúc 08:30 ngày 01/12/2026".
const atDesc = (at: string) => {
  const [d, t] = at.split("T"), [y, mo, dd] = d.split("-");
  return `một lần lúc ${t} ngày ${dd}/${mo}/${y}`;
};
export const scheduleDesc = (s: Schedule) => s.kind === "once" ? (s.at ? atDesc(s.at) : "một lần")
  : s.kind === "hourly" ? (s.every && s.every > 1 ? `mỗi ${s.every} giờ` : "mỗi giờ")
  : s.kind === "cron" ? `theo lịch cron "${s.cron}"`
  : s.kind === "daily" ? `mỗi ngày lúc ${s.time}`
  : s.kind === "weekdays" ? `thứ Hai tới thứ Sáu lúc ${s.time}`
  : `${DAYS[s.weekday ?? 1]} hằng tuần lúc ${s.time}`;
