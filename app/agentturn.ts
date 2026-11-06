// Một lượt của agent Synchro Code (lượt người dùng gửi qua /api/agent, hay lượt chạy nền như tự sửa pull request):
// chọn model, dựng lời nhắc hệ thống, chạy vòng lặp công cụ qua chốt chặn (chế độ quyền, trang web được phép), rồi đánh giá phiên.
import { askedBack, AUTO, autoEffort, routeModel } from "./router";
import { can, canModel, permsOf, type UserRow } from "./authstore";
import { agentSystem, agentTools, anthropicAgent, mockAgent, openaiAgent, responsesAgent, runAgent, runPlanAgent, type AgentEvent, type ExtraTool } from "./agentcore";
import { clampEffort, effortCap, isEffort, legacyModel } from "./catalog";
import { catalog, mainModels, pickDefault, resolveModel } from "./providers";
import { subCli } from "./ai/subs";
import { usableModels } from "./ai/anymodel";
import { quickCall } from "./ai/anymodel";
import { enabledSkills, recordUse } from "./skillstore";
import { skillsPrompt } from "./skillruntime";
import { exec, sdir } from "./workspace";
import { overLimit } from "./usage";
import { repoOfRemote } from "./github";
import { makeGate } from "./agentgate";
import type { Ask } from "./approvals";
import { buildContext } from "./fileproc";
import { toAnthropic, toOpenAI, toResponses, withPages } from "./llmcall";
import { placeUploads, type Upload } from "./uploads";
import { runBrowserTool } from "./browsertools";
import { getPrefs, patchSession, type PermMode } from "./codestore";
import { topRule } from "./brain";
import { gitOp } from "./codegit";

type Msg = { role: string; content: unknown };
export type Picked = { model: string; plan: boolean; target: Awaited<ReturnType<typeof resolveModel>>; effort?: string };

/** Model của lượt (chế độ Tự động chọn theo việc đang nhờ) và mức nỗ lực; lỗi trả về để route báo ngay cho người dùng. */
export async function pickAgentModel(user: UserRow, picked: unknown, messages: Msg[], wanted: unknown, attachments = 0): Promise<Picked | { error: string; status: number; usageLimit?: boolean }> {
  let chosen = typeof picked === "string" && picked ? legacyModel(picked) : null;
  const asks = messages.filter((m) => m?.role !== "assistant").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).slice(0, 8000));
  // Lời nhờ mới nhất (kèm lời nhờ trước để câu nối tiếp như "làm lại", "tiếp đi" giữ loại việc) cho bộ chọn model và mức nỗ lực.
  const lastAi = [...messages].reverse().find((m) => m?.role === "assistant")?.content;
  const ask = { text: asks[asks.length - 1] ?? "", attachments, turns: messages.length, studio: false, prevAsk: asks[asks.length - 2], asked: typeof lastAi === "string" && askedBack(lastAi) };
  if (chosen === AUTO) {
    const { allowed, usable } = await usableModels(user);
    chosen = routeModel(ask, usable.length ? usable : allowed)?.model ?? null;
  }
  const model = chosen || pickDefault(await catalog(), mainModels());
  if (!model) return { error: "Synchro chưa được kết nối với model nào. Đăng nhập gói ở Cài đặt → Providers, hoặc quản trị viên nhập khóa API.", status: 503 };
  const plan = !!subCli(model);
  if (!plan && !canModel(user, model)) return { error: "Quản trị viên chưa cho phép tài khoản của bạn dùng model này.", status: 403 };
  const target = plan ? null : await resolveModel(model);
  if (!plan && !target) return { error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác.", status: 400 };
  // Nỗ lực "Tự động": theo độ khó của việc (code luôn ít nhất mức vừa).
  const want = wanted === "auto" ? (() => { const e = autoEffort(ask); return e === "low" ? "medium" : e; })() : wanted;
  const effort = isEffort(want) ? clampEffort(want, effortCap(permsOf(user).effort, model), target ? target.kind : "anthropic") : undefined;
  // Hạn mức chi phí chỉ áp cho khóa API (gói tính vào hạn mức của chính gói).
  const over = plan ? null : overLimit(user);
  if (over) return { error: over, status: 429, usageLimit: true };
  return { model, plan, target, effort };
}

