// Kho đoạn chat của thiết bị theo tài khoản (blueprint B4). Hai bản cùng một giao diện ChatStore:
// - IdbStore: IndexedDB "synchro-chats:<uid>", mỗi đoạn chat một bản ghi thân (chuỗi serialChat) + một dòng chỉ mục; mỗi lần lưu chỉ ghi phần đổi.
// - LsStore: như từ trước tới nay (cả danh sách trong localStorage u:<uid>:chats), dùng khi trình duyệt không mở được IndexedDB
//   (Firefox riêng tư cũ, Safari riêng tư cũ, vài WebView trong ứng dụng, mở bị treo). Đã rơi về LsStore thì giữ tới hết phiên trang.
// Lỗi của IndexedDB không bao giờ ném ra ngoài: rơi về LsStore, thử mở lại một lần, hoặc trả "error" / "quota" cho bên gọi.
// Lõi thuần ở chatidbcore.ts; kiểm thử: tests/api/chatidb.test.mjs. Chưa nối vào trang (home.tsx / chatsync.ts làm ở vòng sau).
import { dbName, dropLegacyDue, idxOf, legacyRows, legacySig, legacyWins, sortIdx, stubOfRow, type IdxRow, type ImportRow } from "./chatidbcore";
import { saveFit, stubOf } from "./chatsynccore";
import type { Chat } from "./store";
import { scopedFor } from "./userscope";

export type PutRow = { id: number; s: string; idx: IdxRow };
/** Một lần lưu: put = thân + chỉ mục; idx = chỉ chỉ mục (bản rút gọn đổi tên / ghim…); del = xóa hẳn; drop = bỏ thân ở máy này, giữ chỉ mục (srv). */
export type ChatWrite = { put?: PutRow[]; idx?: IdxRow[]; del?: number[]; drop?: number[] };
/** stubbed: các đoạn đã bị rút gọn (bỏ thân, nội dung còn trên máy chủ) để lần ghi này vừa chỗ. */
export type WriteResult = { status: "ok" | "quota" | "error"; stubbed: number[] };
/** sig: dấu của khóa localStorage cũ đã nhập; migratedAt: lần nhập đầu (giữ khóa cũ thêm 7 ngày từ mốc này). */
export type StoreMeta = { sig?: string; migratedAt?: number };

