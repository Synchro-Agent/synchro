// Định tuyến skill: chấm điểm mọi skill đã cài (cả skill nằm trong thư viện studio / plugin) theo yêu cầu mới nhất,
// để gợi ý cho model những skill nên đọc. Model vẫn toàn quyền quyết định; đây chỉ là gợi ý đưa vào prompt.
// Người dùng thường viết tiếng Việt còn mô tả skill phần lớn bằng tiếng Anh, nên có bảng khái niệm nối hai bên.
import type { Skill } from "./skillstore";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

// [cụm từ người dùng hay viết (đã bỏ dấu, Việt + Anh)] → [từ khóa thường gặp trong mô tả skill].
// Bỏ dấu làm nhiều từ ngắn trùng nhau (thư / thủ, chậm / chăm, màu / mẫu, lỗi / lời), nên chỉ dùng cụm từ đủ dài để không nhầm.
// Dấu generic (phần tử thứ ba): khái niệm về hình thức ("kế hoạch", "báo cáo", "viết"), không phải lĩnh vực. Câu đã nói rõ lĩnh vực ("kế hoạch marketing")
// thì từ khóa của nó chỉ tính nhẹ, không để "Lập kế hoạch marketing" toàn ra skill làm tài liệu.
const CONCEPTS: [string[], string[], true?][] = [
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
    ["document", "documents", "writing", "report", "reports", "proposal", "communication", "communications", "internal", "docs", "memo", "newsletter", "update", "updates", "announcement"], true],
  [["viet", "van phong", "giong van", "bien tap", "sua van", "noi dung", "copy"],
    ["writing", "copy", "tone", "voice", "guidelines", "content", "prose"], true],
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
  // Các lĩnh vực của danh mục (PLUGIN_CATS): người không làm kỹ thuật hỏi bằng tiếng Việt vẫn tới đúng mục.
  [["thue", "ke toan", "kiem toan", "hoa don", "bao cao tai chinh", "quyet toan", "tax", "accounting", "bookkeeping", "invoice"],
    ["tax", "taxes", "accounting", "bookkeeping", "invoice", "invoices", "audit", "finance", "financial"]],
  [["tai chinh", "ngan sach", "dong tien", "dau tu", "co phieu", "chung khoan", "dinh gia", "finance", "budget", "investment", "stock"],
    ["finance", "financial", "budget", "budgeting", "cash", "investment", "investing", "stocks", "valuation", "portfolio"]],
  [["chi tieu ca nhan", "tiet kiem", "quan ly tien", "tra no", "personal finance"],
    ["personal", "savings", "budget", "budgeting", "debt", "expenses"]],
  [["marketing", "tiep thi", "quang cao", "chay ads", "seo", "fanpage", "mang xa hoi", "social media", "content marketing"],
    ["marketing", "campaign", "campaigns", "seo", "ads", "advertising", "social", "content", "growth"]],
  [["thi truong", "nghien cuu thi truong", "doi thu", "doi thu canh tranh", "market research", "competitor"],
    ["market", "research", "competitor", "competitive", "analysis", "survey"]],
  [["ban hang", "khach hang tiem nang", "cham soc khach hang", "chot don", "bao gia", "crm", "sales", "lead", "leads"],
    ["sales", "leads", "lead", "crm", "prospecting", "outreach", "pipeline", "customer"]],
  [["ho tro khach hang", "tong dai", "khieu nai", "customer support", "helpdesk"],
    ["support", "customer", "helpdesk", "tickets", "ticket"]],
  [["tuyen dung", "phong van", "nhan su", "cham cong", "luong thuong", "onboarding", "hr", "recruiting", "hiring"],
    ["hr", "recruiting", "hiring", "interview", "candidate", "candidates", "onboarding", "employee", "talent"]],
  [["xin viec", "ho so xin viec", "cv", "resume", "nghe nghiep", "thang tien", "career"],
    ["career", "resume", "cv", "job", "jobs", "interview", "cover"]],
  [["phap ly", "hop dong", "dieu khoan", "luat", "kien tung", "tuan thu", "legal", "contract", "compliance", "lawsuit"],
    ["legal", "law", "contract", "contracts", "compliance", "policy", "terms", "regulation"]],
  [["video", "clip", "dung phim", "kich ban video", "phu de", "youtube", "tiktok", "reels"],
    ["video", "videos", "editing", "subtitle", "subtitles", "youtube", "tiktok", "ffmpeg", "script"]],
  [["am nhac", "bai hat", "nhac", "soan nhac", "hop am", "music", "song"],
    ["music", "song", "songs", "audio", "chord", "chords", "composition"]],
  [["giong doc", "podcast", "thu am", "voiceover", "audio"],
    ["audio", "voice", "podcast", "speech", "narration", "tts"]],
  [["du lich", "lich trinh", "dat phong", "khach san", "chuyen di", "ve may bay", "travel", "itinerary", "hotel"],
    ["travel", "trip", "itinerary", "hotel", "hotels", "flight", "flights", "hospitality", "tourism"]],
  [["tap gym", "tap luyen", "the duc", "giam can", "suc khoe", "dinh duong", "benh", "fitness", "workout", "health", "nutrition"],
    ["fitness", "health", "workout", "exercise", "nutrition", "wellness", "medical", "diet"]],
  [["nau an", "cong thuc nau", "mon an", "thuc don", "nha hang", "recipe", "cooking", "food", "meal"],
    ["food", "recipe", "recipes", "cooking", "meal", "meals", "restaurant", "menu", "nutrition"]],
  [["hoc tap", "on thi", "giao an", "bai giang", "giao vien", "hoc sinh", "sinh vien", "day hoc", "education", "learning", "study", "tutor", "flashcard"],
    ["education", "learning", "study", "students", "teacher", "teachers", "tutor", "tutoring", "lesson", "quiz", "flashcards", "course"]],
  [["sach", "tom tat sach", "viet sach", "tieu thuyet", "truyen", "book", "novel"],
    ["book", "books", "novel", "fiction", "story", "reading", "author"]],
  [["su kien", "hoi nghi", "to chuc tiec", "hoi thao", "event", "conference", "wedding", "dam cuoi"],
    ["event", "events", "conference", "planning", "wedding", "calendar", "schedule"]],
  [["gia dinh", "nuoi con", "con cai", "hon nhan", "quan he", "family", "parenting", "relationship"],
    ["family", "parenting", "kids", "children", "relationship", "relationships"]],
  [["nha cua", "noi that", "sua nha", "lam vuon", "bat dong san", "home", "interior", "real estate", "garden"],
    ["home", "interior", "garden", "real", "estate", "property", "living", "house"]],
  [["tho cung", "cho meo", "pet"], ["pet", "pets", "dog", "dogs", "cat", "cats", "animal", "animals"]],
  [["chinh phu", "thu tuc hanh chinh", "cong van", "dich vu cong", "government", "public sector"],
    ["government", "public", "policy", "civic", "citizen", "permit"]],
  [["phi loi nhuan", "tu thien", "gay quy", "nonprofit", "charity", "fundraising"],
    ["nonprofit", "charity", "fundraising", "donor", "donors", "grant", "grants", "volunteer"]],
  [["ton giao", "kinh thanh", "phat giao", "cong giao", "faith", "religion", "prayer"],
    ["faith", "religion", "bible", "prayer", "spiritual", "church"]],
  [["tro choi", "game", "lam game", "unity"], ["game", "games", "gaming", "unity", "godot"]],
  [["cau do", "sudoku", "o chu", "puzzle", "crossword"], ["puzzle", "puzzles", "sudoku", "crossword", "riddle"]],
  [["bao mat", "an toan thong tin", "lo hong", "ma doc", "phan quyen", "security", "vulnerability", "pentest"],
    ["security", "vulnerability", "vulnerabilities", "audit", "threat", "pentest", "auth", "compliance"]],
  [["co so du lieu", "truy van", "sql", "database", "postgres", "mysql", "mongodb"],
    ["database", "databases", "sql", "query", "queries", "postgres", "schema", "migration"]],
  [["tri tue nhan tao", "mo hinh ai", "huan luyen mo hinh", "agent", "chatbot", "prompt", "machine learning", "llm"],
    ["ai", "agent", "agents", "llm", "model", "models", "prompt", "prompts", "machine", "learning", "training"]],
  [["nhat ky loi", "log", "giam sat", "monitoring", "sentry", "observability"],
    ["logs", "logging", "monitoring", "observability", "errors", "sentry", "tracing"]],
  [["pull request", "code review", "review code", "git", "github"],
    ["pr", "pull", "request", "review", "git", "github", "commit"]],
  [["thu vien phu thuoc", "nang cap goi", "dependency", "dependencies", "npm"],
    ["dependencies", "dependency", "packages", "package", "npm", "upgrade"]],
  [["tin nhan", "hop thu", "gui email", "slack", "gmail", "inbox", "messaging"],
    ["email", "emails", "gmail", "slack", "message", "messages", "inbox", "messaging"]],
  [["van hanh", "quy trinh van hanh", "kho hang", "chuoi cung ung", "logistics", "operations", "supply chain"],
    ["operations", "process", "logistics", "supply", "inventory", "workflow"]],
  [["san pham", "lo trinh san pham", "yeu cau san pham", "product manager", "roadmap", "prd", "user story"],
    ["product", "roadmap", "prd", "requirements", "stories", "backlog", "feature"]],
  [["tu dong hoa", "lich chay", "pipeline", "automation", "cron", "workflow"],
    ["automation", "pipeline", "pipelines", "workflow", "jobs", "cron", "schedule"]],
  [["quan ly cong viec", "giao viec", "ticket", "jira", "trello", "task"], ["tasks", "task", "ticket", "tickets", "jira", "project", "management"]],
  [["ghi chu", "so tay", "notion", "obsidian", "notes"], ["notes", "note", "notion", "obsidian", "knowledge", "memory"]],
  [["may chu", "dam may", "server", "aws", "docker", "kubernetes", "cloud"], ["cloud", "server", "servers", "aws", "docker", "kubernetes", "infrastructure", "devops"]],
  [["ban hang online", "shopee", "cua hang online", "san thuong mai", "shopify", "ecommerce", "e-commerce"], ["ecommerce", "retail", "store", "shopify", "products", "shop"]],
  [["mua sam", "so sanh gia", "shopping", "san pham nen mua"], ["shopping", "buy", "price", "prices", "deals", "products"]],
  [["giai tri", "phim anh", "truyen hinh", "entertainment", "movie"], ["entertainment", "movie", "movies", "film", "media", "streaming"]],
  [["the thao", "bong da", "cau long", "sports", "football"], ["sports", "sport", "football", "soccer", "league", "team"]],
  [["nghien cuu", "luan van", "khoa hoc", "bai bao khoa hoc", "research", "academic", "thesis"], ["research", "academic", "paper", "papers", "literature", "citation", "citations", "thesis"]],
];
// Từ quá chung trong mô tả skill: không dùng để chấm điểm.
const STOP = new Set("the and for with use used using when this that user users skill skills create build make your you are any from into will can also all its it of to in on or an as by be is at not more than other".split(" "));

