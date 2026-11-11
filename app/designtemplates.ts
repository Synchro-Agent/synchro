// Mẫu điền sẵn (Schema-to-Component): model không viết HTML/CSS, chỉ viết một khối JSON trong trang text/html
//   <script type="application/json" data-sx-template>{"styleArchetype":"midnight-tech","pages":[{"templateId":"slide-fact","props":{…}}]}</script>
// Synchro dựng khối đó thành HTML dùng bộ thiết kế (artkit.ts) ngay khi tách artifact khỏi câu trả lời (artifacts.ts, vfs.ts), nên khung xem trước, trình chiếu,
// xuất PDF / PowerPoint / PNG, check_artifact, Chỉ và sửa đều làm việc trên HTML đã dựng như mọi artifact khác. Đang stream: các trang đã đủ JSON hiện dần.
// Mỗi ô chữ có data-node-id (trang.trường): tầng tự vá co chữ, đổi màu chữ theo ô (FIT_JS trong artkit.ts). Bố cục dựng lại theo ý của các bố cục
// trang bìa, con số, trích dẫn, chuyển chương (Slidev theme-apple-basic, MIT) và hai cột, chữ trái ảnh phải (Slidev theme-seriph, MIT), viết mới bằng lớp của Synchro, không chép mã.
// Tên mẫu trung tính; mã theo bảng của chủ dự án (slide-apple-fact…) nhận như tên khác của cùng mẫu, không hiện ra giao diện.
// Tệp thuần, dùng chung cho trình duyệt và máy chủ; kiểm thử: tests/api/designtemplates.test.mjs.
import { DEFAULT_PRESET, presetId, presetOf } from "./designpresets";
import { DOC_ALIASES, DOC_TEMPLATES } from "./designdocs";
import { EMAIL_ALIASES, EMAIL_TEMPLATES } from "./designemails";
import { bullets, esc, nid, obj, paras, rich, safeUrl, str, u, type Ctx, type Props } from "./tplkit";

export type TplPage = { templateId: string; props: Props; morphId?: string; pageId?: string };
type Kind = "slide" | "poster" | "doc" | "email";
type Tpl = { kind: Kind; render: (p: Props, c: Ctx, page: TplPage) => string };

const morph = (page: TplPage, p: Props) => { const m = str(page.morphId ?? p.morphId, 60).trim(); return m ? ` data-pptx-object-name="${esc(m.startsWith("!!") ? m : `!!${m}`)}"` : ""; };
const sec = (cls: string, id: string, inner: string, extra = "") => `<section class="slide sx-slide sx-tpl ${cls}" data-sx-template="${id}"${extra}>${inner}</section>`;
// Tầng tiêu đề 3 bậc: nhãn → tiêu đề kết luận → kicker.
const head = (p: Props, c: Ctx, titleKey = "title") => `<header class="sx-stack sx-gap-8">${str(p.eyebrow) ? `<p class="sx-eyebrow" ${nid(c, "eyebrow")}>${rich(p.eyebrow, 80)}</p>` : ""}<h2 class="sx-title" ${nid(c, titleKey)}>${rich(p[titleKey], 320)}</h2>${str(p.kicker) ? `<p class="sx-kicker" ${nid(c, "kicker")}>${rich(p.kicker, 400)}</p>` : ""}</header>`;
const img = (src: string, cls: string, alt: unknown) => (src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(str(alt, 160))}">` : "");
const body = (p: Props, c: Ctx, key = "body") => `${paras(p[key], c, key)}${bullets(p.bullets, c, "bullets")}`;

