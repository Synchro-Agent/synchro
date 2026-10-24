import { can, current, limit, sameOrigin } from "../../../authstore";
import { serviceKey } from "../../../providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Khóa ElevenLabs lấy từ Cài đặt → API (hoặc ELEVENLABS_API_KEY). Model mặc định: Eleven Realtime v1 Max (giọng tự nhiên nhất, suy luận tốt,
// 90+ ngôn ngữ, tự nhận ngôn ngữ người nói). Cố định ở máy chủ, người dùng không tự chọn.
const MODEL = "eleven_realtime_v1_max";
const VOICE = process.env.ELEVENLABS_VOICE_MODE_VOICE || "brian";

const INSTRUCTIONS = `Bạn là Synchro, trợ lý trò chuyện bằng giọng nói. Luôn trả lời bằng đúng ngôn ngữ người dùng vừa nói (họ nói tiếng Việt thì trả lời tiếng Việt, nói tiếng Anh thì trả lời tiếng Anh, đổi ngôn ngữ thì đổi theo).
Nói tự nhiên như người thật, câu ngắn, rõ ràng, mạch lạc; đi thẳng vào ý chính rồi mới mở rộng nếu được hỏi thêm.
Đây là hội thoại bằng giọng nói: không dùng Markdown, danh sách gạch đầu dòng, bảng hay khối code; đọc số, ký hiệu và đơn vị theo cách người ta nói.`;

// Cấp một khoá tạm (client secret) cho trình duyệt nối thẳng tới ElevenLabs Realtime. Khoá API thật không rời máy chủ.
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  // Chưa gắn khoá ElevenLabs, hoặc tài khoản chưa được bật Speech: trình duyệt dùng chế độ dự phòng (nhận dạng và đọc bằng trình duyệt).
  const el = serviceKey("elevenlabs");
  if (!el || !can(c.user, "speech")) return Response.json({ fallback: true });
  try { limit("voice:" + c.user.id, 20, 60 * 60_000); } catch { return Response.json({ error: "Bạn đã mở quá nhiều phiên giọng nói. Hãy thử lại sau." }, { status: 429 }); }

  const r = await fetch(`${el.base}/v1/convai/realtime/client_secrets`, {
    method: "POST",
    headers: { "xi-api-key": el.key, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions: INSTRUCTIONS,
        output_modalities: ["audio"],
        max_duration_seconds: 900,
        audio: {
          input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: { type: "semantic_vad", eagerness: "medium" } },
          output: { format: { type: "audio/pcm" }, voice: VOICE },
        },
      },
      expires_after: { anchor: "created_at", seconds: 120 },
    }),
  }).catch(() => null);
  if (!r?.ok) {
    console.error("voice session", r?.status, await r?.text().catch(() => ""));
    return Response.json({ fallback: true, error: "Không mở được phiên giọng nói ElevenLabs." });
  }
  const j = (await r.json()) as { value: string; expires_at: number };
  return Response.json({ value: j.value, expiresAt: j.expires_at, model: MODEL, url: "wss://api.elevenlabs.io/v1/convai/realtime" });
}
