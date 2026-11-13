// 4 mẫu Word dựng thẳng bằng thư viện docx (MIT, cùng gói với render.mjs): hợp đồng, biên bản họp, báo cáo có mục lục, CV.
// Đọc mô hình nội dung synchro-doc đã kiểm và chuẩn hóa (schemas/word.json + khối dùng chung của typst.json), không đọc payload thô.
// Hợp đồng, biên bản, báo cáo theo thể thức Nghị định 30/2020 (Phụ lục I): A4, lề trên / dưới 2 cm, trái 3 cm, phải 2 cm, Times New Roman,
// quốc hiệu và tiêu ngữ có đường kẻ, số trang giữa lề trên từ trang 2. CV: một cột Calibri, máy lọc hồ sơ đọc được, mốc thời gian căn phải.
// Mục lục của báo cáo điền sẵn số trang khi có docx/layout (docx 9.15+); bản cũ hơn thì Word tự cập nhật khi mở.
// Dùng: node word.mjs model.json out.docx <thư mục làm việc>
import fs from "node:fs";
import path from "node:path";
import * as D from "docx";

const [modelPath, outPath, root] = process.argv.slice(2);
if (!modelPath || !outPath || !root) { console.error("dùng: node word.mjs model.json out.docx <thư mục làm việc>"); process.exit(2); }
const m = JSON.parse(fs.readFileSync(modelPath, "utf8"));
const tpl = m.template;
if (!["contract", "minutes", "official-report", "cv"].includes(tpl)) { console.error(`mẫu không có: ${tpl}`); process.exit(2); }
const vi = m.lang !== "en";
let layout = null;
try { layout = await import("docx/layout"); } catch { /* docx < 9.15: Word cập nhật mục lục khi mở */ }

const cm = (x) => Math.round(x * 567);
const A4 = { width: 11906, height: 16838 };
const CV = tpl === "cv";
const T = CV
  ? { font: "Calibri", size: 21, ink: "222222", accent: (m.accent || "1F4E79").toUpperCase(), muted: "595959", margin: { top: cm(1.6), bottom: cm(1.6), left: cm(1.9), right: cm(1.9), header: cm(0.8), footer: cm(0.8) } }
  : { font: "Times New Roman", size: 26, ink: "000000", accent: "000000", muted: "000000", margin: { top: cm(2), bottom: cm(2), left: cm(3), right: cm(2), header: cm(1), footer: cm(1) } };
const W = A4.width - T.margin.left - T.margin.right;
const L = vi
  ? { qh: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", tn: "Độc lập - Tự do - Hạnh phúc", no: "Số", rep: "Đại diện", pos: "Chức vụ", addr: "Địa chỉ", tax: "Mã số thuế", id: "CCCD", phone: "Điện thoại", email: "Email", bank: "Tài khoản", art: "Điều", sign: "ĐẠI DIỆN",
      start: "Thời gian bắt đầu", loc: "Địa điểm", who: "Thành phần tham dự", absent: "Vắng mặt", chair: "Chủ trì", sec: "Thư ký", agenda: "Chương trình họp", content: "Nội dung cuộc họp", decide: "Kết luận cuộc họp", act: "Phân công thực hiện",
      actCols: ["STT", "Nội dung công việc", "Người phụ trách", "Thời hạn"], chairSign: "CHỦ TRÌ", secSign: "THƯ KÝ", signNote: "(Ký, ghi rõ họ tên)", nn: "Nơi nhận:", toc: "MỤC LỤC",
      sum: "Giới thiệu", exp: "Kinh nghiệm làm việc", edu: "Học vấn", skills: "Kỹ năng", langs: "Ngoại ngữ", certs: "Chứng chỉ", proj: "Dự án", now: "nay", table: "Bảng", fig: "Hình" }
  : { qh: "SOCIALIST REPUBLIC OF VIETNAM", tn: "Independence - Freedom - Happiness", no: "No.", rep: "Represented by", pos: "Position", addr: "Address", tax: "Tax ID", id: "ID", phone: "Phone", email: "Email", bank: "Bank account", art: "Article", sign: "FOR",
      start: "Started at", loc: "Location", who: "Attendees", absent: "Absent", chair: "Chair", sec: "Secretary", agenda: "Agenda", content: "Discussion", decide: "Conclusions", act: "Action items",
      actCols: ["No.", "Task", "Owner", "Due"], chairSign: "CHAIR", secSign: "SECRETARY", signNote: "(Signature and full name)", nn: "Recipients:", toc: "CONTENTS",
      sum: "Summary", exp: "Experience", edu: "Education", skills: "Skills", langs: "Languages", certs: "Certifications", proj: "Projects", now: "Present", table: "Table", fig: "Figure" };

