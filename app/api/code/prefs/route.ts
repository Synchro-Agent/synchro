import { handle, requireUser, sameOrigin } from "../../../authstore";
import { getPrefs, setPrefs } from "../../../codestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cài đặt Synchro Code của tài khoản (lưu ở máy chủ: mọi thiết bị dùng chung, việc chạy nền như tự sửa PR cũng đọc được).
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  return Response.json(getPrefs(user.id));
});
export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return Response.json(setPrefs(user.id, b && typeof b === "object" ? b : {}));
});
