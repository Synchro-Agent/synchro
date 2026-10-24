// Máy chủ giả lập API của các hãng AI (Anthropic, OpenAI, Gemini, DeepSeek, ElevenLabs) để thử Synchro ở máy cục bộ mà không cần khóa thật.
// Kiểm tra khóa và tham số giống API thật, trả lời bằng nội dung mẫu kèm tên model để thấy rõ đang dùng model nào.
// Dùng: npm run dev:mock (tự chạy cùng web), hoặc riêng: node scripts/mock-providers.mjs [cổng, mặc định 4010]
// Khóa hợp lệ: bất kỳ khóa nào có chữ "mock". Gõ #401, #404, #429, #500 hoặc #slow trong tin nhắn để thử các lỗi.
import http from "node:http";
import { pathToFileURL } from "node:url";

// Khóa mà npm run dev:mock tự nhập vào Cài đặt → API.
export const MOCK_KEYS = { anthropic: "sk-ant-mock-local-0001", openai: "sk-mock-openai-0001", google: "AIza-mock-gemini-0001", deepseek: "sk-mock-deepseek-0001", elevenlabs: "sk_mock_eleven_0001" };

// Danh sách model như API thật trả về, gồm cả model không dùng để chat (Synchro phải tự lọc bỏ).
const ANTHROPIC = [["claude-fable-5-1", "Claude Fable 5.1"], ["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"], ["claude-haiku-4-5", "Claude Haiku 4.5"]];
const OPENAI = ["gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "o3", "o4-mini", "gpt-4.1", "gpt-4o", "gpt-4o-2024-08-06", "gpt-5-pro", "gpt-5-codex",
  "text-embedding-3-large", "whisper-1", "tts-1", "dall-e-3", "gpt-image-1", "gpt-realtime", "omni-moderation-latest"];
const GOOGLE = [["gemini-3.1-pro", "Gemini 3.1 Pro", "generateContent"], ["gemini-3.5-flash", "Gemini 3.5 Flash", "generateContent"], ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "generateContent"],
  ["gemini-embedding-001", "Gemini Embedding", "embedContent"], ["gemini-2.5-flash-image", "Nano Banana", "generateContent"], ["imagen-4.0-generate-001", "Imagen 4", "predict"]];
const DEEPSEEK = ["deepseek-chat", "deepseek-reasoner"];
const VENDOR = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek" };

const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const valid = (k) => typeof k === "string" && k.includes("mock");

// Chữ của tin nhắn người dùng gần nhất (bỏ qua kết quả công cụ, ảnh, tệp).
function lastUserText(msgs = []) {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const t = (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (t) return t;
  }
  return "";
}

const displayName = (provider, id) =>
  provider === "anthropic" ? ANTHROPIC.find(([x]) => x === id)?.[1] ?? id
  : provider === "google" ? GOOGLE.find(([x]) => x === id)?.[1] ?? id
  : provider === "openai" ? id.replace(/^gpt/i, "GPT") : id;

// Model lớn trả lời chậm hơn model nhỏ, để thấy trạng thái đang trả lời.
const latency = (id) => (/opus|fable|pro|o3|reasoner/.test(id) ? 1600 : /mini|nano|flash|haiku|lite/.test(id) ? 450 : 900) + Math.random() * 300;

function reply(provider, id, msgs, maxTokens) {
  const q = lastUserText(msgs).trim();
  const vi = /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(q) || !q;
  const name = displayName(provider, id), vendor = VENDOR[provider];
  const short = q.length > 160 ? q.slice(0, 160) + "…" : q;
  const n = msgs.filter((m) => m.role === "user" || m.role === "assistant").length;
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
      ? `${q ? `Bạn hỏi: “${short}”` : "Chào bạn!"}\n\nMột vài ý để bạn kiểm tra giao diện:\n1. Câu trả lời này đến từ **${name}**. Đổi model ở bộ chọn để thấy tên thay đổi.\n2. Cuộc trò chuyện đang có ${n} tin nhắn, giới hạn trả lời ${maxTokens ?? "?"} token.\n3. Gõ \`#429\` hoặc \`#500\` để xem web báo lỗi thế nào, \`#slow\` để thử trả lời chậm.`
      : `${q ? `You asked: “${short}”` : "Hi there!"}\n\nA few things to check in the interface:\n1. This answer comes from **${name}**. Switch models in the picker to see the name change.\n2. The conversation has ${n} messages, with a ${maxTokens ?? "?"} token reply limit.\n3. Type \`#429\` or \`#500\` to see how errors look, or \`#slow\` for a slow reply.`;
  }
  const foot = vi ? `\n\n— Trả lời giả lập trên máy cục bộ, không gọi tới ${vendor}.` : `\n\n— Simulated reply on this machine; nothing was sent to ${vendor}.`;
  return { text: body + foot, q };
}

