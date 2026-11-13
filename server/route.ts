// Bọc chung cho route API ghi dữ liệu (F1 — tăng cường bảo mật). Một chỗ lo các việc xuyên suốt:
//   • đăng nhập (và vai trò / tính năng) trước khi vào handler;
//   • sameOrigin() cho MỌI phương thức không phải GET/HEAD (chặn CSRF);
//   • route JSON: từ chối khi Content-Type không phải application/json (chặn form đơn giản chéo trang);
//   • giới hạn tần suất theo từng tài khoản;
//   • header Server-Timing (qua handle() → timed()), và AuthError → JSON lỗi.
// Wrapper KHÔNG đọc thân yêu cầu: handler tự đọc req.json()/req.formData() như trước (ít thay đổi, một lần đọc).
// Dùng cho route ghi; GET chỉ đọc vẫn dùng handle()/featureGate() như cũ.
import {
  AuthError, current, featureGate, handle, isAdmin, limit as rateLimit, ownerOnly, sameOrigin,
  type SessionRow, type UserRow,
} from "../app/authstore";
import type { Feature } from "../app/catalog";

export type RouteAuth = "user" | "admin" | "owner";
export type RateLimit = { key: string; max: number; windowMs: number };
export type RouteOpts = {
  /** Vai trò tối thiểu. Mặc định "user" (chỉ cần đăng nhập). */
  auth?: RouteAuth;
  /** Cổng tính năng (featureGate): kèm yêu cầu đăng nhập, và trả thông báo "xác minh email" khi bị khóa tạm. */
  feature?: Feature;
  /** Thân yêu cầu là JSON: từ chối Content-Type khác application/json (chỉ áp cho POST/PUT/PATCH). */
  json?: boolean;
  /** Giới hạn tần suất theo tài khoản: khóa thật là `${key}:${user.id}`. Dạng hàm để mức phụ thuộc tài khoản. */
  limit?: RateLimit | ((user: UserRow) => RateLimit | null);
};

export type RouteCtx<P = undefined> = {
  req: Request;
  user: UserRow;
  session: SessionRow;
  /** Tham số đường dẫn của Next (đã await). */
  params: P;
};

// Route không có tham số: Next truyền { params: Promise<{}> }, nên P = undefined nhận mọi thứ (unknown) để qua kiểm kiểu của next build.
type NextCtx<P> = { params: Promise<[P] extends [undefined] ? unknown : P> };
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Bọc một handler route ghi dữ liệu. Trả về hàm đúng chữ ký Next.js (req, { params }). */
export function route<P = undefined>(
  opts: RouteOpts,
  handler: (ctx: RouteCtx<P>) => Promise<Response> | Response,
): (req: Request, nextCtx?: NextCtx<P>) => Promise<Response> {
  return handle(async (req: Request, nextCtx?: NextCtx<P>) => {
    const method = req.method.toUpperCase();
    // 1) Chống CSRF: mọi phương thức ghi phải đến từ chính trang Synchro.
    if (method !== "GET" && method !== "HEAD") sameOrigin(req);
    // 2) Route JSON: thân phải là application/json (chặn form chéo trang gửi text/plain, multipart…).
    if (opts.json && BODY_METHODS.has(method)) {
      const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (ct !== "application/json") throw new AuthError("Yêu cầu phải là application/json.", 415);
    }
    // 3) Đăng nhập + vai trò.
    const c = current(req);
    if (!c) throw new AuthError("Bạn cần đăng nhập.", 401);
    const { user, session } = c;
    if (opts.auth === "admin" || opts.auth === "owner") {
      if (!isAdmin(user)) throw new AuthError("Chỉ quản trị viên mới có quyền này.", 403);
      if (opts.auth === "owner") ownerOnly(user);
    }
    // 4) Cổng tính năng (nếu có): trả nguyên phản hồi 401/403 của featureGate.
    if (opts.feature) { const denied = featureGate(req, opts.feature); if (denied) return denied; }
    // 5) Giới hạn tần suất theo tài khoản.
    const rl = typeof opts.limit === "function" ? opts.limit(user) : opts.limit;
    if (rl) rateLimit(`${rl.key}:${user.id}`, rl.max, rl.windowMs);
    const params = (nextCtx ? await nextCtx.params : undefined) as P;
    return handler({ req, user, session, params });
  });
}
