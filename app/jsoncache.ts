// Danh sách skill và thư viện (cả trăm KB): menu + và bảng lệnh ⌘K mỗi lần mở từng tải lại từ đầu. Giữ 5 phút, gọi trùng thì dùng chung,
// có thay đổi trong Kho kỹ năng thì bỏ bản đệm (app/studios.ts nghe sự kiện). Lần tải lỗi không được giữ.
// Khóa theo tài khoản đang mở (userScope) + URL: đăng xuất rồi người khác đăng nhập trên cùng tab (không tải lại trang) không bao giờ nhận bản
// của tài khoản trước (số skill của studio, quyền quản trị của nút Thêm skill / Kho kỹ năng). Đổi tài khoản còn xóa hẳn (clearJsonCache).
import { userScope } from "./userscope";

const jsonCache = new Map<string, { at: number; p: Promise<unknown> }>();
const keyOf = (url: string) => `${userScope()}\n${url}`;
export function cachedJson<T>(url: string, ttl = 300_000): Promise<T> {
  const key = keyOf(url), hit = jsonCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).catch(() => { jsonCache.delete(key); return {}; });
  jsonCache.set(key, { at: Date.now(), p });
  return p as Promise<T>;
}
/** Đặt sẵn một kết quả vào bộ đệm của cachedJson (dữ liệu dựng ở máy chủ), giữ như một lần tải thật. Gọi sau khi đã vào vùng của tài khoản. */
export function seedJson(url: string, data: unknown) { jsonCache.set(keyOf(url), { at: Date.now(), p: Promise.resolve(data) }); }
/** Đăng xuất / đổi tài khoản, hay Kho kỹ năng vừa đổi: bỏ mọi bản đệm. */
export function clearJsonCache() { jsonCache.clear(); }
