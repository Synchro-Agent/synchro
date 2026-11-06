import { enabledSkills, recordUse } from "./skillstore";
import { MAX_STEPS, runSkillTool, skillsPrompt, skillTools, type ToolRun } from "./skillruntime";
import { healScript } from "./skillheal";
import { can, canModel, limit, permsOf, type UserRow } from "./authstore";
import { clampEffort, connPolicy, effortCap, isEffort, legacyModel, type Effort } from "./catalog";
import { catalog, mainModels, pickDefault, resolveModel, type Target } from "./providers";
import { ConnectorSession, connectorsPrompt, listConnectors, RECONNECT_TOOL, type ChatTool, type OfflineConn } from "./connectors";
import { randomToken } from "./mcpauth";
import { browserDefault, capsState, skillsOn } from "./caps";
import { overLimit, usageScope } from "./usage";
import { awaitToolUse, currentRun, delta, deltaStep, inboxWaiting, liveNow, markEffect, onInbox, progress, registerExec, runSignal, steered, stepSignal, takeInbox, toolUseSeen, turnSignal } from "./runs";
import { prepareHistory, type TraceItem } from "./transpile";
import { expandFileRefs } from "./fileproc";
import { maybeRef, READ_REF_TOOL, readRef } from "./refs";
import { normalizeSchema } from "./connschema";
import { BRIDGE_CALL_MAX, destructiveLike, TOOL_BUDGET } from "./mcp";
import { ARTCHECK_RULES, CHECK_ARTIFACT_TOOL, checkArtifact, findArtifact, READ_ARTIFACT_TOOL, readArtifact } from "./artcheck";
import { artState, cleanBase, resolveArt, type ArtVersion } from "./vfs";
import { hasArtifacts, splitArtifacts } from "./artifacts";
import { askedBack, AUTO, autoEffort, effortLabel, isAck, needsNoTools, routeModel, taskLabel, taskOf as routeTask, type RouteInput } from "./router";
import { ALL } from "./catalog";
import { everywhereSkills, libraryPlugins, recordPluginUse, STUDIOS, studioOf, studioSkills, type Studio } from "./plugins";
import { rank } from "./skillroute";
import { ruleStudios } from "./studiorules";
import { PLUGIN_CATS, STUDIO_LABEL } from "./plugindir";
import { dirCats } from "./claudedir";
import { suggest, type Hit } from "./skillroute";
import type { Skill } from "./skillstore";
import { CODE_RULES, execRun, LANGS, runCodeTool, runner, RUN_LIMITS, type Lang, type RecalcReport, type RunOutput } from "./coderun";
import { plainSummary, runBlocks } from "./runtext";
import { OUTPUT_QUOTA_MB, outputByName, outputRoom, outputsFull, readOutput, removeOutput, saveOutputs, type OutFile } from "./outputs";
import { mergeOuts, previewNote, previewOf } from "./runpreview";
import { ARTIFACT_RULES, ASK_RULES, VIZ_RULES } from "./artifacts";
import { designTurn, historyTexts } from "./designkit";
import { type ABlock, anthropicCall, blocksText, chatOnce, effortParams, HttpErr, openaiCall, outCap, respInput, respParse, respTools, responsesCall, toAnthropic, toOpenAI, toResponses, withPages } from "./llmcall";
import { mergedProviders, prewarmClaude, sessionPlain, subCli, subTurn } from "./ai/subs";
import { PROJECT_DOC_RULES, PROJECT_DOC_TOOL, projectDocsLong, readProjectFile } from "./projectdocs";
import { ASPECTS, generateImages, IMAGE_RULES, IMAGE_TOOL, imageBudget, IMG_NAME, requestSlug } from "./ai/imagegen";
import { genImageUrl } from "./artdoc";
import { IMAGE_MAX_MB, imageKind, type ImgFile, scrubServerPaths } from "./ai/imagefiles";
import { AGY_WAIT_NOTE, BRIDGE_HOLD, openBridge } from "./mcpbridge";
import { usableModels } from "./ai/anymodel";
import { learnFromTurn, userContext } from "./memory";
import { afterTurn, BRAIN_RULES, BRAIN_TOOLS, brainRecall, brainReady, runBrainTool, topRule, warmRecall } from "./brain";
import { DENIED_NUDGE, MAX_NUDGE, NUDGE, stalled } from "./stall";
import { makeGate, NO_UI, QUEUED, type Gate } from "./agentgate";
import { queueSite, queueTool, runPropose, TASK_TOOL, taskBrowser, taskOf, taskRules } from "./tasktools";
import type { TaskCtx } from "./tasks";
import { answer as answerAsk, newAskId, waitAnswer, type Ask } from "./approvals";
import { callArgs, compactSchema, rankTools, resolveTool } from "./connproxy";
import { getPrefs as codePrefs } from "./codestore";
import { INPUTS_MAX, runInputs } from "./runinputs";
import { BROWSER_RULES, BROWSER_TOOLS, browserTargetOf, chatFiles, describeBrowser, isBrowserTool, releaseBrowser, runBrowserTool, type BrowserCtx } from "./browsertools";

// Bộ xử lý chat (chỉ chạy ở máy chủ), dùng chung cho /api/llm (chờ kết quả) và lượt chạy nền (runs.ts).
// Model nào gọi tới nhà cung cấp nào do khóa API quản trị viên nhập ở Cài đặt → Providers quyết định.

// ---------------------------------------------------------------- vòng lặp tool cho skill
type Call = { id: string; name: string; input: Record<string, unknown> };
// pause: công cụ phía máy chủ của hãng (tìm web) chưa chạy xong trong một lần gọi — gửi lại để model làm tiếp.
type Step = { text: string; calls: Call[]; assistant: unknown; pause?: boolean };
// image: ảnh JPEG (base64) đi kèm kết quả công cụ, ví dụ ảnh chụp trình duyệt; mỗi hãng nhận theo cách riêng.
// mime: loại ảnh khi không phải JPEG (ảnh do connector trả về). more: các ảnh sau ảnh đầu của cùng kết quả.
type Run = ToolRun & { image?: string; mime?: string; more?: { data: string; mime: string }[] };
type Adapter = { step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: Run[]) => unknown[] };
// Ảnh chụp trình duyệt cho model dùng Chat Completions / Responses: tin nhắn công cụ chỉ nhận chữ, nên ảnh đi kèm một tin người dùng ngay sau.
const SHOT = (id: string) => `Ảnh chụp màn hình trình duyệt (kết quả công cụ ${id}).`;
const shotMsgs = (calls: Call[], res: Run[]) => res.flatMap((r, i) => r.image ? [{ role: "user", content: [{ type: "text", text: SHOT(calls[i].id) }, { type: "image_url", image_url: { url: `data:${r.mime ?? "image/jpeg"};base64,${r.image}` } }, ...(r.more ?? []).map((m) => ({ type: "image_url", image_url: { url: `data:${m.mime};base64,${m.data}` } }))] }] : []);
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
    }, stepSignal(), live(), (b) => searched(b));
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
    content: res[i].image ? [{ type: "text", text: res[i].content }, { type: "image", source: { type: "base64", media_type: res[i].mime ?? "image/jpeg", data: res[i].image } }, ...(res[i].more ?? []).map((m) => ({ type: "image", source: { type: "base64", media_type: m.mime, data: m.data } }))] : res[i].content })) }],
});

const openaiAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort): Adapter => ({
  step: async (msgs, noTools) => {
    const j = await openaiCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort), messages: [{ role: "system", content: system }, ...msgs],
      tools: tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })),
      ...(noTools ? { tool_choice: "none" } : {}),
    }, stepSignal(), live());
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
    const r = respParse(await responsesCall(t, { instructions: system, max_output_tokens: outCap(t, max_tokens), ...effortParams(t, effort), input: respInput(msgs), tools: [...respTools(tools), ...(web ? [{ type: "web_search" }] : [])], ...(noTools ? { tool_choice: "none" } : {}) }, stepSignal(), live(), searched));
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
// search: model Gemini / Grok / DeepSeek (khóa API) để tìm web qua công cụ web_search của Synchro (Google Search qua API gốc của Gemini,
// web_search của API Responses ở xAI / DeepSeek).
// browse: công cụ trình duyệt đang bật (Cài đặt → Khả năng); bctx: trình duyệt của lượt (của Synchro / Chrome của người dùng, browsertools.ts);
// shown: trình duyệt đã mở khung cho người dùng ở lượt này;
// heavy: id các lượt đọc trang / chụp màn hình (lược bớt bản cũ để ngữ cảnh không phình khi thao tác dài).
// task: lượt chạy nền của việc tự động (tasks.ts): việc cần người dùng đồng ý thành đề xuất trong Hộp thư thay vì chờ hỏi.
// art: lịch sử để read_artifact / check_artifact dựng lại bản hiện tại của artifact (cùng phần đã nén ở artBase).
// turnArts: artifact model viết giữa lượt (trong lời dẫn trước công cụ), xem sayOut.
// image: công cụ generate_image đang bật; msgs: lịch sử của lượt, để tìm ảnh gốc người dùng nhờ sửa.
type Exec = { project?: unknown; image?: boolean; msgs?: unknown; effects?: string[]; toolSync?: boolean; list: Skl; scripts: boolean; sess: ConnectorSession | null; uid: string; code: boolean; net: boolean; web?: boolean; art?: { messages: { role: string; content: unknown }[]; base: unknown }; turnArts?: string[]; outs: OutFile[]; outPaths?: Map<string, string>; libs?: Record<string, Lib[]>; studio?: Lib; prefer?: Record<string, string>; trace: TraceItem[]; conv?: string; heal?: Target; search?: Target; browse?: boolean; bctx?: BrowserCtx; shown?: string; heavy?: string[]; gate?: Gate; task?: TaskCtx | null; asking?: Promise<void>; awaiting?: number; denied?: Map<string, string>; connCards?: Set<string>; calls?: Map<string, { at: number; cancel?: AbortSignal }>; park?: () => void; inputsSent?: Set<string>; madeImgs?: string[] };
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
// Ảnh trong outputs/ được gửi lại cho model xem (khung hình video, trang PDF, biểu đồ…; runpreview.ts): không xem được thì model từng tự đưa ảnh lên host
// ảnh công khai để mở bằng trình duyệt. outputs/_preview/ chỉ để model xem, không thành tệp của người dùng.
// Báo cáo tính lại công thức Excel của dịch vụ workspace (workspace/xlsx_recalc.py), để model đối chiếu với số tự tính.
const recalcNote = (rc: RecalcReport | undefined) => {
  if (!rc) return "";
  const rows = [
    ...(rc.error ? [`Không tính lại được: ${rc.error}`] : []),
    ...(rc.files ?? []).map((b) => `${b.path}: đã tính lại ${b.filled}/${b.formulas} công thức bằng LibreOffice và ghi giá trị vào tệp.${b.prefixed ? ` Đã thêm tiền tố _xlfn. cho ${b.prefixed} hàm đời mới để Excel không báo #NAME?.` : ""}${b.sample.length ? ` Vài giá trị: ${b.sample.join(", ")}.` : ""}${b.errors.length ? ` Ô lỗi, phải sửa: ${b.errors.map((e) => `${e.sheet}!${e.cell} ${e.value}${e.formula ? ` (=${e.formula})` : ""}`).join("; ")}.` : ""}`),
    ...(rc.failed ?? []).map((f) => `${f.path}: không tính lại được (${f.reason}); công thức trong tệp có thể đang trống hoặc bằng 0 đến khi mở bằng Excel.`),
  ];
  return rows.length ? `\n<excel_recalc>\n${rows.join("\n")}\n</excel_recalc>` : "";
};
// Chỉ lần chạy thành công mới thành tệp của người dùng: video dở của lần quá giờ không phát được, tệp của lần lỗi có thể sai. Sửa rồi chạy lại cùng đường dẫn
// thì bản mới thay bản cũ của lượt này: từng hiện hai ba thẻ cùng tên, người dùng có thể tải nhầm bản hỏng. Tệp của các lượt trước giữ nguyên.
function deliver(x: Exec, r: RunOutput) {
  const kept = r.files.filter((f) => !f.path.startsWith("_preview/"));
  if (r.exit !== 0 || r.timedOut || (kept.length && outputsFull())) return { saved: [] as OutFile[], held: kept.map((f) => f.path), full: [] as string[] };
  // Hạn mức dung lượng tệp đã tạo của tài khoản: tệp không còn chỗ thì báo như tệp quá cỡ, không xóa tệp cũ nào của người dùng.
  let room = outputRoom(x.uid);
  const fit = kept.filter((f) => { if (f.data.length > room) return false; room -= f.data.length; return true; });
  const full = kept.filter((f) => !fit.includes(f)).map((f) => `${f.path}: ${Math.ceil(f.data.length / 1048576)} MB, tài khoản đã dùng hết ${OUTPUT_QUOTA_MB()} MB dung lượng tệp đã tạo (tệp cũ tự xóa sau 30 ngày)`);
  const saved = saveOutputs(x.uid, fit);
  mergeOuts(x.outs, (x.outPaths ??= new Map<string, string>()), fit.map((f) => f.path), saved, (id) => removeOutput(x.uid, id));
  // Chạy lại nhỏ hơn và giao được: bỏ thẻ "chưa giao được" của đúng tệp đó.
  for (const f of saved) { const i = x.outs.findIndex((o) => o.skipped && o.name === f.name); if (i >= 0) x.outs.splice(i, 1); }
  return { saved, held: [] as string[], full };
}
// Thẻ "chưa giao được" trong tin nhắn: người dùng không có thẻ tải về thì không biết là thiếu tệp nếu model không nói. skipped: "đường-dẫn: lý do".
function noteSkipped(x: Exec, list: string[]) {
  for (const s of list) {
    const name = s.split(": ")[0].split("/").pop() || "tep", mb = /(\d+) MB/.exec(s)?.[1];
    if (!x.outs.some((o) => o.skipped && o.name === name)) x.outs.push({ id: `skip-${name}`, name, size: Number(mb ?? 0) * 1048576, mime: "", skipped: true });
  }
}
const inputsNote = (i: { names: string[]; over: string[] }) => (i.names.length || i.over.length ? `\n<inputs>\n${i.names.length ? `Bản gốc tệp của đoạn chat vừa chép vào inputs/: ${i.names.join(", ")}.` : ""}${i.over.length ? ` Quá lớn nên không chép được (tổng ${INPUTS_MAX / 1048576} MB một lần chạy): ${i.over.join(", ")}; phải nói rõ với người dùng nếu cần tới các tệp này.` : ""}\n</inputs>` : "");
async function runCode(x: Exec, input: Record<string, unknown>): Promise<Run> {
  const lang = (typeof input.language === "string" && input.language in LANGS ? input.language : "python") as Lang;
  const used = { kind: "code" as const, name: lang };
  const code = typeof input.code === "string" ? input.code : "";
  if (!x.code) return { content: "Chạy code đang tắt trong Cài đặt → Khả năng.", is_error: true, used };
  if (!code.trim() || code.length > 200_000) return { content: "Thiếu code hoặc code quá dài (tối đa 200.000 ký tự).", is_error: true, used };
  try {
    // Thư mục làm việc giữ nguyên giữa các lần chạy trong cùng đoạn chat: bước sau dùng lại tệp bước trước đã tải / tạo.
    const keep = x.conv ? x.conv.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) : undefined;
    const timeout = typeof input.timeout === "number" ? input.timeout : undefined;
    // Tệp người dùng gửi và ảnh đã tạo nằm ở inputs/. Chỉ máy giữ thư mục giữa các lần chạy mới không phải chép lại trong lượt này (E2B mỗi lần một máy mới).
    const inp = await runInputs(x.uid, x.msgs, x.madeImgs ?? [], keep && runner() !== "e2b" ? (x.inputsSent ??= new Set()) : undefined);
    const r = await execRun({ uid: x.uid, files: [{ path: LANGS[lang].file, data: Buffer.from(code) }, ...inp.files], argv: [...LANGS[lang].argv], net: x.net, web: x.web, keep, timeout, signal: runSignal(), recalc: true });
    const { saved, held, full } = deliver(x, r);
    const pv = await previewOf(r.files);
    const files = saved.length ? `\n<files>\n${saved.map((f) => `outputs/${f.name} (${fmtSize(f.size)}) — đã gửi cho người dùng`).join("\n")}\n</files>` : "";
    const hold = held.length ? (r.exit === 0 && !r.timedOut ? `\n<not_delivered>\nMáy chủ sắp hết dung lượng đĩa nên các tệp này CHƯA tới người dùng: ${held.join(", ")}. Hãy nói rõ điều này với người dùng và đề nghị thử lại sau; đừng nói là đã gửi tệp.\n</not_delivered>` : `\n<not_delivered>\n${r.timedOut ? "Lần chạy quá giờ" : "Lần chạy lỗi"} nên các tệp này CHƯA tới người dùng, có thể dở dang: ${held.join(", ")}. Chúng nằm ở .last_outputs/. Sửa rồi chạy lại; tệp nào dùng được thì chép sang outputs/ ở lần chạy sau.\n</not_delivered>`) : "";
    // Tệp vượt giới hạn dung lượng: chỉ thẻ này báo được, người dùng không có thẻ tệp nào để biết là thiếu. Tệp _preview/ chỉ để model xem, không cần báo.
    const over = [...(r.skipped ?? []).filter((s) => !s.startsWith("_preview/")), ...full];
    if (r.exit === 0 && !r.timedOut) noteSkipped(x, over);
    const skip = over.length ? `\n<not_delivered>\nCác tệp này KHÔNG tới người dùng và không có thẻ tải về: ${over.join("; ")}. Giới hạn ${RUN_LIMITS.fileSize / 1048576} MB mỗi tệp, ${RUN_LIMITS.total / 1048576} MB mỗi lần chạy. Nén lại (video: -crf cao hơn, hạ bitrate âm thanh) hoặc chia nhỏ rồi chạy lại; không làm được thì phải nói rõ với người dùng là tệp chưa giao được (thẻ tệp hiện "chưa giao được").\n</not_delivered>` : "";
    // Thẻ trạng thái đứng trước log: log dài cỡ nào model vẫn thấy đã giao tệp gì, ô Excel nào lỗi, đã xem ảnh nào.
    return { ...runBlocks({ open: `<run_result language="${lang}" exit_code="${r.exit}">`, close: "</run_result>", tags: `${inputsNote(inp)}${files}${hold}${skip}${recalcNote(r.recalc)}${previewNote(pv)}`, stdout: r.stdout, stderr: r.stderr }), is_error: r.exit !== 0, used, ...(pv ? { image: pv.image } : {}) };
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
// Chuẩn làm việc cho mọi lượt chat chính: làm trọn, tự kiểm trước khi giao, trung thực, chịu trách nhiệm khi có lỗi (người dùng từng gặp
// model "biết là lỗi nhưng chỉ nói không làm được", giao slide lỗi mà không hay biết). Ngắn và ổn định để đọc từ bộ đệm prompt.
const QUALITY_RULES = `<working_standards>
Làm việc như một chuyên gia tận tâm, chịu trách nhiệm đến cùng với kết quả:
- Làm trọn: giao sản phẩm hoàn chỉnh dùng được ngay, không để chỗ trống, "TODO", "…" hay phần "bạn tự điền". Việc lớn thì chia bước và làm hết.
- Tự kiểm trước khi giao: đọc lại, chạy thử, đối chiếu số liệu, xem lại sản phẩm bằng công cụ có sẵn; sửa hết lỗi mình thấy rồi mới báo xong.
- Trung thực: không bịa số liệu, nguồn, trích dẫn hay khả năng. Chưa chắc thì nói rõ mức độ chắc chắn và cách kiểm chứng.
- Khi người dùng báo lỗi: nhận trách nhiệm, tìm đúng nguyên nhân (tái hiện bằng công cụ), sửa tận gốc, kiểm tra lại, rồi báo ngắn gọn đã sửa gì. Không đổ cho công cụ hay môi trường khi còn cách khác để thử.
- Không nói "không làm được" khi chưa thử các cách khả thi. Thật sự bị chặn thì nói đã thử gì, vì sao chưa được, và giao phương án tốt nhất có thể ngay trong lượt này.
- Ngôn ngữ: trả lời bằng đúng ngôn ngữ người dùng đang viết (hỏi tiếng Anh thì trả lời tiếng Anh), trừ khi họ yêu cầu khác.
- Chu đáo: trình bày rõ ràng, đúng chính tả; nêu điều quan trọng người dùng cần biết (rủi ro, giới hạn, bước tiếp theo) một cách ngắn gọn.
- Giữ riêng tư: không đưa tệp, ảnh hay dữ liệu của người dùng lên dịch vụ bên ngoài khi họ chưa yêu cầu rõ.
- Thông tin dễ thay đổi (giá, tỉ giá, tin tức, lịch, phiên bản phần mềm, quy định mới): có công cụ tìm web thì tìm trước rồi mới trả lời, nói rõ dữ liệu tính đến lúc nào và ghi nguồn bằng liên kết markdown. Không tìm được thì nói rõ thông tin có thể đã cũ. Giờ hiện tại nằm trong khối <current_time> của tin nhắn mới nhất.
- Sức khỏe, pháp lý, tài chính: nêu mức độ khẩn trước (dấu hiệu nguy hiểm thì khuyên gọi cấp cứu hoặc đi viện ngay), nói rõ điều chưa chắc, và khi nào cần gặp chuyên gia.
- Người dùng nói muốn tự tử, tự làm hại mình hoặc tuyệt vọng: đáp lại với sự quan tâm thật, không phán xét, không liệt kê cách làm; hỏi họ có đang an toàn không, khuyên liên hệ ngay người thân tin cậy hoặc đường dây khẩn cấp ở nơi họ sống (ở Việt Nam: 115 cấp cứu, 111 tổng đài bảo vệ trẻ em).
- Ảnh do AI tạo: dùng công cụ generate_image nếu có (xem <image_generation>). Không có công cụ đó, hoặc công cụ báo chưa tạo được, thì nói rõ điều đó ngay câu đầu, không gọi sản phẩm thay thế là ảnh AI hay ảnh chụp, rồi đề xuất phương án tốt nhất: hình SVG hoặc đồ họa dựng bằng mã (HTML, Pillow), ảnh thật có giấy phép mở từ Wikimedia Commons khi có quyền web (ghi rõ nguồn), hoặc câu lệnh để họ dán vào công cụ tạo ảnh khác.
</working_standards>`;
// Đường nhanh: câu rõ ràng không cần công cụ (router.needsNoTools) đi với hướng dẫn rất ngắn, không cầu nối MCP, không mục lục skill. Đo trên máy chủ thật: một câu chào qua
// Claude Haiku chờ 4,8 giây, trong đó 1,5 giây là đọc 69 KB hướng dẫn. Công cụ vẫn còn nguyên ở lượt sau; model thấy cần công cụ thì báo NEED_TOOLS và Synchro chạy lại lượt đầy đủ.
const NEED_TOOLS = "[[CAN_CONG_CU]]";
const FAST_RULES = `<quick_reply>
Đây là câu trò chuyện, câu hỏi ngắn hoặc việc viết ngắn: trả lời ngay, tự nhiên, bằng đúng ngôn ngữ người dùng đang viết. Câu hỏi thì ngắn gọn; nhờ viết (email, thư, thơ, caption…) thì viết đủ, chỉn chu, đưa bài viết ra ngay, không kể lại yêu cầu. Trung thực: không bịa số liệu, nguồn hay khả năng; chưa chắc thì nói rõ. Giờ hiện tại nằm trong khối <current_time> của tin nhắn mới nhất.
Lượt này chưa nạp công cụ, nhưng Synchro có đủ: tìm web, chạy code, tạo tệp và artifact, tạo ảnh bằng AI, skill, connector, trình duyệt. Nếu câu trả lời tốt thật sự cần một trong số đó, hoặc cần thông tin mới hơn những gì bạn biết, đừng giải thích và đừng xin lỗi: chỉ trả lời đúng một dòng ${NEED_TOOLS} rồi dừng.
An toàn đứng trước sự ngắn gọn. Tin nhắn có thể nói tới tự làm hại, tuyệt vọng, bị bạo hành hay xâm hại (kể cả nói gián tiếp), hoặc tình huống y tế khẩn: không trả lời cho qua. Đáp với sự quan tâm thật, không phán xét, không nêu cách làm hại; nói rõ mức độ khẩn, hỏi họ có đang an toàn không, khuyên liên hệ ngay người thân tin cậy, cấp cứu hoặc đường dây khẩn cấp nơi họ sống (Việt Nam: 115 cấp cứu, 111 bảo vệ trẻ em). Câu hỏi sức khỏe, pháp lý, tài chính: nêu điều chưa chắc và khi nào cần gặp chuyên gia.
</quick_reply>`;
const NARRATE_RULES = `<working_out_loud>
Khi cần dùng công cụ, hãy làm việc "thành tiếng" bằng ngôn ngữ của người dùng:
- Trước mỗi bước, viết 1 câu ngắn nói bạn sắp làm gì và vì sao (ví dụ "Mình sẽ đọc tài liệu của skill trước để làm đúng định dạng.").
- Một bước có thể gồm nhiều công cụ: việc không phụ thuộc nhau (đọc nhiều skill hay nhiều tệp tham khảo, nhiều lượt tìm web, mở nhiều trang) thì gọi cùng lúc trong một bước, không gọi lần lượt từng cái.
- Có kết quả rồi thì nói ngắn điều vừa tìm thấy trước khi làm bước tiếp theo.
- Việc có từ 3 bước trở lên: gọi update_plan để hiện danh sách việc và cập nhật khi xong từng bước.
- Nếu có khối <user_followup>: đó là tin người dùng nhắn thêm khi bạn đang làm. Ghép yêu cầu đó vào việc đang làm (ưu tiên nếu nó đổi yêu cầu), nói ngắn rằng bạn đã nhận và sẽ làm thế nào, rồi làm tiếp — không bỏ dở việc trước.
- Câu trả lời cuối: nhật ký làm việc và danh sách việc được thu gọn khi xong, nên câu trả lời cuối là phần tổng kết cho người dùng đọc: kết quả chính (sản phẩm, con số, tệp), điều đáng chú ý khi làm, và điều chưa làm được hay cần người dùng quyết; không kể lại từng bước.
</working_out_loud>`;
// Gói chạy qua CLI (Claude Code, Codex, Antigravity, Grok) gọi công cụ của Synchro qua cầu nối MCP "synchro".
const BRIDGE_CLIS = new Set(["claude", "codex", "agy", "grok"]);
// Antigravity (-p): công cụ dựng sẵn của nó cần duyệt nên bị tự chặn (lượt dừng sau câu dẫn) — nói trước để model dùng ngay công cụ của
// Synchro thay vì thử công cụ của agy rồi mới được nhắc (tin đầu "tóm tắt video YouTube" từng dừng ở "Mình sẽ lấy phụ đề qua lệnh script").
const AGY_NOTE = (web: boolean, image: boolean) => `
Ở đây công cụ dựng sẵn của Antigravity bị chặn: run_command (lệnh / script), write_to_file, view_file, list_dir, read_url_content, read_browser_page, browser_subagent${web ? "" : ", search_web"}. Gọi chúng thì lượt dừng ngay, chưa làm được gì — đừng gọi. Chỉ dùng công cụ mcp_synchro_…: mở và đọc trang web (cả video YouTube: mở trang video, đọc tiêu đề, mô tả, bản chép lời) bằng mcp_synchro_browser_navigate rồi mcp_synchro_browser_read / mcp_synchro_browser_text; chạy code bằng mcp_synchro_run_code.${web ? " Tìm web được dùng search_web." : ""}${image ? " Tạo ảnh chỉ bằng mcp_synchro_generate_image, không dùng image-generator của Antigravity: chỉ công cụ đó mới giao được ảnh tới người dùng." : ""}${AGY_WAIT_NOTE}`;
// Grok CLI: công cụ MCP nằm sau search_tool / use_tool, tên đầy đủ là synchro__<tên>; công cụ dựng sẵn (shell, đọc / sửa tệp) bị tắt.
const GROK_NOTE = ", tên đầy đủ là synchro__<tên> (ví dụ synchro__load_skill): tìm bằng search_tool nếu cần, gọi bằng use_tool với đúng tên đó. Công cụ dựng sẵn của Grok (shell, đọc / sửa tệp) đã tắt ở đây";
// image: Synchro Code không có generate_image, đừng nhắc tới công cụ không tồn tại.
const CLI_TOOLS_NOTE = (cli: string, web: boolean, image: boolean) => `<synchro_tools>
Các công cụ nói ở trên (load_skill, read_skill_file, search_skills, run_skill_script, run_code, ${image ? "generate_image, " : ""}read_ref, update_plan, browser_* và công cụ của connector) nằm trong máy chủ MCP "synchro"${cli === "claude" ? ", gọi bằng tên có tiền tố mcp__synchro__ (ví dụ mcp__synchro__load_skill)" : cli === "agy" ? ", gọi bằng tên có tiền tố mcp_synchro_ (ví dụ mcp_synchro_load_skill)" : cli === "grok" ? GROK_NOTE : ""}. Dùng chúng đúng như mô tả; không cần công cụ nào khác để làm việc với skill, tệp hay dữ liệu của người dùng. Thư mục làm việc của CLI có thể chỉ cho đọc: đó không phải lý do để từ chối tạo tệp — tệp (Word, Excel, PowerPoint, PDF, ảnh, video…) tạo bằng run_code của Synchro, ghi vào outputs/. Máy chạy CLI (shell, công cụ dựng sẵn của bạn) không phải nơi làm việc: mọi lệnh và chương trình (ffmpeg, LibreOffice, Chromium…) chạy trong run_code.${cli === "agy" ? AGY_NOTE(web, image) : ""}
</synchro_tools>`;
// Artifact model viết giữa lượt (trước khi gọi công cụ — vd. viết bộ slide rồi check_artifact): lời dẫn chỉ giữ 4000 ký tự, không dựng
// artifact và không thuộc câu trả lời cuối, nên bộ slide từng hiện thành mã CSS thô rồi mất hẳn, check_artifact cũng không thấy.
// Tách artifact khỏi lời dẫn, giữ trong lượt (read_artifact / check_artifact đọc được), rồi đặt vào đầu câu trả lời cuối.
const ART_BLOCK = /<artifact\b[^>]*>[\s\S]*?(?:<\/artifact>|$)/gi;
function sayOut(x: Exec | null | undefined, text: string) {
  let t = scrubServerPaths(text.trim());
  if (x && hasArtifacts(t)) t = t.replace(ART_BLOCK, (b) => {
    (x.turnArts ??= []).push(b);
    const title = /\btitle\s*=\s*"([^"]*)"/i.exec(b)?.[1];
    return `_(Đã viết ${title ? `“${title}”` : "artifact"}, xem ở câu trả lời)_`;
  }).trim();
  if (t) progress("say", t);
}
// Câu trả lời cuối đã viết lại trọn một artifact thì bỏ các bản cùng identifier viết giữa lượt (bản sửa mode="patch" thì vẫn cần bản gốc).
const withTurnArts = (x: Exec | null | undefined, text: string) => {
  const full = new Set(splitArtifacts(text).flatMap((g) => (g.kind === "art" && !g.art.patch ? [g.art.ident] : [])));
  const fresh = (x?.turnArts ?? []).filter((b) => !text.includes(b) && !splitArtifacts(b).some((g) => g.kind === "art" && full.has(g.art.ident)));
  return fresh.length ? `${fresh.join("\n\n")}\n\n${text}` : text;
};
/** Một lời gọi công cụ từ CLI qua cầu nối: giữ lời dẫn trước đó, ghi công cụ và kết quả vào nhật ký, ghép tin nhắn thêm vào kết quả. */
async function bridgeCall(x: Exec, name: string, input: Record<string, unknown>, usedAll: ToolRun["used"][], cancel?: AbortSignal) {
  // Claude Code: chờ luồng đầu ra tới lời gọi này để đoạn chữ ngay trước đó (vd. bản sửa artifact) đã nằm trong liveNow().
  if (x.toolSync) await awaitToolUse();
  sayOut(x, liveNow());
  deltaStep();
  const c = unwrapConn(x, { id: `mcp_${randomToken(8)}`, name, input });
  // Thông tin riêng của lời gọi qua cầu nối: lúc bắt đầu (cả lúc chờ duyệt lẫn lúc chạy phải nằm gọn trong hạn của CLI), tín hiệu CLI hủy lời gọi.
  (x.calls ??= new Map()).set(c.id, { at: Date.now(), cancel });
  // Công cụ connector cần hỏi: lời gọi của CLI chờ ở đây (thẻ duyệt trong khung chat), rồi trả kết quả cho model như mọi công cụ khác.
  const decisions: Record<string, Decision> = needsAsk(x, c) && !x.task ? { [c.id]: await askConnector(x, c) } : {};
  let res: ToolRun | null = null;
  const m: unknown[] = [];
  const cap: Adapter = { step: async () => { throw new Error("không dùng"); }, results: (_calls, r) => { res = r[0]; return []; } };
  await execute(cap, m, x, [c], usedAll, decisions).finally(() => x.calls?.delete(c.id));
  const follow = (m.find((v) => (v as { role?: string }).role === "user") as { content?: unknown } | undefined)?.content;
  const r = (res as Run | null) ?? { content: "Không có kết quả.", is_error: true };
  return { content: String(r.content) + (typeof follow === "string" ? `\n\n${follow}` : ""), is_error: r.is_error, ...((r as Run).image ? { image: (r as Run).image, mime: (r as Run).mime, more: (r as Run).more } : {}) };
}
// Thẻ duyệt công cụ connector trong lượt chạy qua CLI (cùng cơ chế với hỏi dùng trình duyệt): CLI giữ lời gọi công cụ trong lúc chờ.
// Chờ tối đa 10 phút rồi coi như chưa được phép; bấm Dừng thì thôi chờ ngay.
const ASK_WAIT = 10 * 60_000;
const ASK_LATE = "__late__", ASK_TYPED = "__typed__";
// Người dùng nhắn thêm khi thẻ đang chờ: công cụ không chạy, model đọc tin nhắn (ghép ngay sau kết quả này) rồi quyết định lại.
const TYPED = "Người dùng vừa nhắn thêm thay vì trả lời thẻ duyệt nên công cụ này chưa chạy. Đọc tin nhắn của họ ngay sau đây rồi làm theo; nếu vẫn cần công cụ thì gọi lại với tham số đúng theo tin nhắn đó.";
// Sau khi được duyệt phải còn ít nhất chừng này để công cụ chạy.
const TOOL_MIN = 60_000;
const CALL_CANCELLED = "CLI đã hủy lời gọi này nên công cụ chưa chạy.";
const REFUSED = "Người dùng đã từ chối cho dùng công cụ này ở lượt này. Đừng thử lại bằng cách khác; hãy cho họ biết bạn cần quyền này để làm tiếp.";
const askOf = (x: Exec, c: Call, id: string): Ask => {
  const ct = x.sess!.get(c.name)!;
  const a: Ask = {
    id, kind: "connector", tool: ct.tool.name, key: `conn:${ct.fq}`, title: ct.tool.title || ct.tool.annotations?.title || ct.tool.name, detail: "",
    conn: { name: ct.cname, logo: ct.logo, color: ct.color, ...(ct.icon && ct.icon.length < 1500 ? { icon: ct.icon } : {}) },
    about: (ct.tool.description ?? "").slice(0, 300), destructive: destructiveLike(ct.tool),
  };
  // Sự kiện của lượt giữ tối đa 6000 ký tự: cắt ngang JSON thì thẻ không hiện được và lượt treo tới hết giờ.
  const full = c.input && Object.keys(c.input).length ? JSON.stringify(c.input, null, 2) : "";
  for (let n = full.length; ; n = Math.floor(n * 0.7)) {
    a.detail = n >= full.length ? full : `${full.slice(0, n)}\n… (còn ${full.length - n} ký tự không hiện ở đây)`;
    if (JSON.stringify(a).length <= 5900 || !n) return a;
  }
};
async function askConnector(x: Exec, c: Call): Promise<Decision> {
  // Nhiều lời gọi song song: hỏi lần lượt, để "Cho phép trong đoạn chat này" ở thẻ trước khỏi phải hỏi lại ở thẻ sau.
  const prev = x.asking ?? Promise.resolve();
  let release = () => {};
  x.asking = new Promise<void>((ok) => { release = ok; });
  await prev;
  const deny = (why: string): Decision => { (x.denied ??= new Map()).set(c.id, why); return "deny"; };
  try {
    const meta = x.calls?.get(c.id);
    if (meta?.cancel?.aborted) return deny(CALL_CANCELLED);
    if (!needsAsk(x, c)) return "allow";
    // Tin nhắn thêm chưa tới model (vừa gửi, hay thẻ trước vừa khép vì nó): model chưa biết người dùng muốn gì thì chưa hỏi duyệt tiếp.
    if (inboxWaiting()) return deny(TYPED);
    if (!currentRun()) return deny("Công cụ này cần người dùng duyệt nhưng lượt này không có khung chat để hỏi nên chưa chạy. Hãy báo người dùng nhắc lại yêu cầu trong khung chat để Synchro hỏi, hoặc đổi quyền công cụ thành \"Luôn cho phép\" trong Cài đặt → Connectors.");
    // Lời gọi của CLI gồm cả lúc chờ duyệt: chừa đủ thời gian để công cụ còn chạy được trước khi CLI tự cắt (nhiều thẻ song song thì thẻ sau còn ít thời gian hơn).
    const room = meta ? BRIDGE_CALL_MAX - (Date.now() - meta.at) - TOOL_MIN : ASK_WAIT;
    if (room <= 0) return deny("Lời gọi này đã chờ quá lâu nên công cụ chưa chạy. Hãy gọi lại nếu vẫn cần.");
    const id = newAskId();
    const run = runSignal();
    const stops = [run, meta?.cancel].filter((v): v is AbortSignal => !!v);
    const wait = waitAnswer(x.uid, id, stops.length > 1 ? AbortSignal.any(stops) : stops[0]);
    const late = setTimeout(() => answerAsk(x.uid, id, { ok: false, note: ASK_LATE }), Math.min(ASK_WAIT, room));
    const offMsg = onInbox(() => answerAsk(x.uid, id, { ok: false, note: ASK_TYPED }));
    progress("ask", JSON.stringify({ ...askOf(x, c, id), until: Date.now() + Math.min(ASK_WAIT, room) }));
    progress("step", "Đang chờ bạn duyệt");
    // Antigravity, Grok: lượt đang chờ người dùng thì nhả chỗ để đoạn chat khác của tài khoản này không phải xếp hàng sau nó.
    x.park?.();
    x.awaiting = (x.awaiting ?? 0) + 1;
    const a = await wait;
    x.awaiting = (x.awaiting ?? 1) - 1;
    clearTimeout(late);
    offMsg();
    const dropped = !!meta?.cancel?.aborted;
    const timedOut = a.note === ASK_LATE, typed = a.note === ASK_TYPED;
    progress("asked", JSON.stringify({ id, ok: a.ok, always: !!a.always, chat: !!a.chat, ...(timedOut || dropped ? { gone: true } : {}), ...(typed ? { typed: true } : {}) }));
    // CLI đã hủy lời gọi trong lúc chờ: không chạy dù người dùng có bấm cho phép, kết quả không còn ai nhận.
    if (dropped) return deny(CALL_CANCELLED);
    if (typed) return deny(TYPED);
    if (timedOut) return deny("Người dùng chưa trả lời yêu cầu duyệt sau 10 phút nên công cụ chưa chạy. Hãy báo họ biết; nếu vẫn cần thì nhắc lại yêu cầu để Synchro hỏi lại.");
    if (!a.ok) return deny(a.note && a.note !== "Người dùng đã dừng." ? `Người dùng từ chối công cụ này. Lời nhắn của họ: ${a.note}. Làm theo lời nhắn nếu được; đừng tìm cách khác để lách.` : REFUSED);
    if (a.always) { x.sess!.allowAlways(c.name); return "always"; }
    if (a.chat) { x.sess!.allowChat(c.name); return "chat"; }
    return "allow";
  } finally { release(); }
}
// Nút "Kết nối lại" trong khung chat: mỗi connector hiện một lần trong lượt.
function showReconnect(x: Exec, c: OfflineConn) {
  const seen = (x.connCards ??= new Set());
  if (seen.has(c.id)) return;
  seen.add(c.id);
  progress("conn", JSON.stringify({ id: c.id, name: c.name, logo: c.logo, color: c.color, auth: c.auth, ...(c.refused ? { refused: true } : {}) }));
}
// Ảnh do connector trả về: lưu thành tệp cho người dùng tải; model nhận kèm kết quả nếu là loại ảnh các hãng đọc được và không quá lớn.
const MODEL_IMG = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const IMG_ONE = 6_500_000, IMG_TOTAL = 16_000_000;
// Một kết quả không gửi quá IMG_TOTAL (mỗi ảnh tối đa IMG_ONE) cho model: giới hạn yêu cầu của các hãng.
const imagesForModel = (all: { data: string; mime: string }[]) => { let room = IMG_TOTAL; return all.filter((i) => { if (!MODEL_IMG.has(i.mime) || i.data.length > IMG_ONE || i.data.length > room) return false; room -= i.data.length; return true; }); };
const IMG_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
function connectorImage(x: Exec, ct: ChatTool, c: Call, r: { content: string; image?: string; mime?: string; more?: { data: string; mime: string }[]; imagesAll?: number }): Pick<Run, "content" | "image" | "mime" | "more"> {
  if (!r.image) return { content: r.content };
  const all = [{ data: r.image, mime: r.mime ?? "" }, ...(r.more ?? [])];
  const names: string[] = [];
  for (const i of all) {
    const data = Buffer.from(i.data, "base64");
    const saved = data.length && IMG_EXT[i.mime] ? saveOutputs(x.uid, [{ path: `${ct.tool.name.replace(/[^\w-]+/g, "_").slice(0, 60)}-${(x.outs.length + 1)}.${IMG_EXT[i.mime]}`, data }]) : [];
    x.outs.push(...saved);
    if (saved.length) names.push(`outputs/${saved[0].name} (${fmtSize(saved[0].size)}) — đã gửi cho người dùng`);
  }
  // Ảnh không gửi được cho model vẫn thành tệp của người dùng và được nói rõ.
  const send = imagesForModel(all);
  const left = all.length - send.length;
  const note = (names.length ? `\n<files>\n${names.join("\n")}\n</files>` : "") + (left ? `\n[${left}/${all.length} ảnh không kèm theo kết quả này vì quá lớn hoặc model không đọc được loại ảnh đó; đừng mô tả các ảnh đó như đã xem.]` : "") + ((r.imagesAll ?? all.length) > all.length ? `\n[Công cụ trả về ${r.imagesAll} ảnh; ${r.imagesAll! - all.length} ảnh sau không được lấy vì vượt giới hạn ${all.length} ảnh mỗi kết quả.]` : "");
  if (!send.length) return { content: r.content + note };
  (x.heavy ??= []).push(c.id);
  const [first, ...more] = send;
  return { content: r.content + note, image: first.data, mime: first.mime, ...(more.length ? { more } : {}) };
}
// ---------------------------------------------------------------- tạo ảnh bằng AI (ai/imagegen.ts)
/** Lưu ảnh thành tệp của người dùng theo hạn mức dung lượng; ảnh không còn chỗ thành thẻ "chưa giao được". */
function keepImages(uid: string, files: ImgFile[], outs: OutFile[]) {
  let room = outputsFull() ? 0 : outputRoom(uid);
  const fit = files.filter((f) => { if (f.data.length > room) return false; room -= f.data.length; return true; });
  const saved = saveOutputs(uid, fit.map((f) => ({ path: f.name, data: f.data })));
  outs.push(...saved);
  const left = files.filter((f) => !saved.some((s) => s.name === f.name));
  for (const f of left) if (!outs.some((o) => o.skipped && o.name === f.name)) outs.push({ id: `skip-${f.name}`, name: f.name, size: f.data.length, mime: "", skipped: true });
  return { saved, left };
}
const IMG_REF_MAX = 20 * 1048576;
/** Tên ảnh cuối cùng generate_image đã giao trong một câu trả lời cũ, đọc từ dấu vết công cụ trình duyệt gửi kèm lịch sử (dòng trong <files> của kết quả công cụ). */
function tracedImage(trace: unknown): string | null {
  const ok = (Array.isArray(trace) ? trace : []) as { name?: string; status?: string; summary?: string }[];
  for (const t of [...ok].reverse()) {
    if (t?.name !== IMAGE_TOOL.name || t.status !== "ok") continue;
    const names = [...String(t.summary ?? "").matchAll(/^(.+?) \([^()\n]*\) — đã gửi cho người dùng$/gm)];
    if (names.length) return names[names.length - 1][1];
  }
  return null;
}
/** Ảnh gốc của lời gọi generate_image. "last": ảnh gần nhất của đoạn chat, là ảnh vừa tạo hay ảnh người dùng gửi, tùy cái nào sau ("cho nó đội mũ" là nói ảnh vừa tạo, không phải ảnh gửi từ đầu chat).
 *  Số n: ảnh thứ n của tin gần nhất người dùng gửi ảnh. Khác: theo tên tệp trong đoạn chat (ảnh Synchro đã tạo ở lượt này hay lượt trước). */
