// Chọn 3 mẫu tham chiếu cho một đề thiết kế và trộn token của chúng thành một bộ phong cách riêng cho sản phẩm.
// Hàm thuần: không đọc cơ sở dữ liệu, tệp hay mạng (server/designrefs.ts nạp thư viện mẫu và lịch sử rồi gọi vào đây),
// nên
// cùng một đề, cùng hạt giống và cùng lịch sử luôn ra cùng kết quả, và kiểm thử chạy không cần máy chủ.
// Mỗi sản phẩm trộn từ 2-3 mẫu (màu của mẫu này, chữ của mẫu kia, hình khối của mẫu thứ ba): không sản phẩm nào là bản
// sao
// của một trang nguồn.
import {
  contrastRatio, fontPairKey, fontStack, isHex, kitFont, luminance, MIX_ATTR, MIX_FONTS_ATTR, paletteKey,
  type BriefFacets, type ColorRole, type KitFontId, type MixRole, type PaletteColor, type RefAudience,
  type RefColor, type RefDomain, type RefFont, type RefIndexRow, type RefIndustry, type RefMood, type RefTokens,
  type StyleMix,
} from "./designrefs";

// ---------------------------------------------------------------- đọc đề bài
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
// Chữ có dấu chỉ khớp đúng dấu đó hoặc bản không dấu: "trà" nhận "tra" nhưng không nhận "trả lời", "ấm" không nhận "âm
// nhạc".
const accented = (src: string) => src.normalize("NFC").replace(/\p{L}/gu, (c) => {
  const f = fold(c);
  return f === c.toLowerCase() ? c : `[${c}${f}]`;
});
const WB = "(?<![\\p{L}\\p{N}])";
const WE = "(?![\\p{L}\\p{N}])";
// Đề gõ có dấu thì khớp đúng dấu ("kiểm tra" không phải "trà"); đề gõ không dấu thì khớp theo chữ không dấu.
type Kw = { strict: RegExp; loose: RegExp };
const words = (src: string): Kw => ({
  strict: new RegExp(`${WB}(?:${src.normalize("NFC")})${WE}`, "gu"),
  loose: new RegExp(`${WB}(?:${accented(src)})${WE}`, "gu"),
});
const marks = (s: string) => (s.normalize("NFD").match(/[\u0300-\u036f]/g) ?? []).length;
/** Đề có ít nhất vài dấu thanh: người gõ có dấu, khớp từ khóa đúng dấu. */
const isAccented = (s: string) => marks(s) >= 3;
const rx = (k: Kw, strict: boolean) => (strict ? k.strict : k.loose);
const lower = (s: string) => s.normalize("NFC").toLowerCase();

