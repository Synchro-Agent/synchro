// Kho đoạn chat của thiết bị theo tài khoản (blueprint B4). Hai bản cùng một giao diện ChatStore:
// - IdbStore: IndexedDB "synchro-chats:<uid>", mỗi đoạn chat một bản ghi thân (chuỗi serialChat) + một dòng chỉ mục; mỗi lần lưu chỉ ghi phần đổi.
// - LsStore: như từ trước tới nay (cả danh sách trong localStorage u:<uid>:chats), dùng khi trình duyệt không mở được IndexedDB
//   (Firefox riêng tư cũ, Safari riêng tư cũ, vài WebView trong ứng dụng, mở bị treo). Đã rơi về LsStore thì giữ tới hết phiên trang.
// Lỗi của IndexedDB: openChatStore, write, getMeta và importLegacy không bao giờ ném (rơi về LsStore, thử mở lại một lần, trả "error" / "quota" /
// {} cho bên gọi). Các hàm đọc loadIndex / bodies / loadAll và setMeta / clear thì CÓ THỂ từ chối (Error có name: ClosedError khi kho đã đóng
// hoặc không mở lại được, AbortError / lỗi giao dịch khác): bên gọi phải bắt, và không được coi lỗi đọc là kho rỗng.
// Kho bị đóng từ bên ngoài (tab khác xóa / nâng cấp cơ sở dữ liệu, mất kết nối mà mở lại không được): closed = true và gọi onclosed một lần;
// bên gọi chuyển sang LsStore hoặc tải lại trang (mọi lần ghi sau đó trả "error").
// Lõi thuần ở chatidbcore.ts; kiểm thử: tests/api/chatidb.test.mjs (node), tests/ui/chatidb.mjs (trình duyệt thật).
// Trang dùng kho qua app/chatload.ts: mở kho + nhập khóa cũ + đọc chỉ mục lúc mở trang, đọc thân dần ở nền, lưu qua ChatSaver;
// xóa đoạn chat (forget) gọi saver.forget(ids); Cài đặt → xóa chat gọi saver.wipe(); đăng xuất đóng kho trước khi xóa cơ sở dữ liệu.
// Lỗi đọc lúc mở trang (không phải kho rỗng) và kho bị đóng từ bên ngoài (onclosed) thì chatload chuyển sang LsStore;
// LsStore.ignored thì chatsync tải lại từ máy chủ như máy mới, không đánh dấu gì là cần đẩy.
import { MARK_KEY, dbName, diffSave, dropLegacyDue, idxOf, itemHash, legacyMerge, legacyRows, legacySigAsync, ownSig, ownSigOf, parseMark, snapshot, sortIdx, stubOfRow, toWrite, trustLegacy, type IdxRow, type ImportRow } from "./chatidbcore";
import { lastTime, saveFit, stubOf } from "./chatsynccore";
import type { Chat } from "./store";
import { scopedFor } from "./userscope";

export type PutRow = { id: number; s: string; idx: IdxRow };
/** Một lần lưu: put = thân + chỉ mục; idx = chỉ chỉ mục (bản rút gọn đổi tên / ghim…); del = xóa hẳn; drop = bỏ thân ở máy này, giữ chỉ mục (srv). */
export type ChatWrite = { put?: PutRow[]; idx?: IdxRow[]; del?: number[]; drop?: number[] };
/** stubbed: các đoạn đã bị rút gọn (bỏ thân, nội dung còn trên máy chủ) để lần ghi này vừa chỗ. */
export type WriteResult = { status: "ok" | "quota" | "error"; stubbed: number[] };
/**
 * sig: dấu của khóa localStorage cũ đã nhập; migratedAt: lần nhập đầu (giữ khóa cũ thêm 7 ngày từ mốc này);
 * rows: dấu từng dòng của khóa cũ ở lần nhập đó (ImportRow.mark theo id), để lần sau chỉ nhập lại dòng đã đổi.
 */
export type StoreMeta = { sig?: string; migratedAt?: number; rows?: Record<string, string> };
/** Vì sao kho bị đóng từ bên ngoài: versionchange = tab khác xóa / nâng cấp cơ sở dữ liệu; lost = mất kết nối và mở lại không được. */
export type ClosedWhy = "versionchange" | "lost";

