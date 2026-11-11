// Gọi model theo từng nhà cung cấp (chỉ chạy ở máy chủ): Anthropic dùng API Messages gốc,
// OpenAI dùng API Responses (chạy được mọi model chat, kể cả dòng -pro không có ở /chat/completions),
// Gemini và các nhà cung cấp tương thích OpenAI dùng /chat/completions.
import type { Target } from "./providers";
import type { Effort } from "./catalog";
import { noteResponse } from "./usage";
import { noteProviderResponse } from "./tracing";

// Đo thời gian tới byte đầu tiên của hãng cho từng lượt chat (tracing.ts): từ lúc gửi tới lúc có header phản hồi.
async function timed(kind: string, f: () => Promise<Response>): Promise<Response> {
  const t0 = Date.now(), r = await f();
  noteProviderResponse(kind, t0, r.status);
  return r;
}

export class HttpErr extends Error { constructor(public status: number, m: string) { super(m); } }

type Blk = { type: string; text?: string; media_type?: string; data?: string; name?: string; fallbackText?: string; fallbackImages?: string[] };
// Chuyển khối nội dung chung → định dạng từng nhà cung cấp.
export const toAnthropic = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image", source: { type: "base64", media_type: b.media_type, data: b.data } }
  : b.type === "document" ? { type: "document", title: b.name, source: { type: "base64", media_type: b.media_type, data: b.data } } : b);
export const toOpenAI = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.data}` } }
  : b.type === "document" ? { type: "text", text: `<file name="${b.name}">\n${b.fallbackText ?? "(PDF scan: xem các ảnh trang đính kèm)"}\n</file>` } : b);
// API Responses của OpenAI đọc thẳng PDF gốc (chữ và hình từng trang, kể cả PDF scan): gửi tệp nguyên dạng, không đổi thành chữ.
export const toResponses = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.data}` } }
  : b.type === "document" ? { type: "input_file", filename: b.name ?? "file.pdf", file_data: `data:${b.media_type ?? "application/pdf"};base64,${b.data}` } : b);
export const withPages = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).flatMap((b) => b.type === "document" && b.fallbackImages ? [b, ...b.fallbackImages.map((d) => ({ type: "image", media_type: "image/jpeg", data: d }))] : [b]);

// Model có suy luận (Claude, GPT, Gemini, Grok, DeepSeek) tính cả token suy nghĩ vào giới hạn đầu ra: để rộng tay để câu trả lời không bị cụt hoặc rỗng.
export const outCap = (t: Target, n: number) => (t.kind === "openai" || t.kind === "google" || t.kind === "anthropic" || t.kind === "xai" || t.kind === "deepseek" ? Math.max(n, 16000) : n);

