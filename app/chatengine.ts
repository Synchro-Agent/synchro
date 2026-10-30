import { enabledSkills, recordUse } from "./skillstore";
import { MAX_STEPS, runSkillTool, skillsPrompt, skillTools, type ToolRun } from "./skillruntime";
import { healScript } from "./skillheal";
import { can, canModel, limit, permsOf, type UserRow } from "./authstore";
import { clampEffort, connPolicy, effortCap, isEffort, legacyModel, type Effort } from "./catalog";
import { catalog, mainModels, pickDefault, resolveModel, type Target } from "./providers";
import { ConnectorSession, connectorsPrompt } from "./connectors";
import { randomToken } from "./mcpauth";
import { browserDefault, capsState, skillsOn } from "./caps";
import { overLimit, usageScope } from "./usage";
import { currentRun, delta, deltaStep, liveNow, progress, registerExec, runSignal, takeInbox } from "./runs";
import { prepareHistory, type TraceItem } from "./transpile";
import { expandFileRefs } from "./fileproc";
import { maybeRef, READ_REF_TOOL, readRef } from "./refs";
import { artState, cleanBase, resolveArt, type ArtVersion } from "./vfs";
import { splitArtifacts } from "./artifacts";
import { AUTO, autoEffort, effortLabel, routeModel, taskLabel, type RouteInput } from "./router";
import { ALL } from "./catalog";
import { everywhereSkills, libraryPlugins, recordPluginUse, STUDIOS, studioOf, studioSkills, type Studio } from "./plugins";
import { STUDIO_LABEL } from "./plugindir";
import { suggest, type Hit } from "./skillroute";
import type { Skill } from "./skillstore";
import { CODE_RULES, execRun, LANGS, runCodeTool, type Lang } from "./coderun";
import { saveOutputs, type OutFile } from "./outputs";
import { ARTIFACT_RULES, ASK_RULES, VIZ_RULES } from "./artifacts";
import { type ABlock, anthropicCall, blocksText, chatOnce, effortParams, HttpErr, openaiCall, outCap, respInput, respParse, respTools, responsesCall, toAnthropic, toOpenAI, toResponses, withPages } from "./llmcall";
import { mergedProviders, subCli, subTurn } from "./ai/subs";
import { openBridge } from "./mcpbridge";
import { usableModels } from "./ai/anymodel";
import { learnFromTurn, userContext } from "./memory";
import { afterTurn, BRAIN_RULES, BRAIN_TOOLS, brainRecall, brainReady, runBrainTool, topRule } from "./brain";
import { MAX_NUDGE, NUDGE, stalled } from "./stall";
import { makeGate, NO_UI, QUEUED, type Gate } from "./agentgate";
import { queueSite, queueTool, runPropose, TASK_TOOL, taskBrowser, taskOf, taskRules } from "./tasktools";
import type { TaskCtx } from "./tasks";
import { answer as answerAsk } from "./approvals";
import { getPrefs as codePrefs } from "./codestore";
import { BROWSER_RULES, BROWSER_TOOLS, browserTargetOf, chatFiles, describeBrowser, isBrowserTool, releaseBrowser, runBrowserTool, type BrowserCtx } from "./browsertools";

// Bộ xử lý chat (chỉ chạy ở máy chủ), dùng chung cho /api/llm (chờ kết quả) và lượt chạy nền (runs.ts).
// Model nào gọi tới nhà cung cấp nào do khóa API quản trị viên nhập ở Cài đặt → Providers quyết định.

