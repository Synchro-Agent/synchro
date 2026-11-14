// Lõi kho đoạn chat trong IndexedDB (blueprint B4): hàm thuần, không đụng DOM hay IndexedDB, kiểm thử không cần trình duyệt
// (tests/api/chatidb.test.mjs). Kho thật và bản dự phòng localStorage ở app/chatidb.ts.
// Mỗi đoạn chat là một bản ghi thân (chuỗi serialChat) kèm một dòng chỉ mục nhỏ: thanh bên chỉ đọc chỉ mục, thân đọc khi mở.
import type { Chat } from "./store";
import { hashOf, lastTime, serialChat } from "./chatsynccore";

/** Tên cơ sở dữ liệu IndexedDB của một tài khoản (đăng xuất kèm xóa thiết bị thì xóa đúng cơ sở này, userscope.ts). */
export const DB_PREFIX = "synchro-chats:";
export const dbName = (uid: string) => DB_PREFIX + uid;
/** Khóa localStorage cũ u:<uid>:chats giữ thêm 7 ngày sau lần chuyển đầu (bản cũ của app ở tab khác vẫn đọc được), rồi xóa. */
export const LEGACY_KEEP = 7 * 86_400_000;

/**
 * Dòng chỉ mục: đủ để vẽ thanh bên, lọc theo thẻ / dự án / studio mà không đọc thân.
 * upd: mốc sửa (tin mới nhất); run: mã lượt chạy của tin cuối (câu trả lời chưa nhận xong, phải đọc thân trước để nối lại lượt chạy);
 * srv: thân KHÔNG có ở máy này (bị rút gọn khi hết chỗ, nội dung chỉ còn trên máy chủ).
 */
export type IdxRow = { id: number; title: string; upd: number; pinned?: boolean; project?: number; tags?: string[]; studio?: Chat["studio"]; named?: boolean; run?: string; srv?: boolean };

/** Dòng chỉ mục của một đoạn chat. Các trường dựng theo thứ tự cố định nên JSON.stringify dùng để so được (idxKey). */
export function idxOf(c: Chat): IdxRow {
  const r: IdxRow = { id: c.id, title: typeof c.title === "string" ? c.title : "", upd: lastTime(c) };
  if (c.pinned) r.pinned = true;
  if (typeof c.project === "number") r.project = c.project;
  if (Array.isArray(c.tags) && c.tags.length) r.tags = [...c.tags];
  if (c.studio) r.studio = c.studio;
  if (c.named) r.named = true;
  const last = c.msgs?.[c.msgs.length - 1];
  if (last && last.role === "ai" && last.run) r.run = last.run;
  if (c.stub && !c.local) r.srv = true;
  return r;
}
export const idxKey = (r: IdxRow) => JSON.stringify(r);

/** Bản rút gọn dựng từ dòng chỉ mục (thanh bên hiện ngay, thân đọc sau). local: thân có trong IndexedDB; srv thì thân chỉ còn trên máy chủ. */
export function stubOfRow(r: IdxRow): Chat {
  const c: Chat = { id: r.id, title: r.title, msgs: [], stub: true, upd: r.upd };
  if (!r.srv) c.local = true;
  if (r.pinned) c.pinned = true;
  if (typeof r.project === "number") c.project = r.project;
  if (r.tags?.length) c.tags = [...r.tags];
  if (r.studio) c.studio = r.studio;
  if (r.named) c.named = true;
  return c;
}

/**
 * Thân vừa đọc từ kho, nhưng trong lúc chờ người dùng đã sửa bản rút gọn (đổi tên, ghim, gắn thẻ, chuyển dự án): áp các trường đó lên thân.
 * Không bao giờ chép upd / local / stub sang thân (serialChat trải ...c: thêm trường là đổi dấu nội dung, đoạn chat bị coi là đã sửa).
 */