/** Chế độ quyền thật của lượt: tắt "cho phép chế độ Tự động" thì Tự động hạ xuống Tự sửa tệp. */
export function effectivePerm(uid: string, p: unknown): { mode: PermMode; allow: string[] } {
  const prefs = getPrefs(uid);
  const o = (p && typeof p === "object" ? p : {}) as { mode?: unknown; allow?: unknown };
  let mode: PermMode = o.mode === "ask" || o.mode === "edits" || o.mode === "auto" ? o.mode : prefs.permMode;
  if (mode === "auto" && !prefs.allowBypass) mode = "edits";
  const allow = (Array.isArray(o.allow) ? o.allow : []).filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, 100);
  return { mode, allow };
}

// Đẩy code và mở pull request bằng GitHub người dùng đã kết nối, cùng đường với nút Push / Tạo PR ở khung Changes
// (lệnh git push trong bash không có quyền). Qua chốt chặn như lệnh thường: chế độ Tự động thì làm luôn, không thì hỏi duyệt.
const gitTools = (user: UserRow, d: string, sid: string | number) => [
  { def: { name: "git_push", description: "Đẩy các commit của phiên lên GitHub bằng tài khoản GitHub người dùng đã kết nối (như nút Push). Bật \"Tự tạo pull request\" ở Cài đặt thì đang ở nhánh chính sẽ tự sang nhánh mới rồi mở PR. Commit trước khi push.", input_schema: { type: "object", properties: {}, required: [] } },
    run: async () => {
      const r = await gitOp(user, d, { action: "push", sid }) as { branch?: string; repo?: string | null; output?: string; pr?: { url: string; number: number } };
      return { content: `Đã push nhánh ${r.branch ?? "?"}${r.repo ? ` lên ${r.repo}` : ""}.${r.pr ? ` Pull request #${r.pr.number}: ${r.pr.url}` : ""}\n${(r.output ?? "").slice(-1500)}`.trim(), is_error: false, summary: r.pr ? `${r.branch} · #${r.pr.number}` : r.branch ?? "" };
    } },
  { def: { name: "create_pull_request", description: "Mở pull request cho nhánh hiện tại (đã có PR thì trả về PR đó). Đang ở nhánh chính thì tự tạo nhánh mới theo tiền tố của người dùng và đẩy lên trước. title / body: tiêu đề và mô tả PR (bỏ trống thì lấy từ commit); base: nhánh đích (mặc định nhánh chính của repo).",
    input_schema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, base: { type: "string" } }, required: [] } },
    run: async (a: Record<string, unknown>) => {
      const r = await gitOp(user, d, { action: "pr", sid, title: a.title, body: a.body, base: a.base }) as { branch?: string; pr?: { url: string; number: number; created: boolean } };
      return { content: `${r.pr?.created ? "Đã mở" : "Đã có"} pull request #${r.pr?.number}: ${r.pr?.url} (nhánh ${r.branch ?? "?"}).`, is_error: false, summary: `#${r.pr?.number ?? "?"}` };
    } },
];

