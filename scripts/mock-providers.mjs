// Máy chủ giả lập API của các hãng AI (Anthropic, OpenAI, Gemini, xAI, DeepSeek, ElevenLabs) để thử Synchro ở máy cục bộ mà không cần khóa thật.
// Kiểm tra khóa và tham số giống API thật, trả lời bằng nội dung mẫu kèm tên model để thấy rõ đang dùng model nào.
// Dùng: npm run dev:mock (tự chạy cùng web), hoặc riêng: node scripts/mock-providers.mjs [cổng, mặc định 4010]
// Khóa hợp lệ: bất kỳ khóa nào có chữ "mock". Gõ #401, #404, #429, #500 hoặc #slow trong tin nhắn để thử các lỗi; #waittool làm chậm bước gọi công cụ.
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { capsReply, codeDone, revReply, studioStep } from "./mock-caps.mjs";
import { EL, elevenHandler, scribeConnect } from "./mock-eleven.mjs";
const CLI = createRequire(import.meta.url)("./mock-cli/mock-cli-common.cjs");

// Khóa mà npm run dev:mock tự nhập vào Cài đặt → Providers.
export const MOCK_KEYS = { anthropic: "sk-ant-mock-local-0001", openai: "sk-mock-openai-0001", google: "AIza-mock-gemini-0001", xai: "xai-mock-grok-local-0001", deepseek: "sk-mock-deepseek-0001", elevenlabs: "sk_mock_eleven_0001" };

// Danh sách model như API thật của từng hãng trả về (theo tài liệu tháng 10/2026), gồm cả model không dùng để nhắn tin mà Synchro phải tự lọc bỏ.
const ANTHROPIC = [["claude-fable-5-1", "Claude Fable 5.1"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-fable-5", "Claude Fable 5"], ["claude-opus-5", "Claude Opus 5"], ["claude-sonnet-5", "Claude Sonnet 5"], ["claude-opus-4-8", "Claude Opus 4.8"], ["claude-opus-4-7", "Claude Opus 4.7"],
  ["claude-opus-4-6", "Claude Opus 4.6"], ["claude-sonnet-4-6", "Claude Sonnet 4.6"], ["claude-opus-4-5-20251101", "Claude Opus 4.5"], ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"]];
// Mới nhất trước. Model -pro chỉ chạy được qua API Responses, giống API thật.
const OPENAI = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "chat-latest", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5", "gpt-5-pro", "gpt-5-mini", "gpt-5-nano", "o3-pro", "o3", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini",
  "gpt-image-2.5-sunburst", "gpt-image-2", "gpt-live-1", "gpt-realtime-2.1", "gpt-realtime-translate", "gpt-transcribe", "gpt-audio-1.5", "gpt-4o-mini-tts", "whisper-1", "tts-1",
  "gpt-5.6-cyber", "gpt-rosalind-research", "gpt-oss-120b", "gpt-5.3-codex", "gpt-4o-2024-08-06", "text-embedding-3-large", "omni-moderation-latest"];
const OPENAI_CHAT = OPENAI.slice(0, OPENAI.indexOf("gpt-image-2.5-sunburst"));
const GOOGLE = [["gemini-4-argon", "Gemini 4 Argon", "generateContent"], ["gemini-3.8-flash", "Gemini 3.8 Flash", "generateContent"], ["gemini-3.6-flash", "Gemini 3.6 Flash", "generateContent"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "generateContent"], ["gemini-3.1-pro-preview", "Gemini 3.1 Pro", "generateContent"], ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "generateContent"],
  ["gemini-3-flash-preview", "Gemini 3 Flash", "generateContent"], ["gemini-2.5-pro", "Gemini 2.5 Pro", "generateContent"], ["gemini-2.5-flash", "Gemini 2.5 Flash", "generateContent"], ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", "generateContent"],
  ["gemini-3.8-live", "Gemini 3.8 Live", "bidiGenerateContent"], ["gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS", "generateContent"], ["gemini-3.1-flash-image", "Nano Banana 2", "generateContent"],
  ["gemini-3-pro-image", "Nano Banana Pro", "generateContent"], ["gemini-3.5-transcribe", "Gemini 3.5 Transcribe", "generateContent"], ["gemini-omni-1.1-flash", "Gemini Omni Flash", "generateContent"],
  ["gemini-robotics-er-2-preview", "Gemini Robotics ER 2", "generateContent"], ["gemini-embedding-2-preview", "Gemini Embedding 2", "embedContent"], ["lyria-3.5", "Lyria 3.5", "generateContent"],
  ["deep-research-preview-04-2026", "Gemini Deep Research", "generateContent"]];
// xAI: /v1/models trả cả model đời cũ, model tạo ảnh / video (Synchro tự lọc bỏ). DeepSeek: /models chỉ có mã model.
const XAI = ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning", "grok-build-0.1", "grok-4-fast-reasoning", "grok-3", "grok-3-mini", "grok-code-fast-1", "grok-imagine-image", "grok-imagine-video"];
const XAI_EFFORT = /^grok-4\.[5-9]/;
const DEEPSEEK = ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"];
const VENDOR = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", deepseek: "DeepSeek" };
const EFF = ["low", "medium", "high", "xhigh", "max"];