// Lỗi thử nghiệm theo từ khóa trong tin nhắn; trả về true nếu đã trả lỗi.
async function trap(res, q, fmt) {
  if (q.includes("#slow")) await sleep(8000);
  const code = q.includes("#401") ? 401 : q.includes("#404") ? 404 : q.includes("#429") ? 429 : q.includes("#500") ? 500 : 0;
  if (!code) return false;
  const msg = { 401: "invalid x-api-key", 404: "model not found", 429: "Rate limit reached. Please try again later.", 500: "Internal server error" }[code];
  send(res, code, fmt(msg));
  return true;
}

async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const b = req.method === "POST" ? await readBody(req) : {};

  // ---- Anthropic (/v1/models, /v1/messages) ----
  if (p.startsWith("/anthropic/")) {
    const err = (type, message) => ({ type: "error", error: { type, message } });
    if (!valid(req.headers["x-api-key"])) return send(res, 401, err("authentication_error", "invalid x-api-key"));
    if (!req.headers["anthropic-version"]) return send(res, 400, err("invalid_request_error", "anthropic-version: header is required"));
    if (p === "/anthropic/v1/models") return send(res, 200, { data: ANTHROPIC.map(([id, display_name]) => ({ type: "model", id, display_name })), has_more: false });
    if (p === "/anthropic/v1/messages") {
      if (!b.max_tokens) return send(res, 400, err("invalid_request_error", "max_tokens: Field required"));
      if (!ANTHROPIC.some(([id]) => id === b.model)) return send(res, 404, err("not_found_error", `model: ${b.model}`));
      const { text, q } = reply("anthropic", b.model, b.messages, b.max_tokens);
      if (await trap(res, q, (m) => err("api_error", m))) return;
      await sleep(latency(b.model));
      return send(res, 200, { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: Math.ceil(text.length / 4) } });
    }
  }

  // ---- OpenAI và DeepSeek (chuẩn OpenAI: /models, /chat/completions) ----
  const oa = p.startsWith("/openai/v1/") ? "openai" : p.startsWith("/deepseek/v1/") ? "deepseek" : null;
  if (oa) {
    const err = (message, type = "invalid_request_error") => ({ error: { message, type } });
    if (!valid(auth)) return send(res, 401, err("Incorrect API key provided.", "invalid_api_key"));
    const ids = oa === "openai" ? OPENAI : DEEPSEEK;
    if (p.endsWith("/models")) return send(res, 200, { object: "list", data: ids.map((id, i) => ({ id, object: "model", created: 1_760_000_000 - i * 1000, owned_by: oa })) });
    if (p.endsWith("/chat/completions")) {
      // OpenAI không còn nhận max_tokens với model mới; DeepSeek vẫn dùng max_tokens.
      if (oa === "openai" && b.max_tokens !== undefined) return send(res, 400, err("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."));
      if (!ids.includes(b.model)) return send(res, 404, err(`The model \`${b.model}\` does not exist or you do not have access to it.`));
      const { text, q } = reply(oa, b.model, b.messages, b.max_completion_tokens ?? b.max_tokens);
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
    if (!GOOGLE.some(([id]) => id === b.model)) return send(res, 404, [{ error: { code: 404, message: `models/${b.model} is not found`, status: "NOT_FOUND" } }]);
    const { text, q } = reply("google", b.model, b.messages, b.max_tokens);
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
