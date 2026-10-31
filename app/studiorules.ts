// Nhận diện skill thuộc mục nào trong ba mục tạo mới ở trang Artifacts: Tài liệu (docs), Trình bày (slides), Thiết kế (design).
// Phần thuần (không DB, không mạng) dùng chung cho máy chủ (app/skillstudio.ts) và kiểm thử:
// - ruleStudios: bộ luật từ khóa Việt + Anh trên tên, mô tả và phần đầu nội dung skill — luôn chạy được, không cần model.
// - STUDIO_SYSTEM / studioAsk / parseStudios: lời nhờ model xếp mục và đọc câu trả lời (model của người dùng, khi có).
export type StudioKind = "docs" | "slides" | "design";
export const STUDIO_KINDS: StudioKind[] = ["docs", "slides", "design"];

const fold = (s: string) => ` ${s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/[^a-z0-9.+#]+/g, " ").replace(/\s+/g, " ").trim()} `;

// [cụm từ, điểm]. Cụm từ đã bỏ dấu, viết thường; khớp trọn từ. Điểm cao: gần như chắc chắn thuộc mục; thấp: chỉ là gợi ý.
type Terms = [string, number][];
const DOCS: Terms = [
  ["docx", 4], ["word document", 4], ["word documents", 4], ["microsoft word", 4], ["google docs", 4], ["documentation", 3], ["technical spec", 3], ["tech spec", 3], ["technical specs", 3],
  ["proposal", 3], ["proposals", 3], ["report", 2], ["reports", 3], ["reporting", 2], ["memo", 3], ["memos", 3], ["newsletter", 3], ["newsletters", 3], ["cover letter", 4], ["resume", 3], ["essay", 3], ["essays", 3],
  ["whitepaper", 3], ["white paper", 3], ["meeting notes", 3], ["internal comms", 4], ["internal communications", 4], ["press release", 3], ["contract", 2], ["contracts", 2], ["policy document", 3],
  ["handbook", 3], ["user guide", 2], ["decision doc", 3], ["design doc", 3], ["rfc", 2], ["prd", 3], ["sop", 2], ["co authoring", 3], ["coauthoring", 3], ["co author", 2],
  ["document", 2], ["documents", 2], ["docs", 2], ["writing", 2], ["prose", 3], ["copywriting", 1], ["copyediting", 3], ["copy editing", 3], ["proofread", 3], ["proofreading", 3],
  ["style guide", 2], ["tone of voice", 2], ["brand voice", 3], ["messaging", 1], ["reportings", 2], ["article", 2], ["articles", 2], ["blog post", 2], ["letter", 2], ["letters", 2], ["pdf", 2], ["pdf files", 2], ["markdown", 1], ["faq", 1], ["status update", 2], ["announcement", 2], ["announcements", 2],
  ["tai lieu", 3], ["van ban", 3], ["bao cao", 3], ["de xuat", 3], ["hop dong", 3], ["bien ban", 3], ["cong van", 3], ["thu moi", 3], ["so tay", 2], ["soan thao", 3], ["bai viet", 2], ["don tu", 3], ["ke hoach", 1],
];
const SLIDES: Terms = [
  ["slide", 4], ["slides", 4], ["slideshow", 4], ["slide deck", 4], ["deck", 3], ["decks", 3], ["pitch deck", 4], ["presentation", 4], ["presentations", 4], ["pptx", 4], ["powerpoint", 4], ["keynote", 3],
  ["google slides", 4], ["reveal.js", 4], ["revealjs", 4], ["speaker notes", 4], ["pitch", 1], ["talk", 1],
  ["trinh chieu", 4], ["bai thuyet trinh", 4], ["thuyet trinh", 4], ["trang chieu", 4], ["trinh bay", 2],
];
const DESIGN: Terms = [
  ["user interface", 3], ["user interfaces", 3], ["interface design", 4], ["visual design", 4], ["graphic design", 4], ["web design", 4], ["ui design", 4], ["ux design", 4], ["frontend design", 4], ["ui ux", 3],
  ["typography", 3], ["color palette", 3], ["color palettes", 3], ["palette", 2], ["palettes", 2], ["brand identity", 4], ["visual identity", 4], ["logo", 3], ["logos", 3], ["poster", 3], ["posters", 3],
  ["banner", 3], ["banners", 3], ["illustration", 3], ["illustrations", 3], ["mockup", 3], ["mockups", 3], ["mock up", 3], ["wireframe", 3], ["wireframes", 3], ["figma", 3], ["prototype", 2], ["prototypes", 2],
  ["design system", 4], ["design systems", 4], ["design tokens", 4], ["landing page", 3], ["landing pages", 3], ["art direction", 4], ["aesthetic", 3], ["aesthetics", 3], ["animation", 3], ["animations", 3], ["animate", 2],
  ["motion", 2], ["micro interactions", 3], ["spring", 1], ["easing", 2], ["css", 2], ["tailwind", 1], ["shadcn", 1], ["icon", 0.5], ["icons", 0.5], ["generative art", 4], ["algorithmic art", 4], ["visual art", 4],
  ["gif", 2], ["gifs", 2], ["screenshot pages", 3], ["marketing screenshots", 3], ["ui", 2], ["ux", 2], ["interface", 1], ["interfaces", 1], ["layout", 2], ["layouts", 2], ["visual", 2], ["styling", 2],
  ["theme", 2], ["themes", 2], ["brand", 2], ["branding", 2], ["beautiful", 1], ["polish", 1], ["look and feel", 3], ["feel native", 2], ["hover states", 2], ["frontend", 1], ["front end", 1], ["design", 2], ["designing", 2], ["designs", 2],
  ["thiet ke", 3], ["giao dien", 3], ["do hoa", 4], ["bo cuc", 2], ["mau sac", 2], ["phong chu", 2], ["minh hoa", 3], ["nhan dien thuong hieu", 4], ["hieu ung", 2], ["chuyen dong", 2],
];
// Ngữ cảnh làm sai nghĩa: "API design" là lập trình, "presentation layer" là kiến trúc phần mềm…
const NOT: [StudioKind, string, number][] = [
  ["design", "api design", 4], ["design", "database design", 4], ["design", "schema design", 4], ["design", "system design", 4], ["design", "software design", 3], ["design", "architecture", 2],
  ["design", "well designed tools", 3], ["design", "test", 1], ["design", "testing", 2], ["design", "playwright", 3], ["design", "deploy", 2], ["design", "deployment", 2], ["design", "best practices", 2], ["design", "performant", 2], ["design", "library", 1],
  ["slides", "presentation layer", 6], ["docs", "api docs", 2], ["docs", "one letter", 3], ["docs", "reference for the", 2], ["docs", "sdk", 2],
];
const TERMS: Record<StudioKind, Terms> = { docs: DOCS, slides: SLIDES, design: DESIGN };