export async function runAgentTurn(o: {
  user: UserRow; sid: string | number; pick: Picked; system: string; messages: Msg[]; project?: unknown; skills?: boolean;
  emit: (e: AgentEvent) => void; signal: AbortSignal; inbox?: () => string[]; perm: { mode: PermMode; allow: string[] };
  /** Tệp gửi kèm tin nhắn mới nhất (đã tải lên /api/files?raw=1). */
  files?: Upload[];
  /** Việc tự động chạy nền (taskagent.ts): công cụ thêm (inbox_propose), số bước tối đa, câu hỏi duyệt không chờ người dùng (onAsk tự trả lời),
   *  không ghi trạng thái vào danh sách phiên Code (quiet). */
  extra?: { def: { name: string; description: string; input_schema: unknown }; run: ExtraTool["run"] }[];
  maxSteps?: number;
  onAsk?: (a: Ask) => void;
  quiet?: boolean;
}) {
  const { user, pick } = o;
  const d = sdir(o.sid), sidNum = Number(o.sid);
  const prefs = getPrefs(user.id);
  // Trạng thái phiên chỉ lưu ở máy chủ khi bật đồng bộ (tắt đồng bộ thì mọi thứ của phiên ở lại thiết bị).
  const mark = (p: Parameters<typeof patchSession>[2]) => { if (prefs.sync && !o.quiet) patchSession(user.id, sidNum, p); };
  mark({ running: true });
  try {
    const info = await exec(user.id, d, { cmd: "git rev-parse --abbrev-ref HEAD 2>/dev/null; git remote get-url origin 2>/dev/null | sed -E 's#https://[^@/]*@#https://#'", timeout: 20 });
    const [branch, remote] = info.out.split("\n");
    const repo = repoOfRemote(remote);
    const list = o.skills && can(user, "skills") ? await enabledSkills(user.id, o.project ? String(o.project) : null) : [];
    const scripts = !!process.env.E2B_API_KEY && can(user, "sandbox");
    const prefix = prefs.branchPrefix ? `\nKhi cần tạo nhánh git mới, đặt tên bắt đầu bằng "${prefs.branchPrefix}/".` : "";
    // Quy tắc hàng đầu (ghim trong bộ não) đứng trước mọi hướng dẫn của agent.
    const sys = `${topRule(user.id)}\n\n${agentSystem({ d, repo, branch: repo ? branch || null : null, extra: `${String(o.system).slice(0, 60_000)}${prefix}`, skills: list.length ? skillsPrompt(list, scripts) : "" })}`;
    const more = [...(o.extra ?? []), ...gitTools(user, d, o.sid)];
    const tools = [...agentTools(list.length, scripts), ...more.map((x) => x.def)];
    const extra: ExtraTool[] = more.map((x) => ({ name: x.def.name, run: x.run }));
    const bctx = { target: "synchro" as const, def: "synchro" as const, scope: `code:${o.sid}`, cookies: prefs.cookies };
    const gate = makeGate({
      uid: user.id, perm: o.perm, signal: o.signal, probe: async () => (await runBrowserTool(user.id, "browser_tabs", { op: "list" }, bctx)).url,
      ask: (a) => { if (o.onAsk) return o.onAsk(a); mark({ state: "blocked", reason: `Chờ bạn duyệt: ${a.title}`.slice(0, 120) }); o.emit({ t: "ask", ...a }); },
      asked: (id, a) => o.emit({ t: "asked", id, ok: a.ok, always: a.always }),
      allowed: () => o.emit({ t: "perm", allow: [...o.perm.allow] }),
    });
    const msgs = o.messages.slice(-30);
    // Tệp / thư mục / .zip gửi kèm: chép nguyên vào workspace; ảnh, PDF, nội dung tệp chữ gửi thẳng cho model.
    const last = msgs[msgs.length - 1], ups = o.files ?? [];
    if (ups.length && last?.role === "user") {
      const lastText = String(last.content ?? "");
      const placed = await placeUploads(user.id, d, ups);
      for (const e of placed.errors) o.emit({ t: "text", text: `⚠️ ${e}` });
      const one = ups.filter((f) => !f.folder);
      const blocks = await buildContext(one.map((f) => f.id), Object.fromEntries(one.map((f) => [f.id, f.name])), lastText, user.id);
      const note = placed.lines.length ? `\n\n<attachments>\nNgười dùng gửi kèm, đã chép nguyên vẹn vào workspace (dùng được bằng mọi công cụ: đọc, giải nén, chạy):\n${placed.lines.join("\n")}${blocks.length ? "\nẢnh, PDF và nội dung tệp chữ gửi kèm ngay bên dưới." : ""}\n</attachments>` : "";
      last.content = [{ type: "text", text: lastText + note }, ...blocks];
    }
    let out: { text: string; skills: string[] };
    if (pick.plan) {
      out = await runPlanAgent({ user, model: pick.model, effort: pick.effort, conv: `code-${String(o.sid)}`.slice(0, 64), system: sys, messages: msgs,
        u: user.id, d, skills: list, scripts, tools, emit: o.emit, signal: o.signal, inbox: o.inbox, gate, bctx, extra });
    } else {
      const t = pick.target!;
      // Máy chủ chạy chế độ thử nghiệm (LLM_PROVIDER=mock): dùng kịch bản mô phỏng.
      const adapter = t.kind === "mock" ? mockAgent()
        : t.kind === "anthropic" ? anthropicAgent({ provider: t.provider, key: t.key, workspace: t.workspace, base: t.base, model: t.model, system: sys, maxTokens: 8000, tools, signal: o.signal, effort: pick.effort as never })
        : (t.kind === "openai" ? responsesAgent : openaiAgent)({ provider: t.provider, key: t.key, base: t.base, model: t.model, system: sys, maxTokens: 8000, tools, signal: o.signal, kind: t.kind, effort: pick.effort as never });
      // Khối ảnh / PDF theo đúng định dạng của từng hãng (như khung chat).
      const conv = t.kind === "mock" ? msgs : t.kind === "anthropic" ? msgs.map((m) => ({ ...m, content: toAnthropic(m.content) }))
        : t.kind === "openai" ? msgs.map((m) => ({ ...m, content: toResponses(m.content) })) : msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }));
      out = await runAgent({ adapter, messages: conv, u: user.id, d, skills: list, scripts, emit: o.emit, signal: o.signal, inbox: o.inbox, gate, bctx, extra, maxSteps: o.maxSteps });
    }
    if (out.skills.length) recordUse(user.id, out.skills);
    return { ...out, d };
  } finally {
    mark({ running: false });
  }
}

