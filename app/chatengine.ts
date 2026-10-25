import { enabledSkills, recordUse } from "./skillstore";
import { MAX_STEPS, runSkillTool, skillsPrompt, skillTools, type ToolRun } from "./skillruntime";
import { limit, type UserRow } from "./authstore";
import { clampEffort, isEffort, legacyModel, type Effort } from "./catalog";
import { catalog, mainModels, pickDefault, resolveModel, type Target } from "./providers";
import { ConnectorSession, connectorsPrompt } from "./connectors";
import { randomToken } from "./mcpauth";
import { capsState, skillsOn } from "./caps";
import { overLimit, usageScope } from "./usage";
import { delta, deltaStep, liveNow, progress, registerExec, runSignal } from "./runs";
import { prepareHistory, type TraceItem } from "./transpile";
import { maybeRef, READ_REF_TOOL, readRef } from "./refs";
import { artState, resolveArt } from "./vfs";
import { splitArtifacts } from "./artifacts";
import { AUTO, routeModel } from "./router";
import { ALL } from "./catalog";
import { everywhereSkills, libraryPlugins, recordPluginUse, STUDIOS, studioOf, studioSkills, type Studio } from "./plugins";
import { STUDIO_LABEL } from "./plugindir";
import { suggest, type Hit } from "./skillroute";
import type { Skill } from "./skillstore";
import { CODE_RULES, execRun, LANGS, runCodeTool, type Lang } from "./coderun";
import { saveOutputs, type OutFile } from "./outputs";
import { ARTIFACT_RULES, ASK_RULES, VIZ_RULES } from "./artifacts";
import { anthropicCall, chatOnce, effortParams, HttpErr, openaiCall, outCap, respInput, respParse, respTools, responsesCall, toAnthropic, toOpenAI, withPages } from "./llmcall";

// Bộ xử lý chat (chỉ chạy ở máy chủ), dùng chung cho /api/llm (chờ kết quả) và lượt chạy nền (runs.ts).
// Model nào gọi tới nhà cung cấp nào do khóa API nhập ở Cài đặt → API quyết định.

// ---------------------------------------------------------------- vòng lặp tool cho skill
type Call = { id: string; name: string; input: Record<string, unknown> };
type Step = { text: string; calls: Call[]; assistant: unknown };
type Adapter = { step: (msgs: unknown[], noTools: boolean) => Promise<Step>; results: (calls: Call[], res: ToolRun[]) => unknown[] };
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
    const j = await anthropicCall(t, {
      max_tokens: outCap(t, max_tokens), ...effortParams(t, effort),
      system: [{ type: "text", text: system || "Bạn là một trợ lý AI hữu ích." }, { type: "text", text: skillSys, cache_control: { type: "ephemeral" } }],
      tools, ...(noTools ? { tool_choice: { type: "none" } } : {}), messages: withCacheMark(msgs, hist),
    }, runSignal(), live());
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
    }, runSignal(), live());
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
    const r = respParse(await responsesCall(t, { instructions: system, max_output_tokens: outCap(t, max_tokens), ...effortParams(t, effort), input: respInput(msgs), tools: respTools(tools), ...(noTools ? { tool_choice: "none" } : {}) }, runSignal(), live()));
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

// ---------------------------------------------------------------- vòng lặp công cụ (skill + connector)
// code: công cụ run_code đang bật (net: được tải gói từ kho thư viện); outs: tệp code đã tạo trong lượt này.
// libs: skill (và mục thư viện) → thư viện chứa nó, để câu trả lời hiện "Thư viện Thiết kế · skill đã đọc". studio: chế độ người dùng chọn bằng nút.
type Lib = { key: string; label: string };
// trace: dấu vết công cụ của lượt theo chuẩn Synchro (trả về trình duyệt, lượt sau gửi lại để model nào cũng biết đã làm gì).
type Exec = { list: Skl; scripts: boolean; sess: ConnectorSession | null; uid: string; code: boolean; net: boolean; outs: OutFile[]; libs?: Record<string, Lib[]>; studio?: Lib; prefer?: Record<string, string>; trace: TraceItem[]; conv?: string };
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

