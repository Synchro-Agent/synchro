import { AuthError, handle, requireUser, sameOrigin } from "../../../authstore";
import { stopAgentRun } from "../../../agentruns";
import { archiveIdle, deleteSession, getPrefs, getSession, listSessions, patchSession, putSession } from "../../../codestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AuthError("Phiên không hợp lệ.", 400); return n; };

// Phiên Synchro Code đồng bộ giữa các thiết bị. GET: danh sách (?since=: chỉ phiên đổi sau mốc này); ?id=: một phiên kèm nội dung.
// Mỗi lần lấy danh sách cũng lưu trữ các phiên không hoạt động quá ngưỡng người dùng chọn.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const u = new URL(req.url);
  if (u.searchParams.get("id")) {
    const s = getSession(user.id, idOf(u.searchParams.get("id")));
    if (!s || s.deleted) return Response.json({ error: "Không tìm thấy phiên." }, { status: 404 });
    const since = Number(u.searchParams.get("since") ?? 0);
    // Thiết bị đã có bản này rồi: không gửi lại nội dung.
    return Response.json(since && s.updated <= since ? { ...s, data: undefined, same: true } : s);
  }
  archiveIdle(user.id);
  const since = Number(u.searchParams.get("since") ?? 0) || 0;
  return Response.json({ sessions: listSessions(user.id, since), now: Date.now(), sync: getPrefs(user.id).sync });
});

// PUT { id, title, data?, pinned?, archived?, base? }: lưu phiên (base: mốc của bản thiết bị dựa vào, để gộp với lượt mới từ nơi khác).
// PATCH { id, archived?, pinned?, title?, state? }: đổi thông tin phiên không cần gửi nội dung.
export const PUT = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = idOf(b.id);
  const data = b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : null;
  if (data && JSON.stringify(data).length > 8_000_000) throw new AuthError("Phiên quá lớn để đồng bộ.", 413);
  if (!getPrefs(user.id).sync) throw new AuthError("Đồng bộ phiên Code đang tắt.", 409);
  return Response.json(putSession(user.id, id, { title: typeof b.title === "string" ? b.title : undefined, data, pinned: typeof b.pinned === "boolean" ? b.pinned : undefined,
    archived: typeof b.archived === "boolean" ? b.archived : undefined, base: Number(b.base) || 0 }));
});
export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = idOf(b.id);
  const p: Parameters<typeof patchSession>[2] = {};
  if (typeof b.archived === "boolean") p.archived = b.archived;
  if (typeof b.pinned === "boolean") p.pinned = b.pinned;
  if (typeof b.title === "string" && b.title.trim()) p.title = b.title.trim().slice(0, 120);
  if (b.state === null || b.state === "blocked" || b.state === "review" || b.state === "done") { p.state = b.state as string | null; if (b.state === null) { p.reason = null; } }
  patchSession(user.id, id, p);
  return Response.json({ ok: true });
});
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const id = idOf(new URL(req.url).searchParams.get("id"));
  // Lượt không còn dừng theo kết nối: xóa phiên thì dừng luôn việc đang làm trong phiên đó.
  stopAgentRun(user.id, String(id));
  deleteSession(user.id, id);
  return Response.json({ ok: true });
});
