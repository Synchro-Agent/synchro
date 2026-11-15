// Tài liệu đã hiện trong khung xem (Markdown đã dựng) → danh sách khối đơn giản để máy chủ tạo tệp Word thật (server/mddocx.ts). Chạy ở trình duyệt.
export type Run = { t: string; b?: 1; i?: 1; u?: 1; s?: 1; code?: 1; href?: string; br?: 1 };
export type DocBlock =
  | { k: "h"; level: number; runs: Run[] } | { k: "p"; runs: Run[] } | { k: "quote"; runs: Run[] }
  | { k: "li"; ordered: boolean; level: number; list: number; runs: Run[] }
  | { k: "code"; text: string } | { k: "hr" }
  | { k: "table"; rows: { head: boolean; cells: Run[][] }[] }
  | { k: "img"; src?: string; svg?: string; alt?: string };

const BLOCK = /^(H[1-6]|P|UL|OL|LI|PRE|BLOCKQUOTE|HR|TABLE|DIV|SECTION|ARTICLE|FIGURE|FIGCAPTION|HEADER|FOOTER|MAIN|ASIDE|DETAILS|SUMMARY|DL|DT|DD)$/;
const SKIP = /^(BUTTON|SCRIPT|STYLE|TEMPLATE|INPUT|SELECT|TEXTAREA)$/;
const tagOf = (n: Element) => n.tagName.toUpperCase();

function runsOf(n: Node, f: Omit<Run, "t"> = {}, out: Run[] = []): Run[] {
  n.childNodes.forEach((c) => {
    if (c.nodeType === 3) { const t = (c.textContent ?? "").replace(/\s+/g, " "); if (t) out.push({ t, ...f }); return; }
    if (c.nodeType !== 1) return;
    const e = c as Element, tag = tagOf(e);
    if (SKIP.test(tag) || BLOCK.test(tag) || tag === "IMG" || tag === "SVG") return;
    if (tag === "BR") { out.push({ t: "", br: 1, ...f }); return; }
    const g: Omit<Run, "t"> = { ...f };
    if (tag === "STRONG" || tag === "B") g.b = 1;
    if (tag === "EM" || tag === "I") g.i = 1;
    if (tag === "U") g.u = 1;
    if (tag === "S" || tag === "DEL") g.s = 1;
    if (tag === "CODE" || tag === "KBD") g.code = 1;
    if (tag === "A") { const h = e.getAttribute("href") ?? ""; if (/^(https?:|mailto:)/i.test(h)) g.href = h; }
    runsOf(e, g, out);
  });
  return out;
}
// Bỏ khoảng trắng thừa đầu / cuối đoạn do mã HTML xuống dòng.
function trim(r: Run[]) {
  while (r.length && !r[0].br && !r[0].t.trim()) r.shift();
  while (r.length && !r[r.length - 1].br && !r[r.length - 1].t.trim()) r.pop();
  if (r[0]) r[0] = { ...r[0], t: r[0].t.replace(/^\s+/, "") };
  if (r.length) { const l = r[r.length - 1]; r[r.length - 1] = { ...l, t: l.t.replace(/\s+$/, "") }; }
  return r;
}

export function htmlToBlocks(root: Element): DocBlock[] {
  const out: DocBlock[] = [];
  let lists = 0;
  const media = (e: Element) => {
    const tag = tagOf(e);
    if (tag === "IMG") { const src = e.getAttribute("src") ?? ""; if (src) out.push({ k: "img", src, alt: e.getAttribute("alt") ?? "" }); return true; }
    if (tag === "SVG") { out.push({ k: "img", svg: e.outerHTML }); return true; }
    return false;
  };
  const inner = (e: Element, quote: boolean) => {
    // Nội dung lẫn lộn: chữ rời đi thành đoạn, khối con đi theo thứ tự.
    let loose: Element | null = null;
    const flush = () => { if (loose) { const r = trim(runsOf(loose)); if (r.length) out.push(quote ? { k: "quote", runs: r } : { k: "p", runs: r }); loose = null; } };
    e.childNodes.forEach((c) => {
      const el = c.nodeType === 1 ? (c as Element) : null;
      if (el && (BLOCK.test(tagOf(el)) || tagOf(el) === "IMG" || tagOf(el) === "SVG")) { flush(); walk(el, quote); return; }
      if (el && SKIP.test(tagOf(el))) return;
      if (c.nodeType === 1 || c.nodeType === 3) { (loose ??= e.ownerDocument.createElement("div")).appendChild(c.cloneNode(true)); }
    });
    flush();
  };
  const list = (e: Element, level: number) => {
    const ordered = tagOf(e) === "OL", id = ++lists;
    [...e.children].forEach((li) => {
      if (tagOf(li) !== "LI") return;
      const holder = li.ownerDocument.createElement("div");
      const nested: Element[] = [], others: Element[] = [];
      li.childNodes.forEach((c) => {
        const el = c.nodeType === 1 ? (c as Element) : null;
        if (el && /^(UL|OL)$/.test(tagOf(el))) nested.push(el);
        else if (el && /^(P|DIV)$/.test(tagOf(el))) el.childNodes.forEach((x) => holder.appendChild(x.cloneNode(true)));
        else if (el && (BLOCK.test(tagOf(el)) || tagOf(el) === "IMG" || tagOf(el) === "SVG")) others.push(el);
        else holder.appendChild(c.cloneNode(true));
      });
      out.push({ k: "li", ordered, level: Math.min(level, 8), list: id, runs: trim(runsOf(holder)) });
      others.forEach((x) => walk(x, false));
      nested.forEach((x) => list(x, level + 1));
    });
  };
  const walk = (e: Element, quote: boolean) => {
    const tag = tagOf(e);
    if (SKIP.test(tag) || media(e)) return;
    const h = /^H([1-6])$/.exec(tag);
    if (h) { const r = trim(runsOf(e)); if (r.length) out.push({ k: "h", level: +h[1], runs: r }); return; }
    if (tag === "HR") { out.push({ k: "hr" }); return; }
    if (tag === "PRE") { out.push({ k: "code", text: (e.textContent ?? "").replace(/\n$/, "") }); return; }
    if (tag === "UL" || tag === "OL") { list(e, 0); return; }
    if (tag === "BLOCKQUOTE") { inner(e, true); return; }
    if (tag === "TABLE") {
      const rows = [...e.querySelectorAll("tr")].map((tr) => ({ head: !!tr.closest("thead") || (tr.children.length > 0 && [...tr.children].every((c) => tagOf(c) === "TH")), cells: [...tr.children].map((c) => trim(runsOf(c))) }));
      if (rows.length) out.push({ k: "table", rows });
      return;
    }
    if (tag === "P") {
      const pics = [...e.children].filter((c) => tagOf(c) === "IMG" || tagOf(c) === "SVG");
      const r = trim(runsOf(e));
      if (r.length) out.push(quote ? { k: "quote", runs: r } : { k: "p", runs: r });
      pics.forEach(media);
      return;
    }
    inner(e, quote);
  };
  inner(root, false);
  return out;
}
