import { handle, limit, requireUser, sameOrigin } from "../../../server/authstore";
import { pickCritics, vendorOf } from "../../../server/router";
import { mergeFindings, numbered, parseFindings, type Finding } from "../../critic";
import { isDeck } from "../../artdoc";
import { OneShotErr, oneShot, stalledModels, usableModels } from "../../../server/ai/anymodel";
import { BUSY } from "../../../server/ai/subs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hội đồng phản biện: 1–2 model của hãng khác với model vừa viết sản phẩm (nhìn bằng "mắt khác" thì bắt lỗi tốt hơn),
// chạy song song, trả về lỗi theo dòng dạng JSON; ý kiến trùng chỗ được gộp lại. Model lấy từ đúng các model người dùng
// dùng được (gói subscription hoặc khóa API), hãng tính theo nhà làm model nên "sub-claude/opus" và "anthropic/…" cùng một hãng.
const DECK_NOTE = `
Đây là bộ slide trình chiếu: mỗi slide là một khung 16:9 cố định, cả khung được thu nhỏ đúng tỉ lệ để vừa màn hình (như PowerPoint, Keynote). Đó là cách trình bày đúng, không phải lỗi: không nêu "không đọc được / không co giãn trên điện thoại", "chữ quá nhỏ khi màn hẹp" hay "nên chuyển sang bố cục dọc". Chỉ nêu lỗi thật của bộ slide: chữ đè chữ, tràn hoặc bị cắt khỏi khung, ảnh hỏng, tương phản kém, sai nội dung, lỗi script điều khiển chuyển slide.`;
const CRITIC = `<critic_review>
Bạn là một thành viên hội đồng phản biện, đọc lại sản phẩm một model khác vừa viết (code, trang web hoặc ứng dụng React) để tìm lỗi thật trước khi người dùng dùng.
Chỉ nêu vấn đề đáng sửa: chạy sai hoặc hỏng, lỗ hổng bảo mật, mất dữ liệu, không dùng được trên điện thoại hoặc bằng bàn phím và trình đọc màn hình, hiệu năng tệ rõ rệt. Không nêu ý kiến về phong cách, cách đặt tên hay sở thích. Không có vấn đề thì trả về danh sách rỗng.
Trả về DUY NHẤT một JSON: {"findings":[{"line_start":số,"line_end":số,"severity":"high"|"medium"|"low","title":"tiêu đề ngắn","detail":"vì sao sai và hậu quả, 1–2 câu","suggested_fix":"nội dung mới thay cho đúng các dòng line_start..line_end"}]}
- Số dòng theo cột số bên trái; suggested_fix thay trọn các dòng đó, giữ thụt lề, không kèm số dòng, sửa tối thiểu.
- Tối đa 6 mục, nặng nhất trước. Viết tiêu đề và giải thích bằng ngôn ngữ của người dùng (mặc định tiếng Việt).
</critic_review>`;
const LABEL: Record<string, string> = { code: "code", html: "trang web HTML", react: "ứng dụng React" };

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("critic:" + user.id, 40, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const content = typeof b.content === "string" ? b.content : "";
  const lines = content.split("\n").length;
  if (!content.trim()) return Response.json({ error: "Chưa có nội dung để phản biện." }, { status: 400 });
  if (content.length > 200_000 || lines > 4000) return Response.json({ error: "Sản phẩm quá dài để phản biện." }, { status: 413 });
  const gen = typeof b.model === "string" ? b.model : "";
  const { allowed, usable } = await usableModels(user);
  const auto = b.auto === true, list = usable.length ? usable : allowed, calm = list.filter((k) => !stalledModels(user.id, list).includes(k));
  const picks = pickCritics(calm.length ? calm : list, gen ? vendorOf(gen) : "", gen, auto);
  if (!picks.length) {
    // Tự chạy mà chỉ còn model mạnh hoặc tính tiền thật: không tiêu hạn mức đắt khi không ai bấm. Có model thì bỏ qua êm, chưa có model nào thì mới là lỗi.
    if (auto && list.length) return Response.json({ skipped: true, findings: [], by: [] });
    return Response.json({ error: "Synchro chưa được kết nối với model nào." }, { status: 503 });
  }
  // Bộ slide (HTML có các <section class="slide">) được trình chiếu ở khung 16:9 thu nhỏ đúng tỉ lệ như PowerPoint: không xếp lại theo màn hình
  // điện thoại. Phản biện như trang web thì luôn báo nhầm "chữ quá nhỏ trên điện thoại" (badge đỏ trên bộ slide không lỗi).
  const deck = String(b.type) === "html" && isDeck({ type: "html", content });
  const kind = deck ? "bộ slide HTML trình chiếu 16:9" : LABEL[String(b.type)] ?? "code";
  const ask = `Sản phẩm: “${String(b.title ?? "").slice(0, 200)}” (${kind}${b.lang ? `, ${String(b.lang).slice(0, 30)}` : ""}).${typeof b.question === "string" && b.question.trim() ? `\nYêu cầu gốc của người dùng: ${b.question.trim().slice(0, 1500)}` : ""}\n\n<code>\n${numbered(content)}\n</code>`;
  // signal: kết quả chỉ về qua phản hồi này. Người dùng đóng tab thì không ai nhận nữa: rời hàng chờ (có thể tới 5 phút), không tốn lượt của gói và không giữ 200 KB trong bộ nhớ.
  const runs = await Promise.allSettled(picks.map(async (key) => {
    const text = await oneShot(user, key, deck ? CRITIC.replace("</critic_review>", `${DECK_NOTE}\n</critic_review>`) : CRITIC, [{ role: "user", content: ask }], { maxTokens: 1800, job: auto ? "critic-auto" : "critic", bg: auto, signal: req.signal });
    const findings = parseFindings(text, lines);
    if (!findings) throw new Error("Model phản biện trả lời không đọc được");
    return { by: key, findings };
  }));
  const ok = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) {
    const e = (runs[0] as PromiseRejectedResult).reason;
    // Tự chạy mà hàng việc nền đang đầy: không ai bấm nên không hiện lỗi, bỏ qua lần này, người dùng vẫn bấm Phản biện được.
    if (auto && e instanceof OneShotErr && e.message === BUSY) return Response.json({ skipped: true, findings: [], by: [] });
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Hội đồng phản biện chưa trả lời được. Hãy thử lại." }, { status: 502 });
  }
  const findings: Finding[] = mergeFindings(ok);
  return Response.json({ findings, by: ok.map((r) => r.by) });
});
