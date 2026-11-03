// Định tuyến skill: chấm điểm mọi skill đã cài (cả skill nằm trong thư viện studio / plugin) theo yêu cầu mới nhất,
// để gợi ý cho model những skill nên đọc. Model vẫn toàn quyền quyết định; đây chỉ là gợi ý đưa vào prompt.
// Người dùng thường viết tiếng Việt còn mô tả skill phần lớn bằng tiếng Anh, nên có bảng khái niệm nối hai bên.
import type { Skill } from "./skillstore";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

// [cụm từ người dùng hay viết (đã bỏ dấu, Việt + Anh)] → [từ khóa thường gặp trong mô tả skill].
// Bỏ dấu làm nhiều từ ngắn trùng nhau (thư / thủ, chậm / chăm, màu / mẫu, lỗi / lời), nên chỉ dùng cụm từ đủ dài để không nhầm.
const CONCEPTS: [string[], string[]][] = [
  [["thiet ke", "giao dien", "ui", "ux", "trang web", "website", "web", "landing", "man hinh", "layout", "bo cuc", "dashboard", "mockup", "prototype", "frontend", "front end", "design"],
    ["design", "frontend", "interface", "interfaces", "ui", "ux", "web", "page", "pages", "layout", "visual", "landing", "components"]],
  [["dep", "tham my", "sang trong", "hien dai", "phong cach", "tinh te", "chuyen nghiep", "style", "aesthetic"],
    ["aesthetic", "aesthetics", "style", "taste", "visual", "polish", "distinctive", "premium"]],
  [["bang mau", "mau sac", "phoi mau", "to mau", "mau chu dao", "font", "phong chu", "typography", "theme", "chu de"],
    ["color", "colors", "palette", "typography", "font", "fonts", "theme", "themes"]],
  [["logo", "thuong hieu", "nhan dien", "brand", "bieu tuong", "icon", "nhan dien thuong hieu"],
    ["brand", "branding", "logo", "identity", "icon", "icons", "svg"]],
  [["poster", "banner", "an pham", "minh hoa", "hinh ve", "tranh", "anh bia", "do hoa", "graphic", "artwork", "buc tranh", "ve tranh"],
    ["poster", "banner", "art", "illustration", "canvas", "visual", "graphic", "graphics", "image"]],
  [["animation", "chuyen dong", "hieu ung", "muot ma", "cho muot", "transition", "motion", "hover", "chuyen canh"],
    ["animation", "animations", "motion", "transition", "transitions", "easing", "interaction", "interactions", "animate", "spring"]],
  [["slide", "trinh bay", "thuyet trinh", "pitch", "deck", "bai giang", "presentation", "trinh chieu", "powerpoint"],
    ["slides", "slide", "presentation", "presentations", "deck", "decks", "pitch"]],
  [["tai lieu", "van ban", "de xuat", "bao cao", "ke hoach", "viet thu", "buc thu", "email", "thong bao", "quy trinh", "bien ban", "hop dong", "noi bo", "document", "report"],
    ["document", "documents", "writing", "report", "reports", "proposal", "communication", "communications", "internal", "docs", "memo", "newsletter", "update", "updates", "announcement"]],
  [["viet", "van phong", "giong van", "bien tap", "sua van", "noi dung", "copy"],
    ["writing", "copy", "tone", "voice", "guidelines", "content", "prose"]],
  [["react", "next", "nextjs", "component", "hook", "jsx", "tsx"],
    ["react", "next", "nextjs", "component", "components", "hooks", "rendering"]],
  [["toi uu", "hieu nang", "nhanh hon", "chay cham", "bi cham", "load cham", "performance", "bundle", "tai trang"],
    ["performance", "optimization", "optimize", "bundle", "speed", "fast", "rendering"]],
  [["kiem thu", "test", "kiem tra giao dien", "bug", "sua loi", "bi loi", "e2e", "playwright", "tu dong hoa trinh duyet"],
    ["test", "testing", "tests", "playwright", "browser", "qa", "verify", "debug"]],
  [["deploy", "trien khai", "vercel", "host", "len mang", "publish", "xuat ban"],
    ["deploy", "deployment", "vercel", "hosting", "production"]],
  [["app store", "google play", "anh chup", "screenshot", "ung dung di dong", "mobile", "ios", "android", "dien thoai"],
    ["app", "store", "screenshots", "screenshot", "mobile", "ios", "android", "marketing"]],
  [["danh gia", "nhan xet", "review", "gop y", "phan bien", "audit", "kha dung", "trai nghiem"],
    ["review", "audit", "feedback", "critique", "guidelines", "accessibility", "usability", "heuristics", "experience"]],
  [["tro nang", "accessibility", "a11y", "de doc", "tuong phan"],
    ["accessibility", "contrast", "a11y", "readable"]],
  [["design system", "he thong thiet ke", "token", "thu vien thanh phan"],
    ["system", "tokens", "components", "design"]],
  [["mcp", "server", "tich hop", "connector", "api"],
    ["mcp", "server", "integration", "api", "tools"]],
  [["bang tinh", "excel", "du lieu", "bieu do", "chart", "phan tich", "so lieu"],
    ["data", "chart", "charts", "spreadsheet", "analysis", "visualization"]],
];
// Từ quá chung trong mô tả skill: không dùng để chấm điểm.
const STOP = new Set("the and for with use used using when this that user users skill skills create build make your you are any from into will can also all its it of to in on or an as by be is at not more than other".split(" "));

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const hasPhrase = (text: string, p: string) => !!p && text.includes(p) && new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);