export interface ChatStore {
  readonly kind: "idb" | "ls";
  readonly uid: string;
  /** Kho đã đóng (close() hoặc bị đóng từ bên ngoài): mọi lần ghi trả "error", đọc thì từ chối với ClosedError. */
  readonly closed: boolean;
  /** Gọi một lần khi kho bị đóng từ bên ngoài (không gọi khi chính trang close()). */
  onclosed: ((why: ClosedWhy) => void) | null;
  /** Các dòng chỉ mục, mới nhất trước. LsStore phải đọc cả danh sách để có chỉ mục. */
  loadIndex(): Promise<IdxRow[]>;
  /** Thân (chuỗi serialChat) của các id có thân ở máy này; id không có thì vắng trong kết quả. */
  bodies(ids: readonly number[]): Promise<Map<number, string>>;
  /** Mọi đoạn chat đầy đủ (bản rút gọn của máy chủ giữ nguyên dạng rút gọn). Đọc hết thân: chỉ dùng cho LsStore lúc mở trang và xuất dữ liệu. */
  loadAll(): Promise<Chat[]>;
  /** canStub(id): đoạn này đã có trên máy chủ, được rút gọn khi hết chỗ (không bao giờ rút gọn đoạn chưa lên máy chủ). */
  write(w: ChatWrite, canStub?: (id: number) => boolean): Promise<WriteResult>;
  getMeta(): Promise<StoreMeta>;
  setMeta(m: StoreMeta): Promise<void>;
  /** Xóa mọi đoạn chat của tài khoản trên thiết bị (kho vẫn mở). */
  clear(): Promise<void>;
  /** Đóng kết nối (phải đóng trước khi xóa cơ sở dữ liệu lúc đăng xuất, không thì deleteDatabase phải chờ). */
  close(): void;
}