const SLIDES: Record<string, Tpl["render"]> = {
  "slide-cover": (p, c, pg) => sec("sx-tpl-cover sx-aurora", "slide-cover", `${img(safeUrl(p.image), "sx-tpl-cover-img", p.title)}
<div class="sx-stack sx-gap-24 sx-tpl-cover-copy"${morph(pg, p)}>${str(p.badge) ? `<span class="sx-badge" ${nid(c, "badge")}>${rich(p.badge, 60)}</span>` : ""}<h1 class="sx-display" ${nid(c, "title")}>${rich(p.title, 320)}</h1>${str(p.subtitle) ? `<p class="sx-kicker sx-tpl-lead" ${nid(c, "subtitle")}>${rich(p.subtitle, 400)}</p>` : ""}</div>
<footer class="sx-tpl-foot">${str(p.author) ? `<span ${nid(c, "author")}>${rich(p.author, 120)}</span>` : ""}${str(p.date) ? `<span ${nid(c, "date")}>${rich(p.date, 60)}</span>` : ""}</footer>`),
  "slide-fact": (p, c, pg) => sec("sx-tpl-fact", "slide-fact", `${str(p.eyebrow) ? `<p class="sx-eyebrow" ${nid(c, "eyebrow")}>${rich(p.eyebrow, 80)}</p>` : ""}
<p class="sx-kpi sx-tpl-fact-num${p.gradient === false ? "" : " sx-gradient-text"}" ${nid(c, "bigMetric")}${morph(pg, p)}>${esc(str(p.bigMetric, 40))}</p>
${str(p.description) ? `<p class="sx-kicker sx-tpl-lead" ${nid(c, "description")}>${rich(p.description, 400)}</p>` : ""}${str(p.source) ? `<p class="sx-source sx-tpl-src" ${nid(c, "source")}>${rich(p.source, 160)}</p>` : ""}`),
  "slide-quote": (p, c) => sec("sx-tpl-quote", "slide-quote", `<span class="sx-tpl-qmark" aria-hidden="true">“</span><blockquote class="sx-tpl-qtext" ${nid(c, "quote")}>${rich(p.quote, 600)}</blockquote>
<footer class="sx-stack sx-gap-8">${str(p.author) ? `<p class="sx-h3" ${nid(c, "author")}>${rich(p.author, 100)}</p>` : ""}${str(p.role) ? `<p class="sx-small" ${nid(c, "role")}>${rich(p.role, 140)}</p>` : ""}</footer>`),
  "slide-section": (p, c) => sec("sx-tpl-section", "slide-section", `${str(p.number) ? `<p class="sx-tpl-secnum" ${nid(c, "number")}>${esc(str(p.number, 12))}</p>` : ""}<h2 class="sx-display" ${nid(c, "title")}>${rich(p.title, 120)}</h2>${str(p.subtitle) ? `<p class="sx-kicker sx-tpl-lead" ${nid(c, "subtitle")}>${rich(p.subtitle, 200)}</p>` : ""}`),
  "slide-two-cols": (p, c) => {
    const col = (k: "left" | "right") => { const o = obj(p[k]), cc = { id: `${c.id}.${k}` }; return `<div class="sx-stack sx-gap-16 sx-tpl-col" data-sx-box>${str(o.heading) ? `<h3 class="sx-h2" ${nid(cc, "heading")}>${rich(o.heading, 120)}</h3>` : ""}${body(o, cc)}</div>`; };
    return sec("sx-tpl-cols", "slide-two-cols", `${head(p, c)}<div class="sx-tpl-cols-grid sx-grow">${col("left")}${col("right")}</div>${str(p.source) ? `<p class="sx-source" ${nid(c, "source")}>${rich(p.source, 160)}</p>` : ""}`);
  },
  "slide-image-right": (p, c, pg) => {
    const src = safeUrl(p.image);
    return sec("sx-tpl-imgr", "slide-image-right", `<div class="sx-tpl-imgr-text" data-sx-box>${head(p, c)}<div class="sx-stack sx-gap-16">${body(p, c)}</div>${str(p.source) ? `<p class="sx-source sx-end" ${nid(c, "source")}>${rich(p.source, 160)}</p>` : ""}</div>
<figure class="sx-tpl-imgr-fig${src ? "" : " sx-aurora"}"${morph(pg, p)}>${img(src, "sx-tpl-imgr-img", p.imageAlt ?? p.title)}${str(p.caption) ? `<figcaption class="sx-source" ${nid(c, "caption")}>${rich(p.caption, 160)}</figcaption>` : ""}</figure>`);
  },
  // Chữ lồng sau vật thể: ảnh nền tối dần (lớp 1) → chữ khổng lồ (lớp 2) → ảnh chủ thể đã tách nền đè lên chữ (lớp 4). Không có ảnh tách nền thì chữ nằm trên ảnh;
  // không có ảnh nào thì nền cực quang tối. Chữ khổng lồ giữ trong ảnh nền khi xuất PowerPoint (data-pptx-flat), không thì hộp chữ nổi lên trên chủ thể.
  "slide-depth-hero": (p, c, pg) => {
    const bg = safeUrl(p.image), cut = safeUrl(p.cutout);
    return sec(`sx-tpl-depth${cut ? " has-cut" : ""}${bg ? "" : " sx-tpl-depth-plain"}`, "slide-depth-hero", `${img(bg, "sx-tpl-depth-bg", p.imageQuery ?? p.subtitle)}
<p class="sx-tpl-depth-giant" ${nid(c, "giantBehindText")} data-sx-fit${cut ? " data-pptx-flat" : ""}>${esc(str(p.giantBehindText ?? p.giantText, 24))}</p>
<i class="sx-tpl-depth-veil" aria-hidden="true"></i>${cut ? `<img class="sx-tpl-depth-cut" src="${esc(cut)}" alt="${esc(str(p.imageQuery ?? "", 120))}"${morph(pg, p)}>` : ""}
<div class="sx-tpl-depth-copy sx-stack sx-gap-8">${str(p.eyebrow) ? `<p class="sx-eyebrow" ${nid(c, "eyebrow")}>${rich(p.eyebrow, 80)}</p>` : ""}${str(p.subtitle) ? `<p class="sx-tpl-depth-sub" ${nid(c, "subtitle")}>${rich(p.subtitle, 200)}</p>` : ""}</div>`, ` data-sx-depth`);
  },
  "slide-bento-3": (p, c, pg) => {
    const h = obj(p.heroCard), t = obj(p.sideCardTop), b = obj(p.sideCardBottom), hc = { id: `${c.id}.heroCard` };
    const side = (o: Props, k: string) => { const cc = { id: `${c.id}.${k}` }; return `<div class="sx-card sx-tpl-side">${str(o.title) ? `<h3 class="sx-h3" ${nid(cc, "title")}>${rich(o.title, 100)}</h3>` : ""}${str(o.metric) ? `<p class="sx-tpl-side-num sx-num" ${nid(cc, "metric")}>${esc(str(o.metric, 24))}</p>` : ""}${str(o.bullet) ? `<p class="sx-text sx-muted" ${nid(cc, "bullet")}>${rich(o.bullet, 400)}</p>` : ""}</div>`; };
    return sec("sx-tpl-bento", "slide-bento-3", `${head(p, c, str(p.actionTitle) ? "actionTitle" : "title")}<div class="sx-grid-hero sx-grow">
<div class="sx-card sx-tpl-herocard"${morph(pg, p)}>${str(h.title) ? `<h3 class="sx-h3" ${nid(hc, "title")}>${rich(h.title, 100)}</h3>` : ""}<p class="sx-kpi sx-tpl-hero-num" ${nid(hc, "metric")}>${esc(str(h.metric, 24))}</p>${str(h.detail) ? `<p class="sx-text" ${nid(hc, "detail")}>${rich(h.detail, 500)}</p>` : ""}</div>
${side(t, "sideCardTop")}${side(b, "sideCardBottom")}</div>${str(p.source) ? `<p class="sx-source" ${nid(c, "source")}>${rich(p.source, 160)}</p>` : ""}`);
  },
};

