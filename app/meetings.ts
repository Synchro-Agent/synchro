// Từ cuộc họp ra việc cần làm (chỉ chạy ở máy chủ): tệp ghi âm (hoặc nội dung ghi chép dán vào) → chép lời → model tóm tắt thành
// biên bản có cấu trúc (thành phần, nội dung chính, quyết định, việc cần làm kèm người phụ trách và hạn chót, câu hỏi còn mở).
// Chạy như một lượt chạy bền (runs.ts) nên tải lại trang hay máy chủ khởi động lại không mất. Việc đến hạn mà chưa xong thì nhắc vào Hộp thư.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canModel, DATA_DIR, db, type UserRow } from "./authstore";
import { registerExec, startRun } from "./runs";
import { transcribe } from "./stt";
import { catalog, mainModels, pickDefault, resolveModel } from "./providers";
import { chatOnce } from "./llmcall";
import { overLimit, usageScope } from "./usage";
import { addNotice, onTick } from "./tasks";
import { ALL } from "./catalog";

export type Minutes = { tomTat: string; thanhPhan: string[]; noiDung: string[]; quyetDinh: string[]; viec: { noiDung: string; nguoiPhuTrach: string; hanChot: string | null }[]; cauHoiMo: string[] };
type Row = { id: string; owner: string; title: string; date: string; tz: string; status: string; transcript: string | null; minutes: string | null; error: string | null; engine: string | null; audio: string | null; run: string | null; created_at: number };
export type Item = { id: string; meeting_id: string; text: string; assignee: string; due: string | null; done: number; reminded: number; n: number };
export class MeetingError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new MeetingError(m, status); };
const DIR = () => path.join(DATA_DIR, "meetings");

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, tz TEXT NOT NULL, status TEXT NOT NULL,
      transcript TEXT, minutes TEXT, error TEXT, engine TEXT, audio TEXT, run TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS meetings_owner ON meetings(owner, created_at);
      CREATE TABLE IF NOT EXISTS meeting_items (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, owner TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, assignee TEXT NOT NULL DEFAULT '',
      due TEXT, done INTEGER NOT NULL DEFAULT 0, reminded INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS meeting_items_due ON meeting_items(done, reminded, due)`);
    ready = true;
  }
  return d;
}
const set = (id: string, f: Partial<Row>) => {
  const k = Object.keys(f);
  init().prepare(`UPDATE meetings SET ${k.map((x) => `${x} = ?`).join(", ")} WHERE id = ?`).run(...k.map((x) => (f as Record<string, unknown>)[x] as string | null), id);
};

const validDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10));
const validTz = (tz: unknown) => { try { if (typeof tz === "string" && tz.length < 64) { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } } catch {} return "Asia/Ho_Chi_Minh"; };

/** Tạo cuộc họp từ tệp ghi âm hoặc nội dung ghi chép, rồi chạy xử lý ở nền. */
export function createMeeting(u: UserRow, x: { title?: unknown; date?: unknown; tz?: unknown; transcript?: unknown; model?: unknown }, audio?: { buf: Buffer; name: string; mime: string }) {
  const title = typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, 200) : "Cuộc họp";
  const transcript = typeof x.transcript === "string" ? x.transcript.trim().slice(0, 400_000) : "";
  if (!audio && transcript.length < 30) fail("Hãy tải tệp ghi âm hoặc dán nội dung cuộc họp (ít nhất vài câu).");
  const id = "mt_" + crypto.randomBytes(8).toString("base64url");
  let file: string | null = null;
  if (audio) {
    fs.mkdirSync(DIR(), { recursive: true });
    const ext = (/\.(\w{1,5})$/.exec(audio.name)?.[1] ?? "bin").toLowerCase();
    file = path.join(DIR(), `${id}.${ext}`);
    fs.writeFileSync(file, audio.buf);
  }
  init().prepare("INSERT INTO meetings (id, owner, title, date, tz, status, transcript, audio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, u.id, title, validDate(x.date), validTz(x.tz), audio ? "transcribing" : "summarizing", transcript || null, file ? JSON.stringify({ file, name: audio!.name, mime: audio!.mime }) : null, Date.now());
  const run = startRun(u, "meeting", { meeting: id, model: typeof x.model === "string" ? x.model : undefined });
  set(id, { run });
  return { id, run };
}

const SYSTEM = `<meeting_minutes>
Bạn là thư ký cuộc họp chuyên nghiệp. Từ nội dung cuộc họp (bản chép lời hoặc ghi chép) hãy lập biên bản. CHỈ trả về một đối tượng JSON, không viết gì khác:
{"tomTat": "2-4 câu tóm tắt", "thanhPhan": ["người hoặc bộ phận tham dự"], "noiDung": ["các ý chính đã thảo luận, mỗi ý một câu"], "quyetDinh": ["các quyết định, kết luận"],
 "viec": [{"noiDung": "việc cần làm, bắt đầu bằng động từ", "nguoiPhuTrach": "tên người hoặc bộ phận, không rõ thì để trống", "hanChot": "YYYY-MM-DD hoặc null"}], "cauHoiMo": ["vấn đề chưa chốt"]}
Ngày họp là {DATE}: đổi "thứ Sáu tuần này", "cuối tháng", "ngày 15" thành ngày cụ thể. Không bịa người, việc hay hạn chót không có trong cuộc họp. Viết bằng ngôn ngữ của cuộc họp.
</meeting_minutes>`;

function parseMinutes(raw: string): Minutes {
  const m = /\{[\s\S]*\}/.exec(raw.replace(/```(?:json)?/g, ""));
  if (!m) fail("Model không trả về biên bản đúng định dạng.", 502);
  let o: Record<string, unknown>;
  try { o = JSON.parse(m![0]); } catch { return fail("Model không trả về biên bản đúng định dạng.", 502); }
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 1000)).slice(0, 60) : []);
  const viec = Array.isArray(o.viec) ? (o.viec as Record<string, unknown>[]).filter((v) => v && typeof v.noiDung === "string" && v.noiDung.trim()).slice(0, 80).map((v) => ({
    noiDung: String(v.noiDung).trim().slice(0, 500), nguoiPhuTrach: typeof v.nguoiPhuTrach === "string" ? v.nguoiPhuTrach.trim().slice(0, 120) : "",
    hanChot: typeof v.hanChot === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.hanChot) ? v.hanChot : null })) : [];
  return { tomTat: typeof o.tomTat === "string" ? o.tomTat.trim().slice(0, 3000) : "", thanhPhan: arr(o.thanhPhan), noiDung: arr(o.noiDung), quyetDinh: arr(o.quyetDinh), viec, cauHoiMo: arr(o.cauHoiMo) };
}

