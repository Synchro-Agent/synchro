import "server-only";
// Phần lời nhắc của bộ xử lý chat (tách từ chatengine.ts, H3 bước 6a): quy tắc trả lời, ghi chú cho CLI qua cầu nối, điểm đệm prompt,
// khối ngữ cảnh của lượt (giờ, hồ sơ, trí nhớ, khủng hoảng, thiết kế) và ước lượng độ dài. Chỉ phụ thuộc mô-đun bên ngoài.
import type { UserRow } from "../authstore";
import { prepareHistory } from "../transpile";
import { isAck, typedText } from "../router";
import { runner } from "../coderun";
import { designTurn, historyTexts } from "../designkit";
import { videoTurn } from "../videokit";
import { docTurn } from "../dockit";
import { featTurn } from "../featkit";
import { REJECTED_TAG } from "../../shared/turnctx";
import { imageProduct } from "../ai/imagegen";
import { AGY_WAIT_NOTE } from "../mcpbridge";
import { userContext } from "../memory";
import { crisisHelp } from "../crisishelp";
import { brainReady } from "../brain";

// Bộ nhớ đệm prompt của Anthropic: điểm đệm thứ nhất ở cuối phần hệ thống (công cụ + hướng dẫn + danh mục skill),
// điểm thứ hai ở cuối tin nhắn mới nhất. Lịch sử hội thoại và các bước gọi công cụ trong cùng lượt được đọc lại từ bộ đệm
// (rẻ hơn nhiều so với gửi lại), chỉ phần mới được tính đủ giá. Không sửa mảng gốc vì vòng lặp còn thêm bước vào đó.
// hist: chỉ số tin cuối của phần lịch sử ổn định (trước tin nhắn mới nhất có tầng động): thêm một điểm đệm ở đó để lượt sau
// đọc lại được cả lịch sử từ bộ đệm dù tầng động của lượt này không còn trong lịch sử nữa.
function markOne(m: unknown): unknown {
  const x = m as { role: string; content: unknown };
  const blocks = typeof x.content === "string" ? [{ type: "text", text: x.content }] : Array.isArray(x.content) ? (x.content as Record<string, unknown>[]) : null;
  if (!blocks?.length) return m;
  const i = blocks.length - 1;
  return { ...x, content: blocks.map((b, k) => (k === i ? { ...b, cache_control: { type: "ephemeral" } } : b)) };
}
export function withCacheMark(msgs: unknown[], hist = -1): unknown[] {
  if (!msgs.length) return msgs;
  return msgs.map((m, i) => (i === msgs.length - 1 || (i === hist && hist < msgs.length - 1) ? markOne(m) : m));
}
// Cách làm việc khi có công cụ: nói cho người dùng biết đang làm gì như một người thật, thay vì im lặng tới khi xong.
// Chuẩn làm việc cho mọi lượt chat chính: làm trọn, tự kiểm trước khi giao, trung thực, chịu trách nhiệm khi có lỗi (người dùng từng gặp
// model "biết là lỗi nhưng chỉ nói không làm được", giao slide lỗi mà không hay biết). Ngắn và ổn định để đọc từ bộ đệm prompt.
export const QUALITY_RULES = `<working_standards>
Làm việc như một chuyên gia tận tâm, chịu trách nhiệm đến cùng với kết quả:
- Làm trọn: giao sản phẩm hoàn chỉnh dùng được ngay, không để chỗ trống, "TODO", "…" hay phần "bạn tự điền". Việc lớn thì chia bước và làm hết.
- Tự kiểm trước khi giao: đọc lại, chạy thử, đối chiếu số liệu, xem lại sản phẩm bằng công cụ có sẵn; sửa hết lỗi mình thấy rồi mới báo xong.
- Trung thực: không bịa số liệu, nguồn, trích dẫn hay khả năng. Chưa chắc thì nói rõ mức độ chắc chắn và cách kiểm chứng. Khi báo xong, nói rõ đã thật sự kiểm tra gì (chạy thử, mở xem, đối chiếu nguồn) và điều gì chưa kiểm tra được; không viết "đã kiểm tra", "chạy tốt", "đã xác minh" nếu chưa làm.
- Khi người dùng báo lỗi: nhận trách nhiệm, tìm đúng nguyên nhân (tái hiện bằng công cụ), sửa tận gốc, kiểm tra lại, rồi báo ngắn gọn đã sửa gì. Không đổ cho công cụ hay môi trường khi còn cách khác để thử.
- Không nói "không làm được" khi chưa thử các cách khả thi. Thật sự bị chặn thì nói đã thử gì, vì sao chưa được, và giao phương án tốt nhất có thể ngay trong lượt này.
- Ngôn ngữ: trả lời bằng đúng ngôn ngữ người dùng đang viết (hỏi tiếng Anh thì trả lời tiếng Anh, dù hướng dẫn này viết bằng tiếng Việt), trừ khi họ yêu cầu khác. Gõ tiếng Việt không dấu thì trả lời tiếng Việt có dấu.
- Chu đáo: trình bày rõ ràng, đúng chính tả; nêu điều quan trọng người dùng cần biết (rủi ro, giới hạn, bước tiếp theo) một cách ngắn gọn.
- Giữ riêng tư: không đưa tệp, ảnh hay dữ liệu của người dùng lên dịch vụ bên ngoài khi họ chưa yêu cầu rõ.
- Thông tin dễ thay đổi (giá, tỉ giá, tin tức, lịch, phiên bản phần mềm, quy định mới): có công cụ tìm web thì tìm trước rồi mới trả lời, nói rõ dữ liệu tính đến lúc nào và ghi nguồn bằng liên kết markdown. Mốc thời gian chép đúng như nguồn ghi (ngày, giờ, múi giờ của trang, vd. "cập nhật 15/11/2026 17:00 theo trang Vietcombank"), không tự suy ra, đổi múi giờ hay lấy giờ của lần tìm thay vào; nguồn không ghi mốc thì nói là số liệu lúc bạn tra (giờ trong <current_time>). Không tìm được thì nói rõ thông tin có thể đã cũ. Giờ hiện tại nằm trong khối <current_time> của tin nhắn mới nhất.
- Sức khỏe, pháp lý, tài chính: nêu mức độ khẩn trước (dấu hiệu nguy hiểm thì khuyên gọi cấp cứu hoặc đi viện ngay), nói rõ điều chưa chắc, và khi nào cần gặp chuyên gia.
- Người dùng nói muốn tự tử, tự làm hại mình hoặc tuyệt vọng: đáp lại với sự quan tâm thật, không phán xét, không liệt kê cách làm; hỏi họ có đang an toàn không, khuyên liên hệ ngay người thân tin cậy hoặc đường dây khẩn cấp ở đúng nơi họ sống (Việt Nam: 115 cấp cứu, 111 bảo vệ trẻ em; Mỹ: 988; New Zealand: 111 cấp cứu, 1737 tư vấn). Biết nơi họ sống qua múi giờ ở <current_time> và ngôn ngữ: người viết tiếng Việt mà không có dấu hiệu ở nước khác thì nêu số Việt Nam, không nêu 988; không rõ nơi nào thì bảo gọi số cấp cứu địa phương, nhờ người ở gần và hỏi họ ở đâu, không tự nêu số mình không chắc. Trả lời bằng ngôn ngữ của họ.
- Ảnh do AI tạo: dùng công cụ generate_image nếu có (xem <image_generation>). Không có công cụ đó, hoặc công cụ báo chưa tạo được, thì nói rõ điều đó ngay câu đầu, không gọi sản phẩm thay thế là ảnh AI hay ảnh chụp, rồi đề xuất phương án tốt nhất: hình SVG hoặc đồ họa dựng bằng mã (HTML, Pillow), ảnh thật có giấy phép mở từ Wikimedia Commons khi có quyền web (ghi rõ nguồn), hoặc câu lệnh để họ dán vào công cụ tạo ảnh khác.
</working_standards>`;
// Đường nhanh: câu rõ ràng không cần công cụ (router.needsNoTools) đi với hướng dẫn rất ngắn, không cầu nối MCP, không mục lục skill. Đo trên máy chủ thật: một câu chào qua
// Claude Haiku chờ 4,8 giây, trong đó 1,5 giây là đọc 69 KB hướng dẫn. Công cụ vẫn còn nguyên ở lượt sau; model thấy cần công cụ thì báo NEED_TOOLS và Synchro chạy lại lượt đầy đủ.
export const NEED_TOOLS = "[[CAN_CONG_CU]]";
/** Đúng phần hướng dẫn chất lượng của lượt thật, cho tools/answer-eval.mjs chấm câu trả lời trên CLI thật. */
export const answerRules = (fast: boolean) => (fast ? FAST_RULES : QUALITY_RULES);
export const FAST_RULES = `<quick_reply>
Đây là câu trò chuyện, câu hỏi ngắn hoặc việc viết ngắn: trả lời ngay, tự nhiên, bằng đúng ngôn ngữ người dùng đang viết (hỏi tiếng Anh thì trả lời tiếng Anh, dù hướng dẫn này viết bằng tiếng Việt; gõ không dấu thì trả lời có dấu). Câu hỏi thì ngắn gọn; nhờ viết (email, thư, thơ, caption…) thì viết đủ, chỉn chu, đưa bài viết ra ngay, không kể lại yêu cầu. Trung thực: không bịa số liệu, nguồn hay khả năng; chưa chắc thì nói rõ. Lượt này không có công cụ nên đừng nói đã tìm, đã tra, đã chạy hay đã kiểm tra. Giờ hiện tại nằm trong khối <current_time> của tin nhắn mới nhất.
Lượt này chưa nạp công cụ, nhưng Synchro có đủ: tìm web, chạy code, tạo tệp và artifact, tạo ảnh bằng AI, skill, connector, trình duyệt. Nếu câu trả lời tốt thật sự cần một trong số đó, hoặc cần thông tin mới hơn những gì bạn biết, đừng giải thích và đừng xin lỗi: chỉ trả lời đúng một dòng ${NEED_TOOLS} rồi dừng.
An toàn đứng trước sự ngắn gọn. Tin nhắn có thể nói tới tự làm hại, tuyệt vọng, bị bạo hành hay xâm hại (kể cả nói gián tiếp), hoặc tình huống y tế khẩn: không trả lời cho qua. Đáp với sự quan tâm thật, không phán xét, không nêu cách làm hại; nói rõ mức độ khẩn, hỏi họ có đang an toàn không, khuyên liên hệ ngay người thân tin cậy, cấp cứu hoặc đường dây khẩn cấp đúng nơi họ sống, biết qua múi giờ ở <current_time> và ngôn ngữ (Việt Nam: 115 cấp cứu, 111 bảo vệ trẻ em; Mỹ: 988; New Zealand: 111 cấp cứu, 1737 tư vấn). Viết tiếng Việt mà không có dấu hiệu ở nước khác thì nêu số Việt Nam, không nêu 988; không rõ nơi nào thì bảo gọi số cấp cứu địa phương và hỏi họ ở đâu, không tự nêu số mình không chắc. Câu hỏi sức khỏe, pháp lý, tài chính: nêu điều chưa chắc và khi nào cần gặp chuyên gia.
</quick_reply>`;
export const NARRATE_RULES = `<working_out_loud>
Khi cần dùng công cụ, hãy làm việc "thành tiếng" bằng ngôn ngữ của người dùng:
- Trước mỗi bước, viết 1 câu ngắn nói bạn sắp làm gì và vì sao (ví dụ "Mình sẽ đọc tài liệu của skill trước để làm đúng định dạng.").
- Một bước có thể gồm nhiều công cụ: việc không phụ thuộc nhau (đọc nhiều skill hay nhiều tệp tham khảo, nhiều lượt tìm web, mở nhiều trang) thì gọi cùng lúc trong một bước, không gọi lần lượt từng cái.
- Có kết quả rồi thì nói ngắn điều vừa tìm thấy trước khi làm bước tiếp theo.
- Việc có từ 3 bước trở lên: gọi update_plan để hiện danh sách việc và cập nhật khi xong từng bước.
- Nếu có khối <user_followup>: đó là tin người dùng nhắn thêm khi bạn đang làm. Ghép yêu cầu đó vào việc đang làm (ưu tiên nếu nó đổi yêu cầu), nói ngắn rằng bạn đã nhận và sẽ làm thế nào, rồi làm tiếp — không bỏ dở việc trước.
- Câu trả lời cuối: nhật ký làm việc và danh sách việc được thu gọn khi xong, nên câu trả lời cuối là phần tổng kết cho người dùng đọc: kết quả chính (sản phẩm, con số, tệp), điều đáng chú ý khi làm, và điều chưa làm được hay cần người dùng quyết; không kể lại từng bước.
</working_out_loud>`;
// Gói chạy qua CLI (Claude Code, Codex, Antigravity, Grok) gọi công cụ của Synchro qua cầu nối MCP "synchro".
export const BRIDGE_CLIS = new Set(["claude", "codex", "agy", "grok"]);
// Antigravity (-p): công cụ dựng sẵn của nó cần duyệt nên bị tự chặn (lượt dừng sau câu dẫn) — nói trước để model dùng ngay công cụ của
// Synchro thay vì thử công cụ của agy rồi mới được nhắc (tin đầu "tóm tắt video YouTube" từng dừng ở "Mình sẽ lấy phụ đề qua lệnh script").
// Antigravity chỉ trả chữ một lần khi xong lượt: không có danh sách việc thì người dùng chỉ thấy "vẫn đang viết" suốt
// mấy phút dựng bộ slide.
const AGY_PLAN = " Câu trả lời của bạn chỉ tới người dùng một lần khi xong lượt: việc dài (bộ slide, trang web,"
  + " tài liệu nhiều phần) thì gọi mcp_synchro_update_plan trước khi viết và gọi lại khi xong mỗi bước,"
  + " để người dùng thấy tiến độ trong lúc chờ.";