// Tên khác của cùng mẫu: mã trong bảng của chủ dự án và vài cách gọi hay gặp.
export const TEMPLATE_ALIASES: Record<string, string> = {
  "slide-apple-intro": "slide-cover", "slide-intro": "slide-cover", "slide-apple-fact": "slide-fact", "slide-apple-quote": "slide-quote", "slide-apple-section": "slide-section",
  "slide-seriph-two-cols": "slide-two-cols", "slide-two-columns": "slide-two-cols", "slide-seriph-image-right": "slide-image-right", "slide-depth": "slide-depth-hero", "slide-bento": "slide-bento-3",
};
const REGISTRY: Record<string, Tpl> = Object.fromEntries(Object.entries(SLIDES).map(([k, render]) => [k, { kind: "slide" as Kind, render }]));
/** Cho các mô-đun mẫu khác (thư, tài liệu, poster, biểu đồ) gắn vào cùng sổ đăng ký. */
export function registerTemplates(kind: Kind, list: Record<string, Tpl["render"]>, aliases: Record<string, string> = {}) {
  for (const [k, render] of Object.entries(list)) REGISTRY[k] = { kind, render };
  Object.assign(TEMPLATE_ALIASES, aliases);
}
registerTemplates("email", EMAIL_TEMPLATES, EMAIL_ALIASES);
registerTemplates("doc", DOC_TEMPLATES, DOC_ALIASES);
export const templateId = (id: string) => TEMPLATE_ALIASES[id] ?? id;
export const templateOf = (id: string) => REGISTRY[templateId(id)];
export const templateIds = (kind?: Kind) => Object.keys(REGISTRY).filter((k) => !kind || REGISTRY[k].kind === kind);

