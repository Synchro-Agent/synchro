// Gọi model theo từng nhà cung cấp (chỉ chạy ở máy chủ): Anthropic dùng API Messages gốc,
// OpenAI dùng API Responses (chạy được mọi model chat, kể cả dòng -pro không có ở /chat/completions),
// Gemini và các nhà cung cấp tương thích OpenAI dùng /chat/completions.
import type { Target } from "./providers";
import type { Effort } from "./catalog";
import { noteResponse } from "./usage";

export class HttpErr extends Error { constructor(public status: number, m: string) { super(m); } }

type Blk = { type: string; text?: string; media_type?: string; data?: string; name?: string; fallbackText?: string; fallbackImages?: string[] };
// Chuyển khối nội dung chung → định dạng từng nhà cung cấp.
export const toAnthropic = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image", source: { type: "base64", media_type: b.media_type, data: b.data } }
  : b.type === "document" ? { type: "document", title: b.name, source: { type: "base64", media_type: b.media_type, data: b.data } } : b);
export const toOpenAI = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.data}` } }
  : b.type === "document" ? { type: "text", text: `<file name="${b.name}">\n${b.fallbackText ?? "(PDF scan: xem các ảnh trang đính kèm)"}\n</file>` } : b);
export const withPages = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).flatMap((b) => b.type === "document" && b.fallbackImages ? [b, ...b.fallbackImages.map((d) => ({ type: "image", media_type: "image/jpeg", data: d }))] : [b]);

// Model có suy luận (Claude, GPT, Gemini) tính cả token suy nghĩ vào giới hạn đầu ra: để rộng tay để câu trả lời không bị cụt hoặc rỗng.
export const outCap = (t: Target, n: number) => (t.kind === "openai" || t.kind === "google" || t.kind === "anthropic" ? Math.max(n, 16000) : n);

// Đọc lỗi của nhà cung cấp thành một câu ngắn dễ hiểu.
async function fail(r: Response): Promise<never> {
  const text = await r.text();
  let msg = text.slice(0, 400);
  try { const j = JSON.parse(text); const e = Array.isArray(j) ? j[0]?.error : j.error; msg = (typeof e === "string" ? e : e?.message) ?? j.message ?? msg; } catch {}
  throw new HttpErr(r.status, r.status === 401 || r.status === 403 ? `Khóa API bị từ chối (${r.status}): ${msg}` : r.status === 404 ? `Không tìm thấy model hoặc địa chỉ API (404): ${msg}` : r.status === 429 ? `Nhà cung cấp đang giới hạn lượt gọi hoặc hết hạn mức (429): ${msg}` : msg);
}

// ---- Truyền chữ theo thời gian thực (SSE) ----
// onDelta nhận từng đoạn chữ model vừa viết. Mỗi hàm gọi dưới đây ghép lại đúng đối tượng như khi không truyền luồng,
// nên phần xử lý phía sau (công cụ, suy luận, chữ ký suy nghĩ của Gemini) không phải đổi gì.
export type OnDelta = (text: string) => void;
type Sse = { event: string; data: string };
async function* sse(r: Response, signal?: AbortSignal): AsyncGenerator<Sse> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const stop = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", stop);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = "", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).replace(/^ /, "");
        }
        if (data) yield { event, data };
      }
    }
  } finally { signal?.removeEventListener("abort", stop); }
  if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
}
const parse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
// Lỗi giữa luồng (ví dụ quá tải): báo như lỗi HTTP để người dùng thấy câu dễ hiểu.
const midErr = (e: { type?: string; message?: string; code?: string } | undefined) => new HttpErr(e?.type === "overloaded_error" ? 529 : 502, e?.message ?? "Kết nối tới model bị ngắt giữa chừng.");

export type ABlock = { type: string; text?: string; id?: string; name?: string; input?: unknown; thinking?: string; signature?: string; data?: string; _json?: string; [k: string]: unknown };
/** Chữ của lượt trả lời: các khối chữ liền nhau (bị cắt bởi trích dẫn) nối thẳng, khối chữ sau một bước khác (tìm web…) sang đoạn mới. */
export function blocksText(blocks: ABlock[]): string {
  let out = "", prev = "";
  for (const b of blocks) {
    if (b.type === "text" && b.text) out += (prev && prev !== "text" && out ? "\n\n" : "") + b.text;
    if (b.type !== "thinking" && b.type !== "redacted_thinking") prev = b.type;
  }
  return out;
}
// onBlock: báo từng khối khi đã nhận đủ (ví dụ công cụ phía máy chủ bắt đầu tìm web) để nhật ký làm việc hiện đúng lúc.
async function anthropicStream(r: Response, onDelta: OnDelta, signal?: AbortSignal, onBlock?: (b: ABlock) => void) {
  let msg: Record<string, unknown> & { content: ABlock[]; usage?: Record<string, number> } = { content: [] };
  let prev = "", wrote = false;
  for await (const ev of sse(r, signal)) {
    const d = parse(ev.data);
    if (!d) continue;
    if (d.type === "message_start") msg = { ...d.message, content: [] };
    else if (d.type === "content_block_start") {
      const t = d.content_block.type;
      msg.content[d.index] = { ...d.content_block, ...(t === "tool_use" || t === "server_tool_use" ? { _json: "" } : {}) };
      if (t === "text" && wrote && prev !== "text") onDelta("\n\n");
      if (t !== "thinking" && t !== "redacted_thinking") prev = t;
    } else if (d.type === "content_block_delta") {
      const b = msg.content[d.index], x = d.delta ?? {};
      if (!b) continue;
      if (x.type === "text_delta") { b.text = (b.text ?? "") + x.text; if (x.text) { wrote = true; onDelta(x.text); } }
      else if (x.type === "input_json_delta") b._json = (b._json ?? "") + (x.partial_json ?? "");
      else if (x.type === "thinking_delta") b.thinking = (b.thinking ?? "") + x.thinking;
      else if (x.type === "signature_delta") b.signature = x.signature;
    } else if (d.type === "content_block_stop") {
      const b = msg.content[d.index];
      if (b && b._json !== undefined) { b.input = b._json ? parse(b._json) ?? {} : {}; delete b._json; }
      if (b) onBlock?.(b);
    } else if (d.type === "message_delta") { Object.assign(msg, d.delta ?? {}); if (d.usage) msg.usage = { ...msg.usage, ...d.usage }; }
    else if (d.type === "error") throw midErr(d.error);
  }
  msg.content = msg.content.filter(Boolean);
  return msg;
}

export async function anthropicCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal, onDelta?: OnDelta, onBlock?: (b: ABlock) => void) {
  const r = await fetch(`${t.base}/v1/messages`, {
    method: "POST", signal,
    headers: { "x-api-key": t.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body, ...(onDelta ? { stream: true } : {}) }),
  });
  if (!r.ok) await fail(r);
  const j = onDelta ? await anthropicStream(r, onDelta, signal, onBlock) : await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}
// Mức nỗ lực → tham số của từng hãng ("extra" là xhigh). Gemini chỉ tới high (đã hạ sẵn ở clampEffort). Không chọn thì để model dùng mặc định.
export function effortParams(t: Pick<Target, "kind">, e?: Effort): Record<string, unknown> {
  if (!e) return {};
  const v = e === "extra" ? "xhigh" : e;
  if (t.kind === "anthropic") return { output_config: { effort: v } };
  if (t.kind === "openai") return { reasoning: { effort: v } };
  if (t.kind === "google") return { reasoning_effort: v === "xhigh" || v === "max" ? "high" : v };
  return {};
}

// ---- OpenAI Responses API ----
type Item = Record<string, unknown>;
type Part = { type: string; text?: string; image_url?: { url: string } };
// Tin nhắn dạng chat (role + content) → đầu vào của Responses. Lượt trả lời trước của model ({ items }) và kết quả công cụ được giữ nguyên.
export function respInput(msgs: unknown[]): Item[] {
  return msgs.flatMap((m) => {
    const x = m as { role?: string; content?: unknown; items?: Item[] };
    if (x.items) return x.items;
    if (!x.role) return [x as Item];
    if (!Array.isArray(x.content)) return [{ role: x.role, content: String(x.content ?? "") }];
    const out = x.role === "assistant" ? "output_text" : "input_text";
    return [{ role: x.role, content: (x.content as Part[]).map((p) => (p.type === "image_url" ? { type: "input_image", image_url: p.image_url?.url } : { type: out, text: p.text ?? "" })) }];
  });
}
type RespOut = { type: string; content?: { type: string; text?: string }[]; call_id?: string; name?: string; arguments?: string };
export function respParse(j: { output?: RespOut[]; status?: string; incomplete_details?: { reason?: string } }) {
  const out = j.output ?? [];
  let text = out.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
  if (!text && j.status === "incomplete" && j.incomplete_details?.reason === "max_output_tokens") text = "Model đã dùng hết giới hạn token khi đang suy nghĩ nên chưa kịp trả lời. Hãy hỏi lại ngắn gọn hơn.";
  const calls = out.filter((o) => o.type === "function_call").map((o) => {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(o.arguments || "{}"); } catch {}
    return { id: o.call_id!, name: o.name!, input };
  });
  return { text, calls, items: out as Item[] };
}
export const respTools = (tools: { name: string; description: string; input_schema: unknown }[]) => tools.map((x) => ({ type: "function", name: x.name, description: x.description, parameters: x.input_schema }));
// Responses: chữ đến qua response.output_text.delta, đối tượng hoàn chỉnh nằm trong response.completed.
async function responsesStream(r: Response, onDelta: OnDelta, signal?: AbortSignal, onItem?: (it: Item) => void) {
  let done: Record<string, unknown> | null = null;
  for await (const ev of sse(r, signal)) {
    const d = parse(ev.data);
    if (!d) continue;
    if (d.type === "response.output_text.delta" && typeof d.delta === "string") onDelta(d.delta);
    else if (d.type === "response.output_item.done" && d.item) onItem?.(d.item);
    else if (d.type === "response.completed" || d.type === "response.incomplete") done = d.response;
    else if (d.type === "response.failed") throw midErr(d.response?.error);
    else if (d.type === "error") throw midErr(d.error ?? d);
  }
  if (!done) throw midErr(undefined);
  return done;
}
export async function responsesCall(t: { base: string; key: string; model: string; provider?: string }, body: Record<string, unknown>, signal?: AbortSignal, onDelta?: OnDelta, onItem?: (it: Item) => void) {
  const r = await fetch(`${t.base}/responses`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body, ...(onDelta ? { stream: true } : {}) }),
  });
  if (!r.ok) await fail(r);
  const j = onDelta ? await responsesStream(r, onDelta, signal, onItem) : await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}

// Chat Completions (Gemini và các hãng tương thích OpenAI): ghép chữ và lời gọi công cụ theo index;
// giữ mọi trường khác của lời gọi (ví dụ extra_content.google.thought_signature của Gemini) để gửi lại đúng ở bước sau.
type TCall = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string }; [k: string]: unknown };
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    else if (v !== undefined && v !== null) a[k] = v;
  }
}
async function chatStream(r: Response, onDelta: OnDelta, signal?: AbortSignal) {
  let content = "", finish: string | null = null, usage: unknown = undefined, id = "";
  const calls: TCall[] = [];
  const extra: Record<string, unknown> = {};
  for await (const ev of sse(r, signal)) {
    if (ev.data === "[DONE]") break;
    const d = parse(ev.data);
    if (!d) continue;
    if (d.error) throw midErr(d.error);
    id ||= d.id ?? "";
    if (d.usage) usage = d.usage;
    const ch = d.choices?.[0];
    if (!ch) continue;
    if (ch.finish_reason) finish = ch.finish_reason;
    const x = ch.delta ?? {};
    if (typeof x.content === "string" && x.content) { content += x.content; onDelta(x.content); }
    for (const tc of (x.tool_calls ?? []) as TCall[]) {
      const i = tc.index ?? calls.length;
      const cur = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      const { index: _i, function: fn, ...rest } = tc;
      if (fn?.name) cur.function!.name = (cur.function!.name ?? "") + fn.name;
      if (fn?.arguments) cur.function!.arguments = (cur.function!.arguments ?? "") + fn.arguments;
      deepMerge(cur, rest);
    }
    for (const [k, v] of Object.entries(x)) if (!["role", "content", "tool_calls"].includes(k) && v != null) extra[k] = v;
  }
  const tool_calls = calls.filter(Boolean);
  return { id, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: content || (tool_calls.length ? null : ""), ...(tool_calls.length ? { tool_calls } : {}), ...extra }, finish_reason: finish }], ...(usage ? { usage } : {}) };
}
export async function openaiCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal, onDelta?: OnDelta) {
  const r = await fetch(`${t.base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    // Gemini không nhận stream_options; các hãng khác trả số token ở đoạn cuối khi bật include_usage.
    body: JSON.stringify({ model: t.model, ...body, ...(onDelta ? { stream: true, ...(t.kind === "google" ? {} : { stream_options: { include_usage: true } }) } : {}) }),
  });
  if (!r.ok) await fail(r);
  const j = onDelta ? await chatStream(r, onDelta, signal) : await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}

