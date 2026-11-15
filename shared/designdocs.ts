// Mẫu tài liệu A4 điền sẵn: báo cáo doanh nghiệp (bìa, mục lục, số trang), đề xuất / sách mỏng trang nhã, bài nghiên cứu hai cột, hóa đơn / báo giá.
// Dựng bằng HTML + CSS in của bộ thiết kế (Chromium in ra PDF: nút Tải về › PDF của artifact, hoặc page.pdf trong run_code), không cần Typst hay WeasyPrint.
// Bố cục dựng lại theo ý các gói Typst basic-report, ilm, charged-ieee (MIT / Apache-2.0) và mẫu hóa đơn WeasyPrint-Samples (BSD): viết mới bằng lớp của Synchro, không chép mã.
// Muốn đúng Typst thì cần tệp chạy typst và các gói @preview tải sẵn trong image workspace (workspace/Dockerfile); chưa có.
// Tệp thuần; designtemplates.ts gắn các mẫu này vào sổ mẫu.
import { money } from "./designemails";
import { arr, bullets, esc, nid, num, obj, paras, rich, str, u, type Ctx, type Props } from "./tplkit";

// Chữ trong @page (đầu trang) là chuỗi CSS: thoát \, ", xuống dòng và dấu < để không đóng được thẻ <style>.
const cssStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]+/g, " ").replace(/</g, "\\3C ")}"`;
const roman = (n: number) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][n] ?? String(n + 1);