// ---------------------------------------------------------------- vòng lặp tool cho skill
type Call = { id: string; name: string; input: Record<string, unknown> };
// pause: công cụ phía máy chủ của hãng (tìm web) chưa chạy xong trong một lần gọi — gửi lại để model làm tiếp.
type Step = { text: string; calls: Call[]; assistant: unknown; pause?: boolean };
// image: ảnh JPEG (base64) đi kèm kết quả công cụ, ví dụ ảnh chụp trình duyệt; mỗi hãng nhận theo cách riêng.
type Run = ToolRun & { image?: string };
type Adapter = { step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: Run[]) => unknown[] };
// Ảnh chụp trình duyệt cho model dùng Chat Completions / Responses: tin nhắn công cụ chỉ nhận chữ, nên ảnh đi kèm một tin người dùng ngay sau.
const SHOT = (id: string) => `Ảnh chụp màn hình trình duyệt (kết quả công cụ ${id}).`;
const shotMsgs = (calls: Call[], res: Run[]) => res.flatMap((r, i) => r.image ? [{ role: "user", content: [{ type: "text", text: SHOT(calls[i].id) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${r.image}` } }] }] : []);
type Skl = Awaited<ReturnType<typeof enabledSkills>>;

// Bộ nhớ đệm prompt của Anthropic: điểm đệm thứ nhất ở cuối phần hệ thống (công cụ + hướng dẫn + danh mục skill),
// điểm thứ hai ở cuối tin nhắn mới nhất. Lịch sử hội thoại và các bước gọi công cụ trong cùng lượt được đọc lại từ bộ đệm
// (rẻ hơn nhiều so với gửi lại), chỉ phần mới được tính đủ giá. Không sửa mảng gốc vì vòng lặp còn thêm bước vào đó.
// hist: chỉ số tin cuối của phần lịch sử ổn định (trước tin nhắn mới nhất có tầng động): thêm một điểm đệm ở đó để lượt sau
// đọc lại được cả lịch sử từ bộ đệm dù tầng động của lượt này không còn trong lịch sử nữa.
function markOne(m: unknown): unknown {
  const x = m as { role: string; content: unknown };
  const blocks = typeof x.content === "string" ? [{ type: "text", text: x.content }] : Array.isArray(x.content) ? (x.content as Record<string, unknown>[]) : null;
  if (!blocks?.length) return m;
  const i = blocks.length - 1;
  return { ...x, content: blocks.map((b, k) => (k === i ? { ...b, cache_control: { type: "ephemeral" } } : b)) };
}
export function withCacheMark(msgs: unknown[], hist = -1): unknown[] {
  if (!msgs.length) return msgs;
  return msgs.map((m, i) => (i === msgs.length - 1 || (i === hist && hist < msgs.length - 1) ? markOne(m) : m));
}
// Truyền chữ chỉ khi đang ở lượt chạy nền (có người theo dõi qua SSE).
const live = () => (runSignal() ? delta : undefined);

const anthropicAdapter = (t: Target, system: string, skillSys: string, max_tokens: number, tools: unknown[], effort?: Effort, hist = -1): Adapter => ({
  step: async (msgs, noTools) => {
    // Tìm web (công cụ phía máy chủ của Anthropic): ghi vào nhật ký làm việc như công cụ thường, ngay khi model bắt đầu tìm.
    const seen = new Set<string>();
    const searched = (b: ABlock) => {
      if (b.type !== "server_tool_use" || b.name !== "web_search" || seen.has(String(b.id))) return;
      seen.add(String(b.id));
      progress("tool", `Đang tìm trên web: ${String((b.input as { query?: string } | undefined)?.query ?? "").slice(0, 120)}`);
    };
    const j = await anthropicCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort),
      system: [{ type: "text", text: system || "Bạn là một trợ lý AI hữu ích." }, { type: "text", text: skillSys, cache_control: { type: "ephemeral" } }],
      tools, ...(noTools ? { tool_choice: { type: "none" } } : {}), messages: withCacheMark(msgs, hist),
    }, runSignal(), live(), (b) => searched(b));
    const blocks: (ABlock & { input?: Record<string, unknown> })[] = j.content ?? [];
    for (const b of blocks) searched(b);
    return {
      text: blocksText(blocks),
      calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} })),
      assistant: { role: "assistant", content: blocks },
      pause: j.stop_reason === "pause_turn",
    };
  },
  results: (calls, res) => [{ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, is_error: res[i].is_error,
    content: res[i].image ? [{ type: "text", text: res[i].content }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: res[i].image } }] : res[i].content })) }],
});

const openaiAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort): Adapter => ({
  step: async (msgs, noTools) => {
    const j = await openaiCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort), messages: [{ role: "system", content: system }, ...msgs],
      tools: tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })),
      ...(noTools ? { tool_choice: "none" } : {}),
    }, runSignal(), live());
    const m = j.choices?.[0]?.message ?? {};
    const calls: Call[] = (m.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || "{}"); } catch {}
      return { id: c.id, name: c.function.name, input };
    });
    return { text: m.content ?? "", calls, assistant: m };
  },
  results: (calls, res) => [...calls.map((c, i) => ({ role: "tool", tool_call_id: c.id, content: res[i].content })), ...shotMsgs(calls, res)],
});

// OpenAI qua API Responses: lượt trả lời của model giữ nguyên dạng mục (items) để gửi lại ở bước sau.
const responsesAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort, web = false): Adapter => ({
  step: async (msgs, noTools) => {
    // Tìm web của OpenAI (mục web_search_call): ghi vào nhật ký làm việc ngay khi mục xong.
    const seen = new Set<string>();
    const searched = (it: Record<string, unknown>) => {
      if (it.type !== "web_search_call" || seen.has(String(it.id))) return;
      seen.add(String(it.id));
      const a = it.action as { query?: string; url?: string } | undefined;
      progress("tool", a?.url && !a.query ? `Đang đọc trang web: ${a.url.slice(0, 120)}` : `Đang tìm trên web: ${String(a?.query ?? "").slice(0, 120)}`);
    };
    const r = respParse(await responsesCall(t, { instructions: system, max_output_tokens: outCap(t, max_tokens), ...effortParams(t, effort), input: respInput(msgs), tools: [...respTools(tools), ...(web ? [{ type: "web_search" }] : [])], ...(noTools ? { tool_choice: "none" } : {}) }, runSignal(), live(), searched));
    for (const it of r.items) searched(it);
    return { text: r.text, calls: r.calls, assistant: { items: r.items } };
  },
  results: (calls, res) => [...calls.map((c, i) => ({ type: "function_call_output", call_id: c.id, output: res[i].content })), ...shotMsgs(calls, res)],
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

// ---------------------------------------------------------------- vòng lặp công cụ (skill + connector)
// code: công cụ run_code đang bật (net: được tải gói từ kho thư viện); outs: tệp code đã tạo trong lượt này.
// libs: skill (và mục thư viện) → thư viện chứa nó, để câu trả lời hiện "Thư viện Thiết kế · skill đã đọc". studio: chế độ người dùng chọn bằng nút.
type Lib = { key: string; label: string };
// trace: dấu vết công cụ của lượt theo chuẩn Synchro (trả về trình duyệt, lượt sau gửi lại để model nào cũng biết đã làm gì).
// heal: model của lượt này, dùng để tự sửa script của skill khi script hỏng (skillheal.ts).
// search: model Gemini (khóa API) để tìm web bằng Google Search qua API gốc của Gemini (công cụ web_search của Synchro).
// browse: công cụ trình duyệt đang bật (Cài đặt → Khả năng); bctx: trình duyệt của lượt (của Synchro / Chrome của người dùng, browsertools.ts);
// shown: trình duyệt đã mở khung cho người dùng ở lượt này;
// heavy: id các lượt đọc trang / chụp màn hình (lược bớt bản cũ để ngữ cảnh không phình khi thao tác dài).
// task: lượt chạy nền của việc tự động (tasks.ts): việc cần người dùng đồng ý thành đề xuất trong Hộp thư thay vì chờ hỏi.
type Exec = { list: Skl; scripts: boolean; sess: ConnectorSession | null; uid: string; code: boolean; net: boolean; outs: OutFile[]; libs?: Record<string, Lib[]>; studio?: Lib; prefer?: Record<string, string>; trace: TraceItem[]; conv?: string; heal?: Target; search?: Target; browse?: boolean; bctx?: BrowserCtx; shown?: string; heavy?: string[]; gate?: Gate; task?: TaskCtx | null };
type Decision = "allow" | "chat" | "always" | "deny";
type Out = { text: string; used: ToolRun["used"][]; cancelled?: boolean } | { approval: { id: string; calls: unknown[] } };
// Lượt chat đang chờ người dùng duyệt công cụ: giữ trong bộ nhớ máy chủ tối đa 30 phút.
type Pending = { uid: string; model: string; ad: Adapter; m: unknown[]; calls: Call[]; used: ToolRun["used"][]; step: number; x: Exec; at: number };
const PENDING_TTL = 30 * 60_000;
const pending = new Map<string, Pending>();
function sweep() {
  for (const [k, p] of pending) if (Date.now() - p.at > PENDING_TTL) { pending.delete(k); p.x.sess?.close(); }
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
async function runCode(x: Exec, input: Record<string, unknown>): Promise<ToolRun> {
  const lang = (typeof input.language === "string" && input.language in LANGS ? input.language : "python") as Lang;
  const used = { kind: "code" as const, name: lang };
  const code = typeof input.code === "string" ? input.code : "";
  if (!x.code) return { content: "Chạy code đang tắt trong Cài đặt → Khả năng.", is_error: true, used };
  if (!code.trim() || code.length > 200_000) return { content: "Thiếu code hoặc code quá dài (tối đa 200.000 ký tự).", is_error: true, used };
  try {
    const r = await execRun({ uid: x.uid, files: [{ path: LANGS[lang].file, data: Buffer.from(code) }], argv: [...LANGS[lang].argv], net: x.net, signal: runSignal() });
    const saved = saveOutputs(x.uid, r.files);
    x.outs.push(...saved);
    const files = saved.length ? `\n<files>\n${saved.map((f) => `outputs/${f.name} (${fmtSize(f.size)}) — đã gửi cho người dùng`).join("\n")}\n</files>` : "";
    return { content: `<run_result language="${lang}" exit_code="${r.exit}">\n<stdout>\n${r.stdout}\n</stdout>\n<stderr>\n${r.stderr}\n</stderr>${files}\n</run_result>`, is_error: r.exit !== 0, used };
  } catch (e) {
    return { content: `Không chạy được code: ${(e as Error).message}`, is_error: true, used };
  }
}

// Danh sách việc cho người dùng theo dõi khi model làm việc nhiều bước (hiện như bảng việc, tự đánh dấu xong).
const PLAN_TOOL = {
  name: "update_plan",
  description: "Hiện cho người dùng danh sách các bước bạn sẽ làm và trạng thái từng bước. Dùng khi việc cần 3 bước trở lên (nhiều lần gọi công cụ): gọi một lần lúc bắt đầu với toàn bộ kế hoạch, rồi gọi lại mỗi khi xong một bước. Luôn gửi lại cả danh sách. Không dùng cho câu hỏi đơn giản.",
  input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { content: { type: "string", description: "Bước, ngắn gọn (dưới 10 từ)" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["content", "status"] } } }, required: ["items"] },
};
// Cách làm việc khi có công cụ: nói cho người dùng biết đang làm gì như một người thật, thay vì im lặng tới khi xong.
const NARRATE_RULES = `<working_out_loud>
Khi cần dùng công cụ, hãy làm việc "thành tiếng" bằng ngôn ngữ của người dùng:
- Trước mỗi lần gọi công cụ, viết 1 câu ngắn nói bạn sắp làm gì và vì sao (ví dụ "Mình sẽ đọc tài liệu của skill trước để làm đúng định dạng.").
- Có kết quả rồi thì nói ngắn điều vừa tìm thấy trước khi làm bước tiếp theo.
- Việc có từ 3 bước trở lên: gọi update_plan để hiện danh sách việc và cập nhật khi xong từng bước.
- Nếu có khối <user_followup>: đó là tin người dùng nhắn thêm khi bạn đang làm. Ghép yêu cầu đó vào việc đang làm (ưu tiên nếu nó đổi yêu cầu), nói ngắn rằng bạn đã nhận và sẽ làm thế nào, rồi làm tiếp — không bỏ dở việc trước.
- Câu trả lời cuối vẫn đầy đủ như bình thường.
</working_out_loud>`;
// Gói chạy qua CLI (Claude Code, Codex, Antigravity) gọi công cụ của Synchro qua cầu nối MCP "synchro".
const BRIDGE_CLIS = new Set(["claude", "codex", "agy"]);
const CLI_TOOLS_NOTE = (cli: string) => `<synchro_tools>
Các công cụ nói ở trên (load_skill, read_skill_file, search_skills, run_skill_script, run_code, read_ref, update_plan, browser_* và công cụ của connector) nằm trong máy chủ MCP "synchro"${cli === "claude" ? ", gọi bằng tên có tiền tố mcp__synchro__ (ví dụ mcp__synchro__load_skill)" : cli === "agy" ? ", gọi bằng tên có tiền tố mcp_synchro_ (ví dụ mcp_synchro_load_skill)" : ""}. Dùng chúng đúng như mô tả; không cần công cụ nào khác để làm việc với skill, tệp hay dữ liệu của người dùng.
</synchro_tools>`;
/** Một lời gọi công cụ từ CLI qua cầu nối: giữ lời dẫn trước đó, ghi công cụ và kết quả vào nhật ký, ghép tin nhắn thêm vào kết quả. */
async function bridgeCall(x: Exec, name: string, input: Record<string, unknown>, usedAll: ToolRun["used"][]) {
  const said = liveNow().trim();
  if (said) progress("say", said);
  deltaStep();
  const c: Call = { id: `mcp_${randomToken(8)}`, name, input };
  // Công cụ connector để chế độ "Hỏi trước mỗi lần": CLI không hỏi duyệt giữa chừng được, nên báo rõ thay vì tự chạy.
  if (needsAsk(x, c) && !x.task) return { content: "Công cụ này đang để chế độ hỏi duyệt trước mỗi lần dùng; gói chạy qua CLI chưa hỏi duyệt được. Hãy cho người dùng biết: đổi quyền công cụ thành \"Luôn cho phép\" trong Connectors, hoặc dùng model khóa API cho việc này.", is_error: true };
  let res: ToolRun | null = null;
  const m: unknown[] = [];
  const cap: Adapter = { step: async () => { throw new Error("không dùng"); }, results: (_calls, r) => { res = r[0]; return []; } };
  await execute(cap, m, x, [c], usedAll, {});
  const follow = (m.find((v) => (v as { role?: string }).role === "user") as { content?: unknown } | undefined)?.content;
  const r = (res as Run | null) ?? { content: "Không có kết quả.", is_error: true };
  return { content: String(r.content) + (typeof follow === "string" ? `\n\n${follow}` : ""), is_error: r.is_error, ...((r as Run).image ? { image: (r as Run).image } : {}) };
}
// Tin người dùng nhắn thêm giữa chừng: ghép vào lượt đang chạy ở bước kế tiếp (sau kết quả công cụ).
function addFollowup(m: unknown[], text: string) {
  const note = `<user_followup>\n${text}\n</user_followup>`;
  const last = m[m.length - 1] as { role?: string; content?: unknown };
  if (last?.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push({ type: "text", text: note });
  else m.push({ role: "user", content: note });
}
// Tìm web cho Gemini qua khóa API: lớp tương thích OpenAI của Gemini chưa có Google Search, nên Synchro gọi API gốc của Gemini
// (cùng khóa, cùng model) với công cụ google_search và trả về câu trả lời có dẫn nguồn như một công cụ thường.
const GEMINI_WEB_TOOL = {
  name: "web_search",
  description: "Tìm thông tin mới trên web bằng Google Search. Dùng khi câu hỏi cần dữ kiện mới (tin tức, giá, lịch, phiên bản phần mềm…) hoặc điều bạn không chắc. Trả về tóm tắt kèm nguồn.",
  input_schema: { type: "object", properties: { query: { type: "string", description: "Câu tìm kiếm ngắn, cùng ngôn ngữ người dùng" } }, required: ["query"] },
};
async function geminiSearch(t: Target, query: string): Promise<ToolRun> {
  const used = { kind: "search" as const, name: "web_search" };
  if (!query.trim()) return { content: "Thiếu câu tìm kiếm.", is_error: true, used };
  const base = t.base.replace(/\/openai\/?$/, "");
  const r = await fetch(`${base}/models/${encodeURIComponent(t.model)}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": t.key, "content-type": "application/json" }, signal: runSignal() ?? AbortSignal.timeout(90_000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: query.slice(0, 500) }] }], tools: [{ google_search: {} }] }),
  }).catch(() => null);
  if (!r?.ok) return { content: `Chưa tìm được trên web (${r?.status ?? "mất kết nối"}).`, is_error: true, used };
  const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[] };
  const c = j.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  const src = (c?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web).filter((w): w is { uri?: string; title?: string } => !!w?.uri).slice(0, 8).map((w, i) => `[${i + 1}] ${w.title ?? ""} — ${w.uri}`).join("\n");
  return { content: `${text || "(không có kết quả)"}\n\nNguồn:\n${src || "(không có)"}`, is_error: false, used };
}
async function runCall(x: Exec, c: Call, d?: Decision): Promise<Run> {
  if (c.name === "update_plan") {
    const items = (Array.isArray(c.input?.items) ? c.input.items : []).map((i: { content?: unknown; status?: unknown }) => ({ content: String(i.content ?? "").slice(0, 120), status: ["pending", "in_progress", "completed"].includes(String(i.status)) ? String(i.status) : "pending" })).slice(0, 12);
    progress("plan", JSON.stringify(items));
    return { content: "Đã cập nhật danh sách việc cho người dùng.", is_error: false, used: { kind: "search", name: "update_plan" } };
  }
  if (c.name === TASK_TOOL.name && x.task && !x.sess?.get(c.name)) return { ...(await runPropose(x.uid, x.task, c.input ?? {})), used: { kind: "search", name: c.name } };
  if (c.name === "read_ref" && !x.sess?.get(c.name)) return { ...readRef(x.uid, c.input), used: { kind: "search", name: "read_ref" } };
  if (c.name.startsWith("brain_") && !x.sess?.get(c.name)) return { ...runBrainTool(x.uid, c.name, c.input ?? {}), used: { kind: "search", name: c.name } };
  if (c.name === "web_search" && x.search && !x.sess?.get(c.name)) return geminiSearch(x.search, String(c.input?.query ?? ""));
  if (c.name === "run_code" && !x.sess?.get(c.name)) return runCode(x, c.input);
  if (x.browse && isBrowserTool(c.name) && !x.sess?.get(c.name)) {
    // Lần đầu dùng trình duyệt trong lượt (hoặc đổi sang trình duyệt kia): mở khung trình duyệt cạnh khung chat để người dùng xem
    // trực tiếp ("browser"), hoặc khung trạng thái Chrome của họ kèm nút Dừng ("browser:user").
    if (x.task?.browser === "synchro" && c.input?.browser === "user") return { content: "Việc tự động này đặt chỉ dùng trình duyệt của Synchro (browser=\"synchro\"), không dùng Chrome của người dùng.", is_error: true, used: { kind: "search", name: c.name } };
    const where = browserTargetOf(c.input, x.bctx);
    if (x.shown !== where) { x.shown = where; progress("ui", where === "user" ? "browser:user" : "browser"); }
    // Trang web được phép (Cài đặt → Synchro Code → Trình duyệt): trang bị chặn thì không làm, trang lạ thì hỏi người dùng ngay trong đoạn chat.
    // Lượt không chạy nền (không có khung chat theo dõi) thì không hỏi được: từ chối luôn, model được dặn nhờ người dùng thêm trang.
    x.gate ??= makeGate({ uid: x.uid, signal: runSignal(), probe: async () => (await runBrowserTool(x.uid, "browser_tabs", { op: "list" }, x.bctx)).url,
      // Việc tự động chạy nền: không ai trả lời giữa chừng, nên gửi đề xuất cho phép trang vào Hộp thư và làm tiếp bằng nguồn khác.
      ask: (a) => { if (x.task && a.kind === "site") { queueSite(x.uid, x.task, a.host ?? "", a.detail ?? ""); answerAsk(x.uid, a.id, { ok: false, note: QUEUED }); } else if (currentRun()) progress("ask", JSON.stringify(a)); else answerAsk(x.uid, a.id, { ok: false, note: NO_UI }); },
      asked: (id, a) => { if (currentRun()) progress("asked", JSON.stringify({ id, ok: a.ok, always: !!a.always })); } });
    const no = await x.gate.check(c.name, c.input ?? {});
    if (no) return { content: no, is_error: true, used: { kind: "search", name: c.name } };
    const r = await runBrowserTool(x.uid, c.name, c.input ?? {}, x.bctx);
    x.gate.seen(r.url);
    if (["browser_read", "browser_text", "browser_screenshot", "browser_batch"].includes(c.name)) (x.heavy ??= []).push(c.id);
    return { content: r.content, is_error: r.is_error, ...(r.image ? { image: r.image } : {}), used: { kind: "search", name: c.name } };
  }
  const ct = x.sess?.get(c.name);
  if (!ct) return runSkillTool(x.list, c.name, c.input, x.scripts, { uid: x.uid, net: x.net, heal: x.heal ? (input) => healScript(x.heal!, input) : undefined });
  const used = { kind: "tool" as const, name: `${ct.cname}: ${ct.tool.title || ct.tool.annotations?.title || ct.tool.name}` };
  if (x.task && x.sess!.perm(c.name) === "ask") return { content: queueTool(x.uid, x.task, c, { connector: ct.cname, title: ct.tool.title || ct.tool.annotations?.title || ct.tool.name }), is_error: true, used };
  if (d === "deny") return { content: "Người dùng đã từ chối cho dùng công cụ này ở lượt này. Đừng thử lại bằng cách khác; hãy cho họ biết bạn cần quyền này để làm tiếp.", is_error: true, used };
  return { ...(await x.sess!.call(c.name, c.input)), used };
}
const needsAsk = (x: Exec, c: Call) => !!x.sess?.get(c.name) && x.sess.perm(c.name) === "ask";

// Câu mô tả bước đang làm, hiện dưới "Đang suy nghĩ…" khi lượt chạy ở nền.
function describe(x: Exec, c: Call) {
  const n = String(c.input?.name ?? "");
  if (c.name === "load_skill") return n.startsWith("studio-") || n.startsWith("lib-") ? `Đang mở thư viện ${x.libs?.[n]?.[0]?.label ?? n}` : `Đang đọc skill ${n}`;
  if (c.name === "read_skill_file") return `Đang đọc tài liệu của skill ${n}`;
  if (c.name === "search_skills") return "Đang tìm skill phù hợp";
  if (c.name === "run_skill_script") return `Đang chạy script của skill ${n}`;
  if (c.name === "run_code") return `Đang chạy code ${String(c.input?.language ?? "python")}`;
  if (c.name === "web_search" && x.search) return `Đang tìm trên web: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_search") return `Đang nhớ lại: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_read") return `Đang đọc ghi chú ${String(c.input?.title ?? "").slice(0, 80)} trong bộ não`;
  if (c.name === "brain_write") return `Đang ghi vào bộ não: ${String(c.input?.title ?? "").slice(0, 80)}`;
  if (x.browse && isBrowserTool(c.name)) return describeBrowser(c.name, c.input ?? {}, browserTargetOf(c.input, x.bctx));
  const ct = x.sess?.get(c.name);
  return ct ? `Đang dùng ${ct.cname}: ${ct.tool.title || ct.tool.name}` : `Đang dùng công cụ ${c.name}`;
}
// Công cụ lấy dữ liệu (connector, chạy code, script của skill): kết quả lớn lưu theo tham chiếu và có trong dấu vết của lượt.
// Công cụ đọc skill không tính (đó là hướng dẫn, không phải dữ liệu).
const isData = (x: Exec, c: Call) => !!x.sess?.get(c.name) || c.name === "run_code" || c.name === "run_skill_script";
const label = (x: Exec, c: Call) => describe(x, c).replace(/^Đang (dùng |chạy )?/, "");
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException("Đã dừng", "AbortError"));
  return new Promise((ok, no) => {
    const f = () => no(new DOMException("Đã dừng", "AbortError"));
    signal.addEventListener("abort", f, { once: true });
    p.then((v) => { signal.removeEventListener("abort", f); ok(v); }, (e) => { signal.removeEventListener("abort", f); no(e); });
  });
}
const isAbort = (e: unknown) => (e as Error)?.name === "AbortError" || !!runSignal()?.aborted;
async function execute(ad: Adapter, m: unknown[], x: Exec, calls: Call[], used: ToolRun["used"][], d: Record<string, Decision>) {
  const seqs = calls.map((c) => (c.name === "update_plan" ? 0 : progress("tool", describe(x, c))));
  let res: Run[];
  try {
    res = await abortable(Promise.all(calls.map((c) => runCall(x, c, d[c.id]))), runSignal());
  } catch (e) {
    // Người dùng dừng khi công cụ đang chạy: ghi rõ trong dấu vết để lượt sau model biết việc này chưa xong.
    if (isAbort(e)) for (const c of calls) if (isData(x, c)) x.trace.push({ id: c.id, name: c.name, label: label(x, c), input: JSON.stringify(c.input ?? {}).slice(0, 300), status: "cancelled_by_user", summary: "Người dùng đã dừng khi công cụ đang chạy; chưa có kết quả." });
    throw e;
  }
  res.forEach((r, i) => {
    const c = calls[i];
    if (!isData(x, c)) return;
    const big = maybeRef(x.uid, x.conv, c.name, r.content);
    r.content = big.content;
    const summary = (big.ref ? big.content.replace(/^<ref[^>]*>\n/, "").split("\nDữ liệu đầy đủ đã lưu")[0] : r.content).slice(0, 700);
    x.trace.push({ id: c.id, name: c.name, label: label(x, c), input: JSON.stringify(c.input ?? {}).slice(0, 300), status: d[c.id] === "deny" ? "denied" : r.is_error ? "error" : "ok", summary, ...(big.ref ? { ref: big.ref } : {}) });
  });
  used.push(...res.filter((r) => (!r.is_error || r.used.kind === "code") && r.used.kind !== "search").map((r) => r.used));
  // Kết quả từng công cụ (thành công / lỗi, tóm tắt ngắn) để dòng công cụ trong khung chat hiện đúng.
  res.forEach((r, i) => { if (seqs[i]) progress("res", JSON.stringify({ ref: seqs[i], ok: !r.is_error, sum: String(r.content ?? "").replace(/\s+/g, " ").slice(0, 140) })); });
  m.push(...ad.results(calls, res));
  // Người dùng nhắn thêm trong lúc công cụ chạy: ghép vào ngay bước kế tiếp, không ngắt việc.
  const more = takeInbox();
  if (more.length) { for (const t of more) progress("steer", t); addFollowup(m, more.join("\n\n")); }
}

