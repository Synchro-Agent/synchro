"use client";
// Nạp và lưu đoạn chat của thiết bị qua kho app/chatidb.ts (blueprint B4 bước 5-6). Trước đây cả danh sách nằm trong một khóa localStorage,
// mở trang là JSON.parse vài MB ở luồng chính (tài khoản 500 đoạn chat khựng lúc mở) và mỗi lần lưu ghi lại cả danh sách.
// - Mở trang: mở kho của tài khoản, nhập khóa cũ (một lần, luồng phụ), đọc CHỈ MỤC (nhỏ) rồi chỉ đọc thân của các đoạn cần ngay: đoạn còn câu
//   trả lời chạy dở (nối lại lượt), đoạn của địa chỉ #c=, đoạn chưa lên máy chủ (meta.dirty của chatsync). Các đoạn còn lại là bản rút gọn
//   local (thanh bên hiện ngay), thân đọc dần ở nền lúc trang rảnh, mỗi lần ~100 đoạn một lần cập nhật kho; mở đoạn nào thì đọc đoạn đó trước.
// - Lưu: ChatSaver chỉ ghi phần đổi; các lần lưu chạy lần lượt (lần chờ chỉ giữ danh sách mới nhất). Thân vừa đọc từ kho không ghi lại.
// - Rời trang (pagehide / ẩn tab): giao dịch IndexedDB có thể không kịp xong, nên ghi thêm một "nhật ký" nhỏ vào localStorage (chỉ các đoạn
//   chưa lưu xong, thường là đoạn đang mở / đang chạy); lần mở sau áp nhật ký vào kho rồi xóa. Lần lưu sau đó xong thì nhật ký cũng bị xóa.
// - Không mở được IndexedDB / lỗi đọc lúc mở trang (không phải kho rỗng) / kho bị đóng từ bên ngoài: dùng LsStore như trước đây; trừ khi tab
//   khác xóa cơ sở dữ liệu (đăng xuất kèm xóa dữ liệu trên thiết bị): thôi lưu hẳn.
import { create } from "zustand";
import { ChatSaver, LsStore, currentChatStore, importLegacy, openChatStore, setChatStore, type ClosedWhy, type ChatStore, type WriteResult } from "./chatidb";
import { idxOf, snapshot, stubOfRow, withIdx, type IdxRow } from "./chatidbcore";
import { parseMeta, serialChat } from "./chatsynccore";
import { useChatStore } from "./chatstore.client";
import type { Chat } from "./store";
import { scopedFor, userScope } from "./userscope";

/** Chuỗi thân đọc từ kho (đúng chuỗi serialChat đã lưu): chatsync dùng làm bản lưu, không serialChat lại. */
export const bodyStr = new WeakMap<object, string>();
/** Đoạn chat vừa đọc thân từ kho, chưa sửa ở trang: chatsync so như lúc khởi động (startupDirty), không coi là vừa sửa; lần lưu không ghi lại. */
export const localBodies = new WeakSet<object>();
// Thân đã áp trường thanh bên của chỉ mục lúc mở trang → thân đúng như trong kho (lần lưu đầu ghi lại thân đã áp).
const staleOf = new WeakMap<Chat, Chat>();

/** ready: mọi thân đã đọc xong (tìm sâu trong bảng lệnh, Bộ não, thống kê thấy đủ nội dung). kind: kho đang dùng. via: lần nhập khóa cũ chạy ở đâu. */
export type LoadState = { ready: boolean; kind: "idb" | "ls" | null; via: "worker" | "main" | null; imported: number; uid: string | null };
export const useChatLoad = create<LoadState>(() => ({ ready: false, kind: null, via: null, imported: 0, uid: null }));
// Kiểm thử giao diện (tests/ui/chatidb.mjs) đọc trạng thái nạp qua đây.
if (typeof window !== "undefined") (window as unknown as { __chatLoad?: () => LoadState }).__chatLoad = () => useChatLoad.getState();