// Đọc lỗi của nhà cung cấp thành một câu ngắn dễ hiểu.
async function fail(r: Response): Promise<never> {
  const text = await r.text();
  let msg = text.slice(0, 400);
  try { const j = JSON.parse(text); const e = Array.isArray(j) ? j[0]?.error : j.error; msg = (typeof e === "string" ? e : e?.message) ?? j.message ?? msg; } catch {}
  throw new HttpErr(r.status, r.status === 401 || r.status === 403 ? `Khóa API bị từ chối (${r.status}): ${msg}` : r.status === 402 ? `Khóa API đã hết số dư, cần nạp thêm ở trang của nhà cung cấp (402): ${msg}` : r.status === 404 ? `Không tìm thấy model hoặc địa chỉ API (404): ${msg}` : r.status === 429 ? `Nhà cung cấp đang giới hạn lượt gọi hoặc hết hạn mức (429): ${msg}` : msg);
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
/** Đánh số một nguồn web của lượt (trùng địa chỉ thì cùng số), trả số thứ tự bắt đầu từ 1; 0: không nhận thêm nguồn. */
export type Citer = (url: string, title?: string) => number;
// Số trích dẫn [n] chèn ngay sau đoạn chữ có dẫn nguồn (không chèn giữa từ: dấu cách cuối đoạn đặt sau số).
const marks = (ns: number[]) => [...new Set(ns.filter((n) => n > 0))].map((n) => `[${n}]`).join("");
export const withMarks = (t: string, ns: number[]) => { const m = marks(ns); if (!m) return t; const k = t.search(/\s*$/); return t.slice(0, k) + m + t.slice(k); };
/** Chữ của lượt trả lời: các khối chữ liền nhau (bị cắt bởi trích dẫn) nối thẳng, khối chữ sau một bước khác (tìm web…) sang đoạn mới.
 *  cite: khối chữ có trích dẫn nguồn web (citations của Anthropic) được thêm số [n] trỏ tới nguồn trong danh sách của lượt. */
export function blocksText(blocks: ABlock[], cite?: Citer): string {
  let out = "", prev = "";
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      const cs = cite && Array.isArray(b.citations) ? (b.citations as { url?: unknown; title?: unknown }[]).filter((c) => typeof c?.url === "string" && /^https?:\/\//.test(c.url)) : [];
      out += (prev && prev !== "text" && out ? "\n\n" : "") + (cs.length ? withMarks(b.text, cs.map((c) => cite!(String(c.url), typeof c.title === "string" ? c.title : ""))) : b.text);
    }
    if (b.type !== "thinking" && b.type !== "redacted_thinking") prev = b.type;
  }
  return out;
}
/** Nguồn trong kết quả tìm web phía máy chủ của Anthropic (khối web_search_tool_result). */
export function searchResults(blocks: ABlock[], cite: Citer) {
  for (const b of blocks) if (b.type === "web_search_tool_result" && Array.isArray(b.content))
    for (const r of b.content as { url?: unknown; title?: unknown }[]) if (typeof r?.url === "string" && /^https?:\/\//.test(r.url)) cite(r.url, typeof r.title === "string" ? r.title : "");
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
  // Luồng dừng giữa chừng (mất kết nối, hết max_tokens khi đang viết tham số công cụ): khối công cụ chưa có content_block_stop vẫn mang
  // trường tạm _json. Không chốt lại ở đây thì nó đi vào lịch sử, và mọi lượt sau bị Anthropic từ chối (400 "tool_use._json: Extra inputs").
  msg.content = msg.content.filter(Boolean);
  for (const b of msg.content) if (b._json !== undefined) { b.input = b._json ? parse(b._json) ?? {} : {}; delete b._json; }
  return msg;
}
/** Bỏ các trường tạm (tên bắt đầu bằng "_") khỏi khối nội dung trước khi gửi: lịch sử cũ đã lỡ lưu _json vẫn gửi được. */
function cleanMessages(body: Record<string, unknown>) {
  const ms = body.messages;
  if (!Array.isArray(ms)) return body;
  let dirty = false;
  const next = ms.map((m) => {
    if (!m || !Array.isArray(m.content)) return m;
    if (!m.content.some((b: unknown) => b && typeof b === "object" && Object.keys(b).some((k) => k.startsWith("_")))) return m;
    dirty = true;
    return { ...m, content: m.content.map((b: unknown) => (b && typeof b === "object" ? Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith("_"))) : b)) };
  });
  return dirty ? { ...body, messages: next } : body;
}