async function toolLoop(ad: Adapter, m: unknown[], x: Exec, used: ToolRun["used"][], uid: string, model: string, start = 0): Promise<Out> {
  try { return await loop(ad, m, x, used, uid, model, start); }
  catch (e) {
    if (!isAbort(e)) throw e;
    // Dừng giữa chừng: giữ phần đã viết, lượt kết thúc bình thường (không phải lỗi).
    x.sess?.close();
    return { text: liveNow(), used, cancelled: true };
  } finally {
    // Hết lượt: thôi điều khiển Chrome của người dùng (gỡ dải "Synchro đang điều khiển").
    releaseBrowser(uid, x.bctx);
  }
}
// Thao tác trình duyệt dài (làm cả bài kiểm tra, điền nhiều trang biểu mẫu) cần nhiều bước hơn một lượt chat thường.
const BROWSE_STEPS = 200;
// Giữ nguyên hai kết quả đọc trang / ảnh chụp gần nhất; bản cũ hơn thay bằng một dòng ngắn (model đọc lại trang khi cần).
const PRUNED = "[Đã lược kết quả cũ của công cụ trình duyệt để gọn ngữ cảnh; đọc lại trang nếu cần.]";
function pruneBrowser(m: unknown[], x: Exec) {
  const old = new Set((x.heavy ?? []).slice(0, -2));
  if (!old.size) return;
  for (const v of m) {
    const o = v as { role?: string; type?: string; tool_call_id?: string; call_id?: string; content?: unknown; output?: unknown };
    if (o.type === "function_call_output" && o.call_id && old.has(o.call_id)) { o.output = PRUNED; continue; }
    if (o.role === "tool" && o.tool_call_id && old.has(o.tool_call_id)) { o.content = PRUNED; continue; }
    if (o.role !== "user" || !Array.isArray(o.content)) continue;
    const first = o.content[0] as { type?: string; text?: string } | undefined;
    const shot = first?.type === "text" && [...old].find((id) => first.text === SHOT(id));
    if (shot) { o.content = PRUNED; continue; }
    for (const b of o.content as { type?: string; tool_use_id?: string; content?: unknown }[]) if (b.type === "tool_result" && b.tool_use_id && old.has(b.tool_use_id)) b.content = PRUNED;
  }
}
async function loop(ad: Adapter, m: unknown[], x: Exec, used: ToolRun["used"][], uid: string, model: string, start = 0): Promise<Out> {
  // Việc tự động chạy nền: không ai ngồi chờ nên cho nhiều bước hơn (tra nhiều nguồn, nhiều connector, nhiều trang).
  const steps = x.task ? (x.browse ? 300 : 150) : x.browse ? BROWSE_STEPS : MAX_STEPS;
  // Lượt mới chỉ báo "Mình sẽ…" rồi dừng, chưa dùng công cụ nào: nhắc model làm tiếp (stall.ts).
  let nudged = 0, acted = start > 0;
  for (let i = start; i < steps; i++) {
    if (i > 0) { progress("step", "Đang viết câu trả lời"); deltaStep(); }
    if (x.browse) pruneBrowser(m, x);
    const r = await ad.step(m, i === steps - 1);
    m.push(r.assistant);
    if (!r.calls.length) {
      if (r.pause) continue;
      if (!acted && nudged < MAX_NUDGE && i < steps - 1 && stalled(r.text)) { nudged++; progress("say", r.text.trim()); m.push({ role: "user", content: NUDGE }); continue; }
      return { text: r.text, used };
    }
    acted = true;
    // Lời dẫn trước khi dùng công cụ: giữ lại trong khung chat (bước sau không xóa mất).
    if (r.text.trim()) progress("say", r.text.trim());
    const ask = x.task ? [] : r.calls.filter((c) => needsAsk(x, c));
    if (ask.length) {
      sweep();
      const id = randomToken(18);
      pending.set(id, { uid, model, ad, m, calls: r.calls, used, step: i, x, at: Date.now() });
      return {
        approval: {
          id, calls: ask.map((c) => {
            const ct = x.sess!.get(c.name)!;
            const input = JSON.stringify(c.input ?? {});
            return {
              id: c.id, connector: { id: ct.cid, name: ct.cname, logo: ct.logo, color: ct.color, icon: ct.icon },
              tool: { name: ct.tool.name, title: ct.tool.title || ct.tool.annotations?.title || ct.tool.name, description: (ct.tool.description ?? "").slice(0, 400), destructive: !ct.tool.annotations?.readOnlyHint && ct.tool.annotations?.destructiveHint === true },
              input: input.length > 20_000 ? { _: input.slice(0, 20_000) + "…" } : c.input ?? {},
            };
          }),
        },
      };
    }
    await execute(ad, m, x, r.calls, used, {});
  }
  return { text: "Đã đạt giới hạn số bước gọi công cụ trong một lượt. Hãy hỏi lại cụ thể hơn để Synchro làm tiếp.", used };
}

