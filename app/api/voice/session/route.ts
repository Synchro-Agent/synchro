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
// Hai luồng: chuyện thường thì tự trả lời; việc cần công cụ thì xác nhận ngay một câu rồi giao cho model chính (giao_viec),
// có kết quả thì đọc tóm tắt. Bản đầy đủ nằm trong khung chat.
const DELEGATE = `
Hai luồng làm việc: chuyện thường, câu hỏi kiến thức chung thì tự trả lời ngay. Khi người dùng nhờ việc cần công cụ hay dữ liệu (tìm kiếm, tra cứu thông tin mới, tính toán chính xác, đọc tài liệu hay dữ liệu của họ, tạo trang web, tài liệu, bảng tính, code…): nói ngay MỘT câu xác nhận thật ngắn (ví dụ "Được, để mình xem nhé.") rồi gọi giao_viec với yêu cầu đầy đủ; trong lúc chờ đừng nói thêm.
Khi giao_viec trả về, đọc lại tự nhiên trong 1 đến 3 câu, điều quan trọng nhất trước; không đọc code, bảng hay đường dẫn; nhắc rằng chi tiết đã có trong khung chat nếu có sản phẩm.`;
const TOOLS = [{
  type: "function",
  name: "giao_viec",
  description: "Giao việc cho Synchro (model chính có công cụ: tìm trên web, đọc tài liệu và dữ liệu đã kết nối, chạy code, tạo trang web, tài liệu, bảng tính). Kết quả trả về là bản tóm tắt để đọc cho người dùng; bản đầy đủ đã nằm trong khung chat.",
  parameters: { type: "object", properties: { yeu_cau: { type: "string", description: "Yêu cầu đầy đủ của người dùng, viết rõ bằng ngôn ngữ của họ, kèm mọi chi tiết họ đã nói." } }, required: ["yeu_cau"] },
}];

// Cấp một khoá tạm (client secret) cho trình duyệt nối thẳng tới ElevenLabs Realtime. Khoá API thật không rời máy chủ.
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  // Chưa gắn khoá ElevenLabs, hoặc tài khoản chưa được bật Speech: trình duyệt dùng chế độ dự phòng (nhận dạng và đọc bằng trình duyệt).
  const el = serviceKey("elevenlabs");
  if (!el || !can(c.user, "speech")) return Response.json({ fallback: true });
  try { limit("voice:" + c.user.id, 20, 60 * 60_000); } catch { return Response.json({ error: "Bạn đã mở quá nhiều phiên giọng nói. Hãy thử lại sau." }, { status: 429 }); }

  // Xin phiên có công cụ giao_viec; ElevenLabs chưa nhận công cụ (lỗi 4xx) thì mở phiên thường như trước.
  const mint = (tools: boolean) => fetch(`${el.base}/v1/convai/realtime/client_secrets`, {
    method: "POST",
    headers: { "xi-api-key": el.key, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions: INSTRUCTIONS + (tools ? DELEGATE : ""),
        output_modalities: ["audio"],
        max_duration_seconds: 900,
        audio: {
          input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: { type: "semantic_vad", eagerness: "medium" } },
          output: { format: { type: "audio/pcm" }, voice: VOICE },
        },
        ...(tools ? { tools: TOOLS, tool_choice: "auto" } : {}),
      },
      expires_after: { anchor: "created_at", seconds: 120 },
    }),
  }).catch(() => null);
  let tools = true;
  let r = await mint(true);
  if (r && !r.ok && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) {
    console.error("voice session (tools)", r.status, await r.text().catch(() => ""));
    tools = false;
    r = await mint(false);
  }
  if (!r?.ok) {
    console.error("voice session", r?.status, await r?.text().catch(() => ""));
    return Response.json({ fallback: true, error: "Không mở được phiên giọng nói ElevenLabs." });
  }
  const j = (await r.json()) as { value: string; expires_at: number };
  // Địa chỉ WebSocket theo địa chỉ API đang dùng (mặc định api.elevenlabs.io; bản giả lập chạy ở máy cục bộ).
  const url = `${el.base.replace(/^http/, "ws")}/v1/convai/realtime`;
  return Response.json({ value: j.value, expiresAt: j.expires_at, model: MODEL, url, tools });
}
