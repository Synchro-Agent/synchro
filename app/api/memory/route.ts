import { handle, requireUser, sameOrigin } from "../../authstore";
import { addMemory, clearMemory, deleteMemory, listMemory, memCfg, setMemCfg } from "../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bộ nhớ của chính người dùng: xem, thêm (nhập từ trợ lý AI khác), xóa từng mục / xóa hết, bật tắt tự rút và chủ đề nhạy cảm.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  return Response.json({ items: listMemory(user.id), cfg: memCfg(user.id) });
});
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { items?: unknown; text?: unknown; cfg?: { gen?: unknown; sens?: unknown } };
  if (b.cfg) setMemCfg(user.id, { ...(typeof b.cfg.gen === "boolean" ? { gen: b.cfg.gen } : {}), ...(typeof b.cfg.sens === "boolean" ? { sens: b.cfg.sens } : {}) });
  // Nhập: mỗi dòng (hoặc mỗi gạch đầu dòng) là một mục.
  const raw = Array.isArray(b.items) ? b.items : typeof b.text === "string" ? b.text.split(/\n+/) : [];
  const items = raw.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter(Boolean).slice(0, 200);
  const added = items.length ? addMemory(user.id, items, typeof b.text === "string" ? "import" : "manual") : [];
  return Response.json({ items: listMemory(user.id), cfg: memCfg(user.id), added: added.length });
});
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteMemory(user.id, id); else clearMemory(user.id);
  return Response.json({ items: listMemory(user.id), cfg: memCfg(user.id) });
});
