// Artifact: nội dung độc lập model viết trong câu trả lời (trang web, ứng dụng React, SVG, tài liệu, code, sơ đồ),
// hiện trong khung riêng cạnh cuộc trò chuyện. Model viết theo dạng
//   <artifact identifier="todo-app" type="application/vnd.react" title="Danh sách việc cần làm"> ... </artifact>
// Cùng identifier trong một cuộc trò chuyện là các phiên bản của cùng một artifact.
// Tệp này dùng chung cho trình duyệt (tách artifact khỏi câu trả lời) và máy chủ (hướng dẫn cho model).
import { expandTemplates } from "./designtemplates";
import { isDeck } from "./artgen";

export const ART_TYPES = ["html", "react", "svg", "markdown", "code", "mermaid", "d2", "vbhc"] as const;
export type ArtType = (typeof ART_TYPES)[number];
// patch: câu trả lời chỉ gửi các khối SEARCH/REPLACE để sửa bản trước (vfs.ts áp vào thành bản đầy đủ); patchText giữ nguyên khối sửa.
export type ArtBlock = { ident: string; title: string; type: ArtType; lang: string | null; content: string; complete: boolean; patch?: boolean; patchText?: string };
export type Seg = { kind: "text"; text: string } | { kind: "art"; art: ArtBlock };

const MIME: Record<string, ArtType> = {
  "text/html": "html", html: "html", "application/vnd.react": "react", "application/vnd.ant.react": "react", react: "react", jsx: "react", tsx: "react",
  "image/svg+xml": "svg", svg: "svg", "text/markdown": "markdown", markdown: "markdown", md: "markdown", "application/vnd.code": "code", "application/vnd.ant.code": "code", code: "code",
  "application/vnd.mermaid": "mermaid", "application/vnd.ant.mermaid": "mermaid", mermaid: "mermaid",
  "application/vnd.d2": "d2", "text/vnd.d2": "d2", d2: "d2",
  "application/vnd.synchro.vbhc+json": "vbhc", vbhc: "vbhc",
};
export const ART_LABEL: Record<ArtType, string> = { html: "Trang web", react: "Ứng dụng", svg: "Hình SVG", markdown: "Tài liệu", code: "Mã nguồn", mermaid: "Sơ đồ", d2: "Sơ đồ D2", vbhc: "Văn bản hành chính" };
// Bộ slide đang viết dở mới có phần đầu (CSS, trang bìa) nên isDeck chưa nhận ra: khung xem trước từng ghi "Trang web"
// suốt lúc dựng. Dấu hiệu sớm: thẻ section là slide, lớp deck, hoặc luật CSS cho .slide có khổ trang chiếu (1280x720,
// 16:9, cả màn hình). Chỉ có luật .slide thì chưa đủ: carousel lời khen / dự án của landing page cũng có ".slide {".
const DECK_TAG = new RegExp("<section\\b[^>]*(?:class=[\"'][^\"']*\\bslide\\b|data-slide)"
  + "|class=[\"'][^\"']*\\bdeck\\b|\\.deck(?![\\w-])[^{}]*\\{", "i");
const SLIDE_SIZE = new RegExp("\\.slide(?![\\w-])[^{}]*\\{[^}]*(?:\\b1280px|\\b720px"
  + "|aspect-ratio\\s*:\\s*16\\s*\\/\\s*9"
  + "|width\\s*:\\s*100vw[^}]*height\\s*:\\s*100vh|height\\s*:\\s*100vh[^}]*width\\s*:\\s*100vw)", "i");
const deckHint = (html: string) => DECK_TAG.test(html) || SLIDE_SIZE.test(html);
/**
 * Tên loại hiện trên khung / thẻ artifact (chữ gốc tiếng Việt, dịch khi hiện): bộ slide là "Bản trình bày", kể cả khi
 * đang viết.
 */
export function artKindLabel(a: { type: ArtType; content: string; complete?: boolean }): string {
  const building = a.complete === false && a.type === "html";
  if (isDeck(a) || (building && deckHint(a.content))) return "Bản trình bày";
  // Mới có phần đầu tệp, chưa tới <body>: chưa biết là trang web hay bộ slide, không đoán.
  if (building && !/<body\b/i.test(a.content)) return "Đang tạo…";
  return ART_LABEL[a.type];
}
export const ART_EXT: Record<ArtType, string> = { html: "html", react: "jsx", svg: "svg", markdown: "md", code: "txt", mermaid: "mmd", d2: "d2", vbhc: "json" };
const LANG_EXT: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", bash: "sh", sh: "sh", shell: "sh", go: "go", rust: "rs", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", ruby: "rb", php: "php", swift: "swift", kotlin: "kt", sql: "sql", css: "css", json: "json", yaml: "yml", html: "html" };
export const artFileName = (a: { title: string; type: ArtType; lang: string | null }) => {
  const base = a.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "artifact";
  return `${base}.${a.type === "code" ? LANG_EXT[(a.lang ?? "").toLowerCase()] ?? "txt" : ART_EXT[a.type]}`;
};

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]).replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
};
// Model đôi khi bọc nội dung trong ``` … ```: bỏ đi.
const unfence = (s: string) => {
  const t = s.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const m = /^```[\w+#.-]*\n([\s\S]*?)\n?```$/.exec(t.trim());
  return m ? m[1] : t;
};