const INDUSTRY_WORDS: [RefIndustry, Kw][] = [
  ["finance", words("tài chính|ngân hàng|chứng khoán|bảo hiểm|kế toán|fintech|quỹ đầu tư|finance|banking|bank"
    + "|insurance")],
  ["tech-saas", words("phần mềm|saas|công nghệ|nền tảng số|ứng dụng di động|devops|software|platform"
    + "|startup công nghệ")],
  ["ai", words("trí tuệ nhân tạo|machine learning|học máy|chatbot|llm|generative ai")],
  ["ecommerce", words("thương mại điện tử|bán online|bán hàng online|cửa hàng online|sàn thương mại|e-?commerce"
    + "|online store")],
  ["food-beverage", words("trà|cà phê|cafe|coffee|bánh|bánh mì|tiệm bánh|nhà hàng|quán ăn|ẩm thực|đồ uống|mật ong"
    + "|bia|rượu"
    + "|food|restaurant|bakery|tea|drinks?|honey")],
  ["hospitality-travel", words("du lịch|khách sạn|resort|homestay|nghỉ dưỡng|lữ hành|travel|hotel|tourism")],
  ["real-estate-interior", words("bất động sản|nội thất|kiến trúc|căn hộ|nhà ở|cải tạo nhà|cải tạo căn hộ|cải tạo"
    + "|interior|architecture|real estate|apartment")],
  ["fashion-beauty", words("thời trang|mỹ phẩm|làm đẹp|spa|nước hoa|trang sức|fashion|beauty|cosmetics|jewelry")],
  ["health-wellness", words("sức khỏe|sức khoẻ|y tế|phòng khám|bệnh viện|yoga|thiền|dinh dưỡng|wellness|health"
    + "|clinic")],
  ["education", words("giáo dục|khóa học|khoá học|đào tạo|trường học|bài giảng|học sinh|sinh viên|đại học|education"
    + "|course"
    + "|school|university")],
  ["culture-music", words("âm nhạc|nhạc|jazz|hòa nhạc|hoà nhạc|nghệ sĩ|nhà hát|triển lãm|nghệ thuật|văn hóa|văn hoá"
    + "|điện ảnh|music|concert|gallery|theatre|theater")],
  ["events", words("sự kiện|hội nghị|hội thảo|đêm nhạc|lễ hội|gala|khai mạc|event|conference|festival|summit"
    + "|workshop")],
  ["media-publishing", words("tạp chí|xuất bản|báo chí|podcast|magazine|publishing|newsroom")],
  ["nonprofit-gov", words("phi lợi nhuận|từ thiện|cộng đồng|chính phủ|nhà nước|nonprofit|charity|government|ngo")],
  ["industrial-b2b", words("sản xuất|nhà máy|công nghiệp|logistics|kho vận|chuỗi cung ứng|xây dựng|b2b|manufacturing"
    + "|industrial|supply chain")],
  ["consulting", words("tư vấn|chiến lược|quản trị|consulting|strategy|m&a")],
  ["sports", words("thể thao|bóng đá|gym|chạy bộ|marathon|fitness|sports?|esports")],
  ["kids-family", words("trẻ em|mầm non|mẹ và bé|đồ chơi|thiếu nhi|kids|children|toys?")],
  ["crafts-artisan", words("thủ công|handmade|làng nghề|gốm|đồ gốm|artisan|crafts?")],
];
const AUDIENCE_WORDS: [RefAudience, Kw][] = [
  ["consumer", words("khách hàng|người tiêu dùng|người mua|bán online|consumers?|customers?|shoppers?")],
  ["youth", words("giới trẻ|gen ?z|thanh niên|tuổi teen|youth|teens?|young people")],
  ["premium", words("cao cấp|sang trọng|thượng lưu|premium|luxury|high-end")],
  ["families", words("gia đình|phụ huynh|bố mẹ|families|family|parents")],
  ["b2b", words("doanh nghiệp|đối tác|b2b|enterprise|businesses")],
  ["investors", words("nhà đầu tư|gọi vốn|investors?|fundraising|pitch")],
  ["developers", words("lập trình viên|kỹ sư phần mềm|developers?|engineers")],
  ["internal", words("nội bộ|nhân viên|chủ chuỗi|chủ cửa hàng|ban giám đốc|quản lý cửa hàng|internal|staff|managers?")],
  ["students", words("học sinh|sinh viên|students?|learners")],
  ["public", words("công chúng|người dân|khán giả|cộng đồng|public|audience")],
];
const MOOD_WORDS: [RefMood, Kw][] = [
  ["dark-cinematic", words("điện ảnh|cinematic|huyền bí|kịch tính|moody")],
  ["clean-light", words("sạch sẽ|trong trẻo|thoáng đãng|clean|airy")],
  ["warm-craft", words("ấm áp|ấm cúng|tông ấm|màu ấm|ấm|mộc mạc|warm|cozy|rustic")],
  ["bold-color", words("táo bạo|rực rỡ|màu mạnh|sặc sỡ|bold|vibrant|colou?rful")],
  ["minimal-mono", words("tối giản|đơn sắc|tinh giản|minimal|minimalist|monochrome")],
  ["editorial", words("tạp chí|editorial|dàn trang|magazine")],
  ["tech", words("công nghệ cao|tương lai|futuristic|high-tech|hi-tech|sci-fi")],
  ["playful", words("vui nhộn|vui tươi|dễ thương|đáng yêu|trẻ trung|playful|fun|cute")],
  ["luxury", words("sang trọng|cao cấp|đẳng cấp|xa xỉ|luxury|luxurious|premium")],
  ["data-dense", words("nhiều số liệu|dày đặc|data-dense|data heavy")],
  ["organic", words("tự nhiên|hữu cơ|thiên nhiên|organic|natural")],
  ["retro-print", words("retro|cổ điển|hoài cổ|vintage|in lụa|risograph")],
  ["swiss-precise", words("thụy sĩ|thuỵ sĩ|swiss|lưới chặt|grid system")],
  ["energetic", words("năng động|sôi động|bùng nổ|mạnh mẽ|năng lượng|energetic|dynamic")],
];
// "tối đa", "tối giản", "buổi sáng", "sáng tạo", "ánh sáng" không nói về nền: chỉ nhận cụm nói rõ nền, giao diện, tông
// màu.
const DARK = words("nền tối|giao diện tối|tông tối|màu tối|chế độ tối|bản tối|tối màu|nền đen|ban đêm|đêm|đêm nhạc"
  + "|về đêm"
  + "|dark|dark mode|dark theme|night");
const LIGHT = words("nền sáng|nền trắng|giao diện sáng|tông sáng|màu sáng|chế độ sáng|bản sáng|sáng sủa|light mode"
  + "|light theme"
  + "|white background");
// Đề đòi cả hai giao diện ("giao diện sáng và tối"): nền do mẫu quyết định.
const BOTH_THEMES = words("sáng và tối|sáng lẫn tối|sáng hoặc tối|sáng/tối|light and dark|dark and light");
const NOT_AI_TOPIC = new RegExp("(?:ảnh|hình|tranh|image|images|picture|art)\\s+(?:do\\s+|by\\s+)?AI"
  + "|AI[- ](?:tạo|generated|images?)", "giu");
const DOMAIN_WORDS: [RefDomain, Kw][] = [
  ["dashboard", words("dashboard|bảng điều khiển|admin panel|bảng quản trị")],
  ["email", words("email|e-mail|thư html|newsletter|bản tin email")],
  ["web", words("landing page|trang đích|trang web|website|web app|giao diện|trang chủ|homepage")],
  ["poster", words("poster|banner|flyer|tờ rơi|thẻ mạng xã hội|ảnh bìa|thumbnail|brand sheet|bộ nhận diện"
    + "|nhận diện thương hiệu|logo|infographic|thiệp|ảnh|áp phích")],
];
const BRAND_AFTER = new RegExp("(?:thương hiệu|tiệm|studio|quán|cửa hàng|công ty|chuỗi|brand)\\s+"
  + "((?:\\p{Lu}[\\p{L}\\p{N}'’-]*\\s?){1,4})", "u");
