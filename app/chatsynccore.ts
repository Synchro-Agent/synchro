// Lõi đồng bộ đoạn chat và dự án theo tài khoản (hàm thuần, kiểm thử không cần máy chủ). Xem chatsync.ts.
export type SyncKind = "chat" | "project";
export const keyOf = (kind: SyncKind, id: number | string) => `${kind}:${id}`;
/** known: bản đã được máy chủ xác nhận [mốc sửa, dấu nội dung]; dirty: bản ở máy này chưa lên máy chủ (mốc sửa); gone: đã xóa ở máy này, chờ máy chủ xác nhận. */
export type SyncMeta = { cur: number; known: Record<string, [number, string]>; dirty: Record<string, number>; gone: Record<string, number>; wipe?: number };
export const emptyMeta = (): SyncMeta => ({ cur: 0, known: {}, dirty: {}, gone: {} });
export function parseMeta(s: string | null): SyncMeta {
  try {
    const m = JSON.parse(s ?? "null");
    if (m && typeof m === "object") return { cur: Number(m.cur) || 0, known: m.known ?? {}, dirty: m.dirty ?? {}, gone: m.gone ?? {}, ...(m.wipe ? { wipe: Number(m.wipe) } : {}) };
  } catch {}
  return emptyMeta();
}

/**
 * Chạy một việc nhưng chỉ chờ tối đa ms. Hết giờ (hoặc việc ném lỗi) thì trả về TIMED_OUT; việc vẫn chạy nốt ở nền, vô hại.
 * Dùng cho flush lúc đăng xuất: một yêu cầu mạng đứng không được treo cả bước đăng xuất, và phần chưa xong phải đếm được để
 * không xóa dữ liệu chưa đồng bộ. ms ≤ 0 trả TIMED_OUT ngay.
 */
export const TIMED_OUT: unique symbol = Symbol("timed-out");
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  if (ms <= 0) return Promise.resolve(TIMED_OUT);
  return new Promise<T | typeof TIMED_OUT>((resolve) => {
    let done = false;
    const settle = (v: T | typeof TIMED_OUT) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => settle(TIMED_OUT), ms);
    work.then((v) => settle(v), () => settle(TIMED_OUT));
  });
}

/** Dấu nội dung (FNV-1a + độ dài): chỉ để biết bản này đã lên máy chủ chưa, không phải để bảo mật. */
export function hashOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

type MsgLike = { time?: number; role?: string; text?: string };
type ChatLike = { id: number; msgs?: MsgLike[]; upd?: number };
/** Mốc sửa suy ra từ nội dung (đoạn chat có từ trước khi có đồng bộ): tin mới nhất. Không dùng giờ hiện tại, để bản cũ không đè bản mới hơn trên máy chủ. */
export const lastTime = (c: ChatLike) => (c.msgs ?? []).reduce((a, m) => Math.max(a, m.time ?? 0), c.upd ?? c.id ?? 0);

/** Bản lưu của đoạn chat: như bản lưu trong trình duyệt từ trước tới nay (mọi tin coi như xong, bỏ dòng tiến độ). */
export const serialChat = (c: { msgs: object[] }) => JSON.stringify({ ...c, msgs: c.msgs.map((m) => ({ ...m, done: true, prog: undefined })) });

/** Bản lưu của dự án: không lưu hai lần chữ của tài liệu (đoạn nhỏ tính lại từ chữ khi cần, llm.ts). */
export const serialProject = (p: { ctx?: { text?: string; chunks?: string[] }[] }) => JSON.stringify(p.ctx?.some((c) => c.chunks && c.text !== undefined) ? { ...p, ctx: p.ctx.map((c) => { if (c.text === undefined) return c; const { chunks: _c, ...rest } = c; return rest; }) } : p);

/** So sánh lúc khởi động: mục chưa từng lên máy chủ hoặc nội dung đã khác bản đã xác nhận thì cần đẩy lên. */
export function startupDirty(meta: SyncMeta, key: string, hash: string, time: number): number | null {
  const k = meta.known[key];
  if (meta.dirty[key]) return k && k[1] === hash ? null : meta.dirty[key];
  if (!k) return time;
  return k[1] === hash ? null : Math.max(k[0] + 1, time);
}

/** Bản từ máy chủ về: "apply" nhận, "keep" giữ bản ở máy này (đang chạy, hoặc sửa mới hơn và sẽ đẩy lên sau). Theo từng mục, bản mới nhất thắng. */
export function decideRemote(meta: SyncMeta, key: string, remoteUpd: number, running: boolean): "apply" | "keep" {
  if (running) return "keep";
  const mine = meta.dirty[key];
  return mine && mine > remoteUpd ? "keep" : "apply";
}

/** Bản ở máy này thua nhưng có tin người dùng mà bản thắng không có: giữ thành bản sao để không mất tin. */
export function losesUserMsgs(local: ChatLike, remote: ChatLike) {
  const have = new Set((remote.msgs ?? []).map((m) => `${m.role}:${m.time}`));
  return (local.msgs ?? []).some((m) => m.role === "user" && !!m.text?.trim() && !have.has(`user:${m.time}`));
}

export type Part = { key: string; kind: SyncKind; id: string; upd: number; data?: string; deleted?: boolean; size: number };
/** Chia thành từng đợt gửi: mỗi đợt tối đa maxBytes (mục lớn hơn đi riêng một đợt). */
export function batches(parts: Part[], maxBytes: number): Part[][] {
  const out: Part[][] = [];
  let cur: Part[] = [], n = 0;
  for (const p of parts) {
    if (cur.length && n + p.size > maxBytes) { out.push(cur); cur = []; n = 0; }
    cur.push(p); n += p.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Bản rút gọn của đoạn chat đã có trên máy chủ, khi trình duyệt hết chỗ: giữ dòng ở thanh bên, nội dung tải lại khi mở trang. */
export const stubOf = <T extends { msgs: object[] }>(c: T) => ({ ...c, msgs: [], compact: undefined, critic: undefined, pins: undefined, stub: true });

/**
 * Ghi vào bộ nhớ trình duyệt. Hết chỗ thì rút gọn dần các mục cũ nhất đã có trên máy chủ (không bao giờ rút gọn mục chưa lên máy chủ).
 * write: thử ghi, trả false khi hết chỗ. Trả về: có ghi được không, và danh sách đã rút gọn để lần sau khỏi thử lại từ đầu.
 */
export function saveFit(rows: { key: string; full: string; stub: string | null; time: number }[], stubbed: Set<string>, write: (json: string) => boolean): { ok: boolean; stubbed: Set<string> } {
  const can0 = new Set(rows.filter((r) => r.stub !== null).map((r) => r.key));
  const out = new Set([...stubbed].filter((k) => can0.has(k)));
  const json = () => `[${rows.map((r) => (out.has(r.key) && r.stub !== null ? r.stub : r.full)).join(",")}]`;
  if (write(json())) return { ok: true, stubbed: out };
  const can = rows.filter((r) => r.stub !== null && !out.has(r.key)).sort((a, b) => a.time - b.time);
  for (let i = 0; i < can.length;) {
    // Mỗi lần rút gọn thêm một phần tư số còn lại (ít nhất 1): không ghi thử mấy nghìn lần.
    const step = Math.max(1, Math.ceil((can.length - i) / 4));
    for (const r of can.slice(i, i + step)) out.add(r.key);
    i += step;
    if (write(json())) return { ok: true, stubbed: out };
  }
  return { ok: false, stubbed: out };
}
