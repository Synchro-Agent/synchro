// Lượt chạy bền (chỉ chạy ở máy chủ): mỗi câu trả lời của chat là một "run" lưu trong SQLite, chạy ở nền,
// không phụ thuộc kết nối của trình duyệt. Trình duyệt theo dõi tiến độ qua /api/runs/<id> (SSE, nối lại được),
// tải lại trang hay đổi máy vẫn nhận đủ kết quả. Máy chủ khởi động lại giữa chừng thì lượt đó được chạy lại từ đầu, trừ khi lượt đã làm việc
// không đọc được kết quả và không nên làm hai lần (gửi thư, tạo hóa đơn: markEffect).
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getSetting, getUser, isAdmin, setSetting, verifyLocked, type UserRow } from "./authstore";
import { noteRun, recordOps } from "./ops";
import { addSpan, beginTrace, endTrace, noteFirstToken, withTrace } from "./tracing";
import { accountLimit, accountTotal, acquire, noteRefused, queuedOf, queueLimit, withSlot, type WaitWhy } from "./turngate";
import { appliedDelta } from "./turnctx";
import { isStopping, markStopping } from "./drain";

// say: lời dẫn của model trước khi dùng công cụ (giữ lại, không bị câu trả lời cuối thay mất); tool / res: công cụ đang chạy và kết quả;
// plan: danh sách việc (JSON); steer: tin người dùng nhắn thêm đã được ghép vào lượt đang chạy; step / note: dòng trạng thái.
// ui: yêu cầu giao diện mở một khung (vd. "browser" khi model bắt đầu dùng trình duyệt).
// ask / asked: lượt đang chờ người dùng duyệt (JSON câu hỏi), và câu trả lời (JSON { id, ok, always }).
export type RunEvent = { seq: number; at: number; kind: "step" | "tool" | "note" | "say" | "res" | "plan" | "steer" | "ui" | "ask" | "asked" | "conn" | "link" | "plans" | "rate" | "tconn"; text: string };
export type RunStatus = "running" | "done" | "error";
type Row = { id: string; user_id: string; conv: string | null; kind: string; status: RunStatus; req: string | null; result: string | null; http: number | null; events: string; created_at: number; updated_at: number; attempts: number; effects?: string | null; cancel_req?: number | null; steer_req?: string | null; partial?: string | null };
export type PublicRun = { id: string; status: RunStatus; conv: string | null; kind: string; events: RunEvent[]; result: unknown; http: number | null; createdAt: number; updatedAt: number };

