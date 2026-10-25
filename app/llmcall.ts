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

export async function anthropicCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal) {
  const r = await fetch(`${t.base}/v1/messages`, {
    method: "POST", signal,
    headers: { "x-api-key": t.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body }),
  });
  if (!r.ok) await fail(r);
  const j = await r.json();
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
export async function responsesCall(t: { base: string; key: string; model: string; provider?: string }, body: Record<string, unknown>, signal?: AbortSignal) {
  const r = await fetch(`${t.base}/responses`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body }),
  });
  if (!r.ok) await fail(r);
  const j = await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}

export async function openaiCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal) {
  const r = await fetch(`${t.base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body }),
  });
  if (!r.ok) await fail(r);
  const j = await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}

// Một lượt hỏi đáp không có công cụ: dùng cho chat thường và nút "Gửi thử" ở Cài đặt → API.
export async function chatOnce(t: Target, system: string, messages: { role: string; content: unknown }[], maxTokens: number, signal?: AbortSignal, effort?: Effort): Promise<string> {
  const ef = effortParams(t, effort);
  if (t.kind === "mock") return `[mock] ${String(messages[messages.length - 1]?.content ?? "").slice(0, 80)}`;
  if (t.kind === "anthropic") {
    // Bộ nhớ đệm prompt: điểm đệm ở cuối hướng dẫn hệ thống và cuối tin nhắn mới nhất (phần lặp lại tính giá rẻ hơn).
    const msgs = messages.map((m) => ({ ...m, content: toAnthropic(m.content) }));
    const last = msgs[msgs.length - 1] as { content: unknown } | undefined;
    if (last) { const bl = typeof last.content === "string" ? [{ type: "text", text: last.content }] : Array.isArray(last.content) ? (last.content as Record<string, unknown>[]) : []; if (bl.length) last.content = bl.map((x, k) => (k === bl.length - 1 ? { ...x, cache_control: { type: "ephemeral" } } : x)); }
    const j = await anthropicCall(t, { max_tokens: outCap(t, maxTokens), ...ef, ...(system ? { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] } : {}), messages: msgs }, signal);
    return (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  }
  if (t.kind === "openai") {
    const j = await responsesCall(t, { max_output_tokens: outCap(t, maxTokens), ...ef, ...(system ? { instructions: system } : {}), input: respInput(messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))) }, signal);
    return respParse(j).text;
  }
  const j = await openaiCall(t, { max_tokens: outCap(t, maxTokens), ...ef, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }, signal);
  const c = j.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? "").join("") : "";
}