type Job = { list: readonly Chat[]; canStub?: (id: number) => boolean; mark: number; done: ((r: WriteResult | null) => void)[] };
type Sess = {
  uid: string; store: ChatStore; saver: ChatSaver; dead: boolean;
  /** Kho dự phòng bỏ qua khóa cũ (đã chuyển sang IndexedDB): như máy mới. */
  fresh: boolean;
  /** Bản đã lưu xong gần nhất (theo đối tượng): nhật ký chỉ ghi đoạn khác bản này. */
  committed: Map<number, Chat>;
  gone: Set<number>;
  job: Job | null; running: Promise<void> | null;
  /** Mốc của nhật ký đang có (0: không có); lần lưu xếp hàng sau mốc này mà xong thì xóa nhật ký. */
  journal: number;
  hyd: Promise<void> | null; fast: boolean;
};
let cur: Sess | null = null;
let retiring: Promise<void> = Promise.resolve();
let tick = 0;
const sessFor = (uid: string) => (cur && !cur.dead && cur.uid === uid ? cur : null);

// chatsync lấy về từ máy chủ các đoạn mà thân không còn ở máy này (bản rút gọn local mà kho không có thân).
let needHook: ((ids: number[]) => void) | null = null;
export function onNeedChats(f: (ids: number[]) => void) { needHook = f; return () => { if (needHook === f) needHook = null; }; }

/** Kho dự phòng của tài khoản bỏ qua khóa cũ: chatsync tải lại từ máy chủ như máy mới, không đánh dấu gì là cần đẩy. */
export const freshDevice = (uid: string) => !!sessFor(uid)?.fresh;

function parseBody(s: string, id: number): Chat | null {
  try {
    const c = JSON.parse(s) as Chat;
    if (!c || typeof c !== "object" || c.id !== id || !Array.isArray(c.msgs)) return null;
    bodyStr.set(c, s);
    localBodies.add(c);
    return c;
  } catch { return null; }
}
// Các trường thanh bên (tên, ghim, dự án, thẻ, studio, đã đặt tên) theo cách idxOf chuẩn hóa: so thân với bản rút gọn / dòng chỉ mục.
const sideKey = (c: Chat) => { const r = idxOf(c); return JSON.stringify([r.title, r.pinned ?? false, r.project ?? null, r.tags ?? [], r.studio ?? null, r.named ?? false]); };
/**
 * Thân vừa đọc từ kho thay bản rút gọn local. Trường thanh bên khác nhau: người dùng đã sửa bản rút gọn (đổi tên, ghim, thẻ, dự án) mà lần lưu
 * chỉ ghi chỉ mục (không ghi thân rỗng đè thân thật), kể cả ở phiên trước rồi tải lại trang trước khi thân về. Chỉ mục là bản mới hơn: áp lên
 * thân, và đoạn này là đoạn ĐÃ SỬA (không phải thân đọc từ kho): lần lưu ghi thân, chatsync đẩy lên máy chủ.
 */
function adopt(body: Chat, stub: Chat): Chat {
  if (sideKey(body) === sideKey(stub)) return body;
  localBodies.delete(body); bodyStr.delete(body);
  const out = withIdx(body, stub);
  staleOf.set(out, body);
  return out;
}
const isLocalStub = (c: Chat | undefined) => !!c && !!c.stub && !!c.local;

