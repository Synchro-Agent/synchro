import { current, limit, sameOrigin } from "../../authstore";
import { agentInbox, ModelError, type AgentEvent } from "../../agentcore";
import { effectivePerm, pickAgentModel, runAgentTurn, sessionMeta } from "../../agentturn";
import { getPrefs, patchSession } from "../../codestore";
import { sdir, wsAllowed } from "../../workspace";
import { withUsage } from "../../usage";
import { MAX_FILES_PER_MESSAGE } from "../../fileproc/types";
import type { Upload } from "../../uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Agent của Synchro Code: chạy vòng lặp model + công cụ trong workspace, trả sự kiện dạng NDJSON (mỗi dòng một JSON).
// Gói subscription và khóa API dùng được như nhau: gói chạy CLI chính chủ với cùng bộ công cụ qua cầu nối MCP (runPlanAgent).
// files: tệp gửi kèm tin nhắn mới nhất. perm: chế độ quyền của phiên ({ mode: "ask" | "edits" | "auto", allow: khóa "luôn cho phép" }); lượt dừng chờ người dùng duyệt qua /api/approve.
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  if (!wsAllowed(c.user)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng workspace (Cloud sandbox)." }, { status: 403 });
  try { limit("agent:" + c.user.id, 30, 10 * 60_000); } catch { return Response.json({ error: "Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút." }, { status: 429 }); }

  const { sid, system = "", messages = [], model: picked, project, skills: wantSkills, effort: wanted, perm, files } = await req.json();
  // Tệp / thư mục / .zip gửi kèm tin nhắn mới nhất (đã tải lên /api/files?raw=1): chép nguyên vào workspace, ảnh / PDF / chữ gửi thẳng cho model.
  const ups: Upload[] = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.id === "string" && typeof f.name === "string").slice(0, MAX_FILES_PER_MESSAGE)
    .map((f) => ({ id: f.id, name: String(f.name).slice(0, 200), folder: f.folder === true }));
  try { sdir(sid); } catch { return Response.json({ error: "Phiên không hợp lệ." }, { status: 400 }); }
  const msgs = (Array.isArray(messages) ? messages : []).slice(-30).map((m: { role: string; content: unknown }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 100_000) }));
  const pick = await pickAgentModel(c.user, picked, msgs, wanted, ups.length);
  if ("error" in pick) return Response.json({ error: pick.error, ...(pick.usageLimit ? { usageLimit: true } : {}) }, { status: pick.status });
  const p = effectivePerm(c.user.id, perm);

  const enc = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const stream = new ReadableStream({
    // Mọi lời gọi model của lượt này được tính vào mức dùng của tài khoản (Synchro Code).
    start: (ctl) => withUsage(c.user.id, "code", async () => {
      // Tệp agent đã sửa trong lượt (để đánh giá phiên cuối lượt, kể cả thư mục chưa phải repo git).
      const edited = new Set<string>();
      const emit = (e: AgentEvent) => { if (e.t === "result" && e.ok && e.diff?.path) edited.add(e.diff.path); try { ctl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      // Giữ kết nối qua proxy khi một lệnh chạy lâu (hay khi đang chờ người dùng duyệt).
      const ping = setInterval(() => { try { ctl.enqueue(enc.encode("\n")); } catch {} }, 15_000);
      // Hộp thư nhắn thêm của lượt này: tin tới sau bước cuối thì trả về trong "done" để trình duyệt gửi thành lượt mới.
      const ibox = `${c.user.id}:${sid}`;
      agentInbox.set(ibox, []);
      const ask = String(msgs.filter((m) => m.role === "user").at(-1)?.content ?? "");
      let text = "", d: string | undefined, error = "";
      try {
        const out = await runAgentTurn({ user: c.user, sid, pick, system: String(system), messages: msgs, project, skills: !!wantSkills, emit, signal: ac.signal,
          inbox: () => agentInbox.get(ibox)?.splice(0) ?? [], perm: p, files: ups });
        text = out.text; d = out.d;
        const left = agentInbox.get(ibox)?.splice(0) ?? [];
        emit({ t: "done", text: out.text, skills: out.skills, ...(left.length ? { steer: left } : {}) });
      } catch (e) {
        error = e instanceof ModelError ? `Model báo lỗi (${e.status}): ${e.message.slice(0, 300)}` : (e as Error).message || "Lỗi máy chủ";
        if (!ac.signal.aborted) emit({ t: "error", error });
      } finally {
        agentInbox.delete(ibox);
      }
      // Xếp phiên (cần bạn / chờ xem lại / xong) và gợi ý câu nhắn tiếp: người dùng thấy ngay ở danh sách phiên và khung soạn tin.
      try {
        const m = await sessionMeta(c.user, { d: d ?? sdir(sid), ask, reply: text, stopped: ac.signal.aborted, error, edited: [...edited] });
        if (m) {
          if (getPrefs(c.user.id).sync) patchSession(c.user.id, Number(sid), { state: m.state, reason: m.reason, suggest: m.suggest });
          emit({ t: "meta", state: m.state, reason: m.reason, suggest: m.suggest });
        }
      } catch (e) { console.warn("[agent] đánh giá phiên", (e as Error).message); }
      clearInterval(ping);
      try { ctl.close(); } catch {}
    }),
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