// Một lượt chạy giữ tối đa 3 lần chạy lại sau sự cố máy chủ; kết quả giữ 7 ngày rồi dọn.
const MAX_ATTEMPTS = 3;
const KEEP_MS = 7 * 24 * 3600_000;
const REQ_MAX = 8 * 1024 * 1024;
// Đủ để trình duyệt nhận nốt kết quả khi mạng chập chờn; sau đó lượt ẩn danh không còn trên máy chủ.
const EPHEMERAL_MS = 10 * 60_000;

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT, kind TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL, req TEXT, result TEXT, http INTEGER, events TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1)`);
    d.exec("CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at)");
    d.exec("CREATE INDEX IF NOT EXISTS runs_status ON runs(status)");
    // Dọn lượt cũ (updated_at < …) và tìm lượt của một đoạn chat (user_id, conv): không quét cả bảng.
    d.exec("CREATE INDEX IF NOT EXISTS runs_updated ON runs(updated_at)");
    d.exec("CREATE INDEX IF NOT EXISTS runs_conv ON runs(user_id, conv)");
    // Việc đã làm có tác động ra ngoài: bảng cũ chưa có cột này (thêm khi mở, không đụng dữ liệu cũ).
    const cols = (d.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("effects")) d.exec("ALTER TABLE runs ADD COLUMN effects TEXT");
    // Lượt của đoạn chat ẩn danh: không giữ yêu cầu, xóa ít phút sau khi xong. Máy chủ vừa khởi động thì mọi lượt ẩn danh đã xong đều đã quá hạn.
    if (!cols.includes("ephemeral")) d.exec("ALTER TABLE runs ADD COLUMN ephemeral INTEGER");
    // Dừng / nhắn thêm gửi tới tiến trình không chạy lượt đó (deploy xanh/lam: bản cũ đang chạy nốt, nginx đã đưa yêu cầu sang bản mới).
    // Tiến trình đang chạy lượt đọc hai cột này mỗi 1,5 giây (applyRemote).
    if (!cols.includes("cancel_req")) d.exec("ALTER TABLE runs ADD COLUMN cancel_req INTEGER");
    if (!cols.includes("steer_req")) d.exec("ALTER TABLE runs ADD COLUMN steer_req TEXT");
    // Chữ đã viết của lượt còn dở khi tiến trình tắt (persistPartials): lượt đã bấm Dừng được đóng kèm phần chữ này thay vì trống.
    if (!cols.includes("partial")) d.exec("ALTER TABLE runs ADD COLUMN partial TEXT");
    // Các bước của lượt ghi nối thêm (append-only): mỗi bước một dòng, không đọc-sửa-ghi lại cả danh sách mỗi lần (lượt 100 bước
    // không còn chậm dần theo bình phương). Khóa chính (run_id, seq) vừa là số thứ tự bước vừa cho phép lấy MAX(seq) rất nhanh.
    d.exec(`CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
      PRIMARY KEY (run_id, seq))`);
    // Lượt bị xóa (dọn 7 ngày, xóa đoạn chat, lượt ẩn danh, xóa tài khoản): xóa luôn các dòng sự kiện của nó, mọi đường xóa đều qua trigger này.
    d.exec("CREATE TRIGGER IF NOT EXISTS runs_drop_events AFTER DELETE ON runs BEGIN DELETE FROM run_events WHERE run_id = OLD.id; END");
    d.prepare("DELETE FROM runs WHERE ephemeral = 1 AND status != 'running'").run();
    d.prepare("DELETE FROM runs WHERE updated_at < ?").run(Date.now() - KEEP_MS);
    // Chuyển một lần các sự kiện cũ trong cột runs.events sang bảng run_events. Giữ cột cũ thêm một bản phát hành để quay lui được;
    // getRun đọc cột cũ khi run_events chưa có dòng nào cho lượt đó.
    if (getSetting("run_events_migrated", "") !== "1") { migrateEvents(d); setSetting("run_events_migrated", "1"); }
    ready = true;
  }
  return d;
}
/** Sao các sự kiện còn trong cột runs.events sang bảng run_events. Idempotent: INSERT OR IGNORE theo khóa (run_id, seq) nên chạy lại không nhân đôi. */
export function migrateEvents(d = init()): number {
  const rows = d.prepare("SELECT id, events FROM runs WHERE events IS NOT NULL AND events != '[]'").all() as { id: string; events: string }[];
  const ins = d.prepare("INSERT OR IGNORE INTO run_events (run_id, seq, at, kind, text) VALUES (?, ?, ?, ?, ?)");
  let n = 0;
  d.transaction((list: typeof rows) => {
    for (const r of list) {
      let evs: RunEvent[];
      try { evs = JSON.parse(r.events) as RunEvent[]; } catch { continue; }
      for (const e of evs) if (e && typeof e.seq === "number") n += ins.run(r.id, e.seq, e.at ?? Date.now(), e.kind, e.text ?? "").changes;
    }
  })(rows);
  return n;
}
/** Trang quyền riêng tư hứa tự xóa sau 7 ngày: dọn mỗi ngày, không chờ lần khởi động lại. Lượt đang chạy thì không đụng. */
export const sweepRuns = () => { init().prepare("DELETE FROM runs WHERE updated_at < ? AND status != 'running'").run(Date.now() - KEEP_MS); };

// Người đang theo dõi từng lượt (các kết nối SSE); toàn cục để sống qua lần nạp lại module khi phát triển.
// delta: chữ model đang viết ở bước hiện tại (s = số thứ tự bước; reset = bước mới bắt đầu, xóa chữ của bước trước).
export type Delta = { s: number; t?: string; reset?: boolean };
type Msg = { event?: RunEvent; done?: PublicRun; delta?: Delta };
type Live = { at?: number; s: number; text: string; ctl: AbortController; conv: string | null; uid: string; inbox: string[]; onMsg?: Set<() => void>; step?: AbortController;
  tools?: number; toolsTaken?: number; toolWaiters?: (() => void)[];
  // Lọc dòng ghi chú "Đã áp dụng …" kiểu cũ ngay trên luồng trực tiếp của lượt chat: raw = chữ thô model đã viết ở bước này; applied = đã gặp từ khóa
  // ("áp dụng" / "applied") nên bắt đầu lọc; text giữ bản đã lọc (đúng cái liveNow/liveText trả về). kind = loại lượt (chỉ chat mới lọc).
  kind?: string; raw?: string; applied?: boolean };
const g = globalThis as unknown as { __synchroRunSubs?: Map<string, Set<(e: Msg) => void>>; __synchroRunLive?: Map<string, Live> };
const subs = (g.__synchroRunSubs ??= new Map());
// Lượt đang chạy trong tiến trình này: chữ đang viết (để người mở lại trang thấy ngay phần đã có) và bộ hủy.
const live = (g.__synchroRunLive ??= new Map());
const notify = (id: string, m: Msg) => { for (const f of subs.get(id) ?? []) try { f(m); } catch {} };
export function watch(id: string, f: (m: Msg) => void) {
  const s = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
  s.add(f);
  return () => { s.delete(f); if (!s.size) subs.delete(id); };
}

const pub = (r: Row, events: RunEvent[]): PublicRun => ({ id: r.id, status: r.status, conv: r.conv, kind: r.kind, events, result: r.result ? JSON.parse(r.result) : null, http: r.http, createdAt: r.created_at, updatedAt: r.updated_at });
// Các bước của một lượt, theo đúng thứ tự seq tăng dần, tối đa 400 bước gần nhất (như bản cũ cắt list.slice(-400)): lấy 400 seq lớn nhất
// rồi đảo lại. Lượt cũ chưa chuyển sang bảng mới (run_events chưa có dòng) thì đọc cột runs.events như trước để quay lui được.
function eventsOf(d: ReturnType<typeof db>, id: string, oldCol: string | null): RunEvent[] {
  const rows = d.prepare("SELECT seq, at, kind, text FROM run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 400").all(id) as RunEvent[];
  if (rows.length) return rows.reverse();
  return oldCol ? (JSON.parse(oldCol) as RunEvent[]) : [];
}
export function getRun(id: string, uid?: string): PublicRun | null {
  const d = init();
  const r = d.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  return r && (!uid || r.user_id === uid) ? pub(r, eventsOf(d, r.id, r.events)) : null;
}
export const listRuns = (uid: string, limit = 50) => { const d = init(); return (d.prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(uid, limit) as Row[]).map((r) => pub(r, eventsOf(d, r.id, r.events))); };

// Tiến độ của lượt đang chạy: toolLoop gọi progress(...) mà không cần truyền id đi khắp nơi.
// Toàn cục: mỗi route của Next được đóng gói riêng; cầu nối MCP (route khác) chạy công cụ trong ngữ cảnh lượt của route chat.
const gsc = globalThis as unknown as { __synchroRunScope?: AsyncLocalStorage<{ id: string }> };
const scope = (gsc.__synchroRunScope ??= new AsyncLocalStorage<{ id: string }>());
/** Lượt đang chạy ở ngữ cảnh hiện tại (null nếu không có). */
export const currentRun = () => scope.getStore()?.id ?? null;
/** Chạy f trong ngữ cảnh của lượt id (cầu nối MCP nhận lời gọi công cụ ngoài lượt: progress, takeInbox vẫn ghi đúng lượt). */
export const inRun = <T>(id: string | null, f: () => T): T => (id ? scope.run({ id }, f) : f());
/** Lượt hiện tại đã chạy bao lâu kể từ lúc được tạo (null: không ở trong lượt bền, ví dụ việc phụ). */
export const runAge = (): number | null => { const s = scope.getStore(), at = s && live.get(s.id)?.at; return at ? Date.now() - at : null; };
/** Chữ đang viết của lượt (null nếu lượt không chạy trong tiến trình này). */
export const liveText = (id: string) => { const l = live.get(id); return l ? { s: l.s, text: l.text } : null; };
/** Lượt đang chạy của một đoạn chat (để người xem chung nhận chữ đang viết). */
export const liveRunOf = (uid: string, conv: string) => { for (const [id, l] of live) if (l.uid === uid && l.conv === conv) return id; return null; };
/** Chữ đã viết ở bước hiện tại của lượt đang chạy (dùng khi người dùng bấm Dừng giữa chừng). */
export const liveNow = () => { const s = scope.getStore(); return s ? live.get(s.id)?.text ?? "" : ""; };
/** Tín hiệu hủy của lượt đang chạy: truyền vào mọi lời gọi model, connector, chạy code. */
export const runSignal = (): AbortSignal | undefined => { const s = scope.getStore(); return s ? live.get(s.id)?.ctl.signal : undefined; };
// Lời gọi chạy thẳng ở /api/llm không có lượt bền nào: tín hiệu là của chính kết nối. Không gộp vào runSignal vì nơi khác dùng nó để biết có lượt bền (ghi tiến trình, hiện chữ dần).
const gst = globalThis as unknown as { __synchroSyncStop?: AsyncLocalStorage<AbortSignal> };
const syncStop = (gst.__synchroSyncStop ??= new AsyncLocalStorage<AbortSignal>());
export const withStop = <T>(signal: AbortSignal, f: () => T): T => syncStop.run(signal, f);
/** Tín hiệu dừng lời gọi model: của lượt bền, hoặc của kết nối khi chạy thẳng. */
export const turnSignal = (): AbortSignal | undefined => runSignal() ?? syncStop.getStore();
/** Tín hiệu của một lần gọi model trong lượt: hủy khi lượt bị dừng, hoặc khi người dùng nhắn thêm (model đang viết dở thì dừng bước
 *  đó để đọc tin mới ngay, không phải chờ hết câu trả lời). */
export function stepSignal(): AbortSignal | undefined {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l) return undefined;
  const c = new AbortController();
  if (l.ctl.signal.aborted) c.abort(); else l.ctl.signal.addEventListener("abort", () => c.abort(), { once: true });
  l.step = c;
  return c.signal;
}
/** Bước gọi model vừa bị ngắt vì người dùng nhắn thêm (không phải nút Dừng). */
export function steered(): boolean {
  const s = scope.getStore(), l = s && live.get(s.id);
  return !!l && !l.ctl.signal.aborted && !!l.step?.signal.aborted && l.inbox.length > 0;
}
/** Chữ model vừa viết (không ghi vào cơ sở dữ liệu, chỉ gửi cho người đang theo dõi). */
export function delta(t: string) {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l || !t) return;
  noteFirstToken();
  // Lượt chat: dòng "Đã áp dụng hướng dẫn của bạn: “…”" model đôi khi bắt chước (thấy trong lịch sử cũ) từng lộ hướng dẫn cá nhân trên luồng trực tiếp
  // trước khi bản cuối được làm sạch. Lọc ngay ở đây để không ai thấy nó, kể cả trong giây truyền chữ. Các loại lượt khác giữ nguyên (nhanh, không lọc).
  if (l.kind === "chat") {
    l.raw = (l.raw ?? "") + t;
    if (!l.applied && /áp dụng|applied/i.test(l.text.slice(-8) + t)) l.applied = true;
    if (l.applied) {
      const d = appliedDelta(l.text, l.raw);
      l.text = d.text;
      if (d.reset) notify(s!.id, { delta: { s: l.s, t: d.t, reset: true } });
      else if (d.t) notify(s!.id, { delta: { s: l.s, t: d.t } });
      return;
    }
    l.text = l.raw;
    notify(s!.id, { delta: { s: l.s, t } });
    return;
  }
  l.text += t;
  notify(s!.id, { delta: { s: l.s, t } });
}
// Claude Code: chữ model viết đi qua luồng đầu ra của CLI, còn lời gọi công cụ đi qua cầu nối MCP (HTTP) — hai đường riêng. Đoạn chữ ngắn
// ngay trước lời gọi (vd. bản sửa mode="patch" rồi check_artifact) có thể chưa đọc xong khi cầu nối nhận lời gọi: công cụ kiểm tra từng
// thấy bản cũ, model phải viết lại cả tệp. Engine báo mỗi khi luồng đầu ra tới khối tool_use (toolUseSeen); cầu nối chờ tới đó rồi mới chạy.
export function toolUseSeen() {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l) return;
  l.tools = (l.tools ?? 0) + 1;
  for (const f of l.toolWaiters?.splice(0) ?? []) f();
}
/** Chờ luồng đầu ra của CLI tới lời gọi công cụ đang được cầu nối xử lý (tối đa ms). */
export async function awaitToolUse(ms = 2500) {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l) return;
  const want = (l.toolsTaken = (l.toolsTaken ?? 0) + 1);
  if ((l.tools ?? 0) >= want) return;
  await new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    const check = () => { if ((l.tools ?? 0) >= want) { clearTimeout(t); ok(); } else (l.toolWaiters ??= []).push(check); };
    (l.toolWaiters ??= []).push(check);
  });
}
/** Bắt đầu bước mới của vòng lặp công cụ: chữ của bước trước (thường là câu dẫn trước khi gọi công cụ) được thay. */
export function deltaStep() {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l) return;
  l.s++; l.text = ""; l.raw = ""; l.applied = false;
  notify(s!.id, { delta: { s: l.s, reset: true } });
}
/** Người dùng bấm Dừng: hủy mọi lời gọi đang chạy của lượt; lượt kết thúc với phần đã viết được.
 *  Lượt không chạy ở tiến trình này (deploy xanh/lam: bản cũ đang chạy nốt) thì ghi cờ vào cơ sở dữ liệu: tiến trình đang chạy lượt dừng nó
 *  trong vòng 1,5 giây, hoặc nếu tiến trình đó đã thoát thì lượt được kết thúc là đã dừng thay vì bị chạy lại (resumeInterrupted). */
export function cancelRun(id: string, uid: string): boolean {
  const l = live.get(id);
  if (l) {
    if (l.uid !== uid) return false;
    l.ctl.abort();
    return true;
  }
  return init().prepare("UPDATE runs SET cancel_req = 1 WHERE id = ? AND user_id = ? AND status = 'running'").run(id, uid).changes > 0;
}
/** Xóa tài khoản: dừng mọi lượt đang chạy của người này. */
export function cancelUserRuns(uid: string) {
  for (const l of live.values()) if (l.uid === uid) l.ctl.abort();
}
/** Đoạn chat bị xóa: dừng lượt đang chạy và xóa các lượt đã xong của nó (chữ, kết quả, yêu cầu đã lưu). Lượt vừa dừng tự hết hạn cùng các lượt cũ. */
export function deleteConvRuns(uid: string, conv: string) {
  const id = liveRunOf(uid, conv);
  if (id) cancelRun(id, uid);
  return init().prepare("DELETE FROM runs WHERE user_id = ? AND conv = ? AND status != 'running'").run(uid, conv).changes;
}
// Số bước giữ trong cột cũ runs.events (bằng mức cắt của bản trước); bỏ cùng cột cũ ở bản phát hành sau.
const LEGACY_EVENTS = 400;
// Cột cũ chỉ là bản chụp để quay lui được (A4.3, W23-15/R9): ghi lại mỗi LEGACY_EVERY bước, lúc lượt kết thúc (finish) và lúc máy chủ tắt, không ghi lại
// cả mảng 400 bước ở mọi bước (mỗi bước "say" 4000 ký tự thì mỗi lần là ~1,6 MB, đúng thứ run_events ghi nối thêm muốn bỏ).
const LEGACY_EVERY = 20;
/** Chụp 400 bước gần nhất từ run_events vào cột cũ runs.events (đúng hình dạng bản trước đọc: tăng dần theo seq, phần tử cuối cho seq tiếp theo). */
function legacySnapshot(d: ReturnType<typeof init>, id: string) {
  const rows = d.prepare("SELECT seq, at, kind, text FROM run_events WHERE run_id = ? ORDER BY seq DESC LIMIT ?").all(id, LEGACY_EVENTS) as RunEvent[];
  if (rows.length) d.prepare("UPDATE runs SET events = ? WHERE id = ?").run(JSON.stringify(rows.reverse()), id);
}
/** Ghi một bước của lượt đang chạy (lưu để mở lại trang vẫn thấy đủ) và gửi cho người đang theo dõi. Trả về số thứ tự bước. */
export function progress(kind: RunEvent["kind"], text: string): number {
  const s = scope.getStore();
  if (!s) return 0;
  const d = init();
  // Lượt phải còn tồn tại (giữ đúng hành vi cũ: không ghi cho lượt đã bị xóa).
  if (!d.prepare("SELECT 1 FROM runs WHERE id = ?").get(s.id)) return 0;
  // Ghi nối thêm một dòng: lấy số thứ tự tiếp theo qua MAX(seq) (dùng khóa chính nên nhanh, không đọc lại cả danh sách).
  const seq = ((d.prepare("SELECT MAX(seq) AS m FROM run_events WHERE run_id = ?").get(s.id) as { m: number | null }).m ?? 0) + 1;
  const ev: RunEvent = { seq, at: Date.now(), kind, text: text.slice(0, kind === "say" || kind === "steer" ? 4000 : kind === "plan" || kind === "ask" ? 6000 : kind === "res" ? 1000 : 300) };
  d.transaction(() => {
    d.prepare("INSERT INTO run_events (run_id, seq, at, kind, text) VALUES (?, ?, ?, ?, ?)").run(s.id, ev.seq, ev.at, ev.kind, ev.text);
    d.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(ev.at, s.id);
    // Bản chụp cho cột cũ runs.events thêm một bản phát hành để quay lui được (bản cũ đọc cột này, lấy seq tiếp theo từ phần tử cuối).
    if (seq % LEGACY_EVERY === 0) legacySnapshot(d, s.id);
  })();
  notify(s.id, { event: ev });
  return seq;
}

/** Lượt vừa bắt đầu một việc có tác động ra ngoài (connector ghi, thao tác trình duyệt): ghi ngay xuống đĩa, máy chủ khởi động lại thì không chạy lại lượt này. */
export function markEffect(text: string) {
  const s = scope.getStore();
  if (!s) return;
  const d = init();
  const r = d.prepare("SELECT effects FROM runs WHERE id = ?").get(s.id) as { effects: string | null } | undefined;
  if (!r) return;
  const list = (r.effects ? JSON.parse(r.effects) : []) as string[];
  if (!list.includes(text) && list.length < 20) d.prepare("UPDATE runs SET effects = ? WHERE id = ?").run(JSON.stringify([...list, text.slice(0, 160)]), s.id);
}

// ---- nhắn thêm khi lượt đang chạy ----
/** Người dùng nhắn thêm trong lúc lượt đang chạy: xếp vào hộp thư của lượt, vòng lặp công cụ ghép vào ở bước kế tiếp. */
export function pushInbox(id: string, uid: string, text: string): boolean {
  const l = live.get(id);
  // Lượt do tiến trình khác chạy: xếp vào hàng chờ trong cơ sở dữ liệu, tiến trình đó lấy ở nhịp kiểm tra kế tiếp (applyRemote).
  if (!l) return init().prepare("UPDATE runs SET steer_req = json_insert(COALESCE(steer_req, '[]'), '$[#]', ?) WHERE id = ? AND user_id = ? AND status = 'running' AND cancel_req IS NULL")
    .run(text.slice(0, 20_000), id, uid).changes > 0;
  if (l.uid !== uid || l.ctl.signal.aborted) return false;
  return pushLocal(l, text);
}
function pushLocal(l: Live, text: string): boolean {
  l.inbox.push(text.slice(0, 20_000));
  // Thẻ duyệt đang chờ: người dùng trả lời bằng lời thì thẻ phải thôi chờ, không thì tin nhắn nằm im tới khi có người bấm.
  for (const f of l.onMsg ?? []) f();
  // Model đang viết: dừng bước đó để đọc tin mới ngay (vòng lặp ghép tin rồi gọi lại model); đang chạy công cụ thì ghép sau công cụ.
  l.step?.abort();
  return true;
}
/** Báo khi lượt hiện tại có tin nhắn thêm; trả về hàm hủy. */
export function onInbox(f: () => void): () => void {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l) return () => {};
  (l.onMsg ??= new Set()).add(f);
  return () => { l.onMsg?.delete(f); };
}
/** Lượt hiện tại còn tin nhắn thêm chưa đọc. */
export function inboxWaiting(): boolean {
  const s = scope.getStore(), l = s && live.get(s.id);
  return !!l && l.inbox.length > 0;
}
/** Lấy (và xóa) các tin nhắn thêm đang chờ của lượt hiện tại. */
export function takeInbox(): string[] {
  const s = scope.getStore(), l = s && live.get(s.id);
  if (!l || !l.inbox.length) return [];
  return l.inbox.splice(0);
}

export type Exec = (body: Record<string, unknown>, user: UserRow) => Promise<{ http: number; json: unknown }>;
// Toàn cục: mỗi route của Next được đóng gói riêng, bộ chạy đăng ký ở gói này phải thấy được ở gói khác.
const ge = globalThis as unknown as { __synchroExecs?: Map<string, Exec> };
const executors = (ge.__synchroExecs ??= new Map<string, Exec>());
// Mỗi loại lượt (chat, tác vụ nền…) đăng ký hàm chạy của nó; lúc khởi động lại máy chủ dùng để chạy lại lượt dở dang.
export const registerExec = (kind: string, f: Exec) => { executors.set(kind, f); };

// Máy chủ đang tắt (deploy, khởi động lại): lỗi mạng lúc này là do tắt máy, không phải lỗi thật. Giữ lượt ở "đang chạy"
// để lần khởi động sau chạy lại, thay vì ghi một kết quả lỗi.
// Deploy xanh/lam (NEXT_MANUAL_SIG_HANDLE): tiến trình chờ tối đa 25 giây cho lượt đang chạy xong rồi mới thoát (drain.ts); cờ chỉ bật khi hết giờ chờ,
// lỗi 5xx thật trong lúc chờ vẫn được ghi như thường. Không tự lo việc tắt: bật cờ ngay khi nhận tín hiệu và chụp cột cũ (R9) cho mọi lượt đang chạy.
const gs = globalThis as unknown as { __synchroStopHook?: boolean; __synchroLegacyFlush?: () => void };
if (!gs.__synchroStopHook) {
  gs.__synchroStopHook = true;
  if (!process.env.NEXT_MANUAL_SIG_HANDLE) for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { markStopping(); gs.__synchroLegacyFlush?.(); });
}
/** Tắt êm hết giờ chờ (drain.ts): lưu chữ đã viết của các lượt còn dở. Lượt người dùng bấm Dừng mà tiến trình này chưa kịp thấy được đóng
 *  kèm phần chữ này (resumeInterrupted), không hiện trống sau khi tải lại trang. Cũng chụp cột cũ (R9) để bản trước (quay lui) tiếp tục đúng seq. */
export function persistPartials(): number {
  let n = 0;
  gs.__synchroLegacyFlush?.();
  try {
    const st = init().prepare("UPDATE runs SET partial = ? WHERE id = ? AND status = 'running'");
    for (const [id, l] of live) if (l.text) n += st.run(l.text.slice(0, 200_000), id).changes;
  } catch (e) { console.error("[runs]", e); }
  return n;
}
/** Số lượt đang chạy trong tiến trình này (tắt êm chờ số này về 0). */
export const liveRunCount = () => live.size;

// ---- Dừng / nhắn thêm từ tiến trình khác ----
const REMOTE_POLL_MS = Number(process.env.SYNCHRO_REMOTE_POLL_MS) || 1500;
const gr = globalThis as unknown as { __synchroRemotePoll?: ReturnType<typeof setInterval> | null };
/** Chạy khi tiến trình có lượt đang chạy: nhận lệnh Dừng và tin nhắn thêm mà tiến trình khác ghi vào cơ sở dữ liệu cho các lượt của mình. */
function remotePoll() {
  if (gr.__synchroRemotePoll) return;
  gr.__synchroRemotePoll = setInterval(() => {
    if (!live.size) { clearInterval(gr.__synchroRemotePoll ?? undefined); gr.__synchroRemotePoll = null; return; }
    try { applyRemote(); } catch (e) { console.error("[runs]", e); }
  }, REMOTE_POLL_MS);
  gr.__synchroRemotePoll.unref?.();
}
/** Áp lệnh Dừng / tin nhắn thêm đang chờ cho các lượt tiến trình này đang chạy. Trả số lượt đã xử lý. */
export function applyRemote(): number {
  const d = init();
  let n = 0;
  const rows = d.prepare("SELECT id, cancel_req, steer_req FROM runs WHERE status = 'running' AND (cancel_req = 1 OR steer_req IS NOT NULL)").all() as Pick<Row, "id" | "cancel_req" | "steer_req">[];
  for (const r of rows) {
    const l = live.get(r.id);
    if (!l) continue;
    n++;
    if (r.cancel_req) { l.ctl.abort(); continue; }
    const taken = d.transaction(() => {
      const cur = (d.prepare("SELECT steer_req FROM runs WHERE id = ?").get(r.id) as { steer_req: string | null } | undefined)?.steer_req ?? null;
      d.prepare("UPDATE runs SET steer_req = NULL WHERE id = ?").run(r.id);
      return cur;
    }).immediate();
    for (const t of taken ? (JSON.parse(taken) as unknown[]) : []) if (typeof t === "string") pushLocal(l, t);
  }
  return n;
}
// Máy chủ tắt (deploy, quay lui): chụp cột cũ cho mọi lượt đang chạy, để bản trước tiếp tục đúng seq.
gs.__synchroLegacyFlush = () => { for (const id of live.keys()) { try { legacySnapshot(init(), id); } catch { /* bỏ */ } } };

function finish(id: string, http: number, json: unknown) {
  // Bản chụp cuối cho cột cũ (R9), kể cả khi đang tắt (lượt giữ "đang chạy" để chạy lại).
  try { legacySnapshot(init(), id); } catch { /* dự phòng quay lui */ }
  if (isStopping() && http >= 500) return;
  // Tin nhắn thêm tới khi model đã ở bước trả lời cuối (kể cả tin gửi qua tiến trình khác chưa kịp lấy): trả về để trình duyệt gửi ngay thành lượt tiếp theo.
  // Đọc hàng chờ nhắn thêm và đóng lượt trong cùng một giao dịch IMMEDIATE: tiến trình khác không chen tin vào giữa (tin đó sẽ mất),
  // vì pushInbox chỉ ghi khi lượt còn "running".
  const d = init(), inbox = live.get(id)?.inbox ?? [];
  live.delete(id);
  const status: RunStatus = http >= 200 && http < 300 ? "done" : "error";
  d.transaction(() => {
    const remote = (d.prepare("SELECT steer_req FROM runs WHERE id = ?").get(id) as { steer_req: string | null } | undefined)?.steer_req;
    const left = [...inbox, ...(remote ? (JSON.parse(remote) as unknown[]).filter((t): t is string => typeof t === "string") : [])];
    if (left.length && json && typeof json === "object" && !Array.isArray(json)) json = { ...(json as Record<string, unknown>), steer: left };
    // Lượt xong thì bỏ nội dung yêu cầu (có thể chứa ảnh, tệp) cho nhẹ cơ sở dữ liệu.
    d.prepare("UPDATE runs SET status = ?, http = ?, result = ?, req = NULL, steer_req = NULL, partial = NULL, updated_at = ? WHERE id = ?").run(status, http, JSON.stringify(json), Date.now(), id);
  }).immediate();
  const r = getRun(id);
  if (r) notify(id, { done: r });
  const raw = init().prepare("SELECT user_id, conv, ephemeral FROM runs WHERE id = ?").get(id) as { user_id: string; conv: string | null; ephemeral: number | null } | undefined;
  if (raw?.ephemeral) setTimeout(() => dropEphemeral(id, raw.user_id, raw.conv), Number(process.env.SYNCHRO_EPHEMERAL_MS) || EPHEMERAL_MS).unref?.();
}
/** Xóa lượt ẩn danh đã xong và kết quả công cụ lớn lưu kèm nó. */
function dropEphemeral(id: string, uid: string, conv: string | null) {
  const d = init();
  d.prepare("DELETE FROM runs WHERE id = ? AND status != 'running'").run(id);
  if (conv) try { d.prepare("DELETE FROM tool_refs WHERE user_id = ? AND conv = ?").run(uid, conv); } catch { /* chưa có bảng */ }
}

// Chờ quá lâu nghĩa là các lượt trước đang kẹt: báo để người dùng quyết, không treo mãi.
const QUEUE_WAIT_MS = 30 * 60_000;
export const WAIT_NOTE: Record<WaitWhy, string> = {
  account: "Tài khoản của bạn đang chạy nhiều lượt cùng lúc. Lượt này đang xếp hàng và sẽ tự chạy khi có lượt xong.",
  server: "Máy chủ đang bận. Lượt này đang xếp hàng và sẽ tự chạy khi có chỗ.",
};
/** Quản trị viên chỉnh riêng cho một tài khoản qua cài đặt turns_limit:<id> (không có giao diện, dùng khi cần nới cho một người). Tài khoản chưa xác minh email: một nửa, để đăng ký hàng loạt tốn nhiều hơn. */
export const turnsLimit = (user: UserRow) => Number(getSetting(`turns_limit:${user.id}`, "")) || (verifyLocked(user) ? Math.max(1, Math.ceil(accountLimit() / 2)) : accountLimit() * (isAdmin(user) ? 3 : 1));
// Việc phụ chạy thẳng (đặt tên, gợi ý, phản biện…): một tài khoản không cần nhiều hơn chừng này cùng lúc. Tài khoản chưa xác minh giữ đúng mức một nửa: bỏ async:true từng lấy lại đủ 6 chỗ.
const QUICK_MAX = 6;
export const quickLimit = (user: UserRow) => (verifyLocked(user) ? turnsLimit(user) : Math.max(QUICK_MAX, turnsLimit(user)));
/** Tổng số lượt của tài khoản trên mọi làn. Có mức riêng hoặc chưa xác minh thì theo turnsLimit; quản trị viên giữ mức gấp ba của mình. */
export const turnsTotal = (user: UserRow) => (getSetting(`turns_limit:${user.id}`, "") || verifyLocked(user) ? turnsLimit(user) : Math.max(turnsLimit(user), accountTotal()));
/** Tài khoản đã xếp đầy hàng chờ: /api/llm từ chối ngay. Lượt của việc tự động và lượt khôi phục sau khởi động lại không qua đây, chúng luôn được xếp hàng. */
export function queueFull(uid: string) {
  const own = Number(getSetting(`turns_limit:${uid}`, ""));
  if (queuedOf(uid) < (own ? own * 2 : queueLimit())) return false;
  noteRefused();
  return true;
}

function launch(id: string, kind: string, body: Record<string, unknown>, user: UserRow, conv: string | null, seed?: { at: number; authMs: number }) {
  const ctl = new AbortController();
  live.set(id, { at: Date.now(), s: 0, text: "", ctl, conv, uid: user.id, inbox: [], kind });
  remotePoll();
  // Lượt chat: đo từng chặng (tracing.ts). Lượt chạy lại sau khi máy chủ khởi động không có seed (không đo được phần kiểm tra phiên).
  const tr = kind === "chat" ? beginTrace("chat", seed) : null;
  const go = (f: () => void) => (tr ? withTrace(tr, f) : f());
  scope.run({ id }, () => go(() => {
    (async () => {
      const q0 = Date.now();
      const slot = await acquire({ uid: user.id, lane: "run", limit: turnsLimit(user), total: turnsTotal(user), signal: ctl.signal, maxWaitMs: QUEUE_WAIT_MS, onWait: (w) => progress("note", WAIT_NOTE[w]) });
      addSpan("queue", "queue", q0);
      if (slot === "cancelled") return { http: 200, json: { text: "", cancelled: true } };
      if (slot === "timeout") return { http: 503, json: { error: "Lượt này đã xếp hàng quá lâu nên Synchro dừng lại. Hãy dừng bớt lượt đang chạy rồi gửi lại." } };
      return await withSlot(slot, async () => {
      // Lượt chat: luôn dùng chatengine của chính gói này (import có bộ nhớ đệm; gói chưa nạp như route "Chạy ngay" của tác vụ nền thì nạp lúc này),
      // không dùng hàm ghi sau cùng vào bảng toàn cục. Bản dev (turbopack) biên dịch route mới là dựng thêm một bộ mô-đun riêng; hàm chat của bộ đó
      // từng hỏng phần phụ thuộc ("expandFileRefs is not a function") mà vẫn đè lên bảng chung, khiến mọi lượt chat sau đó lỗi 502 tới khi khởi động lại.
      // Gói nào có runs.ts cũng nạp được chatengine (import động ngay đây), nên production chạy như trước. Không nạp được (bộ kiểm thử dịch
      // riêng từng tệp, không có đường import động) thì dùng bộ chạy đã đăng ký như cũ.
      // Việc tự động chạy bằng Synchro Code (tasks.ts): bộ chạy nằm ở taskagent.ts.
      if (!executors.has(kind) && kind === "agent") await import("./taskagent");
      const own = kind === "chat" ? await import("./chatengine").then((m) => m.chatExec, (e) => { console.error("[runs] không nạp được chatengine, dùng bộ chạy đã đăng ký", e); return undefined; }) : undefined;
      const f = own ?? executors.get(kind);
      if (!f) return { http: 500, json: { error: `Không có bộ chạy cho loại "${kind}".` } };
      return await f(body, user);
      });
    })().then((r) => { if (tr) endTrace(tr, r.http); noteRun(kind, body.model, r.http, r.json); finish(id, r.http, r.json); }, (e) => { if (tr) endTrace(tr, 502); recordOps("server", `run ${kind}: ${String((e as Error)?.message ?? e)}`); finish(id, 502, { error: String((e as Error)?.message ?? e) }); });
  }));
}

/** Tạo lượt mới và chạy ngay ở nền; trả về id để trình duyệt theo dõi. */
/** seed: lúc yêu cầu tới và thời gian kiểm tra phiên (route /api/llm), để đo độ trễ từ đầu. */
export function startRun(user: UserRow, kind: string, body: Record<string, unknown>, conv?: string | null, seed?: { at: number; authMs: number }): string {
  const id = "run_" + crypto.randomBytes(12).toString("base64url");
  const raw = JSON.stringify(body);
  const now = Date.now();
  const eph = body.incognito === true;
  init().prepare("INSERT INTO runs (id, user_id, conv, kind, status, req, events, created_at, updated_at, ephemeral) VALUES (?, ?, ?, ?, 'running', ?, '[]', ?, ?, ?)")
    .run(id, user.id, conv ?? null, kind, !eph && raw.length <= REQ_MAX ? raw : null, now, now, eph ? 1 : null);
  launch(id, kind, body, user, conv ?? null, seed);
  return id;
}

/** Gọi một lần lúc máy chủ khởi động: lượt đang chạy dở khi máy chủ tắt được chạy lại (tối đa MAX_ATTEMPTS lần). */
// Deploy xanh/lam: tiến trình này phục vụ yêu cầu (là secondary) từ trước khi nhận vai primary, nên lượt nó đang chạy không phải lượt dở dang.
export function resumeInterrupted() {
  const d = init();
  const rows = (d.prepare("SELECT * FROM runs WHERE status = 'running'").all() as Row[]).filter((r) => !live.has(r.id));
  for (const r of rows) {
    // Người dùng đã bấm Dừng trong lúc tiến trình cũ chạy nốt lượt này: kết thúc là đã dừng, không chạy lại.
    if (r.cancel_req) { finish(r.id, 200, { text: r.partial ?? "", cancelled: true }); continue; }
    const user = getUser(r.user_id);
    if (!r.req || !user || r.attempts >= MAX_ATTEMPTS) { finish(r.id, 503, { error: "Lượt trả lời bị gián đoạn khi máy chủ khởi động lại. Hãy gửi lại tin nhắn." }); continue; }
    // Chạy lại từ đầu có thể gửi thư, tạo hóa đơn lần hai: dừng ở đây, nói rõ đã làm gì để người dùng kiểm tra.
    const done = r.effects ? (JSON.parse(r.effects) as string[]) : [];
    if (done.length) { finish(r.id, 503, { error: `Máy chủ khởi động lại khi lượt này đang chạy. Lượt đã bắt đầu: ${done.slice(0, 3).join("; ")}. Synchro không tự chạy lại để tránh làm hai lần. Hãy kiểm tra kết quả rồi nhắn tiếp nếu cần.`, partialWork: true }); continue; }
    d.prepare("UPDATE runs SET attempts = attempts + 1, updated_at = ? WHERE id = ?").run(Date.now(), r.id);
    scope.run({ id: r.id }, () => progress("note", "Máy chủ vừa khởi động lại, Synchro đang chạy lại lượt này"));
    launch(r.id, r.kind, JSON.parse(r.req), user, r.conv);
  }
  return rows.length;
}