// ------------------------------------------------------------ localStorage (dự phòng)
// s: chuỗi đang lưu (tính lười từ obj); stubS: chuỗi rút gọn, chỉ tính khi hết chỗ, nhớ theo mục (mục đổi là mục mới).
// h / hS: băm của s / stubS (dấu tự ghi), tính lười và nhớ theo mục như s / stubS.
type LsEntry = { s: string | null; obj: Chat | null; idx: IdxRow; stub: boolean; stubS?: string; h?: number; hS?: number };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LsStore implements ChatStore {
  readonly kind = "ls" as const;
  readonly closed = false;
  onclosed: ((why: ClosedWhy) => void) | null = null;
  private rows: Map<number, LsEntry> | null = null;
  private order: number[] = [];
  private stubbed = new Set<number>();
  private meta: StoreMeta = {};
  constructor(readonly uid: string, private st: () => StorageLike = () => localStorage) {}
  private get key() { return scopedFor(this.uid, "chats"); }
  private get markKey() { return scopedFor(this.uid, MARK_KEY); }
  private skip = false;
  /** Đã bỏ qua nội dung khóa cũ lúc đọc (khóa cũ đã chuyển sang IndexedDB, không còn là bản đang dùng): bắt đầu rỗng như máy mới. */
  get ignored() { return this.skip; }
  // Đọc một lần cả danh sách (bản dự phòng: như trước đây). Đối tượng đã đọc thuộc về kho; state React không sửa tại chỗ nên chuỗi tính lại từ đó vẫn đúng.
  // Tài khoản đã chuyển sang IndexedDB trên trình duyệt này (dấu MARK_KEY) mà khóa không phải do LsStore tự ghi sau lần nhập cuối: khóa là bản
  // cũ (thiếu tin mới, còn đoạn đã xóa, tên cũ), bắt đầu rỗng. chatsync lấy lại từ máy chủ mọi mục máy chủ có mà ở đây không có (như máy mới),
  // nên không đẩy bản cũ đè máy chủ. Lần IndexedDB mở lại được sau đó, importLegacy nhập những gì phiên này ghi vào khóa.
  private load() {
    if (this.rows) return this.rows;
    const rows = new Map<number, LsEntry>();
    let list: unknown = [];
    try {
      const raw = this.st().getItem(this.key);
      // Chỉ băm khóa khi có dấu kèm "ls" (đã chuyển và LsStore từng tự ghi): chưa chuyển bao giờ thì không băm gì.
      if (raw !== null && !trustLegacy(parseMark(this.st().getItem(this.markKey)), () => ownSigOf(raw))) this.skip = true;
      else list = JSON.parse(raw || "[]");
    } catch {}
    if (Array.isArray(list)) for (const x of list) {
      const c = x as Chat;
      if (!c || typeof c !== "object" || typeof c.id !== "number" || c.inc || !Array.isArray(c.msgs) || rows.has(c.id)) continue;
      rows.set(c.id, { s: null, obj: c, idx: idxOf(c), stub: !!c.stub });
    }
    this.order = [...rows.keys()];
    return (this.rows = rows);
  }
  private text(e: LsEntry) { return e.s ?? (e.s = JSON.stringify(e.obj)); }
  private chat(e: LsEntry) { return e.obj ?? (e.obj = JSON.parse(this.text(e)) as Chat); }
  async loadIndex() { return sortIdx([...this.load().values()].map((e) => e.idx)); }
  async bodies(ids: readonly number[]) {
    const rows = this.load(), out = new Map<number, string>();
    for (const id of ids) { const e = rows.get(id); if (e && !e.stub) out.set(id, this.text(e)); }
    return out;
  }
  async loadAll() {
    const rows = this.load();
    return this.order.map((id) => rows.get(id)).filter((e): e is LsEntry => !!e).map((e) => this.chat(e));
  }
  async write(w: ChatWrite, canStub?: (id: number) => boolean): Promise<WriteResult> {
    const rows = this.load();
    for (const id of w.del ?? []) { rows.delete(id); this.stubbed.delete(id); }
    for (const p of w.put ?? []) { rows.set(p.id, { s: p.s, obj: null, idx: p.idx, stub: false }); }
    for (const r of w.idx ?? []) {
      const e = rows.get(r.id);
      // Chỉ đổi trường của chỉ mục, giữ nguyên các trường khác của mục đang lưu. Mục đang lưu đủ thân thì vẫn đủ thân (không bao giờ thành rút gọn ở đây).
      const full = !!e && !e.stub;
      const base = e ? this.chat(e) : ({ id: r.id, title: r.title, msgs: [] } as Chat);
      const obj: Chat = { ...base, title: r.title, pinned: r.pinned, project: r.project, tags: r.tags, studio: r.studio, named: r.named, ...(full ? {} : { stub: true }) };
      delete obj.local; delete obj.upd;
      // Mốc sửa của bản rút gọn không bao giờ lùi (bản rút gọn không có tin, mốc tính lại rơi về id).
      rows.set(r.id, { s: null, obj, idx: full ? idxOf(obj) : { ...r, srv: true, upd: Math.max(r.upd, e?.idx.upd ?? 0) }, stub: !full });
    }
    for (const id of w.drop ?? []) {
      const e = rows.get(id);
      if (!e || e.stub) continue;
      const obj = stubOf(this.chat(e)) as Chat;
      rows.set(id, { s: null, obj, idx: { ...idxOf(obj), srv: true, upd: Math.max(e.idx.upd, lastTime(obj)) }, stub: true });
    }
    // Thứ tự lưu: đoạn đã có giữ chỗ cũ, đoạn mới lên đầu (như danh sách trên thanh bên).
    const had = new Set(this.order);
    this.order = [...[...rows.keys()].filter((id) => !had.has(id)).sort((a, b) => b - a), ...this.order.filter((id) => rows.has(id))];
    let wrote: string | null = null;
    const set = (json: string) => { try { this.st().setItem(this.key, json); wrote = json; return true; } catch { return false; } };
    const list = this.order.map((id) => rows.get(id)!);
    let res: WriteResult;
    // Dấu tự ghi từ băm của từng mục (nhớ theo mục): mỗi lần ghi chỉ băm mục mới / đã đổi, không băm lại cả khóa.
    // stubAt(i): phần tử thứ i của chuỗi đã ghi là bản rút gọn (stubS) chứ không phải bản đủ.
    const ownOf = (stubAt: (i: number) => boolean) => () => ownSig(wrote!.length, list.map((e, i) => (stubAt(i) ? (e.hS ??= itemHash(e.stubS!)) : (e.h ??= itemHash(this.text(e))))));
    let own: () => string | null = () => ownSigOf(wrote ?? "");
    if (!this.stubbed.size && set(`[${list.map((e) => this.text(e)).join(",")}]`)) {
      res = { status: "ok", stubbed: [] };
      own = ownOf(() => false);
    } else {
      // Hết chỗ: rút gọn dần đoạn cũ nhất đã có trên máy chủ (saveFit, như chatsync từ trước tới nay). Chuỗi rút gọn chỉ tính ở nhánh này.
      const fit = list.map((e) => ({ key: String(e.idx.id), full: this.text(e), time: e.idx.upd, stub: !e.stub && canStub?.(e.idx.id) ? (e.stubS ??= JSON.stringify(stubOf(this.chat(e)))) : null }));
      const r = saveFit(fit, new Set([...this.stubbed].map(String)), set);
      this.stubbed = new Set([...r.stubbed].map(Number));
      res = { status: r.ok ? "ok" : "quota", stubbed: [...this.stubbed] };
      // Mục nào được ghi bản rút gọn: đúng như json() của saveFit (trong tập đã rút gọn và có bản rút gọn), các mục còn lại ghi bản đủ.
      if (r.ok) own = ownOf((i) => fit[i].stub !== null && r.stubbed.has(fit[i].key));
    }
    if (wrote !== null) this.markOwn(own);
    return res;
  }
  // Tài khoản đã chuyển sang IndexedDB: ghi dấu rằng khóa là bản LsStore tự ghi (lần sau rơi về localStorage được tin, importLegacy sẽ nhập).
  // Chưa chuyển (không có dấu): không tính dấu.
  private markOwn(sig: () => string | null) {
    try {
      const m = parseMark(this.st().getItem(this.markKey));
      const ls = m && sig();
      if (m && ls) this.st().setItem(this.markKey, JSON.stringify({ at: m.at, ls }));
    } catch {}
  }
  async getMeta() { return { ...this.meta }; }
  async setMeta(m: StoreMeta) { this.meta = { ...this.meta, ...m }; }
  async clear() {
    try { this.st().removeItem(this.key); } catch {}
    this.rows = new Map(); this.order = []; this.stubbed.clear();
  }
  close() {}
}