export async function anthropicCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal, onDelta?: OnDelta, onBlock?: (b: ABlock) => void) {
  const r = await timed("anthropic", () => fetch(`${t.base}/v1/messages`, {
    method: "POST", signal,
    headers: { "x-api-key": t.key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(t.workspace ? { "anthropic-workspace-id": t.workspace } : {}) },
    body: JSON.stringify({ model: t.model, ...cleanMessages(body), ...(onDelta ? { stream: true } : {}) }),
  }));
  if (!r.ok) await fail(r);
  const j = onDelta ? await anthropicStream(r, onDelta, signal, onBlock) : await r.json();
  noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
  return j;
}
// Mức nỗ lực → tham số của từng hãng ("extra" là xhigh). Gemini chỉ tới high (đã hạ sẵn ở clampEffort). Không chọn thì để model dùng mặc định.
// Grok: reasoning_effort low / medium / high / xhigh, chỉ từ Grok 4.5 trở lên (và bản nhiều agent); DeepSeek: low / high / max.
export function effortParams(t: Pick<Target, "kind"> & { model?: string }, e?: Effort): Record<string, unknown> {
  if (!e) return {};
  const v = e === "extra" ? "xhigh" : e;
  if (t.kind === "anthropic") return { output_config: { effort: v } };
  if (t.kind === "openai") return { reasoning: { effort: v } };
  if (t.kind === "google") return { reasoning_effort: v === "xhigh" || v === "max" ? "high" : v };
  if (t.kind === "xai") return t.model && !grokEffort(t.model) ? {} : { reasoning_effort: v === "max" ? "xhigh" : v };
  if (t.kind === "deepseek") return { reasoning_effort: v === "max" ? "max" : v === "low" ? "low" : "high" };
  return {};
}

// ---- Grok (xAI) và DeepSeek qua /chat/completions ----
/** Grok nhận reasoning_effort từ 4.5 trở lên (và bản nhiều agent); model cũ hơn không có tham số này. */
const grokEffort = (model: string) => /^grok-(4\.[5-9]|[5-9])|multi-agent/i.test(model);
/** DeepSeek Flash đọc được ảnh; V4 Pro chỉ nhận chữ. */
export const deepseekVision = (model: string) => /flash|vision/i.test(model);
const NO_IMAGE = "[Ảnh đính kèm: model này chỉ đọc chữ nên không xem được ảnh. Nói với người dùng chọn DeepSeek Flash hoặc model khác nếu cần đọc ảnh.]";
/** Thay ảnh bằng một dòng ghi chú (model không nhận ảnh trả lỗi 400 cho cả lượt). */
export function textOnly(msgs: unknown[]): unknown[] {
  return msgs.map((m) => {
    const x = m as { content?: unknown };
    if (!Array.isArray(x.content) || !(x.content as { type?: string }[]).some((p) => p.type === "image_url")) return m;
    return { ...x, content: (x.content as { type?: string }[]).map((p) => (p.type === "image_url" ? { type: "text", text: NO_IMAGE } : p)) };
  });
}
/**
 * Chỉnh yêu cầu /chat/completions cho từng hãng trước khi gửi:
 * - DeepSeek ở chế độ suy nghĩ có công cụ đòi gửi lại reasoning_content của mọi lượt trả lời trước (thiếu là lỗi 400). Bước gọi công cụ
 *   trong lượt này đã giữ nguyên reasoning_content; lượt cũ trong lịch sử của Synchro chỉ còn chữ nên điền chuỗi rỗng.
 * - DeepSeek V4 Pro không đọc ảnh: thay ảnh bằng ghi chú. Grok: bỏ reasoning_content khi gửi lại (suy luận của Grok đã mã hóa ở máy chủ).
 */
