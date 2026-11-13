import { current, getUser, limit, sameOrigin } from "../../authstore";
import { agentInbox, ModelError, type AgentEvent } from "../../agentcore";
import { effectivePerm, pickAgentModel, runAgentTurn, sessionMeta } from "../../agentturn";
import { getPrefs, patchSession, type TurnNode } from "../../codestore";
import { activeRun, latestRun, liveCount, MAX_LIVE_RUNS, runStream, startAgentRun, stopAgentRun } from "../../agentruns";
import { sdir, wsAllowed } from "../../workspace";
import { turnsTotal, WAIT_NOTE } from "../../runs";
import { acquire, withSlot } from "../../turngate";
import { withUsage } from "../../usage";
import { MAX_FILES_PER_MESSAGE } from "../../fileproc/types";
import type { Upload } from "../../uploads";
import { timed } from "../../servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Agent của Synchro Code: chạy vòng lặp model + công cụ trong workspace, trả sự kiện dạng NDJSON (mỗi dòng một JSON).
// Gói subscription và khóa API dùng được như nhau: gói chạy CLI chính chủ với cùng bộ công cụ qua cầu nối MCP (runPlanAgent).
// files: tệp gửi kèm tin nhắn mới nhất. perm: chế độ quyền của phiên ({ mode: "ask" | "edits" | "auto", allow: khóa "luôn cho phép" }); lượt dừng chờ người dùng duyệt qua /api/approve.
export const POST = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  if (!wsAllowed(c.user)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng workspace (Cloud sandbox)." }, { status: 403 });
  try { limit("agent:" + c.user.id, 30, 10 * 60_000); } catch { return Response.json({ error: "Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút." }, { status: 429 }); }

  const { sid: rawSid, system = "", messages = [], model: picked, project, skills: wantSkills, effort: wanted, perm, files, node: rawNode } = await req.json();
  const sid = String(rawSid ?? "");
  // Tệp / thư mục / .zip gửi kèm tin nhắn mới nhất (đã tải lên /api/files?raw=1): chép nguyên vào workspace, ảnh / PDF / chữ gửi thẳng cho model.
  const ups: Upload[] = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.id === "string" && typeof f.name === "string").slice(0, MAX_FILES_PER_MESSAGE)
    .map((f) => ({ id: f.id, name: String(f.name).slice(0, 200), folder: f.folder === true }));
  try { sdir(sid); } catch { return Response.json({ error: "Phiên không hợp lệ." }, { status: 400 }); }
  const msgs = (Array.isArray(messages) ? messages : []).slice(-30).map((m: { role: string; content: unknown }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 100_000) }));
  const pick = await pickAgentModel(c.user, picked, msgs, wanted, ups.length);
  if ("error" in pick) return Response.json({ error: pick.error, ...(pick.usageLimit ? { usageLimit: true } : {}) }, { status: pick.status });
  const p = effectivePerm(c.user.id, perm);

  // Một phiên chỉ chạy một lượt; lượt giờ không dừng theo kết nối nên phải chặn lượt thứ hai, và chặn một tài khoản giữ quá nhiều lượt nền.
  if (activeRun(c.user.id, sid)) return Response.json({ error: "Phiên này đang có một lượt chạy.", running: true }, { status: 409 });
  if (liveCount(c.user.id) >= MAX_LIVE_RUNS) return Response.json({ error: `Bạn đang có ${MAX_LIVE_RUNS} phiên Code chạy cùng lúc. Hãy chờ một phiên xong hoặc bấm Dừng.` }, { status: 429 });
  const node = cleanNode(rawNode);

  const run = startAgentRun({ uid: c.user.id, sid, node, title: String(node?.user ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || undefined }, (emit0, signal) =>
    // Mọi lời gọi model của lượt này được tính vào mức dùng của tài khoản (Synchro Code).
    withUsage(c.user.id, "code", async () => {
      // Tệp agent đã sửa trong lượt (để đánh giá phiên cuối lượt, kể cả thư mục chưa phải repo git).
      const edited = new Set<string>();
      const emit = (e: AgentEvent) => { if (e.t === "result" && e.ok && e.diff?.path) edited.add(e.diff.path); emit0(e); };
      // Hộp thư nhắn thêm của lượt này: tin tới sau bước cuối thì trả về trong "done" để trình duyệt gửi thành lượt mới.
      const ibox = `${c.user.id}:${sid}`;
      const box: string[] = [];
      agentInbox.set(ibox, box);
      const ask = String(msgs.filter((m) => m.role === "user").at(-1)?.content ?? "");
      let text = "", d: string | undefined, error = "";
      // Số phiên Code của một tài khoản đã có chặn ở trên (MAX_LIVE_RUNS); ở đây tính chung với lượt chat của tài khoản, và để cả máy không quá tải.
      const slot = await acquire({ uid: c.user.id, lane: "code", limit: MAX_LIVE_RUNS, total: turnsTotal(c.user), signal, onWait: (w) => emit({ t: "think", text: WAIT_NOTE[w] }) });
      if (typeof slot === "string") { agentInbox.delete(ibox); return; }
      try {
        const out = await withSlot(slot, () => runAgentTurn({ user: c.user, sid, pick, system: String(system), messages: msgs, project, skills: !!wantSkills, emit, signal,
          inbox: () => box.splice(0), perm: p, files: ups }));
        text = out.text; d = out.d;
        const left = box.splice(0);
        emit({ t: "done", text: out.text, skills: out.skills, ...(left.length ? { steer: left } : {}) });
      } catch (e) {
        error = e instanceof ModelError ? `Model báo lỗi (${e.status}): ${e.message.slice(0, 300)}` : (e as Error).message || "Lỗi máy chủ";
        if (!signal.aborted) emit({ t: "error", error });
      } finally {
        // Lượt mới của phiên có thể đã mở hộp thư riêng (bấm Dừng rồi gửi tiếp): chỉ xóa hộp của lượt này.
        if (agentInbox.get(ibox) === box) agentInbox.delete(ibox);
      }
      // Tài khoản vừa xóa khi lượt đang chạy: không gọi model để đánh giá phiên nữa.
      if (!getUser(c.user.id)) return;
      // Xếp phiên (cần bạn / chờ xem lại / xong) và gợi ý câu nhắn tiếp: người dùng thấy ngay ở danh sách phiên và khung soạn tin.
      try {
        const m = await sessionMeta(c.user, { d: d ?? sdir(sid), ask, reply: text, stopped: signal.aborted, error, edited: [...edited] });
        if (m) {
          if (getPrefs(c.user.id).sync) patchSession(c.user.id, Number(sid), { state: m.state, reason: m.reason, suggest: m.suggest });
          emit({ t: "meta", state: m.state, reason: m.reason, suggest: m.suggest });
        }
      } catch (e) { console.warn("[agent] đánh giá phiên", (e as Error).message); }
    }));
  return runStream(run, 0, req.signal);
});