// ------------------------------------------------------------ IndexedDB
const VERSION = 1;
const STORES: [string, string][] = [["body", "id"], ["idx", "id"], ["meta", "k"]];
/** Lỗi "mất kết nối" (iOS sau khi app nằm nền lâu, kết nối bị đóng ngầm): mở lại một lần rồi thử lại. */
const lost = (e: unknown) => { const n = (e as { name?: string } | null)?.name; return n === "InvalidStateError" || n === "UnknownError"; };
// Lỗi nội bộ, không bao giờ hiện cho người dùng: chỉ cần tên để phân nhánh (ClosedError: kho đã đóng / không mở lại được; AbortError: giao dịch bị hủy).
const oops = (name: string) => Object.assign(new Error(), { name });
const CLOSED = "ClosedError";
const quota = (e: unknown) => (e as { name?: string } | null)?.name === "QuotaExceededError";

/** Mở cơ sở dữ liệu; null khi không mở được (ném lỗi, báo lỗi, quá thời gian). Không bao giờ ném. */
export function openDb(f: IDBFactory, name: string, timeout: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let done = false;
    let poke: ReturnType<typeof setInterval> | undefined;
    const end = (db: IDBDatabase | null) => {
      // Mở xong sau khi đã bỏ cuộc (quá thời gian): đóng ngay, không giữ kết nối thừa chặn deleteDatabase.
      if (done) { try { db?.close(); } catch {} return; }
      done = true; clearTimeout(t); if (poke) clearInterval(poke);
      resolve(db);
    };
    const t = setTimeout(() => end(null), timeout);
    let r: IDBOpenDBRequest;
    try { r = f.open(name, VERSION); } catch { end(null); return; }
    r.onupgradeneeded = () => {
      try { const db = r.result; for (const [n, k] of STORES) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: k }); } catch {}
    };
    r.onsuccess = () => {
      const db = r.result;
      // Bản cũ thiếu kho nào đó (không nên xảy ra ở v1): coi như không mở được.
      if (!STORES.every(([n]) => db.objectStoreNames.contains(n))) { try { db.close(); } catch {} end(null); return; }
      end(db);
    };
    r.onerror = (e) => { e?.preventDefault?.(); end(null); };
    // Safari 14.1: open có thể treo tới khi có lời gọi IndexedDB khác; gọi databases() mỗi 100ms tới khi mở xong (cách idb-keyval làm).
    const g = f as IDBFactory & { databases?: () => Promise<unknown> };
    if (typeof g.databases === "function") poke = setInterval(() => { try { void g.databases!().catch(() => {}); } catch {} }, 100);
  });
}