// Lượt chạy bền "meeting": chép lời (nếu có tệp) → tóm tắt → lưu biên bản và việc cần làm.
registerExec("meeting", async (body, user) => {
  const id = String(body.meeting ?? "");
  const r = init().prepare("SELECT * FROM meetings WHERE id = ? AND owner = ?").get(id, user.id) as Row | undefined;
  if (!r) return { http: 404, json: { error: "Không tìm thấy cuộc họp." } };
  try {
    let transcript = r.transcript ?? "";
    if (!transcript && r.audio) {
      const a = JSON.parse(r.audio) as { file: string; name: string; mime: string };
      const t = await transcribe(fs.readFileSync(a.file), a.name, a.mime);
      transcript = t.text.trim();
      if (transcript.length < 10) fail("Không nghe được nội dung nào trong tệp ghi âm.");
      set(id, { transcript, engine: t.engine, status: "summarizing" });
      fs.rmSync(a.file, { force: true }); set(id, { audio: null });
    }
    const over = overLimit(user);
    if (over) fail(over, 429);
    const main = mainModels();
    const allowed = (await catalog()).flatMap((p) => p.models.map((m) => m.key)).filter((k) => (main.includes(ALL) || main.includes(k)) && canModel(user, k));
    const model = typeof body.model === "string" && allowed.includes(body.model) ? body.model : pickDefault(await catalog(), main) ?? allowed[0];
    if (!model || !canModel(user, model)) fail("Tài khoản chưa được dùng model nào để tóm tắt cuộc họp.", 403);
    const t = await resolveModel(model!);
    if (!t) fail("Model không còn dùng được.", 400);
    const raw = await usageScope.run({ uid: user.id, feature: "meeting" }, () => chatOnce(t!, SYSTEM.replace("{DATE}", r.date), [{ role: "user", content: `Cuộc họp: ${r.title} (ngày ${r.date})\n\n${transcript.slice(0, 300_000)}` }], 4000));
    const min = parseMinutes(raw);
    const d = init();
    d.transaction(() => {
      d.prepare("DELETE FROM meeting_items WHERE meeting_id = ?").run(id);
      const ins = d.prepare("INSERT INTO meeting_items (id, meeting_id, owner, n, text, assignee, due) VALUES (?, ?, ?, ?, ?, ?, ?)");
      min.viec.forEach((v, i) => ins.run("mi_" + crypto.randomBytes(8).toString("base64url"), id, user.id, i, v.noiDung, v.nguoiPhuTrach, v.hanChot));
      set(id, { minutes: JSON.stringify(min), status: "done", error: null });
    })();
    return { http: 200, json: { meeting: id } };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    set(id, { status: "error", error: msg });
    return { http: e instanceof MeetingError ? e.status : 502, json: { error: msg } };
  }
});

