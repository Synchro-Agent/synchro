// Bản Word (.docx) của 3 mẫu Typst, dựng bằng thư viện docx 9.15.3 (MIT, npm) như tài liệu của chủ dự án chọn cho đầu ra Word.
// Đọc mô hình nội dung mà synchro-doc đã kiểm và chuẩn hóa (cùng payload với bản PDF), nên PDF và Word có cùng mục, bảng, hình, đánh số.
// Phông là phông Word sẵn có trên máy người nhận và đủ dấu tiếng Việt (Cambria, Calibri, Times New Roman), không phải phông nhúng của bản PDF:
// basic-report → thân Cambria, tiêu đề Calibri xanh như bản Typst; ilm → Cambria; charged-ieee → Times New Roman, 2 cột.
// Mục lục điền sẵn số trang (docx/layout ước lượng như Word), Word không phải hỏi cập nhật.
// Dùng: node render.mjs model.json out.docx <thư mục làm việc>
import fs from "node:fs";
import path from "node:path";
import * as D from "docx";
import { estimatePageNumbersWith } from "docx/layout";

const [modelPath, outPath, root] = process.argv.slice(2);
if (!modelPath || !outPath || !root) { console.error("dùng: node render.mjs model.json out.docx <thư mục làm việc>"); process.exit(2); }
const m = JSON.parse(fs.readFileSync(modelPath, "utf8"));
const vi = m.lang === "vi";
const tpl = m.template;
const cm = (x) => Math.round(x * 567); // cm -> twip
const A4 = { width: 11906, height: 16838 }, LETTER = { width: 12240, height: 15840 };

const THEME = {
  "basic-report": { body: "Cambria", head: "Calibri", size: 22, ink: "404040", headInk: "0074D9", headBold: false, sizes: [32, 26, 23],
    margin: { top: cm(3.6), left: cm(4.5), right: cm(3), bottom: cm(3), header: cm(1.8) }, page: A4 },
  ilm: { body: "Cambria", head: "Cambria", size: 23, ink: "000000", headInk: "000000", headBold: true, sizes: [34, 28, 24],
    margin: { top: cm(2.25), left: cm(2.5), right: cm(2.5), bottom: cm(1.75), footer: cm(0.8) }, page: A4 },
  "charged-ieee": { body: "Times New Roman", head: "Times New Roman", size: 20, ink: "000000", headInk: "000000", headBold: false, sizes: [22, 20, 20],
    margin: m.paper === "us-letter" ? { top: 1440 * 0.75, left: 1440 * 0.625, right: 1440 * 0.625, bottom: 1440 } : { top: 1610, left: 830, right: 830, bottom: 1790 },
    page: m.paper === "us-letter" ? LETTER : A4, columns: 2 },
}[tpl];
if (!THEME) { console.error(`mẫu không có: ${tpl}`); process.exit(2); }
const MONO = "Consolas";
const textWidth = () => {
  const w = THEME.page.width - THEME.margin.left - THEME.margin.right;
  return THEME.columns ? Math.floor((w - 280) / THEME.columns) : w;
};
const twipToPx = (t) => Math.round((t / 1440) * 96);

// ---------------------------------------------------------------- chữ
function runs(rs, extra = {}) {
  const out = [];
  for (const r of rs ?? []) {
    const parts = String(r.text).split("\n");
    const mk = (t, i) => new D.TextRun({
      text: t, break: i > 0 ? 1 : undefined,
      bold: r.bold || extra.bold || undefined, italics: r.italic || extra.italics || undefined,
      font: r.code ? MONO : extra.font, size: r.code ? Math.round((extra.size ?? THEME.size) * 0.9) : extra.size,
      color: r.link ? "1155CC" : extra.color, underline: r.link ? {} : undefined, smallCaps: extra.smallCaps,
    });
    const children = parts.map(mk);
    if (r.link) out.push(new D.ExternalHyperlink({ link: r.link, children }));
    else out.push(...children);
  }
  return out;
}
const plain = (rs) => (rs ?? []).map((r) => r.text).join("");
const str = (s, extra) => runs([{ text: s }], extra);