export class IdbStore implements ChatStore {
  readonly kind = "idb" as const;
  private db: IDBDatabase | null;
  private shut = false;
  onclosed: ((why: ClosedWhy) => void) | null = null;
  // Bản sao chỉ mục trong bộ nhớ: chọn đoạn để rút gọn khi hết chỗ mà không phải đọc lại kho. Chỉ sửa theo phần đổi của giao dịch đã xong.
  private idx = new Map<number, IdxRow>();
  // Các lần ghi / đọc chỉ mục chạy lần lượt: hai lần ghi chồng nhau không đè bản sao chỉ mục của nhau.
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly uid: string, db: IDBDatabase, private f: IDBFactory, private timeout = 3000) {
    this.db = db;
    this.watch(db);
  }
  get closed() { return this.shut; }
  private lose(why: ClosedWhy) {
    if (this.shut) return;
    this.shut = true;
    try { this.onclosed?.(why); } catch {}
  }
  private seq<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }
  private watch(db: IDBDatabase) {
    // Tab khác xóa / nâng cấp cơ sở dữ liệu (đăng xuất kèm xóa thiết bị, bản app mới hơn): nhường ngay, không mở lại (mở lại sẽ dựng lại kho
    // vừa bị xóa) và báo onclosed để trang chuyển sang LsStore hoặc tải lại.
    db.onversionchange = () => { try { db.close(); } catch {} this.db = null; this.lose("versionchange"); };
    db.onclose = () => { if (this.db === db) this.db = null; };
  }
  private async conn(): Promise<IDBDatabase> {
    if (this.shut) throw oops(CLOSED);
    if (this.db) return this.db;
    const db = await openDb(this.f, dbName(this.uid), this.timeout);
    // Mở lại không được: đóng hẳn (không để mỗi lần ghi sau lại chờ hết thời gian mở) và báo onclosed.
    if (!db) { this.lose("lost"); throw oops(CLOSED); }
    if (this.shut) { db.close(); throw oops(CLOSED); }
    this.watch(db);
    return (this.db = db);
  }
  /** Một giao dịch; kết nối mất (InvalidStateError / UnknownError) thì mở lại một lần rồi chạy lại cả giao dịch (giao dịch là nguyên khối). */
  private async run<T>(names: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T): Promise<T> {
    const once = async () => {
      const db = await this.conn();
      return new Promise<T>((ok, no) => {
        let t: IDBTransaction, out: T;
        try { t = db.transaction(names, mode); } catch (e) { no(e); return; }
        t.oncomplete = () => ok(out);
        // Lỗi của một yêu cầu (kể cả hết chỗ lúc ghi xong) làm cả giao dịch hủy: báo ở đây. Không preventDefault ở onerror (sẽ chặn việc hủy).
        t.onabort = () => no(t.error ?? oops("AbortError"));
        try { out = fn(t); } catch (e) { try { t.abort(); } catch {} no(e); }
      });
    };
    try { return await once(); } catch (e) {
      if (!lost(e) || this.shut) throw e;
      try { this.db?.close(); } catch {}
      this.db = null;
      return once();
    }
  }
  loadIndex() {
    return this.seq(async () => {
      let rows: IdxRow[] = [];
      await this.run(["idx"], "readonly", (t) => { const r = t.objectStore("idx").getAll() as IDBRequest<IdxRow[]>; r.onsuccess = () => { rows = r.result ?? []; }; });
      this.idx = new Map(rows.map((r) => [r.id, r]));
      return sortIdx(rows);
    });
  }
  async bodies(ids: readonly number[]) {
    const out = new Map<number, string>();
    if (!ids.length) return out;
    await this.run(["body"], "readonly", (t) => {
      const st = t.objectStore("body");
      for (const id of ids) { const r = st.get(id) as IDBRequest<{ id: number; s: string } | undefined>; r.onsuccess = () => { if (r.result) out.set(id, r.result.s); }; }
    });
    return out;
  }
  async loadAll() {
    const rows = await this.loadIndex();
    const b = await this.bodies(rows.filter((r) => !r.srv).map((r) => r.id));
    const out: Chat[] = [];
    for (const r of rows) {
      const s = b.get(r.id);
      let c: Chat | null = null;
      if (s) { try { c = JSON.parse(s) as Chat; } catch {} }
      // Không có thân ở máy này: bản rút gọn của máy chủ (chatsync tải về).
      out.push(c ?? stubOfRow({ ...r, srv: true }));
    }
    return out;
  }
  // Một giao dịch trên body + idx: ghi trọn hoặc không ghi gì. Bản sao chỉ mục chỉ đổi theo phần đổi của giao dịch, sau khi giao dịch xong.
  private async apply(w: ChatWrite): Promise<WriteResult["status"]> {
    if (!w.put?.length && !w.idx?.length && !w.del?.length && !w.drop?.length) return "ok";
    let delta: [number, IdxRow | null][] = [];
    try {
      await this.run(["body", "idx"], "readwrite", (t) => {
        delta = [];
        const b = t.objectStore("body"), x = t.objectStore("idx");
        // Đọc dòng chỉ mục đang có trong chính giao dịch (không tin bản sao trong bộ nhớ), rồi ghi dòng mới.
        const edit = (id: number, fn: (cur: IdxRow | undefined) => IdxRow | null) => {
          const g = x.get(id) as IDBRequest<IdxRow | undefined>;
          g.onsuccess = () => { const r = fn(g.result); if (r) { x.put(r); delta.push([id, r]); } };
        };
        for (const id of w.del ?? []) { b.delete(id); x.delete(id); delta.push([id, null]); }
        for (const p of w.put ?? []) { b.put({ id: p.id, s: p.s }); const r = { ...p.idx }; delete r.srv; x.put(r); delta.push([p.id, r]); }
        // Chỉ ghi chỉ mục và bỏ thân: MỘT lần đọc-ghi cho mỗi id. Đoạn đầy đủ thành bản rút gọn của máy chủ thì diffSave gửi cả dòng chỉ mục lẫn
        // lệnh bỏ thân cho cùng id; hai lần đọc-ghi riêng thì lần bỏ thân đọc dòng cũ (đọc trước khi dòng mới được ghi) rồi ghi đè, mất tên / ghim mới.
        const rows = new Map((w.idx ?? []).map((r) => [r.id, r] as const)), drops = new Set(w.drop ?? []);
        for (const id of drops) b.delete(id);
        for (const id of new Set([...rows.keys(), ...drops])) edit(id, (cur) => {
          const r = rows.get(id);
          let n: IdxRow | null = null;
          // Chỉ ghi chỉ mục: mốc sửa không bao giờ lùi (bản rút gọn không có tin), và không bao giờ làm thân đã bỏ hiện lại (giữ srv).
          if (r) { n = { ...r, upd: Math.max(r.upd, cur?.upd ?? 0) }; if (cur?.srv) n.srv = true; }
          // Bỏ thân: chỉ mục (mới nếu có, không thì dòng đang có) thành bản rút gọn của máy chủ.
          if (drops.has(id)) { n = n ?? (cur ? { ...cur } : null); if (!n) return null; n.srv = true; delete n.run; }
          return n;
        });
      });
    } catch (e) { return quota(e) ? "quota" : "error"; }
    for (const [id, r] of delta) { if (r) this.idx.set(id, r); else this.idx.delete(id); }
    return "ok";
  }
  write(w: ChatWrite, canStub?: (id: number) => boolean): Promise<WriteResult> {
    return this.seq(() => this.fit(w, canStub));
  }
  private async fit(w: ChatWrite, canStub?: (id: number) => boolean): Promise<WriteResult> {
    const st = await this.apply(w);
    if (st !== "quota" || !canStub) return { status: st, stubbed: [] };
    // Hết chỗ: bỏ thân của đoạn cũ nhất đã có trên máy chủ (mỗi lần thêm một phần tư số còn lại, như saveFit), giữ chỉ mục, rồi ghi lại.
    const mine = new Set((w.put ?? []).map((p) => p.id));
    const can = [...this.idx.values()].filter((r) => !r.srv && !mine.has(r.id) && canStub(r.id)).sort((a, b) => a.upd - b.upd).map((r) => r.id);
    const stubbed: number[] = [];
    for (let i = 0; i < can.length;) {
      const step = Math.max(1, Math.ceil((can.length - i) / 4));
      const drop = can.slice(i, i + step);
      i += step;
      if ((await this.apply({ drop })) === "error") return { status: "error", stubbed };
      stubbed.push(...drop);
      const again = await this.apply(w);
      if (again !== "quota") return { status: again, stubbed };
    }
    return { status: "quota", stubbed };
  }
  async getMeta(): Promise<StoreMeta> {
    try {
      let m: StoreMeta | undefined;
      await this.run(["meta"], "readonly", (t) => { const r = t.objectStore("meta").get("legacy") as IDBRequest<StoreMeta | undefined>; r.onsuccess = () => { m = r.result; }; });
      return m ? { ...(m.sig ? { sig: m.sig } : {}), ...(m.migratedAt ? { migratedAt: m.migratedAt } : {}), ...(m.rows && typeof m.rows === "object" ? { rows: m.rows } : {}) } : {};
    } catch { return {}; }
  }
  async setMeta(m: StoreMeta) {
    const cur = await this.getMeta();
    await this.run(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ ...cur, ...m, k: "legacy" }); });
  }
  clear() {
    return this.seq(async () => {
      await this.run(["body", "idx", "meta"], "readwrite", (t) => { for (const n of ["body", "idx", "meta"]) t.objectStore(n).clear(); });
      this.idx = new Map();
      // Khóa localStorage cũ cũng là đoạn chat của tài khoản trên thiết bị: còn thì lần mở sau importLegacy nhập lại các đoạn vừa xóa.
      try { if (typeof localStorage !== "undefined") localStorage.removeItem(scopedFor(this.uid, "chats")); } catch {}
    });
  }
  close() {
    this.shut = true;
    try { this.db?.close(); } catch {}
    this.db = null;
  }
}

