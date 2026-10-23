import { enabledSkills } from "../../skillstore";
import { MAX_STEPS, runSkillTool, skillsPrompt, skillTools, type ToolRun } from "../../skillruntime";
import { can, canModel, current } from "../../authstore";
import { CLAUDE_API_IDS } from "../../catalog";

// Cổng duy nhất tới model (tương đương call_llm trong app.py). Đổi nhà cung cấp chỉ sửa ở đây.
const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const API_KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5-5";
const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";

// Bộ định tuyến model: code -> Claude Sonnet, repo lớn -> Gemini Flash, /commit -> DeepSeek.
// Mỗi model đặt bằng env (id kiểu OpenRouter nếu dùng LLM_BASE_URL khác Anthropic).
const MODEL_LONG = process.env.LLM_MODEL_LONG ?? "google/gemini-2.5-flash";
const MODEL_COMMIT = process.env.LLM_MODEL_COMMIT ?? "deepseek/deepseek-chat";
const LONG_CTX = Number(process.env.LLM_LONG_CTX ?? 100_000);
// `picked` là model người dùng chọn trong giao diện (đã được kiểm tra quyền).
function pickModel(route?: { task?: string; tokens?: number }, picked?: string) {
  if (route?.task === "commit") return MODEL_COMMIT;
  if ((route?.tokens ?? 0) > LONG_CTX) return MODEL_LONG;
  if (PROVIDER === "anthropic" && picked && CLAUDE_API_IDS[picked]) return CLAUDE_API_IDS[picked];
  return MODEL;
}
const isClaude = (m: string) => PROVIDER === "anthropic" && m.startsWith("claude");

type Blk = { type: string; text?: string; media_type?: string; data?: string; name?: string; fallbackText?: string; fallbackImages?: string[] };
// Chuyển block chung -> định dạng từng provider.
const toAnthropic = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image", source: { type: "base64", media_type: b.media_type, data: b.data } }
  : b.type === "document" ? { type: "document", title: b.name, source: { type: "base64", media_type: b.media_type, data: b.data } } : b);
const toOpenAI = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.data}` } }
  : b.type === "document" ? { type: "text", text: `<file name="${b.name}">\n${b.fallbackText ?? "(PDF scan: xem các ảnh trang đính kèm)"}\n</file>` } : b);
const withPages = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).flatMap((b) => b.type === "document" && b.fallbackImages ? [b, ...b.fallbackImages.map((d) => ({ type: "image", media_type: "image/jpeg", data: d }))] : [b]);

// ---------------------------------------------------------------- vòng lặp tool cho skill
type Call = { id: string; name: string; input: Record<string, unknown> };
type Step = { text: string; calls: Call[]; assistant: unknown };
type Adapter = { step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: ToolRun[]) => unknown[] };
class HttpErr extends Error { constructor(public status: number, m: string) { super(m); } }
type Skl = Awaited<ReturnType<typeof enabledSkills>>;

const anthropicAdapter = (model: string, system: string, skillSys: string, max_tokens: number, tools: unknown[]): Adapter => ({
  step: async (msgs, noTools) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens,
        system: [{ type: "text", text: system || "Bạn là một trợ lý AI hữu ích." }, { type: "text", text: skillSys, cache_control: { type: "ephemeral" } }],
        tools, ...(noTools ? { tool_choice: { type: "none" } } : {}), messages: msgs,
      }),
    });
    if (!r.ok) throw new HttpErr(r.status, await r.text());
    const j = await r.json();
    const blocks: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = j.content ?? [];
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} })),
      assistant: { role: "assistant", content: blocks },
    };
  },
  results: (calls, res) => [{ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, content: res[i].content, is_error: res[i].is_error })) }],
});

const openaiAdapter = (model: string, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[]): Adapter => ({
  step: async (msgs, noTools) => {
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens, messages: [{ role: "system", content: system }, ...msgs],
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        ...(noTools ? { tool_choice: "none" } : {}),
      }),
    });
    if (!r.ok) throw new HttpErr(r.status, await r.text());
    const m = (await r.json()).choices?.[0]?.message ?? {};
    const calls: Call[] = (m.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || "{}"); } catch {}
      return { id: c.id, name: c.function.name, input };
    });
    return { text: m.content ?? "", calls, assistant: m };
  },
  results: (calls, res) => calls.map((c, i) => ({ role: "tool", tool_call_id: c.id, content: res[i].content })),
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

async function skillLoop(ad: Adapter, msgs: unknown[], list: Skl) {
  const used: ToolRun["used"][] = [];
  const m = [...msgs];
  for (let i = 0; i < MAX_STEPS; i++) {
    const r = await ad.step(m, i === MAX_STEPS - 1);
    m.push(r.assistant);
    if (!r.calls.length) return { text: r.text, used };
    const res = await Promise.all(r.calls.map((c) => runSkillTool(list, c.name, c.input)));
    used.push(...res.filter((x) => !x.is_error && x.used.kind !== "search").map((x) => x.used));
    m.push(...ad.results(r.calls, res));
  }
  return { text: "Đã đạt giới hạn số lần gọi skill. Hãy thử hỏi lại cụ thể hơn.", used };
}

export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (!API_KEY && PROVIDER !== "mock") return Response.json({ error: "Chưa cấu hình LLM_API_KEY" }, { status: 500 });
  // feature: "chat" | "code"; picked: tên model trong giao diện; project: id dự án đang chat (để bật skill theo dự án)
  const { system, messages, max_tokens = 1500, route, skills, model: picked, feature, project } = await req.json();
  if (feature === "code" && !can(c.user, "code")) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code." }, { status: 403 });
  if (typeof picked === "string" && picked && !canModel(c.user, picked)) return Response.json({ error: `Quản trị viên chưa cho phép tài khoản của bạn dùng model ${picked}.` }, { status: 403 });
  const model = pickModel(route, typeof picked === "string" ? picked : undefined);
  try {
    const list = skills && can(c.user, "skills") ? await enabledSkills(c.user.id, project ? String(project) : null) : [];
    if (list.length) {
      const sk = skillsPrompt(list);
      const tools = skillTools(list.length);
      const msgs = messages as { role: string; content: unknown }[];
      try {
        const out = PROVIDER === "mock" ? await skillLoop(mockAdapter(list), msgs, list)
          : isClaude(model) ? await skillLoop(anthropicAdapter(model, system, sk, max_tokens, tools), msgs.map((m) => ({ ...m, content: toAnthropic(m.content) })), list)
          : await skillLoop(openaiAdapter(model, `${system}\n\n${sk}`, max_tokens, tools), msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) })), list);
        return Response.json({ model, text: out.text, skills: out.used });
      } catch (e) {
        if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status });
        throw e;
      }
    }
    if (PROVIDER === "mock") return Response.json({ model, text: "[mock] Không có skill nào đang bật." });
    if (isClaude(model)) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens, system, messages: messages.map((m: { role: string; content: unknown }) => ({ ...m, content: toAnthropic(m.content) })) }),
      });
      if (!r.ok) return Response.json({ error: await r.text() }, { status: r.status });
      const j = await r.json();
      return Response.json({ model, text: (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("") });
    }
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens, messages: [{ role: "system", content: system }, ...messages.map((m: { role: string; content: unknown }) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }),
    });
    if (!r.ok) return Response.json({ error: await r.text() }, { status: r.status });
    const j = await r.json();
    return Response.json({ model, text: j.choices?.[0]?.message?.content ?? "" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