// Như API thật: phản hồi thành công kèm số token đã dùng (usage) và header hạn mức token mỗi phút của tổ chức,
// để Synchro tính mức dùng và hiện hạn mức API trong vòng tròn usage.
const RATE = { anthropic: { limit: 400_000, used: 0, start: 0 }, openai: { limit: 2_000_000, used: 0, start: 0 } };
const inTok = (b) => Math.ceil(JSON.stringify([b?.system, b?.instructions, b?.messages, b?.input, b?.tools]).length / 4);
function meter(res, obj) {
  const prov = res.__prov, b = res.__body;
  if (!prov || !obj || obj.error || obj.type === "error") return obj;
  const input = inTok(b), output = Math.ceil(JSON.stringify(obj.content ?? obj.output ?? obj.choices ?? "").length / 3.5);
  if (prov === "anthropic" && obj.type === "message") obj.usage = { input_tokens: Math.round(input * 0.3), cache_read_input_tokens: Math.round(input * 0.7), cache_creation_input_tokens: 0, output_tokens: output };
  if (prov === "openai" && obj.object === "response") obj.usage = { input_tokens: input, input_tokens_details: { cached_tokens: Math.round(input * 0.5) }, output_tokens: output };
  // DeepSeek báo phần đọc từ cache riêng (prompt_cache_hit_tokens); Grok tính token suy nghĩ ngoài completion_tokens (chỉ có trong total_tokens).
  if (obj.object === "chat.completion") obj.usage = prov === "deepseek" ? { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_cache_hit_tokens: Math.round(input * 0.6), prompt_cache_miss_tokens: input - Math.round(input * 0.6) }
    : prov === "xai" ? { prompt_tokens: input, completion_tokens: output, total_tokens: input + output + 40, prompt_tokens_details: { cached_tokens: Math.round(input * 0.5) }, completion_tokens_details: { reasoning_tokens: 40 } }
    : { prompt_tokens: input, completion_tokens: output };
  const r = RATE[prov];
  if (r) {
    const now = Date.now();
    if (now - r.start >= 60_000) { r.start = now; r.used = 0; }
    r.used = Math.min(r.limit, r.used + input + output);
    const reset = r.start + 60_000;
    if (prov === "anthropic") { res.setHeader("anthropic-ratelimit-tokens-limit", r.limit); res.setHeader("anthropic-ratelimit-tokens-remaining", r.limit - r.used); res.setHeader("anthropic-ratelimit-tokens-reset", new Date(reset).toISOString()); }
    else { res.setHeader("x-ratelimit-limit-tokens", r.limit); res.setHeader("x-ratelimit-remaining-tokens", r.limit - r.used); res.setHeader("x-ratelimit-reset-tokens", `${Math.ceil((reset - now) / 1000)}s`); }
  }
  return obj;
}
// Như API thật: yêu cầu có stream: true thì trả SSE đúng định dạng từng hãng (chữ đến từng đoạn nhỏ).
// Gõ #streamslow để chữ đến chậm (thử nút Dừng). STREAMS đếm luồng đã mở / chạy hết / bị client ngắt giữa chừng.
const STREAMS = { started: 0, completed: 0, aborted: 0 };
const isModel = (o) => o && (o.type === "message" || o.object === "response" || o.object === "chat.completion");
const pieces = (t, n) => { const out = []; for (let i = 0; i < t.length; i += n) out.push(t.slice(i, i + n)); return out; };
async function streamOut(res, obj) {
  const b = res.__body, prov = res.__prov, gap = res.__slow ? 150 : 8;
  STREAMS.started++;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let closed = false;
  res.on("close", () => { if (!res.writableEnded) closed = true; });
  const ev = (event, data) => { if (!closed) res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`); };
  const tick = async () => { await sleep(gap); return closed; };
  const quit = () => { STREAMS.aborted++; };
  if (prov === "anthropic") {
    ev("message_start", { type: "message_start", message: { ...obj, content: [], stop_reason: null, usage: { ...(obj.usage ?? {}), output_tokens: 1 } } });
    for (const [i, blk] of (obj.content ?? []).entries()) {
      if (blk.type === "text") {
        ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
        for (const p of pieces(blk.text ?? "", 12)) { if (await tick()) return quit(); ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: p } }); }
      } else if (blk.type === "tool_use" || blk.type === "server_tool_use") {
        ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: blk.type, id: blk.id, name: blk.name, input: {} } });
        for (const p of pieces(JSON.stringify(blk.input ?? {}), 16)) { if (await tick()) return quit(); ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: p } }); }
      } else ev("content_block_start", { type: "content_block_start", index: i, content_block: blk });
      ev("content_block_stop", { type: "content_block_stop", index: i });
    }
    ev("message_delta", { type: "message_delta", delta: { stop_reason: obj.stop_reason, stop_sequence: null }, usage: { output_tokens: obj.usage?.output_tokens ?? 0 } });
    ev("message_stop", { type: "message_stop" });
  } else if (obj.object === "response") {
    ev("response.created", { type: "response.created", response: { ...obj, status: "in_progress", output: [] } });
    for (const [oi, item] of (obj.output ?? []).entries()) {
      if (item.type !== "message") { ev("response.output_item.done", { type: "response.output_item.done", output_index: oi, item }); continue; }
      for (const p of pieces(item.content?.[0]?.text ?? "", 12)) { if (await tick()) return quit(); ev("response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: oi, content_index: 0, delta: p }); }
    }
    ev("response.completed", { type: "response.completed", response: obj });
  } else {
    const base = { id: obj.id, object: "chat.completion.chunk", model: obj.model };
    const m = obj.choices?.[0]?.message ?? {};
    ev(null, { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
    // Suy luận (DeepSeek, Grok) đến từng đoạn trong delta.reasoning_content, trước phần trả lời.
    for (const p of pieces(m.reasoning_content ?? "", 10)) { if (await tick()) return quit(); ev(null, { ...base, choices: [{ index: 0, delta: { reasoning_content: p }, finish_reason: null }] }); }
    for (const p of pieces(m.content ?? "", 12)) { if (await tick()) return quit(); ev(null, { ...base, choices: [{ index: 0, delta: { content: p }, finish_reason: null }] }); }
    for (const [k, tc] of (m.tool_calls ?? []).entries()) {
      const { function: fn, ...rest } = tc;
      ev(null, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: k, ...rest, function: { name: fn.name, arguments: "" } }] }, finish_reason: null }] });
      for (const p of pieces(fn.arguments ?? "", 16)) { if (await tick()) return quit(); ev(null, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: k, function: { arguments: p } }] }, finish_reason: null }] }); }
    }
    ev(null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: obj.choices?.[0]?.finish_reason ?? "stop" }] });
    if (b?.stream_options?.include_usage && obj.usage) ev(null, { ...base, choices: [], usage: obj.usage });
    ev(null, "[DONE]");
  }
  STREAMS.completed++;
  res.end();
}
const send = (res, code, obj) => {
  if (code === 200) obj = meter(res, obj);
  if (code === 200 && res.__body?.stream === true && isModel(obj)) { streamOut(res, obj).catch(() => {}); return; }
  res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj));
};

// Như API thật, lịch sử sai cấu trúc bị từ chối với lỗi 400 (để chắc Synchro không bao giờ gửi lịch sử hỏng khi đổi model).
const blocks = (m) => (Array.isArray(m?.content) ? m.content : []);
function anthropicShape(b) {
  const ms = b.messages ?? [];
  if (!ms.length || ms[0].role !== "user") return 'messages: first message must use the "user" role';
  let tools = false;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (i > 0 && m.role === ms[i - 1].role) return `messages: roles must alternate between "user" and "assistant", but found multiple "${m.role}" roles in a row`;
    if ((typeof m.content === "string" && !m.content.trim() || Array.isArray(m.content) && !m.content.length) && !(i === ms.length - 1 && m.role === "assistant")) return `messages.${i}: all messages must have non-empty content except for the optional final assistant message`;
    const uses = blocks(m).filter((x) => x.type === "tool_use").map((x) => x.id), res = blocks(m).filter((x) => x.type === "tool_result").map((x) => x.tool_use_id);
    if (uses.length || res.length) tools = true;
    const prevUses = blocks(ms[i - 1]).filter((x) => x.type === "tool_use").map((x) => x.id);
    const stray = res.find((r) => !prevUses.includes(r));
    if (stray) return `messages.${i}.content: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${stray}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`;
    if (uses.length && i < ms.length - 1) {
      const got = blocks(ms[i + 1]).filter((x) => x.type === "tool_result").map((x) => x.tool_use_id);
      const miss = uses.find((u) => !got.includes(u));
      if (miss) return `messages.${i + 1}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${miss}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`;
    }
  }
  if (tools && !b.tools?.length) return "Requests which include `tool_use` or `tool_result` blocks must define tools.";
  return null;
}
const geminiThinks = (id) => /^gemini-(3|4)/.test(id ?? "");
function chatShape(b, google) {
  const ms = b.messages ?? [];
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].role !== "tool") continue;
    const owner = ms.slice(0, i).reverse().find((x) => x.role !== "tool");
    if (owner?.role !== "assistant" || !(owner.tool_calls ?? []).some((t) => t.id === ms[i].tool_call_id)) return "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.";
  }
  // Gemini 3 trở lên: lời gọi hàm trong lượt hiện tại phải gửi lại kèm thought_signature đã nhận.
  if (google && geminiThinks(b.model)) {
    const lastUser = ms.map((m) => m.role).lastIndexOf("user");
    for (const m of ms.slice(lastUser + 1)) if (m.role === "assistant" && m.tool_calls?.length && !m.tool_calls[0]?.extra_content?.google?.thought_signature) return "Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance.";
  }
  return null;
}
// Giữ nguyên byte của body (tệp tải lên dạng multipart) ở req.__raw; body JSON thì đọc sẵn.
const readBody = (req) => new Promise((ok) => {
  const parts = [];
  req.on("data", (d) => parts.push(d));
  req.on("end", () => { req.__raw = Buffer.concat(parts); if (/multipart/.test(String(req.headers["content-type"] ?? ""))) return ok({}); try { ok(JSON.parse(req.__raw.toString("utf8") || "{}")); } catch { ok({}); } });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const valid = (k) => typeof k === "string" && k.includes("mock");
// Khóa ElevenLabs giới hạn quyền như thật: "sk_mock_eleven_nouser" thiếu quyền User, "…_noagents" thiếu quyền ElevenLabs Agents.
const elevenNo = (req, perm) => String(req.headers["xi-api-key"] ?? "").includes(`no${perm}`);

// Chữ của tin nhắn người dùng gần nhất (bỏ qua kết quả công cụ, ảnh, tệp).
// Lời nhắc làm tiếp của Synchro (<synchro_continue>) không phải câu người dùng gõ: đọc yêu cầu thật trước nó.
function lastUserFull(msgs = []) {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") { if (m.content.startsWith("<synchro_continue>")) continue; return m.content; }
    const t = (m.content ?? []).filter((b) => b.type === "text" || b.type === "input_text").map((b) => b.text).join("\n");
    if (t && !t.startsWith("<synchro_continue>")) return t;
  }
  return "";
}
// [mock:stall]: như model thật đôi khi chỉ báo "Mình sẽ…" rồi dừng, không gọi công cụ; Synchro nhắc làm tiếp thì làm thật.
const stallNow = (q, msgs) => q.includes("[mock:stall]") && !JSON.stringify(msgs ?? []).includes("<synchro_continue>");
// Tầng động Synchro ghép vào cuối tin nhắn mới nhất (artifact hiện tại, tài liệu tri thức…): không phải câu người dùng gõ.
const DYN = /<(current_artifacts|tool_activity|context_mixer|skill_routing|brain_recall)>[\s\S]*?<\/\1>/g;
// Khối <current_time> do Synchro thêm vào tin mới nhất: không phải lời người dùng (chữ "time" trong đó từng làm model giả chọn nhầm công cụ).
const lastUserText = (msgs) => lastUserFull(msgs).replace(DYN, "").replace(/<current_time>[^<]*<\/current_time>/g, "").trim();
// Tầng động của tin nhắn người dùng gần nhất có tầng động (bước tự vá chèn thêm một tin nhắn hệ thống phía sau).
function dynOf(msgs = []) {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "user") continue;
    const t = typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => b.text ?? "").join("\n");
    const hit = t.match(DYN);
    if (hit) return hit.join("\n");
  }
  return "";
}

// Model giả lập tự chọn công cụ như model thật: đoán ý định từ câu hỏi (tìm, tạo, xóa, sửa, xem…) và đối tượng nhắc tới
// (ghi chú, wiki, repo…), khớp với tên + mô tả công cụ, rồi điền tham số theo schema. "#tool=tên" và "#args={...}" vẫn dùng được để ép chọn.
const SKILL_TOOLS = ["load_skill", "read_skill_file", "search_skills", "run_skill_script", "update_plan"];
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
const INTENTS = [
  [/\b(tim|tim kiem|search|find|tra cuu|tra|lookup|hoi)\b/, ["search", "find", "lookup", "query", "ask", "resolve"]],
  [/\b(tao|them|create|add|new|viet|ghi lai)\b/, ["create", "add", "new", "insert", "post"]],
  [/\b(xoa|delete|remove|go bo|bo di)\b/, ["delete", "remove"]],
  [/\b(sua|cap nhat|update|edit|doi ten)\b/, ["update", "edit", "patch", "rename"]],
  [/\b(liet ke|danh sach|list|xem|doc|read|get|lay|mo|cau truc)\b/, ["list", "get", "read", "fetch", "structure", "contents"]],
  [/\b(may gio|thoi gian|gio hien tai|time)\b/, ["time"]],
  [/\b(lap lai|nhac lai|echo)\b/, ["echo"]],
];
const TOPICS = [["don hang", "order"], ["ghi chu", "note"], ["wiki", "wiki"], ["repo", "repo"], ["kho ma", "repo"], ["thu vien", "librar"], ["tai lieu", "doc"], ["vung", "region"], ["gio", "time"], ["echo", "echo"]];
// Công cụ phía máy chủ của hãng (tìm web: type "web_search_…" của Anthropic, "web_search" của OpenAI) không phải công cụ của Synchro.
const normTools = (list) => (list ?? []).filter((x) => !x.type || x.type === "function" || x.type === "custom").map((x) => (x.function ? { name: x.function.name, description: x.function.description, schema: x.function.parameters } : { name: x.name, description: x.description, schema: x.input_schema ?? x.parameters })).filter((x) => x.name);
function buildArgs(tool, q) {
  const props = tool.schema?.properties ?? {};
  const keys = tool.schema?.required?.length ? tool.schema.required : Object.keys(props).slice(0, 1);
  const quoted = /["“'](.+?)["”']/.exec(q)?.[1];
  const topic = (quoted ?? /(?:về|ve|about|tên|ten|tiêu đề|tieu de|là|la)\s+(.+?)\s*[.?!]*$/i.exec(q)?.[1] ?? q).trim().slice(0, 200);
  const args = {};
  for (const k of keys) {
    const p = props[k] ?? {};
    if (/id$/i.test(k)) args[k] = /\b(n\d+)\b/.exec(q)?.[1] ?? "n1";
    else if (/repo/i.test(k)) args[k] = /([\w.-]+\/[\w.-]+)/.exec(q)?.[1] ?? "modelcontextprotocol/modelcontextprotocol";
    else if (/region/i.test(k)) args[k] = /\b([a-z]{2}-[\w-]+)\b/i.exec(q)?.[1] ?? "ap-southeast-1";
    else if (p.type === "boolean") args[k] = true;
    else if (p.type === "number" || p.type === "integer") args[k] = 5;
    else args[k] = topic;
  }
  if (props.body && args.body === undefined) args.body = "Tạo từ Synchro (giả lập)";
  return args;
}
// Model giả lập điều khiển trình duyệt (gõ #browser kèm địa chỉ trang, khi có công cụ browser_*): mở trang → đọc trang →
// điền / chọn / bấm cả biểu mẫu bằng một browser_batch → chụp màn hình → báo kết quả. Câu hỏi lấy từ tin người dùng thật
// (bỏ qua tin ảnh chụp trình duyệt và kết quả cũ đã lược mà Synchro chèn thêm). Nhắc "Chrome của tôi" / "trình duyệt của tôi" / "my Chrome"
// thì mở trang với browser="user" (Chrome của người dùng qua tiện ích Synchro), như model thật làm theo hướng dẫn <browser>.
function browserQ(msgs = []) {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "user") continue;
    const t = typeof m.content === "string" ? m.content : (m.content ?? []).filter((x) => x.type === "text" || x.type === "input_text").map((x) => x.text).join("\n");
    if (t && !/^(Ảnh chụp màn hình trình duyệt|\[Đã lược)/.test(t)) return t;
  }
  return "";
}
function browserStep(msgs, names) {
  const q = browserQ(msgs);
  if (!names.includes("browser_navigate") || !q.includes("#browser")) return null;
  const flat = JSON.stringify(msgs);
  const used = [...flat.matchAll(/"name":"(browser_\w+)"/g)].map((m) => m[1]);
  const url = /(https?:\/\/[^\s"'<>]+)/.exec(q)?.[1] ?? "https://example.com/";
  const mine = /(chrome|trình duyệt|tab) của (tôi|mình|em)|my (chrome|browser)/i.test(q);
  if (!used.includes("browser_navigate")) return { tool: { name: "browser_navigate", args: { url, ...(mine ? { browser: "user" } : {}) } } };
  const texts = [];
  const walk = (v) => { if (typeof v === "string") texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(msgs);
  // Chrome của người dùng chưa kết nối / người dùng bấm Dừng: thôi, báo lại (như model thật làm theo kết quả công cụ).
  const err = texts.filter((t) => /^(Chrome của người dùng chưa kết nối|Người dùng đã bấm Dừng|Trình duyệt của Synchro chưa dùng được|Trang \S+ chưa có trong danh sách trang được phép|Trang \S+ nằm trong danh sách chặn|Người dùng không cho phép dùng trình duyệt)/.test(t)).pop();
  if (err) return { text: `[mock] Chưa làm được trên trình duyệt: ${err.split("\n")[0]}` };
  if (!used.includes("browser_read")) return { tool: { name: "browser_read", args: {} } };
  if (!used.includes("browser_batch")) {
    const tree = texts.filter((t) => t.includes("phần tử tương tác")).pop() ?? "";
    const lines = tree.split("\n");
    const ref = (l) => Number(/^\[(\d+)\]/.exec(l)?.[1]);
    const actions = [];
    for (const l of lines) {
      if (/^\[\d+\] textbox/.test(l)) actions.push({ action: "type", ref: ref(l), text: /Câu/.test(l) ? "an" : "Nguyễn Văn A", clear: true });
      else if (/^\[\d+\] combobox/.test(l)) { const opts = (/options: (.*)$/.exec(l)?.[1] ?? "").split(" | ").filter((o) => o && !/^--/.test(o)); if (opts.length) actions.push({ action: "select", ref: ref(l), value: opts[opts.length - 1] }); }
      else if (/^\[\d+\] checkbox .*unchecked/.test(l)) actions.push({ action: "select", ref: ref(l), value: "true" });
      else if (/^\[\d+\] clickable "B\./.test(l)) actions.push({ action: "click", ref: ref(l) });
    }
    const submit = lines.find((l) => /^\[\d+\] button "(Nộp|Gửi|Submit|Send)/i.test(l));
    if (submit) actions.push({ action: "click", ref: ref(submit) });
    if (!actions.length) actions.push({ action: "scroll", dy: 400 });
    return { tool: { name: "browser_batch", args: { actions } } };
  }
  if (!used.includes("browser_screenshot")) return { tool: { name: "browser_screenshot", args: {} } };
  const last = texts.filter((t) => t.includes("Trang hiện tại:") || /^Ảnh chụp (https?|about|data):/.test(t)).pop() ?? "";
  const title = /"([^"]+)"/.exec(last)?.[1] ?? "";
  const done = /Đã làm (\d+\/\d+) thao tác/.exec(texts.join("\n"))?.[1] ?? "?";
  return { text: `[mock] Đã làm xong trên ${mine ? "Chrome của bạn" : "trình duyệt"}: mở ${url}, làm ${done} thao tác trên trang và chụp màn hình kiểm tra. Trang cuối: ${title || "(không rõ)"}.` };
}
// Kịch bản nhiều bước của agent Synchro Code (kiểm thử chế độ quyền, tự sửa PR):
// - "#seq=[{"tool":"write_file","args":{…}},{"tool":"bash","args":{…}}]": gọi lần lượt từng công cụ, mỗi bước một lượt, rồi tóm tắt kết quả.
// - Lượt tự sửa PR ("[Tự sửa PR #n] …"): CI lỗi vì tệp BROKEN thì xóa tệp đó rồi commit; góp ý "thêm tệp X" thì tạo X rồi commit.
// "#think": kèm khối suy nghĩ (thinking) như model thật bật suy nghĩ.
// Mảng JSON ngay sau "#seq=": đọc tới ngoặc đóng cân bằng (sau câu lệnh có thể còn ghi chú bộ não nhắc lại, cũng có dấu ]).
function seqJson(q) {
  const i = q.indexOf("#seq=[");
  if (i < 0) return undefined;
  let depth = 0, str = false, esc = false;
  for (let k = i + 5; k < q.length; k++) {
    const c = q[k];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) return q.slice(i + 5, k + 1);
  }
  return null;
}
function seqPlan(q) {
  // Lời gọi chạy nền chép lại lời nhờ (đánh giá phiên Code, lên kế hoạch việc tự động, bộ não): trả lời ở reply, không chạy kịch bản.
  if (/^(Phiên code cần đánh giá:|Việc cần tự động hóa:)/.test(q) || SIDE.test(q)) return null;
  const m = seqJson(q);
  if (m !== undefined) { try { return m ? JSON.parse(m) : null; } catch { return null; } }
  if (!q.startsWith("[Tự sửa PR")) return null;
  const steps = [];
  if (/BROKEN/.test(q)) steps.push({ tool: "bash", args: { command: "rm -f BROKEN && git add -A && git commit -qm 'Sửa lỗi CI: bỏ tệp BROKEN làm hỏng bản build'", description: "Sửa lỗi CI và commit" } });
  const add = /thêm tệp ([\w./-]+)/i.exec(q)?.[1];
  if (add) steps.push({ tool: "write_file", args: { path: add, content: `# ${add}\n\nThêm theo góp ý review.\n` } }, { tool: "bash", args: { command: `git add -A && git commit -qm 'Thêm ${add} theo góp ý review'`, description: "Commit theo góp ý" } });
  return steps;
}
function seqStep(q, msgs) {
  const steps = seqPlan(q);
  if (!steps) return null;
  const i = msgs.findLastIndex((x) => x.role === "user" && (typeof x.content === "string" || (Array.isArray(x.content) && !x.content.some((c) => c.type === "tool_result"))));
  const after = msgs.slice(i + 1);
  const k = after.filter((x) => x.role === "assistant").length;
  const think = q.includes("#think") ? `Suy nghĩ bước ${k + 1}: xem lại yêu cầu và chọn công cụ phù hợp.` : "";
  if (k < steps.length) return { tool: { name: steps[k].tool, args: steps[k].args ?? {} }, think };
  const outs = after.filter((x) => x.role === "user" && Array.isArray(x.content)).flatMap((x) => x.content.filter((c) => c.type === "tool_result"))
    .map((c) => (typeof c.content === "string" ? c.content : (c.content ?? []).map((y) => y.text ?? "").join(" ")));
  const denied = outs.filter((o) => /^Người dùng không cho phép/.test(o));
  const text = q.startsWith("[Tự sửa PR")
    ? `Đã sửa xong: ${steps.map((x) => x.args?.description ?? x.tool).join(", ")}. Kiểm thử chạy lại sẽ đạt vì đã xử lý đúng nguyên nhân.`
    : `[mock] Đã chạy ${steps.length} bước. ${denied.length ? `Bị từ chối ${denied.length} bước: ${denied.map((d) => d.split(".")[0]).join("; ")}.` : "Mọi bước đều được làm."} Kết quả: ${outs.map((o) => o.split("\n")[0].slice(0, 80)).join(" | ")}`;
  return { text, think };
}
function wantTool(q, list) {
  const tools = normTools(list);
  if (!tools.length) return null;
  if (q.includes("#tool")) {
    const names = tools.map((t) => t.name);
    const m = /#tool=([\w.-]+)/.exec(q);
    const name = m ? names.find((n) => n.includes(m[1])) : names.find((n) => !SKILL_TOOLS.includes(n) && n !== "generate_image") ?? names[0];
    if (!name) return null;
    let args = name === "load_skill" ? { name: "mock-skill" } : {};
    const a = /#args=(\{.*\})/.exec(q);
    if (a) { try { args = JSON.parse(a[1]); } catch {} }
    return { name, args };
  }
  const t = norm(q);
  let best = null;
  for (const tool of tools) {
    // Công cụ bộ não (brain_*) chỉ chọn khi ép bằng #tool=, để không tranh với công cụ connector trong các bài kiểm thử khác.
    if (SKILL_TOOLS.includes(tool.name) || tool.name.startsWith("brain_") || tool.name.startsWith("browser_") || tool.name === "generate_image") continue;
    const tn = norm(`${tool.name} ${tool.description ?? ""}`).replace(/[_-]/g, " ");
    let score = 0;
    for (const [re, keys] of INTENTS) if (re.test(t) && keys.some((k) => tn.includes(k))) score += 2;
    for (const [vi, en] of TOPICS) if ((t.includes(vi) || t.includes(en)) && tn.includes(en)) score += 1;
    if (score >= 3 && score > (best?.score ?? 0)) best = { tool, score };
  }
  return best ? { name: best.tool.name, args: buildArgs(best.tool, q) } : null;
}
const toolDone = (name, out) => {
  if (name === "run_code") return codeDone(out);
  if (name === "run_skill_script") {
    const o = String(out ?? ""), exit = /exit_code="(-?\d+)"/.exec(o)?.[1];
    const stdout = /<stdout>\n([\s\S]*?)\n<\/stdout>/.exec(o)?.[1]?.trim() ?? "", stderr = /<stderr>\n([\s\S]*?)\n<\/stderr>/.exec(o)?.[1]?.trim() ?? "";
    const heal = /<self_heal status="(\w+)"[^>]*>([\s\S]*?)<\/self_heal>/.exec(o);
    return `${exit === "0" ? `Script chạy xong: ${stdout}` : `Script lỗi (mã thoát ${exit ?? "?"}): ${stderr.split("\n").pop()}`}${heal ? `\n\n[${heal[1]}] ${heal[2]}` : ""}`;
  }
  const o = String(out ?? "");
  if (/^Người dùng đã từ chối/.test(o)) return `Bạn đã từ chối cho mình dùng công cụ ${name}, nên mình chưa làm việc này. Nếu muốn, bạn có thể hỏi lại và chọn "Cho phép".`;
  if (/^(Không gọi được|Người dùng đã chặn|Đã đạt giới hạn)/.test(o)) return `Mình chưa làm được: ${o.slice(0, 300)}`;
  return `Đã gọi công cụ ${name} và nhận kết quả: ${o.slice(0, 300)}\n\n— Câu trả lời giả lập: model giả tự chọn công cụ từ câu hỏi của bạn.`;
};

const displayName = (provider, id) =>
  provider === "anthropic" ? ANTHROPIC.find(([x]) => x === id)?.[1] ?? id
  : provider === "google" ? GOOGLE.find(([x]) => x === id)?.[1] ?? id
  : provider === "openai" ? id.replace(/^gpt/i, "GPT")
  : provider === "xai" ? id.replace(/^grok-/, "Grok ")
  : provider === "deepseek" ? id.replace(/^deepseek-/, "DeepSeek ").replace(/-/g, " ") : id;
const pro = (id) => /-pro$/.test(id);

// Model lớn trả lời chậm hơn model nhỏ, để thấy trạng thái đang trả lời.
const latency = (id) => (/astra|argon|opus|fable|pro|o3/.test(id) ? 1600 : /luna|mini|nano|flash|haiku|lite/.test(id) ? 450 : 900) + Math.random() * 300;

// Lời gọi đặt tên đoạn chat (app/api/title): trả về một tên ngắn như model thật.
function mockTitle(q) {
  const first = (/\[Người dùng\]\n([^\n]+)/.exec(q)?.[1] ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!first || (/^(xin )?ch[àa]o|^(hi|hello|hey)\b/i.test(first) && first.split(" ").length <= 3)) return /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(first) || !first ? "Lời chào" : "Greeting";
  const w = first.replace(/^(cho (tôi|mình|em) hỏi|giúp (tôi|mình|em)|làm ơn|hãy|please|can you|could you)\s+/i, "").split(" ").slice(0, 6).join(" ");
  return w[0].toUpperCase() + w.slice(1);
}
// Đánh giá phiên Synchro Code (app/agentturn.ts sessionMeta): trả về JSON như model thật.
function mockMeta(q) {
  const reply = /\[Trợ lý trả lời cuối lượt\]\n([\s\S]*?)(\n\n\[|\n\nGit:|$)/.exec(q)?.[1]?.trim() ?? "";
  const edited = (/Tệp đã sửa trong lượt này: ([^\n]*)/.exec(q)?.[1] ?? "").split(", ").filter(Boolean).length;
  const files = Math.max(Number(/Git: (\d+) tệp/.exec(q)?.[1] ?? 0), edited), unpushed = /nhánh chưa push|[1-9]\d* commit chưa push/.test(q);
  const state = /\[Lỗi\]|\[Người dùng đã bấm Dừng/.test(q) || /[?？]\s*$/.test(reply) ? "blocked" : files > 0 || unpushed ? "review" : "done";
  const reason = state === "blocked" ? (/Dừng/.test(q) ? "Đã dừng giữa chừng" : /\[Lỗi\]/.test(q) ? "Gặp lỗi khi chạy" : "Đang hỏi bạn") : state === "review" ? (files ? `Sửa ${files} tệp, chưa commit` : "Có commit chưa push") : "Đã xong việc";
  const suggest = state === "review" ? (files ? "Commit các thay đổi này giúp mình" : "Push lên GitHub và mở pull request") : state === "blocked" ? "Làm tiếp đi" : "Viết kiểm thử cho phần vừa làm";
  return JSON.stringify({ state, reason, suggest });
}
// Lên kế hoạch việc tự động (app/automate.ts planAutomation): đọc lịch, giờ, trình duyệt từ lời giao việc như model thật, trả JSON.
function mockPlan(q) {
  const text = (/Việc cần tự động hóa:\n([\s\S]*?)\n\nBây giờ:/.exec(q)?.[1] ?? "").trim();
  const t = norm(text);
  const days = ["chu nhat", "thu hai", "thu ba", "thu tu", "thu nam", "thu sau", "thu bay"];
  const wd = days.findIndex((d) => t.includes(d));
  const every = Number(/moi (\d{1,2}) (?:gio|tieng)/.exec(t)?.[1] ?? 0);
  const kind = /mot lan|ngay bay gio|ngay lap tuc/.test(t) ? "once" : every || /moi gio|hang gio|every hour/.test(t) ? "hourly"
    : /ngay lam viec|ngay thuong|thu hai (den|toi|-) thu sau|co phieu|chung khoan|ty gia/.test(t) ? "weekdays" : /moi tuan|hang tuan|weekly/.test(t) || wd >= 0 ? "weekly" : "daily";
  const m = /(\d{1,2})\s*(?:h|gio|:)\s*(\d{2})?\s*(sang|chieu|toi)?/.exec(t);
  let h = m ? Number(m[1]) : /chieu/.test(t) ? 17 : /toi/.test(t) ? 20 : 8;
  if (m && (m[3] === "chieu" || m[3] === "toi" || /\b(moi|buoi|hang|vao) (chieu|toi|dem)\b/.test(t)) && h < 12) h += 12;
  const time = `${String(Math.min(h, 23)).padStart(2, "0")}:${m?.[2] ?? "00"}`;
  const browser = /gmail|email cua toi|hop thu cua toi|facebook|tai khoan cua toi|da dang nhap|chrome cua toi/.test(t) ? "user" : "auto";
  const skill = /skill/.test(t);
  const engine = /repo cua toi|sua code|sua loi|pull request|\bpr\b|commit|dependenc|thu vien|refactor|chay kiem thu|\bci\b/.test(t) ? "code" : "chat";
  const title = text.replace(/^(hãy|mỗi ngày|hằng ngày|mỗi sáng)\s+/i, "").split(/[,.;]/)[0].split(" ").slice(0, 8).join(" ");
  const prompt = `Mục tiêu: ${text}\n\nCách làm:\n1. Tra cứu dữ liệu mới nhất từ nguồn đáng tin cậy (ghi rõ nguồn và thời điểm).\n2. So sánh với kết quả lần chạy trước, nêu thay đổi đáng chú ý.\n3. Phân tích ngắn gọn, nêu lập luận và rủi ro.${skill ? "\n4. Với mục đáng giá nhất, soạn skill và gửi đề xuất bằng inbox_propose (kind=skill) để người dùng duyệt trước khi tạo." : ""}\n\nKết quả: dòng đầu tóm tắt, rồi bảng chi tiết, cuối cùng là Nguồn.`;
  return JSON.stringify({ title: title[0]?.toUpperCase() + title.slice(1), engine, schedule: { kind, time, ...(kind === "weekly" ? { weekday: wd >= 0 ? wd : 1 } : {}), ...(kind === "hourly" && every > 1 ? { every } : {}) }, browser, prompt, approvals: skill ? ["Tạo skill từ mục được chọn"] : [], needs: browser === "user" ? ["Mở Chrome có cài tiện ích Synchro"] : [] });
}
// Các tệp trong tin nhắn người dùng gần nhất, theo đúng định dạng từng API (Anthropic, OpenAI Responses, chat/completions).
function mediaOf(msgs = []) {
  const m = [...msgs].reverse().find((x) => x.role === "user" && Array.isArray(x.content));
  const b64 = (u = "") => Buffer.from(String(u).replace(/^data:[^,]*,/, ""), "base64");
  return (m?.content ?? []).flatMap((b) =>
    (b.type === "image" || b.type === "document") && b.source?.data ? [`${CLI.mediaDesc(b64(b.source.data), b.source.media_type)} (${b.type})`]
    : b.type === "input_image" ? [`${CLI.mediaDesc(b64(b.image_url))} (input_image)`]
    : b.type === "input_file" ? [`${CLI.mediaDesc(b64(b.file_data))} (input_file)`]
    : b.type === "image_url" ? [`${CLI.mediaDesc(b64(b.image_url?.url))} (image_url)`] : []);
}
function reply(provider, id, msgs, maxTokens, effort, sys = "") {
  const q = lastUserText(msgs).trim();
  if (q.startsWith("Đoạn chat cần đặt tên:")) return { text: mockTitle(q), q };
  if (q.startsWith("Phiên code cần đánh giá:")) return { text: mockMeta(q), q };
  if (q.startsWith("Việc cần tự động hóa:")) return { text: mockPlan(q), q };
  const brain = CLI.mockBrain(q);
  if (brain) return { text: brain, q };
  if (q.includes("#media")) return { text: CLI.mediaReply(mediaOf(msgs)), q };
  // "#artimg": artifact có ảnh từ URL ngoài (ảnh tĩnh của chính máy giả lập) — kiểm thử khung xem trước tự nhúng ảnh (artdoc.ts).
  if (q.includes("#artimg")) {
    const app = `http://localhost:${process.env.PORT ?? 3200}`;
    return { text: `Trang có ảnh.\n<artifact identifier="anh-ngoai" type="text/html" title="Ảnh ngoài">\n<!doctype html><html><body style="margin:0"><img id="logo" src="${app}/icon-192.png" style="width:96px;height:96px"><div id="nen" style="width:96px;height:96px;background:url('${app}/icon-512.png') center/cover"></div></body></html>\n</artifact>`, q };
  }
  // "#prefs": nhắc lại khối <user_preferences> (Hướng dẫn cho Synchro) có trong system prompt — kiểm thử hướng dẫn tới được model.
  if (q.includes("#prefs")) { const m = /<user_preferences>([\s\S]*?)<\/user_preferences>/.exec(`${sys}\n${JSON.stringify(msgs ?? [])}`); return { text: m ? `PREFS: ${m[1].replace(/\\n/g, "\n").trim().replace(/\s+/g, " ")}` : "PREFS: none", q }; }
  const vi = /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(q) || !q;
  const name = displayName(provider, id), vendor = VENDOR[provider];
  const short = q.length > 160 ? q.slice(0, 160) + "…" : q;
  const n = (msgs ?? []).filter((m) => m.role === "user" || m.role === "assistant").length;
  let body;
  if (/\b(code|hàm|function|python|javascript|typescript|lập trình|script)\b/i.test(q)) {
    body = vi
      ? "Đây là một ví dụ ngắn:\n\n```python\ndef chao(ten: str) -> str:\n    return f\"Xin chào, {ten}!\"\n\nprint(chao(\"Synchro\"))\n```\n\nHàm `chao` nhận một tên và trả về câu chào."
      : "Here is a short example:\n\n```python\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n\nprint(greet(\"Synchro\"))\n```\n\n`greet` takes a name and returns a greeting.";
  } else if (/bảng|so sánh|table|compare/i.test(q)) {
    body = vi
      ? "| Model | Tốc độ | Phù hợp cho |\n|---|---|---|\n| Claude Opus 5.5 | Chậm hơn | Việc phức tạp, suy luận dài |\n| GPT-5.1 | Vừa | Việc thường ngày |\n| Gemini 3.5 Flash | Nhanh | Câu hỏi ngắn, tóm tắt |\n\nBảng này chỉ là dữ liệu mẫu."
      : "| Model | Speed | Best for |\n|---|---|---|\n| Claude Opus 5.5 | Slower | Complex, long reasoning |\n| GPT-5.1 | Medium | Everyday work |\n| Gemini 3.5 Flash | Fast | Short questions, summaries |\n\nThis table is sample data.";
  } else {
    body = vi
      ? `${q ? `Bạn hỏi: “${short}”` : "Chào bạn!"}\n\nMột vài ý để bạn kiểm tra giao diện:\n1. Câu trả lời này đến từ **${name}**. Đổi model ở bộ chọn để thấy tên thay đổi.\n2. Cuộc trò chuyện đang có ${n} tin nhắn, giới hạn trả lời ${maxTokens ?? "?"} token, mức nỗ lực **${effort ?? "mặc định"}**.\n3. Gõ \`#429\` hoặc \`#500\` để xem web báo lỗi thế nào, \`#slow\` để thử trả lời chậm.`
      : `${q ? `You asked: “${short}”` : "Hi there!"}\n\nA few things to check in the interface:\n1. This answer comes from **${name}**. Switch models in the picker to see the name change.\n2. The conversation has ${n} messages, a ${maxTokens ?? "?"} token reply limit and **${effort ?? "default"}** effort.\n3. Type \`#429\` or \`#500\` to see how errors look, or \`#slow\` for a slow reply.`;
  }
  const foot = vi ? `\n\n— Trả lời giả lập trên máy cục bộ, không gọi tới ${vendor}.` : `\n\n— Simulated reply on this machine; nothing was sent to ${vendor}.`;
  return { text: body + foot, q };
}

// Câu trả lời theo Cài đặt → Khả năng (artifact, hình minh họa, chạy code) nếu system prompt có hướng dẫn tương ứng.
// Yêu cầu vừa lấy dữ liệu vừa sửa artifact (#rev): như model thật, gọi công cụ trước, sửa sau khi có kết quả.
// tool_choice "none" (bước cuối, bước tự vá): vẫn trả lời bằng chữ / artifact như model thật, chỉ không gọi công cụ.
// Chế độ Tự động của Code: như model thật, đánh dấu từng giai đoạn đã đi qua (<!-- mode:… -->) và đổi giai đoạn giữa chừng.
const AUTO_STEP = {
  plan: "Việc này chạm nhiều phần nên mình lập kế hoạch trước:\n1. Tách phần xử lý dữ liệu ra hàm riêng.\n2. Viết hàm chính và kiểm thử nhỏ.\n3. Chạy thử, sửa nếu có lỗi.",
  debug: "Đọc lỗi: `TypeError: Cannot read properties of undefined`. Giả thuyết theo khả năng: (1) dữ liệu chưa tải xong, (2) sai tên trường, (3) mảng rỗng. Kiểm chứng thấy (1) đúng, nên sửa bằng cách kiểm tra trước khi đọc.",
  code: "```ts\n// filepath: src/lib/greet.ts\nexport function greet(name?: string) {\n  return `Xin chào, ${name ?? \"bạn\"}!`;\n}\n```",
};
function autoReply(sys, q) {
  const start = /Gợi ý giai đoạn mở đầu cho yêu cầu này: (plan|code|debug)/.exec(sys)?.[1] ?? "code";
  const steps = start === "code" ? ["code"] : [start, "code"];
  return steps.map((k) => `<!-- mode:${k} -->\n${AUTO_STEP[k]}`).join("\n\n") + `\n\n— Trả lời giả lập (chế độ Tự động) cho: “${q.slice(0, 80)}”.`;
}
// Synchro nhờ rút bộ nhớ (memory.ts): trả mảng JSON các điều bền vững về người dùng rút từ câu của họ.
function memoryReply(sys, q) {
  if (!/trích xuất bộ nhớ dài hạn về NGƯỜI DÙNG/.test(sys ?? "")) return null;
  const said = (/\[người dùng\] ([^\n]*)/.exec(q) ?? [])[1] ?? "";
  const out = [];
  const name = /tên (?:mình |tôi )?là ([\p{L} ]{2,40})/iu.exec(said);
  if (name) out.push(`Tên là ${name[1].trim()}`);
  const like = /(?:mình|tôi) thích ([^.,!?]{3,80})/iu.exec(said);
  if (like) out.push(`Thích ${like[1].trim()}`);
  return { text: JSON.stringify(out) };
}
// Lời gọi của bộ não / đặt tên (chưng cất, biên soạn, gộp, bản đồ, hồ sơ, hướng dẫn): trả lời bằng mockBrain, không qua skill / công cụ.
const SIDE = /^(Việc cần tự động hóa:|Đoạn chat cần (chưng cất|đặt tên):|Hồ sơ:|Trang cần biên soạn:|Các tên trong bộ não:|Các chủ đề cần xếp bản đồ:|Những điều đã biết về người dùng:|Bản người dùng tự viết:|Skill cần phân loại:|Các skill cần thẩm định:)/;
const capsFor = (sys, q, msgs, tools, none) => {
  if (stallNow(q, msgs)) return { text: "Mình sẽ mở trình duyệt và làm ngay." };
  if (q.includes("#media") || SIDE.test(q)) return null; // lệnh thử / lời gọi của bộ não: trả lời ở reply
  // "#tool=tên" ép gọi đúng công cụ đó trước mọi câu trả lời mẫu (trừ lệnh thử sửa artifact #rev).
  if (!none && q.includes("#tool=") && !/#rev\s*\d+/.test(q)) { const w = wantTool(q, tools); if (w) return { tool: w }; }
  const mem = memoryReply(sys, q);
  if (mem) return mem;
  const first = !none && /#rev\s*\d+/.test(q) && !q.includes("#tool") && wantTool(q.replace(/#rev\s*\d+/, ""), tools);
  if (first) return { tool: first };
  if (/Chế độ Tự động/.test(sys ?? "") && !wantTool(q, tools)) return { text: autoReply(sys, q) };
  const r = capsReply(`${sys ?? ""}\n${dynOf(msgs)}`, q, msgs, normTools(tools).map((t) => t.name));
  return none ? (r?.text ? { text: r.text } : null) : r;
};
// Lượt có gọi công cụ và yêu cầu sửa artifact (#rev): sau kết quả công cụ vẫn gửi kèm bản sửa.
const afterTool = (sys, q, msgs) => { const r = revReply(`${sys ?? ""}\n${dynOf(msgs)}`, q, msgs); return r ? `\n\n${r}` : ""; };
const sysText = (x) => (typeof x === "string" ? x : Array.isArray(x) ? x.map((b) => b.text ?? "").join("\n") : "");

// Lỗi thử nghiệm theo từ khóa trong tin nhắn; trả về true nếu đã trả lỗi.
async function trap(res, q, fmt) {
  // Lời gọi chưng cất / tổng hợp của bộ não và đặt tên đoạn chat chép lại cả đoạn chat (có thể chứa chữ "#429" của câu trả lời giả lập).
  if (/^(Việc cần tự động hóa:|Đoạn chat cần (chưng cất|đặt tên):|Hồ sơ:|Trang cần biên soạn:|Các tên trong bộ não:|Các chủ đề cần xếp bản đồ:|Những điều đã biết về người dùng:|Bản người dùng tự viết:|Skill cần phân loại:)/.test(q)) return false;
  if (q.includes("#slow")) await sleep(8000);
  // Chỉ dòng cuối: lượt lỗi không gửi lại cho model nên tin hỏi trước đó được ghép chung với tin mới; thẻ lỗi cũ không được làm lượt mới lỗi theo.
  const tail = q.split("\n").filter(Boolean).pop() ?? "";
  const code = tail.includes("#401") ? 401 : tail.includes("#404") ? 404 : tail.includes("#429") ? 429 : tail.includes("#500") ? 500 : 0;
  if (!code) return false;
  const msg = { 401: "invalid x-api-key", 404: "model not found", 429: "Rate limit reached. Please try again later.", 500: "Internal server error" }[code];
  send(res, code, fmt(msg));
  return true;
}

const LAST = {}, HIST = {};
// Chép lời giả lập: một cuộc họp ngắn tiếng Việt, 3 người nói (dùng cho tính năng Cuộc họp).
const MEETING_LINES = [
  [0, "Chào mọi người, hôm nay mình chốt kế hoạch ra mắt ứng dụng Synchro bản di động."],
  [1, "Bên thiết kế đã xong 80% màn hình, còn màn hình thanh toán. Lan sẽ hoàn thiện màn hình thanh toán trước thứ Sáu tuần này."],
  [2, "Phần máy chủ ổn rồi, nhưng cần kiểm thử tải. Minh sẽ chạy kiểm thử tải và gửi báo cáo trước ngày 5 tháng sau."],
  [0, "Vậy mình thống nhất ngày ra mắt là 15 tháng 12. Hùng phụ trách chuẩn bị thông cáo báo chí."],
  [1, "Còn ngân sách quảng cáo thì chưa chốt, để tuần sau họp tiếp."],
];
const MEETING_TEXT = MEETING_LINES.map(([, t]) => t).join(" ");
// Mã thiết bị codex đã được "cho phép" trên trang giả lập (CLI giả hỏi lại mỗi giây).
const DEVICE_OK = new Set();
function mockLogin(rest, u, res) {
  const html = (body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>Đăng nhập giả lập</title><body style="font:16px system-ui;max-width:520px;margin:60px auto;line-height:1.5">${body}</body>`); };
  const code = String(u.searchParams.get("code") ?? u.searchParams.get("user_code") ?? "").replace(/[^A-Z0-9-]/gi, "");
  if (rest === "claude" || rest === "agy") return html(`<h2>${rest === "claude" ? "Claude" : "Antigravity"} (giả lập)</h2><p>Đã đăng nhập. Chép mã này rồi dán vào Synchro:</p><p><code id="code" style="font-size:22px">MOCK-${rest.toUpperCase()}-OK</code></p>`);
  if (rest === "codex") return html(`<h2>ChatGPT (giả lập)</h2><p>Mã thiết bị: <b id="code">${code}</b></p><p><a id="allow" href="/mock-login/codex/approve?code=${code}">Cho phép Codex</a></p>`);
  if (rest === "codex/approve") { DEVICE_OK.add(code); return html(`<p id="done">Đã cho phép. Quay lại Synchro.</p>`); }
  if (rest === "codex/status") return send(res, 200, { approved: DEVICE_OK.has(code) });
  // Grok (xAI): trang xác nhận mã thiết bị như auth.x.ai.
  if (rest === "grok") return html(`<h2>Grok (giả lập)</h2><p>Mã thiết bị: <b id="code">${code}</b></p><p><a id="allow" href="/mock-login/grok/approve?code=${code}">Cho phép Grok CLI</a></p>`);
  if (rest === "grok/approve") { DEVICE_OK.add(`grok:${code}`); return html(`<p id="done">Đã cho phép. Quay lại Synchro.</p>`); }
  if (rest === "grok/status") return send(res, 200, { approved: DEVICE_OK.has(`grok:${code}`) });
  return send(res, 404, { error: "not found" });
}

// xAI (Grok) và DeepSeek theo đúng ràng buộc của API thật (docs.x.ai, api-docs.deepseek.com, tháng 10/2026):
// - Grok: reasoning_effort chỉ nhận ở Grok 4.5 trở lên (low / medium / high / xhigh); model khác báo lỗi 400. Tin trả lời cũ không gửi kèm reasoning_content.
// - DeepSeek: chế độ suy nghĩ bật sẵn (thinking.type = "disabled" để tắt); reasoning_effort low / medium / high / max; có công cụ thì mọi tin
//   trả lời trước phải gửi lại reasoning_content (thiếu là lỗi 400; [mock:strictreason] coi chuỗi rỗng cũng là thiếu); V4 Pro không nhận ảnh.
// - /responses chỉ dùng cho công cụ web_search phía máy chủ (Synchro gọi khi model cần tìm web).
async function compatVendor(prov, rest, req, res, b, auth) {
  const err = (message, type = "invalid_request_error") => ({ error: { message, type } });
  if (!valid(auth)) return send(res, 401, err(prov === "xai" ? "Incorrect API key provided: xai-****. You can obtain an API key from https://console.x.ai." : "Authentication Fails, Your api key is invalid", "authentication_error"));
  const list = prov === "xai" ? XAI : DEEPSEEK;
  if (rest === "/models" && req.method === "GET") return send(res, 200, { object: "list", data: list.map((id, i) => ({ id, object: "model", created: 1_790_000_000 - i * 86400, owned_by: prov === "xai" ? "xai" : "deepseek" })) });
  if (prov === "deepseek" && rest === "/user/balance" && req.method === "GET") return send(res, 200, { is_available: true, balance_infos: [{ currency: "USD", total_balance: "42.10", granted_balance: "0.00", topped_up_balance: "42.10" }] });
  if (rest === "/responses" && req.method === "POST") {
    if (!(b.tools ?? []).some((t) => t.type === "web_search")) return send(res, 400, err("mock: /responses chỉ hỗ trợ công cụ web_search."));
    const q = (typeof b.input === "string" ? b.input : (b.input ?? []).map((x) => (typeof x.content === "string" ? x.content : (x.content ?? []).map((c) => c.text ?? "").join(" "))).join(" ")).replace(/^Tìm trên web[^:]*:\s*/, "").slice(0, 80);
    await sleep(300);
    return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [
      { type: "web_search_call", id: `ws_mock${Date.now()}`, status: "completed", action: { type: "search", query: q } },
      { type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: `Kết quả tìm web của ${VENDOR[prov]} (giả lập) cho “${q}”: tin mới nhất hôm nay.`, annotations: [{ type: "url_citation", url: "https://example.com/tin-moi", title: "Tin mới (giả lập)" }] }] },
    ], usage: { input_tokens: 30, output_tokens: 40 } });
  }
  if (rest !== "/chat/completions" || req.method !== "POST") return send(res, 404, err(`Không có đường dẫn ${rest} trên máy chủ giả lập ${VENDOR[prov]}`));
  if (!list.includes(b.model)) return send(res, 404, err(`The model ${b.model} does not exist or your team does not have access to it.`));
  const ms = b.messages ?? [];
  const shape = chatShape(b, false);
  if (shape) return send(res, 400, err(shape));
  const thinking = prov === "deepseek" ? b.thinking?.type !== "disabled" : XAI_EFFORT.test(b.model);
  if (prov === "xai") {
    if (b.reasoning_effort !== undefined && !XAI_EFFORT.test(b.model)) return send(res, 400, err(`Model ${b.model} does not support parameter reasoningEffort.`));
    if (b.reasoning_effort !== undefined && !["low", "medium", "high", "xhigh"].includes(b.reasoning_effort)) return send(res, 400, err(`Invalid reasoning_effort: ${b.reasoning_effort}`));
    const bad = ms.findIndex((m) => m.role === "assistant" && m.reasoning_content !== undefined);
    if (bad >= 0) return send(res, 400, err(`messages[${bad}]: unknown field \`reasoning_content\`.`));
    // Như API thật: ảnh chỉ nhận JPG / PNG.
    if (/"url":"data:image\/(?!png|jpe?g)/.test(JSON.stringify(ms))) return send(res, 400, err("Unsupported image format. Only JPG/JPEG and PNG images are supported."));
  } else {
    if (b.reasoning_effort !== undefined && !["low", "medium", "high", "max"].includes(b.reasoning_effort)) return send(res, 400, err(`Invalid reasoning_effort: ${b.reasoning_effort}. Supported: low, high, max.`));
    if (b.model === "deepseek-v4-pro" && JSON.stringify(ms).includes('"image_url"')) return send(res, 400, err("Model deepseek-v4-pro does not support image input."));
    const strict = JSON.stringify(ms).includes("[mock:strictreason]");
    if (thinking && b.tools?.length) {
      const bad = ms.findIndex((m) => m.role === "assistant" && (typeof m.reasoning_content !== "string" || (strict && !m.reasoning_content)));
      if (bad >= 0) return send(res, 400, err(`Missing \`reasoning_content\` field in the assistant message at message index ${bad}. In thinking mode with tools, reasoning_content must be passed back. See https://api-docs.deepseek.com/guides/thinking_mode#tool-calls`));
    }
  }
  const { text, q } = reply(prov, b.model, ms, b.max_tokens, b.reasoning_effort ?? (prov === "deepseek" && thinking ? "high" : undefined));
  const think = thinking ? { reasoning_content: `Suy nghĩ của ${VENDOR[prov]} (giả lập) về: ${q.slice(0, 40)}` } : {};
  const msg = (m) => ({ id: `chatcmpl-mock${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", ...think, ...m }, finish_reason: m.tool_calls ? "tool_calls" : "stop" }] });
  const call = (name, args) => msg({ content: null, tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const sys = ms.find((m) => m.role === "system")?.content;
  const bst = browserStep(ms, normTools(b.tools).map((t) => t.name));
  if (bst?.tool) return send(res, 200, call(bst.tool.name, bst.tool.args));
  if (bst?.text) return send(res, 200, msg({ content: bst.text }));
  const sst = studioStep(`${sys ?? ""}\n${dynOf(ms)}`, JSON.stringify(ms), q, normTools(b.tools).map((t) => t.name));
  if (sst?.tool) return send(res, 200, call(sst.tool.name, sst.tool.args));
  if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, msg({ content: sst.text })); }
  const lastMsg = ms[ms.length - 1];
  if (lastMsg?.role === "tool") {
    const prev = [...ms].reverse().find((x) => x.role === "assistant" && x.tool_calls);
    return send(res, 200, msg({ content: toolDone(prev?.tool_calls?.[0]?.function?.name ?? "?", lastMsg.content) + afterTool(sys, q, ms) }));
  }
  const cr = capsFor(sys, q, ms, b.tools, b.tool_choice === "none");
  if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, msg({ content: cr.text })); }
  // "#web" và có công cụ web_search của Synchro: model gọi tìm web.
  const webAsk = q.includes("#web") && normTools(b.tools).some((t) => t.name === "web_search") && b.tool_choice !== "none" ? { name: "web_search", args: { query: q.replace("#web", "").trim().slice(0, 80) } } : null;
  const want = cr?.tool ?? webAsk ?? (b.tool_choice === "none" ? null : wantTool(q, b.tools));
  if (want) return send(res, 200, call(want.name, want.args));
  if (await trap(res, q, (m) => err(m, "server_error"))) return;
  await sleep(latency(b.model));
  return send(res, 200, msg({ content: text }));
}

async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const b = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : {};
  res.__body = b;
  res.__prov = req.method !== "POST" ? null : p.startsWith("/anthropic/") ? "anthropic" : p.startsWith("/openai/") ? "openai" : p.startsWith("/google/") ? "google" : p.startsWith("/xai/") ? "xai" : p.startsWith("/deepseek/") ? "deepseek" : null;

  // ElevenLabs (Speech): mọi đường dẫn trừ Realtime nằm ở mock-eleven.mjs.
  if (await elevenHandler(req, res, p, b, req.__raw ?? Buffer.alloc(0), valid, elevenNo)) return;
  // Chép lời OpenAI Whisper (văn bản).
  if (p === "/openai/v1/audio/transcriptions" && req.method === "POST") {
    if (!valid(auth)) return send(res, 401, { error: { message: "Incorrect API key provided.", type: "invalid_api_key" } });
    await sleep(600);
    return send(res, 200, { text: MEETING_TEXT });
  }

  // Trang đăng nhập giả lập của CLI (scripts/mock-cli): claude và agy hiện mã để dán vào Synchro; codex là trang nhập mã thiết bị.
  if (p.startsWith("/mock-login/")) return mockLogin(p.slice(12), u, res);

  // Trang mẫu cho trình duyệt của Synchro (tests/fixtures/<tên>.html): bài kiểm tra thử để model giả lập điền và nộp.
  if (p.startsWith("/_fixture/") && req.method === "GET") {
    const name = p.slice(10).replace(/[^\w-]/g, "");
    let html; try { html = (await import("node:fs")).readFileSync(new URL(`../tests/fixtures/${name}.html`, import.meta.url)); } catch { return send(res, 404, { error: "not found" }); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html);
  }
  // Kiểm thử: yêu cầu gần nhất gửi tới từng hãng (xem điểm đệm prompt, model được chọn…), số token ước tính, số luồng.
  if (p === "/_debug/last") return send(res, 200, LAST);
  if (p === "/_debug/streams") return send(res, 200, STREAMS);
  // 200 yêu cầu gần nhất của từng hãng (khi có lời gọi chạy nền sau lượt chat, như rút bộ nhớ, đè lên "gần nhất"). Trước đây 30: bộ kiểm
  // tác vụ tự động tự tạo nhiều lời gọi tới mức đẩy lời gọi cần kiểm ra khỏi lịch sử, lúc đạt lúc không.
  if (p === "/_debug/hist") return send(res, 200, HIST);
  // Lời gọi rút bộ nhớ chạy nền sau lượt chat không tính là "gần nhất" (chỉ ghi vào lịch sử) để kiểm thử đọc đúng lượt chat.
  if (res.__prov) {
    if (!JSON.stringify(b).includes("Bạn trích xuất bộ nhớ dài hạn")) { LAST[res.__prov] = b; LAST[`${res.__prov}_tokens`] = inTok(b); }
    (HIST[res.__prov] ??= []).push(b); HIST[res.__prov].splice(0, HIST[res.__prov].length - 200);
  }
  res.__slow = res.__prov && JSON.stringify(b.messages ?? b.input ?? "").includes("#streamslow");

  // ---- Anthropic (/v1/models, /v1/messages) ----
  if (p.startsWith("/anthropic/")) {
    const err = (type, message) => ({ type: "error", error: { type, message } });
    if (!valid(req.headers["x-api-key"])) return send(res, 401, err("authentication_error", "invalid x-api-key"));
    if (!req.headers["anthropic-version"]) return send(res, 400, err("invalid_request_error", "anthropic-version: header is required"));
    if (p === "/anthropic/v1/models") return send(res, 200, { data: ANTHROPIC.map(([id, display_name]) => ({ type: "model", id, display_name })), has_more: false });
    if (p === "/anthropic/v1/messages") {
      if (!b.max_tokens) return send(res, 400, err("invalid_request_error", "max_tokens: Field required"));
      if (!ANTHROPIC.some(([id]) => id === b.model)) return send(res, 404, err("not_found_error", `model: ${b.model}`));
      const ef = b.output_config?.effort;
      if (ef !== undefined && !EFF.includes(ef)) return send(res, 400, err("invalid_request_error", `output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'`));
      const shape = anthropicShape(b);
      if (shape) return send(res, 400, err("invalid_request_error", shape));
      const { text, q } = reply("anthropic", b.model, b.messages, b.max_tokens, ef, sysText(b.system));
      const sq = seqStep(q, b.messages ?? []);
      const thk = (t) => (t ? [{ type: "thinking", thinking: t, signature: "mock-signature" }] : []);
      if (sq?.tool) { await sleep(120); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [...thk(sq.think), { type: "text", text: `Bước tiếp: ${sq.tool.name}.` }, { type: "tool_use", id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: sq.tool.name, input: sq.tool.args }], stop_reason: "tool_use", usage: { input_tokens: 80, output_tokens: 30 } }); }
      if (sq?.text) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [...thk(sq.think), { type: "text", text: sq.text }], stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: Math.ceil(sq.text.length / 4) } });
      const webTool = (b.tools ?? []).find((x) => /^web_search_/.test(x.type ?? ""));
      if (webTool && q.includes("#web") && !JSON.stringify(b.messages).includes("web_search_tool_result")) {
        const id = `srvtoolu_${Date.now()}`;
        return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, stop_reason: "end_turn", usage: { input_tokens: 60, output_tokens: 40, server_tool_use: { web_search_requests: 1 } }, content: [
          { type: "text", text: "Mình sẽ tìm trên web." },
          { type: "server_tool_use", id, name: "web_search", input: { query: q.replace("#web", "").trim().slice(0, 80) } },
          { type: "web_search_tool_result", tool_use_id: id, content: [{ type: "web_search_result", url: "https://example.com/tin-moi", title: "Tin mới (giả lập)", encrypted_content: "x" }] },
          { type: "text", text: `Theo kết quả tìm web (${webTool.type}): đây là tin mới nhất (giả lập).` },
        ] });
      }
      const bst = browserStep(b.messages, normTools(b.tools).map((t) => t.name));
      if (bst?.tool) { await sleep(150); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "Mình làm trên trình duyệt." }, { type: "tool_use", id: `toolu_${Date.now()}`, name: bst.tool.name, input: bst.tool.args }], stop_reason: "tool_use", usage: { input_tokens: 60, output_tokens: 20 } }); }
      if (bst?.text) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: bst.text }], stop_reason: "end_turn", usage: { input_tokens: 60, output_tokens: 30 } });
      const sst = studioStep(`${sysText(b.system)}\n${dynOf(b.messages)}`, JSON.stringify(b.messages), q, normTools(b.tools).map((t) => t.name));
      if (sst?.tool) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "Mình sẽ đọc skill trong thư viện trước." }, { type: "tool_use", id: `toolu_${Date.now()}`, name: sst.tool.name, input: sst.tool.args }], stop_reason: "tool_use" });
      if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: sst.text }], stop_reason: "end_turn" }); }
      const last = b.messages?.[b.messages.length - 1];
      const results = Array.isArray(last?.content) ? last.content.filter((x) => x.type === "tool_result") : [];
      if (results.length) {
        const prev = b.messages[b.messages.length - 2];
        const use = (prev?.content ?? []).find?.((x) => x.type === "tool_use");
        const r0 = results[0];
        const out = typeof r0.content === "string" ? r0.content : (r0.content ?? []).map((x) => x.text ?? "").join(" ");
        return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: toolDone(use?.name ?? "?", out) + afterTool(sysText(b.system), q, b.messages) }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 30 } });
      }
      const cr = capsFor(sysText(b.system), q, b.messages, b.tools, b.tool_choice?.type === "none");
      if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: cr.text }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: Math.ceil(cr.text.length / 4) } }); }
      const want = cr?.tool ?? (b.tool_choice?.type === "none" ? null : wantTool(q, b.tools));
      // #waittool: bước gọi công cụ mất 2,5 giây (thử nhắn thêm khi lượt đang chạy, không cần code chạy chậm).
      if (want && q.includes("#waittool")) await sleep(2500);
      // "#artmid": viết artifact ngay trong câu dẫn trước khi gọi công cụ (model hay làm vậy khi tự kiểm tra sản phẩm) — Synchro phải đưa
      // artifact vào câu trả lời cuối và để read_artifact / check_artifact thấy được.
      const lead = q.includes("#artmid") ? `Mình viết bộ slide rồi đọc lại.\n<artifact identifier="giua-luot" type="text/html" title="Viết giữa lượt">\n<!doctype html><html><body><section class="slide"><h1>Slide một</h1></section><section class="slide"><h1>Slide hai</h1></section></body></html>\n</artifact>` : "Mình sẽ dùng công cụ.";
      if (want) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: lead }, { type: "tool_use", id: `toolu_${Date.now()}`, name: want.name, input: want.args }], stop_reason: "tool_use", usage: { input_tokens: 40, output_tokens: 20 } });
      if (await trap(res, q, (m) => err("api_error", m))) return;
      await sleep(latency(b.model));
      return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: Math.ceil(text.length / 4) } });
    }
  }

  // ---- OpenAI (/models, /responses, /chat/completions) ----
  if (p.startsWith("/openai/v1/")) {
    const err = (message, type = "invalid_request_error") => ({ error: { message, type } });
    if (!valid(auth)) return send(res, 401, err("Incorrect API key provided.", "invalid_api_key"));
    if (p === "/openai/v1/models") return send(res, 200, { object: "list", data: OPENAI.map((id, i) => ({ id, object: "model", created: 1_790_000_000 - i * 86400, owned_by: "openai" })) });
    if (p === "/openai/v1/responses") {
      if (b.max_tokens !== undefined || b.max_completion_tokens !== undefined) return send(res, 400, err("Unsupported parameter: use 'max_output_tokens' with the Responses API."));
      if (!OPENAI_CHAT.includes(b.model)) return send(res, 404, err(`The model \`${b.model}\` does not exist or you do not have access to it.`));
      const input = typeof b.input === "string" ? [{ role: "user", content: b.input }] : b.input ?? [];
      // Như API thật: kết quả công cụ phải đi kèm đúng lượt gọi công cụ trước đó.
      const outs = input.filter((x) => x.type === "function_call_output");
      const bad = outs.find((o) => !input.some((x) => x.type === "function_call" && x.call_id === o.call_id));
      if (bad) return send(res, 400, err(`No tool call found for function call output with call_id ${bad.call_id}.`));
      const ef = b.reasoning?.effort;
      if (ef !== undefined && !EFF.includes(ef)) return send(res, 400, err(`Invalid value for 'reasoning.effort': '${ef}'.`));
      const { text, q } = reply("openai", b.model, input, b.max_output_tokens, ef, typeof b.instructions === "string" ? b.instructions : "");
      // Tìm web (công cụ phía máy chủ của OpenAI): mục web_search_call rồi câu trả lời, trong cùng một lần gọi.
      if ((b.tools ?? []).some((x) => x.type === "web_search") && q.includes("#web")) {
        await sleep(latency(b.model));
        return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [
          { type: "web_search_call", id: `ws_mock${Date.now()}`, status: "completed", action: { type: "search", query: q.replace("#web", "").trim().slice(0, 80) } },
          { type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Theo kết quả tìm web (web_search của OpenAI): đây là tin mới nhất (giả lập).", annotations: [] }] },
        ], usage: { input_tokens: 60, output_tokens: 30 } });
      }
      const bst = browserStep(input, normTools(b.tools).map((t) => t.name));
      if (bst?.tool) return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "function_call", id: "fc_mock", call_id: `call_${Date.now()}`, name: bst.tool.name, arguments: JSON.stringify(bst.tool.args), status: "completed" }] });
      if (bst?.text) return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: bst.text, annotations: [] }] }] });
      const sst = studioStep(`${b.instructions ?? ""}\n${dynOf(input)}`, JSON.stringify(input), q, normTools(b.tools).map((t) => t.name));
      if (sst?.tool) return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "function_call", id: "fc_mock", call_id: `call_${Date.now()}`, name: sst.tool.name, arguments: JSON.stringify(sst.tool.args), status: "completed" }] });
      if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: sst.text, annotations: [] }] }] }); }
      // Gõ #tool: model gọi công cụ đầu tiên, lượt sau trả lời dựa trên kết quả.
      const lastItem = input[input.length - 1];
      if (lastItem?.type === "function_call_output") {
        const call = input.find((x) => x.type === "function_call" && x.call_id === lastItem.call_id);
        return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model,
          output: [{ type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: toolDone(call?.name ?? "?", lastItem.output) + afterTool(b.instructions, q, input), annotations: [] }] }] });
      }
      const prior = input.filter((x) => x.role === "user" || x.role === "assistant").map((x) => ({ role: x.role, content: typeof x.content === "string" ? x.content : (x.content ?? []).map((c) => c.text ?? "").join("") }));
      const cr = capsFor(b.instructions, q, prior, b.tools, b.tool_choice === "none");
      if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: cr.text, annotations: [] }] }] }); }
      const want = cr?.tool ?? (b.tool_choice === "none" ? null : wantTool(q, b.tools));
      if (want) return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model,
        output: [{ type: "reasoning", id: "rs_mock", summary: [] }, { type: "function_call", id: "fc_mock", call_id: `call_${Date.now()}`, name: want.name, arguments: JSON.stringify(want.args), status: "completed" }] });
      if (await trap(res, q, (m) => err(m, "server_error"))) return;
      await sleep(latency(b.model) * (pro(b.model) ? 2 : 1));
      return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model,
        output: [{ type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
        usage: { input_tokens: 40, output_tokens: Math.ceil(text.length / 4) } });
    }
    if (p === "/openai/v1/chat/completions") {
      if (b.max_tokens !== undefined) return send(res, 400, err("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      if (pro(b.model)) return send(res, 404, err("This model is only supported in v1/responses and not in v1/chat/completions."));
      if (!OPENAI_CHAT.includes(b.model)) return send(res, 404, err(`The model \`${b.model}\` does not exist or you do not have access to it.`));
      const shape = chatShape(b, false);
      if (shape) return send(res, 400, err(shape));
      const { text: text0, q } = reply("openai", b.model, b.messages, b.max_completion_tokens);
      const text = capsFor(b.messages?.find((m) => m.role === "system")?.content, q, b.messages, b.tools, false)?.text ?? text0;
      if (await trap(res, q, (m) => err(m, "server_error"))) return;
      await sleep(latency(b.model));
      return send(res, 200, { id: `chatcmpl-mock${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: Math.ceil(text.length / 4) } });
    }
  }

  // ---- Gemini (liệt kê model bằng API gốc, chat qua lớp tương thích OpenAI) ----
  if (p === "/google/v1beta/models") {
    if (!valid(u.searchParams.get("key"))) return send(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    return send(res, 200, { models: GOOGLE.map(([id, displayName, method]) => ({ name: `models/${id}`, displayName, supportedGenerationMethods: [method] })) });
  }
  // API gốc: generateContent với Google Search (Synchro dùng cho công cụ web_search khi chat Gemini bằng khóa API).
  const gm = /^\/google\/v1beta\/models\/([\w.-]+):generateContent$/.exec(p);
  if (gm && req.method === "POST") {
    if (!valid(req.headers["x-goog-api-key"] ?? u.searchParams.get("key"))) return send(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    if (!GOOGLE.some(([id]) => id === gm[1])) return send(res, 404, { error: { code: 404, message: `models/${gm[1]} is not found`, status: "NOT_FOUND" } });
    const q = (b.contents ?? []).flatMap((c) => c.parts ?? []).map((x) => x.text ?? "").join(" ");
    const grounded = (b.tools ?? []).some((t) => t.google_search);
    return send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text: grounded ? `Kết quả Google Search (giả lập) cho “${q.slice(0, 80)}”: tin mới nhất hôm nay.` : `Trả lời (giả lập): ${q.slice(0, 80)}` }] },
      finishReason: "STOP", ...(grounded ? { groundingMetadata: { webSearchQueries: [q], groundingChunks: [{ web: { uri: "https://example.com/tin-moi", title: "Tin mới (giả lập)" } }] } } : {}) }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 } });
  }
  if (p === "/google/v1beta/openai/chat/completions") {
    if (!valid(auth)) return send(res, 400, [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]);
    if (!GOOGLE.some(([id, , method]) => id === b.model && method === "generateContent")) return send(res, 404, [{ error: { code: 404, message: `models/${b.model} is not found`, status: "NOT_FOUND" } }]);
    if (b.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(b.reasoning_effort)) return send(res, 400, [{ error: { code: 400, message: `Invalid reasoning_effort: ${b.reasoning_effort}`, status: "INVALID_ARGUMENT" } }]);
    const shape = chatShape(b, true);
    if (shape) return send(res, 400, [{ error: { code: 400, message: shape, status: "INVALID_ARGUMENT" } }]);
    const { text, q } = reply("google", b.model, b.messages, b.max_tokens, b.reasoning_effort);
    const sig = (call) => (geminiThinks(b.model) ? { ...call, extra_content: { google: { thought_signature: `sig_${Date.now().toString(36)}` } } } : call);
    const bst = browserStep(b.messages, normTools(b.tools).map((t) => t.name));
    if (bst?.tool) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [sig({ id: `call_${Date.now()}`, type: "function", function: { name: bst.tool.name, arguments: JSON.stringify(bst.tool.args) } })] }, finish_reason: "tool_calls" }] });
    if (bst?.text) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: bst.text }, finish_reason: "stop" }] });
    const sst = studioStep(`${b.messages?.find((m) => m.role === "system")?.content ?? ""}\n${dynOf(b.messages)}`, JSON.stringify(b.messages), q, normTools(b.tools).map((t) => t.name));
    if (sst?.tool) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [sig({ id: `call_${Date.now()}`, type: "function", function: { name: sst.tool.name, arguments: JSON.stringify(sst.tool.args) } })] }, finish_reason: "tool_calls" }] });
    if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: sst.text }, finish_reason: "stop" }] }); }
    const lastMsg = b.messages?.[b.messages.length - 1];
    if (lastMsg?.role === "tool") {
      const prev = [...b.messages].reverse().find((x) => x.role === "assistant" && x.tool_calls);
      return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: toolDone(prev?.tool_calls?.[0]?.function?.name ?? "?", lastMsg.content) + afterTool(b.messages?.find((m) => m.role === "system")?.content, q, b.messages) }, finish_reason: "stop" }] });
    }
    const cr = capsFor(b.messages?.find((m) => m.role === "system")?.content, q, b.messages, b.tools, b.tool_choice === "none");
    if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: cr.text }, finish_reason: "stop" }] }); }
    // "#web" và có công cụ web_search của Synchro: model gọi tìm web.
    const webAsk = q.includes("#web") && normTools(b.tools).some((t) => t.name === "web_search") && b.tool_choice !== "none" ? { name: "web_search", args: { query: q.replace("#web", "").trim().slice(0, 80) } } : null;
    const want = cr?.tool ?? webAsk ?? (b.tool_choice === "none" ? null : wantTool(q, b.tools));
    if (want) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [sig({ id: `call_${Date.now()}`, type: "function", function: { name: want.name, arguments: JSON.stringify(want.args) } })] }, finish_reason: "tool_calls" }] });
    if (await trap(res, q, (m) => [{ error: { message: m } }])) return;
    await sleep(latency(b.model));
    return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });
  }

  // ---- xAI (Grok) và DeepSeek: /models, /chat/completions, /responses (chỉ cho công cụ web_search), số dư của DeepSeek ----
  const xd = /^\/(xai)\/v1(\/.*)$/.exec(p) ?? /^\/(deepseek)(?:\/v1)?(\/.*)$/.exec(p);
  if (xd) return compatVendor(xd[1], xd[2], req, res, b, auth);

  // ---- ElevenLabs Realtime: cấp khóa tạm cho phiên (giữ cấu hình để WebSocket giả lập dùng) ----
  if (p === "/elevenlabs/v1/convai/realtime/client_secrets" && req.method === "POST") {
    if (!valid(req.headers["xi-api-key"])) return send(res, 401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    if (elevenNo(req, "agents") || (EL.cfg.noPerms ?? []).includes("convai_write")) return send(res, 401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission convai_write to execute this operation." } });
    const sess = b.session ?? {};
    if (sess.model !== "eleven_realtime_v1_max" && sess.model !== "eleven_realtime_v1_mini") return send(res, 422, { detail: { message: "Unknown model" } });
    if (sess.tools && !RT.cfg.tools) return send(res, 422, { detail: { message: "Unknown field: session.tools" } });
    if (sess.tools && !(Array.isArray(sess.tools) && sess.tools.every((t) => t.type === "function" && t.name && t.parameters?.type === "object"))) return send(res, 422, { detail: { message: "Invalid tools" } });
    const value = `ek_mock_${Math.random().toString(36).slice(2, 10)}`;
    RT.secrets.set(value, sess);
    RT.sessions.push({ tools: !!sess.tools, instructions: String(sess.instructions ?? ""), voice: sess.audio?.output?.voice ?? "", language: sess.audio?.input?.transcription?.language ?? "", model: sess.model });
    return send(res, 200, { value, expires_at: Math.floor(Date.now() / 1000) + 120 });
  }
  if (p === "/_debug/rt") {
    if (req.method === "POST") { RT.cfg = { ...RT.cfg, ...b }; RT.log = []; RT.sessions = []; }
    return send(res, 200, { cfg: RT.cfg, sessions: RT.sessions, log: RT.log });
  }

  send(res, 404, { error: { message: `Không có đường dẫn ${p} trên máy chủ giả lập` } });
}

// ---- ElevenLabs Realtime giả lập (WebSocket, cùng sự kiện với OpenAI Realtime) ----
// Không nhận dạng giọng thật: khi micro bắt đầu gửi âm thanh, giả như người dùng vừa nói câu RT.cfg.say. Phiên có công cụ
// giao_viec thì nói câu xác nhận rồi gọi giao_viec; nhận function_call_output thì đọc phần tóm tắt. Không có công cụ thì tự trả lời.
const RT = { cfg: { tools: true, say: "Làm trang web cho quán cà phê" }, secrets: new Map(), sessions: [], log: [] };
const pcm = (sec) => { const n = Math.round(24000 * sec), buf = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 24000 * 2 * Math.PI * 220) * 1200), i * 2); return buf; };
function rtSpeak(ws, text, sec, extra = []) {
  const ev = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const id = `resp_${Math.random().toString(36).slice(2, 8)}`;
  ev({ type: "response.created", response: { id } });
  const audio = pcm(sec);
  for (let o = 0; o < audio.length; o += 9600) ev({ type: "response.output_audio.delta", response_id: id, delta: audio.subarray(o, o + 9600).toString("base64") });
  for (const w of text.split(/(?<= )/)) ev({ type: "response.output_audio_transcript.delta", response_id: id, delta: w });
  for (const e of extra) ev(e);
  ev({ type: "response.done", response: { id, status: "completed" } });
}
function rtConnect(ws, req) {
  const proto = String(req.headers["sec-websocket-protocol"] ?? "");
  const secret = /openai-insecure-api-key\.([^,\s]+)/.exec(proto)?.[1];
  const sess = secret && RT.secrets.get(secret);
  if (!sess) { ws.send(JSON.stringify({ type: "error", error: { message: "Invalid client secret" } })); ws.close(4001); return; }
  RT.log.push({ t: "open", tools: !!sess.tools });
  let heard = false;
  const ev = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === "input_audio_buffer.append") {
      if (heard) return;
      heard = true;
      setTimeout(() => {
        ev({ type: "input_audio_buffer.speech_started" });
        setTimeout(() => {
          ev({ type: "input_audio_buffer.speech_stopped" });
          ev({ type: "conversation.item.input_audio_transcription.completed", transcript: RT.cfg.say });
          if (sess.tools) rtSpeak(ws, "Được, để mình xem nhé.", 0.8, [{ type: "response.function_call_arguments.done", call_id: "call_mock_1", name: "giao_viec", arguments: JSON.stringify({ yeu_cau: RT.cfg.say }) }]);
          else rtSpeak(ws, "Mình là bản giả lập, chưa giao việc được nên trả lời luôn.", 1);
        }, 300);
      }, 300);
      return;
    }
    RT.log.push({ t: m.type, ...(m.type === "conversation.item.create" ? { item: m.item } : {}) });
    if (m.type === "response.create") {
      const out = [...RT.log].reverse().find((x) => x.item?.type === "function_call_output")?.item;
      let said = "Xong rồi.";
      try { const o = JSON.parse(out?.output ?? "{}"); said = o.tom_tat || o.loi || said; } catch {}
      setTimeout(() => rtSpeak(ws, said, 1.2), 100);
    }
  });
  ws.on("close", () => RT.log.push({ t: "close" }));
}

export function startMock(port = 4010) {
  return new Promise((ok, fail) => {
    const s = http.createServer((req, res) => handler(req, res).catch((e) => send(res, 500, { error: { message: String(e) } })));
    const wss = new WebSocketServer({ noServer: true, handleProtocols: (ps) => (ps.has("realtime") ? "realtime" : false) });
    const scribe = new WebSocketServer({ noServer: true });
    s.on("upgrade", (req, sock, head) => {
      if (String(req.url).startsWith("/elevenlabs/v1/speech-to-text/realtime")) { scribe.handleUpgrade(req, sock, head, (ws) => scribeConnect(ws, req)); return; }
      if (!String(req.url).startsWith("/elevenlabs/v1/convai/realtime")) { sock.destroy(); return; }
      wss.handleUpgrade(req, sock, head, (ws) => rtConnect(ws, req));
    });
    s.once("error", fail);
    s.listen(port, "127.0.0.1", () => ok(s));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] ?? 4010);
  await startMock(port);
  console.log(`API giả lập đang chạy ở http://127.0.0.1:${port} (khóa hợp lệ: có chữ "mock")`);
}