// Một lượt hỏi đáp không có công cụ: dùng cho chat thường và nút "Gửi thử" ở Cài đặt → Providers.
export async function chatOnce(t: Target, system: string, messages: { role: string; content: unknown }[], maxTokens: number, signal?: AbortSignal, effort?: Effort, onDelta?: OnDelta): Promise<string> {
  const ef = effortParams(t, effort);
  if (t.kind === "mock") return `[mock] ${String(messages[messages.length - 1]?.content ?? "").slice(0, 80)}`;
  if (t.kind === "anthropic") {
    // Bộ nhớ đệm prompt: điểm đệm ở cuối hướng dẫn hệ thống và cuối tin nhắn mới nhất (phần lặp lại tính giá rẻ hơn).
    const msgs = messages.map((m) => ({ ...m, content: toAnthropic(m.content) }));
    const last = msgs[msgs.length - 1] as { content: unknown } | undefined;
    if (last) { const bl = typeof last.content === "string" ? [{ type: "text", text: last.content }] : Array.isArray(last.content) ? (last.content as Record<string, unknown>[]) : []; if (bl.length) last.content = bl.map((x, k) => (k === bl.length - 1 ? { ...x, cache_control: { type: "ephemeral" } } : x)); }
    const j = await anthropicCall(t, { max_tokens: outCap(t, maxTokens), ...ef, ...(system ? { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] } : {}), messages: msgs }, signal, onDelta);
    return (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  }
  if (t.kind === "openai") {
    const j = await responsesCall(t, { max_output_tokens: outCap(t, maxTokens), ...ef, ...(system ? { instructions: system } : {}), input: respInput(messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))) }, signal, onDelta);
    return respParse(j).text;
  }
  const j = await openaiCall(t, { max_tokens: outCap(t, maxTokens), ...ef, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }, signal, onDelta);
  const c = j.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? "").join("") : "";
}