// ------------------------------------------------------------ Mở kho
// Đã một lần không mở được IndexedDB trong phiên trang này: các lần mở sau (đổi tài khoản) đi thẳng localStorage, không chờ lại.
let idbDown = false;
export const resetIdbDown = () => { idbDown = false; };

/** Mở kho của tài khoản; không bao giờ ném: IndexedDB không có / lỗi / treo quá timeout thì trả LsStore. idb: chỉ để kiểm thử thay IndexedDB. */
export async function openChatStore(uid: string, opts: { timeout?: number; idb?: IDBFactory | null } = {}): Promise<ChatStore> {
  const f = opts.idb !== undefined ? opts.idb : typeof indexedDB === "undefined" ? null : indexedDB;
  if (!f || idbDown) return new LsStore(uid);
  const timeout = opts.timeout ?? 3000;
  const db = await openDb(f, dbName(uid), timeout);
  if (!db) { idbDown = true; return new LsStore(uid); }
  return new IdbStore(uid, db, f, timeout);
}

// Kho đang dùng của trang (một tài khoản một lúc). Đặt kho mới thì đóng kho cũ.
let current: ChatStore | null = null;
export const currentChatStore = () => current;
export function setChatStore(s: ChatStore | null) {
  if (current && current !== s) current.close();
  current = s;
}