// ---------------------------------------------------------------- đọc khối JSON (cả khi đang stream)
/** Chỉ số kết thúc của từng phần tử trọn vẹn trong mảng bắt đầu ở start (chỉ số dấu "["). */
function completeItems(s: string, start: number): number[] {
  const ends: number[] = [];
  let depth = 0, inStr = false, escp = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (escp) escp = false; else if (ch === "\\") escp = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 1 && ch === "}") ends.push(i); if (depth === 0) break; }
  }
  return ends;
}
export type TplSpec = { style: string; pages: TplPage[]; partial: boolean };
const toPage = (x: unknown): TplPage | null => {
  const o = obj(x), id = str(o.templateId ?? obj(o.layout).templateId, 60);
  if (!id) return null;
  const props = obj(o.props ?? obj(o.layout).props);
  return { templateId: id, props, morphId: str(o.morphId ?? props.morphId, 60) || undefined, pageId: str(o.pageId, 40) || undefined };
};
/** JSON của khối mẫu: đối tượng {styleArchetype, pages}, mảng trang, hoặc một trang. JSON chưa trọn (đang stream) thì lấy các trang đã đủ. */
export function parseSpec(body: string): TplSpec | null {
  const t = body.trim().replace(/^<!--|-->$/g, "").trim();
  if (!t) return null;
  const style = /"styleArchetype"\s*:\s*"([\w-]{1,40})"/.exec(t)?.[1] ?? /"style"\s*:\s*"([\w-]{1,40})"/.exec(t)?.[1] ?? "";
  try {
    const j = JSON.parse(t) as unknown;
    const list = Array.isArray(j) ? j : Array.isArray(obj(j).pages) ? (obj(j).pages as unknown[]) : [j];
    return { style, pages: list.slice(0, 60).map(toPage).filter((x): x is TplPage => !!x), partial: false };
  } catch {
    const at = /"pages"\s*:\s*\[/.exec(t);
    const start = at ? at.index + at[0].length - 1 : t.startsWith("[") ? 0 : -1;
    if (start < 0) return { style, pages: [], partial: true };
    const ends = completeItems(t, start);
    if (!ends.length) return { style, pages: [], partial: true };
    try { return { style, pages: (JSON.parse(`${t.slice(start, ends[ends.length - 1] + 1)}]`) as unknown[]).slice(0, 60).map(toPage).filter((x): x is TplPage => !!x), partial: true }; } catch { return { style, pages: [], partial: true }; }
  }
}

const OPEN_RE = /<script\b(?=[^>]*\bdata-sx-template\b)[^>]*>/gi;
/** Các khối mẫu: [đầu, cuối, thân]. Thẻ đóng là </script> đầu tiên NGOÀI chuỗi JSON: chữ "</script>" trong một trường không cắt khối giữa chừng. */
function blocks(s: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN_RE.exec(s))) {
    const from = m.index + m[0].length;
    let i = from, inStr = false, escp = false, end = s.length, close = s.length;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (escp) escp = false; else if (ch === "\\") escp = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "<" && /^<\/script\s*>/i.test(s.slice(i, i + 12))) { end = i; close = i + (/^<\/script\s*>/i.exec(s.slice(i, i + 12))![0].length); break; }
    }
    out.push([m.index, close, s.slice(from, end)]);
    OPEN_RE.lastIndex = close;
  }
  return out;
}
export const hasTemplates = (content: string) => /<script\b[^>]*\bdata-sx-template\b/i.test(content);
const missing = (id: string) => `<!-- Synchro: không có mẫu "${esc(id)}" -->`;
/** Dựng một trang theo mẫu. Mẫu không có thì để lại chú thích (không vỡ trang). */
export function renderPage(page: TplPage, i: number): string {
  const t = templateOf(page.templateId);
  if (!t) return missing(page.templateId);
  try { return t.render(page.props, { id: page.pageId ? page.pageId.replace(/[^\w-]/g, "") || `p${i + 1}` : `p${i + 1}` }, page); } catch { return missing(page.templateId); }
}
// Phong cách mặc định khi model không nêu: poster và chữ lồng sau vật thể vốn là nền tối; mỗi mẫu tài liệu có phong cách hợp với nó.
const DOC_STYLE: Record<string, string> = { "doc-report": "exec-navy", "doc-proposal": "editorial-serif", "doc-paper": "swiss-grid", "doc-invoice": "swiss-grid" };
const defaultStyle = (pages: TplPage[]) => {
  const ids = pages.map((p) => templateId(p.templateId));
  return ids.some((id) => /^(?:poster-|slide-depth)/.test(id)) ? "midnight-tech" : ids.map((id) => DOC_STYLE[id]).find(Boolean) ?? DEFAULT_PRESET;
};

