import { enabledSkills, recordUse } from "../../skillstore";
import { MAX_STEPS, runSkillTool, skillsPrompt, skillTools, type ToolRun } from "../../skillruntime";
import { can, canModel, current, permsOf } from "../../authstore";
import { clampEffort, effortCap, isEffort, legacyModel, type Effort } from "../../catalog";
import { catalog, mainModels, pickDefault, resolveModel, type Target } from "../../providers";
import { anthropicCall, chatOnce, effortParams, HttpErr, openaiCall, outCap, respInput, respParse, respTools, responsesCall, toAnthropic, toOpenAI, withPages } from "../../llmcall";

// Cổng duy nhất tới model của chat. Model nào gọi tới nhà cung cấp nào do khóa API quản trị viên nhập ở Cài đặt → API quyết định.

// ---------------------------------------------------------------- vòng lặp tool cho skill
type Call = { id: string; name: string; input: Record<string, unknown> };
type Step = { text: string; calls: Call[]; assistant: unknown };
type Adapter = { step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: ToolRun[]) => unknown[] };
type Skl = Awaited<ReturnType<typeof enabledSkills>>;

const anthropicAdapter = (t: Target, system: string, skillSys: string, max_tokens: number, tools: unknown[], effort?: Effort): Adapter => ({
  step: async (msgs, noTools) => {
    const j = await anthropicCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort),
      system: [{ type: "text", text: system || "Bạn là một trợ lý AI hữu ích." }, { type: "text", text: skillSys, cache_control: { type: "ephemeral" } }],
      tools, ...(noTools ? { tool_choice: { type: "none" } } : {}), messages: msgs,
    });
    const blocks: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = j.content ?? [];
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} })),
      assistant: { role: "assistant", content: blocks },
    };
  },
  results: (calls, res) => [{ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, content: res[i].content, is_error: res[i].is_error })) }],
});

const openaiAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort): Adapter => ({
  step: async (msgs, noTools) => {
    const j = await openaiCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort), messages: [{ role: "system", content: system }, ...msgs],
      tools: tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })),
      ...(noTools ? { tool_choice: "none" } : {}),
    });
    const m = j.choices?.[0]?.message ?? {};
    const calls: Call[] = (m.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || "{}"); } catch {}
      return { id: c.id, name: c.function.name, input };
    });
    return { text: m.content ?? "", calls, assistant: m };
  },
  results: (calls, res) => calls.map((c, i) => ({ role: "tool", tool_call_id: c.id, content: res[i].content })),
});

// OpenAI qua API Responses: lượt trả lời của model giữ nguyên dạng mục (items) để gửi lại ở bước sau.
const responsesAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort): Adapter => ({
  step: async (msgs, noTools) => {
    const r = respParse(await responsesCall(t, { instructions: system, max_output_tokens: outCap(t, max_tokens), ...effortParams(t, effort), input: respInput(msgs), tools: respTools(tools), ...(noTools ? { tool_choice: "none" } : {}) }));
    return { text: r.text, calls: r.calls, assistant: { items: r.items } };
  },
  results: (calls, res) => calls.map((c, i) => ({ type: "function_call_output", call_id: c.id, output: res[i].content })),
});

// Model giả lập (LLM_PROVIDER=mock) để thử vòng lặp khi chưa có API key.
const mockAdapter = (skills: Skl): Adapter => ({
  step: async (msgs) => {
    const flat = JSON.stringify(msgs);
    const lastUser = [...msgs].reverse().map((m) => m as { role: string; content: unknown }).find((m) => m.role === "user" && typeof m.content === "string")?.content as string ?? "";
    const toks = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
    const hit = skills.find((s) => lastUser.toLowerCase().includes(s.name) || toks(s.description).some((w) => toks(lastUser).includes(w)));
    const loaded = hit && flat.includes(`<skill name=\\"${hit.name}\\"`);
    const wantsBad = /skill-khong-ton-tai/.test(lastUser) && !flat.includes("không tồn tại");
    const wantsFile = hit && hit.files[0] && /\bfile\b/i.test(lastUser) && loaded && !flat.includes("<skill_file");
    const id = "mock" + Math.random().toString(36).slice(2, 8);
    if (wantsBad) return { text: "", calls: [{ id, name: "load_skill", input: { name: "skill-khong-ton-tai" } }], assistant: { role: "assistant", content: [{ type: "tool_use", id, name: "load_skill", input: { name: "skill-khong-ton-tai" } }] } };
    if (hit && !loaded) return { text: "", calls: [{ id, name: "load_skill", input: { name: hit.name } }], assistant: { role: "assistant", content: [{ type: "tool_use", id, name: "load_skill", input: { name: hit.name } }] } };
    if (wantsFile) return { text: "", calls: [{ id, name: "read_skill_file", input: { name: hit!.name, path: hit!.files[0].path } }], assistant: { role: "assistant", content: [{ type: "tool_use", id, name: "read_skill_file", input: { name: hit!.name, path: hit!.files[0].path } }] } };
    const text = hit ? `[mock] Đã áp dụng skill "${hit.name}": ${hit.body.slice(0, 160)}` : "[mock] Không có skill nào phù hợp, trả lời bình thường.";
    return { text, calls: [], assistant: { role: "assistant", content: [{ type: "text", text }] } };
  },
  results: (calls, res) => [{ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, content: res[i].content, is_error: res[i].is_error })) }],
});