// Âm tiết tiếng Việt sau khi bỏ dấu trùng tên hiếm trong kho ("cà" thành "ca" khớp admisibilidad-ca), mà IDF lại cho từ hiếm điểm cao nhất.
// Từ dưới 3 chữ không dùng để chấm điểm, trừ các viết tắt quen thuộc.
const SHORT_OK = new Set("ui ux qa ai hr cv pr ml db js ts go r c".split(" "));
const VI_STOP = new Set("toi minh ban lam giup cho cua cac nhung mot nay khong duoc voi nao roi nhe hay can muon tao viet dang khi neu vao len sau truoc trong ngoai nhieu rat thi cung nhu".split(" "));
const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => (w.length > 2 || SHORT_OK.has(w)) && !STOP.has(w));
const HAS_VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const hasPhrase = (text: string, p: string) => !!p && text.includes(p) && new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);

// Bỏ dấu làm vài từ ngắn trùng hẳn nghĩa khác: "thuê nhà" thành "thue" (thuế), "danh sách" thành "sach" (sách), "nhắc tôi" thành "nhac" (nhạc), "Việt Nam" thành "viet" (viết).
// Với các từ này: câu có dấu thì so trên chữ còn dấu; câu không dấu nào thì so trên chữ đã bỏ dấu, trừ các cụm chắc chắn là nghĩa khác.
const AMBIGUOUS: Record<string, { vi: string; not?: RegExp }> = {
  thue: { vi: "thuế", not: /\b(?:thue (?:nha|xe|phong|mat bang|can ho|may|nguoi)|cho thue|di thue)\b/ },
  sach: { vi: "sách", not: /\b(?:danh sach|chinh sach|ngan sach)\b/ },
  nhac: { vi: "nhạc", not: /\b(?:nhac (?:toi|minh|em|nho|lai|hen|lich|hop|den)|nhac nho)\b/ },
  viet: { vi: "viết", not: /\b(?:viet nam|tieng viet|nguoi viet)\b/ },
  dep: { vi: "đẹp", not: /\bdep (?:lao|kep|tong)\b/ },
  truyen: { vi: "truyện", not: /\b(?:truyen (?:thong|hinh|tai|du lieu)|tuyen truyen|di truyen|lan truyen)\b/ },
};
const VI_WORD_EDGE = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "iu");
const AMBI_VI = new Map(Object.entries(AMBIGUOUS).map(([k, v]) => [k, VI_WORD_EDGE(v.vi)]));
// "danh sách", "chính sách", "ngân sách" vẫn có đúng chữ "sách": bỏ trước khi so.
const NOT_BOOK = /(?:danh|chính|ngân) sách/giu;
function triggered(q: string, t: string, marked: boolean, p: string): boolean {
  const am = AMBIGUOUS[p];
  if (!am) return hasPhrase(t, p);
  if (marked) return AMBI_VI.get(p)!.test(p === "sach" ? q.replace(NOT_BOOK, " ") : q);
  return hasPhrase(t, p) && !am.not?.test(t);
}