export function compatBody(t: Pick<Target, "kind" | "model">, body: Record<string, unknown>): Record<string, unknown> {
  if (t.kind !== "deepseek" && t.kind !== "xai") return body;
  let msgs = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  if (t.kind === "deepseek") {
    if (!deepseekVision(t.model)) msgs = textOnly(msgs);
    if (Array.isArray(body.tools) && body.tools.length) msgs = msgs.map((m) => { const x = m as { role?: string; reasoning_content?: unknown }; return x.role === "assistant" && typeof x.reasoning_content !== "string" ? { ...x, reasoning_content: "" } : m; });
  } else msgs = msgs.map((m) => { const x = m as { role?: string; reasoning_content?: unknown }; if (x.role !== "assistant" || x.reasoning_content === undefined) return m; const { reasoning_content: _r, ...rest } = x; return rest; });
  return { ...body, messages: msgs };
}
/** Grok chỉ nhận ảnh JPG / PNG: ảnh định dạng khác (WebP, GIF…) đổi sang PNG trước khi gửi. */
export async function compatImages(t: Pick<Target, "kind">, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (t.kind !== "xai" || !Array.isArray(body.messages) || !/"data:image\/(?!png|jpe?g)/.test(JSON.stringify(body.messages))) return body;
  const sharp = (await import("sharp")).default;
  const fix = async (url: string) => {
    const m = /^data:image\/([\w.+-]+);base64,([\s\S]*)$/.exec(url);
    if (!m || /^(png|jpe?g)$/i.test(m[1])) return url;
    try { return `data:image/png;base64,${(await sharp(Buffer.from(m[2], "base64"), { animated: false }).png().toBuffer()).toString("base64")}`; } catch { return url; }
  };
  const messages = await Promise.all((body.messages as { content?: unknown }[]).map(async (msg) => {
    if (!Array.isArray(msg.content)) return msg;
    return { ...msg, content: await Promise.all((msg.content as { type?: string; image_url?: { url: string } }[]).map(async (p) => (p.type === "image_url" && p.image_url?.url ? { ...p, image_url: { ...p.image_url, url: await fix(p.image_url.url) } } : p))) };
  }));
  return { ...body, messages };
}
/** Hãng từ chối một tham số Synchro gửi (400): bản yêu cầu bỏ tham số đó để thử lại một lần, hoặc null. */
export function compatRetry(t: Pick<Target, "kind">, body: Record<string, unknown>, msg: string): Record<string, unknown> | null {
  if (t.kind !== "deepseek" && t.kind !== "xai") return null;
  const msgs = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  // Model không nhận ảnh (bản mới của hãng đổi khả năng): gửi lại chỉ có chữ.
  if (/image|vision|multimodal|modalit/i.test(msg) && JSON.stringify(msgs).includes('"image_url"')) return { ...body, messages: textOnly(msgs) };
  // DeepSeek vẫn báo thiếu suy luận của lượt cũ: tắt chế độ suy nghĩ cho lần gọi này (lịch sử không còn suy luận gốc để gửi lại).
  if (t.kind === "deepseek" && /reasoning/i.test(msg) && (body.thinking as { type?: string } | undefined)?.type !== "disabled") {
    const { reasoning_effort: _e, ...rest } = body;
    return { ...rest, thinking: { type: "disabled" }, messages: msgs.map((m) => { const x = m as { reasoning_content?: unknown }; if (x.reasoning_content === undefined) return m; const { reasoning_content: _r, ...r2 } = x; return r2; }) };
  }
  // Grok: model không nhận reasoning_effort.
  if (t.kind === "xai" && body.reasoning_effort !== undefined && /reasoning|effort/i.test(msg)) { const { reasoning_effort: _e, ...rest } = body; return rest; }
  // Bước cuối (không gọi công cụ nữa) mà hãng không nhận tool_choice: gửi lại không kèm tham số đó.
  if (body.tool_choice !== undefined && /tool_choice/i.test(msg)) { const { tool_choice: _c, ...rest } = body; return rest; }
  return null;
}

// ---- OpenAI Responses API ----
type Item = Record<string, unknown>;
type Part = { type: string; text?: string; image_url?: { url: string }; filename?: string; file_data?: string };
// Tin nhắn dạng chat (role + content) → đầu vào của Responses. Lượt trả lời trước của model ({ items }) và kết quả công cụ được giữ nguyên.
export function respInput(msgs: unknown[]): Item[] {
  return msgs.flatMap((m) => {
    const x = m as { role?: string; content?: unknown; items?: Item[] };
    if (x.items) return x.items;
    if (!x.role) return [x as Item];
    if (!Array.isArray(x.content)) return [{ role: x.role, content: String(x.content ?? "") }];
    const out = x.role === "assistant" ? "output_text" : "input_text";
    return [{ role: x.role, content: (x.content as Part[]).map((p) => (p.type === "image_url" ? { type: "input_image", image_url: p.image_url?.url } : p.type === "input_file" ? { type: "input_file", filename: p.filename, file_data: p.file_data } : { type: out, text: p.text ?? "" })) }];
  });
}
type RespOut = { type: string; content?: { type: string; text?: string }[]; call_id?: string; name?: string; arguments?: string };
// cite: chú thích url_citation của OpenAI (vị trí end_index trong đoạn chữ) thành số [n] ngay sau phần được dẫn.
export function respParse(j: { output?: RespOut[]; status?: string; incomplete_details?: { reason?: string } }, cite?: Citer) {
  const out = j.output ?? [];
  const cited = (c: { text?: string; annotations?: unknown }) => {
    const t = c.text ?? "";
    const an = cite && Array.isArray(c.annotations) ? (c.annotations as { type?: string; url?: unknown; title?: unknown; end_index?: unknown }[]).filter((a) => a?.type === "url_citation" && typeof a.url === "string" && /^https?:\/\//.test(a.url)) : [];
    if (!an.length) return t;
    const at = new Map<number, number[]>();
    for (const a of an) { const e = Math.min(t.length, Math.max(0, Number(a.end_index) || t.length)); at.set(e, [...(at.get(e) ?? []), cite!(String(a.url), typeof a.title === "string" ? a.title : "")]); }
    let r = t;
    for (const e of [...at.keys()].sort((a, b) => b - a)) r = withMarks(r.slice(0, e), at.get(e)!) + r.slice(e);
    return r;
  };
  let text = out.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => cited(c as { text?: string; annotations?: unknown })).join("");
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
  const r = await timed(t.provider ?? "openai", () => fetch(`${t.base}/responses`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body, ...(onDelta ? { stream: true } : {}) }),
  }));
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
    // Trường khác của tin nhắn: chuỗi đến từng đoạn (reasoning_content của DeepSeek, Grok) thì nối lại; đối tượng (chữ ký suy nghĩ của Gemini) thì giữ bản cuối.
    for (const [k, v] of Object.entries(x)) if (!["role", "content", "tool_calls"].includes(k) && v != null) extra[k] = typeof v === "string" && typeof extra[k] === "string" ? extra[k] + v : v;
  }
  const tool_calls = calls.filter(Boolean);
  return { id, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: content || (tool_calls.length ? null : ""), ...(tool_calls.length ? { tool_calls } : {}), ...extra }, finish_reason: finish }], ...(usage ? { usage } : {}) };
}
export async function openaiCall(t: Target, body: Record<string, unknown>, signal?: AbortSignal, onDelta?: OnDelta) {
  const send = async (b: Record<string, unknown>) => {
    const r = await timed(t.kind, () => fetch(`${t.base}/chat/completions`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${t.key}`, "content-type": "application/json" },
      // Gemini không nhận stream_options; các hãng khác trả số token ở đoạn cuối khi bật include_usage.
      body: JSON.stringify({ model: t.model, ...b, ...(onDelta ? { stream: true, ...(t.kind === "google" ? {} : { stream_options: { include_usage: true } }) } : {}) }),
    }));
    if (!r.ok) await fail(r);
    const j = onDelta ? await chatStream(r, onDelta, signal) : await r.json();
    noteResponse(t.provider ?? "unknown", t.model, j, r.headers);
    return j;
  };
  const b = await compatImages(t, compatBody(t, body));
  try { return await send(b); } catch (e) {
    // Lỗi 400 trả về trước khi có chữ nào: thử lại một lần không kèm tham số hãng không nhận.
    const again = e instanceof HttpErr && e.status === 400 ? compatRetry(t, b, e.message) : null;
    if (!again) throw e;
    return await send(again);
  }
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
    const j = await responsesCall(t, { max_output_tokens: outCap(t, maxTokens), ...ef, ...(system ? { instructions: system } : {}), input: respInput(messages.map((m) => ({ ...m, content: toResponses(m.content) }))) }, signal, onDelta);
    return respParse(j).text;
  }
  const j = await openaiCall(t, { max_tokens: outCap(t, maxTokens), ...ef, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }, signal, onDelta);
  const c = j.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? "").join("") : "";
}
