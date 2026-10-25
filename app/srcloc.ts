// Giao diện ↔ mã nguồn (Alt+Click trong khung xem trước): trước khi chạy artifact, gắn vào mỗi thẻ thuộc tính
// data-sx-loc="dòng-đầu-dòng-cuối" theo đúng mã nguồn, để bấm vào một phần tử là biết nó nằm ở dòng nào.
// HTML / SVG: quét thẻ ở đây (không thêm dòng nào nên số dòng giữ nguyên). React: plugin Babel trong khung (artifactui.tsx).
// Chỉ dùng cho khung xem trước; bản tải về không có thuộc tính này.

export const LOC_ATTR = "data-sx-loc";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param", "keygen"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript"]);
const SKIP = new Set(["html", "head", "body", "meta", "link", "base", "script", "style", "title", "noscript", "template", "!doctype"]);

type Rec = { name: string; at: number; start: number; end: number };

/** Gắn data-sx-loc cho các thẻ trong trang HTML (hoặc SVG). Mã lỗi hay lạ thì trả nguyên bản. */
export function instrumentHtml(src: string): string {
  try {
    const recs: Rec[] = [], stack: Rec[] = [];
    let i = 0, line = 1;
    const n = src.length;
    const adv = (to: number) => { for (let k = i; k < to && k < n; k++) if (src.charCodeAt(k) === 10) line++; i = to; };
    while (i < n) {
      const lt = src.indexOf("<", i);
      if (lt === -1) break;
      adv(lt);
      if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); adv(e === -1 ? n : e + 3); continue; }
      if (src.startsWith("<![CDATA[", i)) { const e = src.indexOf("]]>", i + 9); adv(e === -1 ? n : e + 3); continue; }
      const c = src[i + 1] ?? "";
      if (c === "/") {
        const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(i, i + 200));
        if (!m) { adv(i + 1); continue; }
        const name = m[1].toLowerCase();
        const idx = stack.map((r) => r.name).lastIndexOf(name);
        if (idx !== -1) while (stack.length > idx) { const r = stack.pop()!; r.end = line; }
        adv(i + m[0].length);
        continue;
      }
      if (!/[a-zA-Z!]/.test(c)) { adv(i + 1); continue; }
      // Thẻ mở: đọc tới ">" (bỏ qua ">" nằm trong dấu nháy).
      const nm = /^<([a-zA-Z!][\w:-]*)/.exec(src.slice(i, i + 100));
      if (!nm) { adv(i + 1); continue; }
      const name = nm[1].toLowerCase();
      let j = i + nm[0].length, q = "";
      while (j < n) {
        const ch = src[j];
        if (q) { if (ch === q) q = ""; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === ">") break;
        j++;
      }
      if (j >= n) break;
      const self = src[j - 1] === "/" || VOID.has(name);
      const start = line;
      const rec: Rec = { name, at: i + nm[0].length, start, end: start };
      if (!SKIP.has(name) && !name.startsWith("!") && !/\sdata-sx-loc\s*=/.test(src.slice(i, j))) recs.push(rec);
      adv(j + 1);
      if (RAW.has(name)) {
        const close = src.toLowerCase().indexOf(`</${name}`, i);
        adv(close === -1 ? n : close);
        continue;
      }
      if (!self) stack.push(rec);
    }
    while (stack.length) stack.pop()!.end = line;
    let out = src;
    for (const r of recs.sort((a, b) => b.at - a.at)) out = `${out.slice(0, r.at)} ${LOC_ATTR}="${r.start}-${r.end}"${out.slice(r.at)}`;
    return out;
  } catch { return src; }
}

/** Bỏ data-sx-loc khỏi đoạn mã lấy từ khung xem trước (trước khi gửi cho model). */
export const stripLoc = (html: string) => html.replace(/\s+data-sx-loc="[^"]*"/g, "");

/** "45-52" → { start, end } hợp lệ trong phạm vi số dòng. */
export function parseLoc(v: unknown, lines: number): { start: number; end: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(String(v ?? ""));
  if (!m) return null;
  const start = Math.max(1, Math.min(lines, Number(m[1]))), end = Math.max(start, Math.min(lines, Number(m[2])));
  return { start, end };
}

/** Các dòng quanh vị trí (kèm số dòng) để gửi cho model thay vì cả tệp. */
export function snippet(content: string, loc: { start: number; end: number }, ctx = 2, max = 60): string {
  const L = content.split("\n");
  const a = Math.max(1, loc.start - ctx), b = Math.min(L.length, Math.max(loc.end, loc.start) + ctx, a + max - 1);
  return L.slice(a - 1, b).map((l, k) => `${String(a + k).padStart(4)} | ${l}`).join("\n");
}
