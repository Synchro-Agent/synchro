// IndexedDB giả trong bộ nhớ cho kiểm thử không cần trình duyệt (dự án không có fake-indexeddb). Chỉ có phần app/chatidb.ts dùng:
// open (onupgradeneeded / onsuccess / onerror), createObjectStore(keyPath), transaction → objectStore → put / get / getAll / delete / clear,
// oncomplete / onabort, deleteDatabase (báo onversionchange cho kết nối đang mở, newVersion null). Giao dịch là nguyên khối: hủy thì không ghi gì.
// upgrade(name): tab khác mở bản cơ sở dữ liệu mới hơn (báo onversionchange với newVersion là số cho kết nối đang mở).
// Điều khiển lỗi để thử các nhánh dự phòng:
//   quota     : tổng dung lượng (độ dài JSON) vượt mức thì giao dịch ghi bị hủy với QuotaExceededError lúc ghi xong.
//   throwOpen : open ném ngay (Firefox riêng tư cũ). failOpen: open báo lỗi. hangOpen: open không bao giờ xong (Safari 14.1).
//   loseNext  : số lần transaction() tới ném InvalidStateError (iOS mất kết nối sau khi nằm nền).
// puts / deleted: đếm số lần put theo kho và các tên cơ sở dữ liệu đã xóa.
const later = (f) => setTimeout(f, 0);
const err = (name, msg = name) => new DOMException(msg, name);

export function fakeIDB(o = {}) {
  const ctl = { quota: Infinity, throwOpen: false, failOpen: false, hangOpen: false, loseNext: 0, puts: {}, deleted: [], ...o };
  const dbs = new Map();
  const sizeOf = (stores) => { let n = 0; for (const s of stores.values()) for (const v of s.data.values()) n += JSON.stringify(v).length; return n; };

  class Tx {
    constructor(rec, names, mode) {
      this.rec = rec; this.mode = mode; this.error = null; this.oncomplete = null; this.onabort = null; this.onerror = null;
      this.staged = new Map(names.map((n) => [n, new Map(rec.stores.get(n).data)]));
      this.pending = 0; this.done = false;
      later(() => this.settle());
    }
    objectStore(n) { if (!this.staged.has(n)) throw err("NotFoundError"); return new Store(this, n); }
    abort() { if (this.done) return; this.done = true; later(() => this.onabort?.({})); }
    req(fn) {
      if (this.done) throw err("TransactionInactiveError");
      const r = { result: undefined, error: null, onsuccess: null, onerror: null };
      this.pending++;
      later(() => {
        if (this.done) return;
        this.pending--;
        try { r.result = fn(); } catch (e) { r.error = e; this.error = e; r.onerror?.({ preventDefault() {} }); this.abort(); return; }
        r.onsuccess?.({});
        later(() => this.settle());
      });
      return r;
    }
    settle() {
      if (this.done || this.pending) return;
      this.done = true;
      if (this.mode === "readwrite") {
        const next = new Map(this.rec.stores);
        for (const [n, data] of this.staged) next.set(n, { ...this.rec.stores.get(n), data });
        if (sizeOf(next) > ctl.quota) { this.error = err("QuotaExceededError"); this.onabort?.({}); return; }
        for (const [n, data] of this.staged) this.rec.stores.get(n).data = data;
      }
      this.oncomplete?.({});
    }
  }
  class Store {
    constructor(tx, n) { this.tx = tx; this.n = n; this.keyPath = tx.rec.stores.get(n).keyPath; }
    get data() { return this.tx.staged.get(this.n); }
    rw() { if (this.tx.mode !== "readwrite") throw err("ReadOnlyError"); }
    put(v) { this.rw(); const c = structuredClone(v); ctl.puts[this.n] = (ctl.puts[this.n] ?? 0) + 1; return this.tx.req(() => { this.data.set(c[this.keyPath], c); return c[this.keyPath]; }); }
    get(k) { return this.tx.req(() => structuredClone(this.data.get(k))); }
    getAll() { return this.tx.req(() => [...this.data.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => structuredClone(v))); }
    delete(k) { this.rw(); return this.tx.req(() => { this.data.delete(k); }); }
    clear() { this.rw(); return this.tx.req(() => { this.data.clear(); }); }
  }
  class Conn {
    constructor(rec, name) {
      this.rec = rec; this.name = name; this.closed = false; this.onversionchange = null; this.onclose = null;
      this.objectStoreNames = { contains: (n) => rec.stores.has(n) };
      rec.conns.add(this);
    }
    createObjectStore(n, { keyPath }) { this.rec.stores.set(n, { keyPath, data: new Map() }); }
    close() { this.closed = true; this.rec.conns.delete(this); }
    transaction(names, mode = "readonly") {
      if (this.closed) throw err("InvalidStateError", "connection is closed");
      if (ctl.loseNext > 0) { ctl.loseNext--; throw err("InvalidStateError", "connection lost"); }
      for (const n of names) if (!this.rec.stores.has(n)) throw err("NotFoundError");
      return new Tx(this.rec, names, mode);
    }
  }
  const factory = {
    open(name, version = 1) {
      if (ctl.throwOpen) throw err("InvalidStateError", "IndexedDB unavailable");
      const r = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      if (ctl.hangOpen) return r;
      later(() => {
        if (ctl.failOpen) { r.error = err("UnknownError"); r.onerror?.({ preventDefault() {} }); return; }
        let rec = dbs.get(name);
        if (!rec) dbs.set(name, (rec = { version: 0, stores: new Map(), conns: new Set() }));
        r.result = new Conn(rec, name);
        if (rec.version < version) { rec.version = version; r.onupgradeneeded?.({}); }
        r.onsuccess?.({});
      });
      return r;
    },
    deleteDatabase(name) {
      ctl.deleted.push(name);
      const r = { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null };
      const rec = dbs.get(name);
      if (rec) for (const c of [...rec.conns]) c.onversionchange?.({ oldVersion: rec.version, newVersion: null });
      dbs.delete(name);
      later(() => r.onsuccess?.({}));
      return r;
    },
    upgrade(name) { const rec = dbs.get(name); if (rec) for (const c of [...rec.conns]) c.onversionchange?.({ oldVersion: rec.version, newVersion: rec.version + 1 }); },
    // Đọc thẳng dữ liệu đã ghi xong (không qua giao dịch), để kiểm thử so.
    dump(name, store) { const rec = dbs.get(name); return rec?.stores.get(store) ? [...rec.stores.get(store).data.values()].map((v) => structuredClone(v)) : []; },
    has: (name) => dbs.has(name),
    conns: (name) => dbs.get(name)?.conns.size ?? 0,
    ctl,
  };
  return factory;
}