const AGY_NOTE = (web: boolean, image: boolean) => agyTools(web, image) + AGY_PLAN;
const agyTools = (web: boolean, image: boolean) => `
Ở đây công cụ dựng sẵn của Antigravity bị chặn: run_command (lệnh / script), write_to_file, view_file, list_dir, read_url_content, read_browser_page, browser_subagent${web ? "" : ", search_web"}. Gọi chúng thì lượt dừng ngay, chưa làm được gì — đừng gọi. Chỉ dùng công cụ mcp_synchro_…: mở và đọc trang web (cả video YouTube: mở trang video, đọc tiêu đề, mô tả, bản chép lời) bằng mcp_synchro_browser_navigate rồi mcp_synchro_browser_read / mcp_synchro_browser_text; chạy code bằng mcp_synchro_run_code.${web ? " Tìm web được dùng search_web." : ""}${image ? " Tạo ảnh chỉ bằng mcp_synchro_generate_image, không dùng image-generator của Antigravity: chỉ công cụ đó mới giao được ảnh tới người dùng." : ""}${AGY_WAIT_NOTE}`;
// Grok CLI: công cụ MCP nằm sau search_tool / use_tool, tên đầy đủ là synchro__<tên>; công cụ dựng sẵn (shell, đọc / sửa tệp) bị tắt.
const GROK_NOTE = ", tên đầy đủ là synchro__<tên> (ví dụ synchro__load_skill): tìm bằng search_tool nếu cần, gọi bằng use_tool với đúng tên đó. Công cụ dựng sẵn của Grok (shell, đọc / sửa tệp) đã tắt ở đây";
// Codex có công cụ lập kế hoạch dựng sẵn cùng tên update_plan: chỉ một danh sách việc mỗi lượt (lỗi 8 của ma trận H1), cập nhật ngay khi xong từng bước.
const CODEX_PLAN_NOTE = " Danh sách việc cho người dùng: dùng update_plan của máy chủ synchro (không dùng công cụ lập kế hoạch dựng sẵn của Codex) và gọi lại ngay khi xong mỗi bước, trước khi làm bước sau";
// image: Synchro Code không có generate_image, đừng nhắc tới công cụ không tồn tại.
export const CLI_TOOLS_NOTE = (cli: string, web: boolean, image: boolean) => `<synchro_tools>
Các công cụ nói ở trên (load_skill, read_skill_file, search_skills, run_skill_script, run_code, ${image ? "generate_image, " : ""}read_ref, update_plan, browser_* và công cụ của connector) nằm trong máy chủ MCP "synchro"${cli === "claude" ? ", gọi bằng tên có tiền tố mcp__synchro__ (ví dụ mcp__synchro__load_skill)" : cli === "agy" ? ", gọi bằng tên có tiền tố mcp_synchro_ (ví dụ mcp_synchro_load_skill)" : cli === "grok" ? GROK_NOTE : cli === "codex" ? CODEX_PLAN_NOTE : ""}. Dùng chúng đúng như mô tả; không cần công cụ nào khác để làm việc với skill, tệp hay dữ liệu của người dùng. Thư mục làm việc của CLI có thể chỉ cho đọc: đó không phải lý do để từ chối tạo tệp — tệp (Word, Excel, PowerPoint, PDF, ảnh, video…) tạo bằng run_code của Synchro, ghi vào outputs/. Máy chạy CLI (shell, công cụ dựng sẵn của bạn) không phải nơi làm việc: mọi lệnh và chương trình (ffmpeg, LibreOffice, Chromium…) chạy trong run_code.${cli === "agy" ? AGY_NOTE(web, image) : ""}
</synchro_tools>`;

