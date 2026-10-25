// Máy chủ giả lập API của các hãng AI (Anthropic, OpenAI, Gemini, ElevenLabs) để thử Synchro ở máy cục bộ mà không cần khóa thật.
// Kiểm tra khóa và tham số giống API thật, trả lời bằng nội dung mẫu kèm tên model để thấy rõ đang dùng model nào.
// Dùng: npm run dev:mock (tự chạy cùng web), hoặc riêng: node scripts/mock-providers.mjs [cổng, mặc định 4010]
// Khóa hợp lệ: bất kỳ khóa nào có chữ "mock". Gõ #401, #404, #429, #500 hoặc #slow trong tin nhắn để thử các lỗi.
import http from "node:http";
import { pathToFileURL } from "node:url";
import { capsReply, codeDone, studioStep } from "./mock-caps.mjs";

// Khóa mà npm run dev:mock tự nhập vào Cài đặt → API.
export const MOCK_KEYS = { anthropic: "sk-ant-mock-local-0001", openai: "sk-mock-openai-0001", google: "AIza-mock-gemini-0001", elevenlabs: "sk_mock_eleven_0001" };

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
const VENDOR = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
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
  if (obj.object === "chat.completion") obj.usage = { prompt_tokens: input, completion_tokens: output };
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
const send = (res, code, obj) => { if (code === 200) obj = meter(res, obj); res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const valid = (k) => typeof k === "string" && k.includes("mock");

// Chữ của tin nhắn người dùng gần nhất (bỏ qua kết quả công cụ, ảnh, tệp).
function lastUserText(msgs = []) {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const t = (m.content ?? []).filter((b) => b.type === "text" || b.type === "input_text").map((b) => b.text).join("\n");
    if (t) return t;
  }
  return "";
}