/**
 * Thay mọi khối <script data-sx-template> bằng HTML đã dựng. Trang không có khối nào giữ nguyên từng byte.
 * Có mẫu thư (email-…): kết quả là cả một thư HTML độc lập (bảng, style nội dòng), không dùng bộ CSS.
 * Trang chưa có data-sx-preset thì gắn phong cách của khối (styleArchetype) vào thẻ <html>, chưa có thẻ <html> thì bọc trang.
 */
export function expandTemplates(content: string): string {
  if (!hasTemplates(content)) return content;
  let style = "", all: TplPage[] = [];
  let out = "", pos = 0;
  for (const [a, b, body] of blocks(content)) {
    const spec = parseSpec(body);
    out += content.slice(pos, a);
    pos = b;
    if (!spec) { out += content.slice(a, b); continue; }
    style ||= spec.style;
    const offset = all.length;
    all = all.concat(spec.pages);
    out += spec.pages.map((p, k) => (templateOf(p.templateId)?.kind === "email" ? "" : renderPage(p, offset + k))).join("\n");
  }
  out += content.slice(pos);
  const preset = presetOf(style) ? presetId(style) : defaultStyle(all);
  const mail = all.find((p) => templateOf(p.templateId)?.kind === "email");
  if (mail) return renderPage({ ...mail, props: { ...mail.props, _style: preset } }, 0);
  if (/data-sx-preset=/.test(out)) return out;
  if (/<html\b/i.test(out)) return out.replace(/<html\b/i, `<html data-sx-preset="${preset}"`);
  return `<!doctype html><html lang="vi" data-sx-preset="${preset}"><head><meta charset="utf-8"></head><body>${out}</body></html>`;
}

