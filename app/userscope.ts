// Dữ liệu lưu trong trình duyệt được tách theo tài khoản: mọi khóa localStorage của app mang tiền tố
// "u:<userId>:", nên hai tài khoản dùng chung một trình duyệt không thấy chat, dự án, ảnh đại diện… của nhau.
// Vài khóa là cài đặt của cả trình duyệt (giao diện sáng/tối, ngôn ngữ) thì dùng chung.
const GLOBAL = new Set(["theme", "p:uilang"]);
let scope = "anon";

export const userScope = () => scope;
export const setUserScope = (id: string | null) => { scope = id || "anon"; };
const prefix = () => `u:${scope}:`;
export const scoped = (k: string) => (GLOBAL.has(k) ? k : prefix() + k);

export const ls = {
  get(k: string) { try { return localStorage.getItem(scoped(k)); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(scoped(k), v); } catch {} },
  remove(k: string) { try { localStorage.removeItem(scoped(k)); } catch {} },
  // Khóa (đã bỏ tiền tố) của tài khoản hiện tại.
  keys(): string[] { try { const p = prefix(); return Object.keys(localStorage).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length)); } catch { return []; } },
  clear() { for (const k of this.keys()) this.remove(k); },
};

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