export function withIdx(body: Chat, stub: Chat): Chat {
  const out: Chat = { ...body, title: stub.title };
  for (const k of ["pinned", "project", "tags", "studio", "named"] as const) {
    if (stub[k] === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = stub[k];
  }
  delete out.upd; delete out.local; delete out.stub;
  return out;
}

/** Bản đã lưu lần trước để so (chỉ đoạn chat không ẩn danh: ẩn danh không bao giờ được lưu). */
export const snapshot = (list: readonly Chat[]) => new Map(list.filter((c) => !c.inc).map((c) => [c.id, c] as const));

/**
 * Chỉ ghi phần đã đổi (so theo đối tượng: state React không sửa tại chỗ, đoạn chat đổi là đối tượng mới).
 * - put: đoạn chat đầy đủ mới / đã đổi → ghi thân + chỉ mục.
 * - idx: bản rút gọn đổi tên / ghim / thẻ… → chỉ ghi chỉ mục (không bao giờ ghi thân rỗng của bản rút gọn đè lên thân thật).
 * - drop: đoạn chat trong bộ nhớ thành bản rút gọn chỉ có trên máy chủ → bỏ thân ở máy này, giữ chỉ mục (srv).
 * - del: có ở lần trước mà nay không còn → xóa. Danh sách rỗng trong khi lần trước còn mục thì KHÔNG suy ra là xóa hết (trang chưa nạp xong,
 *   đổi tài khoản giữa chừng): chỉ xóa mục mà explicit(id) xác nhận là người dùng đã xóa (chatsync: meta.gone). guarded = đã chặn.
 */
export function diffSave(prev: ReadonlyMap<number, Chat>, list: readonly Chat[], explicit: (id: number) => boolean = () => false) {
  const put: Chat[] = [], idx: IdxRow[] = [], drop: number[] = [], del: number[] = [];
  const seen = new Set<number>();
  for (const c of list) {
    if (c.inc) continue;
    seen.add(c.id);
    const old = prev.get(c.id);
    if (old === c) continue;
    if (!c.stub) { put.push(c); continue; }
    const r = idxOf(c);
    // Bản rút gọn của máy chủ không có tin, mốc sửa của nó rơi về id: giữ mốc sửa thật của bản trước (đầy đủ hoặc rút gọn), không bao giờ lùi.
    if (old) r.upd = Math.max(r.upd, lastTime(old));
    if (!old || idxKey(idxOf(old)) !== idxKey(r)) idx.push(r);
    if (old && r.srv && !(old.stub && !old.local)) drop.push(c.id);
  }
  let guarded = false;
  const gone = [...prev.keys()].filter((id) => !seen.has(id));
  if (!seen.size && gone.length) {
    guarded = true;
    for (const id of gone) if (explicit(id)) del.push(id);
  } else del.push(...gone);
  return { put, idx, drop, del, guarded };
}

/** Một bước FNV-1a 32 bit trên s[a, b) (như hashOf ở chatsynccore.ts), để băm chuỗi dài từng đoạn mà kết quả vẫn như băm một lần. */
export function fnv(h: number, s: string, a: number, b: number) {
  for (let i = a; i < b; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h;
}
const FNV0 = 0x811c9dc5;
const sigOf = (len: number, h: number) => `${len}:${(h >>> 0).toString(36)}`;
/**
 * Dấu của khóa localStorage cũ: độ dài + băm CẢ chuỗi (sửa một đoạn giữa danh sách mà độ dài không đổi vẫn đổi dấu). Không JSON.parse.
 * Ở luồng chính dùng legacySigAsync (cùng kết quả, nhường luồng giữa các đoạn) để khóa vài MB không thành một tác vụ dài.
 */
export const legacySig = (s: string) => sigOf(s.length, fnv(FNV0, s, 0, s.length));
export async function legacySigAsync(s: string, pause: () => Promise<void>, chunk = 1 << 19) {
  let h = FNV0;
  for (let i = 0; i < s.length; i += chunk) {
    if (i) await pause();
    h = fnv(h, s, i, Math.min(s.length, i + chunk));
  }
  return sigOf(s.length, h);
}
/** Đã đủ 7 ngày từ lần chuyển đầu: xóa khóa cũ. at = 0 (chưa chuyển) thì không bao giờ. */
export const dropLegacyDue = (at: number, now: number) => at > 0 && now - at >= LEGACY_KEEP;

/** Thanh bên xếp đoạn mới nhất lên đầu (id giảm dần), như thứ tự trộn ở chatsync.ts. */
export const sortIdx = (rows: readonly IdxRow[]) => [...rows].sort((a, b) => b.id - a.id);

/**
 * Một đoạn chat từ khóa cũ, sẵn để ghi: s = chuỗi thân (null: bản rút gọn cũ, chỉ ghi chỉ mục với srv).
 * mark = dấu của dòng này ở khóa cũ, "<băm nội dung>|<băm các trường thanh bên>": lần nhập sau so với dấu đã nhập (StoreMeta.rows)
 * để chỉ nhập lại đúng đoạn đã đổi ở khóa cũ, và biết thay đổi đó có đụng tên / ghim / thẻ… hay chỉ là nội dung.
 */
export type ImportRow = { id: number; s: string | null; idx: IdxRow; mark: string };
/** Các trường thanh bên sửa được mà không đổi mốc sửa (đổi tên, ghim, dự án, thẻ, studio). */
const fieldsKey = (r: IdxRow) => JSON.stringify([r.title, !!r.pinned, r.project ?? null, r.tags ?? [], r.studio ?? null, !!r.named]);
export function legacyRow(x: unknown): ImportRow | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Chat;
  if (typeof c.id !== "number" || !Number.isFinite(c.id) || c.inc || !Array.isArray(c.msgs)) return null;
  const { upd: _u, local: _l, ...body } = c;
  const idx = idxOf(body);
  if (c.stub) {
    // Bản rút gọn cũ không có tin: mốc sửa lấy upd nếu bản lưu có (LsStore ghi kèm), không thì rơi về id.
    if (typeof c.upd === "number" && Number.isFinite(c.upd)) idx.upd = Math.max(idx.upd, c.upd);
    return { id: c.id, s: null, idx, mark: `${hashOf(idxKey(idx))}|${hashOf(fieldsKey(idx))}` };
  }
  const s = serialChat(body);
  return { id: c.id, s, idx, mark: `${hashOf(s)}|${hashOf(fieldsKey(idx))}` };
}
export const legacyRows = (list: unknown): ImportRow[] => (Array.isArray(list) ? list.map(legacyRow).filter((r): r is ImportRow => r !== null) : []);

/**
 * Nhập lại khóa cũ (bản app cũ ở tab khác vừa ghi, kho dự phòng localStorage của một phiên không mở được IndexedDB, kiểm thử gieo dữ liệu):
 * chỉ thêm / đè, không bao giờ xóa. Trả dòng cần ghi, hoặc null (giữ bản trong kho). have: chỉ mục trong kho; base: dấu lần nhập trước.
 * - Kho chưa có: nhập.
 * - Dòng không đổi so với lần nhập trước: bỏ qua. Kho là bản đang dùng; nhập lại sẽ xóa mất các sửa chỉ chỉ mục (đổi tên, ghim…) làm ở app mới.
 * - Bản rút gọn cũ không bao giờ đè thứ đã có. Bản cũ có tin cũ hơn kho: bỏ qua.
 * - Cùng mốc sửa: chỉ nhập khi biết chắc khóa cũ đã đổi tên / ghim / thẻ (có dấu lần trước và dấu trường thanh bên khác); không có dấu lần trước
 *   thì không phân biệt được bản cũ với bản đã đổi, giữ kho.
 * - Nhập nội dung mà các trường thanh bên ở khóa cũ không đổi so với lần trước: giữ tên / ghim / thẻ… của kho (sửa ở app mới), áp lên thân.
 */
export function legacyMerge(row: ImportRow, have: IdxRow | undefined, base: string | undefined): ImportRow | null {
  if (!have) return row;
  if (base === row.mark || row.s === null || row.idx.upd < have.upd) return null;
  if (row.idx.upd === have.upd && base === undefined) return null;
  // Trường thanh bên ở khóa cũ đổi so với lần nhập trước (đổi tên ở tab cũ), hoặc không có lần trước để so: nhập nguyên dòng.
  if (base === undefined || base.split("|")[1] !== row.mark.split("|")[1]) return row;
  let body: Chat;
  try { body = JSON.parse(row.s) as Chat; } catch { return null; }
  const merged = withIdx(body, stubOfRow(have));
  const s = serialChat(merged);
  return { id: row.id, s, idx: idxOf(merged), mark: row.mark };
}

/** Kế hoạch ghi của diffSave thành lệnh ghi cho kho (thân là chuỗi serialChat, đúng dấu nội dung của chatsync). */
export function toWrite(d: ReturnType<typeof diffSave>) {
  return { put: d.put.map((c) => ({ id: c.id, s: serialChat(c), idx: idxOf(c) })), idx: d.idx, del: d.del, drop: d.drop };
}

/**
 * Dấu ở localStorage u:<uid>:chatsIdb (MARK_KEY) cho kho dự phòng LsStore: tài khoản này đã chuyển sang IndexedDB trên trình duyệt này lúc at.
 * Từ đó khóa cũ u:<uid>:chats không còn là bản đang dùng (mọi sửa đi vào IndexedDB), nên một phiên rơi về localStorage KHÔNG tin nội dung khóa
 * cũ (sẽ mang lại đoạn đã xóa, tên cũ, thiếu tin mới và chatsync sẽ đẩy bản cũ đè máy chủ), trừ khi khóa đó do chính LsStore ghi sau lần
 * IndexedDB nhập gần nhất (ls = dấu legacySig của lần ghi đó).
 */
export const MARK_KEY = "chatsIdb";
export type LegacyMark = { at: number; ls?: string };
export function parseMark(raw: string | null): LegacyMark | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as LegacyMark;
    if (!m || typeof m !== "object" || typeof m.at !== "number") return null;
    return typeof m.ls === "string" ? { at: m.at, ls: m.ls } : { at: m.at };
  } catch { return null; }
}
/** LsStore có được dùng nội dung khóa cũ không: chưa chuyển lần nào, hoặc khóa là bản LsStore tự ghi sau lần nhập cuối. */
export const trustLegacy = (mark: LegacyMark | null, sig: string) => !mark || mark.ls === sig;