// weight: hệ số điểm (skill của danh mục Claude 0,6: thư viện người dùng tự chọn được ưu tiên khi cùng hợp).
export type Candidate = { skill: Skill; lib?: { key: string; label: string }; weight?: number };
export type Hit = Candidate & { score: number };

// Từ khóa mở rộng của yêu cầu: chính các từ người dùng viết, cộng từ khóa tiếng Anh của mọi khái niệm khớp.
// weak: từ chỉ tính nhẹ: âm tiết tiếng Việt của câu hỏi (mô tả skill phần lớn bằng tiếng Anh, khớp được là do trùng chữ; chỉ có ích khi mô tả cũng
// bằng tiếng Việt) và từ khóa của khái niệm về hình thức khi câu đã nói rõ lĩnh vực. literal: từ người dùng thật sự viết; groups: từ khóa của từng khái niệm.
export function expand(q: string): { terms: Set<string>; weak: Set<string>; concepts: number; literal: Set<string>; groups: string[][] } {
  const t = fold(q);
  const terms = new Set<string>(), weak = new Set<string>(), literal = new Set<string>();
  const vi = HAS_VI.test(q);
  for (const w of q.split(/[^\p{L}\p{N}]+/u)) for (const x of tokens(w)) {
    if (VI_STOP.has(x) && (vi || HAS_VI.test(w))) continue;
    terms.add(x); literal.add(x);
    if (HAS_VI.test(w) || (vi && x.length < 5)) weak.add(x);
  }
  let concepts = 0;
  const hit = CONCEPTS.filter(([trig]) => trig.some((p) => triggered(q, t, vi, p)));
  const special = hit.some(([, , generic]) => !generic);
  const groups: string[][] = [];
  for (const [, kw, generic] of hit) {
    concepts++;
    groups.push(kw);
    for (const k of kw) { if (generic && special && !terms.has(k)) weak.add(k); else weak.delete(k); terms.add(k); }
  }
  return { terms, weak, concepts, literal, groups };
}