// Schema công cụ MCP → schema gửi cho model: bỏ khóa riêng ($schema, x-…); Gemini chỉ nhận một tập khóa OpenAPI nên lọc thêm.
const GEMINI_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "format", "nullable", "anyOf", "minimum", "maximum", "minItems", "maxItems", "title", "minLength", "maxLength", "pattern", "default"]);
function cleanSchema(s: unknown, gemini: boolean, depth = 0): unknown {
  if (Array.isArray(s)) return s.map((v) => cleanSchema(v, gemini, depth + 1));
  if (!s || typeof s !== "object" || depth > 30) return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k.startsWith("$") || k.startsWith("x-")) continue;
    if (k === "properties" && v && typeof v === "object") { out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, cleanSchema(pv, gemini, depth + 1)])); continue; }
    if (gemini && !GEMINI_KEYS.has(k)) continue;
    out[k] = cleanSchema(v, gemini, depth + 1);
  }
  return out;
}
function connectorToolDefs(sess: ConnectorSession, gemini: boolean) {
  return sess.tools.map((ct) => {
    const schema = cleanSchema(ct.tool.inputSchema ?? {}, gemini) as Record<string, unknown>;
    return {
      name: ct.fq,
      description: `[${ct.cname}] ${ct.tool.title || ct.tool.annotations?.title || ct.tool.name}${ct.tool.description ? `: ${ct.tool.description}` : ""}`.slice(0, 1024),
      input_schema: { ...schema, type: "object", properties: schema.properties && typeof schema.properties === "object" ? schema.properties : {} },
    };
  });
}

// Văn bản của tin nhắn người dùng mới nhất (nội dung có thể là chuỗi hoặc danh sách khối).
function lastUserText(messages: unknown): string {
  const list = Array.isArray(messages) ? (messages as { role?: string; content?: unknown }[]) : [];
  const m = [...list].reverse().find((x) => x?.role === "user");
  if (!m) return "";
  if (typeof m.content === "string") return m.content.slice(0, 4000);
  return Array.isArray(m.content) ? (m.content as { type?: string; text?: string }[]).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").slice(0, 4000) : "";
}
// Gợi ý định tuyến cho lượt này: skill hợp nhất với yêu cầu (tìm trong toàn bộ kho, cả skill bên trong thư viện)
// và skill các lượt trước đã dùng. Model đọc thẳng skill bằng tên, không phải mở thư viện trước; không hợp thì bỏ qua.
function routingPrompt(hits: Hit[], recent: { name: string; lib?: Lib }[]) {
  if (!hits.length && !recent.length) return "";
  const where = (l?: Lib) => (l ? ` (thư viện ${l.label} · ${l.key})` : "");
  return `<skill_routing>
${hits.length ? `Hệ thống đã đối chiếu yêu cầu mới nhất với toàn bộ kho skill. Các skill có vẻ liên quan nhất (gợi ý tự động, có thể chưa đúng):
${hits.map((h) => `- ${h.skill.name}${where(h.lib)}: ${h.skill.description.replace(/\s+/g, " ").slice(0, 180)}`).join("\n")}` : ""}
${recent.length ? `Các lượt trước trong đoạn chat này đã dùng: ${recent.map((r) => `${r.name}${where(r.lib)}`).join(", ")}. Nếu yêu cầu mới sửa hoặc tiếp tục sản phẩm đó, hãy đọc lại các skill này để giữ cùng phong cách và nguyên tắc.` : ""}
Bạn tự quyết định: đọc ngay các skill hợp bằng load_skill (gọi thẳng tên skill, không cần mở thư viện), bỏ qua skill không hợp, hoặc dùng search_skills để tìm thêm.
</skill_routing>`.replace(/\n{2,}/g, "\n");
}
// Thư viện đã dùng trong lượt: chế độ studio đang bật (nếu có), rồi các thư viện model tự mở, kèm skill đã đọc trong từng thư viện.
function usedLibs(x: Exec, used: string[]) {
  const out = new Map<string, Lib & { forced?: boolean; skills: string[] }>();
  if (x.studio) out.set(x.studio.key, { ...x.studio, forced: true, skills: [] });
  const opened = new Set([...(x.studio ? [x.studio.key] : []), ...used.filter((n) => x.libs?.[n]?.[0]?.key === n)]);
  for (const n of used) {
    const all = x.libs?.[n];
    const l = all?.find((c) => opened.has(c.key)) ?? all?.find((c) => c.key === x.prefer?.[n]) ?? all?.[0];
    if (!l) continue;
    const g = out.get(l.key) ?? out.set(l.key, { ...l, skills: [] }).get(l.key)!;
    if (n !== l.key && !g.skills.includes(n)) g.skills.push(n);
  }
  return [...out.values()];
}
function reply(c: { user: { id: string } }, model: string, out: Out, x: Exec) {
  if ("approval" in out) return Response.json({ model, approval: out.approval });
  x.sess?.close();
  const usedNames = out.used.filter((u) => u.kind === "skill").map((u) => u.name);
  recordUse(c.user.id, usedNames);
  recordPluginUse(x.list.filter((k) => k.user_id.startsWith("pl_") && usedNames.includes(k.name)).map((k) => k.id));
  return Response.json({ model, text: out.text, skills: out.used, files: x.outs, libs: usedLibs(x, usedNames), ...(x.trace.length ? { trace: x.trace } : {}), ...(out.cancelled ? { cancelled: true } : {}) });
}