// Văn bản của tin nhắn người dùng mới nhất (nội dung có thể là chuỗi hoặc danh sách khối).
export function lastUserText(messages: unknown): string {
  const list = Array.isArray(messages) ? (messages as { role?: string; content?: unknown }[]) : [];
  const m = [...list].reverse().find((x) => x?.role === "user");
  if (!m) return "";
  if (typeof m.content === "string") return m.content.slice(0, 4000);
  // Khối <attachments_rejected> (tệp không đọc được, do turnctx.withRejected chèn lên đầu tin nhắn mới nhất) là dữ liệu, không phải chữ người dùng gõ:
  // bỏ qua ở đây để không lẫn vào brain recall, crisisHelp, mentionsConnector / announceOffline, hasOwnSkill (cùng cách router.FILE_TEXT bỏ khối này khi chọn việc).
  return Array.isArray(m.content) ? (m.content as { type?: string; text?: string }[]).filter((b) => b?.type === "text" && typeof b.text === "string" && !b.text.trimStart().startsWith(`<${REJECTED_TAG}>`)).map((b) => b.text).join("\n").slice(0, 4000) : "";
}

// Artifact dùng AI: trang trong artifact gọi window.synchro.complete(...) → trình duyệt chuyển tới đây.
// Không có công cụ, không có skill; chỉ tài khoản đang bật "Artifact dùng AI" mới gọi được.
export const ARTIFACT_SYSTEM = "Bạn là model AI được một ứng dụng nhỏ (artifact) gọi tới từ bên trong Synchro. Trả lời đúng điều được yêu cầu, không chào hỏi hay giải thích thêm. Khi được yêu cầu trả về JSON, chỉ trả JSON hợp lệ, không bọc trong ```.";
export function artifactMessages(raw: unknown): { role: "user" | "assistant"; content: string }[] | null {
  const list = typeof raw === "string" ? [{ role: "user", content: raw }] : Array.isArray(raw) ? raw : null;
  if (!list?.length || list.length > 60) return null;
  let total = 0;
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of list as { role?: unknown; content?: unknown }[]) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role || typeof m.content !== "string" || !m.content) return null;
    total += m.content.length;
    out.push({ role, content: m.content });
  }
  return total <= 120_000 && out[out.length - 1].role === "user" ? out : null;
}