// ---------------------------------------------------------------- chữ
function runs(rs, x = {}) {
  const out = [];
  for (const r of rs ?? []) {
    const parts = String(r.text).split("\n");
    const children = parts.map((t, i) => new D.TextRun({
      text: t, break: i > 0 ? 1 : undefined, bold: r.bold || x.bold || undefined, italics: r.italic || x.italics || undefined,
      font: r.code ? "Consolas" : x.font, size: x.size, color: r.link ? "1155CC" : x.color, underline: r.link ? {} : undefined, allCaps: x.caps || undefined,
    }));
    if (r.link) out.push(new D.ExternalHyperlink({ link: r.link, children }));
    else out.push(...children);
  }
  return out;
}
const str = (s, x) => runs([{ text: String(s ?? "") }], x);
const P = (children, o = {}) => new D.Paragraph({ children, ...o });
const center = (s, x = {}, o = {}) => P(str(s, x), { alignment: D.AlignmentType.CENTER, spacing: { before: 0, after: 0 }, ...o });
const blank = (n = 1) => Array.from({ length: n }, () => P([], { spacing: { before: 0, after: 0 } }));
// Đường kẻ ngắn dưới tên cơ quan / tiêu ngữ / trích yếu: viền dưới của đoạn trống thụt hai bên (cách của app/vbhcdocx.ts).
const rule = (side, before = 0) => P([new D.TextRun({ text: " ", size: 2 })], { spacing: { before, after: 0, line: 120 }, indent: { left: side, right: side }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } } });
const NONE = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NOB = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
function cols(widths, cells, o = {}) {
  return new D.Table({
    layout: D.TableLayoutType.FIXED, width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: widths, borders: NOB,
    rows: [new D.TableRow({ cantSplit: !!o.keep, children: cells.map((c, i) => new D.TableCell({ width: { size: widths[i], type: D.WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, verticalAlign: o.valign, children: c.length ? c : [P([])] })) })],
  });
}

// ---------------------------------------------------------------- khối nội dung (cùng hợp đồng với các mẫu Typst)
let listNo = 0, tableNo = 0, figNo = 0;
const ADMIN_P = CV ? {} : { alignment: D.AlignmentType.JUSTIFIED, indent: { firstLine: cm(1) } };
const RULE = (size, color) => ({ style: D.BorderStyle.SINGLE, size, color });
const caption = (label, n, rs) => P([...str(`${label} ${n}: `, { italics: true }), ...runs(rs, { italics: true })], { alignment: D.AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 } });

