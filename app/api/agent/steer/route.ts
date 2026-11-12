import { current, sameOrigin } from "../../../authstore";
import { agentInbox } from "../../../agentcore";
import { timed } from "../../../servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nhắn thêm khi agent của Synchro Code đang làm: không ngắt, agent nhận tin ở bước kế tiếp.
// queued = false: lượt đã xong, trình duyệt gửi tin thành lượt mới.
export const POST = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const b = (await req.json().catch(() => ({}))) as { sid?: unknown; text?: unknown };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 20_000) : "";
  if (!text) return Response.json({ error: "Tin nhắn trống." }, { status: 400 });
  const box = agentInbox.get(`${c.user.id}:${String(b.sid ?? "")}`);
  if (!box) return Response.json({ queued: false });
  box.push(text);
  return Response.json({ queued: true });
});
