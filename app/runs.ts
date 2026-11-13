// Lượt chạy bền (chỉ chạy ở máy chủ): mỗi câu trả lời của chat là một "run" lưu trong SQLite, chạy ở nền,
// không phụ thuộc kết nối của trình duyệt. Trình duyệt theo dõi tiến độ qua /api/runs/<id> (SSE, nối lại được),
// tải lại trang hay đổi máy vẫn nhận đủ kết quả. Máy chủ khởi động lại giữa chừng thì lượt đó được chạy lại từ đầu, trừ khi lượt đã làm việc
// không đọc được kết quả và không nên làm hai lần (gửi thư, tạo hóa đơn: markEffect).
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getSetting, getUser, isAdmin, verifyLocked, type UserRow } from "./authstore";
import { noteRun, recordOps } from "./ops";
import { addSpan, beginTrace, endTrace, noteFirstToken, withTrace } from "./tracing";
import { accountLimit, accountTotal, acquire, noteRefused, queuedOf, queueLimit, withSlot, type WaitWhy } from "./turngate";
import { appliedDelta } from "./turnctx";

// say: lời dẫn của model trước khi dùng công cụ (giữ lại, không bị câu trả lời cuối thay mất); tool / res: công cụ đang chạy và kết quả;
// plan: danh sách việc (JSON); steer: tin người dùng nhắn thêm đã được ghép vào lượt đang chạy; step / note: dòng trạng thái.
// ui: yêu cầu giao diện mở một khung (vd. "browser" khi model bắt đầu dùng trình duyệt).
// ask / asked: lượt đang chờ người dùng duyệt (JSON câu hỏi), và câu trả lời (JSON { id, ok, always }).
export type RunEvent = { seq: number; at: number; kind: "step" | "tool" | "note" | "say" | "res" | "plan" | "steer" | "ui" | "ask" | "asked" | "conn" | "link" | "plans" | "rate" | "tconn"; text: string };
export type RunStatus = "running" | "done" | "error";
type Row = { id: string; user_id: string; conv: string | null; kind: string; status: RunStatus; req: string | null; result: string | null; http: number | null; events: string; created_at: number; updated_at: number; attempts: number; effects?: string | null };
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
    // Việc đã làm có tác động ra ngoài: bảng cũ chưa có cột này (thêm khi mở, không đụng dữ liệu cũ).
    const cols = (d.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("effects")) d.exec("ALTER TABLE runs ADD COLUMN effects TEXT");
    // Lượt của đoạn chat ẩn danh: không giữ yêu cầu, xóa ít phút sau khi xong. Máy chủ vừa khởi động thì mọi lượt ẩn danh đã xong đều đã quá hạn.
    if (!cols.includes("ephemeral")) d.exec("ALTER TABLE runs ADD COLUMN ephemeral INTEGER");
    d.prepare("DELETE FROM runs WHERE ephemeral = 1 AND status != 'running'").run();
    d.prepare("DELETE FROM runs WHERE updated_at < ?").run(Date.now() - KEEP_MS);
    ready = true;
  }
  return d;
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

const pub = (r: Row): PublicRun => ({ id: r.id, status: r.status, conv: r.conv, kind: r.kind, events: JSON.parse(r.events), result: r.result ? JSON.parse(r.result) : null, http: r.http, createdAt: r.created_at, updatedAt: r.updated_at });
export function getRun(id: string, uid?: string): PublicRun | null {
  const r = init().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  return r && (!uid || r.user_id === uid) ? pub(r) : null;
}
export const listRuns = (uid: string, limit = 50) => (init().prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(uid, limit) as Row[]).map(pub);

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
/** Người dùng bấm Dừng: hủy mọi lời gọi đang chạy của lượt; lượt kết thúc với phần đã viết được. */
export function cancelRun(id: string, uid: string): boolean {
  const l = live.get(id);
  if (!l || l.uid !== uid) return false;
  l.ctl.abort();
  return true;
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
/** Ghi một bước của lượt đang chạy (lưu để mở lại trang vẫn thấy đủ) và gửi cho người đang theo dõi. Trả về số thứ tự bước. */
export function progress(kind: RunEvent["kind"], text: string): number {
  const s = scope.getStore();
  if (!s) return 0;
  const d = init();
  const r = d.prepare("SELECT events FROM runs WHERE id = ?").get(s.id) as { events: string } | undefined;
  if (!r) return 0;
  const list = JSON.parse(r.events) as RunEvent[];
  const seq = (list.at(-1)?.seq ?? 0) + 1;
  const ev: RunEvent = { seq, at: Date.now(), kind, text: text.slice(0, kind === "say" || kind === "steer" ? 4000 : kind === "plan" || kind === "ask" ? 6000 : kind === "res" ? 1000 : 300) };
  list.push(ev);
  d.prepare("UPDATE runs SET events = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(list.slice(-400)), Date.now(), s.id);
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
  if (!l || l.uid !== uid || l.ctl.signal.aborted) return false;
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
const gs = globalThis as unknown as { __synchroStopping?: boolean; __synchroStopHook?: boolean };
if (!gs.__synchroStopHook) {
  gs.__synchroStopHook = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { gs.__synchroStopping = true; });
}

function finish(id: string, http: number, json: unknown) {
  if (gs.__synchroStopping && http >= 500) return;
  // Tin nhắn thêm tới khi model đã ở bước trả lời cuối: trả về để trình duyệt gửi ngay thành lượt tiếp theo (không mất tin).
  const left = live.get(id)?.inbox ?? [];
  if (left.length && json && typeof json === "object" && !Array.isArray(json)) json = { ...(json as Record<string, unknown>), steer: left };
  live.delete(id);
  const status: RunStatus = http >= 200 && http < 300 ? "done" : "error";
  // Lượt xong thì bỏ nội dung yêu cầu (có thể chứa ảnh, tệp) cho nhẹ cơ sở dữ liệu.
  init().prepare("UPDATE runs SET status = ?, http = ?, result = ?, req = NULL, updated_at = ? WHERE id = ?").run(status, http, JSON.stringify(json), Date.now(), id);
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
      // Gói này chưa nạp bộ xử lý chat (ví dụ route "Chạy ngay" của tác vụ nền): nạp rồi mới chạy.
      if (!executors.has(kind) && kind === "chat") await import("./chatengine");
      // Việc tự động chạy bằng Synchro Code (tasks.ts): bộ chạy nằm ở taskagent.ts.
      if (!executors.has(kind) && kind === "agent") await import("./taskagent");
      const f = executors.get(kind);
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
export function resumeInterrupted() {
  const d = init();
  const rows = d.prepare("SELECT * FROM runs WHERE status = 'running'").all() as Row[];
  for (const r of rows) {
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