// ------------------------------------------------------------ Chuyển dữ liệu cũ từ localStorage
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
/** Đọc khóa cũ ở luồng chính (dự phòng khi không có luồng phụ): một lần JSON.parse, rồi chia nhỏ phần dựng bản ghi, nhường luồng mỗi 50 đoạn. */
export async function parseLegacyMain(raw: string): Promise<ImportRow[] | null> {
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(list)) return [];
  const out: ImportRow[] = [];
  for (let i = 0; i < list.length; i += 50) {
    if (i) await tick();
    out.push(...legacyRows(list.slice(i, i + 50)));
  }
  return out;
}
export type LegacyParse = (raw: string) => Promise<{ rows: ImportRow[] | null; via: "worker" | "main" }>;
/**
 * Đọc khóa cũ ở luồng phụ (app/chatmigrate.worker.ts), luồng chính chỉ nhận lại chuỗi thân + chỉ mục nhỏ (không JSON.parse vài MB).
 * Không mở được luồng phụ, luồng phụ lỗi hay quá 20 giây thì đọc ở luồng chính (một lần, chỉ lần chuyển dữ liệu đầu sau khi cập nhật).
 */
export const parseLegacy: LegacyParse = (raw) => new Promise((resolve) => {
  const main = () => { void parseLegacyMain(raw).then((rows) => resolve({ rows, via: "main" })); };
  if (typeof Worker === "undefined") { main(); return; }
  let w: Worker;
  try { w = new Worker(new URL("./chatmigrate.worker.ts", import.meta.url)); } catch { main(); return; }
  let done = false;
  const fin = (f: () => void) => { if (done) return; done = true; clearTimeout(t); try { w.terminate(); } catch {} f(); };
  const t = setTimeout(() => fin(main), 20_000);
  w.onmessage = (e: MessageEvent<{ ok: boolean; rows?: ImportRow[] }>) => fin(() => resolve({ rows: e.data?.ok ? (e.data.rows ?? []) : null, via: "worker" }));
  w.onerror = (e) => { e?.preventDefault?.(); fin(main); };
  w.onmessageerror = () => fin(main);
  try { w.postMessage(raw); } catch { fin(main); }
});

/**
 * Nhập khóa localStorage cũ u:<uid>:chats vào IndexedDB, một lần cho mỗi nội dung (so dấu legacySig của cả chuỗi): chỉ thêm / đè, không bao giờ
 * xóa (xóa luôn là lệnh rõ ràng). Khóa cũ đổi (bản app cũ ở tab khác, phiên rơi về LsStore, kiểm thử gieo dữ liệu) thì chỉ nhập lại những dòng
 * đã đổi so với lần nhập trước (legacyMerge), nên sửa chỉ mục ở app mới (đổi tên, ghim…) không bị khóa cũ đè.
 * Lần nhập đầu ghi dấu MARK_KEY ở localStorage (LsStore thôi tin khóa cũ). Khóa cũ giữ 7 ngày từ lần nhập đầu rồi xóa, và chỉ xóa khi nội dung
 * hiện tại đã nhập xong. LsStore: khóa cũ chính là kho, không làm gì. Không bao giờ ném: lỗi kho thì status "error".
 */
