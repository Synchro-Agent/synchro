// Lượt chat / tác vụ đang chạy trong tiến trình này (kho SQLite của RunService): chữ model đang viết, bộ hủy, hộp thư nhắn thêm,
// và ngữ cảnh lượt (AsyncLocalStorage) để vòng lặp công cụ gọi progress / delta / runSignal… mà không cần truyền mã lượt đi khắp nơi.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { noteFirstToken } from "../tracing";
import { appliedDelta } from "../../shared/turnctx";
import { StoreView } from "./registry";
import type { Delta, PublicRun, RunEvent } from "./types";

// Người đang theo dõi từng lượt (các kết nối SSE); toàn cục để sống qua lần nạp lại module khi phát triển.
type Msg = { event?: RunEvent; done?: PublicRun; delta?: Delta };
export type Live = { store: "sqlite"; at?: number; s: number; text: string; ctl: AbortController; conv: string | null; uid: string; inbox: string[]; onMsg?: Set<() => void>; step?: AbortController;
  tools?: number; toolsTaken?: number; toolWaiters?: (() => void)[];
  // Lọc dòng ghi chú "Đã áp dụng …" kiểu cũ ngay trên luồng trực tiếp của lượt chat: raw = chữ thô model đã viết ở bước này; applied = đã gặp từ khóa
  // ("áp dụng" / "applied") nên bắt đầu lọc; text giữ bản đã lọc (đúng cái liveNow/liveText trả về). kind = loại lượt (chỉ chat mới lọc).
  kind?: string; raw?: string; applied?: boolean };
const g = globalThis as unknown as { __synchroRunSubs?: Map<string, Set<(e: Msg) => void>> };
const subs = (g.__synchroRunSubs ??= new Map());
// Lượt đang chạy trong tiến trình này: chữ đang viết (để người mở lại trang thấy ngay phần đã có) và bộ hủy. Nằm trong bản đồ lượt chung (registry.ts).
export const live = new StoreView<Live>("sqlite");
export const notify = (id: string, m: Msg) => { for (const f of subs.get(id) ?? []) try { f(m); } catch {} };
export function watch(id: string, f: (m: Msg) => void) {
  const s = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
  s.add(f);
  return () => { s.delete(f); if (!s.size) subs.delete(id); };
}

// Tiến độ của lượt đang chạy: toolLoop gọi progress(...) mà không cần truyền id đi khắp nơi.
// Toàn cục: mỗi route của Next được đóng gói riêng; cầu nối MCP (route khác) chạy công cụ trong ngữ cảnh lượt của route chat.
const gsc = globalThis as unknown as { __synchroRunScope?: AsyncLocalStorage<{ id: string }> };
export const scope = (gsc.__synchroRunScope ??= new AsyncLocalStorage<{ id: string }>());
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

// ---- nhắn thêm khi lượt đang chạy ----
/** Xếp tin nhắn thêm vào hộp thư của lượt đang chạy ở tiến trình này (pushInbox, applyRemote). */
export function pushLocal(l: Live, text: string): boolean {
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
