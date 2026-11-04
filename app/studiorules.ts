// Nhận diện skill thuộc mục nào trong ba mục tạo mới ở trang Artifacts: Tài liệu (docs), Trình bày (slides), Thiết kế (design).
// Phần thuần (không DB, không mạng) dùng chung cho máy chủ (app/skillstudio.ts) và kiểm thử:
// - ruleStudios: bộ luật từ khóa Việt + Anh trên tên, mô tả và phần đầu nội dung skill — luôn chạy được, không cần model.
//   strict: bộ luật chặt cho danh mục Claude, nơi không có model xếp lại phía sau.
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
export function ruleStudios(name: string, description: string, body = "", strict = false): StudioGuess {
  if (strict) return strictStudios(name, description);
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

// ---------------------------------------------------------------- bộ luật chặt cho thư viện của danh mục Claude
// Danh mục có ~18.000 skill và không nhờ model xếp lại (mỗi skill một lượt gọi model là đốt gói của người dùng), nên kết quả của bộ luật là kết quả cuối:
// phải đúng là chính. Chỉ đọc tên và mô tả (nội dung skill nhắc tới "pdf" hay "design" không nói lên gì), và chỉ tin phần đầu mô tả, nơi skill nói mình làm gì;
// danh sách kích hoạt ở cuối mô tả ("use when … slides, docs, reports") hay nhắc đủ thứ.
// Bốn lớp cho mỗi mục: tên mang đúng sản phẩm; tên gợi ý và câu đầu xác nhận; đầu mô tả nói đúng sản phẩm; câu đầu có động từ làm ra + sản phẩm. Có cụm chặn thì bỏ cả mục.
// Các cụm chặn lấy từ việc đọc mẫu thật của danh mục: hợp đồng thông minh, báo cáo kiểm thử, "resume" nghĩa là chạy tiếp, deck gateway, thiết kế API / CSDL…
// Đọc mẫu ngẫu nhiên trên 17.796 skill: Tài liệu 92%, Trình bày và Thiết kế ≥ 94% đúng. Sửa bộ luật thì tăng CATALOG_RULES (skillstudio.ts) để danh mục được xếp lại.
const WRITE = "write|writes|writing|draft|drafts|drafting|generate|generates|generating|create|creates|creating|produce|produces|producing|compose|composes|composing|prepare|prepares|preparing|author|authors|authoring|build|builds|building|edit|edits|editing|revise|revises|revising|rewrite|rewrites|rewriting|polish|polishes|polishing|make|makes|making";
const DESIGN_V = `${WRITE}|design|designs|designing|redesign|redesigns|redesigning|style|styles|styling`;
const GAP = "(?: (?!from |into |to |for |with |of |in |on |by |via |using |about |against |over )[a-z0-9.+#]+){0,3}?";
const re = (s: string) => new RegExp(` (?:${s}) `);
const made = (verbs: string, nouns: string) => new RegExp(` (?:${verbs})${GAP} (?:${nouns}) `);
const first = (verbs: string, nouns: string) => new RegExp(`^ (?:${verbs})${GAP} (?:${nouns}) `);
type Strict = { name: RegExp; gated: [RegExp, RegExp][]; head: RegExp; made: RegExp[]; not: RegExp };
const VISUAL = re("visual|visuals|layout|layouts|aesthetic|aesthetics|figma|typography|colors?|colours?|palette|palettes|styling|hierarchy|spacing|wireframes?|mockups?|css|design system|design tokens|fonts?|polish|look and feel|graphic|graphics|artwork|poster|posters");
const STRICT: Record<StudioKind, Strict> = {
  docs: {
    name: re("pdf|pdfs|docx|hwpx|word processing|whitepaper|whitepapers|proposal|proposals|cover letter|cover letters|newsletter|newsletters|blog post|blog generator|blog generation|write doc|write docs|write documentation|write spec|write rfc|write prd|prd|prds|rfc|readme|technical writing|legal writing|copy edit|copyedit|copy editing|proofread|proofreading|documentation|docs writer|article writer|draft article|edit article|write article|content writer|seo writer|copywriter|copywriting|contract review|review contract|press release|meeting notes|meeting minutes"),
    gated: [
      [re("resume|resumes|cv|cvs"), re("job|jobs|ats|career|hiring|recruiter|recruiters|interview|cover letter|cv|cvs|candidate")],
      [re("report|reports"), made(WRITE, "reports?")],
      [re("memo|memos"), re("write|writes|draft|drafts|drafting|investment|decision|case|committee|privileged|structured|credit|board|counterparty")],
      [re("contract|contracts|agreement|agreements|nda|ndas"), re("contract among|legal|clause|clauses|redline|redlines|lawyer|attorney|counterparty|counterparties|negotiat[a-z]*|lease|leases|shareholders?|employment|vendor|terms and conditions|e signature|playbook|nda|ndas")],
      [re("docs|doc|document|documents"), made(WRITE, "docs?|documents?|documentation")],
      [re("writing|writer|write|prose|editorial|humanizer|deslop|editor"), re("prose|article|articles|essay|essays|blog|editorial|ai writing|human written|copy edit|manuscript|long form|nonfiction|fiction|narrative|tone of voice")],
    ],
    head: re("microsoft word|google docs|whitepapers?|technical documentation|cover letters?|press releases?|meeting minutes|copyediting|copy editing|proofreading|proofread"),
    made: [
      made(WRITE, "memos?|proposals?|whitepapers?|white papers?|essays?|articles?|blog posts?|blogs?|newsletters?|press releases?|resumes?|cvs?|cover letters?|meeting notes|meeting minutes|handbooks?|user manuals?|user guides?|prds?|rfcs?|specifications?|tech(?:nical)? specs?|documentation|readmes?|thesis|manuscripts?|ebooks?|word documents?|case stud(?:y|ies)|research papers?|grant applications?|(?:weekly|monthly|quarterly|annual|executive|client|investor|board|written|polished|professional|formatted)(?: [a-z]+)? reports?"),
      first(WRITE, "reports?|documents?|docs|drafts?|contracts?|agreements?|minutes|decision records?|(?:content|product|project|executive) briefs?"),
      made(WRITE, "agreements?|board minutes|meeting minutes|minutes"),
      made(`${WRITE}|fill|fills|filling|merge|merges|merging|split|splits|splitting|sign|signs|signing|read|reads|reading|extract|extracts|extracting|highlight|highlighter|summarize|summarizes|translate|translates|translating|convert|converts|converting|annotate|annotates|compress|compresses|export|exports|exporting`, "pdfs?|pdf forms?|pdf documents?|pdf files?|docx|word documents?"),
    ],
    not: re("writing code|issue reports?|session usage|quality report|credit memos?|debit memos?|draft payables?|draft proposal|pending proposals?|update proposals?|failure report|what happened|signed document|file column|alerts|html report|html performance reports?|power bi|pbir|link in bio|performance reports?|traffic report|ads|campaigns|document vault|memos saved|signing pipeline|security awareness|via tools|or report|into an application|company brief|actually building|cross repo|footage brief|or resume|and resume|instantiate resume|job search|job openings|local file|dashboard|dashboards|job thesis|search documentation|upload documents|download files|smart contracts?|api contracts?|data contracts?|doc contract|contract tests?|contract testing|test reports?|bug reports?|crash reports?|coverage reports?|code review|resume session|resume work|resume the|pause resume|session resume|docs search|search docs|query docs|code samples|agents.md|claude.md|test plan|test writer|writing tests|write tests"),
  },
  slides: {
    name: re("slide|slides|[a-z]*pptx|ppt|odp|powerpoint|presentation|presentations|pitch deck|slide deck|deck|decks|keynote"),
    gated: [],
    head: re("slide decks?|pitch decks?|powerpoint pptx|opendocument presentation|google slides|reveal.js|revealjs|presentation decks?|keynote decks?"),
    made: [made(`${WRITE}|design|designs|designing|export|exports|exporting`, "slides|slide decks?|decks|deck|pitch decks?|presentations?|.?pptx|powerpoint|powerpoints|keynotes?|pitch books?")],
    not: re("presentation layer|presentation half|presentation logic|steam deck|deck.gl|deck gateway|kong|flight deck|sliding|slider|sliders|stream deck|rate deck|rate decks|study deck|clash royale|flashcards?|anki|carousels?|deck problem|chosen deck|templafy mcp|video frames|relevant frames|podcast|document slide deck|brand board|forecast change deck|email attachment"),
  },
  design: {
    name: re("figma|logo|logos|poster|posters|flyer|flyers|illustration|illustrations|wireframe|wireframes|mockup|mockups|typography|color palette|colour palette|palette|palettes|design system|design systems|design tokens|ui design|ux design|ui ux|frontend design|web design|graphic design|visual design|product design|landing page|landing pages|thumbnail|thumbnails|infographic|infographics|icon design|canva|shadcn|ui polish|motion design|brand identity|website builder|website generator"),
    gated: [
      [re("ux|design|designer"), new RegExp(`${VISUAL.source}| (?:ui|ux|usability|user flows?|prototypes?|product design|design directions?|design decisions?|masters? designers?) `)],
      [re("ui|frontend|front end|theme|themes|theming|css|tailwind|brand|branding|style|styles|visual|visuals|polish"), VISUAL],
      [re("animation|animations|motion|icon|icons|graphic|graphics|svg|banner|banners"), re("animation|animations|animate|transition|transitions|easing|motion graphic|motion graphics|icon|icons|illustration|graphic|graphics|logo|visual|visuals|banner|banners")],
    ],
    head: re("dark mode aesthetic|light mode aesthetic|design language|ui design|ux design|ui ux|interface design|visual design|graphic design|web design|frontend design|front end design|design systems?|design tokens|brand identity|visual identity|figma|color palettes?|colour palettes?|wireframes?|mockups?|motion graphics?|motion design"),
    made: [made(DESIGN_V, "logos?|posters?|flyers?|banners?|mockups?|wireframes?|illustrations?|infographics?|thumbnails?|icons?|icon sets?|brand kits?|color palettes?|colour palettes?|landing pages?|websites?|web pages?|graphics?|ad creatives?|artwork|visual art|visuals"),
      made("design|designs|designing|redesign|redesigns|redesigning", "uis?|user interfaces?|interfaces?|screens?|pages?")],
    not: re("pbir|godot|unity|playcanvas|glb|tmux|formation|embed sdk|visual review|visual filters?|visual novel|brand materials|sitrep|coordination file|development guidance|make collect|solid|design patterns|inheritance|workflow chain|figma setup|pine script|udl|api interface|video work|make model|connector tool|power bi|test doc|game analysis|localization|localize|identityserver|federation|analytics|telemetry|metrics|kpis?|codebase|module|modules|classroom|live preview|visual regressions?|regression testing|accessibility|a11y|ad copy|implementation plan|brand voice|website content|pcb|circuit|database|schema|api design|system design|software design|architecture|experimental design|experiment design|clinical|trial|tracking plan|org design|instructional design|curriculum|website copy|landing page copy|terminal|tui|tuis|cli|ratatui|policy|quality score|concept test|brainstorming|research design|proofread|test design|service design|chip|in app ui"),
  },
};
function strictStudios(name: string, description: string): StudioGuess {
  const n = fold(name.replace(/[-_]+/g, " ")), raw = description.replace(/\s+/g, " ").trim();
  const lead = fold(/^(.{25,280}?[.!?。])(?:\s|$)/.exec(raw)?.[1] ?? raw.slice(0, 280)), head = fold(raw.slice(0, 110)), d = fold(raw);
  const hits: Partial<Record<StudioKind, string>> = {}, scores = {} as Record<StudioKind, number>;
  for (const k of STUDIO_KINDS) {
    const r = STRICT[k];
    const why = r.not.test(n) || r.not.test(lead) ? null
      : r.name.exec(n)?.[0] ?? r.gated.find(([a, b]) => a.test(n) && b.test(lead))?.[0].exec(n)?.[0] ?? r.head.exec(head)?.[0] ?? r.made.map((m) => m.exec(lead)?.[0]).find(Boolean) ?? null;
    scores[k] = why ? 10 : 0;
    if (why) hits[k] = why.trim();
  }
  const studios = STUDIO_KINDS.filter((k) => hits[k]);
  return { studios, scores, why: studios.map((k) => `${k}: ${hits[k]}`).join("; ") };
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