/** Bảng số liệu: cột số căn phải (tự nhận), hàng tổng tùy chọn. */
function table(v: unknown, c: Ctx, field: string) {
  const t = obj(v), cols = arr(t.columns, 8).map((x) => str(x, 60)), rows = arr(t.rows, 60).map((r) => arr(r, 8));
  if (!cols.length || !rows.length) return "";
  const isNum = cols.map((_, i) => rows.every((r) => r[i] === undefined || r[i] === "" || typeof r[i] === "number" || /^[\s(+-]*[\d.,]+\s*(?:%|₫|đ|x|tỷ|triệu|tr|k|m|bn)?\)?$/i.test(String(r[i]))));
  const cell = (x: unknown, i: number, tag = "td") => `<${tag}${isNum[i] && i ? ' class="n"' : ""}>${esc(typeof x === "number" ? x.toLocaleString("vi-VN") : str(x, 200))}</${tag}>`;
  const total = arr(t.total, 8);
  return `<figure class="sx-doc-fig sx-keep" ${nid(c, field)}><table class="sx-table${rows.length > 14 ? " sx-long" : ""}"><thead><tr>${cols.map((x, i) => cell(x, i, "th")).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((_, i) => cell(r[i], i)).join("")}</tr>`).join("")}${total.length ? `<tr class="sx-total">${cols.map((_, i) => cell(total[i], i)).join("")}</tr>` : ""}</tbody></table>${str(t.caption) ? `<figcaption class="sx-source">${rich(t.caption, 200)}</figcaption>` : ""}</figure>`;
}
const kpis = (v: unknown, c: Ctx, field: string) => {
  const list = arr(v, 4).map(obj).filter((k) => str(k.value));
  return list.length ? `<div class="sx-doc-kpis sx-keep">${list.map((k, i) => `<div class="sx-card"><p class="sx-small" ${nid(c, `${field}.${i}.label`)}>${rich(k.label, 60)}</p><p class="sx-doc-kpi sx-num" ${nid(c, `${field}.${i}.value`)}>${esc(str(k.value, 24))}</p>${str(k.delta) ? `<p class="sx-small ${/^[-−]/.test(str(k.delta)) ? "sx-down" : "sx-up"}">${esc(str(k.delta, 30))}</p>` : ""}</div>`).join("")}</div>` : "";
};
// Phần thân dùng chung cho báo cáo và đề xuất: đoạn văn, gạch đầu dòng, chỉ số, bảng, hộp ghi chú, trích dẫn nổi.
const sectionBody = (s: Props, c: Ctx, extra?: (s: Props, c: Ctx) => string) =>
  `${paras(s.body, c, "body", "sx-text sx-doc-para")}${bullets(s.bullets, c, "bullets", "sx-text")}${kpis(s.kpis, c, "kpis")}${table(s.table, c, "table")}${extra ? extra(s, c) : ""}${str(s.callout) ? `<aside class="sx-callout sx-keep"><p class="sx-text" ${nid(c, "callout")}>${rich(s.callout, 600)}</p></aside>` : ""}${str(s.pullQuote) ? `<blockquote class="sx-doc-pull sx-keep" ${nid(c, "pullQuote")}>${rich(s.pullQuote, 300)}</blockquote>` : ""}`;
let chartHook: ((v: unknown, c: Ctx, field: string) => string) | null = null;
/** Biểu đồ trong tài liệu (designcharts.ts gắn vào khi có). */
export const setDocChart = (f: (v: unknown, c: Ctx, field: string) => string) => { chartHook = f; };
const withChart = (s: Props, c: Ctx) => (chartHook && s.chart ? chartHook(s.chart, c, "chart") : "");

export const DOC_TEMPLATES: Record<string, (p: Props, c: Ctx) => string> = {
  // Báo cáo doanh nghiệp: bìa (trang riêng, không số trang), mục lục, tóm tắt kết luận, các phần đánh số, nguồn. Đầu trang in tên báo cáo, chân trang số trang.
  "doc-report": (p, c) => {
    const secs = arr(p.sections, 20).map(obj).filter((s) => str(s.heading));
    return `<style>@page sx-a4{@top-left{content:${cssStr(str(p.title, 120))};font:9pt Arial,sans-serif;color:#64748b}}</style>
<article class="sx-doc sx-doc-report" data-sx-template="doc-report">
<section class="sx-page sx-doc-cover"><i class="sx-doc-band" aria-hidden="true"></i>${str(p.org) ? `<p class="sx-eyebrow" ${nid(c, "org")}>${rich(p.org, 100)}</p>` : ""}<h1 class="sx-display sx-doc-title" ${nid(c, "title")}>${rich(p.title, 200)}</h1>${str(p.subtitle) ? `<p class="sx-kicker sx-doc-sub" ${nid(c, "subtitle")}>${rich(p.subtitle, 300)}</p>` : ""}
<footer class="sx-doc-meta">${str(p.author) ? `<span ${nid(c, "author")}>${rich(p.author, 120)}</span>` : ""}${str(p.date) ? `<span ${nid(c, "date")}>${rich(p.date, 60)}</span>` : ""}${str(p.version) ? `<span>${rich(p.version, 40)}</span>` : ""}</footer></section>
<section class="sx-page sx-doc-body">${secs.length > 1 ? `<nav class="sx-doc-toc sx-keep" aria-label="Mục lục"><h2 class="sx-h2">Mục lục</h2><ol>${secs.map((s, i) => `<li><a href="#${c.id}-s${i + 1}"><span class="sx-num">${i + 1}.</span> ${rich(s.heading, 160)}</a></li>`).join("")}</ol></nav>` : ""}
${str(p.summary) ? `<aside class="sx-callout sx-keep sx-doc-summary"><p class="sx-eyebrow">Tóm tắt</p><p class="sx-text" ${nid(c, "summary")}>${rich(p.summary, 1200)}</p></aside>` : ""}
${secs.map((s, i) => { const cc = { id: `${c.id}.sections.${i}` }; return `<section class="sx-doc-sec" id="${c.id}-s${i + 1}"><h2 class="sx-title sx-doc-h" ${nid(cc, "heading")}><span class="sx-doc-n sx-num">${i + 1}</span>${rich(s.heading, 200)}</h2>${str(s.kicker) ? `<p class="sx-kicker" ${nid(cc, "kicker")}>${rich(s.kicker, 300)}</p>` : ""}${sectionBody(s, cc, withChart)}</section>`; }).join("\n")}
${arr(p.sources, 20).length ? `<section class="sx-doc-sec sx-doc-src"><h2 class="sx-h2">Nguồn</h2><ol>${arr(p.sources, 20).map((x, i) => `<li class="sx-small" ${nid(c, `sources.${i}`)}>${rich(x, 300)}</li>`).join("")}</ol></section>` : ""}</section></article>`;
  },
  // Đề xuất / sách mỏng: bìa lớn chữ có chân, chương đánh số 01 02, trích dẫn nổi, bảng giá có tổng, lời kết và người liên hệ.
  "doc-proposal": (p, c) => {
    const ch = arr(p.chapters ?? p.sections, 16).map(obj).filter((s) => str(s.heading));
    const pr = obj(p.pricing), items = arr(pr.items, 20).map(obj), cur = str(pr.currency ?? p.currency, 8) || "VND";
    const total = pr.total ?? items.reduce((a, x) => a + num(x.price) * (num(x.qty) || 1), 0);
    return `<style>@page sx-a4{@top-right{content:${cssStr(str(p.title, 120))};font:italic 9pt Georgia,serif;color:#78716c}}</style>
<article class="sx-doc sx-doc-proposal" data-sx-template="doc-proposal">
<section class="sx-page sx-doc-cover sx-aurora">${str(p.client) ? `<p class="sx-eyebrow" ${nid(c, "client")}>Đề xuất cho ${rich(p.client, 100)}</p>` : ""}<h1 class="sx-display sx-doc-title" ${nid(c, "title")}>${rich(p.title, 200)}</h1>${str(p.subtitle) ? `<p class="sx-kicker sx-doc-sub" ${nid(c, "subtitle")}>${rich(p.subtitle, 300)}</p>` : ""}
<footer class="sx-doc-meta">${str(p.author) ? `<span ${nid(c, "author")}>${rich(p.author, 120)}</span>` : ""}${str(p.date) ? `<span ${nid(c, "date")}>${rich(p.date, 60)}</span>` : ""}</footer></section>
<section class="sx-page sx-doc-body">${ch.map((s, i) => { const cc = { id: `${c.id}.chapters.${i}` }; return `<section class="sx-doc-chapter"><p class="sx-doc-chno sx-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</p><h2 class="sx-title" ${nid(cc, "heading")}>${rich(s.heading, 200)}</h2>${str(s.kicker) ? `<p class="sx-kicker" ${nid(cc, "kicker")}>${rich(s.kicker, 300)}</p>` : ""}${sectionBody(s, cc, withChart)}</section>`; }).join("\n")}
${items.length ? `<section class="sx-doc-chapter sx-keep"><p class="sx-doc-chno sx-num" aria-hidden="true">${String(ch.length + 1).padStart(2, "0")}</p><h2 class="sx-title">${rich(pr.heading ?? "Chi phí", 120)}</h2><table class="sx-table"><thead><tr><th>Hạng mục</th><th class="n">Chi phí</th></tr></thead><tbody>${items.map((x, i) => `<tr><td><b ${nid(c, `pricing.items.${i}.name`)}>${rich(x.name, 160)}</b>${str(x.detail) ? `<br><span class="sx-small">${rich(x.detail, 300)}</span>` : ""}</td><td class="n">${esc(money(num(x.price) * (num(x.qty) || 1), cur))}</td></tr>`).join("")}<tr class="sx-total"><td>Tổng cộng</td><td class="n">${esc(money(total, cur))}</td></tr></tbody></table>${str(pr.note) ? `<p class="sx-source">${rich(pr.note, 300)}</p>` : ""}</section>` : ""}
${str(p.closing) || str(p.contact) ? `<section class="sx-doc-close sx-keep">${str(p.closing) ? `<p class="sx-h2" ${nid(c, "closing")}>${rich(p.closing, 400)}</p>` : ""}${str(p.contact) ? `<p class="sx-small" ${nid(c, "contact")}>${rich(p.contact, 300)}</p>` : ""}</section>` : ""}</section></article>`;
  },
  // Bài nghiên cứu hai cột: tên bài, tác giả và đơn vị, tóm tắt, từ khóa trên toàn chiều ngang; thân hai cột với đề mục số La Mã; tài liệu tham khảo đánh số.
  "doc-paper": (p, c) => {
    const au = arr(p.authors, 8).map((a) => (typeof a === "string" ? { name: a } : obj(a)));
    const secs = arr(p.sections, 20).map(obj).filter((s) => str(s.heading));
    return `<article class="sx-doc sx-doc-paper" data-sx-template="doc-paper"><section class="sx-page">
<header class="sx-doc-paper-head"><h1 class="sx-title" ${nid(c, "title")}>${rich(p.title, 240)}</h1><p class="sx-doc-authors">${au.map((a, i) => `<span><b ${nid(c, `authors.${i}.name`)}>${rich(a.name, 80)}</b>${str(a.affiliation) ? `<br><span class="sx-small">${rich(a.affiliation, 160)}</span>` : ""}${str(a.email) ? `<br><span class="sx-small sx-mono">${esc(str(a.email, 80))}</span>` : ""}</span>`).join("")}</p></header>
<div class="sx-doc-cols">${str(p.abstract) ? `<p class="sx-doc-abs" ${nid(c, "abstract")}><b><i>Tóm tắt</i>—</b>${rich(p.abstract, 2000)}</p>` : ""}${arr(p.keywords, 10).length ? `<p class="sx-doc-abs"><b><i>Từ khóa</i>—</b>${arr(p.keywords, 10).map((k) => esc(str(k, 40))).join(", ")}.</p>` : ""}
${secs.map((s, i) => { const cc = { id: `${c.id}.sections.${i}` }; return `<section><h2 class="sx-doc-ph" ${nid(cc, "heading")}>${roman(i)}. ${rich(s.heading, 160)}</h2>${sectionBody(s, cc, withChart)}${arr(s.subsections, 8).map(obj).map((x, k) => `<h3 class="sx-doc-psh"><i>${String.fromCharCode(65 + k)}. ${rich(x.heading, 120)}</i></h3>${paras(x.body, { id: `${cc.id}.subsections.${k}` }, "body", "sx-text sx-doc-para")}`).join("")}</section>`; }).join("\n")}
${arr(p.references, 40).length ? `<section><h2 class="sx-doc-ph">Tài liệu tham khảo</h2><ol class="sx-doc-refs">${arr(p.references, 40).map((r, i) => `<li ${nid(c, `references.${i}`)}>${rich(r, 400)}</li>`).join("")}</ol></section>` : ""}</div></section></article>`;
  },
  // Hóa đơn / báo giá A4: tên chứng từ lớn, bên bán / bên mua, số và ngày, bảng hàng (Mô tả, Đơn giá, SL, Thành tiền), tạm tính, giảm giá, thuế, tổng; khối thanh toán và ghi chú.
  "doc-invoice": (p, c) => {
    const cur = str(p.currency, 8) || "VND", items = arr(p.items, 60).map(obj);
    const sub = items.reduce((a, x) => a + num(x.price) * (num(x.qty) || 1), 0), disc = num(p.discount), rate = num(p.taxRate), tax = Math.round((sub - disc) * rate) / 100, total = sub - disc + tax;
    const party = (v: unknown, k: string, label: string) => { const o = obj(v); return `<address class="sx-doc-party"><p class="sx-eyebrow">${label}</p><b ${nid(c, `${k}.name`)}>${rich(o.name, 120)}</b>${["address", "email", "phone", "taxId"].map((f) => (str(o[f]) ? `<span ${nid(c, `${k}.${f}`)}>${f === "taxId" ? "MST: " : ""}${rich(o[f], 200)}</span>` : "")).join("")}</address>`; };
    const pay = obj(p.payment), kind = str(p.kind) === "quote" ? "Báo giá" : str(p.title, 40) || "Hóa đơn";
    const row = (k: string, v: number, cls = "") => `<tr class="${cls}"><td>${esc(k)}</td><td class="n">${esc(money(v, cur))}</td></tr>`;
    return `<article class="sx-doc sx-doc-invoice" data-sx-template="doc-invoice"><section class="sx-page">
<header class="sx-doc-inv-head"><h1 class="sx-display sx-accent" ${nid(c, "title")}>${esc(kind)}</h1><dl class="sx-doc-inv-info">${[["Số", p.number], ["Ngày", p.date], [str(p.kind) === "quote" ? "Hiệu lực đến" : "Hạn thanh toán", p.due]].filter(([, v]) => str(v)).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="sx-num">${esc(str(v, 40))}</dd></div>`).join("")}</dl></header>
<div class="sx-doc-parties">${party(p.from, "from", "Bên bán")}${party(p.to, "to", str(p.kind) === "quote" ? "Gửi tới" : "Bên mua")}</div>
<table class="sx-table sx-doc-items${items.length > 14 ? " sx-long" : ""}"><thead><tr><th>Mô tả</th><th class="n">Đơn giá</th><th class="n">SL</th><th class="n">Thành tiền</th></tr></thead><tbody>${items.map((x, i) => `<tr><td><span ${nid(c, `items.${i}.description`)}>${rich(x.description ?? x.name, 200)}</span>${str(x.detail) ? `<br><span class="sx-small">${rich(x.detail, 200)}</span>` : ""}</td><td class="n">${esc(money(num(x.price), cur))}</td><td class="n">${esc(String(num(x.qty) || 1))}${str(x.unit) ? ` ${esc(str(x.unit, 12))}` : ""}</td><td class="n">${esc(money(num(x.price) * (num(x.qty) || 1), cur))}</td></tr>`).join("")}</tbody></table>
<div class="sx-doc-inv-foot sx-keep"><div class="sx-doc-pay">${str(pay.bank) || str(pay.account) ? `<p class="sx-eyebrow">Thanh toán</p>${[["Ngân hàng", pay.bank], ["Số tài khoản", pay.account], ["Chủ tài khoản", pay.name], ["Nội dung", pay.reference ?? p.number]].filter(([, v]) => str(v)).map(([k, v]) => `<p class="sx-small"><span>${esc(k)}:</span> <b class="sx-num">${esc(str(v, 80))}</b></p>`).join("")}` : ""}${str(p.notes) ? `<p class="sx-small sx-doc-notes" ${nid(c, "notes")}>${rich(p.notes, 600)}</p>` : ""}</div>
<table class="sx-table sx-doc-sum"><tbody>${row("Tạm tính", sub)}${disc ? row("Giảm giá", -disc) : ""}${rate ? row(`Thuế GTGT ${rate}%`, tax) : ""}${row("Tổng cộng", total, "sx-total sx-doc-grand")}</tbody></table></div>
${str(p.thanks) ? `<p class="sx-doc-thanks" ${nid(c, "thanks")}>${rich(p.thanks, 200)}</p>` : ""}</section></article>`;
  },
};
export const DOC_ALIASES: Record<string, string> = { "doc-basic-report": "doc-report", "doc-ilm": "doc-proposal", "doc-booklet": "doc-proposal", "doc-charged-ieee": "doc-paper", "doc-ieee": "doc-paper", "doc-research": "doc-paper", "doc-quote": "doc-invoice", "doc-weasyprint-invoice": "doc-invoice" };

export const DOC_TPL_CSS = `.sx-doc{display:flex;flex-direction:column;gap:${u(32)};padding:${u(24)} 0}
.sx-doc .sx-page{background-color:var(--sx-surface);box-shadow:0 1px 3px rgba(15,23,42,.08);border-radius:${u("var(--sx-ri)")}}
.sx-doc-cover{min-height:${u(1000)};justify-content:flex-end;position:relative;overflow:hidden;padding:${u(72)} ${u(64)}!important;gap:${u(20)}!important}
.sx-doc-band{position:absolute;left:0;right:0;top:0;height:${u(12)};background:var(--sx-vivid)}
.sx-doc-title{max-width:${u(640)}}.sx-doc-sub{font-size:${u(21)};max-width:${u(600)}}
.sx-doc-meta{display:flex;flex-wrap:wrap;gap:${u(24)};padding-top:${u(16)};border-top:${u(1)} solid var(--sx-line);font-size:${u(14)};color:var(--sx-muted)}
.sx-doc-body{gap:${u(28)}!important}.sx-doc-toc ol{margin:${u(12)} 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${u(8)}}
.sx-doc-toc a{color:inherit;text-decoration:none;display:flex;gap:${u(8)};padding-bottom:${u(6)};border-bottom:${u(1)} dotted var(--sx-line)}
.sx-doc-sec{display:flex;flex-direction:column;gap:${u(14)}}.sx-doc-h{display:flex;gap:${u(12)};align-items:baseline;font-size:${u(25)}}
.sx-doc-n{color:var(--sx-accent);font-family:var(--sx-mono);font-size:${u(16)};font-weight:600}
.sx-doc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(${u(150)},1fr));gap:${u(12)}}.sx-doc-kpis .sx-card{padding:${u(14)} ${u(16)};gap:${u(2)}}
.sx-doc-kpi{margin:0;font-family:var(--sx-head);font-size:${u(28)};font-weight:800;line-height:1.2;letter-spacing:-.02em}
.sx-doc-fig{margin:0;display:flex;flex-direction:column;gap:${u(8)}}
.sx-doc-pull{margin:${u(8)} 0;padding:${u(8)} 0 ${u(8)} ${u(24)};border-left:${u(3)} solid var(--sx-vivid);font-family:var(--sx-head);font-size:${u(24)};line-height:var(--sx-lh,1.3);font-style:italic;text-wrap:balance}
.sx-doc-src ol{margin:0;padding-left:1.4em}
.sx-doc-proposal .sx-doc-cover{min-height:${u(1060)}}.sx-doc-proposal .sx-doc-title{font-size:${u(64)};max-width:${u(620)}}
.sx-doc-chapter{display:flex;flex-direction:column;gap:${u(14)};padding-top:${u(8)}}.sx-doc-chapter+.sx-doc-chapter{border-top:${u(1)} solid var(--sx-line);padding-top:${u(28)}}
.sx-doc-chno{margin:0;font-family:var(--sx-head);font-size:${u(56)};font-weight:700;line-height:1;color:var(--sx-accent)}
.sx-doc-close{padding:${u(24)};background:var(--sx-raised);border-radius:${u("var(--sx-ri)")};display:flex;flex-direction:column;gap:${u(8)}}
.sx-doc-paper .sx-page{gap:${u(20)}}.sx-doc-paper-head{text-align:center;display:flex;flex-direction:column;gap:${u(14)}}.sx-doc-paper-head .sx-title{font-size:${u(25)}}
.sx-doc-authors{display:flex;flex-wrap:wrap;justify-content:center;gap:${u(12)} ${u(32)};margin:0;font-size:${u(14)};line-height:1.4}
.sx-doc-cols{columns:2;column-gap:${u(24)};font-size:${u(13.5)};line-height:1.5;text-align:justify;hyphens:auto}.sx-doc-cols .sx-text{font-size:${u(13.5)};margin:0 0 ${u(8)}}
.sx-doc-cols .sx-doc-fig,.sx-doc-cols .sx-callout,.sx-doc-cols .sx-doc-kpis{break-inside:avoid;margin:${u(8)} 0}.sx-doc-cols .sx-tpl-list{gap:${u(4)};margin:0 0 ${u(8)}}
.sx-doc-abs{margin:0 0 ${u(10)};font-size:${u(13)};font-weight:500}.sx-doc-ph{margin:${u(14)} 0 ${u(6)};text-align:center;font-family:var(--sx-body);font-size:${u(13)};font-weight:600;letter-spacing:.06em;text-transform:uppercase;break-after:avoid}
.sx-doc-psh{margin:${u(8)} 0 ${u(4)};font-size:${u(13.5)};font-weight:500;break-after:avoid}.sx-doc-refs{margin:0;padding-left:1.6em;font-size:${u(12)};line-height:1.45}
.sx-doc-inv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:${u(24)}}.sx-doc-invoice .sx-display{font-size:${u(48)}}
.sx-doc-inv-info{margin:0;display:grid;gap:${u(4)};text-align:right;font-size:${u(14)}}.sx-doc-inv-info div{display:flex;gap:${u(8)};justify-content:flex-end}.sx-doc-inv-info dt{color:var(--sx-muted)}.sx-doc-inv-info dd{margin:0;font-weight:600}
.sx-doc-parties{display:grid;grid-template-columns:1fr 1fr;gap:${u(24)}}.sx-doc-party{font-style:normal;display:flex;flex-direction:column;gap:${u(2)};font-size:${u(14)};line-height:1.5}.sx-doc-party+.sx-doc-party{text-align:right}
.sx-doc-items td{vertical-align:top}.sx-doc-inv-foot{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,${u(300)});gap:${u(32)};align-items:start}
.sx-doc-pay{display:flex;flex-direction:column;gap:${u(4)}}.sx-doc-pay .sx-small span{color:var(--sx-muted)}.sx-doc-notes{margin-top:${u(12)}}
.sx-doc-sum td{border-bottom:0;padding:${u(4)} 0}.sx-doc-grand td{font-size:${u(18)};padding-top:${u(10)};color:var(--sx-accent)}
.sx-doc-thanks{margin:0;font-family:var(--sx-head);font-size:${u(21)};font-style:italic;color:var(--sx-accent)}
@media (max-width:640px){.sx-doc-cols{columns:1}.sx-doc-parties,.sx-doc-inv-foot{grid-template-columns:1fr}.sx-doc-party+.sx-doc-party{text-align:left}.sx-doc-inv-head{flex-direction:column}.sx-doc-inv-info{text-align:left}.sx-doc-inv-info div{justify-content:flex-start}.sx-doc-cover{min-height:${u(560)}}}
@page sx-cover{size:A4;margin:0}
@media print{.sx-doc{padding:0;gap:0}.sx-doc .sx-page{box-shadow:none;border-radius:0;background-color:transparent}.sx-doc .sx-doc-cover{page:sx-cover;min-height:100vh;break-after:page;padding:28mm 22mm!important}.sx-doc-proposal .sx-doc-cover{min-height:100vh}.sx-doc .sx-doc-toc{break-after:page}.sx-doc .sx-doc-cols{font-size:9.5pt}.sx-doc .sx-doc-cols .sx-text{font-size:9.5pt}}`;

export const DOC_TPL_GUIDE = `Mẫu tài liệu A4 điền sẵn (nên dùng: bìa, mục lục, số trang, luật in có sẵn; in PDF bằng Tải về › PDF): trang text/html chỉ cần <script type="application/json" data-sx-template>{"styleArchetype":"<phong cách>","pages":[{"templateId":"…","props":{…}}]}</script>. Chữ thường, **chữ** để nhấn, dòng trống tách đoạn.
Phần (section): {heading,kicker?,body,bullets?[],kpis?:[{label,value,delta}],table?:{columns[],rows[][],total?[],caption?},chart?,callout?,pullQuote?}.
doc-report {org,title,subtitle,author,date,summary,sections[],sources[]} (báo cáo doanh nghiệp) · doc-proposal {client,title,subtitle,author,date,chapters[] (như phần),pricing:{items:[{name,detail,price,qty?}],currency,note},closing,contact} (đề xuất, sách mỏng) · doc-paper {title,authors:[{name,affiliation,email}],abstract,keywords[],sections[] (+subsections:[{heading,body}]),references[]} (nghiên cứu hai cột) · doc-invoice {kind:"invoice"|"quote",number,date,due,from:{name,address,email,phone,taxId},to:{…},items:[{description,detail,qty,unit,price}],currency,discount?,taxRate? (%),payment:{bank,account,name},notes,thanks} (số tiền tự tính).`;