export function listMeetings(uid: string) {
  const d = init();
  return (d.prepare("SELECT id, title, date, status, error, engine, created_at FROM meetings WHERE owner = ? ORDER BY created_at DESC LIMIT 200").all(uid) as Row[]).map((m) => {
    const c = d.prepare("SELECT COUNT(*) AS n, SUM(done) AS done FROM meeting_items WHERE meeting_id = ?").get(m.id) as { n: number; done: number | null };
    return { ...m, items: c.n, done: c.done ?? 0 };
  });
}
export function getMeeting(uid: string, id: string) {
  const d = init();
  const r = d.prepare("SELECT * FROM meetings WHERE id = ? AND owner = ?").get(id, uid) as Row | undefined;
  if (!r) return null;
  const { audio: _a, owner: _o, ...rest } = r;
  return { ...rest, minutes: r.minutes ? (JSON.parse(r.minutes) as Minutes) : null, items: d.prepare("SELECT * FROM meeting_items WHERE meeting_id = ? ORDER BY n").all(id) as Item[] };
}
export function updateItem(uid: string, id: string, x: { done?: unknown; assignee?: unknown; due?: unknown; text?: unknown }) {
  const d = init();
  const it = d.prepare("SELECT * FROM meeting_items WHERE id = ? AND owner = ?").get(id, uid) as Item | undefined;
  if (!it) return fail("Không tìm thấy việc cần làm.", 404);
  const due = x.due === null ? null : typeof x.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.due) ? x.due : it.due;
  d.prepare("UPDATE meeting_items SET done = ?, assignee = ?, due = ?, text = ?, reminded = ? WHERE id = ?").run(
    typeof x.done === "boolean" ? (x.done ? 1 : 0) : it.done, typeof x.assignee === "string" ? x.assignee.slice(0, 120) : it.assignee, due,
    typeof x.text === "string" && x.text.trim() ? x.text.trim().slice(0, 500) : it.text, due !== it.due ? 0 : it.reminded, id);
  return d.prepare("SELECT * FROM meeting_items WHERE id = ?").get(id) as Item;
}
export function deleteMeeting(uid: string, id: string) {
  const d = init();
  const r = d.prepare("SELECT audio FROM meetings WHERE id = ? AND owner = ?").get(id, uid) as { audio: string | null } | undefined;
  if (!r) return false;
  if (r.audio) try { fs.rmSync(JSON.parse(r.audio).file, { force: true }); } catch {}
  d.prepare("DELETE FROM meetings WHERE id = ?").run(id); d.prepare("DELETE FROM meeting_items WHERE meeting_id = ?").run(id);
  return true;
}
export function removeUserMeetings(uid: string) { for (const m of init().prepare("SELECT id FROM meetings WHERE owner = ?").all(uid) as { id: string }[]) deleteMeeting(uid, m.id); }

// Nhắc việc: từ 8 giờ sáng ngày đến hạn (theo múi giờ của cuộc họp), việc chưa xong được nhắc một lần vào Hộp thư.
export function remindDue(now = Date.now()) {
  const d = init();
  const rows = d.prepare(`SELECT i.*, m.title AS mtitle, m.tz AS tz FROM meeting_items i JOIN meetings m ON m.id = i.meeting_id
    WHERE i.done = 0 AND i.reminded = 0 AND i.due IS NOT NULL LIMIT 200`).all() as (Item & { owner: string; mtitle: string; tz: string })[];
  let n = 0;
  for (const it of rows) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: it.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const today = `${p.year}-${p.month}-${p.day}`;
    if (it.due! > today || (it.due === today && Number(p.hour) < 8)) continue;
    if (d.prepare("UPDATE meeting_items SET reminded = 1 WHERE id = ? AND reminded = 0").run(it.id).changes !== 1) continue;
    addNotice(it.owner, `Nhắc việc: ${it.text}`, `${it.due === today ? "Đến hạn hôm nay" : `Đã quá hạn (hạn ${it.due})`}${it.assignee ? ` · Người phụ trách: ${it.assignee}` : ""}\n\nTừ cuộc họp **${it.mtitle}**.`, `meeting:${it.meeting_id}`);
    n++;
  }
  return n;
}
onTick("meetings", (now) => { remindDue(now); });