// Bản sửa artifact (mode="patch") phải áp được vào bản hiện tại. Không khớp thì nhắc model sửa lại đúng một lần (tự vá),
// còn sai nữa thì giữ câu trả lời; trình duyệt hiện bản sửa lỗi kèm nút yêu cầu viết lại toàn bộ.
function patchProblems(history: { role: string; content: unknown }[], text: string, base: ArtVersion[]): string[] {
  if (!/mode\s*=\s*["']patch/i.test(text)) return [];
  const st = artState(history.filter((h) => h.role === "assistant" || h.role === "ai").map((h) => (typeof h.content === "string" ? h.content : "")), base);
  const out: string[] = [];
  for (const sg of splitArtifacts(text)) if (sg.kind === "art" && sg.art.patch) {
    const r = resolveArt(st.get(sg.art.ident), sg.art);
    if (r.fix?.failed.length) out.push(`${sg.art.ident}: ${r.fix.failed.map((f) => `"${f}"`).join(", ")}`);
    st.set(sg.art.ident, r);
  }
  return out;
}
async function healPatch(ad: Adapter, m: unknown[], history: { role: string; content: unknown }[], out: Out, base: ArtVersion[] = []): Promise<Out> {
  if ("approval" in out || out.cancelled) return out;
  const bad = patchProblems(history, out.text, base);
  if (!bad.length) return out;
  progress("step", "Đang sửa lại bản sửa artifact cho khớp");
  deltaStep();
  m.push({ role: "user", content: `Hệ thống: bản sửa artifact chưa áp được vì khối SEARCH không khớp nguyên văn với bản hiện tại trong <current_artifacts> (${bad.join("; ")}). Hãy viết lại TOÀN BỘ câu trả lời, với bản sửa có SEARCH chép đúng từng ký tự từ bản hiện tại (hoặc viết lại toàn bộ artifact nếu khó).` });
  try {
    const r = await ad.step(m, true);
    m.push(r.assistant);
    return r.text.trim() ? { ...out, text: r.text } : out;
  } catch (e) { if (isAbort(e)) return { ...out, cancelled: true }; throw e; }
}

// Chế độ studio: model là chuyên gia của lĩnh vực, tự chọn skill trong thư viện và làm luôn, không hỏi lại những gì tự quyết được.
const STUDIO_TASK: Record<Studio, string> = {
  design: "Thiết kế (giao diện, trang web, ứng dụng, logo, banner, minh họa, chuyển động). Kết quả là artifact chạy được ngay (HTML, React hoặc SVG).",
  slides: "Trình bày (bản trình bày, pitch deck, slide báo cáo). Kết quả mặc định là artifact HTML, mỗi slide một <section class=\"slide\"> 16:9 (Synchro tự lo chuyển slide, trình chiếu, xuất PDF); khi người dùng cần tệp PowerPoint thì tạo .pptx bằng run_code.",
  docs: "Tài liệu (báo cáo, đề xuất, kế hoạch, thư, quy trình). Kết quả mặc định là artifact Markdown trình bày đẹp; khi người dùng cần Word hoặc PDF thì tạo tệp bằng run_code.",
};
const STUDIO_RULES = (s: Studio, plugins: string[], n: number) => `<studio name="${s}">
Người dùng đang ở chế độ ${STUDIO_TASK[s]}
${n ? `Bạn có thư viện ${n} skill chuyên môn${plugins.length ? ` (từ ${plugins.join(", ")})` : ""} trong available_skills. Trước khi làm, tự chọn 1-3 skill hợp nhất với yêu cầu và gọi load_skill để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.` : "Chưa có thư viện skill cho studio này: dùng kiến thức chuyên môn tốt nhất của bạn."}
Đừng hỏi lại người dùng về phong cách, màu sắc, bố cục hay giọng văn: hãy tự đưa ra lựa chọn có chủ đích, nhất quán và đẹp, rồi làm luôn bản hoàn chỉnh. Chỉ hỏi khi thiếu thông tin không thể tự đoán (ví dụ tên thương hiệu thật).
Sau sản phẩm, nêu ngắn gọn 2-3 quyết định chính bạn đã chọn và gợi ý hướng chỉnh sửa.
</studio>`;

// Mục "studio-…" trong available_skills của chat thường: mở ra là danh sách skill của thư viện kèm cách dùng.
const STUDIO_WHEN: Record<Studio, string> = {
  design: "thiết kế giao diện, trang web, landing page, ứng dụng, logo, banner, poster, minh họa, bảng màu, font, chuyển động / animation, UX",
  slides: "bản trình bày, slide, pitch deck, thuyết trình, báo cáo dạng slide",
  docs: "viết tài liệu, đề xuất, báo cáo, kế hoạch, thư, thông báo nội bộ, quy trình, văn bản cần trình bày đẹp",
};
function studioIndex(s: Studio, plugins: string[], lib: Skill[]): Skill {
  const body = `${STUDIO_RULES(s, plugins, lib.length)}

Thư viện gồm ${lib.length} skill (gọi load_skill với đúng tên để đọc skill bạn chọn):
${lib.map((k) => `- ${k.name}: ${k.description.slice(0, 220)}`).join("\n")}`;
  return indexSkill(`studio-${s}`, `Thư viện ${lib.length} skill chuyên môn cho ${STUDIO_WHEN[s]}. Khi yêu cầu thuộc loại này, gọi load_skill("studio-${s}") trước để chọn skill phù hợp trong thư viện.`, body);
}
// Plugin không gắn studio: một mục "lib-…" mô tả plugin và tên các skill bên trong. Plugin nhỏ (≤ 2 skill) hiện thẳng từng skill.
function libIndex(l: { slug: string; name: string; description: string; skills: Skill[] }): Skill {
  const names = l.skills.map((k) => k.name);
  const body = `<library name="${l.slug}">
Thư viện skill của plugin ${l.name}. Chọn 1-3 skill hợp nhất với yêu cầu, gọi load_skill với đúng tên để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.
</library>

Thư viện gồm ${l.skills.length} skill:
${l.skills.map((k) => `- ${k.name}: ${k.description.slice(0, 220)}`).join("\n")}`;
  return indexSkill(`lib-${l.slug}`, `${l.description.slice(0, 240)} Thư viện ${names.length} skill: ${names.slice(0, 14).join(", ")}${names.length > 14 ? "…" : ""}. Khi yêu cầu liên quan, gọi load_skill("lib-${l.slug}") trước để chọn skill phù hợp.`, body);
}
const indexSkill = (name: string, description: string, body: string): Skill => ({ id: name, user_id: "studio", name, description, body,
  storage_path: "", enabled: true, version: 1, versions: [1], created_at: "", updated_at: "", files: [], warnings: [], projects: [], use_count: 0, last_used_at: null });

// Artifact dùng AI: trang trong artifact gọi window.synchro.complete(...) → trình duyệt chuyển tới đây.
// Không có công cụ, không có skill; chỉ tài khoản đang bật "Artifact dùng AI" mới gọi được.
const ARTIFACT_SYSTEM = "Bạn là model AI được một ứng dụng nhỏ (artifact) gọi tới từ bên trong Synchro. Trả lời đúng điều được yêu cầu, không chào hỏi hay giải thích thêm. Khi được yêu cầu trả về JSON, chỉ trả JSON hợp lệ, không bọc trong ```.";
function artifactMessages(raw: unknown): { role: "user" | "assistant"; content: string }[] | null {
  const list = typeof raw === "string" ? [{ role: "user", content: raw }] : Array.isArray(raw) ? raw : null;
  if (!list?.length || list.length > 60) return null;
  let total = 0;
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of list as { role?: unknown; content?: unknown }[]) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role || typeof m.content !== "string" || !m.content) return null;
    total += m.content.length;
    out.push({ role, content: m.content });
  }
  return total <= 120_000 && out[out.length - 1].role === "user" ? out : null;
}