export interface ChatStore {
  readonly kind: "idb" | "ls";
  readonly uid: string;
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
type LsEntry = { s: string | null; obj: Chat | null; idx: IdxRow; stub: boolean; stubS?: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LsStore implements ChatStore {
  readonly kind = "ls" as const;
  private rows: Map<number, LsEntry> | null = null;
  private order: number[] = [];
  private stubbed = new Set<number>();
  private meta: StoreMeta = {};
  constructor(readonly uid: string, private st: () => StorageLike = () => localStorage) {}
  private get key() { return scopedFor(this.uid, "chats"); }
  // Đọc một lần cả danh sách (bản dự phòng: như trước đây). Đối tượng đã đọc thuộc về kho; state React không sửa tại chỗ nên chuỗi tính lại từ đó vẫn đúng.
  private load() {
    if (this.rows) return this.rows;
    const rows = new Map<number, LsEntry>();
    let list: unknown = [];
    try { list = JSON.parse(this.st().getItem(this.key) || "[]"); } catch {}
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
      rows.set(r.id, { s: null, obj, idx: full ? idxOf(obj) : { ...r, srv: true }, stub: !full });
    }
    for (const id of w.drop ?? []) {
      const e = rows.get(id);
      if (!e || e.stub) continue;
      const obj = stubOf(this.chat(e)) as Chat;
      rows.set(id, { s: null, obj, idx: { ...idxOf(obj), srv: true }, stub: true });
    }
    // Thứ tự lưu: đoạn đã có giữ chỗ cũ, đoạn mới lên đầu (như danh sách trên thanh bên).
    const had = new Set(this.order);
    this.order = [...[...rows.keys()].filter((id) => !had.has(id)).sort((a, b) => b - a), ...this.order.filter((id) => rows.has(id))];
    const set = (json: string) => { try { this.st().setItem(this.key, json); return true; } catch { return false; } };
    const list = this.order.map((id) => rows.get(id)!);
    if (!this.stubbed.size && set(`[${list.map((e) => this.text(e)).join(",")}]`)) return { status: "ok", stubbed: [] };
    // Hết chỗ: rút gọn dần đoạn cũ nhất đã có trên máy chủ (saveFit, như chatsync từ trước tới nay). Chuỗi rút gọn chỉ tính ở nhánh này.
    const fit = list.map((e) => ({ key: String(e.idx.id), full: this.text(e), time: e.idx.upd, stub: !e.stub && canStub?.(e.idx.id) ? (e.stubS ??= JSON.stringify(stubOf(this.chat(e)))) : null }));
    const r = saveFit(fit, new Set([...this.stubbed].map(String)), set);
    this.stubbed = new Set([...r.stubbed].map(Number));
    return { status: r.ok ? "ok" : "quota", stubbed: [...this.stubbed] };
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
  private closed = false;
  // Bản sao chỉ mục trong bộ nhớ: chọn đoạn để rút gọn khi hết chỗ mà không phải đọc lại kho.
  private idx = new Map<number, IdxRow>();
  constructor(readonly uid: string, db: IDBDatabase, private f: IDBFactory, private timeout = 3000) {
    this.db = db;
    this.watch(db);
  }
  private watch(db: IDBDatabase) {
    // Tab khác xóa / nâng cấp cơ sở dữ liệu (đăng xuất kèm xóa thiết bị): nhường ngay, không mở lại (mở lại sẽ dựng lại kho vừa bị xóa).
    db.onversionchange = () => { try { db.close(); } catch {} this.db = null; this.closed = true; };
    db.onclose = () => { if (this.db === db) this.db = null; };
  }
  private async conn(): Promise<IDBDatabase> {
    if (this.closed) throw Object.assign(new Error("closed"), { name: "ClosedError" });
    if (this.db) return this.db;
    const db = await openDb(this.f, dbName(this.uid), this.timeout);
    if (!db) throw Object.assign(new Error("reopen failed"), { name: "ClosedError" });
    if (this.closed) { db.close(); throw Object.assign(new Error("closed"), { name: "ClosedError" }); }
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
        t.onabort = () => no(t.error ?? Object.assign(new Error("abort"), { name: "AbortError" }));
        try { out = fn(t); } catch (e) { try { t.abort(); } catch {} no(e); }
      });
    };
    try { return await once(); } catch (e) {
      if (!lost(e) || this.closed) throw e;
      try { this.db?.close(); } catch {}
      this.db = null;
      return once();
    }
  }
  async loadIndex() {
    let rows: IdxRow[] = [];
    await this.run(["idx"], "readonly", (t) => { const r = t.objectStore("idx").getAll() as IDBRequest<IdxRow[]>; r.onsuccess = () => { rows = r.result ?? []; }; });
    this.idx = new Map(rows.map((r) => [r.id, r]));
    return sortIdx(rows);
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
  // Một giao dịch trên body + idx: ghi trọn hoặc không ghi gì.
  private async apply(w: ChatWrite): Promise<WriteResult["status"]> {
    if (!w.put?.length && !w.idx?.length && !w.del?.length && !w.drop?.length) return "ok";
    const next = new Map(this.idx);
    try {
      await this.run(["body", "idx"], "readwrite", (t) => {
        const b = t.objectStore("body"), x = t.objectStore("idx");
        for (const id of w.del ?? []) { b.delete(id); x.delete(id); next.delete(id); }
        for (const p of w.put ?? []) { b.put({ id: p.id, s: p.s }); const r = { ...p.idx }; delete r.srv; x.put(r); next.set(p.id, r); }
        for (const r of w.idx ?? []) { x.put(r); next.set(r.id, r); }
        for (const id of w.drop ?? []) {
          b.delete(id);
          const r = next.get(id);
          if (r) { const s: IdxRow = { ...r, srv: true }; delete s.run; x.put(s); next.set(id, s); }
        }
      });
    } catch (e) { return quota(e) ? "quota" : "error"; }
    this.idx = next;
    return "ok";
  }
  async write(w: ChatWrite, canStub?: (id: number) => boolean): Promise<WriteResult> {
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
      return m ? { ...(m.sig ? { sig: m.sig } : {}), ...(m.migratedAt ? { migratedAt: m.migratedAt } : {}) } : {};
    } catch { return {}; }
  }
  async setMeta(m: StoreMeta) {
    const cur = await this.getMeta();
    await this.run(["meta"], "readwrite", (t) => { t.objectStore("meta").put({ ...cur, ...m, k: "legacy" }); });
  }
  async clear() {
    await this.run(["body", "idx", "meta"], "readwrite", (t) => { for (const n of ["body", "idx", "meta"]) t.objectStore(n).clear(); });
    this.idx = new Map();
  }
  close() {
    this.closed = true;
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
export const parseLegacy: LegacyParse = async (raw) => ({ rows: await parseLegacyMain(raw), via: "main" });

/**
 * Nhập khóa localStorage cũ u:<uid>:chats vào IndexedDB, một lần cho mỗi nội dung (so dấu legacySig): chỉ thêm / đè, không bao giờ xóa
 * (xóa luôn là lệnh rõ ràng). Khóa cũ xuất hiện lại (bản app cũ ở tab khác, kiểm thử gieo dữ liệu) thì dấu khác, nhập lại.
 * Khóa cũ giữ 7 ngày từ lần nhập đầu rồi xóa, và chỉ xóa khi nội dung hiện tại đã nhập xong. LsStore: khóa cũ chính là kho, không làm gì.
 */
export async function importLegacy(store: ChatStore, opts: { now?: number; parse?: LegacyParse; storage?: () => StorageLike } = {}) {
  const res = { imported: 0, removed: false, via: null as "worker" | "main" | null, status: "ok" as WriteResult["status"] };
  if (store.kind !== "idb") return res;
  const st = opts.storage ?? (() => localStorage), key = scopedFor(store.uid, "chats"), now = opts.now ?? Date.now();
  let raw: string | null = null;
  try { raw = st().getItem(key); } catch {}
  if (raw === null) return res;
  const sig = legacySig(raw);
  let meta = await store.getMeta();
  if (sig !== meta.sig) {
    const p = await (opts.parse ?? parseLegacy)(raw);
    res.via = p.via;
    const have = new Map((await store.loadIndex()).map((r) => [r.id, r]));
    const rows = (p.rows ?? []).filter((r) => legacyWins(r, have.get(r.id)));
    // Từng đợt 100 đoạn, mỗi đợt một giao dịch: trang đóng giữa chừng thì lần sau nhập lại (thêm / đè nên không sao).
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100);
      const r = await store.write({ put: part.filter((x) => x.s !== null).map((x) => ({ id: x.id, s: x.s!, idx: x.idx })), idx: part.filter((x) => x.s === null).map((x) => x.idx) });
      if (r.status !== "ok") { res.status = r.status; return res; }
      res.imported += part.length;
    }
    // JSON hỏng (p.rows null): không có gì nhập được; vẫn ghi dấu để không đọc lại mỗi lần mở trang.
    await store.setMeta({ sig, migratedAt: meta.migratedAt || now });
    meta = await store.getMeta();
  }
  if (meta.sig === sig && dropLegacyDue(meta.migratedAt ?? 0, now)) {
    try { st().removeItem(key); res.removed = true; } catch {}
  }
  return res;
}