// ---------------------------------------------------------------- đánh số tiêu đề như bản Typst
const counters = [0, 0, 0];
let appendixMode = false;
const ROMAN = (n) => [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");
function number(level) {
  counters[level - 1]++;
  for (let i = level; i < 3; i++) counters[i] = 0;
  const c = counters.slice(0, level);
  if (tpl === "charged-ieee") return level === 1 ? `${ROMAN(c[0])}.` : level === 2 ? `${String.fromCharCode(64 + c[1])}.` : `${String.fromCharCode(96 + c[2])})`;
  if (appendixMode) return `${String.fromCharCode(64 + c[0])}.${c.slice(1).map((x) => `${x}.`).join("")}`;
  return c.map((x) => `${x}.`).join("");
}
const HL = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3];
function heading(level, rs, { numbered = true, outline = true, pageBreak = false } = {}) {
  const lv = Math.min(Math.max(level, 1), 3);
  const prefix = numbered ? `${number(lv)} ` : "";
  const ieee1 = tpl === "charged-ieee" && lv === 1;
  return new D.Paragraph({
    heading: outline ? HL[lv - 1] : undefined,
    style: outline ? undefined : "PlainHeading",
    alignment: ieee1 ? D.AlignmentType.CENTER : undefined,
    pageBreakBefore: pageBreak || undefined,
    keepNext: true, keepLines: true,
    children: [...str(prefix, { smallCaps: ieee1 || undefined }), ...runs(rs, { smallCaps: ieee1 || undefined, italics: tpl === "charged-ieee" && lv >= 2 || undefined })],
  });
}

// ---------------------------------------------------------------- khối
let listInstance = 0, tableNo = 0, figureNo = 0;
const caption = (label, n, rs, before) => new D.Paragraph({
  style: "Caption", alignment: D.AlignmentType.CENTER, keepNext: before || undefined,
  children: [...str(`${label} ${tpl === "charged-ieee" && label !== (vi ? "Hình" : "Fig.") ? ROMAN(n) : n}: `), ...runs(rs)],
});
const RULE = (size, color) => ({ style: D.BorderStyle.SINGLE, size, color });
const NONE = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };

function table(b) {
  const n = b.columns.length;
  const W = textWidth();
  let weights = b.widths;
  if (!weights) {
    weights = b.columns.map((c, j) => {
      const longest = Math.max(plain(c).length, ...b.rows.map((r) => plain(r[j]).length));
      return Math.min(Math.max(longest, 4), 40) * (j === 0 ? 1.3 : 1);
    });
  }
  const sum = weights.reduce((a, x) => a + x, 0);
  const widths = weights.map((x) => Math.floor((x / sum) * W));
  const AL = { left: D.AlignmentType.LEFT, right: D.AlignmentType.RIGHT, center: D.AlignmentType.CENTER };
  const total = b.total && b.rows.length > 1;
  const cell = (rs, j, opts = {}) => new D.TableCell({
    width: { size: widths[j], type: D.WidthType.DXA },
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    verticalAlign: D.VerticalAlign.CENTER,
    borders: opts.borders,
    children: [new D.Paragraph({ alignment: AL[b.align[j]], spacing: { before: 0, after: 0 }, children: runs(rs, { bold: opts.bold, size: tpl === "charged-ieee" ? 16 : undefined }) })],
  });
  const rows = [
    new D.TableRow({ tableHeader: true, cantSplit: true, children: b.columns.map((c, j) => cell(c, j, { bold: true, borders: { bottom: RULE(6, "666666") } })) }),
    ...b.rows.map((r, i) => {
      const last = total && i === b.rows.length - 1;
      return new D.TableRow({ cantSplit: true, children: r.map((c, j) => cell(c, j, { bold: last, borders: last ? { top: RULE(6, "666666") } : undefined })) });
    }),
  ];
  const out = [];
  tableNo++;
  if (b.caption) out.push(caption(tpl === "charged-ieee" ? (vi ? "BẢNG" : "TABLE") : (vi ? "Bảng" : "Table"), tableNo, b.caption, true));
  out.push(new D.Table({
    width: { size: W, type: D.WidthType.DXA }, columnWidths: widths, layout: D.TableLayoutType.FIXED,
    borders: { top: RULE(10, "333333"), bottom: RULE(10, "333333"), left: NONE, right: NONE, insideHorizontal: RULE(2, "D0D0D0"), insideVertical: NONE },
    rows,
  }));
  out.push(new D.Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
  return out;
}

function imageBlock(b) {
  const file = path.join(root, b.path);
  const ext = path.extname(file).toLowerCase().replace(".", "");
  const type = ext === "jpeg" ? "jpg" : ext;
  if (!["png", "jpg", "gif", "bmp"].includes(type)) throw new Error(`ảnh không đọc được trong Word: ${b.path}`);
  const [pw, ph] = b.px ?? [800, 600];
  const w = Math.round((twipToPx(textWidth()) * (b.width ?? 100)) / 100);
  const h = Math.round((w * ph) / pw);
  const out = [new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: !!b.caption || undefined, children: [new D.ImageRun({ type, data: fs.readFileSync(file), transformation: { width: w, height: h } })] })];
  if (b.caption) { figureNo++; out.push(caption(tpl === "charged-ieee" ? (vi ? "Hình" : "Fig.") : vi ? "Hình" : "Figure", figureNo, b.caption, false)); }
  return out;
}