// ------------------------------------------------------------ Nhật ký lúc rời trang
const JOURNAL = "chatJournal";
const dropJournal = (s: Sess) => { s.journal = 0; try { localStorage.removeItem(scopedFor(s.uid, JOURNAL)); } catch {} };
/** Gọi lúc pagehide / ẩn tab (đồng bộ): ghi các đoạn chưa lưu xong vào localStorage, phòng khi giao dịch IndexedDB bị hủy theo trang. */
export function writeJournal() {
  const s = sessFor(userScope());
  if (!s || s.store.kind !== "idb") return;
  const put: string[] = [];
  for (const c of useChatStore.getState().chats) if (!c.inc && !c.stub && s.committed.get(c.id) !== c && !localBodies.has(c)) put.push(serialChat(c));
  const del = [...s.gone];
  if (!put.length && !del.length) return;
  try { localStorage.setItem(scopedFor(s.uid, JOURNAL), JSON.stringify({ put, del })); s.journal = ++tick; } catch {}
}
async function applyJournal(s: Sess) {
  const key = scopedFor(s.uid, JOURNAL);
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch {}
  if (!raw) return;
  let j: { put?: unknown; del?: unknown } | null = null;
  try { j = JSON.parse(raw); } catch {}
  const put: { id: number; s: string; idx: IdxRow }[] = [];
  if (j && Array.isArray(j.put) && j.put.length) {
    let have: Map<number, number>;
    try { have = new Map((await s.store.loadIndex()).map((r) => [r.id, r.upd])); } catch { return; } // lỗi đọc: giữ nhật ký cho lần sau
    for (const str of j.put) {
      if (typeof str !== "string") continue;
      let c: Chat;
      try { c = JSON.parse(str); } catch { continue; }
      if (!c || typeof c.id !== "number" || !Array.isArray(c.msgs) || c.inc || c.stub) continue;
      const idx = idxOf(c), h = have.get(c.id);
      // Tab khác đã lưu bản mới hơn sau lúc ghi nhật ký: giữ bản trong kho.
      if (h !== undefined && idx.upd < h) continue;
      put.push({ id: c.id, s: str, idx });
    }
  }
  const del = j && Array.isArray(j.del) ? j.del.filter((n): n is number => typeof n === "number") : [];
  if (put.length || del.length) { const r = await s.store.write({ put, del }); if (r.status !== "ok") return; }
  try { localStorage.removeItem(key); } catch {}
}

// ------------------------------------------------------------ Mở trang
/**
 * Mở kho của tài khoản và đọc danh sách cho thanh bên (đoạn cần ngay có thân, còn lại là bản rút gọn local). want: id cần thân ngay (#c=).
 * null: đã đổi tài khoản / có lần nạp mới trong lúc chờ (bỏ kết quả). Không bao giờ ném.
 */
export async function loadChats(uid: string, want: readonly number[] = []): Promise<Chat[] | null> {
  const prev = cur;
  cur = null;
  if (prev) retiring = retire(prev);
  useChatLoad.setState({ ready: false, kind: null, uid });
  await retiring;
  if (userScope() !== uid) return null;
  const store = await openChatStore(uid);
  if (userScope() !== uid || cur) { store.close(); return null; }
  const s: Sess = { uid, store, saver: new ChatSaver(store), dead: false, fresh: false, committed: new Map(), gone: new Set(), job: null, running: null, journal: 0, hyd: null, fast: false };
  cur = s;
  setChatStore(store);
  store.onclosed = (why) => onClosed(s, why);
  if (store.kind === "idb") {
    await applyJournal(s);
    const imp = await importLegacy(store);
    useChatLoad.setState({ via: imp.via, imported: imp.imported });
  }
  let list: Chat[];
  try {
    list = store.kind === "ls" ? await store.loadAll() : await loadLazy(store, uid, want);
  } catch {
    // Lỗi đọc KHÔNG phải kho rỗng: không dựng danh sách rỗng rồi lưu đè; dùng localStorage cho phiên trang này.
    if (s.dead) return null;
    store.onclosed = null;
    const l = new LsStore(uid);
    s.store = l; s.saver = new ChatSaver(l);
    if (currentChatStore() === store) setChatStore(l);
    list = await l.loadAll();
  }
  if (s.dead || userScope() !== uid) return null;
  s.fresh = s.store instanceof LsStore && s.store.ignored;
  s.saver.base(list);
  s.committed = snapshot(list);
  // Thân đã áp chỉ mục: trong kho vẫn là thân cũ, lần lưu tới phải ghi (và nhật ký lúc rời trang có nó).
  const stale = list.flatMap((c) => { const o = staleOf.get(c); return o ? [o] : []; });
  if (stale.length) { s.saver.known(stale); for (const o of stale) s.committed.set(o.id, o); }
  useChatLoad.setState({ kind: s.store.kind, ready: !list.some(isLocalStub) });
  watchOpen();
  return list;
}
async function loadLazy(store: ChatStore, uid: string, want: readonly number[]) {
  const rows = await store.loadIndex();
  const need = new Set<number>(want);
  try { for (const k of Object.keys(parseMeta(localStorage.getItem(scopedFor(uid, "chatSync"))).dirty)) if (k.startsWith("chat:")) need.add(Number(k.slice(5))); } catch {}
  for (const r of rows) if (r.run) need.add(r.id);
  const b = await store.bodies(rows.filter((r) => !r.srv && need.has(r.id)).map((r) => r.id));
  return rows.map((r) => { const t = b.get(r.id), st = stubOfRow(r), c = t !== undefined ? parseBody(t, r.id) : null; return c ? adopt(c, st) : st; });
}