// Tài liệu ghim của đoạn chat: [{ name, text }] (trình duyệt đã đọc chữ từ tệp), tối đa 200.000 ký tự.
function pinnedBlock(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  let left = 200_000;
  const docs = raw.slice(0, 20).flatMap((d) => {
    const o = (d ?? {}) as { name?: unknown; text?: unknown };
    const name = typeof o.name === "string" ? o.name.slice(0, 120).replace(/"/g, "'") : "";
    const text = typeof o.text === "string" ? o.text.slice(0, left) : "";
    if (!name || !text.trim()) return [];
    left -= text.length;
    return [`<document name="${name}">\n${text}\n</document>`];
  });
  return docs.length ? `<pinned_documents>\nTài liệu người dùng đã ghim cho đoạn chat này (luôn có trong ngữ cảnh). Dùng khi liên quan:\n${docs.join("\n")}\n</pinned_documents>` : "";
}
// Bàn trộn ngữ cảnh: ước tính token từng khối của lượt tiếp theo (không gọi model). ~3,5 ký tự một token (tiếng Việt và tiếng Anh lẫn nhau).
const tok = (chars: number) => Math.ceil(chars / 3.5);
function estimate(sys: string[], skills: string[], pinned: string, prep: ReturnType<typeof prepareHistory>) {
  const len = (a: string[]) => a.filter(Boolean).reduce((n, x) => n + x.length, 0);
  const z = prep.sizes;
  const blocks = [
    { key: "system", tier: "static", chars: len(sys) },
    { key: "skills", tier: "static", chars: len(skills) },
    { key: "pinned", tier: "static", chars: pinned.length },
    { key: "summary", tier: "history", chars: z.summary },
    { key: "history", tier: "history", chars: z.history },
    { key: "tools", tier: "dynamic", chars: z.tools },
    { key: "artifacts", tier: "dynamic", chars: z.artifacts },
    { key: "dynamic", tier: "dynamic", chars: z.dynamic },
  ].map((b) => ({ ...b, tokens: tok(b.chars) }));
  return Response.json({ blocks, total: blocks.reduce((n, b) => n + b.tokens, 0), dropped: z.dropped });
}

// Bộ skill của một lượt: skill đã bật (dự án, mọi nơi), thư viện studio và plugin (mục lục, mở khi cần), gợi ý định tuyến theo yêu cầu mới nhất.
// Dùng chung cho model khóa API (vòng lặp công cụ) và gói subscription (cầu nối MCP).
async function skillSet(user: UserRow, body: Record<string, any>, messages: unknown, studio: Studio | null, st: ReturnType<typeof studioSkills> | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = { user };
  const { skills, project } = body;
  const list = skills && can(c.user, "skills") && skillsOn(c.user) ? [...await enabledSkills(c.user.id, project ? String(project) : null), ...everywhereSkills(c.user.id)] : [];
  // Skill của studio luôn có khi người dùng chủ động bấm nút studio. Skill cá nhân trùng tên được ưu tiên.
  for (const k of st?.skills ?? []) if (!list.some((x) => x.name === k.name)) list.push(k);
  for (let i = list.length - 1; i >= 0; i--) if (list.findIndex((x) => x.name === list[i].name) !== i) list.splice(i, 1);
  // Mọi thư viện đã cài đều tự dùng được: mỗi studio là một mục "studio-…", mỗi plugin khác là một mục "lib-…" trong available_skills.
  // Model tự mở thư viện khi việc cần tới (load_skill), rồi chọn skill cụ thể bên trong. Prompt chỉ thêm một dòng mỗi thư viện,
  // các skill trong thư viện không chiếm chỗ cho tới khi được mở. Khi bấm nút studio, thư viện của studio đó đã mở sẵn.
  const visible = [...list];
  const hidden = (ks: Skill[]) => { for (const k of ks) if (!list.some((x) => x.name === k.name)) list.push(k); };
  // Một skill có thể nằm trong nhiều thư viện (theme-factory ở cả Thiết kế và Trình bày): giữ đủ để gán đúng thư viện đã mở.
  const libs: Record<string, Lib[]> = {};
  const tag = (lib: Lib, ks: Skill[]) => { libs[lib.key] = [lib]; for (const k of ks) (libs[k.name] ??= []).push(lib); };
  if (studio) tag({ key: `studio-${studio}`, label: STUDIO_LABEL[studio] }, st!.skills);
  if (skills && can(c.user, "skills") && skillsOn(c.user)) {
    for (const s of STUDIOS) {
      const lib = s === studio ? null : studioSkills(c.user.id, s);
      if (!lib?.skills.length) continue;
      visible.push(studioIndex(s, lib.plugins, lib.skills));
      hidden(lib.skills);
      tag({ key: `studio-${s}`, label: STUDIO_LABEL[s] }, lib.skills);
    }
    for (const l of libraryPlugins(c.user.id)) {
      const fresh = l.skills.filter((k) => !list.some((x) => x.name === k.name));
      if (!fresh.length) continue;
      tag({ key: `lib-${l.slug}`, label: l.name }, fresh);
      if (fresh.length <= 2) { visible.push(...fresh); list.push(...fresh); continue; }
      visible.push(libIndex({ ...l, skills: fresh }));
      hidden(fresh);
    }
  }
  // Định tuyến: chấm điểm toàn bộ kho skill theo yêu cầu mới nhất. Skill có ở nhiều thư viện được gán vào thư viện
  // mà các gợi ý khác cùng thuộc về (đề xuất dự án → Tài liệu, không phải Trình bày).
  let route = "";
  const prefer: Record<string, string> = {};
  if (list.length) {
    const raw = suggest(lastUserText(messages), list.map((k) => ({ skill: k })));
    const votes = new Map<string, number>();
    for (const h of raw) for (const l of libs[h.skill.name] ?? []) votes.set(l.key, (votes.get(l.key) ?? 0) + h.score / (libs[h.skill.name]!.length));
    const pick = (n: string) => (libs[n] ?? []).slice().sort((a, b) => (votes.get(b.key) ?? 0) - (votes.get(a.key) ?? 0))[0];
    const hits = raw.map((h) => ({ ...h, lib: pick(h.skill.name) }));
    for (const h of hits) if (h.lib) prefer[h.skill.name] = h.lib.key;
    const recentNames = Array.isArray(body.recentSkills) ? [...new Set((body.recentSkills as unknown[]).filter((n): n is string => typeof n === "string"))].slice(0, 6) : [];
    const recent = recentNames.filter((n) => list.some((k) => k.name === n) && !hits.some((h) => h.skill.name === n)).map((n) => ({ name: n, lib: libs[n]?.[0] }));
    route = routingPrompt(hits, recent);
  }
  return { list, visible, libs, prefer, route };
}

type Who = { user: UserRow };
// Bộ nhớ chỉ dùng cho lượt chat chính (không cho Code, artifact, lệnh nội bộ), khi nút "Bộ nhớ" bật và không ở chế độ ẩn danh.
// Những gì Synchro biết về người dùng (tên, phần tự giới thiệu / hướng dẫn ở Cài đặt → Tài khoản, bộ nhớ khi bật): mọi lượt người dùng
// trò chuyện (chat, Synchro Code), kể cả ẩn danh (khi đó không kèm bộ nhớ); không áp dụng cho lời gọi nội bộ (đặt tên, rút bộ nhớ…)
// và artifact có AI.
const useProfile = (body: Record<string, any>) => !!body.skills && body.feature !== "artifact"; // eslint-disable-line @typescript-eslint/no-explicit-any
const contextOf = (body: Record<string, any>, u: UserRow) => (useProfile(body) ? userContext(u, { memory: useMemory(body, u) }) : ""); // eslint-disable-line @typescript-eslint/no-explicit-any
// Bộ não tổng hợp: kéo vài ghi chú liên quan nhất tới câu hỏi vào tầng động (chat lẫn Synchro Code; không trong đoạn chat ẩn danh / khi tắt Bộ nhớ).
const recallOf = (body: Record<string, any>, u: UserRow, conv?: string) => (useProfile(body) && body.memory !== false && !body.incognito ? brainRecall(u.id, lastUserText(body.messages), conv) : ""); // eslint-disable-line @typescript-eslint/no-explicit-any
/** Model tự tra, đọc theo liên kết và ghi vào bộ não (công cụ brain_*), cùng điều kiện với phần ghi chú liên quan. */
const brainOn = (body: Record<string, any>, u: UserRow) => useProfile(body) && body.memory !== false && !body.incognito && brainReady(u.id); // eslint-disable-line @typescript-eslint/no-explicit-any
/** Gói subscription: ghi chú liên quan ghép vào cuối tin nhắn mới nhất (CLI chỉ nhận lời nhắc hệ thống ở lượt đầu của phiên). */
function withRecall(messages: unknown, recall: string): unknown {
  if (!recall || !Array.isArray(messages) || !messages.length) return messages;
  const out = [...messages] as { role?: string; content?: unknown }[];
  const i = out.map((m) => m?.role).lastIndexOf("user");
  if (i < 0) return messages;
  const c = out[i].content;
  out[i] = { ...out[i], content: typeof c === "string" ? `${c}\n\n${recall}` : Array.isArray(c) ? [...c, { type: "text", text: recall }] : c };
  return out;
}
const useMemory = (body: Record<string, any>, _u: UserRow) => !!body.skills && body.feature !== "code" && body.feature !== "artifact" && body.memory !== false && !body.incognito; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Một lượt gọi model: body là JSON trình duyệt gửi lên /api/llm. scope.feature được đặt lại theo loại lượt (tính mức dùng).
 *  model = "auto": Synchro chọn model theo độ khó của yêu cầu (router.ts) trong các model tài khoản được dùng, rồi chạy như bình thường. */
export async function chatPost(body: Record<string, any>, c: Who, scope: { feature: string }): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Tệp của các lượt trước đi cùng lịch sử: model nào trả lời lượt này (kể cả model vừa đổi) cũng thấy đúng tài liệu đang bàn.
  if (Array.isArray(body.messages)) body = { ...body, messages: await expandFileRefs(body.messages, lastUserText(body.messages)) };
  if (body.model !== AUTO || typeof body.resume === "string") return chatTurn(body, c, scope);
  // Chọn trong đúng các model bộ chọn model đang hiện: nhóm của hãng đang dùng gói subscription thì chọn model của gói,
  // không tự chuyển sang khóa API (tierOf xếp hạng được cả "sub-claude/opus", "sub-claude/haiku"…). Gói hết hạn mức thì không chọn.
  const { allowed, usable } = await usableModels(c.user);
  const blocked = new Set(allowed.filter((k) => !usable.includes(k)));
  const q = routeInput(body);
  const r = routeModel(q, usable.length ? usable : allowed);
  if (!r) return Response.json({ error: "Tài khoản của bạn chưa được dùng model nào. Hãy liên hệ quản trị viên." }, { status: 403 });
  // Nỗ lực: người dùng để "Tự động" (hoặc chưa chọn) thì theo độ khó của việc; chọn tay thì giữ lựa chọn đó.
  const effort = body.effort === "auto" || !isEffort(body.effort) ? r.effort : body.effort;
  progress("note", `Tự động chọn ${r.model.split("/").pop()} · việc ${taskLabel(r.task)} · nỗ lực ${effortLabel(effort)}`);
  let res = await chatTurn({ ...body, model: r.model, effort }, c, scope);
  let used = r.model;
  // Model đầu lỗi / quá tải / hết hạn mức: chuyển một lần sang model dự phòng (ưu tiên hãng khác) mà người dùng không phải làm gì.
  // Gói subscription chỉ chuyển sang gói khác, không tự sang khóa API (luôn hỏi người dùng trước khi dùng khóa API).
  if ([429, 500, 502, 503, 529].includes(res.status) && !runSignal()?.aborted) {
    const fromSub = !!subCli(r.model);
    const next = r.alt.find((k) => !blocked.has(k) && (!fromSub || !!subCli(k)));
    if (next) {
      const j0 = await res.clone().json().catch(() => ({}));
      if (!(j0 as { usageLimit?: boolean }).usageLimit) {
        progress("note", `${r.model.split("/").pop()} đang bận, chuyển sang ${next.split("/").pop()}`);
        deltaStep();
        res = await chatTurn({ ...body, model: next, effort }, c, scope);
        used = next;
      }
    }
  }
  const j = await res.json().catch(() => ({}));
  return Response.json({ ...j, model: j.model ?? used, auto: { tier: r.tier, vendor: r.vendor, task: r.task, effort, why: r.why, ...(used !== r.model ? { fallback: used } : {}) } }, { status: res.status });
}
// Thông tin của yêu cầu mới nhất cho bộ định tuyến: chữ, tệp / ảnh đính kèm, độ dài tài liệu, model của câu trả lời trước.
// Chỉ chữ người dùng gõ mới quyết định loại việc; nội dung tệp đính kèm (ghi chú "Các khối <file>…", nhãn [File: …], <file>…</file>)
// chỉ tính số tệp và độ dài, để từ khóa nằm trong tệp không đẩy độ khó lên.
const FILE_TEXT = /^(?:Các khối <file>|\[File: )/;
function typedText(m: { content?: unknown } | undefined): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content.slice(0, 8000);
  const b = Array.isArray(m.content) ? (m.content as { type?: string; text?: string }[]).find((x) => x?.type === "text" && typeof x.text === "string" && !FILE_TEXT.test(x.text)) : undefined;
  return (b?.text ?? "").slice(0, 8000);
}
function routeInput(body: Record<string, any>): RouteInput { // eslint-disable-line @typescript-eslint/no-explicit-any
  const msgs = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const users = msgs.filter((m) => m?.role === "user");
  const lastUser = users[users.length - 1];
  const blocks = Array.isArray(lastUser?.content) ? (lastUser!.content as { type?: string; text?: string; fallbackText?: string }[]) : [];
  const attachments = blocks.filter((b) => b?.type && b.type !== "text").length;
  const images = blocks.filter((b) => b?.type === "image" || b?.type === "image_url").length;
  const files = blocks.filter((b) => b?.type === "text" && typeof b.text === "string" && b.text.startsWith("[File: ")).length;
  // Độ dài nội dung tệp: chữ trích ra trong <file>, PDF gửi nguyên dạng thì theo chữ dự phòng (không có thì ước chừng một tài liệu vừa).
  const docChars = blocks.reduce((n, b) => n + (b?.type === "text" && typeof b.text === "string" && b.text.includes("<file") ? b.text.length : b?.type === "document" ? (b.fallbackText?.length ?? 8000) : 0), 0);
  return { text: typedText(lastUser), attachments, turns: msgs.length, studio: !!studioOf(body.studio), images, files, docChars,
    prev: typeof body.prevModel === "string" ? body.prevModel : null, prevAsk: typedText(users[users.length - 2]) || undefined };
}