// Tách câu trả lời thành đoạn chữ và artifact. Artifact chưa có thẻ đóng (đang được viết) có complete = false.
export function splitArtifacts(text: string): Seg[] {
  const out: Seg[] = [];
  const re = /<artifact\b([^>]*)>/gi;
  let pos = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tag = m[0];
    const close = text.indexOf("</artifact>", m.index + tag.length);
    const patch = (attr(tag, "mode") ?? "").toLowerCase() === "patch";
    // Bản sửa (patch) thừa hưởng kiểu của bản trước nên được phép thiếu type.
    const type = MIME[(attr(tag, "type") ?? "").toLowerCase()] ?? (patch ? "code" : null);
    const ident = (attr(tag, "identifier") ?? attr(tag, "id") ?? "").trim().toLowerCase().replace(/[^\w.-]+/g, "-").slice(0, 80);
    if (!type || !ident) continue;
    if (m.index > pos) out.push({ kind: "text", text: text.slice(pos, m.index) });
    const body = text.slice(m.index + tag.length, close === -1 ? undefined : close);
    // Trang dùng mẫu điền sẵn (khối JSON data-sx-template): dựng thành HTML ngay đây, mọi nơi sau đó (khung xem, xuất tệp, kiểm tra, bản hiện tại gửi model) thấy cùng một trang.
    const content = !patch && type === "html" ? expandTemplates(unfence(body)) : unfence(body);
    out.push({ kind: "art", art: { ident, title: (attr(tag, "title") ?? (patch ? "" : ident)).trim().slice(0, 200) || (patch ? "" : ident), type, lang: attr(tag, "language"), content, complete: close !== -1, ...(patch ? { patch } : {}) } });
    pos = close === -1 ? text.length : close + "</artifact>".length;
    re.lastIndex = pos;
  }
  if (pos < text.length) out.push({ kind: "text", text: text.slice(pos) });
  // Đang gõ dở thẻ mở ("<arti…") ở cuối: ẩn đi cho khỏi nháy chữ.
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text = last.text.replace(/<a(r(t(i(f(a(c(t[^>]*)?)?)?)?)?)?)?$/i, "");
  return out.filter((s) => s.kind === "art" || s.text);
}

export const hasArtifacts = (text: string) => /<artifact\b[^>]*\b(identifier|id)\s*=/i.test(text);

// Artifact tắt: đổi artifact thành khối code thường để vẫn đọc được nội dung.
export function artifactsAsCode(text: string): string {
  return splitArtifacts(text).map((s) => (s.kind === "text" ? s.text : `\n\n**${s.art.title}**\n\n\`\`\`${s.art.type === "code" ? s.art.lang ?? "" : s.art.type === "react" ? "jsx" : s.art.type === "markdown" ? "md" : s.art.type}\n${s.art.content}\n\`\`\`\n\n`)).join("");
}

