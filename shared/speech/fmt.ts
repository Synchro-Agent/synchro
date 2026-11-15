import { CREATE_WAYS } from "./data";
import type { Feat } from "../types/speech";

// Định dạng thuần của Speech (không React, không từ điển): ui/speech/client.ts gọi kèm ngôn ngữ giao diện; kiểm thử chạy thẳng không cần trình duyệt.

/** Thời lượng “m:ss” (hoặc “h:mm:ss”), làm tròn tới giây. */
export const fmtDurOf = (s: number) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
/** Đồng hồ của trình phát: bản từ 10 giây trở lên hiện như fmtDurOf; bản ngắn hơn hiện một chữ số thập phân (dấu thập phân theo loc) để âm thanh
 *  dưới một giây (tiếng động 0,48 giây) không còn hiện “0:00 / 0:00” (G6.5). total: thời lượng cả bản, t: vị trí đang phát. */
export const fmtClockOf = (t: number, total: number, loc: string) => {
  if (!(total > 0) || total >= 10) return fmtDurOf(t);
  const x = Math.min(Math.max(0, t), total);
  return `0:0${x.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
};
/** Tên ngôn ngữ theo loc từ mã ISO (vi, en, vie…); mã lạ thì fallback. Máy chủ lưu tên tiếng Việt trong meta (langName, targetName) nên giao diện tự đặt tên. */
export function langLabelOf(code: unknown, loc: string, fallback = "") {
  const c = String(code ?? "").toLowerCase().split(/[-_]/)[0];
  if (!c) return fallback;
  try { const n = new Intl.DisplayNames([loc], { type: "language" }).of(c); if (n && n.toLowerCase() !== c) return n.charAt(0).toLocaleUpperCase(loc) + n.slice(1); } catch {}
  return fallback || c;
}
/** Tiêu đề do Synchro đặt (Tách stem, Nhạc cho video) dưới dạng mẫu dịch + giá trị để dựng theo ngôn ngữ giao diện; null: tiêu đề lấy từ nội dung người dùng, giữ nguyên. */
export function itemTitleKey(it: { kind: string; meta: Record<string, unknown> }): [string, Record<string, string | number>] | null {
  const m = it.meta;
  if (it.kind === "stems" && m.source) return ["Tách {n} stem · {name}", { n: Number(m.stems) || 2, name: String(m.source) }];
  if (it.kind === "music" && m.video) return ["Nhạc cho {name}", { name: String(m.video) }];
  return null;
}
/** Lời báo khi không mở được micro, theo tên lỗi của trình duyệt (DOMException.name), kèm cách cho phép micro. */
export function micErrorOf(name: string): string {
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Không tìm thấy micro trên máy này. Cắm micro hoặc tai nghe có micro rồi thử lại.";
  if (name === "NotReadableError" || name === "AbortError") return "Micro đang bị ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.";
  if (name === "TimeoutError") return "Trình duyệt chưa cho phép micro. Bấm Cho phép khi trình duyệt hỏi, hoặc bật micro cho trang này trong phần cài đặt trang web, rồi thử lại.";
  if (name === "NoMic") return "Trình duyệt này không cho trang dùng micro. Hãy mở Synchro bằng Chrome, Edge, Safari hoặc Firefox bản mới (qua https).";
  return "Trình duyệt đang chặn micro. Bấm biểu tượng ổ khóa hoặc micro cạnh thanh địa chỉ, chọn Cho phép micro cho trang này, rồi thử lại.";
}
/** Đoạn “là gì” của hướng dẫn Tạo giọng chỉ kể những cách tạo giọng gói đang có, khớp số thẻ trên trang (gói Starter không có nhân bản chuyên sâu:
 *  ba cách, không phải bốn — G6.5). Chưa biết gói hoặc có đủ bốn cách: giữ câu gốc full. tr / tf: hàm dịch của nơi gọi. */
export function createWhatOf(has: ((f: Feat) => boolean) | null, full: string, tr: (s: string) => string, tf: (k: string, v: Record<string, string | number>) => string) {
  const ways = has ? CREATE_WAYS.filter(([f]) => has(f)).map(([, w]) => tr(w)) : [];
  if (!ways.length || ways.length === CREATE_WAYS.length) return full;
  if (ways.length === 1) return tf("Tạo giọng của riêng bạn bằng cách {list}.", { list: ways[0] });
  const list = tf("{a} hoặc {b}", { a: ways.slice(0, -1).join(", "), b: ways[ways.length - 1] });
  return ways.length === 2 ? tf("Tạo giọng của riêng bạn theo hai cách: {list}.", { list }) : tf("Tạo giọng của riêng bạn theo ba cách: {list}.", { list });
}
