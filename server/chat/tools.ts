import "server-only";
// Phần công cụ của bộ xử lý chat (tách từ chatengine.ts, H3 bước 6a): adapter từng hãng, vòng lặp công cụ (loop / toolLoop / execute),
// từng công cụ (run_code, generate_image, web_search, trình duyệt, connector trực tiếp và qua connector_tools / connector_call), cầu nối CLI.
import { AsyncResource } from "node:async_hooks";
import { enabledSkills, recordUse } from "../skillstore";
import { notePlan, type PlanState } from "./planmerge";
import { MAX_STEPS, runSkillTool, type ToolRun } from "../skillruntime";
import { healScript } from "../skillheal";
import type { Effort } from "../../shared/catalog";
import type { Target } from "../providers";
import { ConnectorSession, RECONNECT_TOOL, type ChatTool, type OfflineConn } from "../connectors";
import { connectLinks, cxCard } from "../composio";
import { appLogo } from "../connlogos";
import { randomToken } from "../mcpauth";
import { currentTrace, span } from "../tracing";
import { awaitToolUse, currentRun, delta, deltaStep, inboxWaiting, liveNow, liveText, markEffect, progress, runSignal, steered, stepSignal, takeInbox } from "../runs";
import type { TraceItem } from "../transpile";
import { maybeRef, readRef } from "../refs";
import { normalizeSchema, resolveRefs } from "../../shared/connschema";
import { BRIDGE_CALL_MAX, destructiveLike, TOOL_BUDGET } from "../mcp";
import {
  AUTO_CHECK, autoDeckCheck, checkArtifact, checkedInTurn, checkRoundGate, findArtifact, forgetCheck, readArtifact,
  type CheckResult,
} from "../artcheck";
import { hashOf } from "../../shared/critic";
import { checkSpent, SELF_CHECK_MS, SELF_CHECK_SPENT, withinCheckBudget } from "../checkbudget";
import { artState, cleanBase, type ArtState, type ArtVersion } from "../../shared/vfs";
import { applySwaps, dropSeen, failingPatches, HEAL_ASK, healFold, patchReport, patchStats }
  from "../../shared/patchheal";
import { hasArtifacts, splitArtifacts } from "../../shared/artifacts";
import { foldFix, foldPatches } from "../../shared/turnfold";
import { typedText } from "../router";
import { recordPluginUse } from "../plugins";
import { markConvUntrusted } from "../convtrust";
import { execRun, LANGS, queueNote, queueReporter, runner, RUN_LIMITS, type Lang, type RecalcReport, type RunOutput } from "../coderun";
import { plainSummary, runBlocks } from "../../shared/runtext";
import { markGenFailed, OUTPUT_QUOTA_MB, outputByName, outputRoom, outputsFull, readOutput, removeOutput, replaceOutput, saveOutputs, type OutFile } from "../outputs";
import { mergeOuts, previewNote, previewOf } from "../runpreview";
import { totalsNote } from "../xlsxcheck";
import { docxNote } from "../docxcheck";
import { videoMotionNote } from "../videomotion";
import { type ABlock, type Citer, anthropicCall, blocksText, searchResults, effortParams, HttpErr, openaiCall, outCap, respInput, respParse, respTools, responsesCall } from "../llmcall";
import { toAnthropic, toOpenAI, toResponses } from "../llmcall";
import type { UserRow } from "../authstore";
import type { StyleTurn } from "../../shared/designrefs";
import {
  compareSheet, critiqueDesign, DESIGN_REVIEW, GATE_MS, hardOnly, MAX_ROUNDS, measuredDiffs, needsFix, pickDesignCritic,
  type Diff,
} from "../designcritic";
import { subCli } from "../ai/subs";
import { turnImages } from "../designrefs";
import type { DesignOut } from "./prompt";
import { PROJECT_DOC_TOOL, readProjectFile } from "../projectdocs";
import { stripAppliedNotes } from "../../shared/turnctx";
import { ASPECTS, generateImages, HOUR_MAX as IMAGE_HOUR_MAX, IMAGE_TOOL_NAME, imageBudget, imageName, IMG_NAME, requestSlug, type ImgErr, type ImgOk } from "../ai/imagegen";
import { IMAGE_LIMIT_NOTE, imageLimitMsg } from "../limitmsg";
import { IMG_BUDGET_MS, placeholderNote, settleBackground } from "../ai/imgbudget";
import { POSTER_TEMPLATES, posterProps, type PosterTemplate } from "../design-engine/posters/props";
import { genImageUrl, isDeck } from "../../shared/artdoc";
import { IMAGE_MAX_MB, imageKind, type ImgFile, scrubServerPaths } from "../ai/imagefiles";
import { escalateText, searchNeedsEscalation, withBrowserLock } from "../ai/webescalate";
import { checkUrl } from "../safefetch";
import { runBrainTool } from "../brain";
import { MAX_NUDGE, NUDGE, stalled } from "../stall";
import { makeGate, NO_UI, QUEUED, type Gate } from "../agentgate";
import { queueSite, queueTool, runPropose, TASK_TOOL } from "../tasktools";
import type { TaskCtx } from "../tasks";
import { answer as answerAsk, siteOf, siteRule } from "../approvals";
import { callArgs, compactSchema, rankTools, resolveTool } from "../connproxy";
import { INPUTS_MAX, runInputs } from "../runinputs";
import { browserTargetOf, chatFiles, describeBrowser, isBrowserTool, releaseBrowser, runBrowserTool, type BrowserCtx } from "../browsertools";
import { withCacheMark, lastUserText } from "./prompt";
import { type Decision, needsAsk, askConnector, usedName, cxOf, untrustedConnWrite, toolTitle, REFUSED, TOOL_MIN, callLogo, sweep, parkApproval } from "./approvals";

// ---------------------------------------------------------------- vòng lặp tool cho skill
export type Call = { id: string; name: string; input: Record<string, unknown> };
// pause: công cụ phía máy chủ của hãng (tìm web) chưa chạy xong trong một lần gọi — gửi lại để model làm tiếp.
type Step = { text: string; calls: Call[]; assistant: unknown; pause?: boolean };
// image: ảnh JPEG (base64) đi kèm kết quả công cụ, ví dụ ảnh chụp trình duyệt; mỗi hãng nhận theo cách riêng.
// mime: loại ảnh khi không phải JPEG (ảnh do connector trả về). more: các ảnh sau ảnh đầu của cùng kết quả.
// sum: dòng tóm tắt cố định cho bước công cụ trong khung chat (thay cho đoạn đầu kết quả), ví dụ "Đã chặn trang đăng nhập".
type Run = ToolRun & { image?: string; mime?: string; more?: { data: string; mime: string }[]; sum?: string };
// user: tin nhắn của Synchro gửi model giữa lượt (lời nhắc kèm ảnh) theo đúng dạng của hãng; không có thì gửi chữ.
type UserBlock = { type: "text"; text: string } | { type: "image"; media_type: string; data: string };
export type Adapter = {
  step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: Run[]) => unknown[];
  user?: (blocks: UserBlock[]) => unknown;
};
// Ảnh chụp trình duyệt cho model dùng Chat Completions / Responses: tin nhắn công cụ chỉ nhận chữ, nên ảnh đi kèm một tin người dùng ngay sau.
const SHOT = (id: string) => `Ảnh chụp màn hình trình duyệt (kết quả công cụ ${id}).`;
const shotMsgs = (calls: Call[], res: Run[]) => res.flatMap((r, i) => r.image ? [{ role: "user", content: [{ type: "text", text: SHOT(calls[i].id) }, { type: "image_url", image_url: { url: `data:${r.mime ?? "image/jpeg"};base64,${r.image}` } }, ...(r.more ?? []).map((m) => ({ type: "image_url", image_url: { url: `data:${m.mime};base64,${m.data}` } }))] }] : []);
type Skl = Awaited<ReturnType<typeof enabledSkills>>;
// Truyền chữ chỉ khi đang ở lượt chạy nền (có người theo dõi qua SSE).
export const live = () => (runSignal() ? delta : undefined);

// cite: nguồn web của lượt (tìm web phía máy chủ của hãng) để hiện chip nguồn và số trích dẫn [n] trong câu trả lời.
export const anthropicAdapter = (t: Target, system: string, skillSys: string, max_tokens: number, tools: unknown[], effort?: Effort, hist = -1, cite?: Citer): Adapter => ({
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
    if (cite) searchResults(blocks, cite);
    return {
      text: blocksText(blocks, cite),
      calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} })),
      assistant: { role: "assistant", content: blocks },
      pause: j.stop_reason === "pause_turn",
    };
  },
  results: (calls, res) => [{ role: "user", content: calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, is_error: res[i].is_error,
    content: res[i].image ? [{ type: "text", text: res[i].content }, { type: "image", source: { type: "base64", media_type: res[i].mime ?? "image/jpeg", data: res[i].image } }, ...(res[i].more ?? []).map((m) => ({ type: "image", source: { type: "base64", media_type: m.mime, data: m.data } }))] : res[i].content })) }],
  user: (blocks) => ({ role: "user", content: toAnthropic(blocks) }),
});

export const openaiAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort): Adapter => ({
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
  user: (blocks) => ({ role: "user", content: toOpenAI(blocks) }),
});

// OpenAI qua API Responses: lượt trả lời của model giữ nguyên dạng mục (items) để gửi lại ở bước sau.
export const responsesAdapter = (t: Target, system: string, max_tokens: number, tools: { name: string; description: string; input_schema: unknown }[], effort?: Effort, web = false, cite?: Citer): Adapter => ({
  step: async (msgs, noTools) => {
    // Tìm web của OpenAI (mục web_search_call): ghi vào nhật ký làm việc ngay khi mục xong.
    const seen = new Set<string>();
    const searched = (it: Record<string, unknown>) => {
      if (it.type !== "web_search_call" || seen.has(String(it.id))) return;
      seen.add(String(it.id));
      const a = it.action as { query?: string; url?: string } | undefined;
      progress("tool", a?.url && !a.query ? `Đang đọc trang web: ${a.url.slice(0, 120)}` : `Đang tìm trên web: ${String(a?.query ?? "").slice(0, 120)}`);
    };
    const r = respParse(await responsesCall(t, { instructions: system, max_output_tokens: outCap(t, max_tokens), ...effortParams(t, effort), input: respInput(msgs), tools: [...respTools(tools), ...(web ? [{ type: "web_search" }] : [])], ...(noTools ? { tool_choice: "none" } : {}) }, stepSignal(), live(), searched), cite);
    for (const it of r.items) searched(it);
    return { text: r.text, calls: r.calls, assistant: { items: r.items } };
  },
  results: (calls, res) => [...calls.map((c, i) => ({ type: "function_call_output", call_id: c.id, output: res[i].content })), ...shotMsgs(calls, res)],
  user: (blocks) => ({ role: "user", content: toResponses(blocks) }),
});

