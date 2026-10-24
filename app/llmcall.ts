// Gọi model theo từng nhà cung cấp (chỉ chạy ở máy chủ): Anthropic dùng API Messages gốc,
// OpenAI, Gemini và các nhà cung cấp tương thích OpenAI dùng /chat/completions.
import type { Target } from "./providers";

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

// OpenAI: các model mới (GPT-5, dòng o) chỉ nhận max_completion_tokens; nhà cung cấp khác vẫn dùng max_tokens.
export const tokenParam = (t: Target, n: number) => (t.kind === "openai" ? { max_completion_tokens: n } : { max_tokens: n });

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
  return r.json();
}
export async function openaiCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal) {
  const r = await fetch(`${t.base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body }),
  });
  if (!r.ok) await fail(r);
  return r.json();
}

// Một lượt hỏi đáp không có công cụ: dùng cho chat thường và nút "Gửi thử" ở Cài đặt → API.
export async function chatOnce(t: Target, system: string, messages: { role: string; content: unknown }[], maxTokens: number, signal?: AbortSignal): Promise<string> {
  if (t.kind === "mock") return `[mock] ${String(messages[messages.length - 1]?.content ?? "").slice(0, 80)}`;
  if (t.kind === "anthropic") {
    const j = await anthropicCall(t, { max_tokens: maxTokens, ...(system ? { system } : {}), messages: messages.map((m) => ({ ...m, content: toAnthropic(m.content) })) }, signal);
    return (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  }
  const j = await openaiCall(t, { ...tokenParam(t, maxTokens), messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }, signal);
  const c = j.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? "").join("") : "";
}