async function runCall(x: Exec, c: Call, d?: Decision): Promise<ToolRun> {
  if (c.name === "read_ref" && !x.sess?.get(c.name)) return { ...readRef(x.uid, c.input), used: { kind: "search", name: "read_ref" } };
  if (c.name === "run_code" && !x.sess?.get(c.name)) return runCode(x, c.input);
  const ct = x.sess?.get(c.name);
  if (!ct) return runSkillTool(x.list, c.name, c.input, x.scripts, { uid: x.uid, net: x.net });
  const used = { kind: "tool" as const, name: `${ct.cname}: ${ct.tool.title || ct.tool.annotations?.title || ct.tool.name}` };
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
  for (const c of calls) progress("tool", describe(x, c));
  let res: ToolRun[];
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
  m.push(...ad.results(calls, res));
}

async function toolLoop(ad: Adapter, m: unknown[], x: Exec, used: ToolRun["used"][], uid: string, model: string, start = 0): Promise<Out> {
  try { return await loop(ad, m, x, used, uid, model, start); }
  catch (e) {
    if (!isAbort(e)) throw e;
    // Dừng giữa chừng: giữ phần đã viết, lượt kết thúc bình thường (không phải lỗi).
    x.sess?.close();
    return { text: liveNow(), used, cancelled: true };
  }
}
async function loop(ad: Adapter, m: unknown[], x: Exec, used: ToolRun["used"][], uid: string, model: string, start = 0): Promise<Out> {
  for (let i = start; i < MAX_STEPS; i++) {
    if (i > 0) { progress("step", "Đang viết câu trả lời"); deltaStep(); }
    const r = await ad.step(m, i === MAX_STEPS - 1);
    m.push(r.assistant);
    if (!r.calls.length) return { text: r.text, used };
    const ask = r.calls.filter((c) => needsAsk(x, c));
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
function patchProblems(history: { role: string; content: unknown }[], text: string): string[] {
  if (!/mode\s*=\s*["']patch/i.test(text)) return [];
  const st = artState(history.filter((h) => h.role === "assistant" || h.role === "ai").map((h) => (typeof h.content === "string" ? h.content : "")));
  const out: string[] = [];
  for (const sg of splitArtifacts(text)) if (sg.kind === "art" && sg.art.patch) {
    const r = resolveArt(st.get(sg.art.ident), sg.art);
    if (r.fix?.failed.length) out.push(`${sg.art.ident}: ${r.fix.failed.map((f) => `"${f}"`).join(", ")}`);
    st.set(sg.art.ident, r);
  }
  return out;
}
async function healPatch(ad: Adapter, m: unknown[], history: { role: string; content: unknown }[], out: Out): Promise<Out> {
  if ("approval" in out || out.cancelled) return out;
  const bad = patchProblems(history, out.text);
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

type Who = { user: UserRow };
/** Một lượt gọi model: body là JSON trình duyệt gửi lên /api/llm. scope.feature được đặt lại theo loại lượt (tính mức dùng).
 *  model = "auto": Synchro chọn model theo độ khó của yêu cầu (router.ts) trong các model tài khoản được dùng, rồi chạy như bình thường. */
export async function chatPost(body: Record<string, any>, c: Who, scope: { feature: string }): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (body.model !== AUTO || typeof body.resume === "string") return chatTurn(body, c, scope);
  const cat = await catalog(), main = mainModels();
  const allowed = cat.flatMap((p) => p.models.map((m) => m.key)).filter((k) => main.includes(ALL) || main.includes(k));
  const msgs = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const lastUser = [...msgs].reverse().find((m) => m?.role === "user");
  const attachments = Array.isArray(lastUser?.content) ? (lastUser!.content as { type?: string }[]).filter((b) => b?.type && b.type !== "text").length : 0;
  const r = routeModel({ text: lastUserText(msgs), attachments, turns: msgs.length, studio: !!studioOf(body.studio) }, allowed);
  if (!r) return Response.json({ error: "Chưa có model nào ở bộ chọn model. Hãy chọn model hiện ở Cài đặt → API." }, { status: 503 });
  const res = await chatTurn({ ...body, model: r.model }, c, scope);
  const j = await res.json().catch(() => ({}));
  return Response.json({ ...j, model: j.model ?? r.model, auto: { tier: r.tier, why: r.why } }, { status: res.status });
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
  const { system, messages, max_tokens = 1500, skills, model: picked, feature, project, effort: wanted, conv } = body;
  scope.feature = feature === "artifact" ? "artifact" : feature === "code" ? "code" : skills ? "chat" : "internal";
  const model = (typeof picked === "string" && picked ? legacyModel(picked) : null) || pickDefault(await catalog(), mainModels());
  if (!model) return Response.json({ error: "Synchro chưa được kết nối với model nào. Hãy nhập khóa API ở Cài đặt → API." }, { status: 503 });
  const t = await resolveModel(model);
  if (!t) return Response.json({ error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác." }, { status: 400 });
  // Mức nỗ lực đã chọn, hạ về mức gần nhất model hỗ trợ (Gemini chỉ tới Cao).
  const effort = isEffort(wanted) ? clampEffort(wanted, "max", t.kind) : undefined;
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
  const studio = skills ? studioOf(body.studio) : null;
  const st = studio ? studioSkills(c.user.id, studio) : null;
  const capSys = cs ? [feature !== "code" ? ASK_RULES : "", cs.caps.art ? ARTIFACT_RULES(cs.caps.ai) : "", cs.caps.inl ? VIZ_RULES : "", cs.caps.code ? CODE_RULES(cs.caps.net) : "", studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : ""].filter(Boolean).join("\n\n") : "";
  // Lịch sử theo chuẩn Synchro → tin nhắn sẵn sàng cho mọi hãng (tầng động ở cuối prompt).
  const prep = prepareHistory(messages);
  const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
  let sess: ConnectorSession | null = null;
  try {
    const list = skills && skillsOn(c.user) ? [...await enabledSkills(c.user.id, project ? String(project) : null), ...everywhereSkills(c.user.id)] : [];
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
    if (skills && skillsOn(c.user)) {
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
    // Connector chỉ dùng trong lượt chat chính (skills = true), không dùng cho các lệnh nội bộ như tóm tắt bộ nhớ.
    if (skills && t.kind !== "mock") { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project }); if (!sess.tools.length) sess = null; }
    const code = !!cs?.caps.code && t.kind !== "mock";
    // read_ref: đọc dữ liệu lớn đã lưu theo tham chiếu (ở lượt này hoặc các lượt trước, kể cả khi đổi model).
    const refs = !!skills && t.kind !== "mock" && (!!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(prep.messages)));
    if (visible.length || sess || code || refs) {
      // Chạy script của skill chỉ khi máy chủ có nơi chạy code và người dùng bật "Chạy code và tạo tệp".
      const scripts = code;
      const sk = [capSys, skillsPrompt(visible, scripts), route, sess ? connectorsPrompt(sess) : ""].filter(Boolean).join("\n\n");
      const tools = [...(code ? [runCodeTool(!!cs?.caps.net)] : []), ...(visible.length ? skillTools(visible.length, scripts) : []), ...(sess ? connectorToolDefs(sess, t.kind === "google") : []), ...(refs ? [READ_REF_TOOL] : [])];
      const x: Exec = { list: [...visible, ...list.filter((k) => !visible.includes(k))], scripts, sess, uid: c.user.id, code, net: !!cs?.caps.net, outs: [], libs, studio: studio ? libs[`studio-${studio}`][0] : undefined, prefer, trace: [], conv: convId };
      const msgs = prep.messages;
      const ad = t.kind === "mock" ? mockAdapter(list)
        : t.kind === "anthropic" ? anthropicAdapter(t, system, sk, max_tokens, tools, effort, prep.historyEnd)
        : (t.kind === "openai" ? responsesAdapter : openaiAdapter)(t, `${system}\n\n${sk}`, max_tokens, tools, effort);
      const m0: unknown[] = t.kind === "mock" ? [...msgs] : t.kind === "anthropic" ? msgs.map((m) => ({ ...m, content: toAnthropic(m.content) })) : msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }));
      // Kiểm tra bản sửa trên lịch sử gốc (bản đã rút gọn không còn nội dung artifact cũ).
      const raw = (Array.isArray(messages) ? messages : []) as { role: string; content: unknown }[];
      const out = await healPatch(ad, m0, raw, await toolLoop(ad, m0, x, [], c.user.id, model));
      return reply(c, model, out, x);
    }
    if (t.kind === "mock") return Response.json({ model, text: "[mock] Không có skill nào đang bật." });
    let text: string, cancelled = false;
    try { text = await chatOnce(t, capSys ? `${system || "Bạn là một trợ lý AI hữu ích."}\n\n${capSys}` : system, prep.messages, max_tokens, runSignal(), effort, live()); }
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
  const over = overLimit(user);
  if (over) return { http: 429, json: { error: over, usageLimit: true } };
  const scope = { uid: user.id, feature: "chat" };
  const res = await usageScope.run(scope, () => chatPost(body, { user }, scope));
  return { http: res.status, json: await res.json() };
});