// Model giả lập (LLM_PROVIDER=mock) để thử vòng lặp khi chưa có API key.
export const mockAdapter = (skills: Skl): Adapter => ({
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
export type Lib = { key: string; label: string };
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
// patchHeal: kết quả lần nhắc gửi lại các khối sửa artifact không khớp (healPatch), ghi vào dòng [timing];
// patchFailedFirst: số khối không áp được trước lần nhắc đó (sau khi ghép thì không còn thấy).
export type Exec = {
  project?: unknown; image?: boolean; msgs?: unknown; effects?: string[]; toolSync?: boolean; list: Skl;
  scripts: boolean; sess: ConnectorSession | null; uid: string; code: boolean; net: boolean; web?: boolean;
  art?: { messages: { role: string; content: unknown }[]; base: unknown }; turnArts?: string[]; outs: OutFile[];
  outPaths?: Map<string, string>; libs?: Record<string, Lib[]>; studio?: Lib; prefer?: Record<string, string>;
  trace: TraceItem[]; conv?: string; heal?: Target; search?: Target; browse?: boolean; bctx?: BrowserCtx;
  shown?: string; heavy?: string[]; gate?: Gate; task?: TaskCtx | null; asking?: Promise<void>; awaiting?: number;
  denied?: Map<string, string>; connCards?: Set<string>; calls?: Map<string, { at: number; cancel?: AbortSignal }>;
  park?: () => void; inputsSent?: Set<string>; madeImgs?: string[]; webs?: Map<string, { title: string; url: string }>;
  edited?: Set<string>; rendered?: Set<string>; roundBrowser?: boolean; untrusted?: boolean; plan?: PlanState;
  deckGated?: boolean; held?: { text: string; at: number }; patchHeal?: "ok" | "fail"; patchFailedFirst?: number;
  /** Lượt làm sản phẩm thiết kế mới: mẫu tham chiếu và số vòng so với mẫu (designGate). */
  design?: DesignState;
};
// user, model: người dùng và model dựng (người chấm phải khác model này). shared: model dựng chạy trên khóa API của
// máy chủ (không phải gói của người dùng): chỉ sửa lỗi cứng, một vòng, không gọi người chấm. rounds: số vòng đã nhắc
// theo identifier của artifact; started: lúc vòng đầu bắt đầu (cả vòng ≤ GATE_MS); last: dấu bản đã đo gần nhất.
export type DesignState = {
  user: UserRow; model: string; conv?: string; turn: StyleTurn | null; format: string; typed: string;
  hero: "web" | "slide" | "poster" | null; forbid: boolean; shared: boolean;
  rounds: Map<string, number>; started?: number; last?: string;
};
// Nguồn web của lượt, đánh số theo thứ tự gặp (số [n] trong câu trả lời trỏ đúng chip thứ n). Tối đa 20 nguồn.
const WEB_MAX = 20;
export const citeOf = (x: Exec): Citer => (url, title = "") => {
  const w = (x.webs ??= new Map());
  const u = url.slice(0, 2000);
  if (!w.has(u)) { if (w.size >= WEB_MAX) return 0; w.set(u, { title: title.slice(0, 200), url: u }); }
  else if (title && !w.get(u)!.title) w.get(u)!.title = title.slice(0, 200);
  return [...w.keys()].indexOf(u) + 1;
};
type Out = { text: string; used: ToolRun["used"][]; cancelled?: boolean } | { approval: { id: string; calls: unknown[] } };

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
    // Phải xếp hàng (máy chủ bận, thiếu RAM, đang dựng video khác): người dùng thấy vị trí trong hàng ở dòng tiến trình NGAY TRONG LÚC chờ (dịch vụ
    // workspace gửi từng lần vị trí đổi, W23-4). AsyncResource.bind: lời gọi tới từ sự kiện của kết nối HTTP vẫn ghi vào đúng lượt (progress dùng AsyncLocalStorage).
    const waitLine = queueReporter(AsyncResource.bind((t: string) => { progress("note", t); }));
    const r = await execRun({ uid: x.uid, files: [{ path: LANGS[lang].file, data: Buffer.from(code) }, ...inp.files], argv: [...LANGS[lang].argv], net: x.net, web: x.web, keep, timeout, signal: runSignal(), recalc: true, onQueue: (q) => waitLine.push(q) });
    // Đã báo vị trí trong lúc chờ thì thôi; chỉ chờ mà không có vị trí (nơi chạy không gửi được từng bước) thì báo tóm tắt sau khi chạy.
    if (r.queue && !waitLine.shown) progress("note", queueNote(r.queue));
    const { saved, held, full } = deliver(x, r);
    const pv = await previewOf(r.files);
    // Chốt ô tổng: tổng / tổng phụ / chênh lệch ghi cứng thành số trong tệp Excel vừa tạo thì báo để model sửa thành công thức.
    const totals = r.exit === 0 ? await totalsNote(r.files).catch(() => "") : "";
    // Tự kiểm sau lần chạy thành công: tiêu đề / đoạn lặp trong tệp Word (H1 T9), chuyển động thật của video (H1 T10: video tả là động nhưng đứng yên từ giây 2).
    const docx = r.exit === 0 ? await docxNote(r.files).catch(() => "") : "";
    const motion = r.exit === 0 && !r.timedOut ? await videoMotionNote(x.uid, r.files, runSignal()).catch(() => "") : "";
    const files = saved.length ? `\n<files>\n${saved.map((f) => `outputs/${f.name} (${fmtSize(f.size)}) — đã gửi cho người dùng`).join("\n")}\n</files>` : "";
    const hold = held.length ? (r.exit === 0 && !r.timedOut ? `\n<not_delivered>\nMáy chủ sắp hết dung lượng đĩa nên các tệp này CHƯA tới người dùng: ${held.join(", ")}. Hãy nói rõ điều này với người dùng và đề nghị thử lại sau; đừng nói là đã gửi tệp.\n</not_delivered>` : `\n<not_delivered>\n${r.timedOut ? "Lần chạy quá giờ" : "Lần chạy lỗi"} nên các tệp này CHƯA tới người dùng, có thể dở dang: ${held.join(", ")}. Chúng nằm ở .last_outputs/. Sửa rồi chạy lại; tệp nào dùng được thì chép sang outputs/ ở lần chạy sau.\n</not_delivered>`) : "";
    // Tệp vượt giới hạn dung lượng: chỉ thẻ này báo được, người dùng không có thẻ tệp nào để biết là thiếu. Tệp _preview/ chỉ để model xem, không cần báo.
    const over = [...(r.skipped ?? []).filter((s) => !s.startsWith("_preview/")), ...full];
    if (r.exit === 0 && !r.timedOut) noteSkipped(x, over);
    const skip = over.length ? `\n<not_delivered>\nCác tệp này KHÔNG tới người dùng và không có thẻ tải về: ${over.join("; ")}. Giới hạn ${RUN_LIMITS.fileSize / 1048576} MB mỗi tệp, ${RUN_LIMITS.total / 1048576} MB mỗi lần chạy. Nén lại (video: -crf cao hơn, hạ bitrate âm thanh) hoặc chia nhỏ rồi chạy lại; không làm được thì phải nói rõ với người dùng là tệp chưa giao được (thẻ tệp hiện "chưa giao được").\n</not_delivered>` : "";
    // Thẻ trạng thái đứng trước log: log dài cỡ nào model vẫn thấy đã giao tệp gì, ô Excel nào lỗi, đã xem ảnh nào.
    return { ...runBlocks({ open: `<run_result language="${lang}" exit_code="${r.exit}">`, close: "</run_result>", tags: `${inputsNote(inp)}${files}${hold}${skip}${recalcNote(r.recalc)}${totals}${docx}${motion}${previewNote(pv)}`, stdout: r.stdout, stderr: r.stderr }), is_error: r.exit !== 0, used, ...(pv ? { image: pv.image } : {}) };
  } catch (e) {
    return { content: `Không chạy được code: ${(e as Error).message}`, is_error: true, used };
  }
}