// ---------------------------------------------------------------- hướng dẫn cho model (máy chủ ghép vào system prompt)
export const ARTIFACT_RULES = (ai: boolean) => `<artifacts>
Khi người dùng cần một nội dung độc lập, đủ dài và có thể dùng lại (trang web, ứng dụng nhỏ, công cụ tương tác, trò chơi, hình SVG, tài liệu dài, đoạn code hoàn chỉnh, sơ đồ), hãy đặt nó trong một artifact. Artifact hiện trong khung riêng cạnh cuộc trò chuyện để người dùng xem trước, chạy thử, sao chép, tải về.
Cú pháp: <artifact identifier="ten-ngan-gon" type="KIỂU" title="Tiêu đề ngắn">NỘI DUNG</artifact>
KIỂU: text/html (một trang HTML hoàn chỉnh, CSS và JS viết ngay trong trang) · application/vnd.react (một component React, export default, dùng hook bình thường) · image/svg+xml · text/markdown · application/vnd.code (thêm language="python"…) · application/vnd.mermaid · application/vnd.d2 (sơ đồ kiến trúc D2, Synchro vẽ thành SVG / PNG) · application/vnd.synchro.vbhc+json (văn bản hành chính Việt Nam, trường theo <vbhc_kit>).
React: có sẵn react, recharts, lucide-react, echarts, three, @react-three/fiber, @react-three/drei, shadergradient, Tailwind (className); import bình thường (echarts và bộ 3D chỉ tải khi import). Canvas WebGL tự viết: gl={{ preserveDrawingBuffer: true }} để ảnh / PowerPoint tải về không trắng. Không có thư viện khác, không dùng localStorage/sessionStorage.
Lưu dữ liệu (ứng dụng ghi chú, danh sách việc, chấm công, khảo sát, kho hàng…): dùng window.storage, mọi hàm trả Promise: await window.storage.get(key, shared) → {key, value} hoặc null; await window.storage.set(key, value, shared) (value là chuỗi, dữ liệu có cấu trúc thì JSON.stringify); await window.storage.delete(key, shared); await window.storage.list(prefix, shared) → {keys}. shared = true: dữ liệu chung của mọi người dùng ứng dụng (khi người dùng xuất bản artifact thành ứng dụng cho cả tổ chức); false: dữ liệu riêng của người đang dùng. Mỗi giá trị tối đa 100 KB. Luôn bọc try/catch, hiện trạng thái đang lưu, và nạp dữ liệu khi mở. Dữ liệu chung nên cập nhật trực tiếp: window.storage.onChange(({key}) => nạp lại key đó) được gọi ngay khi người khác đang mở cùng ứng dụng vừa đổi dữ liệu chung. Người dùng xuất bản artifact thành ứng dụng có địa chỉ riêng bằng nút tên lửa trên khung xem trước.
HTML: có thể nạp thư viện từ cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com. Artifact không gọi được mạng (fetch/XHR bị chặn).
Hình SVG: đây là đồ họa vẽ bằng mã, không phải ảnh do AI tạo; đừng gọi là ảnh AI. Người dùng xin ảnh chụp, tranh, minh họa, logo hay poster thì dùng generate_image nếu có công cụ đó; SVG dành cho khi họ cần tệp vector, sơ đồ hoặc chữ chính xác. Vẽ có chủ đích: viewBox rõ, bố cục theo lưới, bảng màu 2–3 màu, chuyển màu và bóng mềm (linearGradient, filter) tạo chiều sâu, hình ghép từ path thay vì vài khối cơ bản, chữ chuyển đúng phông có đủ dấu tiếng Việt.
Ảnh (cả HTML lẫn React): dùng URL ảnh https công khai trực tiếp trong src / url(...) (Synchro tự tải và nhúng khi hiển thị), hoặc data: URI, SVG; ảnh generate_image vừa tạo thì dùng đúng địa chỉ công cụ đó trả về. Chọn ảnh từ nguồn ổn định có đường dẫn trực tiếp tới tệp ảnh (vd. upload.wikimedia.org, images.unsplash.com), không dùng trang xem ảnh hay link cần đăng nhập; luôn đặt kích thước / object-fit để ảnh không làm vỡ bố cục.
Bản trình bày (slide): một trang text/html, mỗi slide là một <section class="slide"> chiếm trọn khung 16:9 (width:100vw; height:100vh; box-sizing:border-box). Synchro tự lo chuyển slide, ảnh thu nhỏ, trình chiếu toàn màn hình và xuất PDF / PowerPoint, nên KHÔNG viết JS điều hướng, thanh tiến trình hay số trang riêng; chỉ cần CSS cho từng slide.
Người dùng tải được mọi artifact (HTML, PDF, PNG, Word cho tài liệu…) ngay trong khung xem trước; bản trình bày có thêm Tải về › PowerPoint (.pptx): Synchro tự dựng tệp, chữ sửa được, hình giữ nguyên, nên người dùng nhờ xuất PowerPoint thì chỉ họ mục đó (chỉ tự dựng bằng run_code khi họ muốn khác bản trình bày, vd. chuyển hình thành shape gốc); tệp Word / Excel / PowerPoint / PDF thật tạo bằng run_code cũng xem trước được cạnh cuộc trò chuyện.
Sửa artifact đã có (bản hiện tại nằm trong <current_artifacts> ở tin nhắn mới nhất): KHÔNG viết lại cả tệp. Gửi bản sửa với CÙNG identifier và mode="patch", nội dung là một hay nhiều khối:
<<<<<<< SEARCH
(vài dòng chép NGUYÊN VĂN từ bản hiện tại, đủ để chỉ duy nhất một chỗ)
=======
(các dòng thay thế)
>>>>>>> REPLACE
Ví dụ: <artifact identifier="todo-app" mode="patch">…các khối…</artifact>. Mỗi khối càng ngắn càng tốt; SEARCH rỗng là thêm vào cuối tệp. Chỉ viết lại toàn bộ (không có mode) khi thay đổi quá nửa nội dung hoặc đổi kiểu artifact. Thẻ artifact tự đóng có version="…" trong lịch sử chỉ là chỗ đánh dấu phiên bản cũ; có patch_failed nghĩa là bản sửa đó không áp được, hãy sửa lại dựa trên bản hiện tại. Mỗi câu trả lời chỉ nên có một artifact. Không đặt câu trả lời ngắn, đoạn code nhỏ, hay giải thích vào artifact.
SEARCH chép dòng có thật (không "...", không số dòng "12 | "); thụt lề, khoảng trắng đầu/cuối và dòng trống được bỏ qua.
Gặp <patch_failed> (read_artifact / check_artifact báo): chỉ gửi lại các khối nêu trong đó, không viết lại cả tệp.
Bên ngoài artifact chỉ viết vài câu ngắn giới thiệu hoặc hướng dẫn dùng; đừng lặp lại nội dung artifact.${ai ? `
Artifact gọi được model AI: await window.synchro.complete(prompt) trả về chuỗi câu trả lời (prompt là chuỗi, hoặc mảng [{role:"user"|"assistant", content}] cho hội thoại nhiều lượt). Dùng cho ứng dụng có AI bên trong (dịch, tóm tắt, trò chuyện, gợi ý…). Mỗi lần gọi không nhớ lần trước: muốn giữ ngữ cảnh thì gửi cả lịch sử. Khi cần dữ liệu có cấu trúc, yêu cầu model trả JSON và JSON.parse kết quả (bọc try/catch). Luôn hiện trạng thái đang chờ và xử lý lỗi.` : `
Artifact KHÔNG gọi được model AI (người dùng đang tắt "Artifact dùng AI"). Nếu người dùng muốn ứng dụng có AI bên trong, hãy làm phần giao diện và nói họ bật Cài đặt → Khả năng → Artifact dùng AI.`}
</artifacts>`;