// ------------------------------------------------------------ Đọc thân
type Idle = (f: () => void, o?: { timeout: number }) => number;
const idle = (fast: boolean) => new Promise<void>((r) => {
  const ric = typeof window !== "undefined" ? (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback : undefined;
  if (fast || !ric) setTimeout(r, fast ? 0 : 16); else ric(() => r(), { timeout: 400 });
});
/** Thay bản rút gọn local bằng thân vừa đọc (null: kho không có thân → bản rút gọn của máy chủ, chatsync lấy về). */
function commit(s: Sess, buf: Map<number, Chat | null>) {
  if (!buf.size || s.dead || s.uid !== userScope()) return;
  const lost: number[] = [];
  useChatStore.getState().setChats((cs) => {
    let changed = false;
    const out = cs.map((c) => {
      if (!buf.has(c.id) || !isLocalStub(c)) return c;
      const body = buf.get(c.id);
      changed = true;
      if (!body) { lost.push(c.id); const { local: _l, ...rest } = c; return rest; }
      // Bản rút gọn đã sửa (trong lúc chờ, hay ở phiên trước mà thân chưa ghi): áp lên thân, đoạn này là đoạn đã sửa (chatsync đẩy, lần lưu ghi).
      return adopt(body, c);
    });
    return changed ? out : cs;
  });
  if (lost.length) needHook?.(lost);
}
/** Đọc thân của vài đoạn ngay (mở đoạn chat, chatsync cần đẩy). Lỗi đọc: giữ bản rút gọn (thử lại lần sau). */
export async function hydrateIds(ids: readonly number[]) {
  const s = sessFor(userScope());
  if (!s) return;
  const chats = useChatStore.getState().chats;
  const want = ids.filter((id) => isLocalStub(chats.find((c) => c.id === id)));
  if (!want.length) return;
  let b: Map<number, string>;
  try { b = await s.store.bodies(want); } catch { return; }
  const buf = new Map<number, Chat | null>();
  for (const id of want) { const t = b.get(id); buf.set(id, t !== undefined ? parseBody(t, id) : null); }
  commit(s, buf);
}
/** Đọc dần mọi thân còn lại (mới nhất trước) lúc trang rảnh; fast: không chờ rảnh (xuất dữ liệu, đăng xuất). */
export function hydrateAll(fast = false): Promise<void> {
  const s = sessFor(userScope());
  if (!s) return Promise.resolve();
  if (fast) s.fast = true;
  return (s.hyd ??= runHydrate(s).finally(() => { s.hyd = null; }));
}
async function runHydrate(s: Sess) {
  for (let pass = 0; pass < 5; pass++) {
    if (s.dead) return;
    const ids = useChatStore.getState().chats.filter(isLocalStub).map((c) => c.id).sort((a, b) => b - a);
    if (!ids.length) break;
    const buf = new Map<number, Chat | null>();
    for (let i = 0; i < ids.length; i += 50) {
      await idle(s.fast);
      if (s.dead) return;
      const part = ids.slice(i, i + 50);
      let b: Map<number, string>;
      try { b = await s.store.bodies(part); } catch { return; }
      // Mỗi lát tối đa ~8ms ở luồng chính rồi nhường.
      let t0 = performance.now();
      for (const id of part) {
        const t = b.get(id);
        buf.set(id, t !== undefined ? parseBody(t, id) : null);
        if (performance.now() - t0 > 8) { await idle(s.fast); if (s.dead) return; t0 = performance.now(); }
      }
      // Gộp ~100 đoạn một lần cập nhật kho (thanh bên, chatsync, lần lưu chỉ chạy một lần cho cả nhóm).
      if (buf.size >= 100) { commit(s, buf); buf.clear(); }
    }
    commit(s, buf);
  }
  if (!s.dead && !useChatStore.getState().chats.some(isLocalStub)) useChatLoad.setState({ ready: true });
}
/**
 * Xuất dữ liệu: đọc hết thân còn trong kho (lượt đọc nền dừng ở lần đọc lỗi đầu tiên: thử lại một lần các đoạn còn thiếu). Bản rút gọn local
 * vẫn chưa đọc được thân thì bỏ khỏi bản xuất, không xuất đoạn rỗng như thể đủ; bản rút gọn của máy chủ (hết chỗ) giữ như trước (dấu stub).
 * missing: số đoạn thiếu nội dung trong bản xuất (trang báo người dùng). Không ghi trường nội bộ local / upd.
 */
export async function chatsForExport(): Promise<{ chats: Chat[]; missing: number }> {
  await hydrateAll(true);
  const left = useChatStore.getState().chats.filter(isLocalStub).map((c) => c.id);
  if (left.length) await hydrateIds(left);
  const chats: Chat[] = [];
  let missing = 0;
  for (const c of useChatStore.getState().chats) {
    if (c.inc) continue;
    if (c.stub) { missing++; if (c.local) continue; }
    if (!("local" in c) && !("upd" in c)) { chats.push(c); continue; }
    const { local: _l, upd: _u, ...rest } = c;
    chats.push(rest);
  }
  return { chats, missing };
}
// Mở một đoạn chat còn là bản rút gọn local: đọc thân đoạn đó ngay, không chờ lượt đọc nền.
let watching = false;
function watchOpen() {
  if (watching) return;
  watching = true;
  const go = (id: number | null) => { if (id !== null && isLocalStub(useChatStore.getState().chats.find((c) => c.id === id))) void hydrateIds([id]); };
  useChatStore.subscribe((st, pv) => { if (st.cur !== pv.cur) go(st.cur); });
  go(useChatStore.getState().cur);
}

// ------------------------------------------------------------ Lưu
/** Lưu danh sách (chỉ phần đổi). null: không có kho của tài khoản đang mở (đang nạp, đã đăng xuất). Các lần lưu chạy lần lượt. */
export function saveChats(list: readonly Chat[], canStub?: (id: number) => boolean): Promise<WriteResult | null> {
  const s = sessFor(userScope());
  if (!s) return Promise.resolve(null);
  return new Promise((res) => {
    const mark = ++tick;
    if (s.job) { s.job.list = list; s.job.canStub = canStub; s.job.mark = mark; s.job.done.push(res); }
    else s.job = { list, canStub, mark, done: [res] };
    if (!s.running) s.running = pump(s);
  });
}
async function pump(s: Sess) {
  while (s.job) {
    const j = s.job;
    s.job = null;
    let r: WriteResult | null;
    try {
      s.saver.known(j.list.filter((c) => localBodies.has(c)));
      r = await s.saver.save(j.list, j.canStub);
      if (r.status === "ok") {
        s.committed = snapshot(j.list);
        for (const id of s.gone) if (!s.committed.has(id)) s.gone.delete(id);
        if (s.journal && j.mark > s.journal) dropJournal(s);
      }
    } catch { r = { status: "error", stubbed: [] }; }
    for (const f of j.done) f(r);
  }
  s.running = null;
}
async function drain(s: Sess) { while (s.running) await s.running; }
/** Người dùng xóa các đoạn chat này (kể cả khi máy chủ báo đã xóa ở nơi khác): lần lưu tới xóa khỏi kho. */
export function forgetChats(ids: readonly number[]) {
  const s = sessFor(userScope());
  if (!s) return;
  s.saver.forget(ids);
  for (const id of ids) s.gone.add(id);
}
/** Cài đặt → xóa đoạn chat: xóa mọi đoạn chat của tài khoản trên thiết bị (kho vẫn mở). */
export async function wipeChats() {
  const s = sessFor(userScope());
  if (!s) return;
  await drain(s);
  try { await s.saver.wipe(); } catch {}
  s.committed = new Map(); s.gone.clear(); dropJournal(s);
  useChatLoad.setState({ ready: true });
}
async function retire(s: Sess) {
  s.dead = true;
  await drain(s);
  if (currentChatStore() === s.store) setChatStore(null); else s.store.close();
}
/** Đăng xuất: now = đóng ngay (sắp xóa cơ sở dữ liệu, dữ liệu đã đẩy lên máy chủ); không thì chờ các lần lưu đang chạy xong rồi đóng. */
export function closeChats(now = false): Promise<void> {
  const s = cur;
  cur = null;
  useChatLoad.setState({ ready: false, kind: null, uid: null });
  if (!s) return Promise.resolve();
  if (now) { s.dead = true; if (currentChatStore() === s.store) setChatStore(null); else s.store.close(); return Promise.resolve(); }
  return (retiring = retire(s));
}

// Kho bị đóng từ bên ngoài.
// - deleted: tab khác đăng xuất kèm xóa dữ liệu trên thiết bị (đã xóa u:<uid>:* và cơ sở dữ liệu; phiên đăng nhập chung cookie cũng đã hết).
//   Phiên kho của tab này chết luôn: không lưu gì nữa, KHÔNG chuyển sang localStorage (ghi lại danh sách vào u:<uid>:chats là để lại nội dung
//   chat trên thiết bị mà người dùng vừa xóa). Trang thấy phiên hết hạn ở lần gọi máy chủ tới.
// - versionchange (bản app mới hơn nâng cấp cơ sở dữ liệu) / lost (mất kết nối mà mở lại không được): dùng localStorage cho phần còn lại của
//   phiên. Thân của bản rút gọn local không đọc được nữa: thành bản rút gọn của máy chủ (chatsync lấy về); kho IndexedDB không bị ghi gì thêm.
function onClosed(s: Sess, why: ClosedWhy) {
  if (s.dead || s.store.kind !== "idb") return;
  if (why === "deleted") {
    // Lần lưu đang chờ vẫn chạy và trả "error" (kho đã đóng): không ghi gì, người chờ vẫn nhận kết quả.
    s.dead = true; s.journal = 0;
    if (currentChatStore() === s.store) setChatStore(null);
    useChatLoad.setState({ ready: true, kind: null });
    return;
  }
  const l = new LsStore(s.uid);
  s.store = l; s.saver = new ChatSaver(l); s.saver.base([]); s.committed = new Map(); s.journal = 0;
  setChatStore(l);
  const lost: number[] = [];
  useChatStore.getState().setChats((cs) => (cs.some(isLocalStub) ? cs.map((c) => { if (!isLocalStub(c)) return c; lost.push(c.id); const { local: _l, ...rest } = c; return rest; }) : cs));
  if (lost.length) needHook?.(lost);
  useChatLoad.setState({ kind: "ls", ready: true });
  void saveChats(useChatStore.getState().chats);
}