function table(b) {
  const n = b.columns.length;
  const plain = (rs) => (rs ?? []).map((r) => r.text).join("");
  const weights = b.widths ?? b.columns.map((c, j) => Math.min(Math.max(Math.max(plain(c).length, ...b.rows.map((r) => plain(r[j]).length)), 4), 40) * (j === 0 ? 1.2 : 1));
  const sum = weights.reduce((a, x) => a + x, 0);
  // Hẹp hơn vùng chữ một chút: viền ngoài không tràn ra lề phải.
  const TW = W - 40, widths = weights.map((x) => Math.floor((x / sum) * TW));
  const AL = { left: D.AlignmentType.LEFT, right: D.AlignmentType.RIGHT, center: D.AlignmentType.CENTER };
  const line = RULE(4, CV ? "BFBFBF" : "000000");
  const last = b.total && b.rows.length > 1 ? b.rows.length - 1 : -1;
  const cell = (rs, j, o = {}) => new D.TableCell({
    width: { size: widths[j], type: D.WidthType.DXA }, margins: { top: 40, bottom: 40, left: 90, right: 90 }, verticalAlign: D.VerticalAlign.CENTER,
    shading: o.head ? { type: D.ShadingType.CLEAR, fill: CV ? "EAF1F8" : "F2F2F2", color: "auto" } : undefined,
    children: [P(runs(rs, { bold: o.bold, size: CV ? 19 : 24 }), { alignment: o.head ? D.AlignmentType.CENTER : AL[b.align?.[j] ?? "left"], spacing: { before: 0, after: 0 } })],
  });
  const out = [];
  tableNo++;
  if (b.caption) out.push(caption(L.table, tableNo, b.caption));
  out.push(new D.Table({
    width: { size: widths.reduce((a, x) => a + x, 0), type: D.WidthType.DXA }, columnWidths: widths, layout: D.TableLayoutType.FIXED,
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: [
      new D.TableRow({ tableHeader: true, cantSplit: true, children: b.columns.map((c, j) => cell(c, j, { bold: true, head: true })) }),
      ...b.rows.map((r, i) => new D.TableRow({ cantSplit: true, children: r.slice(0, n).map((c, j) => cell(c, j, { bold: i === last })) })),
    ],
  }));
  out.push(P([], { spacing: { before: 0, after: 80 } }));
  return out;
}

function image(b) {
  const file = path.join(root, b.path);
  const ext = path.extname(file).toLowerCase().slice(1);
  const type = ext === "jpeg" ? "jpg" : ext;
  if (!["png", "jpg", "gif", "bmp"].includes(type)) throw new Error(`ảnh không đọc được trong Word: ${b.path}`);
  const [pw, ph] = b.px ?? [800, 600];
  const w = Math.round(((W / 1440) * 96 * (b.width ?? 100)) / 100), h = Math.round((w * ph) / pw);
  const out = [P([new D.ImageRun({ type, data: fs.readFileSync(file), transformation: { width: w, height: h } })], { alignment: D.AlignmentType.CENTER, keepNext: !!b.caption || undefined })];
  if (b.caption) out.push(caption(L.fig, ++figNo, b.caption));
  return out;
}

