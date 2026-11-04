// Lượt chạy bền (chỉ chạy ở máy chủ): mỗi câu trả lời của chat là một "run" lưu trong SQLite, chạy ở nền,
// không phụ thuộc kết nối của trình duyệt. Trình duyệt theo dõi tiến độ qua /api/runs/<id> (SSE, nối lại được),
// tải lại trang hay đổi máy vẫn nhận đủ kết quả. Máy chủ khởi động lại giữa chừng thì lượt đó được chạy lại từ đầu, trừ khi lượt đã làm việc
// không đọc được kết quả và không nên làm hai lần (gửi thư, tạo hóa đơn: markEffect).
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getUser, type UserRow } from "./authstore";

// say: lời dẫn của model trước khi dùng công cụ (giữ lại, không bị câu trả lời cuối thay mất); tool / res: công cụ đang chạy và kết quả;
// plan: danh sách việc (JSON); steer: tin người dùng nhắn thêm đã được ghép vào lượt đang chạy; step / note: dòng trạng thái.
// ui: yêu cầu giao diện mở một khung (vd. "browser" khi model bắt đầu dùng trình duyệt).
// ask / asked: lượt đang chờ người dùng duyệt (JSON câu hỏi), và câu trả lời (JSON { id, ok, always }).
export type RunEvent = { seq: number; at: number; kind: "step" | "tool" | "note" | "say" | "res" | "plan" | "steer" | "ui" | "ask" | "asked"; text: string };
export type RunStatus = "running" | "done" | "error";
type Row = { id: string; user_id: string; conv: string | null; kind: string; status: RunStatus; req: string | null; result: string | null; http: number | null; events: string; created_at: number; updated_at: number; attempts: number; effects?: string | null };
export type PublicRun = { id: string; status: RunStatus; conv: string | null; kind: string; events: RunEvent[]; result: unknown; http: number | null; createdAt: number; updatedAt: number };

// Một lượt chạy giữ tối đa 3 lần chạy lại sau sự cố máy chủ; kết quả giữ 7 ngày rồi dọn.
const MAX_ATTEMPTS = 3;
const KEEP_MS = 7 * 24 * 3600_000;
const REQ_MAX = 8 * 1024 * 1024;

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
    if (!(d.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).some((c) => c.name === "effects")) d.exec("ALTER TABLE runs ADD COLUMN effects TEXT");
    d.prepare("DELETE FROM runs WHERE updated_at < ?").run(Date.now() - KEEP_MS);
    ready = true;
  }
  return d;
}

// Người đang theo dõi từng lượt (các kết nối SSE); toàn cục để sống qua lần nạp lại module khi phát triển.
// delta: chữ model đang viết ở bước hiện tại (s = số thứ tự bước; reset = bước mới bắt đầu, xóa chữ của bước trước).
export type Delta = { s: number; t?: string; reset?: boolean };
type Msg = { event?: RunEvent; done?: PublicRun; delta?: Delta };
type Live = { s: number; text: string; ctl: AbortController; conv: string | null; uid: string; inbox: string[]; step?: AbortController;
  tools?: number; toolsTaken?: number; toolWaiters?: (() => void)[] };
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
/** Chữ đang viết của lượt (null nếu lượt không chạy trong tiến trình này). */
export const liveText = (id: string) => { const l = live.get(id); return l ? { s: l.s, text: l.text } : null; };
/** Lượt đang chạy của một đoạn chat (để người xem chung nhận chữ đang viết). */
export const liveRunOf = (uid: string, conv: string) => { for (const [id, l] of live) if (l.uid === uid && l.conv === conv) return id; return null; };
/** Chữ đã viết ở bước hiện tại của lượt đang chạy (dùng khi người dùng bấm Dừng giữa chừng). */
export const liveNow = () => { const s = scope.getStore(); return s ? live.get(s.id)?.text ?? "" : ""; };
/** Tín hiệu hủy của lượt đang chạy: truyền vào mọi lời gọi model, connector, chạy code. */
export const runSignal = (): AbortSignal | undefined => { const s = scope.getStore(); return s ? live.get(s.id)?.ctl.signal : undefined; };
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
  l.s++; l.text = "";
  notify(s!.id, { delta: { s: l.s, reset: true } });
}
/** Người dùng bấm Dừng: hủy mọi lời gọi đang chạy của lượt; lượt kết thúc với phần đã viết được. */
export function cancelRun(id: string, uid: string): boolean {
  const l = live.get(id);
  if (!l || l.uid !== uid) return false;
  l.ctl.abort();
  return true;
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
  const ev: RunEvent = { seq, at: Date.now(), kind, text: text.slice(0, kind === "say" || kind === "steer" ? 4000 : kind === "plan" || kind === "ask" ? 6000 : 300) };
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
  // Model đang viết: dừng bước đó để đọc tin mới ngay (vòng lặp ghép tin rồi gọi lại model); đang chạy công cụ thì ghép sau công cụ.
  l.step?.abort();
  return true;
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
}

function launch(id: string, kind: string, body: Record<string, unknown>, user: UserRow, conv: string | null) {
  live.set(id, { s: 0, text: "", ctl: new AbortController(), conv, uid: user.id, inbox: [] });
  scope.run({ id }, () => {
    (async () => {
      // Gói này chưa nạp bộ xử lý chat (ví dụ route "Chạy ngay" của tác vụ nền): nạp rồi mới chạy.
      if (!executors.has(kind) && kind === "chat") await import("./chatengine");
      // Việc tự động chạy bằng Synchro Code (tasks.ts): bộ chạy nằm ở taskagent.ts.
      if (!executors.has(kind) && kind === "agent") await import("./taskagent");
      const f = executors.get(kind);
      if (!f) return { http: 500, json: { error: `Không có bộ chạy cho loại "${kind}".` } };
      return f(body, user);
    })().then((r) => finish(id, r.http, r.json), (e) => finish(id, 502, { error: String((e as Error)?.message ?? e) }));
  });
}

/** Tạo lượt mới và chạy ngay ở nền; trả về id để trình duyệt theo dõi. */
export function startRun(user: UserRow, kind: string, body: Record<string, unknown>, conv?: string | null): string {
  const id = "run_" + crypto.randomBytes(12).toString("base64url");
  const raw = JSON.stringify(body);
  const now = Date.now();
  init().prepare("INSERT INTO runs (id, user_id, conv, kind, status, req, events, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, '[]', ?, ?)")
    .run(id, user.id, conv ?? null, kind, raw.length <= REQ_MAX ? raw : null, now, now);
  launch(id, kind, body, user, conv ?? null);
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