async function refImage(x: Exec, ref: string): Promise<ImgFile | string> {
  const want = ref.trim(), msgs = (Array.isArray(x.msgs) ? x.msgs : []) as { role?: string; content?: unknown; trace?: unknown }[];
  type B = { type?: string; data?: string; media_type?: string; name?: string; source?: { data?: string; media_type?: string } };
  const made = x.outs.filter((o) => !o.skipped && o.mime.startsWith("image/")).at(-1);
  let latest: ImgFile[] = [], newest: ImgFile | undefined, stop = false;
  if (made) { const o = readOutput(x.uid, made.id); if (o) newest = { name: o.name, mime: o.mime, data: o.data }; }
  for (const m of [...msgs].reverse()) {
    if (m?.role === "assistant" && !newest && !stop) {
      const name = tracedImage(m.trace), o = name ? outputByName(x.uid, name) : null;
      if (o) newest = { name: o.name, mime: o.mime, data: o.data };
      // Ảnh vừa tạo đã hết hạn, bị xóa: nói không thấy, đừng âm thầm lấy ảnh cũ hơn.
      else if (name) stop = true;
    }
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const imgs = (m.content as B[]).flatMap((b, i) => { const d = b?.type === "image" ? b.data ?? b.source?.data : undefined; return typeof d === "string" && d ? [{ name: b.name ?? `anh-${i + 1}`, mime: b.media_type ?? b.source?.media_type ?? "", data: Buffer.from(d, "base64") }] : []; });
    if (!imgs.length) continue;
    if (!newest && !stop) newest = imgs[imgs.length - 1];
    latest = imgs;
    break;
  }
  let pick: ImgFile | undefined;
  if (/^(last|latest)$/i.test(want)) pick = newest;
  else if (/^\d+$/.test(want)) pick = latest[Number(want) - 1];
  else {
    const all = await chatFiles(msgs, x.uid, () => x.outs)().catch(() => []);
    const f = (s: string) => s.toLowerCase().normalize("NFC");
    const hit = all.filter((a) => a.mime.startsWith("image/")).find((a) => f(a.name) === f(want) || f(a.name).includes(f(want))) ?? outputByName(x.uid, want);
    if (hit) pick = { name: hit.name, mime: hit.mime, data: hit.data };
  }
  if (!pick) return `Không thấy ảnh "${want}" trong đoạn chat${latest.length ? ` (tin gần nhất có ${latest.length} ảnh)` : ""}. Hãy nhờ người dùng gửi lại ảnh; đừng tạo ảnh mới như thể đã dựa trên ảnh đó.`;
  if (pick.data.length > IMG_REF_MAX) return `Ảnh gốc quá lớn (tối đa ${IMG_REF_MAX / 1048576} MB).`;
  if (!imageKind(pick.data)) return "Ảnh gốc phải là PNG, JPEG hoặc WebP.";
  return pick;
}
async function runImage(x: Exec, c: Call): Promise<Run> {
  const used = { kind: "search" as const, name: IMAGE_TOOL.name };
  const fail = (content: string): Run => ({ content, is_error: true, used });
  const prompt = typeof c.input?.prompt === "string" ? c.input.prompt.trim() : "";
  if (!prompt) return fail("Thiếu mô tả ảnh (prompt).");
  if (prompt.length > 4000) return fail("Mô tả ảnh quá dài (tối đa 4.000 ký tự).");
  const aspect = (ASPECTS as readonly string[]).includes(String(c.input?.aspect_ratio)) ? String(c.input.aspect_ratio) : undefined;
  const count = Math.min(4, Math.max(1, Math.floor(Number(c.input?.count)) || 1));
  if (outputsFull()) return fail("Máy chủ sắp hết dung lượng đĩa nên chưa tạo ảnh được. Hãy nói rõ với người dùng và đề nghị thử lại sau.");
  if (outputRoom(x.uid) < 2 * 1048576) return fail(`Tài khoản đã dùng hết ${OUTPUT_QUOTA_MB()} MB dung lượng tệp đã tạo nên chưa lưu thêm được ảnh (tệp cũ tự xóa sau 30 ngày).`);
  let reference: ImgFile | undefined;
  // Model hay điền "" vào tham số không bắt buộc: đó là không có ảnh gốc, không phải "ảnh gần nhất".
  const refIn = String(c.input?.reference ?? "").trim();
  if (refIn) {
    const r = await refImage(x, refIn);
    if (typeof r === "string") return fail(r);
    reference = r;
  }
  const wait = imageBudget(x.uid, count);
  if (wait) return fail(`Tài khoản đã tạo nhiều ảnh trong một giờ qua. Hãy thử lại sau khoảng ${Math.ceil(wait / 60_000)} phút.`);
  // Lượt Antigravity gọi công cụ này đang giữ khóa của tài khoản, mà lượt tạo ảnh cũng cần khóa đó: CLI đã đọc xong cấu hình nên nhả được, như lúc chờ người dùng duyệt.
  x.park?.();
  const stops = [runSignal(), x.calls?.get(c.id)?.cancel].filter((v): v is AbortSignal => !!v);
  const r = await generateImages({ uid: x.uid, prompt, aspect, count, reference, signal: stops.length > 1 ? AbortSignal.any(stops) : stops[0],
    onStatus: (t) => { progress("step", t); }, onNote: (t) => { progress("note", t); } });
  if (!r.ok) {
    if (r.providers) progress("plans", JSON.stringify({ why: r.kind, tried: r.tried.filter((f) => f.kind !== "auth").map((f) => f.cli) }));
    return fail(r.text);
  }
  // Tên theo lời người dùng; nhiều ảnh trong một lượt (thiết kế nhiều ảnh) không được trùng tên: inputs/ và tham chiếu đều đi theo tên.
  const asked = requestSlug(typedText((Array.isArray(x.msgs) ? (x.msgs as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").at(-1)));
  const taken = new Set(x.outs.map((o) => o.name));
  const named = !asked ? r.files : r.files.map((f, i) => {
    const ext = /\.[^.]+$/.exec(f.name)?.[0] ?? "";
    let n = r.files.length > 1 ? i + 1 : 1, name = `${asked}${n > 1 || r.files.length > 1 ? `-${n}` : ""}${ext}`;
    while (taken.has(name)) name = `${asked}-${++n}${ext}`;
    taken.add(name);
    return { ...f, name };
  });
  const { saved, left } = keepImages(x.uid, named, x.outs);
  (x.madeImgs ??= []).push(...saved.map((f) => f.id));
  if (!saved.length) return fail(`${IMG_NAME[r.cli]} đã tạo ${r.files.length} ảnh nhưng chưa lưu được vì tài khoản đã dùng hết ${OUTPUT_QUOTA_MB()} MB dung lượng tệp đã tạo hoặc máy chủ sắp hết đĩa. Người dùng chưa nhận được ảnh nào: hãy nói rõ điều đó.`);
  const lines = saved.map((f) => `${f.name} (${fmtSize(f.size)}) — đã gửi cho người dùng`);
  const send = imagesForModel(named.filter((f) => saved.some((s) => s.name === f.name)).map((f) => ({ data: f.data.toString("base64"), mime: f.mime })));
  // CLI không phải lúc nào cũng theo đúng tỉ lệ xin: nói cho model biết để không báo sai với người dùng, nhất là ảnh sẽ đặt vào khung có sẵn của thiết kế.
  const [aw, ah] = (aspect ?? "").split(":").map(Number);
  const offRatio = aw && ah ? saved.filter((f) => f.w && f.h && Math.abs(f.w / f.h - aw / ah) / (aw / ah) > 0.08) : [];
  const notes = [...r.notes, ...(offRatio.length ? [`Xin tỉ lệ ${aspect} nhưng nhận được: ${offRatio.map((f) => `${f.name} ${f.w}×${f.h}`).join(", ")}. Nói rõ với người dùng nếu tỉ lệ quan trọng; đưa vào thiết kế thì cắt bằng object-fit, đừng kéo méo.`] : []), ...(left.length ? [`${left.length} ảnh không lưu được vì hết dung lượng: ${left.map((f) => f.name).join(", ")}.`] : []), ...(send.length < saved.length ? [`${saved.length - send.length} ảnh quá lớn nên không kèm ở đây để bạn xem (tối đa ${IMAGE_MAX_MB()} MB mỗi ảnh vẫn giao được cho người dùng); đừng mô tả các ảnh đó như đã xem.`] : [])];
  const content = `Đã tạo ${saved.length} ảnh bằng ${IMG_NAME[r.cli]}.\n<files>\n${lines.join("\n")}\n</files>${notes.length ? `\n${notes.join("\n")}` : ""}\nẢnh đã hiện thành thẻ trong khung chat (xem, phóng to, tải về): trong câu trả lời đừng chèn đường dẫn hay liên kết.\nĐưa ảnh vào sản phẩm khi người dùng cần: artifact HTML, React, SVG, slide dùng đúng địa chỉ ${saved.map((f) => genImageUrl(f.id)).join(", ")} trong src hay url(...), Synchro tự nhúng ảnh; run_code (Word, PowerPoint, PDF, video, ghép ảnh) đọc inputs/${saved.map((f) => f.name).join(", inputs/")}.`;
  if (!send.length) return { content, is_error: false, used };
  (x.heavy ??= []).push(c.id);
  const [first, ...more] = send;
  return { content, is_error: false, used, image: first.data, mime: first.mime, ...(more.length ? { more } : {}) };
}
// Tin người dùng nhắn thêm giữa chừng: ghép vào lượt đang chạy ở bước kế tiếp (sau kết quả công cụ, hoặc ngay khi model đang viết).
function addFollowup(m: unknown[], text: string) {
  const note = `<user_followup>\n${text}\n</user_followup>`;
  const last = m[m.length - 1] as { role?: string; content?: unknown };
  if (last?.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push({ type: "text", text: note });
  else if (last?.role === "user" && typeof last.content === "string") last.content = `${last.content}\n\n${note}`;
  else m.push({ role: "user", content: note });
}
/** Ghép các tin nhắn thêm đang chờ vào lượt (hiện trong nhật ký là "nhắn thêm"); trả false khi không có tin nào. */
function takeFollowups(m: unknown[]): boolean {
  const more = takeInbox();
  if (!more.length) return false;
  for (const t of more) progress("steer", t);
  addFollowup(m, more.join("\n\n"));
  return true;
}
// Tìm web cho Gemini qua khóa API: lớp tương thích OpenAI của Gemini chưa có Google Search, nên Synchro gọi API gốc của Gemini
// (cùng khóa, cùng model) với công cụ google_search và trả về câu trả lời có dẫn nguồn như một công cụ thường.
const GEMINI_WEB_TOOL = {
  name: "web_search",
  description: "Tìm thông tin mới trên web bằng Google Search. Dùng khi câu hỏi cần dữ kiện mới (tin tức, giá, lịch, phiên bản phần mềm…) hoặc điều bạn không chắc. Trả về tóm tắt kèm nguồn.",
  input_schema: { type: "object", properties: { query: { type: "string", description: "Câu tìm kiếm ngắn, cùng ngôn ngữ người dùng" } }, required: ["query"] },
};
const WEB_DESC = "Tìm thông tin mới trên web. Dùng khi câu hỏi cần dữ kiện mới (tin tức, giá, lịch, phiên bản phần mềm…) hoặc điều bạn không chắc. Trả về tóm tắt kèm nguồn.";
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
// Tìm web cho Grok / DeepSeek qua khóa API: /chat/completions của hai hãng không có công cụ tìm web phía máy chủ, nên Synchro gọi
// API Responses của chính hãng đó (cùng khóa, cùng model) với công cụ web_search và trả câu trả lời kèm nguồn như một công cụ thường.
async function responsesSearch(t: Target, query: string): Promise<ToolRun> {
  const used = { kind: "search" as const, name: "web_search" };
  if (!query.trim()) return { content: "Thiếu câu tìm kiếm.", is_error: true, used };
  try {
    const j = await responsesCall(t, { input: [{ role: "user", content: `Tìm trên web rồi tóm tắt ngắn gọn, ghi rõ nguồn: ${query.slice(0, 500)}` }], tools: [{ type: "web_search" }], max_output_tokens: 4000 }, runSignal() ?? AbortSignal.timeout(90_000)) as { output?: { type: string; content?: { type: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] }[]; citations?: unknown[] };
    const parts = (j.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
    const text = parts.map((c) => c.text ?? "").join("").trim();
    const urls = [...parts.flatMap((c) => (c.annotations ?? []).filter((a) => a.url).map((a) => ({ url: a.url!, title: a.title ?? "" }))), ...(Array.isArray(j.citations) ? j.citations : []).filter((u): u is string => typeof u === "string").map((url) => ({ url, title: "" }))];
    const src = [...new Map(urls.map((u) => [u.url, u])).values()].slice(0, 8).map((u, i) => `[${i + 1}] ${u.title} — ${u.url}`).join("\n");
    return { content: `${text || "(không có kết quả)"}\n\nNguồn:\n${src || "(không có)"}`, is_error: false, used };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { content: `Chưa tìm được trên web (${e instanceof HttpErr ? e.status : "mất kết nối"}): ${String((e as Error).message).slice(0, 200)}`, is_error: true, used };
  }
}
const searchWeb = (t: Target, query: string) => (t.kind === "google" ? geminiSearch(t, query) : responsesSearch(t, query));
async function runCall(x: Exec, c: Call, d?: Decision): Promise<Run> {
  if (c.name === "update_plan") {
    const items = (Array.isArray(c.input?.items) ? c.input.items : []).map((i: { content?: unknown; status?: unknown }) => ({ content: String(i.content ?? "").slice(0, 120), status: ["pending", "in_progress", "completed"].includes(String(i.status)) ? String(i.status) : "pending" })).slice(0, 12);
    progress("plan", JSON.stringify(items));
    return { content: "Đã cập nhật danh sách việc cho người dùng.", is_error: false, used: { kind: "search", name: "update_plan" } };
  }
  if (c.name === TASK_TOOL.name && x.task && !x.sess?.get(c.name)) return { ...(await runPropose(x.uid, x.task, c.input ?? {})), used: { kind: "search", name: c.name } };
  if (c.name === "read_ref" && !x.sess?.get(c.name)) return { ...readRef(x.uid, c.input), used: { kind: "search", name: "read_ref" } };
  if (c.name.startsWith("brain_") && !x.sess?.get(c.name)) return { ...runBrainTool(x.uid, c.name, c.input ?? {}), used: { kind: "search", name: c.name } };
  if (c.name === "web_search" && x.search && !x.sess?.get(c.name)) return searchWeb(x.search, String(c.input?.query ?? ""));
  if (c.name === "run_code" && !x.sess?.get(c.name)) { const r = await runCode(x, c.input); if (r.image) (x.heavy ??= []).push(c.id); return r; }
  if (c.name === IMAGE_TOOL.name && x.image && !x.sess?.get(c.name)) return runImage(x, c);
  if (c.name === PROJECT_DOC_TOOL.name && x.project !== undefined && !x.sess?.get(c.name)) return { ...readProjectFile(x.uid, x.project, c.input ?? {}), used: { kind: "search", name: c.name } };
  if ((c.name === "read_artifact" || c.name === "check_artifact") && x.art && !x.sess?.get(c.name)) {
    const a = findArtifact({ uid: x.uid, conv: x.conv, messages: x.art.messages, base: x.art.base, live: [...(x.turnArts ?? []), liveNow()].join("\n\n") }, typeof c.input?.identifier === "string" ? c.input.identifier : undefined);
    const used = { kind: "search" as const, name: c.name };
    if (c.name === "read_artifact") return { ...readArtifact(a, c.input ?? {}), used };
    const r = await checkArtifact(x.uid, a, c.input ?? {}, process.env.APP_URL || "https://synchro.net.nz");
    if (r.image) (x.heavy ??= []).push(c.id);
    return { ...r, used };
  }
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
      ask: (a) => { if (x.task && a.kind === "site") { queueSite(x.uid, x.task, a.host ?? "", a.detail ?? ""); answerAsk(x.uid, a.id, { ok: false, note: QUEUED }); } else if (currentRun()) { progress("ask", JSON.stringify(a)); x.park?.(); } else answerAsk(x.uid, a.id, { ok: false, note: NO_UI }); },
      asked: (id, a) => { if (currentRun()) progress("asked", JSON.stringify({ id, ok: a.ok, always: !!a.always })); } });
    const no = await x.gate.check(c.name, c.input ?? {});
    if (no) return { content: no, is_error: true, used: { kind: "search", name: c.name } };
    const r = await runBrowserTool(x.uid, c.name, c.input ?? {}, x.bctx);
    x.gate.seen(r.url);
    if (["browser_read", "browser_text", "browser_screenshot", "browser_batch"].includes(c.name)) (x.heavy ??= []).push(c.id);
    return { content: r.content, is_error: r.is_error, ...(r.image ? { image: r.image } : {}), used: { kind: "search", name: c.name } };
  }
  if (c.name === CONN_FIND && x.sess && !x.sess.get(c.name)) return { content: findConnTools(x.sess, String(c.input?.query ?? ""), String(c.input?.connector ?? ""), String(c.input?.tool ?? ""), Math.max(0, Number(c.input?.offset) || 0)), is_error: false, used: { kind: "search", name: c.name } };
  if (c.name === CONN_CALL && x.sess && !x.sess.get(c.name)) {
    const bad = resolveTool(x.sess.tools, String(c.input?.tool ?? "")) ? callArgs(c.input) : null;
    return { content: bad && "error" in bad ? bad.error : `Không có công cụ connector "${String(c.input?.tool ?? "")}". Tìm đúng tên bằng ${CONN_FIND} rồi gọi lại.`, is_error: true, used: { kind: "search", name: c.name } };
  }
  if (c.name === RECONNECT_TOOL.name && x.sess && !x.sess.get(c.name)) {
    const name = fold(String(c.input?.connector ?? "")).trim();
    const hit = x.sess.offline.find((o) => o.why !== "vendor" && (fold(o.name) === name || fold(o.name).includes(name))) ?? (x.sess.offline.length === 1 && x.sess.offline[0].why !== "vendor" ? x.sess.offline[0] : null);
    if (hit) showReconnect(x, hit);
    return { content: hit ? `Đã hiện nút "Kết nối lại" cho ${hit.name} trong khung chat. Hãy nói người dùng bấm nút rồi nhắc lại yêu cầu.` : `Không có connector "${String(c.input?.connector ?? "")}" đang chờ kết nối lại.`, is_error: !hit, used: { kind: "search", name: c.name } };
  }
  const ct = x.sess?.get(c.name);
  if (!ct) return runSkillTool(x.list, c.name, c.input, x.scripts, { uid: x.uid, net: x.net, libs: x.libs, heal: x.heal ? (input) => healScript(x.heal!, input) : undefined });
  const used = { kind: "tool" as const, name: `${ct.cname}: ${ct.tool.title || ct.tool.annotations?.title || ct.tool.name}` };
  if (x.task && x.sess!.perm(c.name) === "ask") return { content: queueTool(x.uid, x.task, c, { connector: ct.cname, title: ct.tool.title || ct.tool.annotations?.title || ct.tool.name }), is_error: true, used };
  if (d === "deny") return { content: x.denied?.get(c.id) ?? REFUSED, is_error: true, used };
  const meta = x.calls?.get(c.id), run = runSignal();
  const stops = [run, meta?.cancel].filter((v): v is AbortSignal => !!v);
  // Qua cầu nối: công cụ chỉ được chạy trong phần còn lại của hạn CLI (đã trừ lúc chờ duyệt).
  const r = await x.sess!.call(c.name, c.input, stops.length > 1 ? AbortSignal.any(stops) : stops[0], meta ? Math.min(TOOL_BUDGET, Math.max(TOOL_MIN, BRIDGE_CALL_MAX - (Date.now() - meta.at))) : undefined);
  if (r.reconnect) showReconnect(x, r.reconnect);
  return { is_error: r.is_error, ...connectorImage(x, ct, c, r), used };
}
const needsAsk = (x: Exec, c: Call) => !!x.sess?.get(c.name) && x.sess.perm(c.name) === "ask";

// Câu mô tả bước đang làm, hiện dưới "Đang suy nghĩ…" khi lượt chạy ở nền.
function describe(x: Exec, c: Call) {
  const n = String(c.input?.name ?? "");
  if (c.name === "load_skill") return n.startsWith("studio-") || n.startsWith("lib-") ? `Đang mở thư viện ${x.libs?.[n]?.[0]?.label ?? n}` : `Đang đọc skill ${n}`;
  if (c.name === "read_skill_file") return `Đang đọc tài liệu của skill ${n}`;
  if (c.name === "read_artifact") return "Đang đọc lại artifact";
  if (c.name === "check_artifact") return "Đang kiểm tra hiển thị artifact";
  if (c.name === "search_skills") return "Đang tìm skill phù hợp";
  if (c.name === "run_skill_script") return `Đang chạy script của skill ${n}`;
  if (c.name === "run_code") return `Đang chạy code ${String(c.input?.language ?? "python")}`;
  if (c.name === PROJECT_DOC_TOOL.name && x.project !== undefined) return `Đang đọc tệp dự án ${String(c.input?.file ?? "")}`.trim();
  if (c.name === IMAGE_TOOL.name && x.image) return `Đang tạo ảnh: ${String(c.input?.prompt ?? "").replace(/\s+/g, " ").slice(0, 100)}`;
  if (c.name === "web_search" && x.search) return `Đang tìm trên web: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_search") return `Đang nhớ lại: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_read") return `Đang đọc ghi chú ${String(c.input?.title ?? "").slice(0, 80)} trong bộ não`;
  if (c.name === "brain_write") return `Đang ghi vào bộ não: ${String(c.input?.title ?? "").slice(0, 80)}`;
  if (c.name === RECONNECT_TOOL.name && x.sess && !x.sess.get(c.name)) return "Đang hiện nút kết nối lại";
  if (c.name === CONN_FIND && x.sess && !x.sess.get(c.name)) return `Đang tìm công cụ connector: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (x.browse && isBrowserTool(c.name)) return describeBrowser(c.name, c.input ?? {}, browserTargetOf(c.input, x.bctx));
  const ct = x.sess?.get(c.name);
  return ct ? `Đang dùng ${ct.cname}: ${ct.tool.title || ct.tool.name}` : `Đang dùng công cụ ${c.name}`;
}
// Công cụ lấy dữ liệu (connector, chạy code, script của skill): kết quả lớn lưu theo tham chiếu và có trong dấu vết của lượt.
// Công cụ đọc skill không tính (đó là hướng dẫn, không phải dữ liệu).
const isData = (x: Exec, c: Call) => c.name === PROJECT_DOC_TOOL.name || !!x.sess?.get(c.name) || c.name === "run_code" || c.name === "run_skill_script" || c.name === IMAGE_TOOL.name;
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
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential/i;
const argLine = (input: unknown) => { try { return JSON.stringify(input ?? {}, (k, v) => (k && SECRET_KEY.test(k) ? "***" : v)).slice(0, 200); } catch { return ""; } };
// Công cụ chỉ đọc, chạy lại lượt không gây hại gì. Còn lại (connector ghi, chạy code, thao tác trình duyệt, ghi bộ não) có thể đã làm thay đổi
// gì đó: lỗi giữa chừng thì không tự chạy lại lượt, kể cả bằng model khác. connector_call ở đây là lời gọi không tìm ra công cụ hay tham số hỏng (gọi được thì đã đổi thành tên công cụ thật): chưa chạy gì.
const READ_TOOLS = new Set(["update_plan", "load_skill", "read_skill_file", "search_skills", "read_ref", "read_artifact", "check_artifact", "brain_search", "brain_read", "web_search", "connector_tools", "connector_reconnect", "connector_call", "browser_navigate", "browser_read", "browser_text", "browser_find", "browser_screenshot", "browser_scroll", "browser_wait", "browser_tabs", "browser_console", "browser_downloads"]);
function noteEffects(x: Exec, calls: Call[], d: Record<string, Decision>) {
  for (const c of calls) {
    const ct = x.sess?.get(c.name);
    // Công cụ đoán là đọc (get_, list_ không khai báo) cũng chạy không cần duyệt như công cụ đọc: đọc xong gặp lỗi CLI thì Auto vẫn đổi được model.
    if (d[c.id] === "deny" || (ct ? x.sess!.isRead(c.name) : READ_TOOLS.has(c.name))) continue;
    (x.effects ??= []).push(c.name);
    // Connector ghi, thao tác trên trang thật: máy chủ khởi động lại giữa chừng cũng không được làm lại. Chạy code nằm trong hộp cát của đoạn chat, không tính ở đây.
    if (ct || isBrowserTool(c.name)) markEffect(label(x, c));
  }
}
async function execute(ad: Adapter, m: unknown[], x: Exec, calls: Call[], used: ToolRun["used"][], d: Record<string, Decision>) {
  noteEffects(x, calls, d);
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
    const big = maybeRef(x.uid, x.conv, c.name, r.content, r.brief);
    r.content = big.content;
    const summary = (big.ref ? big.content.replace(/^<ref[^>]*>\n/, "").split("\nDữ liệu đầy đủ đã lưu")[0] : r.content).slice(0, 700);
    x.trace.push({ id: c.id, name: c.name, label: label(x, c), input: JSON.stringify(c.input ?? {}).slice(0, 300), status: d[c.id] === "deny" ? "denied" : r.is_error ? "error" : "ok", summary, ...(big.ref ? { ref: big.ref } : {}) });
  });
  used.push(...res.filter((r) => (!r.is_error || r.used.kind === "code") && r.used.kind !== "search").map((r) => r.used));
  // Kết quả từng công cụ (thành công / lỗi, tóm tắt ngắn) để dòng công cụ trong khung chat hiện đúng.
  // Công cụ ghi của connector: kèm tham số đã gửi (che khóa bí mật) để người dùng biết model vừa làm gì. Tóm tắt bỏ thẻ <ref> nội bộ.
  res.forEach((r, i) => { if (seqs[i]) progress("res", JSON.stringify({ ref: seqs[i], ok: !r.is_error, sum: plainSummary(String(r.content ?? "")).slice(0, 140), ...(x.sess?.get(calls[i].name) && !x.sess.isRead(calls[i].name) && d[calls[i].id] !== "deny" ? { args: argLine(calls[i].input) } : {}) })); });
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
    let r: Awaited<ReturnType<Adapter["step"]>>;
    try { r = await ad.step(m, i === steps - 1); }
    catch (e) {
      // Người dùng nhắn thêm khi model đang viết: giữ phần đã viết trong nhật ký, ghép tin mới rồi gọi lại model ngay.
      if (!steered()) throw e;
      sayOut(x, liveNow());
      takeFollowups(m);
      continue;
    }
    m.push(r.assistant);
    if (!r.calls.length) {
      if (r.pause) continue;
      // Tin nhắn thêm tới khi model đã viết xong câu trả lời: làm tiếp trong cùng lượt với tin mới, không chờ lượt sau.
      if (i < steps - 1 && inboxWaiting()) { sayOut(x, r.text); takeFollowups(m); continue; }
      if (!acted && nudged < MAX_NUDGE && i < steps - 1 && stalled(r.text)) { nudged++; sayOut(x, r.text); m.push({ role: "user", content: NUDGE }); continue; }
      return { text: r.text, used };
    }
    acted = true;
    r.calls = r.calls.map((c) => unwrapConn(x, c));
    // Lời dẫn trước khi dùng công cụ: giữ lại trong khung chat (bước sau không xóa mất).
    sayOut(x, r.text);
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
              tool: { name: ct.tool.name, title: ct.tool.title || ct.tool.annotations?.title || ct.tool.name, description: (ct.tool.description ?? "").slice(0, 400), destructive: destructiveLike(ct.tool) },
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

// Schema công cụ MCP → schema gửi cho model (connschema.ts). Công cụ không chuẩn hóa được thì bỏ qua và ghi log: một schema sai có thể làm hỏng cả lượt của tài khoản.
function connectorToolDefs(sess: ConnectorSession, gemini: boolean) {
  return sess.tools.flatMap((ct) => {
    const input_schema = normalizeSchema(ct.tool.inputSchema ?? {}, gemini ? "gemini" : "other");
    if (!input_schema) { console.warn(`[connector] bỏ công cụ ${ct.fq}: schema không phải object`); return []; }
    return [{
      name: ct.fq,
      description: `[${ct.cname}] ${ct.tool.title || ct.tool.annotations?.title || ct.tool.name}${ct.tool.description ? `: ${ct.tool.description}` : ""}`.slice(0, 1024),
      input_schema,
    }];
  });
}
// Connector có hàng trăm công cụ (Vercel ~240, Higgsfield ~190): gửi đủ định nghĩa mỗi lượt là hàng trăm nghìn token (đo trên máy chủ:
// 530 công cụ ≈ 465.000 token), câu đầu của đoạn chat mới chờ ~18 giây và tốn hạn mức gói. Quá ngưỡng thì model chỉ nhận danh mục tên
// công cụ trong hướng dẫn cùng hai công cụ: connector_tools (tìm, trả định nghĩa đầy đủ) và connector_call (gọi). Lời gọi qua
// connector_call được đổi thành lời gọi công cụ thật trước mọi bước kiểm tra (quyền, hỏi duyệt, dấu vết), như gọi trực tiếp.
const CONN_DIRECT_MAX = 40_000;
const CONN_FIND = "connector_tools", CONN_CALL = "connector_call";
const proxyOf = new WeakMap<ConnectorSession, boolean>();
function connProxy(s: ConnectorSession) {
  let p = proxyOf.get(s);
  if (p === undefined) { p = JSON.stringify(connectorToolDefs(s, false)).length > CONN_DIRECT_MAX; proxyOf.set(s, p); }
  return p;
}
// gemini: Gemini từ chối tham số kiểu object không khai báo thuộc tính, nên nhận tham số dạng chuỗi JSON.
const connProxyTools = (gemini: boolean) => [
  { name: CONN_FIND, description: "Tìm công cụ của các connector người dùng đã kết nối (danh mục tên ở phần connector trong hướng dẫn). Trả về tên đầy đủ, mô tả và tham số của các công cụ khớp nhất. Gọi trước connector_call khi chưa có định nghĩa của công cụ cần dùng. Cần query, hoặc tool để xem đủ định nghĩa một công cụ.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Việc cần làm hoặc tên công cụ, tiếng Anh cho khớp tên (vd. \"list deployments\", \"create page\")" }, connector: { type: "string", description: "Tên connector để chỉ tìm trong đó (vd. Vercel, Notion); bỏ trống để tìm tất cả" }, tool: { type: "string", description: "Tên đầy đủ của một công cụ để xem đủ định nghĩa (khi kết quả tìm báo là bản gọn)" }, offset: { type: "integer", description: "Xem tiếp danh sách khi query là * (kết quả có ghi offset cần dùng)" } } } },
  { name: CONN_CALL, description: "Gọi một công cụ connector bằng tên đầy đủ (dạng connector__tên, lấy từ connector_tools) với tham số đúng định nghĩa của nó.",
    input_schema: { type: "object", properties: { tool: { type: "string", description: "Tên đầy đủ của công cụ, vd. vercel__list_deployments" },
      ...(gemini ? { input_json: { type: "string", description: "Tham số của công cụ, dạng một đối tượng JSON" } } : { input: { type: "object", description: "Tham số của công cụ theo định nghĩa connector_tools trả về", additionalProperties: true } }) }, required: ["tool"] } },
];
const connTools = (s: ConnectorSession, gemini: boolean) => [...(connProxy(s) ? connProxyTools(gemini) : connectorToolDefs(s, gemini)), ...(s.offline.some((o) => o.why !== "vendor") ? [RECONNECT_TOOL] : [])];
// Người dùng nhắc tới một connector đang mất kết nối: hiện nút kết nối lại ngay từ đầu lượt.
function announceOffline(x: Exec, messages: unknown) {
  const text = fold(lastUserText(messages));
  if (!text || !x.sess) return;
  for (const o of x.sess.offline) if (o.why !== "vendor" && text.includes(fold(o.base ?? o.name))) showReconnect(x, o);
}
function unwrapConn(x: Exec, c: Call): Call {
  if (c.name !== CONN_CALL || !x.sess) return c;
  const ct = resolveTool(x.sess.tools, String(c.input?.tool ?? ""));
  if (!ct) return c;
  // Tham số hỏng thì giữ nguyên lời gọi connector_call: runCall báo lỗi cho model, không chạy công cụ với tham số rỗng.
  const a = callArgs(c.input, ct.tool.inputSchema);
  return "error" in a ? c : { id: c.id, name: ct.fq, input: a.args };
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
function findConnTools(s: ConnectorSession, query: string, connector: string, one = "", offset = 0) {
  const defs = connectorToolDefs(s, false);
  const by = new Map(defs.map((d) => [d.name, d]));
  // Xem đủ định nghĩa của đúng một công cụ (khi bản gọn đã bỏ bớt chi tiết).
  if (one) {
    const ct = resolveTool(s.tools, one);
    const d = ct && by.get(ct.fq);
    if (!d) return `Không có công cụ "${one}". Tìm đúng tên bằng ${CONN_FIND} với query.`;
    const full = JSON.stringify(d.input_schema);
    return `## ${d.name}\n${d.description}\nTham số: ${full.length <= 40_000 ? full : JSON.stringify(compactSchema(d.input_schema, 40_000).schema)}\n\nGọi bằng ${CONN_CALL} với tool là tên sau dấu ##.`;
  }
  if (!query.trim()) return `Hãy cho biết việc cần làm (query), hoặc tên công cụ (tool) để xem đủ định nghĩa.`;
  const { hits, note, more } = rankTools(s.tools.filter((t) => by.has(t.fq)), query, connector, 8, offset);
  if (!hits.length) return `${note}Không có công cụ connector nào khớp "${query}"${connector ? ` trong ${connector}` : ""}. Thử từ khóa khác (tiếng Anh, theo tên công cụ trong danh mục).`;
  return note + hits.map((ct) => {
    const d = by.get(ct.fq)!;
    const { schema, trimmed } = compactSchema(d.input_schema);
    return `## ${d.name}\n${d.description}\nTham số: ${JSON.stringify(schema)}${trimmed ? `\n(Bản gọn. Xem đủ: ${CONN_FIND} với tool="${d.name}".)` : ""}`;
  }).join("\n\n") + `\n\nGọi bằng ${CONN_CALL} với tool là tên sau dấu ##.${more ? ` Còn ${more} công cụ khác: gọi lại ${CONN_FIND} với offset=${offset + hits.length} để xem tiếp.` : ""}`;
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
function routingPrompt(hits: Hit[], recent: { name: string; lib?: Lib }[], picked: string[] = [], open?: { lib: Lib; skills: Skill[] }) {
  const picks = (open?.skills ?? []).filter((k) => !hits.some((h) => h.skill.name === k.name));
  if (!hits.length && !recent.length && !picked.length && !picks.length) return "";
  const where = (l?: Lib) => (l ? ` (thư viện ${l.label} · ${l.key})` : "");
  return `<skill_routing>
${picked.length ? `Người dùng đã tự chọn skill cho tin nhắn này (menu + ở ô chat): ${picked.join(", ")}. Bắt buộc đọc các skill này bằng load_skill trước khi trả lời và làm theo hướng dẫn trong đó.` : ""}
${hits.length ? `Hệ thống đã đối chiếu yêu cầu mới nhất với toàn bộ kho skill. Các skill có vẻ liên quan nhất (gợi ý tự động, có thể chưa đúng):
${hits.map((h) => `- ${h.skill.name}${where(h.lib)}: ${h.skill.description.replace(/\s+/g, " ").slice(0, 180)}`).join("\n")}` : ""}
${picks.length ? `Trong thư viện ${open!.lib.label} đang mở (${open!.lib.key}), các skill hợp yêu cầu này nhất:
${picks.map((k) => `- ${k.name}: ${k.description.replace(/\s+/g, " ").slice(0, 140)}`).join("\n")}` : ""}
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
  return Response.json({ model, text: withTurnArts(x, out.text), skills: out.used, files: x.outs, libs: usedLibs(x, usedNames), ...(x.trace.length ? { trace: x.trace } : {}), ...(out.cancelled ? { cancelled: true } : {}) });
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
  design: "Thiết kế (giao diện, trang web, ứng dụng, logo, banner, minh họa, chuyển động). Kết quả là artifact chạy được ngay (HTML, React hoặc SVG); ảnh chụp hay tranh đặt trong thiết kế thì tạo bằng generate_image rồi dùng đúng địa chỉ công cụ đó trả về trong src hay url(...), không để ảnh giữ chỗ.",
  slides: "Trình bày (bản trình bày, pitch deck, slide báo cáo). Kết quả mặc định là artifact HTML, mỗi slide một <section class=\"slide\"> 16:9 (Synchro tự lo chuyển slide, trình chiếu, xuất PDF), ảnh minh họa tạo bằng generate_image rồi dùng đúng địa chỉ công cụ đó trả về; khi người dùng cần tệp PowerPoint thì tạo .pptx bằng run_code, ảnh đã tạo nằm ở inputs/.",
  docs: "Tài liệu (báo cáo, đề xuất, kế hoạch, thư, quy trình). Kết quả mặc định là artifact Markdown trình bày đẹp; khi người dùng cần Word hoặc PDF thì tạo tệp bằng run_code. Markdown không hiện ảnh: tài liệu cần ảnh do AI tạo thì làm Word / PDF bằng run_code (ảnh đã tạo nằm ở inputs/) hoặc artifact HTML.",
};
// Thư viện lớn hơn số này thì available_skills chỉ có skill chọn lọc đầu thư viện (studioListed), skill hợp yêu cầu của từng lượt đi ở skill_routing (studioPicks), phần còn lại tìm bằng search_skills.
const STUDIO_DIRECT = 20;
const STUDIO_RULES = (s: Studio, plugins: string[], n: number) => `<studio name="${s}">
Người dùng đang ở chế độ ${STUDIO_TASK[s]}
${n ? `Bạn có thư viện ${n} skill chuyên môn${plugins.length ? ` (từ ${plugins.slice(0, 6).join(", ")})` : ""}${n > STUDIO_DIRECT ? `: available_skills chỉ có một phần thư viện, skill hợp nhất với yêu cầu mới nhất (nếu có) nằm trong skill_routing cạnh tin nhắn. Chưa thấy skill hợp thì gọi search_skills với từ khóa và library="studio-${s}" để tìm trong cả thư viện` : " trong available_skills"}. Trước khi làm, tự chọn 1-3 skill hợp nhất với yêu cầu và gọi load_skill để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.` : "Chưa có thư viện skill cho studio này: dùng kiến thức chuyên môn tốt nhất của bạn."}
Đừng hỏi lại người dùng về phong cách, màu sắc, bố cục hay giọng văn: hãy tự đưa ra lựa chọn có chủ đích, nhất quán và đẹp, rồi làm luôn bản hoàn chỉnh. Chỉ hỏi khi thiếu thông tin không thể tự đoán (ví dụ tên thương hiệu thật).
Sau sản phẩm, nêu ngắn gọn 2-3 quyết định chính bạn đã chọn và gợi ý hướng chỉnh sửa.
</studio>`;

// Mục "studio-…" trong available_skills của chat thường: mở ra là danh sách skill của thư viện kèm cách dùng.
const STUDIO_WHEN: Record<Studio, string> = {
  design: "thiết kế giao diện, trang web, landing page, ứng dụng, logo, banner, poster, minh họa, bảng màu, font, chuyển động / animation, UX",
  slides: "bản trình bày, slide, pitch deck, thuyết trình, báo cáo dạng slide",
  docs: "viết tài liệu, đề xuất, báo cáo, kế hoạch, thư, thông báo nội bộ, quy trình, văn bản cần trình bày đẹp",
};
// Nội dung chỉ dựng khi model mở thư viện. Cả thư viện dài quá CAT_BODY_MAX thì chỉ liệt kê skill chọn lọc: skill của danh mục Claude đứng sau theo tên thư viện,
// không theo độ hợp với yêu cầu, liệt kê tới hết giới hạn chỉ là ~10.000 token phần lớn không liên quan. Phần còn lại tìm bằng search_skills.
function studioIndex(s: Studio, plugins: string[], lib: Skill[], curated = lib.length): Skill {
  const body = () => {
    const line = (k: Skill) => `- ${k.name}: ${k.description.slice(0, 220)}`;
    const fits = lib.reduce((n, k) => n + line(k).length, 0) <= CAT_BODY_MAX;
    const lines: string[] = [];
    let size = 0;
    for (const k of fits ? lib : lib.slice(0, curated)) {
      const l = line(k);
      if (size + l.length > CAT_BODY_MAX) break;
      lines.push(l); size += l.length;
    }
    if (lines.length < lib.length) lines.push(`- … và ${lib.length - lines.length} skill nữa: gọi search_skills với từ khóa của việc cần làm và library="studio-${s}" để tìm trong cả thư viện.`);
    return `${STUDIO_RULES(s, plugins, lib.length)}

Thư viện gồm ${lib.length} skill (gọi load_skill với đúng tên để đọc skill bạn chọn):
${lines.join("\n")}`;
  };
  return indexSkill(`studio-${s}`, `Thư viện ${lib.length} skill chuyên môn cho ${STUDIO_WHEN[s]}. Khi yêu cầu thuộc loại này, gọi load_skill("studio-${s}") trước để chọn skill phù hợp trong thư viện.`, body);
}
// Bấm nút studio mà thư viện lớn: phần liệt kê trong prompt cố định, không phụ thuộc tin nhắn. Phần này nằm ở đầu prompt: đổi theo từng câu là mất bộ đệm của cả prompt lẫn lịch sử phía sau,
// đoạn chat mới không dùng lại được phần đầu của đoạn chat khác, và gói qua CLI phải gửi lại cả khối skill mỗi lượt. Không sắp theo số lần dùng vì số đó đổi theo từng lượt.
const studioListed = (st: ReturnType<typeof studioSkills>) => (st.skills.length <= STUDIO_DIRECT ? st.skills : st.skills.slice(0, Math.min(st.curated, STUDIO_DIRECT)));
// Skill hợp nhất với yêu cầu mới nhất (cùng cách chấm với định tuyến), đi ở skill_routing cạnh tin nhắn. Luôn chừa chỗ cho skill khớp trong danh mục Claude,
// để việc mà thư viện chọn lọc không có vẫn thấy skill đúng. Không có skill khớp thì không thêm gì: mỗi dòng ở đây còn lại trong lịch sử của đoạn chat.
const STUDIO_PICKS = 8, CATALOG_SLOTS = 4;
function studioPicks(typed: string, st: ReturnType<typeof studioSkills>): Skill[] {
  if (st.skills.length <= STUDIO_DIRECT) return [];
  const own = new Set(st.skills.slice(0, st.curated));
  const hits = rank(typed, st.skills.map((skill) => ({ skill, weight: own.has(skill) ? 1 : 0.5 })), STUDIO_PICKS * 3).map((h) => h.skill);
  const cat = hits.filter((k) => !own.has(k)).slice(0, CATALOG_SLOTS);
  return [...hits.filter((k) => own.has(k)).slice(0, STUDIO_PICKS - cat.length), ...cat];
}
// Plugin không gắn studio: một mục "lib-…" mô tả plugin và tên các skill bên trong. Plugin nhỏ (≤ 2 skill) hiện thẳng từng skill.
function libIndex(l: { slug: string; name: string; description: string; skills: Skill[] }): Skill {
  const names = l.skills.map((k) => k.name);
  // Nội dung chỉ dựng khi model mở thư viện: thư viện chung có thể có hàng nghìn thư viện, phần lớn không được mở trong một lượt.
  const body = () => `<library name="${l.slug}">
Thư viện skill của plugin ${l.name}. Chọn 1-3 skill hợp nhất với yêu cầu, gọi load_skill với đúng tên để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.
</library>

Thư viện gồm ${l.skills.length} skill:
${l.skills.map((k) => `- ${k.name}: ${k.description.slice(0, 220)}`).join("\n")}`;
  return indexSkill(`lib-${l.slug}`, `${l.description.slice(0, 240)} Thư viện ${names.length} skill: ${names.slice(0, 14).join(", ")}${names.length > 14 ? "…" : ""}. Khi yêu cầu liên quan, gọi load_skill("lib-${l.slug}") trước để chọn skill phù hợp.`, body);
}
// Thư viện cài từ danh mục skill của Claude: gom theo mục ngành nghề như thư mục của Claude, mỗi mục một dòng "cat-…" trong prompt
// (cả danh mục ~3.100 thư viện, liệt kê từng thư viện là hàng trăm nghìn token). Mở mục → danh sách thư viện của mục; mở thư viện → skill.
const CAT_BODY_MAX = 30_000;
function catIndex(key: string, label: string, ls: { slug: string; name: string; description: string; skills: Skill[] }[]): Skill {
  const n = ls.reduce((a, l) => a + l.skills.length, 0);
  const body = () => {
    const lines: string[] = [];
    let size = 0;
    for (const l of ls) {
      const line = l.skills.length <= 3 ? `- ${l.name}: ${l.description.slice(0, 140)} — skill: ${l.skills.map((k) => k.name).join(", ")}` : `- lib-${l.slug} (${l.name}, ${l.skills.length} skill): ${l.description.slice(0, 140)}`;
      if (size + line.length > CAT_BODY_MAX) { lines.push(`- … và ${ls.length - lines.length} thư viện nữa: gọi search_skills với từ khóa của việc cần làm để tìm trong cả mục.`); break; }
      lines.push(line); size += line.length;
    }
    return `<category name="${key}">
Mục ${label}: ${ls.length} thư viện, ${n} skill (danh mục skill của Claude). Chọn thư viện hoặc skill hợp nhất với yêu cầu: gọi load_skill("lib-…") để xem skill trong thư viện, hoặc load_skill với tên skill để đọc thẳng. Không thấy thứ phù hợp thì gọi search_skills.
</category>

${lines.join("\n")}`;
  };
  // Mô tả ngắn: cả 55 mục cùng nằm trong prompt (Claude cũng chỉ dành ~1% ngữ cảnh cho phần liệt kê skill).
  const top = ls.slice(0, 3).map((l) => l.name.slice(0, 24));
  return indexSkill(`cat-${key}`, `${label}: ${ls.length} thư viện, ${n} skill (${top.join(", ")}${ls.length > 3 ? "…" : ""})`, body);
}
const indexSkill = (name: string, description: string, body: string | (() => string)): Skill => {
  let b = typeof body === "string" ? body : null;
  return { id: name, user_id: "studio", name, description, get body() { return (b ??= (body as () => string)()); },
    storage_path: "", enabled: true, version: 1, versions: [1], created_at: "", updated_at: "", files: [], warnings: [], projects: [], use_count: 0, last_used_at: null, source: null };
};

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
  // Chỉ chữ người dùng gõ: từ khóa nằm trong tệp đính kèm không được kéo theo skill và studio không liên quan.
  const typed = typedText((Array.isArray(messages) ? (messages as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").pop());
  // Skill của studio luôn có khi người dùng chủ động bấm nút studio. Skill cá nhân trùng tên được ưu tiên.
  // Thư viện lớn: prompt chỉ có phần cố định; cả thư viện vẫn nằm trong list (ẩn) để load_skill và search_skills dùng được.
  const direct = st ? studioListed(st) : [];
  const names = new Set<string>();
  for (let i = 0; i < list.length; i++) { if (names.has(list[i].name)) list.splice(i--, 1); else names.add(list[i].name); }
  for (const k of direct) if (!names.has(k.name)) { names.add(k.name); list.push(k); }
  // Mọi thư viện đã cài đều tự dùng được: mỗi studio là một mục "studio-…", mỗi plugin khác là một mục "lib-…" trong available_skills.
  // Model tự mở thư viện khi việc cần tới (load_skill), rồi chọn skill cụ thể bên trong. Prompt chỉ thêm một dòng mỗi thư viện,
  // các skill trong thư viện không chiếm chỗ cho tới khi được mở. Khi bấm nút studio, thư viện của studio đó đã mở sẵn.
  const visible = [...list];
  const hidden = (ks: Skill[]) => { for (const k of ks) if (!names.has(k.name)) { names.add(k.name); list.push(k); } };
  // Một skill có thể nằm trong nhiều thư viện (theme-factory ở cả Thiết kế và Trình bày): giữ đủ để gán đúng thư viện đã mở.
  const libs: Record<string, Lib[]> = {};
  // Skill của danh mục Claude: lớp dự phòng rộng; khi cùng hợp, skill người dùng tự cài / studio được ưu tiên trong gợi ý định tuyến.
  const catSkills = new Set<Skill>();
  const tag = (lib: Lib, ks: Skill[]) => { libs[lib.key] = [lib]; for (const k of ks) (libs[k.name] ??= []).push(lib); };
  if (studio) {
    tag({ key: `studio-${studio}`, label: STUDIO_LABEL[studio] }, st!.skills);
    // Thư viện đang bấm không có mục lục riêng trong prompt: mọi yêu cầu đều thuộc thư viện này nên mô tả "mở trước" sẽ khiến model đọc mục lục ở mọi lượt. Lối xem phần chưa liệt kê là search_skills (STUDIO_RULES).
    if (direct.length < st!.skills.length) hidden(st!.skills);
  }
  if (skills && can(c.user, "skills") && skillsOn(c.user)) {
    for (const s of STUDIOS) {
      const lib = s === studio ? null : studioSkills(c.user.id, s);
      if (!lib?.skills.length) continue;
      visible.push(studioIndex(s, lib.plugins, lib.skills, lib.curated));
      hidden(lib.skills);
      tag({ key: `studio-${s}`, label: STUDIO_LABEL[s] }, lib.skills);
    }
    const cats = new Map<string, { slug: string; name: string; description: string; skills: Skill[] }[]>();
    for (const l of libraryPlugins(c.user.id)) {
      const fresh = l.skills.filter((k) => !names.has(k.name));
      // Như thư mục của Claude, một thư viện nằm ở mọi mục của nó (mục chính trước), với đủ skill — kể cả skill Synchro đã xếp thêm
      // vào một studio (Tài liệu / Trình bày / Thiết kế).
      const lc = dirCats(l.catalogId);
      if (lc.length) {
        tag({ key: `lib-${l.slug}`, label: l.name }, l.skills);
        const idx = libIndex(l);
        // Mọi skill của danh mục đều tính nhẹ trong định tuyến, kể cả skill đã xếp vào một studio (nằm ngoài fresh): không để hàng trăm skill của danh mục chen trước thư viện chọn lọc.
        for (const k of [idx, ...l.skills]) catSkills.add(k);
        for (const cat of lc) { const g = cats.get(cat) ?? []; cats.set(cat, g); g.push(l); }
        hidden([idx]); hidden(fresh); continue;
      }
      if (!fresh.length) continue;
      tag({ key: `lib-${l.slug}`, label: l.name }, fresh);
      if (fresh.length <= 2) { visible.push(...fresh); hidden(fresh); continue; }
      visible.push(libIndex({ ...l, skills: fresh }));
      hidden(fresh);
    }
    const label = new Map(PLUGIN_CATS.map((x) => [x.key, x.label]));
    for (const [key, ls] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
      const idx = catIndex(key, label.get(key) ?? key, ls);
      visible.push(idx); names.add(idx.name);
      libs[idx.name] = [{ key: idx.name, label: label.get(key) ?? key }];
    }
  }
  // Không có gì để liệt kê thì không có công cụ skill: giữ một mục để model vẫn tìm được trong thư viện đang bấm.
  if (studio && !visible.length && st!.skills.length) visible.push(studioIndex(studio, st!.plugins, st!.skills, st!.curated));
  // Định tuyến: chấm điểm toàn bộ kho skill theo yêu cầu mới nhất. Skill có ở nhiều thư viện được gán vào thư viện
  // mà các gợi ý khác cùng thuộc về (đề xuất dự án → Tài liệu, không phải Trình bày).
  let route = "";
  const prefer: Record<string, string> = {};
  if (list.length) {
    // Yêu cầu thuộc rõ một studio ("làm slide thuyết trình" → Trình bày): skill của studio đó được cộng thêm, skill của danh mục Claude
    // giảm bớt, để thư viện chọn lọc đứng trước hàng nghìn skill na ná của danh mục.
    const want = ruleStudios("", typed).scores;
    const inStudio = (k: Skill) => (libs[k.name] ?? []).some((l) => l.key.startsWith("studio-") && want[l.key.slice(7) as Studio] > 0);
    const raw = suggest(typed, list.map((k) => ({ skill: k, weight: (catSkills.has(k) ? 0.5 : 1) * (inStudio(k) ? 1.3 : 1) })));
    const votes = new Map<string, number>();
    for (const h of raw) for (const l of libs[h.skill.name] ?? []) votes.set(l.key, (votes.get(l.key) ?? 0) + h.score / (libs[h.skill.name]!.length));
    // Skill ở nhiều thư viện (Synchro tự xếp một skill vào 2–3 mục) mà phiếu ngang nhau: nghiêng về mục chính câu yêu cầu nói tới
    // ("làm slide thuyết trình" → Trình bày). Điểm nhỏ, chỉ để phân định khi gần bằng nhau.
    const intent = want;
    for (const k of STUDIOS) if (intent[k] > 0) votes.set(`studio-${k}`, (votes.get(`studio-${k}`) ?? 0) + intent[k] * 0.01);
    const pick = (n: string) => (libs[n] ?? []).slice().sort((a, b) => (votes.get(b.key) ?? 0) - (votes.get(a.key) ?? 0))[0];
    const hits = raw.map((h) => ({ ...h, lib: pick(h.skill.name) }));
    for (const h of hits) if (h.lib) prefer[h.skill.name] = h.lib.key;
    const recentNames = Array.isArray(body.recentSkills) ? [...new Set((body.recentSkills as unknown[]).filter((n): n is string => typeof n === "string"))].slice(0, 6) : [];
    const recent = recentNames.filter((n) => list.some((k) => k.name === n) && !hits.some((h) => h.skill.name === n)).map((n) => ({ name: n, lib: libs[n]?.[0] }));
    // Skill người dùng tự chọn ở menu + (tên skill, hoặc lib-… để mở cả thư viện): chỉ nhận tên có trong kho đang bật.
    const known = new Set([...list.map((k) => k.name), ...Object.values(libs).flat().map((l) => l.key)]);
    const picked = Array.isArray(body.pickedSkills) ? [...new Set((body.pickedSkills as unknown[]).filter((n): n is string => typeof n === "string" && known.has(n)))].slice(0, 8) : [];
    route = routingPrompt(hits, recent, picked, studio ? { lib: libs[`studio-${studio}`][0], skills: studioPicks(typed, st!) } : undefined);
  }
  return { list, visible, libs, prefer, route };
}

type Who = { user: UserRow };
// Quy tắc thiết kế theo việc đang làm (designkit.ts): đi cạnh tin nhắn mới nhất như skill_routing, không vào hướng dẫn hệ thống. Không có với Synchro Code, lệnh nội bộ, artifact có AI.
function designOf(body: Record<string, any>, caps: { art: boolean; code: boolean } | null, studio: string | null, conv?: string): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!caps || !body.skills || body.feature === "code" || body.feature === "artifact") return "";
  const typed = typedText((Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").pop());
  const d = designTurn({ typed, studio, art: caps.art, code: caps.code, ack: isAck(typed), seed: conv, prior: historyTexts(body.messages, body.artBase) });
  if (d) console.log(`[design] ${d.format} ${d.domain} ${d.own ? "own-brand" : d.preset}${d.compact ? " follow-up" : ""} ${d.bytes}B`);
  return d?.block ?? "";
}
// Bộ nhớ chỉ dùng cho lượt chat chính (không cho Code, artifact, lệnh nội bộ), khi nút "Bộ nhớ" bật và không ở chế độ ẩn danh.
// Những gì Synchro biết về người dùng (tên, phần tự giới thiệu / hướng dẫn ở Cài đặt → Tài khoản, bộ nhớ khi bật): mọi lượt người dùng
// trò chuyện (chat, Synchro Code), kể cả ẩn danh (khi đó không kèm bộ nhớ); không áp dụng cho lời gọi nội bộ (đặt tên, rút bộ nhớ…)
// và artifact có AI.
const useProfile = (body: Record<string, any>) => !!body.skills && body.feature !== "artifact"; // eslint-disable-line @typescript-eslint/no-explicit-any
const contextOf = (body: Record<string, any>, u: UserRow) => (useProfile(body) ? userContext(u, { memory: useMemory(body, u) }) : ""); // eslint-disable-line @typescript-eslint/no-explicit-any
// Bộ não tổng hợp: kéo vài ghi chú liên quan nhất tới câu hỏi vào tầng động (chat lẫn Synchro Code; không trong đoạn chat ẩn danh / khi tắt Bộ nhớ).
// Câu chào, cảm ơn không có gì để nhớ lại. Đo riêng để biết phần chuẩn bị của lượt nằm ở đâu.
const recallOf = (body: Record<string, any>, u: UserRow, conv?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!useProfile(body) || body.memory === false || body.incognito || routeTask(routeInput(body)) === "chat") return "";
  const t0 = Date.now(), out = brainRecall(u.id, lastUserText(body.messages), conv);
  if (Date.now() - t0 > 20) console.log(`[timing] chat recall=${Date.now() - t0}ms`);
  return out;
};
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
/** Lượt này đi đường nhanh được không: chat thường, không tệp, không skill tự chọn, không dự án hay hướng dẫn riêng, phiên của CLI chưa từng gọi công cụ, và câu hỏi rõ ràng không cần công cụ. */
function fastTurn(body: Record<string, any>, user: UserRow, cli: NonNullable<ReturnType<typeof subCli>>, conv?: string): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (process.env.SYNCHRO_FAST_CHAT === "0" || body.noFast || !body.skills || body.feature === "code" || body.feature === "artifact" || body.project || body.studio || taskOf(body)) return false;
  if ((body.system && body.system !== DEFAULT_SYSTEM) || (Array.isArray(body.pinned) && body.pinned.length) || (Array.isArray(body.pickedSkills) && body.pickedSkills.length)) return false;
  return needsNoTools(routeInput(body)) && !mentionsConnector(user.id, body.messages) && !/\bref_[\w-]{6,}/.test(JSON.stringify(body.messages ?? "")) && sessionPlain(user.id, conv, cli);
}
// Câu ngắn nhắc tên connector của chính người dùng ("Notion của mình có gì mới?") là việc cần connector, dù trông như câu hỏi nhỏ: đường nhanh không có công cụ, cũng không có nút kết nối lại khi connector mất đăng nhập.
function mentionsConnector(uid: string, messages: unknown) {
  const text = fold(lastUserText(messages));
  return !!text && listConnectors(uid).some((c) => { const n = fold(c.name); return n.length >= 3 && text.includes(n); });
}
const DEFAULT_SYSTEM = "Bạn là một trợ lý AI hữu ích.";
/** Giữ chữ đầu của đường nhanh tới khi chắc đó không phải NEED_TOOLS (dấu hiệu này không được hiện cho người dùng). */
function holdNeedTools(out?: (t: string) => void) {
  let buf = "", open = false;
  return (t: string) => {
    if (open) { out?.(t); return; }
    buf += t;
    const s = buf.trimStart();
    if (NEED_TOOLS.startsWith(s) || s.startsWith(NEED_TOOLS)) return;
    open = true; out?.(buf);
  };
}
// CLI vừa treo hoặc lỗi phía hãng với tài khoản này: chế độ Tự động tránh trong 5 phút (không gói nào khác thì vẫn dùng). Giữ trong bộ nhớ: khởi động lại thì thử lại từ đầu.
const STALL_MS = 5 * 60_000;
const stalls = new Map<string, number>();
export const noteStall = (uid: string, cli: string) => { if (stalls.size > 5000) stalls.clear(); stalls.set(`${uid}:${cli}`, Date.now() + STALL_MS); };
export const clearStall = (uid: string, cli: string) => { stalls.delete(`${uid}:${cli}`); };
export const stalledModels = (uid: string, models: string[]) => models.filter((k) => { const cli = subCli(k); return !!cli && (stalls.get(`${uid}:${cli}`) ?? 0) > Date.now(); });
const prewarmed = new Map<string, number>();
/** Mở trang: khởi động sẵn tiến trình cho câu chào đầu tiên của người dùng, đúng model và hướng dẫn đường nhanh sẽ dùng. Mỗi người tối đa một lần mỗi phút; không tốn lượt nào của gói. */
export async function prewarmChat(user: UserRow) {
  if (process.env.SYNCHRO_FAST_CHAT === "0") return;
  const now = Date.now();
  if (now - (prewarmed.get(user.id) ?? 0) < 60_000) return;
  if (prewarmed.size > 2000) prewarmed.clear();
  prewarmed.set(user.id, now);
  try { warmRecall(user.id); } catch {}
  const { usable } = await usableModels(user);
  const body = { skills: true, feature: "chat" };
  const pc = capsState(user).caps;
  if (!pc) return;
  const system = [`${topRule(user.id)}\n\n${DEFAULT_SYSTEM}`, FAST_RULES, contextOf(body, user)].filter(Boolean).join("\n\n");
  // Hai kiểu câu mở đầu hay gặp nhất: câu chào, câu hỏi (nỗ lực thấp) và nhờ viết ngắn (nỗ lực vừa). Tiến trình gắn chặt với model và nỗ lực nên mỗi kiểu một tiến trình; cùng model và mức thì chỉ một.
  const seen = new Set<string>();
  for (const text of ["xin chào", "viết email xin nghỉ phép"]) {
    const r = routeModel({ text, attachments: 0, turns: 1, studio: false }, usable);
    if (!r || subCli(r.model) !== "claude" || seen.has(`${r.model}|${r.effort}`)) continue;
    seen.add(`${r.model}|${r.effort}`);
    prewarmClaude({ user, model: r.model, effort: r.effort, system });
  }
}
const useMemory = (body: Record<string, any>, _u: UserRow) => !!body.skills && body.feature !== "code" && body.feature !== "artifact" && body.memory !== false && !body.incognito; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Một lượt gọi model: body là JSON trình duyệt gửi lên /api/llm. scope.feature được đặt lại theo loại lượt (tính mức dùng).
 *  model = "auto": Synchro chọn model theo độ khó của yêu cầu (router.ts) trong các model tài khoản được dùng, rồi chạy như bình thường. */
export async function chatPost(body: Record<string, any>, c: Who, scope: { feature: string }): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Tệp của các lượt trước đi cùng lịch sử: model nào trả lời lượt này (kể cả model vừa đổi) cũng thấy đúng tài liệu đang bàn.
  if (Array.isArray(body.messages)) body = { ...body, messages: await expandFileRefs(body.messages, lastUserText(body.messages), c.user.id) };
  if (typeof body.resume === "string") return chatTurn(body, c, scope);
  if (body.model !== AUTO) return withSwitch(await chatTurn(body, c, scope), body, c.user, [String(body.model)]);
  // Chọn trong đúng các model bộ chọn model đang hiện: nhóm của hãng đang dùng gói subscription thì chọn model của gói,
  // không tự chuyển sang khóa API (tierOf xếp hạng được cả "sub-claude/opus", "sub-claude/haiku"…). Gói hết hạn mức thì không chọn.
  const { allowed, usable, groups } = await usableModels(c.user);
  const blocked = new Set(allowed.filter((k) => !usable.includes(k)));
  // Tên model như ở bộ chọn model ("Claude Sonnet 4.5"), không phải mã thô ("claude-sonnet-4-5-20250929").
  const shown = (k: string) => groups.flatMap((g) => g.models).find((m) => m.key === k)?.name ?? k.split("/").pop();
  const q = routeInput(body);
  const r = routeModel(q, usable.length ? usable : allowed, { avoid: stalledModels(c.user.id, usable.length ? usable : allowed) });
  if (!r) return Response.json({ error: "Tài khoản của bạn chưa được dùng model nào. Hãy liên hệ quản trị viên." }, { status: 403 });
  // Nỗ lực: người dùng để "Tự động" (hoặc chưa chọn) thì theo độ khó của việc; chọn tay thì giữ lựa chọn đó.
  const effort = body.effort === "auto" || !isEffort(body.effort) ? r.effort : body.effort;
  progress("note", `Tự động chọn ${shown(r.model)} · việc ${taskLabel(r.task)} · nỗ lực ${effortLabel(effort)}`);
  const fromSub = !!subCli(r.model);
  // Còn model của CLI khác để chuyển thì không chờ lâu khi tài khoản đang chạy lượt Antigravity / Grok khác; không còn thì chờ như chọn tay.
  const auto = r.alt.some((k) => !blocked.has(k) && !!subCli(k) && subCli(k) !== subCli(r.model));
  let res = await chatTurn({ ...body, model: r.model, effort }, c, scope, { auto });
  let used = r.model;
  const tried = [r.model];
  // Model lỗi / quá tải / hết hạn mức / cần đăng nhập lại / treo: thử lần lượt các model dự phòng (ưu tiên hãng khác) mà người dùng không phải
  // làm gì. Gói subscription chỉ chuyển sang gói khác, không tự sang khóa API (luôn hỏi người dùng trước khi dùng khóa API).
  // Không bao giờ chạy lại khi lượt đã làm việc không đọc được kết quả (gửi thư, chạy code…): trả phần đã có để người dùng quyết.
  const out = new Set<string>();
  while ([409, 429, 500, 502, 503, 504, 529].includes(res.status) && !turnSignal()?.aborted && tried.length < 5) {
    const j0 = (await res.clone().json().catch(() => ({}))) as { usageLimit?: boolean; partialWork?: boolean; quota?: string; planLimit?: string; rate?: boolean; stalled?: boolean; busy?: boolean };
    // Treo, lỗi phía hãng: nhớ vài phút. Mỗi tin nhắn tiếp theo từng chọn lại đúng model đang treo, chờ thêm 60-90 giây rồi mới chuyển.
    if ((j0.stalled || res.status === 504 || res.status >= 500) && !j0.busy && !j0.usageLimit && subCli(used)) noteStall(c.user.id, subCli(used)!);
    if (j0.usageLimit || j0.partialWork) break;
    // Hết hạn mức riêng của một model thì các model khác cùng gói vẫn thử được; lỗi khác (đăng nhập, treo, hết cả gói) thì bỏ cả CLI đó trong lượt này.
    if (j0.quota !== "model" && subCli(used)) out.add(subCli(used)!);
    const fresh = new Set((await usableModels(c.user).catch(() => ({ usable: [] as string[] }))).usable);
    const next = r.alt.find((k) => !tried.includes(k) && fresh.has(k) && (!fromSub || !!subCli(k)) && !out.has(subCli(k) ?? ""));
    if (!next) break;
    const why = j0.quota || j0.planLimit ? "đã hết hạn mức" : j0.rate ? "đang giới hạn tốc độ" : res.status === 409 ? "cần đăng nhập lại" : j0.busy ? "đang chạy lượt khác" : j0.stalled || res.status === 504 ? "không phản hồi" : "đang gặp lỗi";
    progress("note", `${shown(used)} ${why}, chuyển sang ${shown(next)}`);
    deltaStep();
    used = next; tried.push(next);
    res = await chatTurn({ ...body, model: next, effort }, c, scope, { auto: true });
  }
  if (res.status === 200 && subCli(used)) clearStall(c.user.id, subCli(used)!);
  const j = await (await withSwitch(res, body, c.user, tried)).json().catch(() => ({}));
  // Hết hạn mức ở mọi gói đã kết nối: nói thẳng là hết cả và lúc sớm nhất có lại (thẻ lỗi hiện giờ theo múi giờ của người dùng), đừng để người dùng tưởng đổi gói khác là được.
  if (res.status === 429 && (j.planLimit || j.quota)) {
    const now = await usableModels(c.user).catch(() => null);
    if (now && !now.usable.length && now.plansOut.count > 1) { j.error = "Các gói đã kết nối đều đã hết hạn mức."; if (now.plansOut.resets) j.resetsAt = now.plansOut.resets; delete j.switchTo; }
  }
  return Response.json({ ...j, model: j.model ?? used, ...(res.status !== 200 && tried.length > 1 ? { tried: tried.map(shown) } : {}), auto: { tier: r.tier, vendor: r.vendor, task: r.task, effort, why: r.why, ...(used !== r.model ? { fallback: used } : {}) } }, { status: res.status });
}
// Lỗi của gói mà còn model của gói khác dùng được: gợi ý sẵn để người dùng đổi bằng một lần bấm (máy chủ thật không có khóa API để đề nghị thay).
async function withSwitch(res: Response, body: Record<string, any>, user: UserRow, tried: string[]): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (![409, 429, 500, 502, 503, 504, 529].includes(res.status) || !body.skills || body.feature === "artifact" || !subCli(tried[0])) return res;
  const j = (await res.clone().json().catch(() => null)) as { usageLimit?: boolean; quota?: string } | null;
  if (!j || j.usageLimit) return res;
  const { usable, groups } = await usableModels(user).catch(() => ({ usable: [] as string[], groups: [] as { models: { key: string; name: string }[] }[] }));
  const cli = subCli(tried[tried.length - 1]);
  const list = usable.filter((k) => !tried.includes(k) && !!subCli(k) && (j.quota === "model" || subCli(k) !== cli));
  const next = routeModel(routeInput(body), list);
  if (!next) return res;
  return Response.json({ ...j, switchTo: { model: next.model, name: groups.flatMap((g) => g.models).find((m) => m.key === next.model)?.name ?? next.model.split("/").pop() } }, { status: res.status });
}
// Giờ hiện tại đặt cạnh tin nhắn mới nhất (như gợi ý định tuyến skill): hướng dẫn hệ thống giữ nguyên để đọc từ bộ đệm, phiên nối tiếp vẫn biết đúng giờ.
function nowBlock(body: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!useProfile(body)) return "";
  const at = (timeZone?: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date());
  const tz = typeof body.tz === "string" && body.tz.length <= 64 ? body.tz : "";
  try { return `<current_time>${at(tz || undefined)}${tz ? ` (${tz})` : ""}</current_time>`; }
  catch { return `<current_time>${at()}</current_time>`; }
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
  // Lời nhờ gần nhất: bỏ qua các câu chỉ xác nhận, trả lời ngắn ở giữa ("Làm trang web" → "ok" → "màu xanh nhé").
  let prevAsk: string | undefined;
  for (let i = users.length - 2; i >= 0 && i >= users.length - 8; i--) {
    const t = typedText(users[i]);
    if (!t) continue;
    prevAsk ??= t;
    if (!isAck(t)) { prevAsk = t; break; }
  }
  // Tin ngay trước là thẻ hỏi lại: thẻ một câu chỉ gửi đúng chữ của lựa chọn ("Phương án 2"), nên phải nhìn tin của model mới biết đó là câu trả lời.
  const lastAi = [...msgs].reverse().find((m) => m?.role === "assistant");
  const aiText = typeof lastAi?.content === "string" ? lastAi.content : Array.isArray(lastAi?.content) ? (lastAi!.content as { text?: string }[]).map((x) => x?.text ?? "").join("\n") : "";
  return { text: typedText(lastUser), attachments, turns: msgs.length, studio: !!studioOf(body.studio), images, files, docChars,
    prev: typeof body.prevModel === "string" ? body.prevModel : null, prevAsk, answeredAsk: /```ask\b/.test(aiText), asked: askedBack(aiText) };
}

/** o.auto: chế độ Tự động còn model khác để chuyển: không chờ lâu khi tài khoản đang bận lượt khác. */
async function chatTurn(body: Record<string, any>, c: Who, scope: { feature: string }, o: { auto?: boolean } = {}): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const T0 = Date.now();
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
  const system: string = useProfile(body) ? `${topRule(c.user.id)}\n\n${body.system || DEFAULT_SYSTEM}` : body.system;
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
    const fast = !!pc && !am && fastTurn(body, c.user, subCli(model)!, typeof conv === "string" && conv.length <= 64 ? conv : undefined);
    const planSys = fast ? FAST_RULES : pc ? [QUALITY_RULES, feature !== "code" ? ASK_RULES : "", pc.art ? ARTIFACT_RULES(pc.ai) : "", pc.inl ? VIZ_RULES : ""].filter(Boolean).join("\n\n") : "";
    // Công cụ của Synchro cho gói (Claude Code, Codex, Antigravity): skill, thư viện plugin, connector, chạy code, dữ liệu đã lưu, danh sách việc —
    // CLI gọi qua cầu nối MCP nội bộ, mở riêng cho lượt này và đóng khi xong.
    const cli = subCli(model)!;
    const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
    let bridge: { url: string; close: () => void; alive: () => number; park: () => void; onPark: (f: () => void) => void; pendingJobs: () => { id: string; name: string }[] } | null = null, x: Exec | null = null, sess: ConnectorSession | null = null, toolSys = "", route = "";
    const usedAll: ToolRun["used"][] = [];
    let bridged = 0;
    const webs = new Map<string, { title: string; url: string }>();
    // Ảnh Antigravity tự tạo ở lượt đường nhanh (chưa có Exec).
    const natOuts: OutFile[] = [];
    // Trình duyệt chỉ gửi 60 tin gần nhất: số tin đã cắt bớt, để so nối tiếp phiên CLI với số tin thật.
    const cut = typeof body.histTotal === "number" && Array.isArray(messages) && body.histTotal > messages.length ? body.histTotal - messages.length : 0;
    try {
      if (pc && !am && !fast && BRIDGE_CLIS.has(cli)) {
        const studio = can(c.user, "skills") ? studioOf(body.studio) : null;
        const st = studio ? studioSkills(c.user.id, studio) : null;
        const t1 = Date.now();
        const ss = await skillSet(c.user, body, messages, studio, st);
        console.log(`[timing] chat skillset=${Date.now() - t1}ms (${ss.list.length} skill)`);
        route = ss.route;
        if (can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length && !sess.offline.length) sess = null; }
        const code = pc.code;
        const refs = !!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(messages));
        // Công cụ và hướng dẫn trình duyệt luôn có khi tính năng bật (phần đầu prompt ổn định, đọc lại từ bộ đệm).
        const browse = !!pc.browse && feature !== "artifact";
        const bst = capsState(c.user);
        const task = taskOf(body);
        // Đọc lại / tự kiểm tra artifact (Artifacts bật): kiểm tra hiển thị cần Chromium của workspace.
        const arts = !!pc.art, check = arts && runner() === "workspace";
        // Tạo ảnh: lượt chat thường của mọi model, gói nào đăng nhập thì công cụ tự chọn (Synchro Code có cách làm việc riêng).
        const image = feature !== "code";
        const pdocs = feature !== "code" && !!project && projectDocsLong(c.user.id, project);
        const tools = [...(pdocs ? [PROJECT_DOC_TOOL] : []), ...(task ? [TASK_TOOL] : []), ...(code ? [runCodeTool(pc.net, !!pc.web)] : []), ...(arts ? [READ_ARTIFACT_TOOL] : []), ...(check ? [CHECK_ARTIFACT_TOOL] : []), ...(ss.visible.length ? skillTools(ss.visible.length, code) : []), ...(sess ? connTools(sess, cli === "agy") : []), ...(refs ? [READ_REF_TOOL] : []), ...(brainOn(body, c.user) ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), ...(image ? [IMAGE_TOOL] : []), PLAN_TOOL];
        const xx: Exec = { project: pdocs ? project : undefined, image, msgs: messages, toolSync: subCli(model) === "claude", list: [...ss.visible, ...ss.list.filter((k) => !ss.visible.includes(k))], scripts: code, sess, uid: c.user.id, code, net: pc.net, web: !!pc.web, art: arts ? { messages, base: body.artBase } : undefined, outs: [], libs: ss.libs, studio: studio ? ss.libs[`studio-${studio}`][0] : undefined, prefer: ss.prefer, trace: [], conv: convId, browse, task, bctx: browse ? { def: task ? taskBrowser(task) : browserDefault(bst), synchro: !bst.locks.browse, user: bst.locks.mine !== "admin", scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => xx.outs) } : undefined };
        x = xx;
        announceOffline(xx, messages);
        bridge = openBridge({ uid: c.user.id, tools: tools as { name: string; description: string; input_schema: unknown }[], ...(cli === "agy" ? { hold: BRIDGE_HOLD.agy } : {}), call: (name, input, cancel) => { bridged++; return bridgeCall(xx, name, input, usedAll, cancel); }, route: sess && connProxy(sess) ? (name, input) => { const ct = resolveTool(sess!.tools, name); return ct ? { name: CONN_CALL, input: { tool: ct.fq, input } } : null; } : undefined });
        xx.park = bridge.park;
        toolSys = [studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : "", code ? CODE_RULES(pc.net, !!pc.web) : "", image ? IMAGE_RULES : "", pdocs ? PROJECT_DOC_RULES : "", arts ? ARTCHECK_RULES(check) : "", skillsPrompt(ss.visible, code), sess ? connectorsPrompt(sess, connProxy(sess)) : "", CLI_TOOLS_NOTE(cli, body.web === true, image), NARRATE_RULES, brainOn(body, c.user) ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : ""].filter(Boolean).join("\n\n");
      }
      // Gợi ý định tuyến skill đổi theo từng tin nhắn: đặt cạnh tin nhắn mới nhất, không trong hướng dẫn hệ thống. Hướng dẫn hệ thống giữ
      // nguyên từng chữ giữa các lượt và các đoạn chat thì model đọc lại từ bộ nhớ đệm (~15.000 token): câu đầu của đoạn chat mới từng
      // chờ hơn 10 giây chỉ để đọc lại phần này.
      const say0 = am ? undefined : fast ? holdNeedTools(live()) : live();
      // Antigravity trả cả câu trả lời một lần nên làm sạch được ngay; CLI khác làm sạch ở câu trả lời cuối (đường dẫn có thể bị cắt giữa hai đoạn chữ).
      const say = say0 && cli === "agy" ? (t: string) => say0(scrubServerPaths(t)) : say0;
      const turnMsgs = am ?? withRecall(withRecall(messages, recallOf(body, c.user, convId)), [route, fast || !pc ? "" : designOf(body, { art: !!pc.art, code: !!pc.code }, can(c.user, "skills") ? studioOf(body.studio) : null, convId), nowBlock(body)].filter(Boolean).join("\n\n"));
      const turn = (msgs: unknown, fresh = false) => subTurn({
        user: c.user, model, system: am ? ARTIFACT_SYSTEM : [system || (planSys || toolSys ? "Bạn là một trợ lý AI hữu ích." : ""), planSys, toolSys, contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n"),
        ephemeral: body.incognito === true, messages: msgs, conv: am ? undefined : convId, effort: isEffort(wanted) ? wanted : wanted === "auto" ? autoEffort(routeInput(body)) : undefined, signal: turnSignal(), onDelta: say, onToolUse: am ? undefined : toolUseSeen,
        older: typeof body.olderDigest === "string" ? body.olderDigest.slice(0, 8000) : undefined, fast, awaitingUser: () => !!x?.awaiting, mcp: bridge ? { url: bridge.url, alive: bridge.alive, onPark: bridge.onPark } : undefined, web: !fast && body.web === true, fresh,
        total: Array.isArray(msgs) ? msgs.length + cut : undefined, lockMs: o.auto ? 10_000 : undefined,
        onStatus: am ? undefined : (t) => { progress("step", t); },
        onNativeImages: am ? undefined : (files) => { keepImages(c.user.id, files, x?.outs ?? natOuts); },
        // Tìm web bằng công cụ dựng sẵn của CLI: hiện trong nhật ký làm việc như công cụ khác, nguồn gửi kèm kết quả.
        onSearch: am ? undefined : (q) => { const seq = progress("tool", q.url ? `Đang đọc trang ${q.url.slice(0, 120)}` : q.query ? `Đang tìm trên web: ${q.query.slice(0, 120)}` : "Đang tìm trên web"); if (seq) progress("res", JSON.stringify({ ref: seq, ok: true })); },
        onSources: am ? undefined : (items) => { for (const s of items) if (webs.size < 12 && !webs.has(s.url)) webs.set(s.url, s); },
      });
      // Bấm Dừng: CLI trả về mọi chữ đã viết trong lượt, kể cả các câu dẫn đã nằm trong nhật ký làm việc (ghép lại thành một đoạn dài
      // không dấu cách, trông như câu trả lời cụt rồi dừng). Câu trả lời chỉ giữ phần của bước đang viết dở, như lượt chạy bằng khóa API.
      const once = async (msgs: unknown, fresh = false) => {
        console.log(`[timing] chat prep=${Date.now() - T0}ms (skill, ngữ cảnh, bộ nhớ trước khi gọi model)`);
        const r = await turn(msgs, fresh);
        return r.status === 200 && (r.json as { cancelled?: boolean }).cancelled ? { ...r, json: { ...(r.json as Record<string, unknown>), text: liveNow() } } : r;
      };
      // Lỗi tạm thời của CLI (không phải đăng nhập, hạn mức, quá giờ hay người dùng bấm Dừng) khi chưa kịp dùng công cụ nào: thử lại một
      // lần ở phiên mới kèm toàn bộ lịch sử (nối tiếp phiên ngay sau lượt trước có lúc hỏng) — tin nhắn nào cũng phải chạy được.
      const pause = (ms: number) => new Promise<void>((ok) => { const sig = turnSignal(), t = setTimeout(ok, ms); sig?.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
      const tryOnce = async (msgs: unknown) => {
        const before = bridged;
        let res = await once(msgs);
        if (bridged !== before || turnSignal()?.aborted) return res;
        const j = res.json as { rate?: boolean; retryAfterMs?: number | null; noRetry?: boolean };
        // Giới hạn tốc độ: chờ đúng thời gian hãng bảo rồi thử lại một lần. Chờ lâu quá (hoặc Tự động còn model khác) thì trả về luôn.
        if (j.rate) {
          const wait = j.retryAfterMs ?? 5000;
          if (wait > (o.auto ? 8000 : 30_000)) return res;
          progress("step", `Đang chờ ${Math.ceil(wait / 1000)} giây rồi thử lại`);
          await pause(wait);
          if (turnSignal()?.aborted) return res;
          deltaStep();
          return once(msgs);
        }
        // Lượt treo, hoặc đang bận lượt khác: thử lại chỉ khiến người dùng chờ thêm chừng ấy.
        if (res.status >= 500 && res.status !== 504 && !j.noRetry) {
          // Đường nhanh lỗi: lượt đầy đủ bên dưới tự thử lại, không thử thêm ở đây.
          if (fast) return res;
          await pause(1500);
          if (turnSignal()?.aborted) return res;
          // Chữ của lần thử trước (nếu có) không nối vào chữ của lần này.
          deltaStep();
          res = await once(msgs, true);
        }
        return res;
      };
      type J = { text?: unknown; denied?: string[]; error?: unknown; cancelled?: boolean };
      let hist = turnMsgs as unknown[];
      let r = await tryOnce(hist);
      // Đường nhanh không đủ: model báo cần công cụ, hoặc CLI lỗi (kể cả phiên cũ không nhận lượt không công cụ). Chưa có chữ nào tới người dùng: chạy lượt đầy đủ.
      const needFull = () => fast && !turnSignal()?.aborted && ((r.status === 200 && String((r.json as J).text ?? "").trim().startsWith(NEED_TOOLS)) || (r.status >= 500 && r.status !== 504 && !(r.json as { noRetry?: boolean }).noRetry));
      if (needFull()) { deltaStep(); return chatTurn({ ...body, noFast: true }, c, scope, o); }
      // good: câu trả lời tốt gần nhất — lượt nhắc / tin nhắn thêm sau đó có lỗi thì vẫn giữ phần đã trả lời.
      let good: typeof r | null = null;
      // Lượt của CLI xong mà còn tin nhắn thêm chưa đọc: làm tiếp ngay trong cùng phiên của CLI (không chờ lượt sau). Gói mới báo
      // "Mình sẽ…" mà chưa gọi công cụ nào của Synchro: nhắc làm tiếp (stall.ts). agy tự chặn công cụ: nhắc dùng công cụ được phép.
      for (let k = 0, nudged = 0, nd = 0; k < 6 && !am && r.status === 200; k++) {
        good = r;
        const j = r.json as J;
        // Người dùng đã dừng: không nhắc làm tiếp, không ghép tin nhắn thêm (tin đó được gửi thành lượt mới).
        if (j.cancelled) break;
        const said = String(j.text ?? "");
        const more = takeInbox();
        let next: string;
        if (more.length) { for (const t of more) progress("steer", t); next = `<user_followup>\n${more.join("\n\n")}\n</user_followup>`; }
        else if (j.denied?.length && nd < MAX_NUDGE) { nd++; next = DENIED_NUDGE(j.denied); }
        else if (bridge?.pendingJobs().length) next = `Còn công cụ chưa lấy kết quả (${bridge.pendingJobs().map((p) => `${p.name}: job_id ${p.id}`).join("; ")}). Gọi wait_for_result với từng job_id tới khi có kết quả thật rồi mới trả lời tiếp; đừng báo thất bại khi chưa có kết quả.`;
        else if (bridge && !bridged && nudged < MAX_NUDGE && stalled(said)) { nudged++; next = NUDGE; }
        else break;
        sayOut(x, said);
        hist = [...hist, { role: "assistant", content: said }, { role: "user", content: next }];
        r = await tryOnce(hist);
        // Tin nhắn thêm trong lúc đi đường nhanh mà cần công cụ: chạy lượt đầy đủ với cả tin nhắn đó.
        if (needFull()) { deltaStep(); return chatTurn({ ...body, messages: hist, noFast: true }, c, scope, o); }
      }
      if (r.status !== 200 && good && r.status !== 499) {
        const g = good.json as J;
        r = { status: 200, json: { ...(good.json as Record<string, unknown>), denied: undefined, text: `${String(g.text ?? "").trim()}\n\n_(${String((r.json as J).error ?? "Lượt làm tiếp bị lỗi").slice(0, 300)})_` } };
      }
      // Nhắc hết lượt mà agy vẫn tự chặn công cụ và chưa làm được gì: báo rõ (không trả mỗi câu dẫn rồi im lặng).
      const left = (r.json as J).denied;
      if (r.status === 200 && left?.length && (!String((r.json as J).text ?? "").trim() || stalled(String((r.json as J).text))))
        r = { status: 502, json: { error: `Antigravity tự chặn công cụ (${left.join(", ")}) nên lượt này chưa làm được gì. Hãy gửi lại yêu cầu hoặc chọn model khác (để Tự động thì Synchro tự chuyển model).` } };
      else if (r.status === 200 && left) r = { ...r, json: { ...(r.json as Record<string, unknown>), denied: undefined } };
      const sources = webs.size ? { webSources: [...webs.values()] } : {};
      if (!am && typeof (r.json as J).text === "string") r = { ...r, json: { ...(r.json as Record<string, unknown>), text: scrubServerPaths(String((r.json as J).text)) } };
      if (!x && r.status === 200) return Response.json({ ...(r.json as Record<string, unknown>), ...sources, ...(natOuts.length ? { files: natOuts } : {}) });
      // Như lượt khóa API: skill / thư viện đã dùng, tệp đã tạo, dấu vết công cụ (lượt sau model nào cũng biết đã làm gì).
      const names = usedAll.filter((u) => u.kind === "skill").map((u) => u.name);
      if (x && r.status === 200) recordUse(c.user.id, names);
      // Lỗi giữa chừng (hết hạn mức, treo…): phần đã viết, tệp đã tạo, dấu vết công cụ không bị bỏ; partialWork: đã làm việc không chạy lại được.
      if (r.status !== 200) {
        const partial = am ? "" : scrubServerPaths(liveNow() || String((r.json as J).text ?? ""));
        return Response.json({ ...(r.json as Record<string, unknown>), ...sources, ...(partial.trim() ? { text: withTurnArts(x, partial) } : { text: undefined }), ...(x?.outs.length || natOuts.length ? { files: x?.outs ?? natOuts } : {}), ...(x?.trace.length ? { trace: x.trace } : {}), ...(usedAll.length ? { skills: usedAll, libs: usedLibs(x!, names) } : {}), ...(x?.effects?.length ? { partialWork: true } : {}) }, { status: r.status });
      }
      return Response.json({ ...(r.json as Record<string, unknown>), ...sources, text: withTurnArts(x, String((r.json as J).text ?? "")), skills: usedAll, files: x!.outs, libs: usedLibs(x!, names), ...(x!.trace.length ? { trace: x!.trace } : {}) });
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
  const image = !!skills && t.kind !== "mock" && feature !== "code";
  const pdocs = !!skills && t.kind !== "mock" && feature !== "code" && !!project && projectDocsLong(c.user.id, project);
  const capSys = cs ? [QUALITY_RULES, feature !== "code" ? ASK_RULES : "", cs.caps.art ? ARTIFACT_RULES(cs.caps.ai) : "", cs.caps.inl ? VIZ_RULES : "", cs.caps.code ? CODE_RULES(cs.caps.net, cs.caps.web) : "", image ? IMAGE_RULES : "", pdocs ? PROJECT_DOC_RULES : "", studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : ""].filter(Boolean).join("\n\n") : "";
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
    const prep = prepareHistory(messages, [route, cs ? designOf(body, { art: !!cs.caps.art, code: !!cs.caps.code }, studio, convId) : "", recallOf(body, c.user, convId), nowBlock(body)], mix);
    // Connector chỉ dùng trong lượt chat chính (skills = true), không dùng cho các lệnh nội bộ như tóm tắt bộ nhớ.
    if (skills && t.kind !== "mock" && can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length && !sess.offline.length) sess = null; }
    const code = !!cs?.caps.code && t.kind !== "mock";
    // read_ref: đọc dữ liệu lớn đã lưu theo tham chiếu (ở lượt này hoặc các lượt trước, kể cả khi đổi model).
    const refs = !!skills && t.kind !== "mock" && (!!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(prep.messages)));
    // "Tìm kiếm trên web" ở khung soạn: công cụ tìm web phía máy chủ của Anthropic / OpenAI; Gemini dùng web_search của Synchro
    // (Google Search qua API gốc của Gemini).
    // Grok / DeepSeek dùng web_search của Synchro (API Responses của chính hãng có công cụ tìm web).
    const synWeb = t.kind === "google" || t.kind === "xai" || t.kind === "deepseek";
    const web = !!skills && body.web === true && (t.kind === "anthropic" || t.kind === "openai" || synWeb);
    const brain = t.kind !== "mock" && brainOn(body, c.user);
    // Trình duyệt của Synchro (Cài đặt → Khả năng → Điều khiển trình duyệt): model nào cũng thao tác được trên web khi người dùng nhờ.
    // Luôn kèm khi bật, không đoán theo từng câu hỏi: công cụ nằm ở phần đầu prompt, đổi qua lại sẽ làm hỏng bộ đệm prompt.
    const browse = !!skills && t.kind !== "mock" && !!cs?.caps.browse;
    const task = skills && t.kind !== "mock" ? taskOf(body) : null;
    // Đọc lại / tự kiểm tra artifact (Artifacts bật): kiểm tra hiển thị cần Chromium của workspace.
    const arts = !!skills && t.kind !== "mock" && !!cs?.caps.art, check = arts && runner() === "workspace";
    if (visible.length || sess || code || refs || web || brain || browse || task || arts || image) {
      // Chạy script của skill chỉ khi máy chủ có nơi chạy code và người dùng bật "Chạy code và tạo tệp".
      const scripts = code;
      const sk = [capSys, arts ? ARTCHECK_RULES(check) : "", skillsPrompt(visible, scripts), sess ? connectorsPrompt(sess, connProxy(sess)) : "", skills ? NARRATE_RULES : "", brain ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : "", pinned].filter(Boolean).join("\n\n");
      const tools = [...(pdocs ? [PROJECT_DOC_TOOL] : []), ...(code ? [runCodeTool(!!cs?.caps.net, !!cs?.caps.web)] : []), ...(arts ? [READ_ARTIFACT_TOOL] : []), ...(check ? [CHECK_ARTIFACT_TOOL] : []), ...(visible.length ? skillTools(visible.length, scripts) : []), ...(sess ? connTools(sess, t.kind === "google") : []), ...(refs ? [READ_REF_TOOL] : []), ...(brain ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), ...(task ? [TASK_TOOL] : []), ...(image ? [IMAGE_TOOL] : []), ...(skills ? [PLAN_TOOL] : []), ...(web && synWeb ? [{ ...GEMINI_WEB_TOOL, description: t.kind === "google" ? GEMINI_WEB_TOOL.description : WEB_DESC }] : [])];
      // Phiên bản công cụ tìm web theo model (bản có lọc động cho dòng mới; model cũ dùng bản cơ bản).
      const webTool = { type: /(opus|sonnet)-(5|4-[6-9])|fable/.test(t.model) ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 5 };
      if (body.estimate === true) { sess?.close(); return estimate([system, capSys], [skillsPrompt(visible, scripts), sess ? connectorsPrompt(sess, connProxy(sess)) : "", JSON.stringify(tools)], pinned, prep); }
      const x: Exec = { project: pdocs ? project : undefined, image, msgs: messages, list: [...visible, ...list.filter((k) => !visible.includes(k))], scripts, sess, uid: c.user.id, code, net: !!cs?.caps.net, web: !!cs?.caps.web, art: arts ? { messages, base: body.artBase } : undefined, outs: [], libs, studio: studio ? libs[`studio-${studio}`][0] : undefined, prefer, trace: [], conv: convId, heal: scripts ? t : undefined, search: web && synWeb ? t : undefined, browse, task, bctx: browse && cs ? { def: task ? taskBrowser(task) : browserDefault(cs), synchro: !cs.locks.browse, user: cs.locks.mine !== "admin", scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => x.outs) } : undefined };
      if (sess) announceOffline(x, messages);
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
    try { text = await chatOnce(t, sys0, prep.messages, max_tokens, turnSignal(), effort, live()); }
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
