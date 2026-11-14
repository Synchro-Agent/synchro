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

/** Dấu của khóa localStorage cũ: độ dài + 4KB đầu + 4KB cuối (đoạn mới nhất nằm đầu danh sách). Đọc dấu không phải JSON.parse cả khóa. */
export function legacySig(s: string) {
  return `${s.length}:${hashOf(s.length <= 8192 ? s : s.slice(0, 4096) + s.slice(-4096))}`;
}
/** Đã đủ 7 ngày từ lần chuyển đầu: xóa khóa cũ. at = 0 (chưa chuyển) thì không bao giờ. */
export const dropLegacyDue = (at: number, now: number) => at > 0 && now - at >= LEGACY_KEEP;

/** Thanh bên xếp đoạn mới nhất lên đầu (id giảm dần), như thứ tự trộn ở chatsync.ts. */
export const sortIdx = (rows: readonly IdxRow[]) => [...rows].sort((a, b) => b.id - a.id);

/** Một đoạn chat từ khóa cũ, sẵn để ghi: s = chuỗi thân (null: bản rút gọn cũ, chỉ ghi chỉ mục với srv). */
export type ImportRow = { id: number; s: string | null; idx: IdxRow };
export function legacyRow(x: unknown): ImportRow | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Chat;
  if (typeof c.id !== "number" || !Number.isFinite(c.id) || c.inc || !Array.isArray(c.msgs)) return null;
  const { upd: _u, local: _l, ...body } = c;
  if (c.stub) return { id: c.id, s: null, idx: idxOf(body) };
  return { id: c.id, s: serialChat(body), idx: idxOf(body) };
}
export const legacyRows = (list: unknown): ImportRow[] => (Array.isArray(list) ? list.map(legacyRow).filter((r): r is ImportRow => r !== null) : []);

/**
 * Nhập lại khóa cũ (bản app cũ ở tab khác vừa ghi, hoặc kiểm thử gieo dữ liệu) chỉ thêm / đè, không bao giờ xóa. Không đè khi kho đã có bản
 * có tin mới hơn, và bản rút gọn cũ không đè thân đã có.
 */
export function legacyWins(row: ImportRow, have: IdxRow | undefined) {
  if (!have) return true;
  if (row.s === null) return false;
  return row.idx.upd >= have.upd;
}
