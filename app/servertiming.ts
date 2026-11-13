// Đo trước khi sửa: mỗi phản hồi của /api/* đi qua handle() / timed() mang header Server-Timing
//   auth;dur=…  thời gian kiểm tra đăng nhập (current() trong authstore, cộng dồn nếu gọi nhiều lần)
//   work;dur=…  phần còn lại của route (total − auth)
//   total;dur=… từ lúc route nhận yêu cầu tới lúc trả phản hồi (với luồng SSE: tới lúc gửi header, không chờ hết luồng)
// Trình duyệt hiện các số này ở DevTools → Network → Timing. Chỉ là con số thời gian, không lộ nội dung gì.
// Không import mô-đun nào của app để authstore và mọi route dùng được mà không tạo vòng import.
import { AsyncLocalStorage } from "node:async_hooks";

type Clock = { auth: number };
const g = globalThis as unknown as { __synchroTimingAls?: AsyncLocalStorage<Clock> };
const als = (g.__synchroTimingAls ??= new AsyncLocalStorage<Clock>());

const ms = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Chạy fn và cộng thời gian của nó vào phần auth của yêu cầu đang đo (ngoài một yêu cầu đang đo thì chỉ chạy fn). */
export function timeAuth<T>(fn: () => T): T {
  const c = als.getStore();
  if (!c) return fn();
  const t = performance.now();
  try { return fn(); } finally { c.auth += performance.now() - t; }
}

/** Chuỗi header Server-Timing từ hai con số (ms). */
export const serverTiming = (auth: number, total: number) => `auth;dur=${ms(auth)}, work;dur=${ms(Math.max(0, total - auth))}, total;dur=${ms(total)}`;

/** Gắn header vào phản hồi. Phản hồi có header bất biến (Response.redirect, fetch chuyển tiếp) thì tạo bản sao cùng body, trạng thái, header. */
export function withServerTiming(res: Response, value: string): Response {
  try { res.headers.set("Server-Timing", value); return res; } catch { /* header bất biến */ }
  try {
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    out.headers.set("Server-Timing", value);
    return out;
  } catch { return res; } // trạng thái không tạo lại được (101…): trả nguyên phản hồi, chỉ mất số đo
}

/** Bọc route handler để đo. Bọc lồng nhau (timed(handle(…))) chỉ đo ở lớp ngoài cùng, không gắn header hai lần. */
export function timed<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response> | Response) {
  return async (req: Request, ...a: A): Promise<Response> => {
    if (als.getStore()) return fn(req, ...a);
    const clock: Clock = { auth: 0 };
    const t0 = performance.now();
    const res = await als.run(clock, () => fn(req, ...a));
    return withServerTiming(res, serverTiming(clock.auth, performance.now() - t0));
  };
}
