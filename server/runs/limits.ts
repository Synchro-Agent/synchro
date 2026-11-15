// Mức lượt của một tài khoản (RunService): số lượt chạy cùng lúc, hàng chờ, việc phụ chạy thẳng, và lời báo khi lượt phải xếp hàng.
// Dùng chung cho lượt chat / tác vụ (store-sqlite.ts) và lượt Code (app/api/agent).
import "server-only";
import { getSetting, isAdmin, verifyLocked, type UserRow } from "../authstore";
import { accountLimit, accountTotal, noteRefused, queuedOf, queueLimit, type WaitWhy } from "../turngate";

export const WAIT_NOTE: Record<WaitWhy, string> = {
  account: "Tài khoản của bạn đang chạy nhiều lượt cùng lúc. Lượt này đang xếp hàng và sẽ tự chạy khi có lượt xong.",
  server: "Máy chủ đang bận. Lượt này đang xếp hàng và sẽ tự chạy khi có chỗ.",
};
/** Quản trị viên chỉnh riêng cho một tài khoản qua cài đặt turns_limit:<id> (không có giao diện, dùng khi cần nới cho một người). Tài khoản chưa xác minh email: một nửa, để đăng ký hàng loạt tốn nhiều hơn. */
export const turnsLimit = (user: UserRow) => Number(getSetting(`turns_limit:${user.id}`, "")) || (verifyLocked(user) ? Math.max(1, Math.ceil(accountLimit() / 2)) : accountLimit() * (isAdmin(user) ? 3 : 1));
// Việc phụ chạy thẳng (đặt tên, gợi ý, phản biện…): một tài khoản không cần nhiều hơn chừng này cùng lúc. Tài khoản chưa xác minh giữ đúng mức một nửa: bỏ async:true từng lấy lại đủ 6 chỗ.
const QUICK_MAX = 6;
export const quickLimit = (user: UserRow) => (verifyLocked(user) ? turnsLimit(user) : Math.max(QUICK_MAX, turnsLimit(user)));
/** Tổng số lượt của tài khoản trên mọi làn. Có mức riêng hoặc chưa xác minh thì theo turnsLimit; quản trị viên giữ mức gấp ba của mình. */
export const turnsTotal = (user: UserRow) => (getSetting(`turns_limit:${user.id}`, "") || verifyLocked(user) ? turnsLimit(user) : Math.max(turnsLimit(user), accountTotal()));
/** Tài khoản đã xếp đầy hàng chờ: /api/llm từ chối ngay. Lượt của việc tự động và lượt khôi phục sau khởi động lại không qua đây, chúng luôn được xếp hàng. */
export function queueFull(uid: string) {
  const own = Number(getSetting(`turns_limit:${uid}`, ""));
  if (queuedOf(uid) < (own ? own * 2 : queueLimit())) return false;
  noteRefused();
  return true;
}