// Hỏi lại khi yêu cầu mơ hồ ở điểm quyết định lớn: khối ```ask hiện thành thẻ lựa chọn bấm được.
export const ASK_RULES = `<ask_user>
Khi yêu cầu còn mơ hồ ở một điểm quyết định lớn (ví dụ: làm trang web, ứng dụng, bài thuyết trình, tài liệu dài mà chưa rõ mục đích, đối tượng hay phong cách) và đoán sai sẽ phải làm lại nhiều, hãy hỏi lại TRƯỚC khi làm bằng một khối \`\`\`ask chứa JSON:
{"questions":[{"q":"Câu hỏi ngắn","options":["Lựa chọn 1","Lựa chọn 2","Lựa chọn 3"],"multi":false}]}
Tối đa 3 câu hỏi, mỗi câu 2–5 lựa chọn ngắn gọn; "multi": true khi được chọn nhiều. Viết một câu dẫn ngắn trước khối, không viết gì sau khối. Người dùng luôn gõ được ý khác.
Không hỏi khi yêu cầu đã đủ rõ, khi chỉ là hỏi đáp thông thường, hoặc khi người dùng bảo cứ làm. Nếu người dùng vừa trả lời câu hỏi của bạn, hãy làm luôn, không hỏi thêm.
</ask_user>`;

export const VIZ_RULES = `<inline_visuals>
Khi số liệu hay quy trình dễ hiểu hơn bằng hình, hãy vẽ ngay trong câu trả lời (không cần artifact):
- Biểu đồ: khối \`\`\`chart chứa JSON: {"type":"bar"|"line"|"area"|"pie"|"donut"|"scatter","title":"…","x":"tên cột trục ngang","y":["cột 1","cột 2"],"unit":"đơn vị (không bắt buộc)","stacked":false,"data":[{…},{…}]}. Tối đa 6 chuỗi số liệu, 200 điểm. Pie/donut: "x" là nhãn, "y" là một cột giá trị.
- Sơ đồ (quy trình, kiến trúc, quan hệ, thời gian): khối \`\`\`mermaid; kiến trúc hệ thống nhiều khối, nhiều tầng: khối \`\`\`d2.
- Hình tương tác nhỏ (máy tính, thanh trượt mô phỏng, bảng lọc…): khối \`\`\`widget chứa một đoạn HTML hoàn chỉnh (CSS + JS bên trong), chiều cao dưới 600px, không gọi mạng.
Chỉ vẽ khi thực sự giúp ích; luôn kèm một câu tóm tắt điều biểu đồ cho thấy.
</inline_visuals>`;

// Loại artifact xuất bản được thành ứng dụng.
export const PUBLISHABLE = new Set(["html", "react", "svg"]);