// Model giả lập tự chọn công cụ như model thật: đoán ý định từ câu hỏi (tìm, tạo, xóa, sửa, xem…) và đối tượng nhắc tới
// (ghi chú, wiki, repo…), khớp với tên + mô tả công cụ, rồi điền tham số theo schema. "#tool=tên" và "#args={...}" vẫn dùng được để ép chọn.
const SKILL_TOOLS = ["load_skill", "read_skill_file", "search_skills", "run_skill_script"];
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
const TOPICS = [["ghi chu", "note"], ["wiki", "wiki"], ["repo", "repo"], ["kho ma", "repo"], ["thu vien", "librar"], ["tai lieu", "doc"], ["vung", "region"], ["gio", "time"], ["echo", "echo"]];
const normTools = (list) => (list ?? []).map((x) => (x.function ? { name: x.function.name, description: x.function.description, schema: x.function.parameters } : { name: x.name, description: x.description, schema: x.input_schema ?? x.parameters })).filter((x) => x.name);
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
function wantTool(q, list) {
  const tools = normTools(list);
  if (!tools.length) return null;
  if (q.includes("#tool")) {
    const names = tools.map((t) => t.name);
    const m = /#tool=([\w.-]+)/.exec(q);
    const name = m ? names.find((n) => n.includes(m[1])) : names.find((n) => !SKILL_TOOLS.includes(n)) ?? names[0];
    if (!name) return null;
    let args = name === "load_skill" ? { name: "mock-skill" } : {};
    const a = /#args=(\{.*\})/.exec(q);
    if (a) { try { args = JSON.parse(a[1]); } catch {} }
    return { name, args };
  }
  const t = norm(q);
  let best = null;
  for (const tool of tools) {
    if (SKILL_TOOLS.includes(tool.name)) continue;
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
  const o = String(out ?? "");
  if (/^Người dùng đã từ chối/.test(o)) return `Bạn đã từ chối cho mình dùng công cụ ${name}, nên mình chưa làm việc này. Nếu muốn, bạn có thể hỏi lại và chọn "Cho phép".`;
  if (/^(Không gọi được|Người dùng đã chặn|Đã đạt giới hạn)/.test(o)) return `Mình chưa làm được: ${o.slice(0, 300)}`;
  return `Đã gọi công cụ ${name} và nhận kết quả: ${o.slice(0, 300)}\n\n— Câu trả lời giả lập: model giả tự chọn công cụ từ câu hỏi của bạn.`;
};

const displayName = (provider, id) =>
  provider === "anthropic" ? ANTHROPIC.find(([x]) => x === id)?.[1] ?? id
  : provider === "google" ? GOOGLE.find(([x]) => x === id)?.[1] ?? id
  : provider === "openai" ? id.replace(/^gpt/i, "GPT") : id;
const pro = (id) => /-pro$/.test(id);

// Model lớn trả lời chậm hơn model nhỏ, để thấy trạng thái đang trả lời.
const latency = (id) => (/astra|argon|opus|fable|pro|o3/.test(id) ? 1600 : /luna|mini|nano|flash|haiku|lite/.test(id) ? 450 : 900) + Math.random() * 300;

function reply(provider, id, msgs, maxTokens, effort) {
  const q = lastUserText(msgs).trim();
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
const capsFor = (sys, q, msgs, tools, none) => (none ? null : capsReply(sys, q, msgs, normTools(tools).map((t) => t.name)));
const sysText = (x) => (typeof x === "string" ? x : Array.isArray(x) ? x.map((b) => b.text ?? "").join("\n") : "");

// Lỗi thử nghiệm theo từ khóa trong tin nhắn; trả về true nếu đã trả lỗi.
async function trap(res, q, fmt) {
  if (q.includes("#slow")) await sleep(8000);
  const code = q.includes("#401") ? 401 : q.includes("#404") ? 404 : q.includes("#429") ? 429 : q.includes("#500") ? 500 : 0;
  if (!code) return false;
  const msg = { 401: "invalid x-api-key", 404: "model not found", 429: "Rate limit reached. Please try again later.", 500: "Internal server error" }[code];
  send(res, code, fmt(msg));
  return true;
}

const LAST = {};
async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const b = req.method === "POST" ? await readBody(req) : {};
  res.__body = b;
  res.__prov = req.method !== "POST" ? null : p.startsWith("/anthropic/") ? "anthropic" : p.startsWith("/openai/") ? "openai" : p.startsWith("/google/") ? "google" : null;

  // Kiểm thử: yêu cầu gần nhất gửi tới từng hãng (xem điểm đệm prompt, model được chọn…).
  if (p === "/_debug/last") return send(res, 200, LAST);
  if (res.__prov) LAST[res.__prov] = b;

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
      const { text, q } = reply("anthropic", b.model, b.messages, b.max_tokens, ef);
      const sst = studioStep(sysText(b.system), JSON.stringify(b.messages), q, normTools(b.tools).map((t) => t.name));
      if (sst?.tool) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "Mình sẽ đọc skill trong thư viện trước." }, { type: "tool_use", id: `toolu_${Date.now()}`, name: sst.tool.name, input: sst.tool.args }], stop_reason: "tool_use" });
      if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: sst.text }], stop_reason: "end_turn" }); }
      const last = b.messages?.[b.messages.length - 1];
      const results = Array.isArray(last?.content) ? last.content.filter((x) => x.type === "tool_result") : [];
      if (results.length) {
        const prev = b.messages[b.messages.length - 2];
        const use = (prev?.content ?? []).find?.((x) => x.type === "tool_use");
        const r0 = results[0];
        const out = typeof r0.content === "string" ? r0.content : (r0.content ?? []).map((x) => x.text ?? "").join(" ");
        return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: toolDone(use?.name ?? "?", out) }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 30 } });
      }
      const cr = capsFor(sysText(b.system), q, b.messages, b.tools, b.tool_choice?.type === "none");
      if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: cr.text }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: Math.ceil(cr.text.length / 4) } }); }
      const want = cr?.tool ?? (b.tool_choice?.type === "none" ? null : wantTool(q, b.tools));
      if (want) return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "Mình sẽ dùng công cụ." }, { type: "tool_use", id: `toolu_${Date.now()}`, name: want.name, input: want.args }], stop_reason: "tool_use", usage: { input_tokens: 40, output_tokens: 20 } });
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
      const { text, q } = reply("openai", b.model, input, b.max_output_tokens, ef);
      const sst = studioStep(b.instructions, JSON.stringify(input), q, normTools(b.tools).map((t) => t.name));
      if (sst?.tool) return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "function_call", id: "fc_mock", call_id: `call_${Date.now()}`, name: sst.tool.name, arguments: JSON.stringify(sst.tool.args), status: "completed" }] });
      if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model, output: [{ type: "message", id: `msg_mock${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: sst.text, annotations: [] }] }] }); }
      // Gõ #tool: model gọi công cụ đầu tiên, lượt sau trả lời dựa trên kết quả.
      const lastItem = input[input.length - 1];
      if (lastItem?.type === "function_call_output") {
        const call = input.find((x) => x.type === "function_call" && x.call_id === lastItem.call_id);
        return send(res, 200, { id: `resp_mock${Date.now()}`, object: "response", status: "completed", model: b.model,
          output: [{ type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: toolDone(call?.name ?? "?", lastItem.output), annotations: [] }] }] });
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
  if (p === "/google/v1beta/openai/chat/completions") {
    if (!valid(auth)) return send(res, 400, [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]);
    if (!GOOGLE.some(([id, , method]) => id === b.model && method === "generateContent")) return send(res, 404, [{ error: { code: 404, message: `models/${b.model} is not found`, status: "NOT_FOUND" } }]);
    if (b.reasoning_effort !== undefined && !["minimal", "low", "medium", "high"].includes(b.reasoning_effort)) return send(res, 400, [{ error: { code: 400, message: `Invalid reasoning_effort: ${b.reasoning_effort}`, status: "INVALID_ARGUMENT" } }]);
    const { text, q } = reply("google", b.model, b.messages, b.max_tokens, b.reasoning_effort);
    const sst = studioStep(b.messages?.find((m) => m.role === "system")?.content, JSON.stringify(b.messages), q, normTools(b.tools).map((t) => t.name));
    if (sst?.tool) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name: sst.tool.name, arguments: JSON.stringify(sst.tool.args) } }] }, finish_reason: "tool_calls" }] });
    if (sst?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: sst.text }, finish_reason: "stop" }] }); }
    const lastMsg = b.messages?.[b.messages.length - 1];
    if (lastMsg?.role === "tool") {
      const prev = [...b.messages].reverse().find((x) => x.role === "assistant" && x.tool_calls);
      return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: toolDone(prev?.tool_calls?.[0]?.function?.name ?? "?", lastMsg.content) }, finish_reason: "stop" }] });
    }
    const cr = capsFor(b.messages?.find((m) => m.role === "system")?.content, q, b.messages, b.tools, b.tool_choice === "none");
    if (cr?.text) { await sleep(latency(b.model)); return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: cr.text }, finish_reason: "stop" }] }); }
    const want = cr?.tool ?? (b.tool_choice === "none" ? null : wantTool(q, b.tools));
    if (want) return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: `call_${Date.now()}`, type: "function", function: { name: want.name, arguments: JSON.stringify(want.args) } }] }, finish_reason: "tool_calls" }] });
    if (await trap(res, q, (m) => [{ error: { message: m } }])) return;
    await sleep(latency(b.model));
    return send(res, 200, { id: `mock-${Date.now()}`, object: "chat.completion", model: b.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });
  }

  // ---- ElevenLabs (chỉ kiểm tra khóa; giọng nói không giả lập) ----
  if (p === "/elevenlabs/v1/user") {
    if (!valid(req.headers["xi-api-key"])) return send(res, 401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    return send(res, 200, { subscription: { tier: "creator" } });
  }

  send(res, 404, { error: { message: `Không có đường dẫn ${p} trên máy chủ giả lập` } });
}

export function startMock(port = 4010) {
  return new Promise((ok, fail) => {
    const s = http.createServer((req, res) => handler(req, res).catch((e) => send(res, 500, { error: { message: String(e) } })));
    s.once("error", fail);
    s.listen(port, "127.0.0.1", () => ok(s));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] ?? 4010);
  await startMock(port);
  console.log(`API giả lập đang chạy ở http://127.0.0.1:${port} (khóa hợp lệ: có chữ "mock")`);
}