function block(b) {
  switch (b.type) {
    case "paragraph": return [new D.Paragraph({ children: runs(b.text) })];
    case "heading": return [heading(b.level ?? 2, b.text)];
    case "bullets":
    case "numbered": {
      const inst = ++listInstance;
      return b.items.map((it) => new D.Paragraph({ numbering: { reference: b.type, level: 0, instance: inst }, spacing: { after: 40 }, children: runs(it) }));
    }
    case "table": return table(b);
    case "image": return imageBlock(b);
    case "quote": {
      const out = [new D.Paragraph({ indent: { left: 720, right: 720 }, spacing: { after: b.by ? 0 : 160 }, children: runs(b.text, { italics: true }) })];
      if (b.by) out.push(new D.Paragraph({ alignment: D.AlignmentType.RIGHT, indent: { right: 720 }, children: str(`— ${b.by}`) }));
      return out;
    }
    case "callout": return [new D.Paragraph({
      shading: { type: D.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
      border: { left: { style: D.BorderStyle.SINGLE, size: 24, color: "8C8C8C", space: 8 } },
      indent: { left: 200 }, keepLines: true, alignment: D.AlignmentType.LEFT,
      children: [...(b.title ? [...str(b.title, { bold: true }), new D.TextRun({ text: "", break: 1 })] : []), ...runs(b.text)],
    })];
    case "code": return [new D.Paragraph({
      shading: { type: D.ShadingType.CLEAR, fill: "F5F5F5", color: "auto" }, keepLines: true, alignment: D.AlignmentType.LEFT,
      children: str(b.text, { font: MONO, size: 18 }),
    })];
    case "pagebreak": return [new D.Paragraph({ children: [new D.PageBreak()] })];
    default: return [];
  }
}

function sections(secs, { chapterBreak = false } = {}) {
  const out = [];
  let first = true;
  for (const s of secs) {
    if (s.heading) out.push(heading(s.level ?? 1, s.heading, { pageBreak: chapterBreak && (s.level ?? 1) === 1 && !first }));
    first = false;
    for (const b of s.blocks) out.push(...block(b));
  }
  return out;
}

function references() {
  if (!m.references?.length) return [];
  return [
    heading(1, [{ text: vi ? "Tài liệu tham khảo" : "References" }], { numbered: false }),
    ...m.references.map((r, i) => new D.Paragraph({
      indent: { left: 480, hanging: 480 }, spacing: { after: 60 },
      children: [...str(`[${i + 1}]\t`, { size: tpl === "charged-ieee" ? 16 : undefined }), ...runs(r, { size: tpl === "charged-ieee" ? 16 : undefined })],
      tabStops: [{ type: D.TabStopType.LEFT, position: 480 }],
    })),
  ];
}

// ---------------------------------------------------------------- trang
const pageNo = (align) => new D.Paragraph({ alignment: align, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], font: THEME.head, size: 18 })] });
const toc = () => [
  new D.Paragraph({ style: "PlainHeading", children: str(vi ? (m.toc_title ?? "Mục lục") : (m.toc_title ?? "Contents")) }),
  new D.TableOfContents(vi ? "Mục lục" : "Contents", { hyperlink: true, headingStyleRange: "1-3" }),
];
const page = (extra = {}) => ({ page: { size: THEME.page, margin: THEME.margin, ...extra } });

