// Biểu thức chạy trong trang (Runtime.evaluate với awaitPromise) để đọc / sửa kho đoạn chat IndexedDB "synchro-chats:<uid>" của app
// (app/chatidb.ts) trong kiểm thử giao diện. Không bao giờ tạo cơ sở dữ liệu: chưa có thì hủy bước nâng cấp (tạo cơ sở rỗng không có kho
// sẽ làm app coi IndexedDB là hỏng và rơi về localStorage).
// Xóa cả cơ sở dữ liệu (idbWipe) / gieo dữ liệu như thiết bị mới thì làm khi trang KHÔNG mở app (freshDevice bên dưới): app đang mở sẽ nhường
// kết nối rồi chuyển sang localStorage và ghi lại danh sách đang có vào khóa cũ.

const OPEN = (uid) => `await new Promise((ok, no) => { const r = indexedDB.open(${JSON.stringify("synchro-chats:" + uid)}); r.onupgradeneeded = () => { r.transaction.abort(); }; r.onsuccess = () => ok(r.result); r.onerror = (e) => { e.preventDefault(); ok(null); }; })`;
const TX = `const tx = (db, names, mode, fn) => new Promise((ok, no) => { const t = db.transaction(names, mode); let out; t.oncomplete = () => ok(out); t.onabort = () => no(t.error); out = fn(t); });
  const on = (r, f) => { r.onsuccess = () => f(r.result); };`;

/** [{ ...dòng chỉ mục, body: chuỗi thân | null }], mới nhất trước; [] khi chưa có cơ sở dữ liệu. */
export const idbRows = (uid) => `(async () => { const db = ${OPEN(uid)}; if (!db) return []; ${TX}
  try { let idx = [], body = [];
    await tx(db, ["idx", "body"], "readonly", (t) => { on(t.objectStore("idx").getAll(), (v) => { idx = v; }); on(t.objectStore("body").getAll(), (v) => { body = v; }); });
    const b = new Map(body.map((x) => [x.id, x.s]));
    return idx.sort((a, z) => z.id - a.id).map((r) => ({ ...r, body: b.get(r.id) ?? null }));
  } finally { db.close(); } })()`;

/** Số dòng chỉ mục / thân (đếm nhanh, không đọc thân). */
export const idbCount = (uid) => `(async () => { const db = ${OPEN(uid)}; if (!db) return { idx: 0, body: 0 }; ${TX}
  try { const o = {}; await tx(db, ["idx", "body"], "readonly", (t) => { on(t.objectStore("idx").count(), (n) => { o.idx = n; }); on(t.objectStore("body").count(), (n) => { o.body = n; }); }); return o; } finally { db.close(); } })()`;

/** Xóa vài đoạn chat khỏi kho (thân + chỉ mục). */
export const idbDel = (uid, ids) => `(async () => { const db = ${OPEN(uid)}; if (!db) return 0; ${TX}
  try { await tx(db, ["idx", "body"], "readwrite", (t) => { for (const id of ${JSON.stringify(ids)}) { t.objectStore("idx").delete(id); t.objectStore("body").delete(id); } }); return ${ids.length}; } finally { db.close(); } })()`;

/** Bản ghi meta "legacy" ({ sig, migratedAt, rows }); patch: ghi đè vài trường (thử luật giữ khóa cũ 7 ngày). */
export const idbMeta = (uid, patch) => `(async () => { const db = ${OPEN(uid)}; if (!db) return null; ${TX}
  try { let m = null; await tx(db, ["meta"], "readwrite", (t) => { const st = t.objectStore("meta"); on(st.get("legacy"), (v) => { m = v ?? null; ${patch ? `m = { ...(m ?? {}), ...${JSON.stringify(patch)}, k: "legacy" }; st.put(m);` : ""} }); }); return m; } finally { db.close(); } })()`;

/** Xóa cả cơ sở dữ liệu của tài khoản (chờ tối đa 5 giây nếu còn kết nối mở). */
export const idbWipe = (uid) => `new Promise((ok) => { const r = indexedDB.deleteDatabase(${JSON.stringify("synchro-chats:" + uid)}); const t = setTimeout(() => ok("blocked"), 5000); r.onsuccess = () => { clearTimeout(t); ok("ok"); }; r.onerror = () => { clearTimeout(t); ok("error"); }; })`;

/**
 * Thiết bị mới cho tài khoản uid: rời app (sang một trang JSON cùng nguồn gốc, app đóng kết nối), xóa kho IndexedDB và các khóa localStorage
 * u:<uid>:* (keep: tiền tố khóa giữ lại), rồi chạy thêm seed (biểu thức, ví dụ gieo khóa cũ u:<uid>:chats). Không tự mở lại app.
 * t: { P, ev, until } (tests/lib/cdp.mjs hoặc tương đương), base: địa chỉ mock.
 */
export async function freshDevice(t, base, uid, { seed = "", keepLs = false } = {}) {
  await t.P("Page.navigate", { url: base + "/api/auth/me" });
  for (let i = 0; i < 100; i++) { if (await t.ev(`location.pathname === "/api/auth/me" && document.readyState === "complete"`).catch(() => false)) break; await new Promise((r) => setTimeout(r, 100)); }
  const wiped = await t.ev(idbWipe(uid));
  if (!keepLs) await t.ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("u:${uid}:")) localStorage.removeItem(k); localStorage.setItem("signedIn", "1"); return 1; })()`);
  if (seed) await t.ev(seed);
  return wiped;
}