// Danh sách việc cho người dùng theo dõi khi model làm việc nhiều bước (hiện như bảng việc, tự đánh dấu xong).
export const PLAN_TOOL = {
  name: "update_plan",
  description: "Hiện cho người dùng danh sách các bước bạn sẽ làm và trạng thái từng bước. Dùng khi việc cần 3 bước trở lên (nhiều lần gọi công cụ): gọi một lần lúc bắt đầu với toàn bộ kế hoạch, rồi gọi lại mỗi khi xong một bước. Luôn gửi lại cả danh sách. Không dùng cho câu hỏi đơn giản.",
  input_schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { content: { type: "string", description: "Bước, ngắn gọn (dưới 10 từ)" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["content", "status"] } } }, required: ["items"] },
};
// Artifact model viết giữa lượt (trước khi gọi công cụ — vd. viết bộ slide rồi check_artifact): lời dẫn chỉ giữ 4000 ký tự, không dựng
// artifact và không thuộc câu trả lời cuối, nên bộ slide từng hiện thành mã CSS thô rồi mất hẳn, check_artifact cũng không thấy.
// Tách artifact khỏi lời dẫn, giữ trong lượt (read_artifact / check_artifact đọc được), rồi đặt vào đầu câu trả lời cuối.
// Lời dẫn không giữ chỗ nào cho artifact: thẻ artifact đã có trong câu trả lời, một dòng "đã viết …" ở đây chỉ là ghi
// chú nội bộ lặp lại.
const ART_BLOCK = /<artifact\b[^>]*>[\s\S]*?(?:<\/artifact>|$)/gi;
export function sayOut(x: Exec | null | undefined, text: string) {
  // Lời dẫn (say) cũng là chữ model viết: bỏ dòng ghi chú "Đã áp dụng …" kiểu cũ như câu trả lời cuối, để không lộ hướng dẫn cá nhân qua sự kiện 'say'.
  let t = stripAppliedNotes(scrubServerPaths(text.trim()));
  if (x && hasArtifacts(t)) {
    t = t.replace(ART_BLOCK, (b) => {
      // Câu trả lời cuối của CLI lặp lại các khối đã tách ở lời gọi công cụ trước: giữ một bản, không thì bản sửa bị
      // áp hai lần.
      const arts = (x.turnArts ??= []);
      if (!arts.includes(b)) arts.push(b);
      return "";
    });
    t = t.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (t) progress("say", t);
}
/** Model định trả lời xong mà câu trả lời có bộ slide: tự kiểm bản cuối (artcheck.ts autoDeckCheck), thấy lỗi thì trả lời nhắc <auto_check>
 *  để model sửa trước khi giao. Một lần mỗi lượt (không lặp vô hạn, không tốn thêm hạn mức của gói khi bộ slide đã sạch lỗi). */
export async function deckGate(x: Exec, text: string): Promise<string | null> {
  // Cả artifact viết giữa lượt (lời dẫn trước khi gọi công cụ, giữ ở turnArts): câu trả lời cuối có thể chỉ còn lời tóm tắt.
  const live = [...(x.turnArts ?? []), unseen(x, text)].join("\n\n");
  if (!x.art || x.deckGated || runSignal()?.aborted || !hasArtifacts(live)) return null;
  const idents = [...new Set(splitArtifacts(live).flatMap((g) => (g.kind === "art" ? [g.art.ident] : [])))].slice(-2);
  if (!idents.length) return null;
  x.deckGated = true;
  const rows: string[] = [];
  for (const id of idents) {
    const a = findArtifact({ uid: x.uid, conv: x.conv, messages: x.art.messages, base: x.art.base, live }, id);
    if (!a || a.type !== "html" || !isDeck(a)) continue;
    progress("step", "Đang kiểm tra hiển thị artifact");
    const row = await autoDeckCheck(x.uid, x, a, process.env.APP_URL || "https://synchro.net.nz", runSignal()).catch(() => null);
    if (row) rows.push(row);
  }
  return rows.length ? AUTO_CHECK(rows) : null;
}
/** Lời nhắc <auto_check> đã gửi: giữ câu trả lời model vừa viết cho người dùng (không đưa vào nhật ký "say"), để cuối lượt ghép phần sửa vào đó
 *  (settleGate). at: số artifact viết giữa lượt trước lời nhắc. */
export function holdAnswer(x: Exec, text: string) {
  x.held = { text, at: x.turnArts?.length ?? 0 };
}
// Chữ qua đúng bộ lọc của sayOut rồi bỏ các khối artifact đã giữ ở turnArts (shared/patchheal.ts dropSeen).
function unseen(x: Exec, text: string): string {
  if (!x.turnArts?.length) return text;
  return dropSeen(x.turnArts, stripAppliedNotes(scrubServerPaths(text.trim())));
}
/** Chữ của lượt để read_artifact / check_artifact tìm artifact: artifact viết giữa lượt, câu trả lời đang giữ (đúng thứ tự), rồi phần đang viết. */
export function turnLive(x: Exec, tail: string): string {
  const t = x.turnArts ?? [], h = x.held;
  const rest = (s: string) => unseen(x, s);
  return (h ? [...t.slice(0, h.at), rest(h.text), ...t.slice(h.at), rest(tail)] : [...t, rest(tail)]).join("\n\n");
}
/** Cuối lượt có câu trả lời đang giữ: câu trả lời người dùng nhận là câu gốc, bản sửa của model gộp vào artifact trong đó (shared/turnfold.ts).
 *  stop: dừng giữa chừng / lỗi khi đang sửa → giao câu gốc, bỏ phần sửa dở. */
export function settleGate(x: Exec | null | undefined, text: string, stop = false): string {
  const h = x?.held;
  if (!x || !h) return text;
  x.held = undefined;
  const all = x.turnArts ?? [], before = all.slice(0, h.at), after = all.slice(h.at);
  if (stop || text.trim() === h.text.trim()) { x.turnArts = before; return h.text; }
  const r = foldFix(h.text, before, [...after, text].join("\n\n"));
  x.turnArts = r.before;
  return r.text;
}
/** Trạng thái vòng so với mẫu cho lượt làm sản phẩm thiết kế mới (designOf trả gate). */
export function designState(user: UserRow, model: string, dz: DesignOut, conv?: string): DesignState {
  const g = dz.gate!;
  return {
    user, model, conv, turn: dz.turn, format: g.format, typed: g.typed, hero: g.hero, forbid: g.forbid,
    shared: !subCli(model), rounds: new Map(),
  };
}
const GATE_TYPES = new Set(["html", "react", "svg"]);
const b64 = (b: Buffer): UserBlock => ({ type: "image", media_type: "image/jpeg", data: b.toString("base64") });
/** Ảnh mẫu cho bảng so sánh (cỡ nhỏ: bảng chỉ có ô 790 px). Lỗi thì bảng chỉ còn bản dựng. */
async function refShots(d: DesignState): Promise<{ label: string; jpeg: Buffer }[]> {
  if (!d.turn) return [];
  try {
    // Nhãn của turnImages đã là trọn câu cho model đọc (số thứ tự mẫu, mẫu người dùng gửi): vẽ nguyên lên bảng.
    return await turnImages(d.turn, [800, 800, 800]);
  } catch (e) {
    console.warn(`[designgate] không lấy được ảnh mẫu cho bảng so sánh: ${(e as Error).message}`);
    return [];
  }
}
/**
 * Model định trả lời xong mà lượt này làm sản phẩm thiết kế: Synchro dựng bản cuối, đo so với bộ token trộn, đặt ảnh
 * cạnh mẫu, nhờ người chấm khác hãng (nếu có) rồi trả lời nhắc <design_review> kèm bảng so sánh khi còn phải sửa. Tối
 * đa MAX_ROUNDS vòng mỗi artifact (khóa dùng chung: 1 vòng, chỉ lỗi cứng), cả vòng trong GATE_MS. null: giao như hiện
 * tại.
 */
export async function designGate(x: Exec, text: string): Promise<{ text: string; blocks: UserBlock[] } | null> {
  const d = x.design;
  if (!d || !x.art || runSignal()?.aborted || runner() !== "workspace") return null;
  const now = Date.now();
  d.started ??= now;
  const left = GATE_MS - (now - d.started);
  if (left < 20_000) return null;
  const live = turnLive(x, text);
  if (!hasArtifacts(live)) return null;
  const ident = splitArtifacts(live).flatMap((g) => (g.kind === "art" ? [g.art.ident] : [])).pop();
  const a = findArtifact({ uid: x.uid, conv: x.conv, messages: x.art.messages, base: x.art.base, live }, ident);
  if (!a || !a.complete || !GATE_TYPES.has(a.type)) return null;
  const n = d.rounds.get(a.ident) ?? 0, max = d.shared ? 1 : MAX_ROUNDS;
  const fp = `${a.ident}:${hashOf(a.content)}:${a.content.length}`;
  // Bản không đổi sau lời nhắc (model trả <keep/> hay chỉ nói lý do): không đo lại, không nhắc lại.
  if (n >= max || d.last === fp) return null;
  d.last = fp;
  progress("step", `So với mẫu tham chiếu (vòng ${n + 1}/${max})`);
  const sig = runSignal();
  const signal = AbortSignal.any([AbortSignal.timeout(left), ...(sig ? [sig] : [])]);
  const origin = process.env.APP_URL || "https://synchro.net.nz";
  const r = await checkArtifact(x.uid, a, {}, origin, signal).catch((e) => {
    console.warn(`[designgate] không dựng được "${a.ident}" để so với mẫu: ${(e as Error).message}`);
    return null;
  });
  if (!r || r.is_error || signal.aborted) return null;
  const deck = a.type === "html" && isDeck(a);
  const facts = r.design?.facts ?? null, probe = r.design?.probe ?? null;
  const measured = measuredDiffs(probe, facts, d.turn?.mix ?? null, { hero: !!d.hero, deck });
  let diffs: Diff[] = d.shared ? hardOnly(measured) : measured;
  const views = (r.views ?? []).map((v) => Buffer.from(v, "base64"));
  const refs = d.shared ? [] : await refShots(d);
  const sheet = views.length ? await compareSheet(views, refs) : null;
  let keep: string[] = [], self = true;
  if (!d.shared && d.turn && sheet && !signal.aborted) {
    const critic = await pickDesignCritic(d.user, d.model).catch((e) => {
      console.warn(`[designgate] không chọn được người chấm: ${(e as Error).message}`);
      return null;
    });
    if (critic) {
      progress("step", `Người chấm thiết kế · ${critic.split("/").pop()}`);
      const c = await critiqueDesign(d.user, critic, { brief: d.typed, sheet, diffs, refs: d.turn.refs, signal });
      if (c) {
        diffs = [...c.brief, ...diffs, ...c.quality, ...c.impact];
        keep = c.keep;
        self = false;
      }
    }
  }
  console.log(`[designgate] ${a.ident} vòng ${n + 1}/${max}: ${diffs.length} chênh lệch${self ? " (tự chấm)" : ""}`);
  if (!needsFix(diffs)) return null;
  d.rounds.set(a.ident, n + 1);
  progress("step", `Chênh lệch còn lại · ${diffs.length}`);
  const mix = d.turn?.mix.id ?? null;
  const review = DESIGN_REVIEW({ round: n + 1, max, diffs, keep, self, refs: refs.length > 0, mix });
  const img = sheet ?? views[0];
  return { text: review, blocks: [{ type: "text", text: review }, ...(img ? [b64(img)] : [])] };
}
/** check_artifact trong lượt có mẫu tham chiếu: ảnh trả về là bảng so với mẫu, kèm chênh lệch Synchro đo được. */
async function withCompare(x: Exec, r: CheckResult, deck: boolean): Promise<CheckResult> {
  const d = x.design;
  if (!d?.turn || !r.views?.length || r.is_error) return r;
  const sheet = await compareSheet(r.views.map((v) => Buffer.from(v, "base64")), await refShots(d));
  const diffs = measuredDiffs(r.design?.probe ?? null, r.design?.facts ?? null, d.turn.mix, { hero: !!d.hero, deck });
  const rows = diffs.map((f) => `- ${f.where} · ${f.property}: ${f.measured} → ${f.target}. ${f.fix}`);
  const note = rows.length ? `\nSo với khối token trộn của lượt này:\n${rows.join("\n")}` : "";
  const what = "\nẢnh đi kèm là bảng so với mẫu: trái là bản dựng, phải là mẫu tham chiếu (chỉ để so nguyên tắc).";
  const content = `${r.content}${note}${sheet ? what : ""}`;
  return { ...r, content, ...(sheet ? { image: sheet.toString("base64") } : {}) };
}
// Câu trả lời cuối đã viết lại trọn một artifact thì bỏ các bản cùng identifier viết giữa lượt (bản sửa mode="patch" thì vẫn cần bản gốc).
export const withTurnArts = (x: Exec | null | undefined, text0: string) => {
  notePatches(x, text0);
  // Bản sửa ở câu trả lời cuối cho bộ slide viết giữa lượt: gộp thành một thẻ (H1 lỗi 9).
  const fp = x?.turnArts?.length ? foldPatches(x.turnArts, text0) : null;
  if (x && fp) x.turnArts = fp.arts;
  const text = fp ? fp.text : text0;
  const full = new Set(splitArtifacts(text).flatMap((g) => (g.kind === "art" && !g.art.patch ? [g.art.ident] : [])));
  const fresh = (x?.turnArts ?? []).filter((b) => !text.includes(b) && !splitArtifacts(b).some((g) => g.kind === "art" && full.has(g.art.ident)));
  return fresh.length ? `${fresh.join("\n\n")}\n\n${text}` : text;
};
// Số khối sửa áp được / không áp được và số lần viết lại trọn sau bản sửa hỏng của lượt, ghi vào dòng [timing]
// (tracing.ts): đo được bản sửa có áp ngay lần đầu không mà không cần đọc lại đoạn chat. Chữ ở đây đã ghép lần gửi
// lại, nên số khối hỏng lần đầu lấy từ patchFailedFirst.
function notePatches(x: Exec | null | undefined, text: string) {
  const t = currentTrace();
  if (!t || !x?.art || !/mode\s*=\s*["']patch/i.test([...(x.turnArts ?? []), text].join("\n"))) return;
  const st = patchStats(priorArts(x.art.messages, cleanBase(x.art.base)), turnTexts(x, text));
  t.attrs["synchro.patch.ok"] = st.ok;
  t.attrs["synchro.patch.failed"] = st.failed;
  t.attrs["synchro.patch.rewrites"] = st.rewrites;
  if (x.patchFailedFirst !== undefined) t.attrs["synchro.patch.failed_first"] = x.patchFailedFirst;
  if (x.patchHeal) t.attrs["synchro.patch.heal"] = x.patchHeal;
}
/** Một lời gọi công cụ từ CLI qua cầu nối: giữ lời dẫn trước đó, ghi công cụ và kết quả vào nhật ký, ghép tin nhắn thêm vào kết quả. */
export async function bridgeCall(x: Exec, name: string, input: Record<string, unknown>, usedAll: ToolRun["used"][], cancel?: AbortSignal) {
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
// Nút "Kết nối lại" trong khung chat: mỗi connector hiện một lần trong lượt.
function showReconnect(x: Exec, c: OfflineConn) {
  const seen = (x.connCards ??= new Set());
  if (seen.has(c.id)) return;
  seen.add(c.id);
  progress("conn", JSON.stringify({ id: c.id, name: c.name, logo: c.logo, color: c.color, ...(c.site ? { site: c.site } : {}), auth: c.auth, ...(c.refused ? { refused: true } : {}), ...(c.why === "link" ? { link: true } : {}) }));
}
// Connect Link Composio vừa trả về: nút "Kết nối <ứng dụng>" ngay trong khung chat (mỗi đường link một lần trong lượt).
function showLinks(x: Exec, content: string) {
  const seen = (x.connCards ??= new Set());
  for (const l of connectLinks(content)) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    progress("link", JSON.stringify({ ...l, ...appLogo(l.app) }));
  }
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
export function keepImages(uid: string, files: ImgFile[], outs: OutFile[]) {
  let room = outputsFull() ? 0 : outputRoom(uid);
  const fit = files.filter((f) => { if (f.data.length > room) return false; room -= f.data.length; return true; });
  const saved = saveOutputs(uid, fit.map((f) => ({ path: f.name, data: f.data })));
  outs.push(...saved);
  const left = files.filter((f) => !saved.some((s) => s.name === f.name));
  for (const f of left) if (!outs.some((o) => o.skipped && o.name === f.name)) outs.push({ id: `skip-${f.name}`, name: f.name, size: f.data.length, mime: "", skipped: true });
  return { saved, left };
}
// 1×1 PNG xám: ảnh giữ chỗ cho ảnh đang dựng ở chế độ nền (G4). Model đặt địa chỉ ảnh vào slide / artifact ngay; byte thật thay vào đúng id khi dựng xong.
const PLACEHOLDER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN49uwZAAVoArMCxcTLAAAAAElFTkSuQmCC", "base64");
const ASPECT_DIMS: Record<string, [number, number]> = {
  "1:1": [1024, 1024], "16:9": [1280, 720], "9:16": [720, 1280], "4:3": [1024, 768], "3:4": [768, 1024],
  "4:5": [896, 1120], "5:4": [1120, 896], "2:3": [832, 1248], "3:2": [1248, 832],
};
/** Đặt tên ảnh theo lời người dùng (model hay viết prompt tiếng Anh), không trùng tên tệp đã có trong lượt. Dùng cho cả ảnh thật và ảnh giữ chỗ. */
function renameImages(x: Exec, files: ImgFile[]): ImgFile[] {
  const asked = requestSlug(typedText((Array.isArray(x.msgs) ? (x.msgs as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").at(-1)));
  if (!asked) return files;
  const taken = new Set(x.outs.map((o) => o.name));
  return files.map((f, i) => {
    const ext = /\.[^.]+$/.exec(f.name)?.[0] ?? "";
    let n = files.length > 1 ? i + 1 : 1, name = `${asked}${n > 1 || files.length > 1 ? `-${n}` : ""}${ext}`;
    while (taken.has(name)) name = `${asked}-${++n}${ext}`;
    taken.add(name);
    return { ...f, name };
  });
}
const IMG_REF_MAX = 20 * 1048576;
/** Tên ảnh cuối cùng generate_image đã giao trong một câu trả lời cũ, đọc từ dấu vết công cụ trình duyệt gửi kèm lịch sử (dòng trong <files> của kết quả công cụ). */
function tracedImage(trace: unknown): string | null {
  const ok = (Array.isArray(trace) ? trace : []) as { name?: string; status?: string; summary?: string }[];
  for (const t of [...ok].reverse()) {
    if (t?.name !== IMAGE_TOOL_NAME || t.status !== "ok") continue;
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
  const used = { kind: "search" as const, name: IMAGE_TOOL_NAME };
  const fail = (content: string): Run => ({ content, is_error: true, used });
  const prompt = typeof c.input?.prompt === "string" ? c.input.prompt.trim() : "";
  const template = String(c.input?.template ?? "").trim();
  if (!prompt && !template) return fail("Thiếu mô tả ảnh (prompt).");
  if (prompt.length > 4000) return fail("Mô tả ảnh quá dài (tối đa 4.000 ký tự).");
  const aspect = (ASPECTS as readonly string[]).includes(String(c.input?.aspect_ratio)) ? String(c.input.aspect_ratio) : undefined;
  const count = Math.min(4, Math.max(1, Math.floor(Number(c.input?.count)) || 1));
  if (outputsFull()) return fail("Máy chủ sắp hết dung lượng đĩa nên chưa tạo ảnh được. Hãy nói rõ với người dùng và đề nghị thử lại sau.");
  if (outputRoom(x.uid) < 2 * 1048576) return fail(`Tài khoản đã dùng hết ${OUTPUT_QUOTA_MB()} MB dung lượng tệp đã tạo nên chưa lưu thêm được ảnh (tệp cũ tự xóa sau 30 ngày).`);
  // Mẫu poster dựng ở máy chủ (Satori): không cần gói tạo ảnh nào, model chỉ điền trường, chữ tiếng Việt chính xác tuyệt đối.
  let r: ImgOk | ImgErr, by: string;
  if (template) {
    if (!(POSTER_TEMPLATES as readonly string[]).includes(template)) return fail(`Không có mẫu "${template}". Mẫu có sẵn: ${POSTER_TEMPLATES.join(", ")}.`);
    const props = posterProps(c.input?.poster);
    if (typeof props === "string") return fail(props);
    const wait = imageBudget(x.uid, 1);
    if (wait) return fail(`${imageLimitMsg(IMAGE_HOUR_MAX(), wait)}\n\n${IMAGE_LIMIT_NOTE}`);
    progress("step", "Đang dựng poster 3600×1890");
    try {
      // Satori (next/og) chỉ nạp khi thật sự dựng poster.
      const { renderPoster } = await import("../design-engine/posters/render");
      const png = await renderPoster(template as PosterTemplate, props, 3);
      r = { ok: true, files: [{ name: imageName(props.title, 0, 1, "png"), mime: "image/png", data: png }], cli: "agy", notes: ["Poster 3600×1890 (gấp 3 lần 1200×630), chữ dựng dạng vector nên nét khi in và đăng mạng xã hội."], tried: [] };
    } catch (e) { return fail(`Chưa dựng được poster: ${String((e as Error).message).slice(0, 200)}`); }
    by = "mẫu poster của Synchro";
  } else {
    let reference: ImgFile | undefined;
    // Model hay điền "" vào tham số không bắt buộc: đó là không có ảnh gốc, không phải "ảnh gần nhất".
    const refIn = String(c.input?.reference ?? "").trim();
    if (refIn) {
      const r = await refImage(x, refIn);
      if (typeof r === "string") return fail(r);
      reference = r;
    }
    const wait = imageBudget(x.uid, count);
    // Nói rõ trần nào (số ảnh mỗi giờ), bao giờ hồi và cách thay thế không tốn ảnh (limitmsg.ts, H1.2). Câu đầu cho người dùng (thẻ công cụ hiện),
    // IMAGE_LIMIT_NOTE sau dòng trống là chỉ dẫn riêng cho model.
    if (wait) return fail(`${imageLimitMsg(IMAGE_HOUR_MAX(), wait)}\n\n${IMAGE_LIMIT_NOTE}`);
    // Lượt Antigravity gọi công cụ này đang giữ khóa của tài khoản, mà lượt tạo ảnh cũng cần khóa đó: CLI đã đọc xong cấu hình nên nhả được, như lúc chờ người dùng duyệt.
    x.park?.();
    const stops = [runSignal(), x.calls?.get(c.id)?.cancel].filter((v): v is AbortSignal => !!v);
    let bg = false;
    const gen = generateImages({ uid: x.uid, prompt, aspect, count, reference, product: c.input?.product_shot === true, relight: c.input?.product_relight === true, signal: stops.length > 1 ? AbortSignal.any(stops) : stops[0],
      onStatus: (t) => { if (!bg) progress("step", t); }, onNote: (t) => { if (!bg) progress("note", t); } });
    // Ngân sách 90 giây cho lời gọi công cụ: quá thì trả ảnh giữ chỗ, ảnh dựng tiếp ở chế độ nền và tự thay vào khi xong (G4).
    let fin: ImgOk | ImgErr | undefined;
    const genDone = gen.then((v) => { fin = v; }, (e) => { fin = { ok: false, kind: "other", text: String((e as Error)?.message ?? e), tried: [], providers: false }; });
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([genDone, new Promise<void>((ok) => { budgetTimer = setTimeout(ok, IMG_BUDGET_MS()); })]);
    clearTimeout(budgetTimer);
    if (!fin) return placeholderImage(x, gen, prompt, aspect, count, () => { bg = true; });
    r = fin;
    if (!r.ok) {
      if (r.providers) progress("plans", JSON.stringify({ why: r.kind, tried: r.tried.filter((f) => f.kind !== "auth").map((f) => f.cli) }));
      return fail(r.text);
    }
    by = IMG_NAME[r.cli];
  }
  // Tên theo lời người dùng; nhiều ảnh trong một lượt (thiết kế nhiều ảnh) không được trùng tên: inputs/ và tham chiếu đều đi theo tên.
  const named = renameImages(x, r.files);
  const { saved, left } = keepImages(x.uid, named, x.outs);
  (x.madeImgs ??= []).push(...saved.map((f) => f.id));
  if (!saved.length) return fail(`${by} đã tạo ${r.files.length} ảnh nhưng chưa lưu được vì tài khoản đã dùng hết ${OUTPUT_QUOTA_MB()} MB dung lượng tệp đã tạo hoặc máy chủ sắp hết đĩa. Người dùng chưa nhận được ảnh nào: hãy nói rõ điều đó.`);
  const lines = saved.map((f) => `${f.name} (${fmtSize(f.size)}) — đã gửi cho người dùng`);
  const send = imagesForModel(named.filter((f) => saved.some((s) => s.name === f.name)).map((f) => ({ data: f.data.toString("base64"), mime: f.mime })));
  // CLI không phải lúc nào cũng theo đúng tỉ lệ xin: nói cho model biết để không báo sai với người dùng, nhất là ảnh sẽ đặt vào khung có sẵn của thiết kế.
  const [aw, ah] = (aspect ?? "").split(":").map(Number);
  const offRatio = aw && ah ? saved.filter((f) => f.w && f.h && Math.abs(f.w / f.h - aw / ah) / (aw / ah) > 0.08) : [];
  const notes = [...r.notes, ...(offRatio.length ? [`Xin tỉ lệ ${aspect} nhưng nhận được: ${offRatio.map((f) => `${f.name} ${f.w}×${f.h}`).join(", ")}. Nói rõ với người dùng nếu tỉ lệ quan trọng; đưa vào thiết kế thì cắt bằng object-fit, đừng kéo méo.`] : []), ...(left.length ? [`${left.length} ảnh không lưu được vì hết dung lượng: ${left.map((f) => f.name).join(", ")}.`] : []), ...(send.length < saved.length ? [`${saved.length - send.length} ảnh quá lớn nên không kèm ở đây để bạn xem (tối đa ${IMAGE_MAX_MB()} MB mỗi ảnh vẫn giao được cho người dùng); đừng mô tả các ảnh đó như đã xem.`] : [])];
  const content = `Đã tạo ${saved.length} ảnh bằng ${by}.\n<files>\n${lines.join("\n")}\n</files>${notes.length ? `\n${notes.join("\n")}` : ""}\nẢnh đã hiện thành thẻ trong khung chat (xem, phóng to, tải về): trong câu trả lời đừng chèn đường dẫn hay liên kết.\nĐưa ảnh vào sản phẩm khi người dùng cần: artifact HTML, React, SVG, slide dùng đúng địa chỉ ${saved.map((f) => genImageUrl(f.id)).join(", ")} trong src hay url(...), Synchro tự nhúng ảnh; run_code (Word, PowerPoint, PDF, video, ghép ảnh) đọc inputs/${saved.map((f) => f.name).join(", inputs/")}.`;
  if (!send.length) return { content, is_error: false, used };
  (x.heavy ??= []).push(c.id);
  const [first, ...more] = send;
  return { content, is_error: false, used, image: first.data, mime: first.mime, ...(more.length ? { more } : {}) };
}
/** Quá ngân sách thời gian: giữ chỗ ảnh (địa chỉ ổn định) để model dựng slide / artifact ngay, ảnh dựng tiếp ở chế độ nền rồi tự thay byte thật vào đúng id (G4). */
function placeholderImage(x: Exec, gen: Promise<ImgOk | ImgErr>, prompt: string, aspect: string | undefined, count: number, markBg: () => void): Run {
  markBg();
  const used = { kind: "search" as const, name: IMAGE_TOOL_NAME };
  const files: ImgFile[] = Array.from({ length: count }, (_, i) => ({ name: imageName(prompt, i, count, "png"), mime: "image/png", data: PLACEHOLDER_PNG }));
  const { saved } = keepImages(x.uid, renameImages(x, files), x.outs);
  const ids = saved.map((f) => f.id);
  // Chế độ nền: ảnh dựng xong thì thay byte thật vào đúng id (slide / artifact tham chiếu id nên tự cập nhật); ảnh không dựng được thì đánh dấu hỏng
  // để khung xem trước / thẻ ảnh thôi chờ. Báo một dòng (G4.2, W23-2): lượt còn chạy thì thành một bước trong nhật ký của lượt; lượt đã xong thì
  // trình duyệt báo khi khung xem trước / thẻ ảnh thấy ảnh đổi (artdoc.ts noteGenSettled).
  const names = saved.map((f) => f.name);
  const settle = (files: Buffer[] | null) => {
    if (!ids.length) return;
    const r = settleBackground({ ids, names, files, failed: markGenFailed,
      replace: (id, data) => { try { return !!replaceOutput(x.uid, id, data); } catch (e) { console.error("[imgbudget] không thay được ảnh nền", String((e as Error).message).slice(0, 160)); return false; } } });
    const rid = currentRun();
    if (rid && liveText(rid)) { const seq = progress("tool", r.line); if (seq) progress("res", JSON.stringify({ ref: seq, ok: r.ok })); }
  };
  void gen.then((res) => settle(res.ok ? res.files.map((f) => f.data) : null), () => settle(null));
  if (!ids.length) return { content: `Ảnh đang được dựng ở chế độ nền (quá ${Math.round(IMG_BUDGET_MS() / 1000)} giây) nhưng chưa giữ được chỗ lưu (tài khoản gần hết dung lượng tệp đã tạo). Hãy làm phần khác trước và nói người dùng biết ảnh đang hoàn thiện.`, is_error: false, used };
  // Khung ảnh giữ chỗ giữ đúng tỉ lệ yêu cầu để bố cục slide / thẻ không nhảy.
  const [pw, ph] = ASPECT_DIMS[aspect ?? "1:1"] ?? ASPECT_DIMS["1:1"];
  for (const s of saved) { const o = x.outs.find((v) => v.id === s.id); if (o) { o.w = pw; o.h = ph; } }
  (x.madeImgs ??= []).push(...ids);
  return { content: placeholderNote({ urls: saved.map((f) => genImageUrl(f.id)), names: saved.map((f) => f.name), by: "AI" }), is_error: false, used };
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
// Dặn thêm cho công cụ tìm web (blueprint D2): số liệu trong ngày thì ưu tiên nguồn chính thức; chưa có con số thì thử thêm một nguồn nữa
// trước khi nói "không chắc"; nếu một trang trả về quá ít chữ hoặc còn "đang cập nhật" / "enable JavaScript" / "loading" thì mở trang đó
// trong trình duyệt (browser_navigate → browser_wait → browser_text) để đọc DOM đã dựng.
const WEB_GUIDE = " Với số liệu thay đổi trong ngày (tỷ giá, giá vàng, giá cổ phiếu, thời tiết, kết quả), ưu tiên nguồn chính thức; nếu kết quả chưa có con số, thử thêm một nguồn nữa trước khi trả lời \"không chắc\". Nếu một trang trả về quá ít chữ hoặc còn \"đang cập nhật\" / cần bật JavaScript, mở trang đó trong trình duyệt (browser_navigate → browser_wait → browser_text) để đọc nội dung đã dựng.";
export const GEMINI_WEB_TOOL = {
  name: "web_search",
  description: "Tìm thông tin mới trên web bằng Google Search. Dùng khi câu hỏi cần dữ kiện mới (tin tức, giá, tỷ giá, lịch, phiên bản phần mềm…) hoặc điều bạn không chắc. Trả về tóm tắt kèm nguồn." + WEB_GUIDE,
  input_schema: { type: "object", properties: { query: { type: "string", description: "Câu tìm kiếm ngắn, cùng ngôn ngữ người dùng" } }, required: ["query"] },
};
export const WEB_DESC = "Tìm thông tin mới trên web. Dùng khi câu hỏi cần dữ kiện mới (tin tức, giá, tỷ giá, lịch, phiên bản phần mềm…) hoặc điều bạn không chắc. Trả về tóm tắt kèm nguồn." + WEB_GUIDE;
// Kết quả tìm web kèm danh sách nguồn và cờ "kẹt" (trống / không nguồn / màn chưa dựng) để máy chủ tự mở trang nguồn (D2.1).
type SearchRun = ToolRun & { sources?: { url: string; title: string }[]; stalled?: boolean };
async function geminiSearch(t: Target, query: string, cite: Citer): Promise<SearchRun> {
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
  const sources = (c?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web).filter((w): w is { uri: string; title?: string } => !!w?.uri && /^https?:\/\//.test(w.uri)).map((w) => ({ url: w.uri, title: w.title ?? "" }));
  const src = srcList(sources, cite);
  // Tóm tắt tìm web vốn ngắn gọn: chỉ nâng cấp khi trống / không nguồn / dính màn chưa dựng, không chỉ vì ít chữ (escalateSearch xử lý).
  return { content: `${text || "(không có kết quả)"}\n\nNguồn:\n${src}`, is_error: false, used, sources, stalled: searchNeedsEscalation(text, sources.length > 0) };
}
// Tìm web cho Grok / DeepSeek qua khóa API: /chat/completions của hai hãng không có công cụ tìm web phía máy chủ, nên Synchro gọi
// API Responses của chính hãng đó (cùng khóa, cùng model) với công cụ web_search và trả câu trả lời kèm nguồn như một công cụ thường.
async function responsesSearch(t: Target, query: string, cite: Citer): Promise<SearchRun> {
  const used = { kind: "search" as const, name: "web_search" };
  if (!query.trim()) return { content: "Thiếu câu tìm kiếm.", is_error: true, used };
  try {
    const j = await responsesCall(t, { input: [{ role: "user", content: `Tìm trên web rồi tóm tắt ngắn gọn, ghi rõ nguồn: ${query.slice(0, 500)}` }], tools: [{ type: "web_search" }], max_output_tokens: 4000 }, runSignal() ?? AbortSignal.timeout(90_000)) as { output?: { type: string; content?: { type: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[] }[]; citations?: unknown[] };
    const parts = (j.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
    const text = parts.map((c) => c.text ?? "").join("").trim();
    const urls = [...parts.flatMap((c) => (c.annotations ?? []).filter((a) => a.url).map((a) => ({ url: a.url!, title: a.title ?? "" }))), ...(Array.isArray(j.citations) ? j.citations : []).filter((u): u is string => typeof u === "string").map((url) => ({ url, title: "" }))];
    const sources = [...new Map(urls.filter((u) => /^https?:\/\//.test(u.url)).map((u) => [u.url, u])).values()];
    const src = srcList(sources, cite);
    return { content: `${text || "(không có kết quả)"}\n\nNguồn:\n${src}`, is_error: false, used, sources, stalled: searchNeedsEscalation(text, sources.length > 0) };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { content: `Chưa tìm được trên web (${e instanceof HttpErr ? e.status : "mất kết nối"}): ${String((e as Error).message).slice(0, 200)}`, is_error: true, used };
  }
}
const searchWeb = (t: Target, query: string, cite: Citer) => (t.kind === "google" ? geminiSearch(t, query, cite) : responsesSearch(t, query, cite));

// D2.1 (W23-6 / SEC-8): kết quả lấy web mỏng hoặc kẹt thì MÁY CHỦ tự mở trang nguồn trong trình duyệt của workspace (đúng đường công cụ
// trình duyệt: browser_navigate → browser_wait → browser_text) và gắn chữ của DOM đã dựng vào kết quả, không chỉ nhắc model.
// Giới hạn: mỗi địa chỉ một lần mỗi lượt (x.rendered), tối đa 2 trang, mỗi trang 40 giây; chỉ địa chỉ https công khai (checkUrl: chặn
// localhost / mạng nội bộ) và trang không bị chặn, không cần hỏi (trang cần hỏi thì bỏ qua, model vẫn tự mở được qua cổng hỏi thường).
// Lượt không có công cụ trình duyệt: chỉ nhắc thử nguồn khác, không nhắc tên công cụ model không có.
const renderCtx = (x: Exec): BrowserCtx => ({ ...x.bctx, target: "synchro" });
async function renderAllowed(x: Exec, url: string) {
  try { await checkUrl(url); } catch { return false; }
  return siteRule(x.uid, siteOf("browser_navigate", { url }, null), new Set()) === "ok";
}
// Hàng đợi trình duyệt của Synchro cho đoạn chat (withBrowserLock): lần tự mở trang và công cụ browser_* của model không xen nhau.
const browserKey = (x: Exec) => `${x.uid}|${x.bctx?.scope ?? x.conv ?? "-"}`;
// Mở → chờ → đọc trong hàng đợi; mỗi bước xem signal (hết 40 giây / lượt bị dừng) để thôi điều khiển trình duyệt. Địa chỉ cuối cùng sau chuyển
// hướng (vd. link chuyển hướng của Gemini grounding) phải qua lại checkUrl + quy tắc trang của người dùng: không thì không đọc, không gắn.
async function renderPage(x: Exec, url: string, signal: AbortSignal): Promise<{ text: string; url: string } | null> {
  return withBrowserLock(browserKey(x), async () => {
    if (signal.aborted) return null;
    if (x.shown !== "synchro") { x.shown = "synchro"; progress("ui", "browser"); }
    const ctx = renderCtx(x);
    const nav = await runBrowserTool(x.uid, "browser_navigate", { url, browser: "synchro" }, ctx);
    if (nav.is_error || signal.aborted) return null;
    const at = nav.url ?? url;
    if (at !== url && !(await renderAllowed(x, at))) return null;
    x.gate?.seen(at);
    await runBrowserTool(x.uid, "browser_wait", { ms: 3000, browser: "synchro" }, ctx);
    if (signal.aborted) return null;
    const r = await runBrowserTool(x.uid, "browser_text", { browser: "synchro" }, ctx);
    if (r.is_error || signal.aborted || !r.text) return null;
    // Trang tự chuyển hướng bằng JavaScript trong lúc chờ: xét lại địa chỉ mới.
    const end = r.url ?? at;
    if (end !== at && !(await renderAllowed(x, end))) return null;
    return { text: r.text, url: end };
  });
}
async function escalateSearch(x: Exec, r: SearchRun): Promise<ToolRun> {
  const { sources = [], stalled = false, ...run } = r;
  if (run.is_error) return run;
  // Cùng vòng model đang tự dùng trình duyệt (x.roundBrowser): không tự mở trang, chỉ nhắc — tránh giành trình duyệt với model.
  return { ...run, content: await escalateText(run.content, { stalled, urls: sources.map((s) => s.url), browse: !!(x.browse && x.bctx), render: !x.roundBrowser, done: (x.rendered ??= new Set()), read: (url, signal) => renderPage(x, url, signal), allow: (url) => renderAllowed(x, url), signal: runSignal() }) };
}
// Danh sách nguồn trong kết quả công cụ: số [n] là số của nguồn trong cả lượt (khớp chip nguồn dưới câu trả lời), kèm lời dặn trích dẫn.
const srcList = (list: { url: string; title: string }[], cite: Citer) => {
  const rows = list.slice(0, 8).map((u) => ({ ...u, n: cite(u.url, u.title) })).filter((u) => u.n > 0);
  return rows.length ? `${rows.map((u) => `[${u.n}] ${u.title} — ${u.url}`).join("\n")}\n\nKhi dùng thông tin từ nguồn nào, ghi số của nguồn đó dạng [n] ngay sau câu (ví dụ: … tăng 5%[2].), đúng số ở trên.` : "(không có)";
};
async function runCall(x: Exec, c: Call, d?: Decision): Promise<Run> {
  if (c.name === "update_plan") {
    const items = (Array.isArray(c.input?.items) ? c.input.items : []).map((i: { content?: unknown; status?: unknown }) => ({ content: String(i.content ?? "").slice(0, 120), status: ["pending", "in_progress", "completed"].includes(String(i.status)) ? String(i.status) : "pending" })).slice(0, 12);
    const shown = notePlan(x, "synchro", items);
    if (shown) progress("plan", JSON.stringify(shown));
    return { content: "Đã cập nhật danh sách việc cho người dùng.", is_error: false, used: { kind: "search", name: "update_plan" } };
  }
  if (c.name === TASK_TOOL.name && x.task && !x.sess?.get(c.name)) return { ...(await runPropose(x.uid, x.task, c.input ?? {})), used: { kind: "search", name: c.name } };
  if (c.name === "read_ref" && !x.sess?.get(c.name)) return { ...readRef(x.uid, c.input), used: { kind: "search", name: "read_ref" } };
  if (c.name.startsWith("brain_") && !x.sess?.get(c.name)) return { ...runBrainTool(x.uid, c.name, c.input ?? {}), used: { kind: "search", name: c.name } };
  if (c.name === "web_search" && x.search && !x.sess?.get(c.name)) return escalateSearch(x, await searchWeb(x.search, String(c.input?.query ?? ""), citeOf(x)));
  if (c.name === "run_code" && !x.sess?.get(c.name)) { const r = await runCode(x, c.input); if (r.image) (x.heavy ??= []).push(c.id); return r; }
  if (c.name === IMAGE_TOOL_NAME && x.image && !x.sess?.get(c.name)) return runImage(x, c);
  if (c.name === PROJECT_DOC_TOOL.name && x.project !== undefined && !x.sess?.get(c.name)) return { ...readProjectFile(x.uid, x.project, c.input ?? {}), used: { kind: "search", name: c.name } };
  if ((c.name === "read_artifact" || c.name === "check_artifact") && x.art && !x.sess?.get(c.name)) {
    const a = findArtifact({ uid: x.uid, conv: x.conv, messages: x.art.messages, base: x.art.base, live: turnLive(x, liveNow()) }, typeof c.input?.identifier === "string" ? c.input.identifier : undefined);
    const used = { kind: "search" as const, name: c.name };
    // Bản sửa gần nhất có khối không áp được: nói rõ khối nào và chỗ gần giống nhất ngay trong kết quả. Chỉ thấy bản
    // hiện tại chưa đổi thì model viết lại cả tệp.
    const fail = a ? patchReport(a) : "";
    const note = <T extends { content: string }>(r: T): T => (fail ? { ...r, content: `${r.content}\n${fail}` } : r);
    if (c.name === "read_artifact") return { ...note(readArtifact(a, c.input ?? {})), used };
    const spent = { content: note({ content: SELF_CHECK_SPENT }).content, is_error: false, used };
    // Hết giờ tự kiểm thì từ chối trước khi đếm vòng: lần bị từ chối không phải một vòng model đã thấy kết quả.
    if (checkSpent(x) >= SELF_CHECK_MS) return spent;
    const seen = !!a && checkedInTurn(x, a);
    const enough = a ? checkRoundGate(x, a) : null;
    if (enough) return { content: enough, is_error: false, used };
    const origin = process.env.APP_URL || "https://synchro.net.nz";
    const r = await withinCheckBudget(x, runSignal(), (s) => checkArtifact(x.uid, a, c.input ?? {}, origin, s));
    if (!r) {
      // Lần này vừa mở một vòng mới cho bản này mà bị cắt: trả vòng đó lại (autoDeckCheck vẫn đo bản này).
      if (a && !seen) forgetCheck(x, a);
      return spent;
    }
    const shown = await withCompare(x, r, !!a && a.type === "html" && isDeck(a));
    if (shown.image) (x.heavy ??= []).push(c.id);
    return { ...note(shown), used };
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
      asked: (id, a) => { if (currentRun()) progress("asked", JSON.stringify({ id, ok: a.ok, always: !!a.always })); },
      // D6: đang mở skill của danh mục (chưa kiểm chứng) và thao tác trên Chrome của người dùng → hỏi một lần trong lượt trước khi dùng.
      gateExtra: (_name, input) => x.untrusted && browserTargetOf(input, x.bctx) === "user" ? { kind: "site", tool: "browser", key: "untrusted:user-chrome", host: "", title: "Dùng Chrome của bạn trong khi đang chạy skill chưa kiểm chứng từ danh mục", detail: "" } : null });
    const no = await x.gate.check(c.name, c.input ?? {});
    if (no) return { content: no, is_error: true, used: { kind: "search", name: c.name } };
    // Trình duyệt của Synchro: chạy trong hàng đợi của đoạn chat (cùng hàng với lần máy chủ tự mở trang), không xen với thao tác khác.
    // Chrome của người dùng không xếp hàng ở đây (tiện ích tự xử lý theo lượt; thao tác có thể chờ người dùng bỏ Tạm dừng tới 15 phút).
    const browserStep = async () => {
      let r = await runBrowserTool(x.uid, c.name, c.input ?? {}, x.bctx);
      // D2.1: đọc chữ mà trang còn mỏng / chưa dựng xong ngay từ đầu trang: máy chủ tự chờ trang dựng rồi đọc lại một lần cho mỗi địa chỉ trong lượt.
      if (c.name === "browser_text" && r.stalled && r.url && !(x.rendered ??= new Set()).has(r.url)) {
        x.rendered.add(r.url);
        await runBrowserTool(x.uid, "browser_wait", { ms: 5000, ...(c.input?.browser ? { browser: c.input.browser } : {}) }, x.bctx);
        const again = await runBrowserTool(x.uid, c.name, c.input ?? {}, x.bctx);
        if (!again.is_error && (again.text ?? "").trim().length > (r.text ?? "").trim().length) r = { ...again, content: `${again.content}\n[Synchro đã tự chờ trang dựng xong rồi đọc lại.]` };
      }
      return r;
    };
    const r = where === "synchro" ? await withBrowserLock(browserKey(x), browserStep) : await browserStep();
    // Bị chặn vì là trang đăng nhập của bên thứ ba (signinguard.ts) mà Composio chưa liên kết: hiện luôn nút "Liên kết Composio" trong khung chat
    // (kèm lối tới Cài đặt → Connectors), không chờ model nhớ gọi connector_reconnect.
    const link = r.signin ? x.sess?.offline.find((o) => o.why === "link") : undefined;
    if (link) showReconnect(x, link);
    x.gate.seen(r.url);
    if (["browser_read", "browser_text", "browser_screenshot", "browser_batch"].includes(c.name)) (x.heavy ??= []).push(c.id);
    // Bước công cụ trong khung chat ghi rõ "Đã chặn trang đăng nhập" (nhãn bước vẫn là "Đang mở accounts.google.com" lúc bắt đầu).
    return { content: r.content, is_error: r.is_error, ...(r.image ? { image: r.image } : {}), ...(r.signin ? { sum: r.summary } : {}), used: { kind: "search", name: c.name } };
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
    return { content: hit ? `Đã hiện nút "${hit.why === "link" ? "Liên kết Composio" : "Kết nối lại"}" cho ${hit.name} trong khung chat. Hãy nói một câu ngắn để người dùng bấm nút rồi nhắc lại yêu cầu (không chép link).` : `Không có connector "${String(c.input?.connector ?? "")}" đang chờ kết nối lại.`, is_error: !hit, used: { kind: "search", name: c.name } };
  }
  const ct = x.sess?.get(c.name);
  if (!ct) {
    const r = await runSkillTool(x.list, c.name, c.input, x.scripts, { uid: x.uid, net: x.net, libs: x.libs, heal: x.heal ? (input) => healScript(x.heal!, input) : undefined });
    // D6: vừa đọc một skill của danh mục (chưa kiểm chứng) → hạ quyền ghi connector và dùng Chrome của người dùng cho phần còn lại của lượt,
    // và ghi dấu cho cả cuộc trò chuyện: hướng dẫn của skill nằm lại trong lịch sử, các lượt sau (convUntrusted lúc dựng Exec) vẫn hạ quyền.
    if (r.used.untrusted) { x.untrusted = true; markConvUntrusted(x.uid, x.conv); }
    return r;
  }
  const used = { kind: "tool" as const, name: usedName(ct, c.input, x.sess!.uid) };
  const lbl = cxOf(ct, c.input, x.sess!.uid);
  if (x.task && (x.sess!.perm(c.name, c.input) === "ask" || untrustedConnWrite(x, c))) return { content: queueTool(x.uid, x.task, c, lbl ? { connector: lbl.app, title: lbl.act } : { connector: ct.cname, title: toolTitle(ct) }), is_error: true, used };
  if (d === "deny") return { content: x.denied?.get(c.id) ?? REFUSED, is_error: true, used };
  const meta = x.calls?.get(c.id), run = runSignal();
  const stops = [run, meta?.cancel].filter((v): v is AbortSignal => !!v);
  // Qua cầu nối: công cụ chỉ được chạy trong phần còn lại của hạn CLI (đã trừ lúc chờ duyệt).
  const r = await x.sess!.call(c.name, c.input, stops.length > 1 ? AbortSignal.any(stops) : stops[0], meta ? Math.min(TOOL_BUDGET, Math.max(TOOL_MIN, BRIDGE_CALL_MAX - (Date.now() - meta.at))) : undefined);
  if (r.reconnect) showReconnect(x, r.reconnect);
  if (r.rateUntil) progress("rate", JSON.stringify({ name: ct.cname, until: r.rateUntil }));
  if (ct.composio) showLinks(x, r.content);
  const out = connectorImage(x, ct, c, r);
  // Người dùng sửa tham số trước khi duyệt: model biết công cụ đã chạy với tham số nào (không phải tham số nó đề xuất).
  if (x.edited?.has(c.id)) out.content = `[Người dùng đã sửa tham số trước khi cho phép. Công cụ đã chạy với tham số: ${JSON.stringify(c.input).slice(0, 1500)}]\n${out.content}`;
  return { is_error: r.is_error, ...out, used };
}

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
  if (c.name === IMAGE_TOOL_NAME && x.image) return `Đang tạo ảnh: ${String(c.input?.prompt ?? "").replace(/\s+/g, " ").slice(0, 100)}`;
  if (c.name === "web_search" && x.search) return `Đang tìm trên web: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_search") return `Đang nhớ lại: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (c.name === "brain_read") return `Đang đọc ghi chú ${String(c.input?.title ?? "").slice(0, 80)} trong bộ não`;
  if (c.name === "brain_write") return `Đang ghi vào bộ não: ${String(c.input?.title ?? "").slice(0, 80)}`;
  if (c.name === RECONNECT_TOOL.name && x.sess && !x.sess.get(c.name)) return "Đang hiện nút kết nối lại";
  if (c.name === CONN_FIND && x.sess && !x.sess.get(c.name)) return `Đang tìm công cụ connector: ${String(c.input?.query ?? "").slice(0, 120)}`;
  if (x.browse && isBrowserTool(c.name)) return describeBrowser(c.name, c.input ?? {}, browserTargetOf(c.input, x.bctx));
  const ct = x.sess?.get(c.name);
  const cx = ct && cxOf(ct, c.input, x.sess?.uid);
  if (cx) return `Đang dùng ${cx.app} · ${cx.act}`;
  return ct ? `Đang dùng ${ct.cname}: ${ct.tool.title || ct.tool.name}` : `Đang dùng công cụ ${c.name}`;
}
// Công cụ lấy dữ liệu (connector, chạy code, script của skill): kết quả lớn lưu theo tham chiếu và có trong dấu vết của lượt.
// Công cụ đọc skill không tính (đó là hướng dẫn, không phải dữ liệu).
const isData = (x: Exec, c: Call) => c.name === PROJECT_DOC_TOOL.name || !!x.sess?.get(c.name) || c.name === "run_code" || c.name === "run_skill_script" || c.name === IMAGE_TOOL_NAME;
const label = (x: Exec, c: Call) => describe(x, c).replace(/^Đang (dùng |chạy )?/, "");
// Loại công cụ của một bước (worktone.ts → toolKind): tên công cụ thật; Composio chạy mọi thao tác qua một công cụ chung nên kèm ứng dụng · thao tác
// ("Gmail · gửi thư" và "Gmail · tìm thư" là hai loại: tìm thư thành công không bù cho gửi thư lỗi).
const kindOf = (x: Exec, c: Call) => { const ct = x.sess?.get(c.name); const cx = ct && cxOf(ct, c.input, x.sess!.uid); return cx ? `${c.name}|${cx.app} · ${cx.act}` : c.name; };
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException("Đã dừng", "AbortError"));
  return new Promise((ok, no) => {
    const f = () => no(new DOMException("Đã dừng", "AbortError"));
    signal.addEventListener("abort", f, { once: true });
    p.then((v) => { signal.removeEventListener("abort", f); ok(v); }, (e) => { signal.removeEventListener("abort", f); no(e); });
  });
}
export const isAbort = (e: unknown) => (e as Error)?.name === "AbortError" || !!runSignal()?.aborted;
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
export async function execute(ad: Adapter, m: unknown[], x: Exec, calls: Call[], used: ToolRun["used"][], d: Record<string, Decision>) {
  noteEffects(x, calls, d);
  const seqs = calls.map((c) => (c.name === "update_plan" ? 0 : progress("tool", describe(x, c))));
  // Vòng này model tự dùng trình duyệt: web_search cùng vòng không tự mở trang (escalateSearch), để không giành trình duyệt với model.
  x.roundBrowser = !!x.browse && calls.some((c) => isBrowserTool(c.name) && !x.sess?.get(c.name));
  // Dòng công cụ connector trong khung chat có logo của connector (icon ngắn; icon tự tìm dạng data URI dài thì dùng biểu tượng trang qua proxy).
  calls.forEach((c, i) => {
    const ct = seqs[i] ? x.sess?.get(c.name) : undefined;
    if (!ct) return;
    const lg = callLogo(ct, c.input, x.sess?.uid);
    progress("tconn", JSON.stringify({ ref: seqs[i], name: cxOf(ct, c.input, x.sess?.uid)?.app ?? ct.cname, ...lg, ...(lg.icon && lg.icon.length >= 200 ? { icon: undefined } : {}) }));
  });
  let res: Run[];
  try {
    res = await abortable(Promise.all(calls.map((c) => span(`tool ${c.name}`, "tool", () => runCall(x, c, d[c.id]), { "tool.name": c.name }))), runSignal());
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
  // Công cụ của connector (đọc lẫn ghi): kèm tham số đã gửi (che khóa bí mật) để người dùng biết model vừa làm gì. Tóm tắt bỏ thẻ <ref> nội bộ.
  res.forEach((r, i) => { if (seqs[i]) progress("res", JSON.stringify({ ref: seqs[i], ok: !r.is_error, name: kindOf(x, calls[i]).slice(0, 160), sum: (r.sum ?? plainSummary(String(r.content ?? ""))).slice(0, 140), ...(x.sess?.get(calls[i].name) && d[calls[i].id] !== "deny" ? { args: argLine(calls[i].input) } : {}) })); });
  m.push(...ad.results(calls, res));
  // Người dùng nhắn thêm trong lúc công cụ chạy: ghép vào ngay bước kế tiếp, không ngắt việc.
  const more = takeInbox();
  if (more.length) { for (const t of more) progress("steer", t); addFollowup(m, more.join("\n\n")); }
}

export async function toolLoop(ad: Adapter, m: unknown[], x: Exec, used: ToolRun["used"][], uid: string, model: string, start = 0): Promise<Out> {
  try { return await loop(ad, m, x, used, uid, model, start); }
  catch (e) {
    if (!isAbort(e)) throw e;
    // Dừng giữa chừng: giữ phần đã viết, lượt kết thúc bình thường (không phải lỗi).
    x.sess?.close();
    return { text: settleGate(x, liveNow(), true), used, cancelled: true };
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
      // Lỗi khi model đang sửa theo lời nhắc <auto_check>: vẫn giao câu trả lời đã viết xong trước đó.
      if (!steered()) { if (x.held && !isAbort(e)) return { text: settleGate(x, "", true), used }; throw e; }
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
      // Bộ slide trong câu trả lời: tự kiểm bản cuối (tràn khung 1280×720, đánh số lệch), có lỗi thì cho model sửa trước khi giao.
      // Câu trả lời đã viết được giữ cho người dùng; lượt sau lời nhắc chỉ để sửa, cuối lượt gộp lại (settleGate).
      // Sản phẩm thiết kế: tự kiểm bộ slide trước (một lần), rồi so với mẫu tham chiếu. Câu trả lời đầu tiên được giữ
      // cho người dùng; lần sửa sau đó (đã có câu giữ) chỉ đóng góp artifact, nên tách artifact vào turnArts để bản
      // sửa không mất khi gộp (settleGate).
      if (i < steps - 1 && x.design && x.art) {
        const g = x.deckGated ? null : await deckGate(x, r.text);
        const dg = g ? null : await designGate(x, r.text);
        if (g || dg) {
          if (x.held) sayOut(x, r.text);
          else holdAnswer(x, r.text);
          const review = dg && ad.user ? ad.user(dg.blocks) : { role: "user", content: dg?.text ?? "" };
          m.push(g ? { role: "user", content: g } : review);
          continue;
        }
      }
      if (i < steps - 1 && x.art && !x.deckGated) {
        const g = await deckGate(x, r.text);
        if (g) { holdAnswer(x, r.text); m.push({ role: "user", content: g }); continue; }
      }
      return { text: settleGate(x, r.text), used };
    }
    acted = true;
    r.calls = r.calls.map((c) => unwrapConn(x, c));
    // Lời dẫn trước khi dùng công cụ: giữ lại trong khung chat (bước sau không xóa mất).
    sayOut(x, r.text);
    const ask = x.task ? [] : r.calls.filter((c) => needsAsk(x, c));
    if (ask.length) {
      sweep();
      const id = randomToken(18);
      parkApproval(id, { uid, model, ad, m, calls: r.calls, used, step: i, x, at: Date.now() });
      return {
        approval: {
          id, calls: ask.map((c) => {
            const ct = x.sess!.get(c.name)!;
            const input = JSON.stringify(c.input ?? {});
            const cx = ct.composio ? cxCard(ct.tool.name, c.input, uid) : null;
            return {
              id: c.id, connector: { id: ct.cid, name: ct.cname, ...callLogo(ct, c.input, uid) },
              tool: { name: ct.tool.name, title: cx?.act ?? toolTitle(ct), description: (ct.tool.description ?? "").slice(0, 400), destructive: destructiveLike(ct.tool) },
              ...(cx ? { cx } : {}),
              input: input.length > 20_000 ? { _: input.slice(0, 20_000) + "…" } : c.input ?? {},
              // Sửa tham số trước khi duyệt: chỉ khi tham số gửi đủ; schema để thẻ kiểm tra ngay (máy chủ kiểm tra lại khi chạy tiếp).
              ...(input.length <= 20_000 ? { editable: true, schema: resolveRefs(ct.tool.inputSchema ?? {}) } : {}),
            };
          }),
        },
      };
    }
    await execute(ad, m, x, r.calls, used, {});
  }
  // Hết bước khi đang sửa theo lời nhắc <auto_check>: giao câu trả lời đã viết xong trước đó.
  if (x.held) return { text: settleGate(x, "", true), used };
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
export const CONN_FIND = "connector_tools", CONN_CALL = "connector_call";
const proxyOf = new WeakMap<ConnectorSession, boolean>();
export function connProxy(s: ConnectorSession) {
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
export const connTools = (s: ConnectorSession, gemini: boolean) => [...(connProxy(s) ? connProxyTools(gemini) : connectorToolDefs(s, gemini)), ...(s.offline.some((o) => o.why !== "vendor") ? [RECONNECT_TOOL] : [])];
// Người dùng nhắc tới một connector đang mất kết nối: hiện nút kết nối lại ngay từ đầu lượt.
export function announceOffline(x: Exec, messages: unknown) {
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
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
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
// Thư viện đã dùng trong lượt: chế độ studio đang bật (nếu có), rồi các thư viện model tự mở, kèm skill đã đọc trong từng thư viện.
export function usedLibs(x: Exec, used: string[]) {
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
export function reply(c: { user: { id: string } }, model: string, out: Out, x: Exec) {
  if ("approval" in out) return Response.json({ model, approval: out.approval });
  x.sess?.close();
  const usedNames = out.used.filter((u) => u.kind === "skill").map((u) => u.name);
  recordUse(c.user.id, usedNames);
  recordPluginUse(x.list.filter((k) => k.user_id.startsWith("pl_") && usedNames.includes(k.name)).map((k) => k.id));
  return Response.json({ model, text: withTurnArts(x, out.text), skills: out.used, files: x.outs, libs: usedLibs(x, usedNames), ...(x.trace.length ? { trace: x.trace } : {}), ...(out.cancelled ? { cancelled: true } : {}), ...(x.webs?.size ? { webSources: [...x.webs.values()] } : {}) });
}

// Bản sửa artifact (mode="patch") phải áp được vào bản hiện tại. Còn khối không khớp khi model định trả lời xong thì
// nhắc đúng một lần, nêu từng khối hỏng và chỗ gần giống nhất, chỉ xin gửi lại các khối đó rồi ghép vào bản sửa gốc
// (shared/patchheal.ts). Gửi lại vẫn không khớp thì giữ câu trả lời; trình duyệt hiện bản sửa lỗi kèm nút yêu cầu viết
// lại toàn bộ.
type Hist = { role: string; content: unknown }[];
const assistantTexts = (history: Hist) => history
  .filter((h) => h.role === "assistant" || h.role === "ai")
  .map((h) => (typeof h.content === "string" ? h.content : ""));
/** Trạng thái artifact trước lượt này: lịch sử đoạn chat cùng phần đã nén trình duyệt gửi kèm. */
export const priorArts = (history: Hist, base: ArtVersion[]): ArtState =>
  artState(assistantTexts(history), base);
/** Chữ của lượt theo thứ tự: artifact viết giữa lượt (trừ khối câu trả lời đã có), rồi câu trả lời. */
const turnTexts = (x: Exec | null | undefined, text: string) =>
  [...(x?.turnArts ?? []).filter((b) => !text.includes(b)), text];
/** Lời nhắc sửa lại bản sửa hỏng cho câu trả lời text; null khi mọi bản sửa đều áp được. */
export function patchHealAsk(prior: () => ArtState, x: Exec | null | undefined, text: string): string | null {
  if (!/mode\s*=\s*["']patch/i.test([...(x?.turnArts ?? []), text].join("\n"))) return null;
  const texts = turnTexts(x, text), bad = failingPatches(prior(), texts);
  if (!bad.length) return null;
  if (x) x.patchFailedFirst = patchStats(prior(), texts).failed;
  return HEAL_ASK(bad.map((b) => patchReport(b.r)));
}
/** Ghép lần gửi lại vào câu trả lời và vào artifact viết giữa lượt. Khối của lần gửi lại mà CLI đã tách vào turnArts
 *  (gọi công cụ trong lúc sửa) được bỏ: nó đã nằm trong bản sửa ghép. */
export function patchHealMerge(prior: () => ArtState, x: Exec | null | undefined, text: string, reply: string): string {
  const swaps = healFold(prior(), turnTexts(x, text), reply);
  if (x?.turnArts) x.turnArts = x.turnArts.filter((b) => !reply.includes(b)).map((b) => applySwaps(b, swaps));
  if (x) x.patchHeal = swaps.length ? "ok" : "fail";
  return applySwaps(text, swaps);
}
export async function healPatch(
  ad: Adapter, m: unknown[], x: Exec | null, history: Hist, out: Out, base: ArtVersion[] = [],
): Promise<Out> {
  if ("approval" in out || out.cancelled) return out;
  let st: ArtState | undefined;
  const prior = () => (st ??= priorArts(history, base));
  const ask = patchHealAsk(prior, x, out.text);
  if (!ask) return out;
  progress("step", "Đang sửa lại bản sửa artifact cho khớp");
  deltaStep();
  m.push({ role: "user", content: ask });
  try {
    const r = await ad.step(m, true);
    m.push(r.assistant);
    return { ...out, text: patchHealMerge(prior, x, out.text, r.text) };
  } catch (e) {
    if (isAbort(e)) return { ...out, cancelled: true };
    throw e;
  }
}