function block(b) {
  switch (b.type) {
    case "paragraph": return [P(runs(b.text), ADMIN_P)];
    case "heading": return [P(runs(b.text, { bold: true, italics: (b.level ?? 2) >= 3 || undefined }), { keepNext: true, spacing: { before: 120, after: 60 } })];
    case "bullets":
    case "numbered": {
      const inst = ++listNo;
      return b.items.map((it) => P(runs(it), { numbering: { reference: b.type, level: 0, instance: inst }, spacing: { after: 40 }, alignment: CV ? undefined : D.AlignmentType.JUSTIFIED }));
    }
    case "table": return table(b);
    case "image": return image(b);
    case "quote": {
      const out = [P(runs(b.text, { italics: true }), { indent: { left: 720, right: 720 }, spacing: { after: b.by ? 0 : 120 } })];
      if (b.by) out.push(P(str(`— ${b.by}`), { alignment: D.AlignmentType.RIGHT, indent: { right: 720 } }));
      return out;
    }
    case "callout": return [P([...(b.title ? [...str(b.title, { bold: true }), new D.TextRun({ text: "", break: 1 })] : []), ...runs(b.text)], {
      shading: { type: D.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" }, border: { left: { style: D.BorderStyle.SINGLE, size: 24, color: CV ? T.accent : "808080", space: 8 } }, indent: { left: 200 }, keepLines: true })];
    case "code": return [P(str(b.text, { font: "Consolas", size: 18 }), { shading: { type: D.ShadingType.CLEAR, fill: "F5F5F5", color: "auto" }, keepLines: true })];
    case "pagebreak": return [P([new D.PageBreak()])];
    default: return [];
  }
}
const blocks = (list) => (list ?? []).flatMap(block);

// ---------------------------------------------------------------- phần đầu theo thể thức
const HL = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3];
const heading = (level, children, o = {}) => P(children, { heading: HL[Math.min(Math.max(level, 1), 3) - 1], keepNext: true, keepLines: true, ...o });
const nationalRight = () => [center(L.qh, { bold: true, size: 24 }), center(L.tn, { bold: true, size: 26 }), rule(cm(1.6))];
// Đầu văn bản hai cột: tên cơ quan, số ký hiệu (trái); quốc hiệu, tiêu ngữ, địa danh ngày tháng (phải).
function adminHeader() {
  const lw = cm(6.4), rw = W - lw;
  const left = [
    ...(m.parent_org ? [center(m.parent_org, { size: 26 })] : []),
    ...(m.organization ? [center(m.organization, { size: 26, bold: true }), rule(cm(1.9))] : []),
    ...(m.number ? [center(`${L.no}: ${m.number}`, { size: 26 }, { spacing: { before: 120, after: 0 } })] : []),
  ];
  const right = [...(m.national_header ? nationalRight() : []), ...(m.date_line ? [center(m.date_line, { size: 26, italics: true }, { spacing: { before: 240, after: 0 } })] : [])];
  return cols([lw, rw], [left, right]);
}
function titleBlock(kind, sub) {
  return [
    center(kind, { bold: true, size: 28 }, { spacing: { before: 360, after: 0 } }),
    ...(sub ? [center(sub, { bold: true, size: 28 })] : []),
    rule(Math.round(W * 0.38), 40),
    P([], { spacing: { before: 0, after: 120 } }),
  ];
}
const labelLine = (label, value, o = {}) => P([...str(`${label}: `, { bold: o.boldLabel ?? false }), ...(Array.isArray(value) ? value : str(value, o.x))], { spacing: { after: 40 }, keepNext: o.keepNext });
const bold = (s, o = {}) => P(str(s, { bold: true }), { keepNext: true, spacing: { before: 120, after: 60 }, ...o });
const who = (p) => `${p.name}${p.position ? `, ${p.position}` : ""}`;
function signatures(list) {
  const w = Math.floor(W / list.length);
  return cols(list.map(() => w), list.map((s) => [
    ...(s.authority ? [center(s.authority, { bold: true })] : []),
    center(s.title, { bold: true }),
    ...(s.note ? [center(s.note, { italics: true, size: 22 })] : []),
    ...blank(4),
    center(s.name ?? "", { bold: true }),
  ]), { keep: true });
}
// Số trang giữa lề trên, từ trang 2 (trang đầu không đánh số).
const pageHeaders = () => ({
  headers: { default: new D.Header({ children: [P([new D.TextRun({ children: [D.PageNumber.CURRENT], size: 26 })], { alignment: D.AlignmentType.CENTER })] }), first: new D.Header({ children: [P([])] }) },
});

// ---------------------------------------------------------------- từng mẫu
function contract() {
  const out = [];
  if (m.national_header) out.push(center(L.qh, { bold: true, size: 26 }), center(L.tn, { bold: true, size: 26 }), rule(cm(5.3)));
  out.push(center(m.title, { bold: true, size: 30, caps: true }, { spacing: { before: 360, after: 0 } }));
  if (m.number) out.push(center(`${L.no}: ${m.number}`, { italics: true }, { spacing: { before: 60, after: 120 } }));
  else out.push(P([], { spacing: { after: 120 } }));
  for (const c of m.legal_bases ?? []) out.push(P(str(c, { italics: true }), { ...ADMIN_P, spacing: { after: 40 } }));
  out.push(P(str(m.intro), { ...ADMIN_P, spacing: { before: 120, after: 120 } }));
  for (const p of m.parties) {
    out.push(P([...str(`${p.label}: `, { bold: true }), ...str(p.name, { bold: true })], { keepNext: true, spacing: { before: 120, after: 60 } }));
    const rows = [[L.addr, p.address], [L.tax, p.tax_id], [L.id, p.id_number], [L.rep, p.representative && (p.position ? `${p.representative}    ${L.pos}: ${p.position}` : p.representative)],
      [L.phone, p.phone], [L.email, p.email], [L.bank, p.bank_account], ...(p.extra ?? []).map((e) => [e.label, e.value])].filter(([, v]) => v);
    rows.forEach(([k, v], i) => out.push(P(str(`${k}: ${v}`), { indent: { left: cm(0.5) }, spacing: { after: 20 }, keepNext: i < rows.length - 1 })));
  }
  out.push(P(str(m.agreement), { ...ADMIN_P, spacing: { before: 120, after: 120 } }));
  m.articles.forEach((a, i) => {
    out.push(heading(2, [...str(`${L.art} ${i + 1}. `, { bold: true }), ...runs(a.heading ?? [], { bold: true })], { spacing: { before: 180, after: 60 } }));
    out.push(...blocks(a.blocks));
  });
  out.push(P(str(m.closing), { ...ADMIN_P, spacing: { before: 180, after: 240 } }));
  out.push(signatures(m.parties.map((p) => ({ title: `${L.sign} ${p.short}`, note: m.signature_note, name: p.representative ?? "" }))));
  return [{ properties: { titlePage: true, page: { size: A4, margin: T.margin } }, ...pageHeaders(), children: out }];
}

function minutes() {
  const out = [adminHeader(), ...titleBlock(m.title, m.subject)];
  if (m.time_line) out.push(labelLine(L.start, m.time_line, { boldLabel: true }));
  if (m.location) out.push(labelLine(L.loc, m.location, { boldLabel: true }));
  if (m.chair) out.push(labelLine(L.chair, who(m.chair), { boldLabel: true }));
  if (m.secretary) out.push(labelLine(L.sec, who(m.secretary), { boldLabel: true }));
  out.push(bold(`${L.who}:`, { spacing: { before: 60, after: 40 } }), ...m.attendees.map((p) => P(str(`- ${who(p)}`), { indent: { left: cm(0.5) }, spacing: { after: 20 } })));
  if (m.absent?.length) out.push(bold(`${L.absent}:`, { spacing: { before: 60, after: 40 } }), ...m.absent.map((p) => P(str(`- ${who(p)}`), { indent: { left: cm(0.5) }, spacing: { after: 20 } })));
  if (m.agenda?.length) { out.push(heading(2, str(`${L.agenda}:`, { bold: true }), { spacing: { before: 180, after: 60 } })); out.push(...block({ type: "numbered", items: m.agenda })); }
  if (m.sections?.length) {
    out.push(heading(2, str(`${L.content}:`, { bold: true }), { spacing: { before: 180, after: 60 } }));
    m.sections.forEach((s, i) => { if (s.heading) out.push(heading(3, [...str(`${i + 1}. `, { bold: true }), ...runs(s.heading, { bold: true, italics: true })], { spacing: { before: 120, after: 40 } })); out.push(...blocks(s.blocks)); });
  }
  if (m.decisions?.length) { out.push(heading(2, str(`${L.decide}:`, { bold: true }), { spacing: { before: 180, after: 60 } })); out.push(...block({ type: "numbered", items: m.decisions })); }
  if (m.actions?.length) {
    out.push(heading(2, str(`${L.act}:`, { bold: true }), { spacing: { before: 180, after: 60 } }));
    out.push(...table({ columns: L.actCols.map((t) => [{ text: t }]), rows: m.actions.map((a, i) => [[{ text: String(i + 1) }], a.task, [{ text: a.owner }], [{ text: a.due ?? "" }]]), align: ["center", "left", "left", "center"], widths: [9, 48, 25, 18] }));
  }
  out.push(P(str(m.closing), { ...ADMIN_P, spacing: { before: 180, after: 240 } }));
  out.push(signatures([{ title: L.secSign, note: L.signNote, name: m.secretary?.name ?? "" }, { title: L.chairSign, note: L.signNote, name: m.chair?.name ?? "" }]));
  return [{ properties: { titlePage: true, page: { size: A4, margin: T.margin } }, ...pageHeaders(), children: out }];
}

const ROMAN = (n) => [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");
function report() {
  const head = [adminHeader(), ...titleBlock(vi ? "BÁO CÁO" : "REPORT", m.title)];
  const body = [];
  if (m.intro?.length) body.push(...blocks(m.intro));
  const c = [0, 0, 0];
  for (const s of m.sections) {
    const lv = Math.min(Math.max(s.level ?? 1, 1), 3);
    if (s.heading) {
      c[lv - 1]++; for (let i = lv; i < 3; i++) c[i] = 0;
      const pre = lv === 1 ? `${ROMAN(c[0])}. ` : lv === 2 ? `${c[1]}. ` : `${String.fromCharCode(96 + c[2])}) `;
      body.push(heading(lv, [...str(pre, { bold: true, italics: lv === 3 || undefined }), ...runs(s.heading, { bold: true, italics: lv === 3 || undefined })], { spacing: { before: lv === 1 ? 240 : 120, after: 60 } }));
    }
    body.push(...blocks(s.blocks));
  }
  body.push(P([], { spacing: { after: 240 } }));
  const lw = Math.round(W * 0.45);
  body.push(cols([lw, W - lw], [
    [P(str(L.nn, { bold: true, italics: true, size: 24 })), ...m.recipients.map((r) => P(str(`- ${r}`, { size: 22 }), { spacing: { after: 0 } }))],
    [...(m.signer.authority ? [center(m.signer.authority, { bold: true, size: 28 })] : []), center(m.signer.title, { bold: true, size: 28 }), ...blank(4), center(m.signer.name, { bold: true, size: 28 })],
  ], { keep: true }));
  const page = { size: A4, margin: T.margin };
  if (!m.toc) return [{ properties: { titlePage: true, page }, ...pageHeaders(), children: [...head, ...body] }];
  // Mục lục ngay dưới tên báo cáo ở trang đầu; nội dung bắt đầu từ trang mới.
  const toc = [center(m.toc_title, { bold: true, size: 26 }, { spacing: { before: 120, after: 120 } }), new D.TableOfContents(m.toc_title, { hyperlink: true, headingStyleRange: "1-3" }), P([new D.PageBreak()])];
  return [{ properties: { titlePage: true, page }, ...pageHeaders(), children: [...head, ...toc, ...body] }];
}

function cv() {
  const out = [];
  const contact = ["phone", "email", "location", "website", "linkedin", "github"].map((k) => m.contact?.[k]).filter(Boolean);
  const top = [
    P(str(m.name, { bold: true, size: 52, color: T.accent }), { spacing: { after: 40 } }),
    ...(m.headline ? [P(str(m.headline, { size: 26, color: T.muted }), { spacing: { after: 60 } })] : []),
    ...(contact.length ? [P(str(contact.join("  ·  "), { size: 19, color: "404040" }), { spacing: { after: 0 } })] : []),
  ];
  if (m.photo) {
    const pw = cm(3.2), [px, py] = m.photo.px ?? [3, 4];
    const ext = path.extname(m.photo.path).toLowerCase().slice(1);
    const img = P([new D.ImageRun({ type: ext === "jpeg" ? "jpg" : ext, data: fs.readFileSync(path.join(root, m.photo.path)), transformation: { width: 116, height: Math.round((116 * py) / px) } })], { alignment: D.AlignmentType.RIGHT });
    out.push(cols([W - pw, pw], [top, [img]], { valign: D.VerticalAlign.CENTER }));
  } else out.push(...top);
  const sec = (t) => out.push(heading(1, str(t, { bold: true, size: 22, color: T.accent, caps: true }), {
    spacing: { before: 280, after: 100 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: T.accent, space: 2 } } }));
  const dated = (left, when) => P([...left, ...(when ? [new D.TextRun({ text: "\t" }), ...str(when, { size: 19, color: T.muted })] : [])], { tabStops: [{ type: D.TabStopType.RIGHT, position: W }], keepNext: true, spacing: { before: 120, after: 20 } });
  const span = (a, b) => [a, b].filter(Boolean).join(" – ");
  if (m.summary?.length) { sec(L.sum); out.push(P(runs(m.summary), { spacing: { after: 60 } })); }
  if (m.experience?.length) {
    sec(L.exp);
    for (const e of m.experience) {
      out.push(dated([...str(e.role, { bold: true }), ...str(`  ·  ${e.org}`, { color: T.accent })], span(e.start, e.end)));
      if (e.location) out.push(P(str(e.location, { italics: true, size: 19, color: T.muted }), { keepNext: true, spacing: { after: 40 } }));
      if (e.text?.length) out.push(P(runs(e.text), { spacing: { after: 40 } }));
      if (e.bullets?.length) out.push(...block({ type: "bullets", items: e.bullets }));
    }
  }
  if (m.education?.length) {
    sec(L.edu);
    for (const e of m.education) {
      out.push(dated([...str(e.degree, { bold: true }), ...str(`  ·  ${e.school}`, { color: T.accent })], span(e.start, e.end)));
      if (e.detail?.length) out.push(P(runs(e.detail, { color: "404040" }), { spacing: { after: 40 } }));
    }
  }
  if (m.skills?.length) {
    sec(L.skills);
    const loose = m.skills.filter((s) => !s.group).flatMap((s) => s.items);
    for (const s of m.skills.filter((x) => x.group)) out.push(P([...str(`${s.group}: `, { bold: true }), ...str(s.items.join(", "))], { spacing: { after: 40 } }));
    if (loose.length) out.push(P(str(loose.join("  ·  ")), { spacing: { after: 40 } }));
  }
  if (m.languages?.length) { sec(L.langs); out.push(P(m.languages.flatMap((l, i) => [...(i ? str("   ·   ", { color: T.muted }) : []), ...str(l.name, { bold: true }), ...(l.level ? str(` (${l.level})`) : [])]), { spacing: { after: 40 } })); }
  if (m.certifications?.length) { sec(L.certs); out.push(...block({ type: "bullets", items: m.certifications })); }
  if (m.projects?.length) {
    sec(L.proj);
    for (const p of m.projects) out.push(P([...runs([{ text: p.name, bold: true, ...(p.link ? { link: p.link } : {}) }]), ...(p.text?.length ? [...str(" — "), ...runs(p.text)] : [])], { spacing: { after: 60 } }));
  }
  for (const s of m.sections ?? []) { if (s.heading) sec(s.heading.map((r) => r.text).join("")); out.push(...blocks(s.blocks)); }
  return [{ properties: { page: { size: A4, margin: T.margin } }, children: out }];
}

// ---------------------------------------------------------------- tài liệu
const H = (lv) => ({ run: { font: T.font, bold: true, color: CV ? T.accent : "000000", size: CV ? 22 : 26 }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 120, after: 60 } } });
const sections = tpl === "contract" ? contract() : tpl === "minutes" ? minutes() : tpl === "official-report" ? report() : cv();
const doc = new D.Document({
  creator: "Synchro", title: CV ? m.name : m.title, description: m.subject ?? undefined,
  ...(tpl === "official-report" && m.toc ? (layout ? { pageNumbers: layout.estimatePageNumbersWith({ guess: true }) } : { features: { updateFields: true } }) : {}),
  styles: {
    default: {
      document: {
        run: { font: T.font, size: T.size, color: T.ink, language: { value: vi ? "vi-VN" : "en-US" } },
        paragraph: { spacing: { before: 0, after: CV ? 40 : 80, line: CV ? 264 : 288, lineRule: D.LineRuleType.AUTO }, widowControl: true },
      },
      heading1: H(1), heading2: H(2), heading3: H(3),
      hyperlink: { run: { color: "1155CC", underline: {} } },
    },
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: CV ? "•" : "-", alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: CV ? 360 : cm(1.2), hanging: CV ? 240 : 280 } } } }] },
      { reference: "numbered", levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: "%1.", alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: CV ? 400 : cm(1.2), hanging: 340 } } } }] },
    ],
  },
  sections,
});
fs.writeFileSync(outPath, await D.Packer.toBuffer(doc));