function viDate(fmt) {
  if (!m.date) return "";
  const [y, mo, d] = m.date.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return fmt.replace(/\[day[^\]]*\]/g, String(d).padStart(/padding:none/.test(fmt) ? 1 : 2, "0")).replace(/\[month repr:long\]/g, months[mo - 1])
    .replace(/\[month[^\]]*\]/g, String(mo).padStart(2, "0")).replace(/\[year[^\]]*\]/g, String(y));
}

function build() {
  const secs = [];
  if (tpl === "basic-report") {
    const logo = m.logo ? [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.ImageRun({
      type: path.extname(m.logo.path).slice(1).toLowerCase().replace("jpeg", "jpg"), data: fs.readFileSync(path.join(root, m.logo.path)),
      transformation: { width: 94, height: Math.round(94 * (m.logo.px?.[1] ?? 1) / (m.logo.px?.[0] ?? 1)) } })] })] : [];
    secs.push({ properties: page({ margin: { top: cm(3), left: cm(4.5), right: cm(3), bottom: cm(4.5) } }), children: [
      ...logo,
      new D.Paragraph({ spacing: { before: cm(logo.length ? 4.5 : 6) }, children: str(m.category || " ", { font: THEME.head, size: 28, color: "000000" }) }),
      new D.Paragraph({ alignment: D.AlignmentType.LEFT, spacing: { before: 120, line: 240, lineRule: D.LineRuleType.AUTO }, children: str(m.title, { font: "Calibri Light", size: 72, color: THEME.headInk }) }),
      new D.Paragraph({ spacing: { before: cm(9) }, children: [m.date_text, m.author, m.affiliation].filter(Boolean).flatMap((t, i) => str(t, { font: THEME.head, size: 20, color: "000000" }).map((r) => (i ? [new D.TextRun({ text: "", break: 1 }), r] : [r])).flat()) }),
    ] });
    const header = (title) => new D.Header({ children: [new D.Paragraph({
      tabStops: [{ type: D.TabStopType.RIGHT, position: textWidth() }],
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "000000", space: 4 } },
      children: [...str(title, { font: THEME.head, size: 18 }), new D.TextRun({ text: "\t", font: THEME.head }), new D.TextRun({ children: [D.PageNumber.CURRENT], font: THEME.head, size: 18 })],
    })] });
    secs.push({ properties: { ...page(), page: { ...page().page, pageNumbers: { start: 1, formatType: D.NumberFormat.LOWER_ROMAN } } }, headers: { default: header(m.toc_title) }, children: toc() });
    secs.push({ properties: { ...page(), page: { ...page().page, pageNumbers: { start: 1, formatType: D.NumberFormat.DECIMAL } } }, headers: { default: header(m.title) },
      children: [...sections(m.sections), ...references()] });
  } else if (tpl === "ilm") {
    secs.push({ properties: { ...page(), verticalAlign: D.VerticalAlignSection.CENTER }, children: [
      new D.Paragraph({ alignment: D.AlignmentType.LEFT, spacing: { after: 240, line: 240, lineRule: D.LineRuleType.AUTO }, children: str(m.title, { bold: true, size: 72 }) }),
      ...(m.author ? [new D.Paragraph({ alignment: D.AlignmentType.LEFT, spacing: { after: 240 }, children: str(m.author, { size: 38 }) })] : []),
      ...(m.abstract ? [new D.Paragraph({ indent: { right: cm(4) }, alignment: D.AlignmentType.JUSTIFIED, spacing: { after: 240 }, children: runs(m.abstract) })] : []),
      ...(m.date ? [new D.Paragraph({ children: str(viDate(m.date_format)) })] : []),
    ] });
    const front = [];
    if (m.preface) front.push(heading(1, [{ text: vi ? "Lời nói đầu" : "Preface" }], { numbered: false, outline: false }), ...m.preface.flatMap(block), new D.Paragraph({ children: [new D.PageBreak()] }));
    if (m.toc) front.push(...toc());
    const footer = new D.Footer({ children: [pageNo(D.AlignmentType.RIGHT)] });
    if (front.length) secs.push({ properties: page(), children: front });
    const body = sections(m.sections, { chapterBreak: m.chapter_pagebreak });
    if (m.appendix) {
      body.push(heading(1, [{ text: m.appendix.title }], { numbered: false, pageBreak: true }));
      appendixMode = true; counters.fill(0);
      body.push(...sections(m.appendix.sections));
    }
    body.push(...references());
    secs.push({ properties: { ...page(), page: { ...page().page, pageNumbers: { start: 1 } } }, footers: { default: footer }, children: body });
  } else {
    const authors = m.authors ?? [];
    const rowsOf = [];
    for (let i = 0; i < authors.length; i += 3) rowsOf.push(authors.slice(i, i + 3));
    const W = THEME.page.width - THEME.margin.left - THEME.margin.right;
    const authorTables = rowsOf.map((row) => new D.Table({
      width: { size: W, type: D.WidthType.DXA }, columnWidths: row.map(() => Math.floor(W / row.length)), layout: D.TableLayoutType.FIXED,
      borders: D.TableBorders.NONE,
      rows: [new D.TableRow({ children: row.map((a) => new D.TableCell({ width: { size: Math.floor(W / row.length), type: D.WidthType.DXA }, children: [new D.Paragraph({
        alignment: D.AlignmentType.CENTER, spacing: { after: 160 },
        children: [
          ...str(a.name, { size: 22 }),
          ...["department", "organization", "location", "email"].filter((k) => a[k]).flatMap((k) => [new D.TextRun({ text: "", break: 1 }), ...str(a[k], { italics: k === "department" || k === "organization" || undefined })]),
        ],
      })] })) })],
    }));
    const lead = [];
    if (m.abstract) {
      lead.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, indent: { firstLine: 200 }, children: [...str(vi ? "Tóm tắt" : "Abstract", { bold: true, italics: true, size: 18 }), ...str("—", { bold: true, size: 18 }), ...runs(m.abstract, { bold: true, size: 18 })] }));
      if (m.keywords?.length) lead.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, indent: { firstLine: 200 }, children: [...str(vi ? "Từ khóa" : "Index Terms", { bold: true, italics: true, size: 18 }), ...str(`—${m.keywords.join(", ")}`, { bold: true, size: 18 })] }));
    }
    secs.push({ properties: page(), children: [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 300, line: 240, lineRule: D.LineRuleType.AUTO }, children: str(m.title, { size: 48 }) }),
      ...authorTables,
    ] });
    secs.push({ properties: { ...page(), type: D.SectionType.CONTINUOUS, column: { count: 2, space: 280 } }, children: [...lead, ...sections(m.sections), ...references()] });
  }
  return secs;
}