async function skillLoop(ad: Adapter, msgs: unknown[], list: Skl, scripts = false) {
  const used: ToolRun["used"][] = [];
  const m = [...msgs];
  for (let i = 0; i < MAX_STEPS; i++) {
    const r = await ad.step(m, i === MAX_STEPS - 1);
    m.push(r.assistant);
    if (!r.calls.length) return { text: r.text, used };
    const res = await Promise.all(r.calls.map((c) => runSkillTool(list, c.name, c.input, scripts)));
    used.push(...res.filter((x) => !x.is_error && x.used.kind !== "search").map((x) => x.used));
    m.push(...ad.results(r.calls, res));
  }
  return { text: "Đã đạt giới hạn số lần gọi skill. Hãy thử hỏi lại cụ thể hơn.", used };
}

export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  // feature: "chat" | "code"; picked: khóa model đang chọn ("openai/gpt-5.1"); project: id dự án (để bật skill theo dự án)
  const { system, messages, max_tokens = 1500, skills, model: picked, feature, project, effort: wanted } = await req.json();
  if (feature === "code" && !can(c.user, "code")) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code." }, { status: 403 });
  const model = (typeof picked === "string" && picked ? legacyModel(picked) : null) || pickDefault(await catalog(), mainModels());
  if (!model) return Response.json({ error: "Synchro chưa được kết nối với model nào. Quản trị viên cần nhập khóa API ở Cài đặt → API." }, { status: 503 });
  if (!canModel(c.user, model)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng model này." }, { status: 403 });
  const t = await resolveModel(model);
  if (!t) return Response.json({ error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác." }, { status: 400 });
  // Mức nỗ lực người dùng chọn, hạ xuống giới hạn quản trị viên đặt cho model này (quản trị viên không bị giới hạn).
  const effort = isEffort(wanted) ? clampEffort(wanted, effortCap(permsOf(c.user).effort, model), t.kind) : undefined;
  try {
    const list = skills && can(c.user, "skills") ? await enabledSkills(c.user.id, project ? String(project) : null) : [];
    if (list.length) {
      // Chạy script của skill chỉ khi máy chủ có sandbox và tài khoản được phép dùng Sandbox.
      const scripts = !!process.env.E2B_API_KEY && can(c.user, "sandbox");
      const sk = skillsPrompt(list, scripts);
      const tools = skillTools(list.length, scripts);
      const msgs = messages as { role: string; content: unknown }[];
      const out = t.kind === "mock" ? await skillLoop(mockAdapter(list), msgs, list, scripts)
        : t.kind === "anthropic" ? await skillLoop(anthropicAdapter(t, system, sk, max_tokens, tools, effort), msgs.map((m) => ({ ...m, content: toAnthropic(m.content) })), list, scripts)
        : await skillLoop((t.kind === "openai" ? responsesAdapter : openaiAdapter)(t, `${system}\n\n${sk}`, max_tokens, tools, effort), msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) })), list, scripts);
      recordUse(c.user.id, out.used.filter((u) => u.kind === "skill").map((u) => u.name));
      return Response.json({ model, text: out.text, skills: out.used });
    }
    if (t.kind === "mock") return Response.json({ model, text: "[mock] Không có skill nào đang bật." });
    return Response.json({ model, text: await chatOnce(t, system, messages, max_tokens, undefined, effort), effort });
  } catch (e) {
    if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