const QUOTED = /["“«]([^"“”«»\n]{1,40})["”»]/u;
// Tên trong ngoặc là tên riêng (thương hiệu, sự kiện): không đọc tâm trạng, nền sáng / tối từ đó ("Lò Ấm" không phải
// "ấm áp").
const unquote = (s: string) => s.replace(/["“«][^"“”«»\n]{1,80}["”»]/gu, " ");

/** Mặc định tâm trạng theo ngành khi đề không nói rõ. */
export const MOOD_DEFAULTS: Record<RefIndustry, RefMood[]> = {
  "finance": ["swiss-precise", "clean-light", "data-dense"],
  "tech-saas": ["tech", "clean-light", "dark-cinematic"],
  "ai": ["dark-cinematic", "tech", "minimal-mono"],
  "ecommerce": ["bold-color", "clean-light", "playful"],
  "food-beverage": ["warm-craft", "organic", "bold-color"],
  "hospitality-travel": ["luxury", "organic", "editorial"],
  "real-estate-interior": ["minimal-mono", "luxury", "warm-craft"],
  "fashion-beauty": ["editorial", "luxury", "minimal-mono"],
  "health-wellness": ["organic", "clean-light", "minimal-mono"],
  "education": ["clean-light", "playful", "swiss-precise"],
  "culture-music": ["dark-cinematic", "bold-color", "retro-print"],
  "events": ["dark-cinematic", "energetic", "bold-color"],
  "media-publishing": ["editorial", "swiss-precise", "bold-color"],
  "nonprofit-gov": ["clean-light", "swiss-precise", "organic"],
  "industrial-b2b": ["swiss-precise", "tech", "clean-light"],
  "consulting": ["swiss-precise", "minimal-mono", "editorial"],
  "sports": ["energetic", "bold-color", "dark-cinematic"],
  "kids-family": ["playful", "bold-color", "organic"],
  "crafts-artisan": ["warm-craft", "organic", "retro-print"],
  "general": ["clean-light", "bold-color", "swiss-precise"],
};

/** Các nhóm xếp theo số lần khớp (nhiều trước), bằng nhau thì nhóm nhắc tới sớm hơn đứng trước. */
function ranked<T>(text: string, table: [T, Kw][], max: number, strict: boolean): T[] {
  const hits: { k: T; n: number; at: number }[] = [];
  for (const [k, kw] of table) {
    const all = [...text.matchAll(rx(kw, strict))];
    if (all.length) hits.push({ k, n: all.length, at: all[0].index ?? 0 });
  }
  return hits.sort((a, b) => b.n - a.n || a.at - b.at).slice(0, max).map((h) => h.k);
}
function firstMatch<T>(text: string, table: [T, Kw][], strict: boolean): T | null {
  let best: { k: T; at: number } | null = null;
  for (const [k, kw] of table) {
    const re = rx(kw, strict);
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { k, at: m.index };
  }
  return best?.k ?? null;
}
const has = (text: string, kw: Kw, strict: boolean) => {
  const re = rx(kw, strict);
  re.lastIndex = 0;
  return re.test(text);
};

/** Tên thương hiệu / sản phẩm của đề: tên trong ngoặc kép, hoặc cụm viết hoa sau "thương hiệu", "tiệm", "studio"… */
export function briefBrand(typed: string): string | null {
  const q = QUOTED.exec(typed);
  if (q && q[1].trim().split(/\s+/).length <= 5) return q[1].trim();
  const b = BRAND_AFTER.exec(typed.normalize("NFC"));
  return b ? b[1].trim() : null;
}

/** Ngành, tâm trạng, khán giả, nền sáng / tối của đề, theo luật từ khóa, không gọi model. Bảng tính không dùng mẫu. */
export function briefFacets(typed: string, format: "slide" | "doc" | "graphic" | "sheet"): BriefFacets | null {
  if (format === "sheet") return null;
  const t = lower(typed);
  const plain = lower(unquote(typed));
  const strict = isAccented(typed);
  const graphic = () => firstMatch(t, DOMAIN_WORDS, strict) ?? "poster";
  const domain: RefDomain = format === "slide" ? "slide" : format === "doc" ? "doc" : graphic();
  const industries = ranked(t, INDUSTRY_WORDS, 3, strict);
  // "AI" viết hoa đứng riêng là trí tuệ nhân tạo ("ai" thường là đại từ).
  // "không ảnh AI" nói về cách làm hình, không nói ngành của đề.
  const aiTopic = /(?<![\p{L}\p{N}])AI(?![\p{L}\p{N}])/u.test(typed.replace(NOT_AI_TOPIC, " "));
  if (aiTopic && !industries.includes("ai")) industries.unshift("ai");
  if (industries.length > 3) industries.length = 3;
  if (!industries.length) industries.push("general");
  const said = ranked(plain, MOOD_WORDS, 3, strict);
  const moods = said.length ? said : [...MOOD_DEFAULTS[industries[0]]];
  // Dashboard luôn cần mật độ số liệu và không dùng giọng tạp chí.
  if (domain === "dashboard") {
    const keep = moods.filter((m) => m !== "editorial");
    if (!keep.includes("data-dense")) keep.unshift("data-dense");
    moods.splice(0, moods.length, ...keep.slice(0, 3));
  }
  const audience = ranked(t, AUDIENCE_WORDS, 3, strict);
  const both = has(plain, BOTH_THEMES, strict);
  const dark = !both && has(plain, DARK, strict);
  const light = !both && has(plain, LIGHT, strict);
  const theme = dark && !light ? "dark" : light && !dark ? "light" : null;
  return { domain, industries, moods, audience, theme, brand: briefBrand(typed) };
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/i;
const FOLLOW_WORDS = words("theo kiểu|theo phong cách|giống kiểu|giống phong cách|giống trang|giống như trang"
  + "|phong cách như"
  + "|phong cách của|phong cách giống|lấy cảm hứng từ|làm theo kiểu|như mẫu này|như ảnh này|như trang này"
  + "|in the style of|same style as|style like|like this (?:site|page|design|image|one)|inspired by");
/** Người dùng gõ "làm theo kiểu …" kèm liên kết hoặc ảnh đính kèm: trả nguồn cần đọc phong cách, không thì null. */
export function followAsk(typed: string, hasImage: boolean): { url: string } | { image: true } | null {
  if (!has(lower(typed), FOLLOW_WORDS, isAccented(typed))) return null;
  const u = URL_RE.exec(typed);
  if (u) return { url: u[0].replace(/[.,;:!?]+$/, "") };
  return hasImage ? { image: true } : null;
}

// ---------------------------------------------------------------- chọn mẫu
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
};
const overlap = <T>(a: readonly T[], b: readonly T[]) => a.filter((x) => b.includes(x)).length;

/** Điểm hợp đề của một mẫu: ngành nặng nhất, rồi tâm trạng, khán giả, nền; cộng một phần ngẫu nhiên theo đoạn chat. */
export function scoreRef(r: RefIndexRow, f: BriefFacets, seed: string): number {
  let s = 3 * overlap(r.industries, f.industries) + (r.industries.includes("general") ? 1 : 0);
  s += 2 * overlap(r.moods, f.moods) + overlap(r.audience, f.audience);
  if (f.theme) s += r.theme === f.theme ? 2 : -3;
  return s + ((hash(seed + r.id) % 1000) / 1000) * 1.5;
}

/** Một sản phẩm trước đây của người dùng: mẫu đã dùng, khóa bảng màu và cặp phông của bản trộn. */
export type HistoryRow = { refIds: string[]; paletteKey: string; fontPair: string; brand: string | null };
export type PickInput = { facets: BriefFacets; rows: RefIndexRow[]; history: HistoryRow[]; seed: string };
export type Picked = { row: RefIndexRow; roles: MixRole[] };

// Ít mẫu cùng mảng thì mượn mảng gần nhất: email gần web nhất, tài liệu gần slide.
const NEIGHBOURS: Record<RefDomain, RefDomain[]> = {
  email: ["web"],
  dashboard: ["web"],
  doc: ["slide", "web"],
  poster: ["slide", "web"],
  slide: ["web", "poster"],
  web: ["slide", "email"],
};
const VISUAL = new Set(["photo", "3d", "illustration", "mixed"]);
// Mẫu của 3 sản phẩm gần nhất cấm hẳn. Bảng màu và cặp phông: tránh cả 10 sản phẩm gần nhất khi thư viện còn lựa chọn,
// thiếu thì lùi về chỉ tránh 3 sản phẩm gần nhất, để một người làm nhiều sản phẩm liên tiếp không thấy hai cái giống
// nhau.
const RECENT = 3;
const WIDE = 10;
const sameBrand = (a: string | null, b: string | null) => !!a && !!b && fold(a).trim() === fold(b).trim();
const fontIds = (pair: string) => pair.split("+") as [string, string];
const headIsSerif = (pair: string) => kitFont(fontIds(pair)[0])?.cat === "serif";

/** Cặp phông thật của sản phẩm khi mẫu này giữ vai chữ: phông thân chỉ dành cho tiêu đề thì đổi sang phông đọc. */
export function typeFonts(head: KitFontId, body: KitFontId, moods: readonly RefMood[], domain: RefDomain) {
  const reading: KitFontId = moods.some((m) => m === "tech" || m === "swiss-precise" || m === "data-dense")
    ? "inter"
    : "be-vietnam-pro";
  const b: KitFontId = kitFont(body)?.cat === "display" ? reading : body;
  // Dashboard đọc số và nhãn nhỏ cả ngày: tiêu đề có chân làm bảng số trông như tạp chí.
  const h: KitFontId = domain === "dashboard" && kitFont(head)?.cat === "serif" ? b : head;
  return { head: h, body: b };
}
const effectivePair = (r: RefIndexRow, domain: RefDomain) => {
  const [h, b] = fontIds(r.fontPair);
  const f = typeFonts(h as KitFontId, b as KitFontId, r.moods, domain);
  return `${f.head}+${f.body}`;
};

/**
 * Chọn 3 mẫu: mẫu chính hợp đề nhất (cho màu, bố cục, nền), mẫu thứ hai khác trang nguồn và cặp phông chưa dùng gần đây
 * (cho chữ), mẫu thứ ba từ trang nguồn thứ ba (cho hình khối). Web, slide, poster mà hai mẫu đầu không có ảnh thật thì
 * mẫu
 * thứ ba phải có. Không đủ mẫu thỏa mọi điều kiện thì nới dần (trang nguồn, rồi lịch sử), không bao giờ trả về mẫu
 * trùng.
 */
export function pickRefs(i: PickInput): Picked[] | null {
  const f = i.facets;
  let pool = i.rows.filter((r) => r.domain === f.domain);
  if (pool.length < 6) pool = [...pool, ...i.rows.filter((r) => NEIGHBOURS[f.domain].includes(r.domain))];
  if (f.domain === "dashboard") pool = pool.filter((r) => !r.moods.includes("editorial"));
  if (!pool.length) return null;
  const hist = i.history.filter((h) => !sameBrand(h.brand, f.brand));
  const recent = hist.slice(0, RECENT);
  const wide = hist.slice(0, WIDE);
  const usedIds = new Set(recent.flatMap((h) => h.refIds));
  const usedPal = new Set(recent.map((h) => h.paletteKey));
  const usedFont = new Set(recent.map((h) => h.fontPair));
  const widePal = new Set(wide.map((h) => h.paletteKey));
  const wideFont = new Set(wide.map((h) => h.fontPair));
  const base = new Map(pool.map((r) => [r.id, scoreRef(r, f, i.seed)]));
  const best = (score: (r: RefIndexRow) => number, tiers: ((r: RefIndexRow) => boolean)[]) => {
    for (const ok of tiers) {
      const c = pool.filter(ok).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      if (c.length) return c[0];
    }
    return null;
  };
  const fresh = (r: RefIndexRow) => !usedIds.has(r.id);
  const score = (r: RefIndexRow) => base.get(r.id)!;
  const primary = best(score, [
    (r) => fresh(r) && !widePal.has(r.paletteKey),
    (r) => fresh(r) && !usedPal.has(r.paletteKey),
    fresh,
    () => true,
  ]);
  if (!primary) return null;
  const notP = (r: RefIndexRow) => r.id !== primary.id;
  const typeOk = (r: RefIndexRow) => f.domain !== "dashboard" || !headIsSerif(r.fontPair);
  const pairOf = (r: RefIndexRow) => effectivePair(r, f.domain);
  const second = best(score, [
    (r) => notP(r) && typeOk(r) && fresh(r) && r.host !== primary.host && !wideFont.has(pairOf(r)),
    (r) => notP(r) && typeOk(r) && fresh(r) && r.host !== primary.host && !usedFont.has(pairOf(r)),
    (r) => notP(r) && typeOk(r) && fresh(r) && !usedFont.has(pairOf(r)),
    (r) => notP(r) && typeOk(r) && !usedFont.has(pairOf(r)),
    (r) => notP(r) && typeOk(r) && fresh(r),
    (r) => notP(r) && typeOk(r),
    notP,
  ]);
  if (!second) return [{ row: primary, roles: ["palette", "layout", "type", "shape"] }];
  const needVisual = ["web", "slide", "poster"].includes(f.domain) && !VISUAL.has(primary.imagery)
    && !VISUAL.has(second.imagery);
  const notPS = (r: RefIndexRow) => r.id !== primary.id && r.id !== second.id;
  const newHost = (r: RefIndexRow) => r.host !== primary.host && r.host !== second.host;
  const visual = (r: RefIndexRow) => !needVisual || VISUAL.has(r.imagery);
  const third = best(score, [
    (r) => notPS(r) && fresh(r) && newHost(r) && visual(r),
    (r) => notPS(r) && fresh(r) && visual(r),
    (r) => notPS(r) && visual(r),
    (r) => notPS(r) && fresh(r),
    notPS,
  ]);
  const out: Picked[] = [{ row: primary, roles: ["palette", "layout"] }, { row: second, roles: ["type"] }];
  if (third) out.push({ row: third, roles: ["shape"] });
  else out[0].roles.push("shape");
  return out;
}

// ---------------------------------------------------------------- màu
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return c.toString(16).padStart(2, "0");
}).join("")}`;
/** Pha hai màu theo tỉ lệ t (0: a, 1: b). */
export function blend(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOf(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
function toHsl(hex: string) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function fromHsl(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c] : [c, 0, x];
  return hexOf((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
/** Giữ sắc màu, đẩy độ sáng ra xa nền tới khi đạt tỉ lệ tương phản min (chữ đọc được mà vẫn là "màu đó"). */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const { h, s, l } = toHsl(fg);
  const down = luminance(bg) > 0.18;
  for (let k = 1; k <= 50; k++) {
    const c = fromHsl(h, s, Math.max(0, Math.min(1, down ? l - k * 0.02 : l + k * 0.02)));
    if (contrastRatio(c, bg) >= min) return c;
  }
  return down ? "#000000" : "#ffffff";
}

export type MixPalette = Record<
  "bg" | "surface" | "raised" | "ink" | "muted" | "accent" | "accent2" | "line" | "neutral" | "pos" | "neg" | "vivid"
  | "vivid2", string>;
const colorOf = (colors: RefColor[], role: ColorRole) => colors.find((c) => c.role === role && isHex(c.hex))?.hex;

/**
 * Bảng màu đủ vai cho bộ CSS: chữ và chữ phụ đạt 4.5:1 trên nền (đẩy độ sáng), màu nhấn làm chữ không đạt thì giữ màu
 * gốc ở
 * vivid cho mảng màu, biểu đồ, và dùng bản sẫm / sáng hơn cho chữ (như các phong cách có sẵn); vai thiếu pha từ nền và
 * chữ.
 */
export function mixPalette(colors: RefColor[], theme: "light" | "dark"): MixPalette {
  const bg = colorOf(colors, "bg") ?? (theme === "dark" ? "#0e0f12" : "#ffffff");
  const ink = ensureContrast(colorOf(colors, "ink") ?? (theme === "dark" ? "#f4f4f5" : "#111111"), bg);
  const muted = ensureContrast(colorOf(colors, "muted") ?? blend(ink, bg, 0.35), bg);
  // Mẫu nền đỏ có màu nhấn cũng là màu nền (poster một màu): nhấn trùng nền thì không thấy, lấy màu nhấn phụ hoặc chữ.
  const seen = (c: string | undefined) => (c && contrastRatio(c, bg) >= 1.3 ? c : undefined);
  const vivid = seen(colorOf(colors, "accent")) ?? seen(colorOf(colors, "accent2")) ?? ink;
  const vivid2 = seen(colorOf(colors, "accent2")) ?? blend(vivid, ink, 0.5);
  const dark = theme === "dark";
  return {
    bg,
    surface: colorOf(colors, "surface") ?? blend(bg, ink, dark ? 0.06 : 0.03),
    raised: colorOf(colors, "raised") ?? blend(bg, ink, dark ? 0.11 : 0.06),
    ink,
    muted,
    accent: ensureContrast(vivid, bg),
    accent2: ensureContrast(vivid2, bg),
    line: colorOf(colors, "line") ?? blend(bg, ink, dark ? 0.2 : 0.14),
    neutral: blend(bg, ink, 0.4),
    pos: ensureContrast(colorOf(colors, "pos") ?? (dark ? "#34d399" : "#0f7b4f"), bg),
    neg: ensureContrast(colorOf(colors, "neg") ?? (dark ? "#fb7185" : "#b42318"), bg),
    vivid,
    vivid2,
  };
}

/** Gán vai cho các màu đọc từ điểm ảnh: nhiều nhất là nền, tương phản mạnh nhất là chữ, rực nhất là màu nhấn. */
export function rolesFromPalette(palette: PaletteColor[]): RefColor[] | null {
  const cs = palette.filter((c) => isHex(c.hex) && c.share > 0).sort((a, b) => b.share - a.share);
  if (!cs.length) return null;
  const bg = cs[0];
  const rest = cs.slice(1);
  const byContrast = [...rest].sort((a, b) => contrastRatio(b.hex, bg.hex) - contrastRatio(a.hex, bg.hex));
  const inkC = byContrast[0] && contrastRatio(byContrast[0].hex, bg.hex) >= 3 ? byContrast[0] : null;
  const ink = inkC?.hex ?? (luminance(bg.hex) > 0.18 ? "#111111" : "#f5f5f5");
  const sat = (h: string) => {
    const x = toHsl(h);
    return x.s * (1 - Math.abs(2 * x.l - 1));
  };
  const vivid = rest.filter((c) => c !== inkC && sat(c.hex) > 0.12).sort((a, b) => sat(b.hex) - sat(a.hex));
  const accent = vivid[0]?.hex ?? ink;
  const out: RefColor[] = [
    { hex: bg.hex, role: "bg", share: bg.share },
    { hex: ink, role: "ink", share: inkC?.share ?? 0 },
    { hex: accent, role: "accent", share: vivid[0]?.share ?? 0 },
  ];
  if (vivid[1]) out.push({ hex: vivid[1].hex, role: "accent2", share: vivid[1].share });
  const surf = rest.find((c) => c !== inkC && !vivid.slice(0, 2).includes(c) && contrastRatio(c.hex, bg.hex) < 1.4);
  if (surf) out.push({ hex: surf.hex, role: "surface", share: surf.share });
  return out;
}

// ---------------------------------------------------------------- trộn
const kitRef = (kit: KitFontId, weight: number): RefFont => ({ kit, seen: "", seenLicence: "open", weight });
export type MixPart = { tokens: RefTokens; roles: MixRole[]; moods?: readonly RefMood[] };

/**
 * Trộn token: màu, bố cục, nền từ mẫu giữ vai palette; phông, thang chữ, giãn chữ từ mẫu vai type; bo góc, bóng, khoảng
 * cách
 * từ mẫu vai shape; ảnh lấy theo mẫu đầu tiên (chính, hình khối, chữ) có ảnh thật. ownBrand: người dùng có màu thương
 * hiệu
 * riêng, bỏ màu của mẫu (khối quy tắc bảo model dùng màu thương hiệu).
 */
export function mixTokens(parts: MixPart[], domain: RefDomain, ownBrand: boolean): RefTokens {
  const by = (role: MixRole) => (parts.find((p) => p.roles.includes(role)) ?? parts[0]);
  const pal = by("palette");
  const typ = by("type");
  const shp = by("shape");
  const lay = by("layout");
  const order = [pal, shp, typ];
  const img = order.find((p) => p.tokens.imagery.kind !== "type-only") ?? pal;
  const theme = pal.tokens.theme;
  const fonts = typeFonts(typ.tokens.fonts.head.kit, typ.tokens.fonts.body.kit, typ.moods ?? [], domain);
  const font = (f: RefFont, kit: KitFontId): RefFont => (f.kit === kit ? f : kitRef(kit, 400));
  const p = mixPalette(pal.tokens.colors, theme);
  const share = (role: ColorRole) => pal.tokens.colors.find((c) => c.role === role)?.share ?? 0;
  const roles: ColorRole[] = ["bg", "surface", "raised", "ink", "muted", "accent", "accent2", "line", "pos", "neg"];
  // Màu nhấn giữ bản gốc (vivid) trong token: khóa bảng màu và lần dựng lại sau đều đọc đúng màu của mẫu.
  const hexFor = (r: ColorRole) => (r === "accent" ? p.vivid : r === "accent2" ? p.vivid2 : p[r]);
  const colors: RefColor[] = ownBrand ? [] : roles.map((role) => ({ hex: hexFor(role), role, share: share(role) }));
  return {
    theme,
    colors,
    fonts: {
      head: font(typ.tokens.fonts.head, fonts.head),
      body: font(typ.tokens.fonts.body, fonts.body),
      mono: typ.tokens.fonts.mono ?? { kit: "jetbrains-mono", seen: "", seenLicence: "open", weight: 500 },
    },
    type: { ...typ.tokens.type },
    tracking: { ...typ.tokens.tracking },
    radius: { ...shp.tokens.radius },
    shadow: { ...shp.tokens.shadow },
    spacing: { ...shp.tokens.spacing },
    layout: { ...lay.tokens.layout },
    imagery: { ...img.tokens.imagery },
  };
}

const HARD_SHADOW = /(?:^|,)\s*-?\d+(?:\.\d+)?px\s+-?\d+(?:\.\d+)?px\s+0(?:px)?(?:\s|,|$)/;
/** Độ dày viền suy từ hình khối: bóng cứng không nhòe là kiểu thô mộc (viền dày); bo lớn có bóng mịn thì không viền. */
export function borderOf(t: RefTokens): number {
  if (t.shadow.level > 0 && HARD_SHADOW.test(t.shadow.css)) return 2;
  if (t.radius.outer >= 20 && t.shadow.level >= 1) return 0;
  return 1;
}
/** Phong cách có sẵn làm lớp nền cho các lớp sx-*; bộ biến của bản trộn đè lên mọi màu, phông và hình khối của nó. */
export function basePreset(t: RefTokens): string {
  if (t.theme === "dark") return t.radius.outer >= 12 ? "midnight-tech" : "data-terminal";
  if (borderOf(t) >= 2) return "neo-brutalist";
  if (t.radius.outer >= 20) return "soft-bento";
  if (kitFont(t.fonts.head.kit)?.cat === "serif") return "editorial-serif";
  if (t.radius.outer === 0 && t.shadow.level === 0) return "swiss-grid";
  return "exec-navy";
}
/** Mã bản trộn: cùng token, cùng lớp nền thì cùng mã, để lượt sửa sau và "Lưu làm phong cách của tôi" tìm lại được. */
export function mixIdOf(t: RefTokens, preset: string): string {
  return `m-${hash(preset + JSON.stringify(t)).toString(16).padStart(8, "0").slice(-8)}`;
}
const num = (n: number, d = 3) => String(Number(n.toFixed(d)));
const monoOf = (t: RefTokens) => t.fonts.mono?.kit ?? "jetbrains-mono";
const fontsOf = (t: RefTokens) => [...new Set([t.fonts.head.kit, t.fonts.body.kit, monoOf(t)])];

/** Khối CSS duy nhất model dán vào sản phẩm. Chỉ khớp khi trang còn đúng phong cách nền: menu đổi kiểu vẫn chạy. */
export function mixCss(t: RefTokens, preset: string, id: string): string {
  const vars: string[] = [];
  if (t.colors.length) {
    const p = mixPalette(t.colors, t.theme);
    vars.push(`--sx-bg:${p.bg}`, `--sx-surface:${p.surface}`, `--sx-raised:${p.raised}`, `--sx-ink:${p.ink}`);
    vars.push(`--sx-muted:${p.muted}`, `--sx-accent:${p.accent}`, `--sx-accent2:${p.accent2}`, `--sx-line:${p.line}`);
    vars.push(`--sx-neutral:${p.neutral}`, `--sx-pos:${p.pos}`, `--sx-neg:${p.neg}`, `--sx-vivid:${p.vivid}`);
    vars.push(`--sx-vivid2:${p.vivid2}`);
  }
  vars.push(`--sx-bw:${borderOf(t)}`, `--sx-r:${Math.round(t.radius.outer)}`, `--sx-ri:${Math.round(t.radius.inner)}`);
  vars.push(`--sx-shadow:${t.shadow.level ? t.shadow.css || "none" : "none"}`, "--sx-blur:0px");
  vars.push(`--sx-lh:${num(t.type.headLine, 2)}`, `--sx-head:${fontStack(t.fonts.head.kit)}`);
  vars.push(`--sx-body:${fontStack(t.fonts.body.kit)}`, `--sx-mono:${fontStack(monoOf(t))}`);
  vars.push(`--sx-track-display:${num(t.tracking.display)}em`, `--sx-track-head:${num(t.tracking.heading)}em`);
  vars.push(`--sx-track-label:${num(t.tracking.label)}em`);
  const sel = `[data-sx-preset="${preset}"][${MIX_ATTR}="${id}"]`;
  return `<style ${MIX_ATTR}="${id}" ${MIX_FONTS_ATTR}="${fontsOf(t).join(",")}">\n${sel}{${vars.join(";")}}\n</style>`;
}
/** Thư HTML: trình đọc thư không hiểu biến CSS, khối quy tắc đưa thẳng mã màu và phông. */
export function mixLiterals(t: RefTokens): string {
  const f = `chữ tiêu đề ${kitFont(t.fonts.head.kit)?.family}, chữ thân ${kitFont(t.fonts.body.kit)?.family}`;
  if (!t.colors.length) return f;
  const p = mixPalette(t.colors, t.theme);
  return `nền ${p.bg}, bề mặt ${p.surface}, chữ ${p.ink}, chữ phụ ${p.muted}, nhấn ${p.accent}, viền ${p.line}; ${f}`;
}

/** Bản trộn hoàn chỉnh của một sản phẩm. */
export function buildMix(
  parts: MixPart[],
  domain: RefDomain,
  ownBrand: boolean,
  brand: string | null,
  avoid?: { facets: BriefFacets; history: HistoryRow[] },
): StyleMix {
  const mixed = mixTokens(parts, domain, ownBrand);
  const tokens = avoid ? freshFonts(mixed, avoid.facets, avoid.history) : mixed;
  const preset = basePreset(tokens);
  const id = mixIdOf(tokens, preset);
  return { id, preset, domain, tokens, css: mixCss(tokens, preset, id), brand };
}
/**
 * Mẫu chữ trùng cặp phông của sản phẩm gần đây (thư viện ít cặp phông, nhiều mẫu đo ra cùng một phông) thì đổi sang cặp
 * phông theo tâm trạng của đề chưa dùng gần đây: một người làm nhiều sản phẩm liên tiếp không thấy cùng một cặp chữ.
 * Thang chữ, giãn chữ vẫn của mẫu chữ; cùng thương hiệu thì giữ nguyên.
 */
export function freshFonts(t: RefTokens, f: BriefFacets, history: HistoryRow[]): RefTokens {
  const hist = history.filter((h) => !sameBrand(h.brand, f.brand));
  const wide = new Set(hist.slice(0, WIDE).map((h) => h.fontPair));
  const recent = new Set(hist.slice(0, RECENT).map((h) => h.fontPair));
  if (!wide.has(fontPairKey(t))) return t;
  const order = [...f.moods, ...(Object.keys(MOOD_FONTS) as RefMood[])];
  const serifOk = (h: KitFontId) => f.domain !== "dashboard" || kitFont(h)?.cat !== "serif";
  const pairs = order.map((m) => MOOD_FONTS[m]).filter(([h]) => serifOk(h));
  const pick = pairs.find(([h, b]) => !wide.has(`${h}+${b}`)) ?? pairs.find(([h, b]) => !recent.has(`${h}+${b}`));
  if (!pick) return t;
  const head = kitRef(pick[0], t.fonts.head.weight);
  const body = kitRef(pick[1], t.fonts.body.weight);
  return { ...t, fonts: { ...t.fonts, head, body } };
}
/** Khóa bảng màu và cặp phông của một bản trộn, để luật không lặp so với sản phẩm trước. */
export const mixKeys = (t: RefTokens) => ({ paletteKey: paletteKey(t.colors), fontPair: fontPairKey(t) });

// ---------------------------------------------------------------- phong cách đọc từ ảnh / trang người dùng gửi
/** Cặp phông mặc định theo tâm trạng, cho ảnh chụp (điểm ảnh không cho biết phông). */
export const MOOD_FONTS: Record<RefMood, [KitFontId, KitFontId]> = {
  "dark-cinematic": ["space-grotesk", "inter"],
  "clean-light": ["plus-jakarta-sans", "inter"],
  "warm-craft": ["fraunces", "be-vietnam-pro"],
  "bold-color": ["bricolage-grotesque", "plus-jakarta-sans"],
  "minimal-mono": ["ibm-plex-sans", "ibm-plex-sans"],
  "editorial": ["source-serif-4", "be-vietnam-pro"],
  "tech": ["space-grotesk", "ibm-plex-sans"],
  "playful": ["lexend", "lexend"],
  "luxury": ["cormorant-garamond", "montserrat"],
  "data-dense": ["inter", "inter"],
  "organic": ["source-serif-4", "plus-jakarta-sans"],
  "retro-print": ["anton", "archivo"],
  "swiss-precise": ["archivo", "inter"],
  "energetic": ["oswald", "montserrat"],
};
/** Token trung tính khi thư viện mẫu chưa có gì để mượn thang chữ và hình khối. */
export const NEUTRAL_TOKENS: RefTokens = {
  theme: "light",
  colors: [],
  fonts: { head: kitRef("plus-jakarta-sans", 700), body: kitRef("inter", 400), mono: kitRef("jetbrains-mono", 500) },
  type: {
    basePx: 16,
    ratio: 1.333,
    sizes: [12, 14, 16, 21, 28, 38, 51, 68],
    headLine: 1.15,
    bodyLine: 1.55,
    headCase: "none",
  },
  tracking: { display: -0.02, heading: -0.01, body: 0, label: 0.08 },
  radius: { outer: 12, inner: 6, pill: false },
  shadow: { level: 1, css: "0 1px 2px rgba(0,0,0,.06),0 8px 24px -8px rgba(0,0,0,.12)" },
  spacing: { unit: 8, section: 96, gutter: 24, density: "balanced" },
  layout: { columns: 12, maxWidth: 1200, align: "left", emptyShare: 0.3 },
  imagery: {
    kind: "photo",
    share: 0.4,
    light: "soft natural light",
    lens: "35mm, eye level",
    grade: "true to life",
    subject: "",
  },
};
/**
 * Token của phong cách người dùng gửi: màu và nền từ ảnh / trang (ưu tiên số đo của trang), phông từ trang nếu đo được,
 * không thì theo tâm trạng của đề; thang chữ, hình khối, bố cục mượn mẫu thư viện hợp đề nhất (base).
 */
export function followTokens(
  colors: RefColor[],
  measured: Partial<RefTokens>,
  base: RefTokens | null,
  f: BriefFacets,
): RefTokens {
  const b = base ?? NEUTRAL_TOKENS;
  const bg = colors.find((c) => c.role === "bg")?.hex;
  const theme = measured.theme ?? (bg && luminance(bg) < 0.18 ? "dark" : "light");
  const mood = f.moods[0] ?? "clean-light";
  const [h, bd] = MOOD_FONTS[mood];
  const fonts = measured.fonts ?? { head: kitRef(h, 700), body: kitRef(bd, 400), mono: kitRef("jetbrains-mono", 500) };
  return { ...b, ...measured, theme, colors, fonts };
}

/** Token đầy đủ, hợp lệ đọc từ JSON (bảng, yêu cầu): sai kiểu thì null, không đoán. */
export function validTokens(x: unknown): RefTokens | null {
  const t = x as RefTokens;
  if (!t || typeof t !== "object" || (t.theme !== "light" && t.theme !== "dark")) return null;
  if (!Array.isArray(t.colors)) return null;
  if (!t.colors.every((c) => c && isHex(c.hex) && typeof c.role === "string")) return null;
  if (!t.fonts?.head || !kitFont(t.fonts.head.kit) || !t.fonts.body || !kitFont(t.fonts.body.kit)) return null;
  const nums = [t.type?.headLine, t.tracking?.display, t.radius?.outer, t.radius?.inner, t.shadow?.level];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (!t.spacing || !t.layout || !t.imagery || typeof t.shadow.css !== "string") return null;
  return t;
}

/** Mẫu cùng mảng hợp đề nhất, để mượn thang chữ, hình khối và ý bố cục cho phong cách riêng của người dùng. */
export function bestRef(rows: RefIndexRow[], f: BriefFacets, seed: string): RefIndexRow | null {
  const pool = rows.filter((r) => r.domain === f.domain);
  const c = (pool.length ? pool : rows).filter((r) => f.domain !== "dashboard" || !r.moods.includes("editorial"));
  return c.sort((a, b) => scoreRef(b, f, seed) - scoreRef(a, f, seed) || a.id.localeCompare(b.id))[0] ?? null;
}
