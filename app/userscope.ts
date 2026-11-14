// Dữ liệu lưu trong trình duyệt được tách theo tài khoản: mọi khóa localStorage của app mang tiền tố
// "u:<userId>:", nên hai tài khoản dùng chung một trình duyệt không thấy chat, dự án, ảnh đại diện… của nhau.
// Vài khóa là cài đặt của cả trình duyệt (giao diện sáng/tối, ngôn ngữ) thì dùng chung.
import { dbName } from "./chatidbcore";
const GLOBAL = new Set(["theme", "p:uilang"]);
let scope = "anon";

export const userScope = () => scope;
export const setUserScope = (id: string | null) => { scope = id || "anon"; };
const prefix = () => `u:${scope}:`;
export const scoped = (k: string) => (GLOBAL.has(k) ? k : prefix() + k);
/** Khóa localStorage của một tài khoản cụ thể (chưa chuyển vùng sang tài khoản đó). */
export const scopedFor = (uid: string, k: string) => (GLOBAL.has(k) ? k : `u:${uid}:${k}`);

export const ls = {
  get(k: string) { try { return localStorage.getItem(scoped(k)); } catch { return null; } },
  // false: trình duyệt không ghi được (hết chỗ, bị chặn); nơi nào không được phép mất dữ liệu thì phải xem kết quả này.
  set(k: string, v: string) { try { localStorage.setItem(scoped(k), v); return true; } catch { return false; } },
  remove(k: string) { try { localStorage.removeItem(scoped(k)); } catch {} },
  // Khóa (đã bỏ tiền tố) của tài khoản hiện tại.
  keys(): string[] { try { const p = prefix(); return Object.keys(localStorage).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length)); } catch { return []; } },
  clear() { for (const k of this.keys()) this.remove(k); },
};

/**
 * Đăng xuất kèm "Xóa dữ liệu trên thiết bị này": xóa mọi khóa u:<uid>:* của tài khoản đó (đoạn chat, dự án, phiên Code, hướng dẫn, cài đặt)
 * trong localStorage và sessionStorage, cùng bản nháp ô soạn tin (sessionStorage draft:<uid>). Cài đặt của cả trình duyệt (giao diện, ngôn ngữ)
 * và dữ liệu của tài khoản khác giữ nguyên. Kho đoạn chat IndexedDB của tài khoản (app/chatidb.ts, "synchro-chats:<uid>") cũng bị xóa cả cơ sở
 * dữ liệu; kho của tài khoản khác giữ nguyên. Trả về số khóa đã xóa (không tính cơ sở dữ liệu IndexedDB).
 *
 * Vài khóa chứa nội dung chat lại nằm NGOÀI tiền tố u:<uid>: (nợ kỹ thuật): chúng dùng chung cho cả trình duyệt chứ không tách theo
 * tài khoản, nên cũng xóa ở đây để sau khi xóa không còn khóa nào chứa nội dung chat. Đây là bộ nhớ đệm/cài đặt hiển thị, dựng lại
 * được từ máy chủ, nên xóa cả phần của tài khoản khác đang dùng chung trình duyệt là chấp nhận được (họ sẽ dựng lại khi cần):
 *   - bn:synced          (brainsync.ts, chatsync.ts): id các đoạn chat đã nạp vào Bộ não
 *   - bn:graph:<key>      (brainui.tsx): cài đặt hiển thị đồ thị Bộ não (có thể gồm chữ tìm kiếm)
 *   - synchro:skill-suggest (saveskill.tsx): các gợi ý kỹ năng đã hiện (suy ra từ nội dung chat)
 *   - synchro:intro-seen:<uid> (introflag.ts): đã xem phim giới thiệu chưa (theo uid; xóa thì xem lại một lần)
 * Khi dời các khóa trên vào tiền tố u:<uid>: thì bỏ phần xử lý riêng này đi.
 */
export function clearAccountData(uid: string): number {
  if (!uid || uid === "anon") return 0;
  const p = `u:${uid}:`;
  const extra = (k: string) => k === "bn:synced" || k === "synchro:skill-suggest" || k.startsWith("bn:graph:") || k === `synchro:intro-seen:${uid}`;
  let n = 0;
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      const st = get();
      const keys: string[] = [];
      for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k !== null && (k.startsWith(p) || k === `draft:${uid}` || extra(k))) keys.push(k); }
      for (const k of keys) { st.removeItem(k); n++; }
    } catch { /* bộ nhớ trình duyệt bị chặn: không có gì để xóa */ }
  }
  // deleteDatabase chờ mọi kết nối đóng: trang phải đóng kho của mình trước (setChatStore(null)); kho ở tab khác tự nhường (onversionchange).
  try { if (typeof indexedDB !== "undefined" && indexedDB) indexedDB.deleteDatabase(dbName(uid)); } catch { /* không có IndexedDB / bị chặn */ }
  return n;
}

// Dữ liệu từ trước khi có tài khoản (không có tiền tố) là của chủ web: chuyển một lần vào vùng của tài khoản quản trị.
const LEGACY = (k: string) => !k.startsWith("u:") && !GLOBAL.has(k) && (k.startsWith("p:") || k.startsWith("codeS:") || ["chats", "projects", "model", "banner"].includes(k));
export function adoptLegacyData(id: string) {
  try {
    const flag = `u:${id}:legacyAdopted`;
    if (localStorage.getItem(flag)) return;
    for (const k of Object.keys(localStorage).filter(LEGACY)) {
      const dest = `u:${id}:${k}`;
      if (localStorage.getItem(dest) === null) localStorage.setItem(dest, localStorage.getItem(k) ?? "");
      localStorage.removeItem(k);
    }
    localStorage.setItem(flag, "1");
  } catch {}
}
