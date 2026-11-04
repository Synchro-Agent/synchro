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
// Danh mục có ~18.000 skill và không nhờ model xếp lại (mỗi skill một lượt gọi model là đốt gói của người dùng), nên kết quả của bộ luật là kết quả cuối.
// Chỉ đọc tên và mô tả (nội dung skill nhắc tới "pdf" hay "design" không nói lên gì), và chỉ tin phần đầu mô tả, nơi skill nói mình làm gì;
// danh sách kích hoạt ở cuối mô tả ("use when … slides, docs, reports") hay nhắc đủ thứ.
// Năm lớp cho mỗi mục: tên mang đúng sản phẩm; tên gợi ý và câu đầu xác nhận; đầu mô tả nói đúng sản phẩm; câu đầu có động từ làm ra + sản phẩm; từ khóa tiếng không dùng chữ Latin. Có cụm chặn thì bỏ cả mục.
// Các cụm chặn lấy từ việc đọc mẫu thật của danh mục: hợp đồng thông minh, báo cáo kiểm thử, "resume" nghĩa là chạy tiếp, deck gateway, thiết kế API / CSDL…
// Sửa bộ luật thì tăng CATALOG_RULES (skillstudio.ts) để danh mục được xếp lại.
const WRITE = "write|writes|writing|draft|drafts|drafting|generate|generates|generating|create|creates|creating|produce|produces|producing|compose|composes|composing|prepare|prepares|preparing|author|authors|authoring|build|builds|building|edit|edits|editing|revise|revises|revising|rewrite|rewrites|rewriting|polish|polishes|polishing|make|makes|making";
const PEN = "write|writes|writing|draft|drafts|drafting|compose|composes|composing|author|authors|authoring|edit|edits|editing|revise|revises|revising|rewrite|rewrites|rewriting";
const DRAFT = "draft|drafts|drafting";
const DESIGN_V = `${WRITE}|design|designs|designing|redesign|redesigns|redesigning|style|styles|styling`;
// Từ xen giữa động từ và sản phẩm: không vượt qua giới từ hay từ mở mệnh đề mới ("build tools for reports" không phải làm báo cáo).
const STOP = "from|into|to|for|with|of|in|on|by|via|using|about|against|over|through|that|which|when|if|while|because|after|before|across|per|at|as|delete|deletes|deleting|list|lists|listing";
const gap = (n: number) => `(?: (?!(?:${STOP}) )[a-z0-9.+#]+){0,${n}}?`;
const GAP = gap(5);
const re = (s: string) => new RegExp(` (?:${s}) `);
const made = (verbs: string, nouns: string) => new RegExp(` (?:${verbs})${GAP} (?:${nouns}) `);
const first = (verbs: string, nouns: string, g = GAP) => new RegExp(`^ (?:${verbs})${g} (?:${nouns}) `);
type Strict = { name: RegExp; gated: [RegExp, RegExp][]; head: RegExp; made: RegExp[]; raw: RegExp; not: RegExp };
const VISUAL = re("visual|visuals|layout|layouts|aesthetic|aesthetics|figma|typography|colors?|colours?|palette|palettes|styling|hierarchy|spacing|wireframes?|mockups?|design system|design tokens|theme tokens|dark mode|responsive design|fonts?|polish|look and feel|graphic|graphics|artwork|poster|posters");
// Tên có "css" hay "tailwind": chữ "css" trong mô tả chỉ lặp lại tên, không phải bằng chứng. Tên chỉ có "design": css là việc giao diện thật.
const VISUAL_CSS = new RegExp(`${VISUAL.source}| css `);
// Tiếng khác tiếng Anh, chữ Latin (fold đã bỏ dấu): danh mục có cả thư viện pháp lý tiếng Tây Ban Nha, Bồ Đào Nha.
const ROMANCE = "monta|prepara|preparar|elabora|elaborar|redacta|redactar|redige|redigir|rediger|redigez|genera|generar|gera|gerar|crea|crear|cria|criar|cree|escribe|escribir|escreve|escrever|erstellt|erstelle|schreibt|verfasst";
const VI_MAKE = "viet|soan|soan thao|lap|tao|lam";
const STRICT: Record<StudioKind, Strict> = {
  docs: {
    name: re("pdf|pdfs|docx|hwp|hwpx|word processing|spec writing|document review|review document|office documents|whitepaper|whitepapers|proposal|proposals|cover letter|cover letters|newsletter|newsletters|blog post|blog generator|blog generation|write doc|write docs|write documentation|write spec|write rfc|write prd|prd writing|readme|technical writing|legal writing|copy edit|copyedit|copy editing|proofread|proofreading|documentation|docs writer|article writer|draft article|edit article|write article|content writer|seo writer|copywriter|copywriting|contract review|review contract|press release|meeting notes|meeting minutes|research report|research reports|sop|sops|runbook|runbooks|postmortem|postmortems|post mortem|post mortems|release notes|internal comms|one pager|research paper|research papers|ux copy|ux writing|microcopy"),
    gated: [
      [re("resume|resumes|cv|cvs"), re("job|jobs|ats|career|hiring|recruiter|recruiters|cover letter|cv|cvs|candidate")],
      [re("report|reports"), made(WRITE, "reports?")],
      [re("memo|memos"), re("write|writes|draft|drafts|drafting|investment|decision|case|committee|privileged|structured|credit|board|counterparty")],
      [re("contract|contracts|agreement|agreements|nda|ndas"), re("contract among|legal|clause|clauses|redline|redlines|lawyer|attorney|counterparty|counterparties|negotiat[a-z]*|lease|leases|shareholders?|employment|vendor|terms and conditions|e signature|playbook|nda|ndas")],
      [re("docs|doc|document|documents"), made(WRITE, "docs?|documents?|documentation")],
      [re("writing|writer|write|prose|editorial|humanizer|deslop|editor"), re("prose|article|articles|essay|essays|blog|editorial|ai writing|ai generated writing|ai sounding|ai tells|human written|copy edit|manuscript|long form|nonfiction|fiction|narrative|tone of voice")],
      // Tên nhắc PRD / RFC chưa đủ: nhiều skill chỉ đọc PRD để lập kế hoạch hay tách việc.
      [re("prd|prds|rfc|rfcs"), /^(?!.* (?:manage|manages|manage prd|turn a prd|break a prd|decompose|from (?:a |an |the )?(?:prd|rfc)) )/],
      [re("changelog|changelogs"), new RegExp(`(?: ${WRITE}|update|updates|updating|maintain|maintains|maintaining)${gap(3)} (?:changelogs?(?! page)|release notes?) | markdown changelog | changelog generation `)],
      // Thư viện văn bản tố tụng: tên "…-draft" và mô tả mở đầu bằng "Draft".
      [/ draft $/, /^ drafts? /],
      [re("drafting"), re("pleading|pleadings|contract|contracts|clause|clauses|legal|skeleton|insolvency|filing|filings")],
    ],
    head: re("copyedit|microsoft word|google docs|whitepapers?|technical documentation|cover letters?|press releases?|meeting minutes|copyediting|copy editing|proofreading|proofread|internal communications"),
    made: [
      made(WRITE, "memos?|proposals?|whitepapers?|white papers?|essays?|articles?|blog posts?|blogs?|newsletters?|press releases?|resumes?(?! checkpoint)|cvs?|cover letters?|meeting notes|meeting minutes|handbooks?|user manuals?|user guides?|how to guides?|prep documents?|prep docs?|prds?|rfcs?|specifications?|tech(?:nical)? specs?|documentation|readmes?|thesis|manuscripts?|ebooks?|word documents?|case stud(?:y|ies)|research papers?|grant applications?|sops?|standard operating procedures?|runbooks?|postmortems?|post mortems?|release notes?|changelogs?|one pagers?|onepagers?|job descriptions?|lesson plans?|tutorials?(?! video)|(?:weekly|monthly|quarterly|annual|executive|client|investor|board|written|polished|professional|formatted|research|status|market|sector|industry|landscape|initiation|update|financial|diligence|analyst)(?: [a-z]+)? reports?"),
      first(WRITE, "(?<!(?:and|or) )reports?|documents?|docs|drafts?|contracts?|agreements?|deeds?|petitions?|letters?|minutes|decision records?"),
      made(WRITE, "(?:[a-z]+ )?briefs?(?! summar| overview| descri| note| expla| intro| messag| answer| respon| list| text| report)|briefings?"),
      made(WRITE, "agreements?|board minutes|meeting minutes|minutes"),
      made(WRITE, "(?:[a-z]+ )?guides?(?! you| the| users?| agents?)|(?:research|reaction|analyst|disclosure|study|briefing|investment|earnings) notes?|(?:executive|meeting|market|weekly|monthly|daily)(?: [a-z]+)? summar(?:y|ies)|market overview|(?:business|strategic|account|marketing|event|media|launch|content|sales|communications?)(?: [a-z]+)? plans?"),
      made(WRITE, "(?:feature |product |technical |design |full |approved )?specs?(?: documents?)?"),
      re("into (?:a |an )(?:full |approved |feature |product |technical )*specs?"),
      made(PEN, "speech|speeches|novels?|short stor(?:y|ies)|screenplays?|poems?|fiction|(?:website |landing page |ux |marketing |sales |product |interface |error |listing |ad |facing )copy|copy that|microcopy"),
      // Biên tập chữ, rà soát hợp đồng: sản phẩm là chính văn bản đó.
      made("rewrite|rewrites|rewriting|edit|edits|editing|cut|cuts|tighten|tightens|shorten|shortens|proofread|proofreads|humanize|humanizes", "text|prose|writing|ai tells"),
      made("review|reviews|reviewing|redline|redlines|redlining", "contracts?|agreements?|ndas?|msas?|clauses?|leases?"),
      made("write|writes|writing", "books?|chapters?"),
      // Văn bản tố tụng và văn bản chính thức: "Draft a Regular Bail Application", "Draft a Motor Accidents Claims Tribunal (MACT) claim petition".
      // Chỉ với động từ "draft": "build an application" hay "write a section" là chuyện khác.
      first(DRAFT, "applications?|appeals?|complaints?|suits?|plaints?|written statements?|notices?|counter notices?|reply to a show cause|pleadings?|petitions?|memorand(?:um|a)|litigations?|clauses?|sections?|summar(?:y|ies)|polic(?:y|ies)|written consents?|teasers?|status updates?|investor updates?|stakeholder updates?|power of attorney|last will|statements?|claims?|notifications?", gap(7)),
      new RegExp(` (?:${WRITE}|fill|fills|filling|merge|merges|merging|split|splits|splitting|sign|signs|signing|read|reads|reading|extract|extracts|extracting|highlight|highlighter|translate|translates|translating|convert|converts|converting|annotate|annotates|compress|compresses|export|exports|exporting)${gap(3)} (?:pdfs?|pdf forms?|pdf documents?|pdf files?|docx|word documents?) `),
      // Tây Ban Nha, Bồ Đào Nha, Pháp, Đức: "Redacta" và "Redige" luôn là viết văn bản; động từ chung thì cần đúng loại văn bản.
      re("redacta|redactar|redaccion|redige|redigir|rediger|redigez"),
      /^ (?:escritos?|demandas?|recursos?|solicitud|oposicion|impugnacion|querellas?|contestacion|alegaciones|denuncias?) (?:de|del|en|al|a|contra|ejecutiva|contencioso|administrativo) /,
      /^ catalogo sin plantilla /,
      first(ROMANCE, "en word|em word"),
      first(ROMANCE, "contratos?|contrats?|demandas?|escritos?|cartas?|lettres?|denuncias?|solicitud(?:es)?|acuerdos?|alegaciones|reclamacion(?:es)?|expedientes?|informes?|relatorios?|rapports?|berichte?|documentos?|dokumente?|vertrag|memos?|memorandos?|pareceres?|procedimentos?|actas?|atas?|respuesta a un borrador|respuesta de la empresa"),
      first("escribe|escribir|escreve|escrever|schreibt|verfasst", "articulos?|artigos?|procedimentos?|documentos?|cartas?|bericht|artikel"),
      // Tiếng Việt: "Soạn hợp đồng", "Viết báo cáo tuần".
      first(VI_MAKE, "bao cao|tai lieu|van ban|hop dong|bien ban|de xuat|cong van|don tu|thu moi|bai viet|so tay"),
    ],
    // Hàn, Nhật, Trung, Nga: fold bỏ hết chữ không phải Latin nên phải dò trên chữ gốc.
    raw: /한글 문서|보고서|계약서|제안서|기획서|회의록|원고|웹소설|산문|글을 쓴다|(?:ドキュメント|資料|文書|報告書|提案書|議事録|契約書|仕様書|記録)[^。]{0,60}(?:作成|生成|更新)|ドキュメントの独立|(?:起草|撰写|生成)[^。]{0,12}(?:文档|报告|合同|文章)|文章生成|成品文章|письмо|редактор|редактур|генератор текста|русского текста/,
    not: re("tla\\+|verify an rfc|unfinished work|lesson in|earnings press release|extraction spec|pilot spec|scaffold spec|receipts|decompose|github issues|also creates docs|for agents|vdm sl|test specs?|spec tests?|writing code|issue reports?|session usage|quality report|debit memos?|draft payables?|draft proposal|pending proposals?|update proposals?|failure report|report of what happened|signed document|file column|workspace alerts|html report|html performance reports?|power bi|pbir|link in bio|performance reports?|traffic report|ads|ad reports?|ad campaigns?|document vault|memos saved|signing pipeline|security awareness|via tools|synchronize or report|into an application|company brief|actually building|cross repo|footage brief|pause or resume|coordinate or resume|and resume|instantiate resume|job search|job openings|local file|dashboard|dashboards|job thesis|search documentation|upload documents|download files|smart contracts?|api contracts?|data contracts?|doc contract|contract tests?|contract testing|test reports?|bug reports?|crash reports?|coverage reports?|code review|resume session|resume work|resume the (?:session|task|work|run|plan|interrupted|previous|last)|session resume|docs search|search docs|query docs|code samples|agents.md|(?<!legal )claude.md|create test plan|write test plan|test writer|writing tests|write tests|document and maintain|fact checking|fact check|erp|cap table report|consolidating p l|report metadata|report type|openapi|swagger|yaml change brief|ad creatives?|prompt contracts?|a prompt|code prompt|(?<!long )form drafts?|agent ready briefs?|dispatch briefs?|coding worker|context brief|find browse|agent roles|cognitive briefing|bump version|next semver|jira ticket|next agent|.?memory folder|wireframe style|row level|security clauses|groq|skill authoring|amplitude|steering documents?|webhook|ragops|crm invoices|email drafts?|topic brief|architectural decisions|http contracts?|rpc contracts?|repository contract|implement or review"),
  },
  slides: {
    name: re("slide|slides|[a-z]*pptx|ppt|odp|powerpoint|presentation|presentations|pitch deck|slide deck|deck|decks|keynote"),
    gated: [[re("pitch|pitches"), re("deck|decks|slides|presentation|presentations")]],
    head: re("slide decks?|pitch decks?|powerpoint pptx|opendocument presentation|google slides|reveal.js|revealjs|presentation decks?|keynote decks?|bai thuyet trinh|trinh chieu"),
    made: [made(`${WRITE}|design|designs|designing|export|exports|exporting`, "slides|slide decks?|decks|deck|pitch decks?|presentations?|.?pptx|powerpoint|powerpoints|keynotes?|pitch books?"),
      re("into (?:[a-z0-9]+ ){0,5}(?:presentations?|slide decks?|powerpoints?|pitch decks?)|speaker scripts?"),
      first(ROMANCE, "presentacion(?:es)?|apresentac(?:ao|oes)|diapositivas?|praesentation(?:en)?|slides?"),
      first(VI_MAKE, "slide|trang chieu|bai thuyet trinh|thuyet trinh")],
    raw: /スライド|プレゼン|슬라이드|프레젠테이션|(?:制作|生成)[^。]{0,12}(?:幻灯片|演示文稿)|презентаци/,
    not: re("presentation layer|presentation half|presentation logic|steam deck|deck.gl|deck gateway|kong|flight deck|sliding|slider|sliders|stream deck|rate deck|rate decks|study deck|clash royale|flashcards?|anki|carousels?|deck problem|chosen deck|templafy mcp|video frames|relevant frames|podcast|document slide deck|brand board|forecast change deck|email attachment|card game|deckbuilder"),
  },
  design: {
    name: re("design engineering|interface guidelines|figma|logo|logos|poster|posters|flyer|flyers|illustration|illustrations|wireframe|wireframes|mockup|mockups|typography|color palette|colour palette|palette|palettes|design system|design systems|design tokens|ui design|ux design|ui ux|frontend design|web design|graphic design|visual design|product design|landing page|landing pages|thumbnail|thumbnails|infographic|infographics|icon design|canva|shadcn|ui polish|motion design|brand identity|website builder|website generator|image generation|image generator|generate image|edit image|image editor|ai image|image ads?|algorithmic art|generative art"),
    gated: [
      [re("ux|design|designer"), new RegExp(`${VISUAL_CSS.source}| (?:ui|ux|usability|user flows?|prototypes?|product design|design directions?|design decisions?|masters? designers?) `)],
      [re("ui|frontend|front end|theme|themes|theming|css|tailwind|brand|branding|style|styles|visual|visuals|polish"), VISUAL],
      [re("ui|ux"), re("usability|responsiveness|ui slop|generic ui|generic it looks|ai default|ai defaults|beautiful|marketing pages|ui component|ui inspiration|ui critique|interface ux|interface s|an interface|an interface s|accessible interfaces|empty states?|first run setup|task blocking|one existing page")],
      [re("brand|branding"), re("brand kit|brand board|identity systems?|brand look|visual principles")],
      [re("animation|animations|motion|icon|icons|graphic|graphics|svg|banner|banners"), re("animation|animations|animate|transition|transitions|easing|motion graphic|motion graphics|icon|icons|illustration|graphic|graphics|logo|visual|visuals|banner|banners|branded")],
      [re("gif|gifs"), re("gif|gifs")],
    ],
    head: re("dark mode aesthetic|light mode aesthetic|design language|ui design|ux design|ui ux|interface design|visual design|graphic design|web design|frontend design|front end design|design systems?|design tokens|brand identity|visual identity|figma|color palettes?|colour palettes?|wireframes?|mockups?|motion graphics?|motion design|usability evaluation|taste audit|image generation|image editing|text to image|web animations?|algorithmic art|generative art|thiet ke giao dien|do hoa"),
    made: [made(DESIGN_V, "logos?|posters?|flyers?|banners?|mockups?|wireframes?|illustrations?|infographics?|thumbnails?|icons?|icon sets?|brand kits?|color palettes?|colour palettes?|landing pages?|websites?|web pages?|graphics?|ad creatives?|artwork|visual art|visuals"),
      made("design|designs|designing|redesign|redesigns|redesigning", "uis?|user interfaces?|interfaces?|screens?|pages?"),
      new RegExp(` (?:build|builds|building|migrates?|make|makes|making)${gap(3)} (?:[a-z]+ )?interfaces? `),
      // STUDIO_SYSTEM xếp ảnh marketing và minh họa vào Thiết kế: skill tạo, sửa ảnh thuộc mục này.
      made("generate|generates|generating|create|creates|creating|edit|edits|editing|make|makes|making|retouch|retouches|retouching", "images?|pictures?"),
      new RegExp(` (?:build|builds|building|create|creates|creating|generate|generates|generating)${gap(3)} (?:uis?|user interfaces?|ui components?|app screens?) `),
      first(`${ROMANCE}|disena|disenar|desenha`, "logotipos?|logos?|carteles?|disenos?|interfaces?"),
      first(VI_MAKE, "logo|poster|banner|giao dien|do hoa|anh minh hoa")],
    raw: /デザイン|디자인|дизайн|UI\/UX|画面設計|视觉设计|界面设计|UI设计|サイト制作/,
    not: re("api and interface|hub page|one engagement|ragops|pbir|godot|unity|playcanvas|glb|tmux|formation|embed sdk|visual review|visual filters?|visual novel|brand materials|sitrep|coordination file|development guidance|make collect|solid|(?<!default )design patterns|inheritance|workflow chain|figma setup|pine script|udl|api interface|video work|make model|connector tool|power bi|test doc|game analysis|json localization|localize|identityserver|federation|analytics|telemetry|player metrics|kpis? tree|codebase design|module|modules|classroom|live preview|visual regressions?|regression testing|a11y|web accessibility|ad copy|implementation plan|brand voice|website content|pcb|circuit|database|api design|system design|software design|(?<!information |design system |navigation |the )architectures?|experimental design|experiment design|clinical|trial|tracking plan|org design|instructional design|curriculum|website copy|landing page copy|terminal|tui|tuis|cli ui|cli design|ratatui|policy|quality score|concept test|brainstorming|research design|proofread|test design|service design|chip|in app ui|magento|coding standards|flutter widget|mcp apps?|docker|container images?|vm images?|disk images?|base images?|os images?|test plan|generate api|groq|ffmpeg|ocr|searchable|troubleshoot|barcode|facing copy|flutter ui|gradio|hotwire|polaris|fiftyone|expo ui|(?:cli|api|sdk|graphql|command line|programming|rpc|query|chat) interfaces?"),
  },
};
function strictStudios(name: string, description: string): StudioGuess {
  // Dấu chấm cuối câu không dính vào từ cuối (fold giữ dấu chấm cho "reveal.js").
  const words = (t: string) => fold(t).replace(/\. /g, " ");
  const n = words(name.replace(/[-_]+/g, " ")), raw = description.replace(/\s+/g, " ").trim();
  const sentence = /^(.{25,280}?[.!?。])(?:\s|$)/.exec(raw)?.[1] ?? raw.slice(0, 280);
  const lead = words(sentence), head = words(raw.slice(0, 110));
  // Từ ghép có gạch nối ("self-contained", "writer-ready") và sở hữu cách ("a publication's") chỉ là một từ khi đo khoảng cách động từ - sản phẩm.
  // Vẫn thử bản tách rời: sản phẩm có thể có gạch nối ("slide-deck").
  const flat = words(sentence.replace(/([\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "$1").replace(/(\p{L})['’]s\b/gu, "$1"));
  const hits: Partial<Record<StudioKind, string>> = {}, scores = {} as Record<StudioKind, number>;
  for (const k of STUDIO_KINDS) {
    const r = STRICT[k];
    const why = r.not.test(n) || r.not.test(lead) ? null
      : r.name.exec(n)?.[0] ?? r.gated.find(([a, b]) => a.test(n) && b.test(lead))?.[0].exec(n)?.[0] ?? r.head.exec(head)?.[0] ?? r.made.map((m) => m.exec(lead)?.[0] ?? m.exec(flat)?.[0]).find(Boolean) ?? r.raw.exec(sentence)?.[0] ?? null;
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
