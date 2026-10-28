import { AUTO, autoEffort, routeModel } from "../../router";
import { ALL } from "../../catalog";
import { can, canModel, current, limit, permsOf, sameOrigin } from "../../authstore";
import { agentInbox, agentSystem, agentTools, anthropicAgent, mockAgent, ModelError, openaiAgent, responsesAgent, runAgent, runPlanAgent, type AgentEvent } from "../../agentcore";
import { clampEffort, effortCap, isEffort, legacyModel } from "../../catalog";
import { catalog, mainModels, pickDefault, resolveModel } from "../../providers";
import { subCli } from "../../ai/subs";
import { usableModels } from "../../ai/anymodel";
import { enabledSkills, recordUse } from "../../skillstore";
import { skillsPrompt } from "../../skillruntime";
import { exec, sdir, wsAllowed } from "../../workspace";
import { overLimit, withUsage } from "../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Agent của Synchro Code: chạy vòng lặp model + công cụ trong workspace, trả sự kiện dạng NDJSON (mỗi dòng một JSON).
// Gói subscription và khóa API dùng được như nhau: gói chạy CLI chính chủ với cùng bộ công cụ qua cầu nối MCP (runPlanAgent).
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  if (!wsAllowed(c.user)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng workspace (Cloud sandbox)." }, { status: 403 });
  try { limit("agent:" + c.user.id, 30, 10 * 60_000); } catch { return Response.json({ error: "Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút." }, { status: 429 }); }

  const { sid, system = "", messages = [], model: picked, project, skills: wantSkills, effort: wanted } = await req.json();
  let d: string;
  try { d = sdir(sid); } catch { return Response.json({ error: "Phiên không hợp lệ." }, { status: 400 }); }
  // Model do người dùng chọn (khóa "nhà cung cấp/mã model"); không chọn thì dùng model mặc định quản trị viên đặt.
  // Chế độ Tự động: việc code luôn cần model mạnh nhất tài khoản được dùng.
  let chosen = typeof picked === "string" && picked ? legacyModel(picked) : null;
  const asks = (Array.isArray(messages) ? messages : []).filter((m: { role?: string }) => m?.role !== "assistant").map((m: { content?: unknown }) => String(m?.content ?? "").slice(0, 8000));
  const lastText = asks[asks.length - 1] ?? "";
  // Lời nhờ mới nhất (kèm lời nhờ trước để câu nối tiếp như "làm lại", "tiếp đi" giữ loại việc) cho bộ chọn model và mức nỗ lực.
  const ask = { text: lastText, attachments: 0, turns: Array.isArray(messages) ? messages.length : 0, studio: false, prevAsk: asks[asks.length - 2] };
  if (chosen === AUTO) {
    // Chọn theo đúng việc đang nhờ (qua cả ba hãng, trong đúng các model bộ chọn đang hiện: gói hoặc khóa API):
    // sửa nhỏ dùng model vừa đủ cho nhanh, dựng cả ứng dụng dùng model mạnh nhất.
    const { allowed, usable } = await usableModels(c.user);
    chosen = routeModel(ask, usable.length ? usable : allowed)?.model ?? null;
  }
  const model = chosen || pickDefault(await catalog(), mainModels());
  if (!model) return Response.json({ error: "Synchro chưa được kết nối với model nào. Đăng nhập gói ở Cài đặt → Providers, hoặc quản trị viên nhập khóa API." }, { status: 503 });
  const plan = !!subCli(model);
  if (!plan && !canModel(c.user, model)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng model này." }, { status: 403 });
  const target = plan ? null : await resolveModel(model);
  if (!plan && !target) return Response.json({ error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác." }, { status: 400 });
  // Nỗ lực "Tự động": theo độ khó của việc (code luôn ít nhất mức vừa).
  const want = wanted === "auto" ? (() => { const e = autoEffort(ask); return e === "low" ? "medium" : e; })() : wanted;
  const effort = isEffort(want) ? (target ? clampEffort(want, effortCap(permsOf(c.user).effort, model), target.kind) : clampEffort(want, effortCap(permsOf(c.user).effort, model), "anthropic")) : undefined;
  // Hạn mức chi phí chỉ áp cho khóa API (gói tính vào hạn mức của chính gói).
  const over = plan ? null : overLimit(c.user);
  if (over) return Response.json({ error: over, usageLimit: true }, { status: 429 });

  const enc = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const stream = new ReadableStream({
    // Mọi lời gọi model của lượt này được tính vào mức dùng của tài khoản (Synchro Code).
    start: (ctl) => withUsage(c.user.id, "code", async () => {
      const emit = (e: AgentEvent) => { try { ctl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      // Giữ kết nối qua proxy khi một lệnh chạy lâu.
      const ping = setInterval(() => { try { ctl.enqueue(enc.encode("\n")); } catch {} }, 15_000);
      // Hộp thư nhắn thêm của lượt này: tin tới sau bước cuối thì trả về trong "done" để trình duyệt gửi thành lượt mới.
      const ibox = `${c.user.id}:${sid}`;
      agentInbox.set(ibox, []);
      try {
        const info = await exec(c.user.id, d, { cmd: "git rev-parse --abbrev-ref HEAD 2>/dev/null; git remote get-url origin 2>/dev/null | sed -E 's#https://[^@/]*@#https://#'", timeout: 20 });
        const [branch, remote] = info.out.split("\n");
        const repo = /github\.com[/:]([^/]+\/[^/.\s]+)/.exec(remote ?? "")?.[1] ?? null;
        const list = wantSkills && can(c.user, "skills") ? await enabledSkills(c.user.id, project ? String(project) : null) : [];
        const scripts = !!process.env.E2B_API_KEY && can(c.user, "sandbox");
        const sys = agentSystem({ d, repo, branch: repo ? branch || null : null, extra: String(system).slice(0, 60_000), skills: list.length ? skillsPrompt(list, scripts) : "" });
        const tools = agentTools(list.length, scripts);
        const msgs = (Array.isArray(messages) ? messages : []).slice(-30).map((m: { role: string; content: unknown }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 100_000) }));
        if (plan) {
          const out = await runPlanAgent({ user: c.user, model, effort, conv: `code-${String(sid)}`.slice(0, 64), system: sys, messages: msgs, u: c.user.id, d, skills: list, scripts, tools,
            emit, signal: ac.signal, inbox: () => agentInbox.get(ibox)?.splice(0) ?? [] });
          if (out.skills.length) recordUse(c.user.id, out.skills);
          const left = agentInbox.get(ibox)?.splice(0) ?? [];
          emit({ t: "done", text: out.text, skills: out.skills, ...(left.length ? { steer: left } : {}) });
          return;
        }
        const t = target!;
        // Máy chủ chạy chế độ thử nghiệm (LLM_PROVIDER=mock): dùng kịch bản mô phỏng.
        const adapter = t.kind === "mock" ? mockAgent()
          : t.kind === "anthropic" ? anthropicAgent({ provider: t.provider, key: t.key, base: t.base, model: t.model, system: sys, maxTokens: 8000, tools, signal: ac.signal, effort })
          : (t.kind === "openai" ? responsesAgent : openaiAgent)({ provider: t.provider, key: t.key, base: t.base, model: t.model, system: sys, maxTokens: 8000, tools, signal: ac.signal, kind: t.kind, effort });
        const out = await runAgent({ adapter, messages: msgs, u: c.user.id, d, skills: list, scripts, emit, signal: ac.signal, inbox: () => agentInbox.get(ibox)?.splice(0) ?? [] });
        if (out.skills.length) recordUse(c.user.id, out.skills);
        const left = agentInbox.get(ibox)?.splice(0) ?? [];
        emit({ t: "done", text: out.text, skills: out.skills, ...(left.length ? { steer: left } : {}) });
      } catch (e) {
        if (!ac.signal.aborted) emit({ t: "error", error: e instanceof ModelError ? `Model báo lỗi (${e.status}): ${e.message.slice(0, 300)}` : (e as Error).message || "Lỗi máy chủ" });
      } finally {
        agentInbox.delete(ibox);
        clearInterval(ping);
        try { ctl.close(); } catch {}
      }
    }),
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