// Nối lại lượt của phiên (rời trang, tải lại, mất mạng giữa chừng). ?after=: chỉ sự kiện sau mốc này. ?json=1: chỉ hỏi trạng thái. 204: không có lượt nào.
export const GET = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const u = new URL(req.url);
  const run = latestRun(c.user.id, u.searchParams.get("sid") ?? "");
  if (!run) return new Response(null, { status: 204 });
  if (u.searchParams.get("json")) return Response.json({ running: !run.ended, node: run.node?.id ?? null, ended: run.ended || null });
  return runStream(run, Number(u.searchParams.get("after")) || 0, req.signal);
});

// Nút Dừng: cách duy nhất dừng lượt đang chạy.
export const DELETE = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  return Response.json({ ok: true, stopped: stopAgentRun(c.user.id, new URL(req.url).searchParams.get("sid") ?? "") });
});

// Lượt do trình duyệt gửi kèm để máy chủ tự lưu khi không còn ai xem. Dữ liệu của chính người dùng, như khi đồng bộ phiên; quá lớn thì thôi, không phải lỗi.
function cleanNode(v: unknown): TurnNode | null {
  const n = v as TurnNode | null;
  if (!n || typeof n !== "object" || !Number.isSafeInteger(n.id) || !Number.isSafeInteger(n.parent) || JSON.stringify(n).length > 4_000_000) return null;
  return { ...n, ai: "", done: false, steps: [] };
}
