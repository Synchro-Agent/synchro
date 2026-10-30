import { AuthError, can, handle, requireUser, sameOrigin } from "../../authstore";
import { gitOp } from "../../codegit";
import { agent, exec, fsop, requireWs, sdir, ticket, wsConfigured } from "../../workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trạng thái workspace của tài khoản: có dùng được không, container đang chạy không.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  if (!wsConfigured()) return Response.json({ available: false, reason: "Máy chủ chưa bật workspace." });
  if (!can(user, "code") || !can(user, "sandbox")) return Response.json({ available: false, reason: "Quản trị viên chưa cho phép tài khoản của bạn dùng workspace (Cloud sandbox)." });
  const s = await agent<{ running: boolean; idleMin: number }>("/status", { u: user.id }).catch(() => null);
  return Response.json({ available: !!s, reason: s ? undefined : "Không kết nối được workspace.", running: !!s?.running, idleMin: s?.idleMin });
});

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

// { op, sid, ... }: bật/dừng workspace, vé terminal/trình duyệt, thao tác file và git trong thư mục của phiên.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  requireWs(user);
  const b = (await req.json()) as Record<string, unknown>;
  const op = str(b.op, 20);
  if (op === "stop") { await agent("/stop", { u: user.id }); return Response.json({ ok: true }); }
  const d = sdir(b.sid);
  const u = user.id;
  switch (op) {
    case "ensure": await agent("/ensure", { u }); await exec(u, d, { cmd: "true" }); return Response.json({ ok: true });
    case "ticket": {
      const k = b.kind === "screen" ? "screen" : b.kind === "log" ? "log" : "term";
      await agent("/ensure", { u });
      return Response.json({ url: ticket(req, u, d, k) });
    }
    case "list": return Response.json(await fsop(u, d, "list", str(b.path) || "."));
    case "tree": return Response.json(await fsop(u, d, "tree", str(b.path) || ".", "3000"));
    case "read": return Response.json(await fsop(u, d, "read", str(b.path), "2000000"));
    case "write": {
      if (typeof b.content !== "string" || b.content.length > 5_000_000) throw new AuthError("Nội dung không hợp lệ.", 400);
      return Response.json(await fsop(u, d, "write", str(b.path), undefined, b.content));
    }
    case "mkdir": return Response.json(await fsop(u, d, "mkdir", str(b.path)));
    case "rm": return Response.json(await fsop(u, d, "rm", str(b.path)));
    case "mv": return Response.json(await fsop(u, d, "mv", str(b.path), str(b.to)));
    case "git": return Response.json(await gitOp(user, d, b));
    default: throw new AuthError("Thao tác không hợp lệ.", 400);
  }
});