async function chatTurn(body: Record<string, any>, c: Who, scope: { feature: string }): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // feature: "chat" | "code"; picked: khóa model đang chọn ("openai/gpt-5.1"); project: id dự án (để bật skill theo dự án)
  // Tiếp tục lượt chat đang chờ duyệt công cụ: { resume, decisions: { id lượt gọi: "allow" | "always" | "deny" } }.
  if (typeof body.resume === "string") {
    sweep();
    const p = pending.get(body.resume);
    if (!p || p.uid !== c.user.id) return Response.json({ error: "Yêu cầu chờ duyệt đã hết hạn. Hãy gửi lại tin nhắn." }, { status: 410 });
    pending.delete(body.resume);
    const raw = (body.decisions && typeof body.decisions === "object" ? body.decisions : {}) as Record<string, unknown>;
    const d: Record<string, Decision> = {};
    for (const call of p.calls) if (needsAsk(p.x, call)) {
      const v = raw[call.id];
      d[call.id] = v === "allow" || v === "chat" || v === "always" ? v : "deny";
      if (v === "always") p.x.sess!.allowAlways(call.name);
      if (v === "chat") p.x.sess!.allowChat(call.name);
    }
    try {
      await execute(p.ad, p.m, p.x, p.calls, p.used, d);
      return reply(c, p.model, await toolLoop(p.ad, p.m, p.x, p.used, c.user.id, p.model, p.step + 1), p.x);
    } catch (e) {
      p.x.sess?.close();
      if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
      return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
    }
  }
  const { messages, max_tokens = 1500, skills, model: picked, feature, project, effort: wanted, conv } = body;
  // Quy tắc hàng đầu (ghim trong bộ não) mở đầu lời nhắc hệ thống của mọi lượt người dùng trò chuyện: chat, Synchro Code, việc tự động,
  // giọng nói nối tiếp; gói subscription lẫn khóa API. Lời gọi nội bộ (đặt tên, rút bộ nhớ…) và artifact không kèm.
  const system: string = useProfile(body) ? `${topRule(c.user.id)}\n\n${body.system || "Bạn là một trợ lý AI hữu ích."}` : body.system;
  scope.feature = feature === "artifact" ? "artifact" : feature === "code" ? "code" : skills ? "chat" : "internal";
  if (feature === "code" && !can(c.user, "code")) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code." }, { status: 403 });
  const model = (typeof picked === "string" && picked ? legacyModel(picked) : null) || pickDefault(await catalog(), mainModels());
  // Model của gói subscription (Cài đặt → Providers): chạy CLI chính chủ bằng gói của chính người dùng, không qua khóa API.
  if (model && subCli(model)) {
    if (feature === "artifact" && !capsState(c.user).caps.ai) return Response.json({ error: "Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng." }, { status: 403 });
    if (body.estimate === true) return estimate([system], [], [contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n"), prepareHistory(messages, [], {}));
    const am = feature === "artifact" ? artifactMessages(body.prompt) : null;
    if (feature === "artifact" && !am) return Response.json({ error: "Nội dung gửi tới model không hợp lệ." }, { status: 400 });
    // Hướng dẫn thuần văn bản theo Cài đặt → Khả năng (hỏi lại, artifact, hình minh họa trong chat).
    const pc = skills ? capsState(c.user).caps : null;
    const planSys = pc ? [feature !== "code" ? ASK_RULES : "", pc.art ? ARTIFACT_RULES(pc.ai) : "", pc.inl ? VIZ_RULES : ""].filter(Boolean).join("\n\n") : "";
    // Công cụ của Synchro cho gói (Claude Code, Codex, Antigravity): skill, thư viện plugin, connector, chạy code, dữ liệu đã lưu, danh sách việc —
    // CLI gọi qua cầu nối MCP nội bộ, mở riêng cho lượt này và đóng khi xong.
    const cli = subCli(model)!;
    const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
    let bridge: { url: string; close: () => void } | null = null, x: Exec | null = null, sess: ConnectorSession | null = null, toolSys = "";
    const usedAll: ToolRun["used"][] = [];
    let bridged = 0;
    try {
      if (pc && !am && BRIDGE_CLIS.has(cli)) {
        const studio = can(c.user, "skills") ? studioOf(body.studio) : null;
        const st = studio ? studioSkills(c.user.id, studio) : null;
        const ss = await skillSet(c.user, body, messages, studio, st);
        if (can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length) sess = null; }
        const code = pc.code;
        const refs = !!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(messages));
        // Công cụ và hướng dẫn trình duyệt luôn có khi tính năng bật (phần đầu prompt ổn định, đọc lại từ bộ đệm).
        const browse = !!pc.browse && feature !== "artifact";
        const bst = capsState(c.user);
        const task = taskOf(body);
        const tools = [...(task ? [TASK_TOOL] : []), ...(code ? [runCodeTool(pc.net)] : []), ...(ss.visible.length ? skillTools(ss.visible.length, code) : []), ...(sess ? connectorToolDefs(sess, false) : []), ...(refs ? [READ_REF_TOOL] : []), ...(brainOn(body, c.user) ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), PLAN_TOOL];
        const xx: Exec = { list: [...ss.visible, ...ss.list.filter((k) => !ss.visible.includes(k))], scripts: code, sess, uid: c.user.id, code, net: pc.net, outs: [], libs: ss.libs, studio: studio ? ss.libs[`studio-${studio}`][0] : undefined, prefer: ss.prefer, trace: [], conv: convId, browse, task, bctx: browse ? { def: task ? taskBrowser(task) : browserDefault(bst), synchro: !bst.locks.browse, scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => xx.outs) } : undefined };
        x = xx;
        bridge = openBridge({ uid: c.user.id, tools: tools as { name: string; description: string; input_schema: unknown }[], call: (name, input) => { bridged++; return bridgeCall(xx, name, input, usedAll); } });
        toolSys = [studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : "", code ? CODE_RULES(pc.net) : "", skillsPrompt(ss.visible, code), sess ? connectorsPrompt(sess) : "", CLI_TOOLS_NOTE(cli), NARRATE_RULES, brainOn(body, c.user) ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : "", ss.route].filter(Boolean).join("\n\n");
      }
      const turnMsgs = am ?? withRecall(messages, recallOf(body, c.user, convId));
      const once = (msgs: unknown) => subTurn({
        user: c.user, model, system: am ? ARTIFACT_SYSTEM : [system || (planSys || toolSys ? "Bạn là một trợ lý AI hữu ích." : ""), planSys, toolSys, contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n"),
        messages: msgs, conv: am ? undefined : convId, effort: isEffort(wanted) ? wanted : wanted === "auto" ? autoEffort(routeInput(body)) : undefined, signal: runSignal(), onDelta: am ? undefined : live(),
        mcp: bridge ? { url: bridge.url } : undefined, web: body.web === true,
      });
      let r = await once(turnMsgs);
      // Gói dừng ngay sau câu "Mình sẽ…" mà chưa gọi công cụ nào của Synchro: nhắc làm tiếp trong cùng phiên của CLI (stall.ts).
      for (let k = 0, said: string; k < MAX_NUDGE && bridge && r.status === 200 && !bridged && stalled(said = String((r.json as { text?: unknown }).text ?? "")); k++) {
        progress("say", said.trim());
        r = await once([...(turnMsgs as unknown[]), { role: "assistant", content: said }, { role: "user", content: NUDGE }]);
      }
      if (!x || r.status !== 200) return Response.json(r.json, { status: r.status });
      // Như lượt khóa API: skill / thư viện đã dùng, tệp đã tạo, dấu vết công cụ (lượt sau model nào cũng biết đã làm gì).
      const names = usedAll.filter((u) => u.kind === "skill").map((u) => u.name);
      recordUse(c.user.id, names);
      return Response.json({ ...(r.json as Record<string, unknown>), skills: usedAll, files: x.outs, libs: usedLibs(x, names), ...(x.trace.length ? { trace: x.trace } : {}) });
    } finally { bridge?.close(); sess?.close(); if (x) releaseBrowser(c.user.id, x.bctx); }
  }
  if (!model) return Response.json({ error: "Synchro chưa được kết nối với model nào. Quản trị viên cần nhập khóa API ở Cài đặt → Providers." }, { status: 503 });
  if (!canModel(c.user, model)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng model này." }, { status: 403 });
  const t = await resolveModel(model);
  if (!t) return Response.json({ error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác." }, { status: 400 });
  // Mức nỗ lực người dùng chọn, hạ xuống giới hạn quản trị viên đặt cho model này (quản trị viên không bị giới hạn).
  // "auto": mức nỗ lực theo độ khó của yêu cầu (việc dễ trả lời nhanh, việc khó suy nghĩ kỹ).
  const want = wanted === "auto" ? autoEffort(routeInput(body)) : wanted;
  const effort = isEffort(want) ? clampEffort(want, effortCap(permsOf(c.user).effort, model), t.kind) : undefined;
  if (feature === "artifact") {
    if (!capsState(c.user).caps.ai) return Response.json({ error: "Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng." }, { status: 403 });
    limit("artai:" + c.user.id, 120, 10 * 60_000);
    const am = artifactMessages(body.prompt);
    if (!am) return Response.json({ error: "Nội dung gửi tới model không hợp lệ." }, { status: 400 });
    try {
      if (t.kind === "mock") return Response.json({ model, text: `[mock] ${am[am.length - 1].content.slice(0, 200)}` });
      return Response.json({ model, text: await chatOnce(t, ARTIFACT_SYSTEM, am, Math.min(Number(max_tokens) || 2000, 4000), undefined, effort) });
    } catch (e) {
      if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
      return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
    }
  }
  // Lượt chat chính (skills = true) áp dụng Cài đặt → Khả năng: Artifacts, hình minh họa trong chat, chạy code.
  const cs = skills ? capsState(c.user) : null;
  // Nút Thiết kế / Trình bày / Tài liệu (studio): nạp thư viện skill của plugin gắn với studio đó.
  const studio = skills && can(c.user, "skills") ? studioOf(body.studio) : null;
  const st = studio ? studioSkills(c.user.id, studio) : null;
  const capSys = cs ? [feature !== "code" ? ASK_RULES : "", cs.caps.art ? ARTIFACT_RULES(cs.caps.ai) : "", cs.caps.inl ? VIZ_RULES : "", cs.caps.code ? CODE_RULES(cs.caps.net) : "", studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : ""].filter(Boolean).join("\n\n") : "";
  // Bàn trộn ngữ cảnh (trình duyệt gửi): tắt khối tầng động, chỉ gửi N tin gần nhất, tóm tắt các lượt cũ đã nén.
  const mixer = (body.mixer && typeof body.mixer === "object" ? body.mixer : {}) as { artifacts?: unknown; tools?: unknown; recent?: unknown };
  const base = cleanBase(body.artBase);
  const mix = { artifacts: mixer.artifacts !== false, tools: mixer.tools !== false, recent: typeof mixer.recent === "number" ? mixer.recent : undefined, summary: typeof body.summary === "string" ? body.summary : undefined, base };
  // Tài liệu ghim và bộ nhớ của người dùng: tầng tĩnh, ngay sau hướng dẫn hệ thống và danh mục skill (ít đổi nên đọc từ bộ đệm prompt).
  const pinned = [contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n");
  const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
  let sess: ConnectorSession | null = null;
  try {
    const { list, visible, libs, prefer, route } = await skillSet(c.user, body, messages, studio, st);
    // Lịch sử theo chuẩn Synchro → tin nhắn sẵn sàng cho mọi hãng. Gợi ý skill theo câu hỏi mới nhất đổi mỗi lượt nên ở tầng động
    // (cuối prompt), không ở phần đầu: phần đầu (hướng dẫn, danh mục skill, tài liệu ghim) giữ nguyên để đọc từ bộ đệm.
    const prep = prepareHistory(messages, [route, recallOf(body, c.user, convId)], mix);
    // Connector chỉ dùng trong lượt chat chính (skills = true), không dùng cho các lệnh nội bộ như tóm tắt bộ nhớ.
    if (skills && t.kind !== "mock" && can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length) sess = null; }
    const code = !!cs?.caps.code && t.kind !== "mock";
    // read_ref: đọc dữ liệu lớn đã lưu theo tham chiếu (ở lượt này hoặc các lượt trước, kể cả khi đổi model).
    const refs = !!skills && t.kind !== "mock" && (!!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(prep.messages)));
    // "Tìm kiếm trên web" ở khung soạn: công cụ tìm web phía máy chủ của Anthropic / OpenAI; Gemini dùng web_search của Synchro
    // (Google Search qua API gốc của Gemini).
    const web = !!skills && body.web === true && (t.kind === "anthropic" || t.kind === "openai" || t.kind === "google");
    const brain = t.kind !== "mock" && brainOn(body, c.user);
    // Trình duyệt của Synchro (Cài đặt → Khả năng → Điều khiển trình duyệt): model nào cũng thao tác được trên web khi người dùng nhờ.
    // Luôn kèm khi bật, không đoán theo từng câu hỏi: công cụ nằm ở phần đầu prompt, đổi qua lại sẽ làm hỏng bộ đệm prompt.
    const browse = !!skills && t.kind !== "mock" && !!cs?.caps.browse;
    const task = skills && t.kind !== "mock" ? taskOf(body) : null;
    if (visible.length || sess || code || refs || web || brain || browse || task) {
      // Chạy script của skill chỉ khi máy chủ có nơi chạy code và người dùng bật "Chạy code và tạo tệp".
      const scripts = code;
      const sk = [capSys, skillsPrompt(visible, scripts), sess ? connectorsPrompt(sess) : "", skills ? NARRATE_RULES : "", brain ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : "", pinned].filter(Boolean).join("\n\n");
      const tools = [...(code ? [runCodeTool(!!cs?.caps.net)] : []), ...(visible.length ? skillTools(visible.length, scripts) : []), ...(sess ? connectorToolDefs(sess, t.kind === "google") : []), ...(refs ? [READ_REF_TOOL] : []), ...(brain ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), ...(task ? [TASK_TOOL] : []), ...(skills ? [PLAN_TOOL] : []), ...(web && t.kind === "google" ? [GEMINI_WEB_TOOL] : [])];
      // Phiên bản công cụ tìm web theo model (bản có lọc động cho dòng mới; model cũ dùng bản cơ bản).
      const webTool = { type: /(opus|sonnet)-(5|4-[6-9])|fable/.test(t.model) ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 5 };
      if (body.estimate === true) { sess?.close(); return estimate([system, capSys], [skillsPrompt(visible, scripts), sess ? connectorsPrompt(sess) : "", JSON.stringify(tools)], pinned, prep); }
      const x: Exec = { list: [...visible, ...list.filter((k) => !visible.includes(k))], scripts, sess, uid: c.user.id, code, net: !!cs?.caps.net, outs: [], libs, studio: studio ? libs[`studio-${studio}`][0] : undefined, prefer, trace: [], conv: convId, heal: scripts ? t : undefined, search: web && t.kind === "google" ? t : undefined, browse, task, bctx: browse && cs ? { def: task ? taskBrowser(task) : browserDefault(cs), synchro: !cs.locks.browse, scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => x.outs) } : undefined };
      const msgs = prep.messages;
      const ad = t.kind === "mock" ? mockAdapter(list)
        : t.kind === "anthropic" ? anthropicAdapter(t, system, sk, max_tokens, web ? [...tools, webTool] : tools, effort, prep.historyEnd)
        : t.kind === "openai" ? responsesAdapter(t, `${system}\n\n${sk}`, max_tokens, tools, effort, web)
        : openaiAdapter(t, `${system}\n\n${sk}`, max_tokens, tools, effort);
      const m0: unknown[] = t.kind === "mock" ? [...msgs] : t.kind === "anthropic" ? msgs.map((m) => ({ ...m, content: toAnthropic(m.content) }))
        : t.kind === "openai" ? msgs.map((m) => ({ ...m, content: toResponses(m.content) })) : msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }));
      // Kiểm tra bản sửa trên lịch sử gốc (bản đã rút gọn không còn nội dung artifact cũ).
      const raw = (Array.isArray(messages) ? messages : []) as { role: string; content: unknown }[];
      const out = await healPatch(ad, m0, raw, await toolLoop(ad, m0, x, [], c.user.id, model), base);
      return reply(c, model, out, x);
    }
    if (body.estimate === true) return estimate([system, capSys], [], pinned, prep);
    if (t.kind === "mock") return Response.json({ model, text: "[mock] Không có skill nào đang bật." });
    let text: string, cancelled = false;
    const sys0 = [capSys ? `${system || "Bạn là một trợ lý AI hữu ích."}\n\n${capSys}` : system, pinned].filter(Boolean).join("\n\n");
    try { text = await chatOnce(t, sys0, prep.messages, max_tokens, runSignal(), effort, live()); }
    catch (e) { if (!isAbort(e)) throw e; text = liveNow(); cancelled = true; }
    return Response.json({ model, text, effort, ...(cancelled ? { cancelled: true } : {}) });
  } catch (e) {
    sess?.close();
    if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}