// Tài liệu ghim của đoạn chat: [{ name, text }] (trình duyệt đã đọc chữ từ tệp), tối đa 200.000 ký tự.
export function pinnedBlock(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  let left = 200_000;
  const docs = raw.slice(0, 20).flatMap((d) => {
    const o = (d ?? {}) as { name?: unknown; text?: unknown };
    const name = typeof o.name === "string" ? o.name.slice(0, 120).replace(/"/g, "'") : "";
    const text = typeof o.text === "string" ? o.text.slice(0, left) : "";
    if (!name || !text.trim()) return [];
    left -= text.length;
    return [`<document name="${name}">\n${text}\n</document>`];
  });
  return docs.length ? `<pinned_documents>\nTài liệu người dùng đã ghim cho đoạn chat này (luôn có trong ngữ cảnh). Dùng khi liên quan:\n${docs.join("\n")}\n</pinned_documents>` : "";
}
// Bàn trộn ngữ cảnh: ước tính token từng khối của lượt tiếp theo (không gọi model). ~3,5 ký tự một token (tiếng Việt và tiếng Anh lẫn nhau).
const tok = (chars: number) => Math.ceil(chars / 3.5);
export function estimate(sys: string[], skills: string[], pinned: string, prep: ReturnType<typeof prepareHistory>) {
  const len = (a: string[]) => a.filter(Boolean).reduce((n, x) => n + x.length, 0);
  const z = prep.sizes;
  const blocks = [
    { key: "system", tier: "static", chars: len(sys) },
    { key: "skills", tier: "static", chars: len(skills) },
    { key: "pinned", tier: "static", chars: pinned.length },
    { key: "summary", tier: "history", chars: z.summary },
    { key: "history", tier: "history", chars: z.history },
    { key: "tools", tier: "dynamic", chars: z.tools },
    { key: "artifacts", tier: "dynamic", chars: z.artifacts },
    { key: "dynamic", tier: "dynamic", chars: z.dynamic },
  ].map((b) => ({ ...b, tokens: tok(b.chars) }));
  return Response.json({ blocks, total: blocks.reduce((n, b) => n + b.tokens, 0), dropped: z.dropped });
}
// Quy tắc thiết kế theo việc đang làm (designkit.ts): đi cạnh tin nhắn mới nhất như skill_routing, không vào hướng dẫn hệ thống. Không có với Synchro Code, lệnh nội bộ, artifact có AI.
// Hướng dẫn riêng của tính năng (featkit.ts: biểu đồ, 3D, Morph, văn bản hành chính, ảnh sản phẩm / poster) cũng đi ở đây, cả trong Synchro Code
// (ARTIFACT_RULES vẫn có ở đó), chỉ khi lượt này cần: lời nhắc hệ thống giữ quy tắc chung, đứng yên giữa các lượt cho bộ đệm prompt.
export function designOf(body: Record<string, any>, caps: { art: boolean; code: boolean; image: boolean } | null, studio: string | null, conv?: string): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!caps || !body.skills || body.feature === "artifact") return "";
  const typed = typedText((Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").pop());
  const prior = historyTexts(body.messages, body.artBase), product = body.feature !== "code";
  const d = product ? designTurn({ typed, studio, art: caps.art, code: caps.code, ack: isAck(typed), seed: conv, prior }) : null;
  if (d) console.log(`[design] ${d.format} ${d.domain} ${d.own ? "own-brand" : d.preset}${d.compact ? " follow-up" : ""} ${d.bytes}B`);
  // Nhờ dựng video: thêm khối synchro-video (4 mẫu Remotion trong sandbox), chỉ khi run_code chạy trên image workspace.
  const v = product ? videoTurn({ typed, code: caps.code, workspace: runner() === "workspace" }) : "";
  if (v) console.log(`[video] synchro-video ${Buffer.byteLength(v)}B`);
  // Nhờ làm tệp tài liệu (báo cáo PDF, đề xuất, bài 2 cột, hóa đơn / báo giá): thêm khối synchro-doc (4 mẫu Typst / WeasyPrint), chỉ image workspace.
  const k = product ? docTurn({ typed, code: caps.code, workspace: runner() === "workspace", format: d?.format }) : "";
  if (k) console.log(`[doc] synchro-doc ${Buffer.byteLength(k)}B`);
  const f = featTurn({ typed, art: caps.art, image: caps.image, product: caps.image && imageProduct(), format: d && !d.compact ? d.format : null, prior });
  if (f.parts.length) console.log(`[featkit] ${f.parts.join(",")} ${Buffer.byteLength(f.block)}B`);
  return [d?.block ?? "", v, k, f.block].filter(Boolean).join("\n\n");
}
// Bộ nhớ chỉ dùng cho lượt chat chính (không cho Code, artifact, lệnh nội bộ), khi nút "Bộ nhớ" bật và không ở chế độ ẩn danh.
// Những gì Synchro biết về người dùng (tên, phần tự giới thiệu / hướng dẫn ở Cài đặt → Tài khoản, bộ nhớ khi bật): mọi lượt người dùng
// trò chuyện (chat, Synchro Code), kể cả ẩn danh (khi đó không kèm bộ nhớ); không áp dụng cho lời gọi nội bộ (đặt tên, rút bộ nhớ…)
// và artifact có AI.
export const useProfile = (body: Record<string, any>) => !!body.skills && body.feature !== "artifact"; // eslint-disable-line @typescript-eslint/no-explicit-any
export const contextOf = (body: Record<string, any>, u: UserRow) => (useProfile(body) ? userContext(u, { memory: useMemory(body, u) }) : ""); // eslint-disable-line @typescript-eslint/no-explicit-any
/** Model tự tra, đọc theo liên kết và ghi vào bộ não (công cụ brain_*), cùng điều kiện với phần ghi chú liên quan. */
export const brainOn = (body: Record<string, any>, u: UserRow) => useProfile(body) && body.memory !== false && !body.incognito && brainReady(u.id); // eslint-disable-line @typescript-eslint/no-explicit-any
/** Gói subscription: ghi chú liên quan ghép vào cuối tin nhắn mới nhất (CLI chỉ nhận lời nhắc hệ thống ở lượt đầu của phiên). */
export function withRecall(messages: unknown, recall: string): unknown {
  if (!recall || !Array.isArray(messages) || !messages.length) return messages;
  const out = [...messages] as { role?: string; content?: unknown }[];
  const i = out.map((m) => m?.role).lastIndexOf("user");
  if (i < 0) return messages;
  const c = out[i].content;
  out[i] = { ...out[i], content: typeof c === "string" ? `${c}\n\n${recall}` : Array.isArray(c) ? [...c, { type: "text", text: recall }] : c };
  return out;
}
export const DEFAULT_SYSTEM = "Bạn là một trợ lý AI hữu ích.";
/** Giữ chữ đầu của đường nhanh tới khi chắc đó không phải NEED_TOOLS (dấu hiệu này không được hiện cho người dùng). */
export function holdNeedTools(out?: (t: string) => void) {
  let buf = "", open = false;
  return (t: string) => {
    if (open) { out?.(t); return; }
    buf += t;
    const s = buf.trimStart();
    if (NEED_TOOLS.startsWith(s) || s.startsWith(NEED_TOOLS)) return;
    open = true; out?.(buf);
  };
}
export const useMemory = (body: Record<string, any>, _u: UserRow) => !!body.skills && body.feature !== "code" && body.feature !== "artifact" && body.memory !== false && !body.incognito; // eslint-disable-line @typescript-eslint/no-explicit-any
// Giờ hiện tại đặt cạnh tin nhắn mới nhất (như gợi ý định tuyến skill): hướng dẫn hệ thống giữ nguyên để đọc từ bộ đệm, phiên nối tiếp vẫn biết đúng giờ.
export function nowBlock(body: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!useProfile(body)) return "";
  const at = (timeZone?: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date());
  const tz = typeof body.tz === "string" && body.tz.length <= 64 ? body.tz : "";
  try { return `<current_time>${at(tz || undefined)}${tz ? ` (${tz})` : ""}</current_time>`; }
  catch { return `<current_time>${at()}</current_time>`; }
}
// Đầu mối trợ giúp đúng nơi họ sống, đặt cạnh tin nhắn mới nhất như dòng giờ: chỉ có ở lượt cần, hướng dẫn hệ thống giữ nguyên để đọc từ bộ đệm.
export function crisisBlock(body: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!useProfile(body)) return "";
  return crisisHelp(lastUserText(body.messages), typeof body.tz === "string" && body.tz.length <= 64 ? body.tz : undefined);
}
