import { forgetConv } from "../../brain";
import { AuthError, handle, limit, requireUser, sameOrigin, verifyLocked } from "../../authstore";
import { changesSince, chatRefs, itemMentions, itemsByKey, pushItems, SYNC_LIMITS, wipeItems, type ChatRefs, type PushItem } from "../../chatstore";
import { removeConvSessions } from "../../ai/subs";
import { releaseFile } from "../../fileproc/owners";
import { removeOutput } from "../../outputs";
import { removeConvRefs } from "../../refs";
import { deleteConvRuns, liveRunOf } from "../../runs";
import { revokeAllShares, revokeConvShare } from "../../sharestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đoạn chat và dự án theo tài khoản (chatsync.ts ở trình duyệt, chatstore.ts ở máy chủ).
// GET ?since=<rev>: những gì đổi từ mốc này, theo từng trang. GET ?keys=chat:1,project:2: đúng các mục đó.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams, keys = q.get("keys");
  if (keys !== null) return Response.json({ items: itemsByKey(user.id, keys.split(",").filter(Boolean)) });
  return Response.json({ ...(await changesSince(user.id, Math.max(0, Number(q.get("since")) || 0))), now: Date.now() });
});

/** Xóa đoạn chat là xóa hết phần sinh ra từ nó: ghi chú và điều đã học trong bộ não, lượt chạy đã lưu, liên kết chia sẻ, kết quả công cụ, lịch sử phiên của CLI. Gọi lại nhiều lần vẫn an toàn.
 *  Artifact giữ lại trừ khi người dùng chọn xóa (hộp thoại nói rõ). */
function purgeChat(uid: string, conv: string) {
  forgetConv(uid, conv);
  // CLI vừa bị dừng còn có thể ghi nốt lịch sử phiên: chờ nó thoát rồi mới xóa.
  const running = !!liveRunOf(uid, conv);
  deleteConvRuns(uid, conv);
  revokeConvShare(uid, conv);
  removeConvRefs(uid, conv);
  const go = () => void removeConvSessions(uid, conv).catch((e) => console.error("[chats] phiên CLI", e));
  if (running) setTimeout(go, 20_000).unref?.(); else go();
}
/** Tệp chỉ đoạn chat vừa xóa dùng: đoạn chat tách nhánh hay dự án còn nhắc tới thì giữ. Tệp tải lên có thể có chủ khác: chỉ bỏ quyền của người này (releaseFile). */
async function dropUnused(uid: string, r: ChatRefs) {
  for (const id of r.outs) if (!itemMentions(uid, id)) removeOutput(uid, id);
  for (const id of r.files) if (!itemMentions(uid, id)) await releaseFile(uid, id);
}

// PUT { items: [{ kind, id, upd, data?, deleted? }] } nhận một đợt (mỗi mục báo kết quả riêng); { wipe: <mốc> } xóa mọi thứ có mốc sửa trước đó.
export const PUT = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("chatsync:" + user.id, 3000, 60 * 60_000);
  const b = (await req.json().catch(() => null)) as { items?: unknown; wipe?: unknown } | null;
  if (!b) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  const clean = (r: ChatRefs) => void dropUnused(user.id, r).catch((e) => console.error("[chats] tệp", e));
  if (b.wipe !== undefined) {
    const refs = chatRefs(user.id);
    for (const id of wipeItems(user.id, Number(b.wipe))) purgeChat(user.id, id);
    revokeAllShares(user.id);
    clean(refs);
    return Response.json({ ok: true });
  }
  if (!Array.isArray(b.items)) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  const dels = (b.items as PushItem[]).filter((x) => x?.deleted && x.kind === "chat" && typeof x.id === "string").map((x) => x.id);
  const refs = dels.length ? chatRefs(user.id, dels) : null;
  const results = pushItems(user.id, b.items as PushItem[], verifyLocked(user) ? { total: SYNC_LIMITS.lockedTotal } : undefined);
  for (const r of results) if (r.ok && r.deleted && r.kind === "chat") purgeChat(user.id, r.id);
  // Đoạn chat thua xung đột vẫn còn nội dung nên itemMentions giữ lại tệp của nó.
  if (refs) clean(refs);
  return Response.json({ results, now: Date.now() });
});