// Chấm điểm theo IDF: từ hiếm trong cả kho (như "animation") nặng hơn từ phổ biến (như "design"); khớp tên skill nhân ba.
// Từ của tên và mô tả mỗi skill được tách một lần rồi giữ theo chính đối tượng skill (thư viện chung có ~18.000 skill, nằm sẵn trong bộ đệm
// của plugins.ts); IDF chỉ tính cho các từ của câu hỏi, không cho mọi từ của cả kho.
type Doc = { key: string; name: Set<string>; body: Set<string>; folded: string; vi: boolean };
const docCache = new WeakMap<Skill, Doc>();
function docOf(k: Skill): Doc {
  const key = `${k.name}\n${k.description}`;
  let d = docCache.get(k);
  if (!d || d.key !== key) docCache.set(k, (d = { key, name: new Set(tokens(k.name.replace(/[-:]/g, " "))), body: new Set(tokens(k.description)), folded: fold(k.name), vi: HAS_VI.test(k.description) }));
  return d;
}
// Chỉ mục ngược: từ → các skill có từ đó. Chấm hết 18.000 skill mỗi lượt từng chặn Node gần 200 ms (luồng chữ của mọi người dừng theo). Giờ chỉ chấm skill có từ của câu hỏi.
// Một đối tượng skill vào chỉ mục đúng một lần; bản dựng lại của bộ đệm plugin tạo đối tượng mới nên chỉ mục chứa nhiều bản cũ quá thì dựng lại từ đầu.
const G = globalThis as unknown as { __skillIx?: { post: Map<string, Skill[]>; first: Map<string, Skill[]>; seen: WeakSet<Skill>; n: number } };
const rawWords = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);
const freshIx = () => ({ post: new Map<string, Skill[]>(), first: new Map<string, Skill[]>(), seen: new WeakSet<Skill>(), n: 0 });
const ixOf = () => (G.__skillIx ??= freshIx());
function addToIx(k: Skill) {
  const ix = ixOf();
  if (ix.seen.has(k)) return;
  ix.seen.add(k); ix.n++;
  const d = docOf(k);
  for (const w of new Set([...d.name, ...d.body])) { const l = ix.post.get(w); if (l) l.push(k); else ix.post.set(w, [k]); }
  // Gọi đúng tên skill: mọi từ của tên đều nằm trong câu, nên tra theo từ đầu của tên là đủ.
  const head = rawWords(d.folded)[0];
  if (head) { const l = ix.first.get(head); if (l) l.push(k); else ix.first.set(head, [k]); }
}
/** Dựng sẵn chỉ mục ở nền, từng ít một, để lượt chat đầu tiên sau khi bộ đệm plugin dựng lại không phải chờ. */
export async function warmSkillIndex(skills: Skill[]) {
  for (let i = 0; i < skills.length; i += 300) {
    for (const k of skills.slice(i, i + 300)) addToIx(k);
    await new Promise((ok) => setImmediate(ok));
  }
}
const LITERAL = 3;
export function rank(q: string, cands: Candidate[], limit = 10): Hit[] {
  if (!q.trim() || !cands.length) return [];
  const { terms, weak, literal, groups } = expand(q);
  const t = fold(q);
  if (ixOf().n > cands.length * 3 + 2000) G.__skillIx = freshIx();
  for (const c of cands) addToIx(c.skill);
  const ix = ixOf(), cand = new Map(cands.map((c) => [c.skill, c]));
  const df = new Map<string, number>(), hit = new Set<Skill>();
  for (const w of terms) {
    let n = 0;
    for (const k of ix.post.get(w) ?? []) if (cand.has(k)) { n++; hit.add(k); }
    df.set(w, n);
  }
  for (const w of rawWords(t)) for (const k of ix.first.get(w) ?? []) if (cand.has(k)) hit.add(k);
  const idf = (w: string) => Math.log(1 + cands.length / (df.get(w) || cands.length));
  const extra = groups.map((g) => g.filter((w) => !literal.has(w)));
  const out: Hit[] = [];
  for (const k of hit) {
    const { name, body, folded, vi } = docOf(k), c = cand.get(k)!;
    let score = hasPhrase(t, folded) ? 6 : 0, strong = score > 0, soft = 0;
    // Mô tả dài nhồi nhiều từ khóa thì khớp từ nào cũng dễ: khớp trong mô tả tính nhẹ dần theo độ dài. Tên skill không bị ảnh hưởng.
    const lenFit = Math.min(1.3, Math.sqrt(40 / Math.max(body.size, 5)));
    const value = (w: string) => {
      const m = name.has(w) ? 3 : body.has(w) ? lenFit : 0;
      if (!m) return 0;
      // Mô tả bằng tiếng Việt (skill người dùng tự viết): trùng âm tiết là trùng thật, không phải tình cờ với chữ tiếng Anh.
      if (weak.has(w)) { soft++; return m * idf(w) * (vi ? 1 : 0.25); }
      strong = true;
      return m * idf(w);
    };
    // Từ người dùng thật sự viết ("seo") nặng hơn từ khóa suy ra từ khái niệm; mỗi khái niệm chỉ tính từ khớp tốt nhất, để mô tả kể lể mọi từ của một khái niệm không vượt được skill đúng tên.
    for (const w of literal) { const v = value(w); score += weak.has(w) ? v : v * LITERAL; }
    // Từ khóa đầu của khái niệm là nghĩa chính, các từ sau là nghĩa rộng dần (từ hiếm được IDF cao, từng đưa "regulation" vượt "contract" cho câu về hợp đồng).
    // Tên có hai từ của cùng khái niệm ("data-analysis") đúng hơn tên có một từ hiếm: từ thứ hai tính thêm một nửa, từ thứ ba trở đi không tính.
    for (const g of extra) { let a = 0, b = 0; g.forEach((w, i) => { const v = value(w) * (i < 3 ? 1 : 0.5); if (v > a) { b = a; a = v; } else if (v > b) b = v; }); score += a + b / 2; }
    // Chỉ trùng một âm tiết thì chưa nói lên gì: cần một từ thật, hoặc ít nhất hai âm tiết (mô tả skill bằng tiếng Việt).
    if (!strong && soft < 2) score = 0;
    if (score > 0) out.push({ ...c, score: score * (c.weight ?? 1) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
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
