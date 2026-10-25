// Artifact: nội dung độc lập model viết trong câu trả lời (trang web, ứng dụng React, SVG, tài liệu, code, sơ đồ),
// hiện trong khung riêng cạnh cuộc trò chuyện. Model viết theo dạng
//   <artifact identifier="todo-app" type="application/vnd.react" title="Danh sách việc cần làm"> ... </artifact>
// Cùng identifier trong một cuộc trò chuyện là các phiên bản của cùng một artifact.
// Tệp này dùng chung cho trình duyệt (tách artifact khỏi câu trả lời) và máy chủ (hướng dẫn cho model).

export const ART_TYPES = ["html", "react", "svg", "markdown", "code", "mermaid", "vbhc"] as const;
export type ArtType = (typeof ART_TYPES)[number];
// patch: câu trả lời chỉ gửi các khối SEARCH/REPLACE để sửa bản trước (vfs.ts áp vào thành bản đầy đủ); patchText giữ nguyên khối sửa.
export type ArtBlock = { ident: string; title: string; type: ArtType; lang: string | null; content: string; complete: boolean; patch?: boolean; patchText?: string };
export type Seg = { kind: "text"; text: string } | { kind: "art"; art: ArtBlock };

const MIME: Record<string, ArtType> = {
  "text/html": "html", html: "html", "application/vnd.react": "react", "application/vnd.ant.react": "react", react: "react", jsx: "react", tsx: "react",
  "image/svg+xml": "svg", svg: "svg", "text/markdown": "markdown", markdown: "markdown", md: "markdown", "application/vnd.code": "code", "application/vnd.ant.code": "code", code: "code",
  "application/vnd.mermaid": "mermaid", "application/vnd.ant.mermaid": "mermaid", mermaid: "mermaid",
  "application/vnd.synchro.vbhc+json": "vbhc", vbhc: "vbhc",
};
export const ART_LABEL: Record<ArtType, string> = { html: "Trang web", react: "Ứng dụng", svg: "Hình SVG", markdown: "Tài liệu", code: "Mã nguồn", mermaid: "Sơ đồ", vbhc: "Văn bản hành chính" };
export const ART_EXT: Record<ArtType, string> = { html: "html", react: "jsx", svg: "svg", markdown: "md", code: "txt", mermaid: "mmd", vbhc: "json" };
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
    out.push({ kind: "art", art: { ident, title: (attr(tag, "title") ?? (patch ? "" : ident)).trim().slice(0, 200) || (patch ? "" : ident), type, lang: attr(tag, "language"), content: unfence(body), complete: close !== -1, ...(patch ? { patch } : {}) } });
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
KIỂU: text/html (một trang HTML hoàn chỉnh, CSS và JS viết ngay trong trang) · application/vnd.react (một component React, export default, dùng hook bình thường) · image/svg+xml · text/markdown · application/vnd.code (thêm language="python"…) · application/vnd.mermaid · application/vnd.synchro.vbhc+json (văn bản hành chính Việt Nam).
Văn bản hành chính (công văn, quyết định, tờ trình, thông báo, báo cáo, kế hoạch, giấy mời, biên bản, chỉ thị, hướng dẫn của cơ quan, tổ chức Việt Nam): dùng KIỂU application/vnd.synchro.vbhc+json, nội dung là MỘT đối tượng JSON; Synchro tự dàn trang đúng thể thức Nghị định 30/2020/NĐ-CP (khổ A4, lề, Times New Roman, quốc hiệu, tiêu ngữ, đường kẻ, chữ ký, nơi nhận) và xuất Word, PDF. Trường: loai ("cong-van" | "quyet-dinh" | "to-trinh" | "thong-bao" | "bao-cao" | "ke-hoach" | "giay-moi" | "bien-ban" | "chi-thi" | "huong-dan"), coQuanChuQuan (không bắt buộc), coQuan, so (để trống nếu chưa có số), kyHieu (ví dụ "QĐ-UBND"; công văn: "UBND-VP"), diaDanh, ngay ("YYYY-MM-DD", trống nếu chưa ký), trichYeu (công văn: phần sau "V/v"), thamQuyen (chỉ quyết định, ví dụ "CHỦ TỊCH ỦY BAN NHÂN DÂN TỈNH BẮC NINH"), canCu (chỉ quyết định: mảng các dòng "Căn cứ …;" và dòng "Theo đề nghị của …."), kinhGui (mảng; công văn, tờ trình, giấy mời), noiDung (mảng đoạn văn; "# Tiêu đề" cho đề mục như "# I. MỤC ĐÍCH, YÊU CẦU"; quyết định viết "Điều 1. …", "Điều 2. …"; **đậm** khi cần), quyenHan ("TM. ỦY BAN NHÂN DÂN", "KT. GIÁM ĐỐC"…, không có thì bỏ), chucVu, nguoiKy, noiNhan (mảng, dòng cuối "Lưu: VT, …."). Không tự viết quốc hiệu, tiêu ngữ, số, ngày tháng vào noiDung. Văn phong hành chính: ngắn gọn, chính xác, đúng thẩm quyền; tên cơ quan, chức danh viết đúng; không bịa số hiệu văn bản pháp luật, nếu không chắc thì để người dùng điền.
React: có sẵn react, recharts, lucide-react (import bình thường), và Tailwind (dùng className). Không có thư viện nào khác. Không dùng localStorage/sessionStorage. Ảnh chỉ dùng data: URI hoặc SVG.
Lưu dữ liệu (ghi chú, danh sách việc, nhật ký, chi tiêu, theo dõi thói quen…): dùng window.storage, mọi hàm trả Promise: await window.storage.get(key) → {key, value} hoặc null; await window.storage.set(key, value) (value là chuỗi, dữ liệu có cấu trúc thì JSON.stringify); await window.storage.delete(key); await window.storage.list(prefix) → {keys}. Mỗi giá trị tối đa 100 KB. Luôn bọc try/catch, hiện trạng thái đang lưu, và nạp dữ liệu khi mở. Người dùng xuất bản artifact thành ứng dụng có địa chỉ riêng bằng nút tên lửa trên khung xem trước.
HTML: có thể nạp thư viện từ cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com. Artifact không gọi được mạng (fetch/XHR bị chặn).
Bản trình bày (slide): một trang text/html, mỗi slide là một <section class="slide"> chiếm trọn khung 16:9 (width:100vw; height:100vh; box-sizing:border-box). Synchro tự lo chuyển slide, ảnh thu nhỏ, trình chiếu toàn màn hình và xuất PDF / PowerPoint, nên KHÔNG viết JS điều hướng, thanh tiến trình hay số trang riêng; chỉ cần CSS cho từng slide.
Người dùng tải được mọi artifact (HTML, PDF, PNG, Word cho tài liệu…) ngay trong khung xem trước; tệp Word / Excel / PowerPoint / PDF thật tạo bằng run_code cũng xem trước được cạnh cuộc trò chuyện.
Sửa artifact đã có (bản hiện tại nằm trong <current_artifacts> ở tin nhắn mới nhất): KHÔNG viết lại cả tệp. Gửi bản sửa với CÙNG identifier và mode="patch", nội dung là một hay nhiều khối:
<<<<<<< SEARCH
(vài dòng chép NGUYÊN VĂN từ bản hiện tại, đủ để chỉ duy nhất một chỗ)
=======
(các dòng thay thế)
>>>>>>> REPLACE
Ví dụ: <artifact identifier="todo-app" mode="patch">…các khối…</artifact>. Mỗi khối càng ngắn càng tốt; SEARCH rỗng là thêm vào cuối tệp. Chỉ viết lại toàn bộ (không có mode) khi thay đổi quá nửa nội dung hoặc đổi kiểu artifact. Thẻ artifact tự đóng có version="…" trong lịch sử chỉ là chỗ đánh dấu phiên bản cũ; có patch_failed nghĩa là bản sửa đó không áp được, hãy sửa lại dựa trên bản hiện tại. Mỗi câu trả lời chỉ nên có một artifact. Không đặt câu trả lời ngắn, đoạn code nhỏ, hay giải thích vào artifact.
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
- Sơ đồ (quy trình, kiến trúc, quan hệ, thời gian): khối \`\`\`mermaid.
- Hình tương tác nhỏ (máy tính, thanh trượt mô phỏng, bảng lọc…): khối \`\`\`widget chứa một đoạn HTML hoàn chỉnh (CSS + JS bên trong), chiều cao dưới 600px, không gọi mạng.
Chỉ vẽ khi thực sự giúp ích; luôn kèm một câu tóm tắt điều biểu đồ cho thấy.
</inline_visuals>`;