// ------------------------------------------------------------------ đánh giá phiên sau mỗi lượt
const META = `<code_session_meta>
Bạn đánh giá một lượt làm việc của trợ lý lập trình (Synchro Code) để xếp phiên trong danh sách và gợi ý câu nhắn tiếp theo cho người dùng.
Trả về đúng một dòng JSON, không gì khác: {"state":"blocked|review|done","reason":"…","suggest":"…"}
- blocked: trợ lý đang chờ người dùng — hỏi lại, cần người dùng quyết định, cần mật khẩu / quyền / thông tin, gặp lỗi không tự xử lý được, hay bị dừng giữa chừng.
- review: trợ lý đã làm xong và có kết quả người dùng nên xem lại — tệp đã sửa chưa commit / chưa push, pull request chờ duyệt, thay đổi cần kiểm tra.
- done: việc đã xong, không còn gì chờ người dùng.
- reason: tối đa 8 từ, cùng ngôn ngữ người dùng đang dùng, nói cụ thể (vd. "Hỏi chọn thư viện biểu đồ", "Sửa 3 tệp, chưa push").
- suggest: câu người dùng nhiều khả năng sẽ nhắn tiếp, viết như chính người dùng nói với trợ lý, tối đa 15 từ, cùng ngôn ngữ; để trống nếu không có bước tiếp hợp lý.
</code_session_meta>`;
export type SessionMetaOut = { state: "blocked" | "review" | "done" | null; reason: string | null; suggest: string | null };
export async function sessionMeta(user: UserRow, o: { d?: string; ask: string; reply: string; stopped?: boolean; error?: string; edited?: string[] }): Promise<SessionMetaOut | null> {
  const prefs = getPrefs(user.id);
  if (!prefs.classify && !prefs.suggest) return null;
  let changes = "";
  if (o.d) {
    const g = await exec(user.id, o.d, { cmd: 'if [ -d .git ]; then echo "files:$(git status --porcelain 2>/dev/null | wc -l | tr -d " ")"; echo "ahead:$(git rev-list --count @{u}..HEAD 2>/dev/null || echo -)"; fi', timeout: 15 }).catch(() => null);
    const f = /files:(\d+)/.exec(g?.out ?? "")?.[1], a = /ahead:(\S+)/.exec(g?.out ?? "")?.[1];
    if (f !== undefined) changes = `Git: ${f} tệp thay đổi chưa commit; ${a === "-" ? "nhánh chưa push lên GitHub" : `${a} commit chưa push`}.`;
  }
  const prompt = `Phiên code cần đánh giá:\n\n[Người dùng nhờ]\n${o.ask.slice(0, 2500)}\n\n[Trợ lý trả lời cuối lượt]\n${(o.reply || "(không có)").slice(-3500)}\n\n${o.stopped ? "[Người dùng đã bấm Dừng giữa chừng]\n" : ""}${o.error ? `[Lỗi] ${o.error.slice(0, 300)}\n` : ""}${o.edited?.length ? `Tệp đã sửa trong lượt này: ${o.edited.slice(0, 20).join(", ")}${o.edited.length > 20 ? "…" : ""}\n` : ""}${changes}`;
  let r: SessionMetaOut = { state: null, reason: null, suggest: null };
  try {
    const { text } = await quickCall(user, META, prompt, { maxTokens: 160, job: "meta", bg: true });
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as Record<string, unknown>;
    const st = j.state === "blocked" || j.state === "review" || j.state === "done" ? j.state : null;
    r = { state: st, reason: typeof j.reason === "string" ? j.reason.trim().slice(0, 80) || null : null, suggest: typeof j.suggest === "string" ? j.suggest.trim().replace(/^["“]|["”]$/g, "").slice(0, 160) || null : null };
  } catch {
    // Không gọi được model nhanh: đoán theo dấu hiệu rõ ràng.
    const asked = /[?？]\s*$/.test(o.reply.trim());
    r = { state: o.error || o.stopped || asked ? "blocked" : o.edited?.length || (/[1-9]\d* tệp thay đổi|[1-9]\d* commit chưa push|nhánh chưa push/.test(changes)) ? "review" : "done", reason: o.error ? "Gặp lỗi" : o.stopped ? "Đã dừng giữa chừng" : asked ? "Đang hỏi bạn" : null, suggest: null };
  }
  if (!prefs.classify) { r.state = null; r.reason = null; }
  if (!prefs.suggest) r.suggest = null;
  return r;
}
