import { handle, limit, requireUser, sameOrigin } from "../../../server/authstore";
import { pickCritics, vendorOf } from "../../../server/router";
import { checkMath, mergeFindings, numbered, parseFindings, type Finding } from "../../../shared/critic";
import { isDeck } from "../../../shared/artdoc";
import { layoutOf, measureDeck } from "../../../server/artcheck";
import { numberingIssues } from "../../../shared/decknum";
import { contradicts, deckFacts, deckFindings } from "../../../server/deckcritic";
import type { Lang } from "../../../shared/i18n-core";
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
- Lỗi số liệu (tổng không khớp, phép tính, tỉ lệ sai): tự tính lại từng bước trước khi nêu; chỉ nêu khi tính ra thật sự lệch, và thêm trường "math": {"expr":"phép tính từ đúng các số trong sản phẩm, vd. 11+7+5+3+6","shown":"kết quả sản phẩm đang ghi, vd. 32"}. Synchro tự tính lại: khớp thì mục đó bị bỏ.
- Tối đa 6 mục, nặng nhất trước. {LANG}
</critic_review>`;
// Ngôn ngữ viết title / detail: theo ngôn ngữ giao diện người dùng đang dùng (H1: giao diện tiếng Anh mà phản biện viết tiếng Việt).
const WRITE_IN: Record<Lang, string> = {
  vi: "Viết title và detail bằng tiếng Việt (ngôn ngữ giao diện của người dùng).",
  en: "Write title and detail in English: the user's interface is in English, even though these instructions are in Vietnamese. Keep suggested_fix as code.",
};
const LANGS: Lang[] = ["vi", "en"];
const MEASURE_MS = 60_000;

const LABEL: Record<string, string> = { code: "code", html: "trang web HTML", react: "ứng dụng React" };

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("critic:" + user.id, 40, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const content = typeof b.content === "string" ? b.content : "";
  const lang: Lang = LANGS.find((l) => l === b.ui) ?? "vi";
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
  // Bộ slide: số đo khung từng slide của check_artifact (đã có thì đưa luôn cho model; chưa có thì đo song song, chỉ khi máy chủ có Chromium) và đánh số slide.
  const title = String(b.title ?? "").slice(0, 200);
  const nums = deck ? numberingIssues(content) : [];
  const known = deck ? layoutOf(content) : null;
  // Chưa có số đo thì dựng một lần (lượt chạy Chromium trong hàng chờ của workspace): chỉ khi người dùng bấm Phản biện, gắn với req.signal (đóng tab là rời
  // hàng chờ) và tối đa MEASURE_MS, quá thì chỉ còn phần đánh số. Phản biện tự chạy ở nền không dựng thêm (không chiếm hàng chờ khi không ai chờ).
  const measuring = deck && !known && !auto ? measureDeck(user.id, { ident: "critic", title, content }, process.env.APP_URL || "https://synchro.net.nz", AbortSignal.any([req.signal, AbortSignal.timeout(MEASURE_MS)])).catch(() => null) : Promise.resolve(known);
  const ask = `Sản phẩm: “${title}” (${kind}${b.lang ? `, ${String(b.lang).slice(0, 30)}` : ""}).${typeof b.question === "string" && b.question.trim() ? `\nYêu cầu gốc của người dùng: ${b.question.trim().slice(0, 1500)}` : ""}${deck ? deckFacts(known, nums) : ""}\n\n<code>\n${numbered(content)}\n</code>`;
  const system = (deck ? CRITIC.replace("</critic_review>", `${DECK_NOTE}\n</critic_review>`) : CRITIC).replace("{LANG}", WRITE_IN[lang]);
  // signal: kết quả chỉ về qua phản hồi này. Người dùng đóng tab thì không ai nhận nữa: rời hàng chờ (có thể tới 5 phút), không tốn lượt của gói và không giữ 200 KB trong bộ nhớ.
  const runs = await Promise.allSettled(picks.map(async (key) => {
    const text = await oneShot(user, key, system, [{ role: "user", content: ask }], { maxTokens: 1800, job: auto ? "critic-auto" : "critic", bg: auto, signal: req.signal });
    const findings = parseFindings(text, lines);
    if (!findings) throw new Error("Model phản biện trả lời không đọc được");
    // Hạ mức "lỗi số liệu không kèm phép tính" chỉ với trang web / bộ slide (nơi có số liệu trình bày); phản biện code / ứng dụng chỉ tự tính lại mục có math.
    return { by: key, findings: checkMath(findings, { downgrade: String(b.type) === "html" }) };
  }));
  const lay = await measuring;
  const own = deck ? deckFindings(content, lay, nums, lang) : [];
  const ok = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  // Model phản biện lỗi hết nhưng Synchro tự đo thấy lỗi: vẫn trả các lỗi đo được.
  if (!ok.length && own.length) return Response.json({ findings: own, by: ["Synchro"] });
  if (!ok.length) {
    const e = (runs[0] as PromiseRejectedResult).reason;
    // Tự chạy mà hàng việc nền đang đầy: không ai bấm nên không hiện lỗi, bỏ qua lần này, người dùng vẫn bấm Phản biện được.
    if (auto && e instanceof OneShotErr && e.message === BUSY) return Response.json({ skipped: true, findings: [], by: [] });
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Hội đồng phản biện chưa trả lời được. Hãy thử lại." }, { status: 502 });
  }
  const SEV = ["high", "medium", "low"];
  const findings: Finding[] = [...own, ...mergeFindings(ok).filter((f) => !contradicts(lay, f))].sort((p, q) => SEV.indexOf(p.severity) - SEV.indexOf(q.severity) || p.line_start - q.line_start);
  return Response.json({ findings, by: [...ok.map((r) => r.by), ...(own.length ? ["Synchro"] : [])] });
});
