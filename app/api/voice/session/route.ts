import { can, current, limit, sameOrigin } from "../../../authstore";
import { serviceKey } from "../../../providers";
import { SpeechErr, addSpend, checkBudget, mintRealtime, plan } from "../../../speechapi";
import { userContext } from "../../../memory";
import { topRule } from "../../../brain";
import { timed } from "../../../servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Khóa ElevenLabs lấy từ Cài đặt → Providers (hoặc ELEVENLABS_API_KEY). Model mặc định: Eleven Realtime v1 Max (giọng tự nhiên nhất, suy luận tốt,
// 90+ ngôn ngữ, tự nhận ngôn ngữ người nói). Cố định ở máy chủ, người dùng không tự chọn.
const MODEL = "eleven_realtime_v1_max";
const VOICE = process.env.ELEVENLABS_VOICE_MODE_VOICE || "";

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
// Không mở được Realtime (thiếu quyền, hết phút của gói…) nhưng vẫn có khóa: trình duyệt chuyển sang chế độ nối tiếp
// (Scribe nghe → model chat trả lời → giọng ElevenLabs đọc), vẫn là giọng AI thật chứ không phải giọng của trình duyệt.
export const POST = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  // Chưa gắn khoá ElevenLabs, hoặc tài khoản chưa được bật Speech: trình duyệt dùng chế độ dự phòng (nhận dạng và đọc bằng trình duyệt).
  if (!serviceKey("elevenlabs") || !can(c.user, "speech")) return Response.json({ fallback: true });
  // Hết hạn mức giọng AI trong ngày: trò chuyện vẫn chạy bằng nhận dạng và giọng của trình duyệt.
  try { checkBudget(c.user); } catch (e) { return Response.json({ fallback: true, error: (e as Error).message }); }
  try { limit("voice:" + c.user.id, 20, 60 * 60_000); } catch { return Response.json({ error: "Bạn đã mở quá nhiều phiên giọng nói. Hãy thử lại sau." }, { status: 429 }); }
  const b = (await req.json().catch(() => ({}))) as { voice?: string };
  const voice = typeof b.voice === "string" && /^[\w-]{3,40}$/.test(b.voice) ? b.voice : VOICE;
  // Khóa chưa có quyền Realtime (convai_write): dùng ngay chế độ nối tiếp (Scribe tự nhận ngôn ngữ → model chat → giọng ElevenLabs),
  // không báo lỗi vì người dùng vẫn trò chuyện bằng giọng AI thật như thường.
  const p = await plan().catch(() => null);
  if (p?.connected && (!p.realtime || !p.features.agent) && !p.perms.tts && !p.perms.stt) return Response.json({ fallback: true, cascade: true });
  try {
    // Không đặt ngôn ngữ: Eleven Realtime tự nhận ngôn ngữ người nói và trả lời đúng ngôn ngữ đó.
    const s = await mintRealtime({ model: MODEL, voice, instructions: [topRule(c.user.id), INSTRUCTIONS + DELEGATE, userContext(c.user, { memory: true })].filter(Boolean).join("\n\n"), eagerness: "medium", maxSeconds: 900, tools: TOOLS });
    addSpend(c.user.id, 1000);
    return Response.json({ value: s.value, expiresAt: s.expiresAt, model: s.model, url: s.url, tools: s.tools });
  } catch (e) {
    const err = e as SpeechErr;
    const cascade = err.code !== "key" && err.code !== "net" && err.code !== "no_key";
    return Response.json({ fallback: true, cascade, ...(cascade ? {} : { error: "Không kết nối được tới ElevenLabs. Tạm thời dùng giọng của trình duyệt." }) });
  }
});