/** Chạy chat ở nền (lượt chạy bền): kiểm tra hạn mức như /api/llm rồi dùng chung chatPost. */
registerExec("chat", async (body, user) => {
  // Gói subscription của chính người dùng không tính vào hạn mức chi phí API của Synchro.
  const over = subCli(body.model) ? null : overLimit(user);
  if (over) return { http: 429, json: { error: over, usageLimit: true } };
  const scope = { uid: user.id, feature: "chat" };
  const res = await usageScope.run(scope, () => chatPost(body, { user }, scope));
  const json = await res.json();
  // Việc tự động chạy theo lịch không phải đoạn chat: không rút bộ nhớ hay chưng cất vào bộ não (kết quả các lần trước đã đi cùng lần chạy sau).
  if (taskOf(body)) return { http: res.status, json };
  // Rút bộ nhớ từ lượt vừa xong ở nền (không làm chậm câu trả lời).
  if (res.status === 200 && useMemory(body, user) && typeof json?.text === "string") void learnFromTurn(user, lastUserText(body.messages), json.text).catch(() => {});
  // Bộ não tổng hợp: ghi nhận đoạn chat để chưng cất thành một nhánh (chạy nền, không làm chậm câu trả lời).
  if (res.status === 200 && json && typeof json === "object") try { afterTurn(user, body, json); } catch (e) { console.error("[brain]", e); }
  return { http: res.status, json };
});