const has = (hay: string, t: string) => hay.includes(` ${t} `);
// Cụm "such as …" / "e.g. …" / "ví dụ …" chỉ là danh sách ví dụ (vd. "bản nháp như kế hoạch, đề xuất"): từ khóa chỉ nằm trong đó tính nửa điểm.
const EXAMPLES = / (such as|e g|for example|including|like|vi du|chang han|nhu la) ([a-z0-9 .+#]{0,90})/g;
const split = (hay: string) => { const ex = [...hay.matchAll(EXAMPLES)].map((m) => ` ${m[2]} `).join(" "); return { main: ` ${hay.replace(EXAMPLES, " ")} `, ex: ` ${ex} ` }; };
/** Điểm của một mục trên một đoạn chữ đã bỏ dấu: mỗi cụm từ tính một lần. */
function score(hay: string, k: StudioKind) {
  let s = 0;
  const hit: string[] = [];
  const { main, ex } = split(hay);
  for (const [t, w] of TERMS[k]) if (has(main, t)) { s += w; hit.push(t); } else if (has(ex, t)) { s += w / 2; hit.push(t); }
  for (const [kk, t, w] of NOT) if (kk === k && has(hay, t)) s -= w;
  return { s, hit };
}

export type StudioGuess = { studios: StudioKind[]; scores: Record<StudioKind, number>; why: string };
/** Xếp mục bằng từ khóa: tên ×3, mô tả ×2, phần đầu nội dung ×0,5 (tối đa 6 điểm). Lấy mục đạt 8 điểm, trong đó tên + mô tả góp ít nhất
 *  5 điểm (nội dung chỉ bổ sung, không tự quyết), và không quá lép so với mục mạnh nhất (≥ 25%). */
export function ruleStudios(name: string, description: string, body = ""): StudioGuess {
  const n = fold(name.replace(/[-_]+/g, " ")), d = fold(description), b = fold(body.slice(0, 3000));
  const scores = {} as Record<StudioKind, number>, head = {} as Record<StudioKind, number>;
  const hits: Record<StudioKind, string[]> = { docs: [], slides: [], design: [] };
  for (const k of STUDIO_KINDS) {
    const a = score(n, k), c = score(d, k), e = score(b, k);
    head[k] = a.s * 3 + c.s * 2;
    scores[k] = Math.round((head[k] + Math.min(Math.max(e.s, 0), 12) * 0.5) * 10) / 10;
    hits[k] = [...new Set([...a.hit, ...c.hit, ...e.hit])].slice(0, 4);
  }
  const top = Math.max(...STUDIO_KINDS.map((k) => scores[k]));
  const studios = STUDIO_KINDS.filter((k) => scores[k] >= 8 && head[k] >= 5 && scores[k] >= 0.25 * top);
  const why = studios.length ? studios.map((k) => `${k}: ${hits[k].join(", ")}`).join("; ") : "không khớp từ khóa của Tài liệu / Trình bày / Thiết kế";
  return { studios, scores, why };
}

// ---------------------------------------------------------------- nhờ model xếp mục
export const STUDIO_ASK = "Skill cần phân loại:";
export const STUDIO_SYSTEM = `Bạn xếp một skill (gói hướng dẫn cho trợ lý AI) vào các mục tạo mới của trang Artifacts trong Synchro. Chỉ có ba mục:
- docs (Tài liệu): văn bản để đọc, gửi, in hoặc ký — báo cáo, đề xuất, hợp đồng, thư, biên bản, tài liệu kỹ thuật, bài viết; Word, PDF, Markdown; viết và biên tập văn bản.
- slides (Trình bày): bộ trang chiếu, bài thuyết trình, pitch deck, PowerPoint / Google Slides / HTML slides.
- design (Thiết kế): giao diện và màn hình, đồ họa, poster, banner, logo, thương hiệu, minh họa, bảng màu, phông chữ, animation / chuyển động, hệ thống thiết kế, ảnh marketing.
Một skill có thể thuộc 0, 1, 2 hoặc cả 3 mục. Chỉ chọn mục khi skill thật sự giúp tạo ra hoặc làm đẹp loại sản phẩm đó. Skill về lập trình thuần, kiểm thử, triển khai, dữ liệu, API, tự động hóa, công cụ nội bộ… không thuộc mục nào dù có nhắc qua các từ trên.
Trả lời đúng một dòng JSON, không thêm gì khác: {"docs":true|false,"slides":true|false,"design":true|false,"why":"một câu ngắn bằng tiếng Việt"}`;
export const studioAsk = (name: string, description: string, body: string) => `${STUDIO_ASK}\nTên: ${name}\nMô tả: ${description}\n\nNội dung (phần đầu):\n${body.slice(0, 4000)}`;
/** Đọc câu trả lời của model; sai định dạng thì null (giữ kết quả của bộ luật). */
export function parseStudios(raw: string): { studios: StudioKind[]; why: string } | null {
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    if (!STUDIO_KINDS.every((k) => typeof j[k] === "boolean")) return null;
    return { studios: STUDIO_KINDS.filter((k) => j[k] === true), why: typeof j.why === "string" ? j.why.slice(0, 200) : "" };
  } catch { return null; }
}