// ---------------------------------------------------------------- CSS của các mẫu (ghép vào bộ CSS của artkit.ts)
export const SLIDE_TPL_CSS = `.sx-tpl-list{margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:${u(10)}}
.sx-tpl-lead{font-size:${u(26)};line-height:1.4;max-width:${u(900)}}
.sx-tpl-cover{justify-content:flex-end;position:relative;isolation:isolate}.sx-tpl-cover .sx-display{max-width:${u(1040)}}
.sx-tpl-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.16;z-index:-1}
.sx-tpl-foot{display:flex;flex-wrap:wrap;gap:${u(32)};font-size:${u(16)};line-height:1.4;color:var(--sx-muted);border-top:${u(1)} solid var(--sx-line);padding-top:${u(16)}}
.sx-tpl-fact{align-items:center;justify-content:center;text-align:center;gap:${u(20)}}
.sx-tpl-fact-num{font-size:${u(168)};line-height:1.1;letter-spacing:-.035em}.sx-tpl-src{position:absolute;bottom:${u(40)};left:0;right:0}.sx-tpl-fact{position:relative}
.sx-tpl-quote{justify-content:center;padding-inline:${u(128)};gap:${u(32)}}
.sx-tpl-qmark{font-family:var(--sx-head);font-size:${u(160)};line-height:.7;height:${u(72)};color:var(--sx-vivid);font-weight:800}
.sx-tpl-qtext{margin:0;font-family:var(--sx-head);font-size:${u(44)};font-weight:600;line-height:var(--sx-lh,1.25);letter-spacing:-.015em;text-wrap:balance}
.sx-tpl-section{background:var(--sx-ink);color:var(--sx-bg);justify-content:center;gap:${u(20)}}
.sx-tpl-section .sx-kicker{color:color-mix(in oklab,var(--sx-bg) 78%,var(--sx-ink))}
.sx-tpl-secnum{margin:0;font-family:var(--sx-mono);font-size:${u(20)};font-weight:600;letter-spacing:.1em;color:color-mix(in oklab,var(--sx-bg) 70%,var(--sx-ink))}
.sx-tpl-cols-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${u(64)};min-height:0}
.sx-tpl-col{min-height:0;overflow:hidden}.sx-tpl-col+.sx-tpl-col{border-left:${u(1)} solid var(--sx-line);padding-left:${u(64)};margin-left:${u(-32)}}
.sx-tpl-imgr{padding:0;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:0}
.sx-tpl-imgr-text{padding:${u(56)} ${u(48)} ${u(56)} ${u(64)};display:flex;flex-direction:column;justify-content:center;gap:${u(24)};min-height:0;overflow:hidden}
.sx-tpl-imgr-fig{margin:0;position:relative;min-height:0;overflow:hidden;background-color:var(--sx-raised)}
.sx-tpl-imgr-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sx-tpl-imgr-fig figcaption{position:absolute;left:${u(24)};bottom:${u(20)};right:${u(24)};padding:${u(6)} ${u(10)};background:var(--sx-surface);width:fit-content;border-radius:${u("var(--sx-ri)")}}
.sx-tpl-depth{padding:0;position:relative;isolation:isolate;justify-content:flex-end;background-color:#0B0B10;color:#F8FAFC}
.sx-tpl-depth-plain{background-image:radial-gradient(at 20% 20%,color-mix(in oklab,var(--sx-vivid) 45%,transparent) 0,transparent 55%),radial-gradient(at 80% 75%,color-mix(in oklab,var(--sx-vivid2) 35%,transparent) 0,transparent 55%)}
.sx-tpl-depth-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.55) saturate(1.05);z-index:1}
.sx-tpl-depth-giant{position:absolute;left:0;right:0;top:50%;transform:translateY(-62%);margin:0;text-align:center;white-space:nowrap;font-family:var(--sx-head);font-weight:800;font-size:${u(176)};line-height:1.15;letter-spacing:-.03em;text-transform:uppercase;color:#F8FAFC;z-index:2}
.sx-tpl-depth-veil{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.62));z-index:3}
.sx-tpl-depth-cut{position:absolute;left:50%;bottom:0;transform:translateX(-50%);height:90%;width:auto;max-width:72%;object-fit:contain;z-index:4;filter:drop-shadow(0 ${u(25)} ${u(35)} rgba(0,0,0,.65))}
.sx-tpl-depth-copy{position:relative;z-index:5;padding:0 ${u(64)} ${u(56)};max-width:${u(820)}}
.sx-tpl-depth.has-cut{justify-content:flex-start}.sx-tpl-depth.has-cut .sx-tpl-depth-copy{padding:${u(56)} ${u(64)} 0;max-width:${u(560)}}.sx-tpl-depth.has-cut .sx-tpl-depth-veil{top:0;bottom:auto;height:40%;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,0))}
.sx-tpl-depth .sx-eyebrow{color:#F8FAFC;opacity:.86}.sx-tpl-depth-sub{margin:0;font-size:${u(26)};line-height:1.4;color:#E2E8F0;text-wrap:pretty}
.sx-tpl-herocard{background:var(--sx-surface);background:color-mix(in oklab,var(--sx-vivid) 9%,var(--sx-surface));justify-content:space-between;gap:${u(12)}}
.sx-tpl-hero-num{font-size:${u(112)};line-height:1.1}.sx-tpl-side{justify-content:center;gap:${u(10)}}
.sx-tpl-side-num{margin:0;font-family:var(--sx-head);font-size:${u(44)};font-weight:800;line-height:1.15;letter-spacing:-.02em}`;