export async function importLegacy(store: ChatStore, opts: { now?: number; parse?: LegacyParse; storage?: () => StorageLike } = {}) {
  const res = { imported: 0, removed: false, via: null as "worker" | "main" | null, status: "ok" as WriteResult["status"] };
  if (store.kind !== "idb") return res;
  const st = opts.storage ?? (() => localStorage), key = scopedFor(store.uid, "chats"), now = opts.now ?? Date.now();
  // Dấu cho LsStore khi tài khoản đã chuyển: { at }. Kho IndexedDB đã thấy nội dung khóa hiện tại (hoặc không còn khóa), nên bỏ "ls" (khóa
  // không còn là bản LsStore tự ghi mà IndexedDB chưa nhập). Mất dấu (xóa tay) thì ghi lại. Chỉ ghi khi khác.
  const mark = (at: number) => {
    try {
      const k = scopedFor(store.uid, MARK_KEY), m = parseMark(st().getItem(k));
      if (!m || m.ls !== undefined) st().setItem(k, JSON.stringify({ at: m?.at || at }));
    } catch {}
  };
  try {
    let raw: string | null = null;
    try { raw = st().getItem(key); } catch {}
    let meta = await store.getMeta();
    if (raw === null) { if (meta.migratedAt) mark(meta.migratedAt); return res; }
    const sig = await legacySigAsync(raw, tick);
    if (sig !== meta.sig) {
      const p = await (opts.parse ?? parseLegacy)(raw);
      res.via = p.via;
      const have = new Map((await store.loadIndex()).map((r) => [r.id, r]));
      const base = meta.rows ?? {};
      const rows = (p.rows ?? []).map((r) => legacyMerge(r, have.get(r.id), base[r.id])).filter((r): r is ImportRow => r !== null);
      // Từng đợt 100 đoạn, mỗi đợt một giao dịch: trang đóng giữa chừng thì lần sau nhập lại (thêm / đè nên không sao).
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100);
        const r = await store.write({ put: part.filter((x) => x.s !== null).map((x) => ({ id: x.id, s: x.s!, idx: x.idx })), idx: part.filter((x) => x.s === null).map((x) => x.idx) });
        if (r.status !== "ok") { res.status = r.status; return res; }
        res.imported += part.length;
      }
      // JSON hỏng (p.rows null): không có gì nhập được; vẫn ghi dấu để không đọc lại mỗi lần mở trang.
      const marks: Record<string, string> = {};
      for (const r of p.rows ?? []) marks[r.id] = r.mark;
      await store.setMeta({ sig, migratedAt: meta.migratedAt || now, rows: marks });
      meta = await store.getMeta();
    }
    if (meta.sig === sig && meta.migratedAt) mark(meta.migratedAt);
    if (meta.sig === sig && dropLegacyDue(meta.migratedAt ?? 0, now)) {
      try { st().removeItem(key); res.removed = true; } catch {}
    }
  } catch { res.status = "error"; }
  return res;
}

// ------------------------------------------------------------ Lưu từ trang
/**
 * Lưu danh sách đoạn chat của trang vào kho, chỉ phần đã đổi (diffSave). Xóa rõ ràng (forget: người dùng xóa đoạn chat) được ghi nhận ngay ở
 * đây, không dựa vào meta.gone của chatsync (chatsync bỏ mục khỏi gone ngay khi máy chủ xác nhận, có thể trước lần lưu): nhờ vậy xóa đoạn cuối
 * cùng vẫn xóa khỏi kho dù danh sách rỗng. wipe: xóa hết đoạn chat của tài khoản trên thiết bị (Cài đặt → xóa chat).
 */
export class ChatSaver {
  private prev = new Map<number, Chat>();
  private gone = new Set<number>();
  constructor(readonly store: ChatStore) {}
  /** Danh sách vừa đọc từ kho (đã có trong kho, không cần ghi lại). */
  base(list: readonly Chat[]) { this.prev = snapshot(list); }
  /** Các đoạn chat này đúng như bản trong kho (thân vừa đọc từ kho, chưa sửa ở trang): lần lưu tới không ghi lại. */
  known(list: readonly Chat[]) { for (const c of list) if (!c.inc) this.prev.set(c.id, c); }
  /** Người dùng xóa các đoạn này: lần lưu tới xóa khỏi kho kể cả khi danh sách rỗng. */
  forget(ids: readonly number[]) { for (const id of ids) this.gone.add(id); }
  async save(list: readonly Chat[], canStub?: (id: number) => boolean): Promise<WriteResult> {
    const d = diffSave(this.prev, list, (id) => this.gone.has(id));
    const r = await this.store.write(toWrite(d), canStub);
    // Ghi không được (lỗi, hết chỗ): lần ghi là nguyên khối nên không có gì được ghi; giữ bản trước để lần sau ghi lại đúng phần đổi.
    if (r.status !== "ok") return r;
    const next = snapshot(list);
    // Danh sách rỗng bị chặn (chưa nạp xong…): các mục không xóa vẫn nằm trong kho, giữ chúng trong bản trước.
    if (d.guarded) for (const [id, c] of this.prev) if (!d.del.includes(id)) next.set(id, c);
    // Xóa rõ ràng đã xong (hoặc đoạn chưa từng được lưu): bỏ khỏi danh sách chờ. Đoạn còn trong danh sách (trang chưa cập nhật) thì giữ.
    for (const id of this.gone) if (!next.has(id)) this.gone.delete(id);
    this.prev = next;
    return r;
  }
  async wipe() {
    await this.store.clear();
    this.prev = new Map();
    this.gone.clear();
  }
}
