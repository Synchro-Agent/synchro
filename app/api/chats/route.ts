import { forgetConv } from "../../brain";
import { AuthError, handle, limit, requireUser, sameOrigin } from "../../authstore";
import { changesSince, itemsByKey, pushItems, wipeItems, type PushItem } from "../../chatstore";
import { deleteConvRuns } from "../../runs";
import { revokeAllShares, revokeConvShare } from "../../sharestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đoạn chat và dự án theo tài khoản (chatsync.ts ở trình duyệt, chatstore.ts ở máy chủ).
// GET ?since=<rev>: những gì đổi từ mốc này, theo từng trang. GET ?keys=chat:1,project:2: đúng các mục đó.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams, keys = q.get("keys");
  if (keys !== null) return Response.json({ items: itemsByKey(user.id, keys.split(",").filter(Boolean)) });
  return Response.json({ ...changesSince(user.id, Math.max(0, Number(q.get("since")) || 0)), now: Date.now() });
});

/** Xóa đoạn chat là xóa hết phần sinh ra từ nó: ghi chú và điều đã học trong bộ não, lượt chạy đã lưu, liên kết chia sẻ. Gọi lại nhiều lần vẫn an toàn. */
function purgeChat(uid: string, conv: string) {
  forgetConv(uid, conv);
  deleteConvRuns(uid, conv);
  revokeConvShare(uid, conv);
}

// PUT { items: [{ kind, id, upd, data?, deleted? }] } nhận một đợt (mỗi mục báo kết quả riêng); { wipe: <mốc> } xóa mọi thứ có mốc sửa trước đó.
export const PUT = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("chatsync:" + user.id, 3000, 60 * 60_000);
  const b = (await req.json().catch(() => null)) as { items?: unknown; wipe?: unknown } | null;
  if (!b) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  if (b.wipe !== undefined) {
    for (const id of wipeItems(user.id, Number(b.wipe))) purgeChat(user.id, id);
    revokeAllShares(user.id);
    return Response.json({ ok: true });
  }
  if (!Array.isArray(b.items)) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  const results = pushItems(user.id, b.items as PushItem[]);
  for (const r of results) if (r.ok && r.deleted && r.kind === "chat") purgeChat(user.id, r.id);
  return Response.json({ results, now: Date.now() });
});