// ---------------------------------------------------------------- hợp đồng mẫu gửi model (chỉ của định dạng lượt này)
export const SLIDE_TPL_GUIDE = `Mẫu điền sẵn (nên dùng: nhanh, không vỡ khung, xuất PowerPoint giữ chữ sửa được): trong trang text/html chỉ cần <script type="application/json" data-sx-template>{"styleArchetype":"<phong cách>","pages":[{"templateId":"…","props":{…}},…]}</script>, Synchro tự dựng slide; trộn được với <section class="slide sx-slide"> tự viết cho trang không có mẫu. Chữ thường, **chữ** để nhấn, \\n xuống dòng; không viết HTML trong props.
slide-cover {badge,title,subtitle,author,date,image?} · slide-fact {eyebrow,bigMetric,description,source?} · slide-quote {quote,author,role} · slide-section {number,title,subtitle} · slide-two-cols {eyebrow,title,kicker,left:{heading,body|bullets[]},right:{…},source?} · slide-image-right {eyebrow,title,kicker,body|bullets[],image,caption?} · slide-depth-hero {eyebrow,giantBehindText (≤2 từ),subtitle,image,cutout? (PNG nền trong suốt; không có thì bỏ),imageQuery} · slide-bento-3 {eyebrow,actionTitle,kicker,heroCard:{title,metric,detail},sideCardTop:{title,metric?,bullet},sideCardBottom:{…},source?}.
Nhịp: không hai trang liền cùng mẫu; tiêu đề kết luận dưới 10 từ, chữ trong thẻ dưới 15 từ; cùng "morphId":"!!ten" ở hai trang liền cho vật thể bay sang trang sau (PowerPoint Morph).`;

/** Số trang theo mẫu đã đọc được (để nhận ra lượt trước đã làm loại gì). */
export const templateKinds = (content: string) => [...content.matchAll(/"templateId"\s*:\s*"([\w-]+)"/g)].map((m) => templateOf(m[1])?.kind).filter((k): k is Kind => !!k);
