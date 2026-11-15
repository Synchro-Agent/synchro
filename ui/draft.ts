// Bản nháp của ô soạn tin: giữ trong sessionStorage của tab, theo tài khoản. Trang lỗi rồi tải lại, phiên hết hạn rồi đăng nhập lại qua Google
// (phải rời trang) thì phần đang gõ không mất. Chỉ khôi phục ở lần mở trang đầu, không theo người dùng sang đoạn chat mới.
import { userScope } from "./userscope";

const key = () => `draft:${userScope()}`;
let armed = true;

export function saveDraft(text: string) {
  try { if (text.trim()) sessionStorage.setItem(key(), text); else sessionStorage.removeItem(key()); } catch {}
}
/** Lấy bản nháp để điền lại, mỗi lần tải trang một lần (hoặc sau armDraft). */
export function takeDraft(): string {
  if (!armed) return "";
  armed = false;
  try { return sessionStorage.getItem(key()) ?? ""; } catch { return ""; }
}
/** Khung lỗi vừa dựng lại ô soạn tin mà không tải lại trang: cho phép điền lại bản nháp. */
export const armDraft = () => { armed = true; };
