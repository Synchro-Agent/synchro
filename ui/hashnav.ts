// Địa chỉ #s=<mục> của Cài đặt (U6, R5/R6/LIVE-8): đọc an toàn và quyết định cách ghi lịch sử. Thuần, không phụ thuộc React, để kiểm thử được.

/** Tên mục trong #s=… — chuỗi mã hóa hỏng (#s=%, #s=%E0) thì về General thay vì ném URIError làm sập cả trang. */
export function decodeSettingsTab(raw: string): string {
  try { return decodeURIComponent(raw).trim() || "General"; } catch { return "General"; }
}

/** #s=<mục> đã mã hóa ("Synchro Code" → Synchro%20Code) để so được với location.hash. */
export const settingsHash = (tab: string): string => `#s=${encodeURIComponent(tab)}`;

/**
 * Cách đưa địa chỉ hiện tại (cur) về địa chỉ trạng thái muốn có (want).
 * - Mở Cài đặt từ một trang khác: push — Back đóng Cài đặt và về đúng trang trước (LIVE-8).
 * - Đổi mục bên trong Cài đặt: replace — không chèn mục lịch sử cho từng mục.
 * - Đóng Cài đặt về đúng trang đã mở nó (from) và chính mình đã push: back — bỏ mục #s= khỏi lịch sử thay vì để lại mục thừa.
 *   Đóng để sang trang khác (from khác want) hoặc Cài đặt mở từ liên kết: replace.
 * - Lần ghi đầu sau khi mở app (first): replace, để địa chỉ lạ / không được phép (#v=… bị tắt) không còn trong lịch sử Back.
 * - Còn lại (đổi mục, mở đoạn chat): push.
 */
export function hashStep(cur: string, want: string, from: string | null, first: boolean): "push" | "replace" | "back" | "none" {
  if (cur === want) return "none";
  const curS = cur.startsWith("#s="), wantS = want.startsWith("#s=");
  if (wantS) return curS || first ? "replace" : "push";
  if (curS) return from !== null && from === want ? "back" : "replace";
  return first ? "replace" : "push";
}
