// Giới hạn tần suất theo khóa (đăng nhập, đăng ký, gửi thư…): đếm trong bộ nhớ của tiến trình.
import "server-only";
import { AuthError } from "./auth/errors";

// ---- giới hạn tần suất (bộ nhớ trong; app chạy một tiến trình) ----
const hits = new Map<string, { n: number; t: number }>();
// Môi trường kiểm thử (npm run dev:mock, CI) chạy hàng trăm lượt đăng nhập, đăng ký, tạo connector liên tục từ một địa chỉ:
// nới giới hạn 50 lần. Chỉ dev-mock đặt biến này; bản chạy thật không đặt nên giới hạn giữ nguyên.
const RELAX = process.env.SYNCHRO_RELAX_LIMITS === "1" ? 50 : 1;
export function limit(key: string, max: number, windowMs: number) {
  max *= RELAX;
  const now = Date.now();
  if (hits.size > 20_000) for (const [k, v] of hits) if (v.t < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.t < now) { hits.set(key, { n: 1, t: now + windowMs }); return; }
  if (++h.n > max) throw new AuthError("Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.", 429);
}
