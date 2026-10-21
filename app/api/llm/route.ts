// Cổng duy nhất tới model (tương đương call_llm trong app.py). Đổi nhà cung cấp chỉ sửa ở đây.
const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const API_KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5-5";
const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";

// Bộ định tuyến model: code -> Claude Sonnet, repo lớn -> Gemini Flash, /commit -> DeepSeek.
// Mỗi model đặt bằng env (id kiểu OpenRouter nếu dùng LLM_BASE_URL khác Anthropic).
const MODEL_LONG = process.env.LLM_MODEL_LONG ?? "google/gemini-2.5-flash";
const MODEL_COMMIT = process.env.LLM_MODEL_COMMIT ?? "deepseek/deepseek-chat";
const LONG_CTX = Number(process.env.LLM_LONG_CTX ?? 100_000);
function pickModel(route?: { task?: string; tokens?: number }) {
  if (route?.task === "commit") return MODEL_COMMIT;
  if ((route?.tokens ?? 0) > LONG_CTX) return MODEL_LONG;
  return MODEL;
}

type Blk = { type: string; text?: string; media_type?: string; data?: string; name?: string; fallbackText?: string; fallbackImages?: string[] };
// Chuyển block chung -> định dạng từng provider.
const toAnthropic = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image", source: { type: "base64", media_type: b.media_type, data: b.data } }
  : b.type === "document" ? { type: "document", title: b.name, source: { type: "base64", media_type: b.media_type, data: b.data } } : b);
const toOpenAI = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).map((b) =>
  b.type === "image" ? { type: "image_url", image_url: { url: `data:${b.media_type};base64,${b.data}` } }
  : b.type === "document" ? { type: "text", text: `<file name="${b.name}">\n${b.fallbackText ?? "(PDF scan: xem các ảnh trang đính kèm)"}\n</file>` } : b);
const withPages = (c: unknown) => !Array.isArray(c) ? c : (c as Blk[]).flatMap((b) => b.type === "document" && b.fallbackImages ? [b, ...b.fallbackImages.map((d) => ({ type: "image", media_type: "image/jpeg", data: d }))] : [b]);

export async function POST(req: Request) {
  if (!API_KEY) return Response.json({ error: "Chưa cấu hình LLM_API_KEY" }, { status: 500 });
  const { system, messages, max_tokens = 1500, route } = await req.json();
  const model = pickModel(route);
  try {
    if (PROVIDER === "anthropic" && model === MODEL) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens, system, messages: messages.map((m: { role: string; content: unknown }) => ({ ...m, content: toAnthropic(m.content) })) }),
      });
      if (!r.ok) return Response.json({ error: await r.text() }, { status: r.status });
      const j = await r.json();
      return Response.json({ model, text: (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("") });
    }
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens, messages: [{ role: "system", content: system }, ...messages.map((m: { role: string; content: unknown }) => ({ ...m, content: toOpenAI(withPages(m.content)) }))] }),
    });
    if (!r.ok) return Response.json({ error: await r.text() }, { status: r.status });
    const j = await r.json();
    return Response.json({ model, text: j.choices?.[0]?.message?.content ?? "" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