const H = (lv) => ({
  run: { font: THEME.head, size: THEME.sizes[lv - 1], bold: THEME.headBold, color: THEME.headInk, italics: tpl === "charged-ieee" && lv >= 2 ? true : undefined },
  paragraph: { spacing: { before: lv === 1 ? 360 : 240, after: 120 }, keepNext: true, keepLines: true },
});
const doc = new D.Document({
  creator: m.author ?? (m.authors ?? []).map((a) => a.name).join(", ") ?? "",
  title: m.title,
  pageNumbers: estimatePageNumbersWith({ guess: true }),
  styles: {
    default: {
      document: {
        run: { font: THEME.body, size: THEME.size, color: THEME.ink, language: { value: vi ? "vi-VN" : "en-US" } },
        paragraph: { spacing: { after: tpl === "charged-ieee" ? 60 : 120, line: tpl === "charged-ieee" ? 240 : 276, lineRule: D.LineRuleType.AUTO }, alignment: D.AlignmentType.JUSTIFIED, widowControl: true },
      },
      heading1: H(1), heading2: H(2), heading3: H(3),
      hyperlink: { run: { color: "1155CC", underline: {} } },
    },
    paragraphStyles: [
      // Trông như tiêu đề cấp 1 nhưng không vào mục lục (tên mục lục, lời nói đầu).
      { id: "PlainHeading", name: "Plain Heading", basedOn: "Normal", next: "Normal", run: H(1).run, paragraph: H(1).paragraph },
      { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", run: { font: THEME.head, size: tpl === "charged-ieee" ? 16 : 18, color: "333333" }, paragraph: { spacing: { before: 120, after: 80 } } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: "•", alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
      { reference: "numbered", levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: tpl === "charged-ieee" ? "%1)" : "%1.", alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
    ],
  },
  sections: build(),
});
fs.writeFileSync(outPath, await D.Packer.toBuffer(doc));
