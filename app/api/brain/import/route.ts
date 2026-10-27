import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { importChats, pendingCount } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nạp các đoạn chat cũ đang lưu trong trình duyệt vào bộ não (mỗi lần tối đa 50 đoạn; trình duyệt gửi từng đợt).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("brainimport:" + user.id, 60, 60 * 60_000);
  const b = (await req.json().catch(() => ({}))) as { chats?: unknown };
  const chats = (Array.isArray(b.chats) ? b.chats : []).flatMap((c) => {
    const o = c as { id?: unknown; title?: unknown; msgs?: unknown };
    if ((typeof o.id !== "string" && typeof o.id !== "number") || !Array.isArray(o.msgs)) return [];
    const msgs = (o.msgs as { role?: unknown; text?: unknown }[]).filter((m) => typeof m?.text === "string").map((m) => ({ role: String(m.role ?? "user"), text: String(m.text).slice(0, 20_000) }));
    return [{ id: String(o.id), title: typeof o.title === "string" ? o.title : undefined, msgs }];
  });
  return Response.json({ queued: importChats(user, chats), pending: pendingCount(user.id) });
});
