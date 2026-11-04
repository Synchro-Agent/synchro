// Bản chụp của đoạn chat được chia sẻ công khai (dùng chung cho máy chủ và trang xem). Chỉ giữ đúng những gì người đọc cần: vai, chữ, artifact
// bản mới nhất. Mọi thứ khác của tin nhắn (dấu vết công cụ, tên tệp, skill, connector, model, thời gian, ghi chú hệ thống…) không đi qua hàm này,
// và máy chủ luôn dựng lại bản chụp từ đầu nên trình duyệt có gửi thêm trường nào cũng bị bỏ.
import { ART_TYPES, splitArtifacts, type ArtType } from "./artifacts";
import { resolveArt, type ArtState } from "./vfs";

export type ShareSeg = { k: "text"; t: string } | { k: "art"; title: string; type: ArtType; lang: string | null; content: string } | { k: "old"; title: string };
export type ShareMsg = { r: "u" | "a"; segs: ShareSeg[]; files?: number; outs?: number };
// imgs: ảnh ngoài trong artifact đã được nhúng vào bản chụp (sharestore.ts); missing: số ảnh không nhúng được. Bản chụp cũ chưa có trường này được nhúng khi có người mở lần đầu.
export type ShareSnap = { title: string; msgs: ShareMsg[]; imgs?: { missing: number } };
export const SHARE_LIMITS = { bytes: 4_000_000, withImages: 16_000_000, totalBytes: 100_000_000, msgs: 2000, text: 400_000, perUser: 200, title: 200 };

// Chú thích ẩn của giao diện (<!-- meta --> / <!-- mode -->) và ký tự điều khiển không phải là nội dung để đọc.
const clean = (s: string) => s.replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Dựng bản chụp từ các tin nhắn gửi lên. Bản artifact cũ chỉ còn một dòng nhắc (chỉ giữ bản mới nhất); bản sửa (patch) được áp thành bản đầy đủ. */
export function snapshotOf(title: unknown, input: unknown): ShareSnap {
  const list = (Array.isArray(input) ? input : []) as { role?: unknown; text?: unknown; files?: unknown; outs?: unknown }[];
  const st: ArtState = new Map();
  const last = new Map<string, number>();
  const parsed = list.slice(-SHARE_LIMITS.msgs).map((m, i) => {
    const r: "u" | "a" = m?.role === "ai" || m?.role === "assistant" ? "a" : "u";
    const text = clean(typeof m?.text === "string" ? m.text : "").slice(0, SHARE_LIMITS.text);
    // Tin của người dùng là chữ thuần: thẻ <artifact> họ gõ không được dựng thành khung chạy.
    const segs = r === "a" ? splitArtifacts(text) : text.trim() ? [{ kind: "text" as const, text }] : [];
    for (const s of segs) if (s.kind === "art") { st.set(s.art.ident, resolveArt(st.get(s.art.ident), s.art)); last.set(s.art.ident, i); }
    return { r, segs, resolved: new Map(segs.flatMap((s) => (s.kind === "art" ? [[s.art.ident, st.get(s.art.ident)!] as const] : []))), files: Array.isArray(m?.files) ? m.files.length : 0, outs: Array.isArray(m?.outs) ? m.outs.length : 0 };
  });
  const msgs: ShareMsg[] = [];
  parsed.forEach((m, i) => {
    const segs: ShareSeg[] = m.segs.flatMap((s): ShareSeg[] => {
      if (s.kind === "text") return s.text.trim() ? [{ k: "text", t: s.text }] : [];
      const v = m.resolved.get(s.art.ident) ?? s.art;
      if (last.get(s.art.ident) !== i) return [{ k: "old", title: v.title }];
      return ART_TYPES.includes(v.type) ? [{ k: "art", title: v.title, type: v.type, lang: v.lang ?? null, content: v.content }] : [];
    });
    if (segs.length || m.files || m.outs) msgs.push({ r: m.r, segs, ...(m.files ? { files: m.files } : {}), ...(m.outs ? { outs: m.outs } : {}) });
  });
  const t = typeof title === "string" ? clean(title).replace(/\s+/g, " ").trim().slice(0, SHARE_LIMITS.title) : "";
  return { title: t || "Đoạn chat", msgs };
}