// weight: hệ số điểm (skill của danh mục Claude 0,6: thư viện người dùng tự chọn được ưu tiên khi cùng hợp).
export type Candidate = { skill: Skill; lib?: { key: string; label: string }; weight?: number };
export type Hit = Candidate & { score: number };

// Từ khóa mở rộng của yêu cầu: chính các từ người dùng viết, cộng từ khóa tiếng Anh của mọi khái niệm khớp.
export function expand(q: string): { terms: Set<string>; concepts: number } {
  const t = fold(q);
  const terms = new Set(tokens(q));
  let concepts = 0;
  for (const [trig, kw] of CONCEPTS) if (trig.some((p) => hasPhrase(t, p))) { concepts++; for (const k of kw) terms.add(k); }
  return { terms, concepts };
}

// Chấm điểm theo IDF: từ hiếm trong cả kho (như "animation") nặng hơn từ phổ biến (như "design"); khớp tên skill nhân ba.
// Từ của tên và mô tả mỗi skill được tách một lần rồi giữ theo chính đối tượng skill (thư viện chung có ~18.000 skill, nằm sẵn trong bộ đệm
// của plugins.ts); IDF chỉ tính cho các từ của câu hỏi, không cho mọi từ của cả kho.
type Doc = { key: string; name: Set<string>; body: Set<string>; folded: string };
const docCache = new WeakMap<Skill, Doc>();
function docOf(k: Skill): Doc {
  const key = `${k.name}\n${k.description}`;
  let d = docCache.get(k);
  if (!d || d.key !== key) docCache.set(k, (d = { key, name: new Set(tokens(k.name.replace(/[-:]/g, " "))), body: new Set(tokens(k.description)), folded: fold(k.name) }));
  return d;
}
export function rank(q: string, cands: Candidate[], limit = 10): Hit[] {
  if (!q.trim() || !cands.length) return [];
  const { terms } = expand(q);
  const t = fold(q);
  const docs = cands.map((c) => ({ c, ...docOf(c.skill) }));
  const df = new Map<string, number>();
  for (const w of terms) { let n = 0; for (const d of docs) if (d.name.has(w) || d.body.has(w)) n++; df.set(w, n); }
  const idf = (w: string) => Math.log(1 + docs.length / (df.get(w) || docs.length));
  return docs.map(({ c, name, body, folded }) => {
    let score = hasPhrase(t, folded) ? 6 : 0;
    for (const w of terms) score += (name.has(w) ? 3 : body.has(w) ? 1 : 0) * idf(w);
    return { ...c, score: score * (c.weight ?? 1) };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Gợi ý cho lượt chat: chỉ khi yêu cầu có dấu hiệu là một việc cần chuyên môn (khớp khái niệm hoặc gọi đúng tên skill),
// và chỉ giữ những skill có điểm đủ gần skill tốt nhất. Câu chào hỏi, câu hỏi ngắn thì không gợi ý gì.
export function suggest(q: string, cands: Candidate[], max = 4): Hit[] {
  const { concepts } = expand(q);
  const hits = rank(q, cands, 12);
  if (!hits.length) return [];
  const named = hits.some((h) => hasPhrase(fold(q), fold(h.skill.name)));
  if (!concepts && !named) return [];
  const top = hits[0].score;
  if (top < 2) return [];
  return hits.filter((h) => h.score >= top * 0.45).slice(0, max);
}
