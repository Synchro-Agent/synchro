// Phân tích Markdown của câu trả lời model (CommonMark + GFM thường gặp, thêm công thức). Thuần dữ liệu, không React để kiểm thử không cần trình duyệt.
// Viết riêng thay vì dùng thư viện vì khung chat cần giữ khối riêng (code, biểu đồ, thẻ hỏi lại) và câu trả lời đang chảy chữ phải hiện được giữa chừng.
// Lệch có chủ ý so với CommonMark, đều vì model hay viết thế: --- sau đoạn văn luôn là đường kẻ, xuống dòng trong đoạn giữ nguyên,
// danh sách con thụt 2 cách dưới "1." vẫn là con, gạch đầu dòng sát lề ngay sau một bước đánh số là chi tiết của bước đó.

export type Inl =
  | string
  | { t: "strong" | "em" | "del" | "u" | "sub" | "sup" | "kbd" | "mark" | "span"; c: Inl[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inl[] }
  | { t: "img"; src: string; alt: string }
  | { t: "math"; v: string; display?: boolean }
  | { t: "fn"; id: string }
  | { t: "br" };

export type Align = "" | "left" | "center" | "right";
export type Item = { task?: boolean; done?: boolean; c: Block[] };
export type Block =
  | { t: "p"; s: string; n: number; end: number }
  | { t: "h"; level: number; s: string; n: number; end: number }
  | { t: "hr" }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Item[] }
  | { t: "table"; head: string[]; rows: string[][]; align: Align[] }
  | { t: "code"; lang: string; code: string; closed: boolean; idx: number }
  | { t: "math"; v: string }
  | { t: "fns"; items: { id: string; s: string }[] };
// Khối cấp ngoài cùng kèm chữ gốc: dựng lại chỉ khi chữ gốc đổi, câu trả lời đang chảy chữ chỉ dựng khối cuối.
export type Top = { b: Block; src: string; n: number; end: number };

// ---------------------------------------------------------------- nội dòng
const PUNCT = /[\p{P}\p{S}]/u, WORD = /[\p{L}\p{N}\p{M}]/u, DIGIT = /\p{Nd}/u, SPACE = /\s/u;
const ESC = /[!-/:-@[-`{-~]/;
const TAGS = new Set(["b", "strong", "i", "em", "u", "s", "del", "sub", "sup", "kbd", "mark"]);
const TAG_NODE: Record<string, "strong" | "em" | "del" | "u" | "sub" | "sup" | "kbd" | "mark"> = { b: "strong", strong: "strong", i: "em", em: "em", u: "u", s: "del", del: "del", sub: "sub", sup: "sup", kbd: "kbd", mark: "mark" };
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", mdash: "—", ndash: "–", copy: "©", reg: "®", trade: "™", times: "×", rarr: "→", larr: "←" };

type Delim = { d: true; ch: string; n: number; orig: number; open: boolean; close: boolean; seq: number };
type Tok = Inl | Delim;
const isDelim = (t: Tok): t is Delim => typeof t === "object" && "d" in t;
const lastChar = (s: string, i: number) => { if (i <= 0) return " "; const c = s.charCodeAt(i - 1); return c >= 0xdc00 && c <= 0xdfff && i > 1 ? s.slice(i - 2, i) : s[i - 1]; };
const nextChar = (s: string, i: number) => (i >= s.length ? " " : String.fromCodePoint(s.codePointAt(i)!));
const delimText = (t: Delim) => t.ch.repeat(t.n);

// Còn dấu * mở chưa có dấu đóng ở phía trước không ("**abc**1" thì ** sau là dấu đóng, "*x* 2*3" thì không).
function starOpen(ts: Tok[]): boolean {
  let c = 0;
  for (const t of ts) if (isDelim(t) && t.ch === "*") { if (t.close && c > 0) c = Math.max(0, c - t.n); else if (t.open) c += t.n; }
  return c > 0;
}

function flat(ts: Tok[]): Inl[] {
  const out: Inl[] = [];
  for (const t of ts) {
    if (isDelim(t)) { if (!t.n) continue; const s = delimText(t); if (typeof out[out.length - 1] === "string") out[out.length - 1] = (out[out.length - 1] as string) + s; else out.push(s); }
    else if (typeof t === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] = (out[out.length - 1] as string) + t;
    else out.push(t);
  }
  return out;
}

// Ghép dấu nhấn theo thuật toán chồng dấu của CommonMark: xử lý đúng ***x***, **đậm *nghiêng* đậm**, snake_case.
function emphasis(ts: Tok[]) {
  const bottom: Record<string, number> = {};
  for (let cl = 0; cl < ts.length; cl++) {
    const c = ts[cl];
    if (!isDelim(c) || !c.close || !c.n) continue;
    const key = c.ch + (c.open ? 1 : 0) + c.orig % 3;
    let op = -1;
    for (let k = cl - 1; k >= 0; k--) {
      const o = ts[k];
      if (!isDelim(o)) continue;
      if (o.seq <= (bottom[key] ?? -1)) break;
      if (o.ch !== c.ch || !o.open || !o.n) continue;
      if (c.ch !== "~" && (o.close || c.open) && (o.orig + c.orig) % 3 === 0 && !(o.orig % 3 === 0 && c.orig % 3 === 0)) continue;
      op = k; break;
    }
    if (op < 0) { bottom[key] = c.seq - 1; continue; }
    const o = ts[op] as Delim;
    const use = c.ch === "~" ? 2 : c.n >= 2 && o.n >= 2 ? 2 : 1;
    const node: Inl = { t: c.ch === "~" ? "del" : use === 2 ? "strong" : "em", c: flat(ts.slice(op + 1, cl)) };
    ts.splice(op + 1, cl - op - 1, node);
    o.n -= use; c.n -= use;
    cl = op + 2; // closer đang ở ngay sau node
    if (!o.n) { ts.splice(op, 1); cl--; }
    if (!c.n) { ts.splice(cl, 1); cl--; } else cl--;
  }
}

// Câu đang viết dở: dấu mở chưa có dấu đóng thì coi như đóng ở cuối, chữ không hiện "**" rồi mới đậm; dấu trần ở cuối chưa rõ nghĩa thì giấu.
function closeOpen(ts: Tok[]) {
  while (ts.length && isDelim(ts[ts.length - 1])) ts.pop();
  for (let k = ts.length - 1; k >= 0; k--) {
    const o = ts[k];
    if (!isDelim(o) || !o.open || !o.n) continue;
    let inner: Inl[] = flat(ts.slice(k + 1));
    if (o.ch === "~") inner = [{ t: "del", c: inner }];
    else {
      if (o.n % 2) inner = [{ t: "em", c: inner }];
      if (o.n >= 2) inner = [{ t: "strong", c: inner }];
    }
    ts.splice(k, ts.length - k, ...inner);
  }
}

function mathAt(s: string, i: number): { v: string; end: number; display?: boolean } | null {
  if (s[i] === "\\") {
    const close = s[i + 1] === "(" ? "\\)" : "\\]";
    const j = s.indexOf(close, i + 2);
    return j > i + 2 ? { v: s.slice(i + 2, j).trim(), end: j + 2, display: s[i + 1] === "[" } : null;
  }
  if (s[i + 1] === "$") {
    const j = s.indexOf("$$", i + 2);
    return j > i + 2 ? { v: s.slice(i + 2, j).trim(), end: j + 2, display: true } : null;
  }
  // $…$ dễ nhầm với tiền ("$5 đến $10", "US$5", "$HOME/bin:$PATH"): làm theo quy tắc của Pandoc, thêm điều kiện phải giống công thức.
  const nx = s[i + 1];
  if (!nx || SPACE.test(nx) || WORD.test(lastChar(s, i))) return null;
  let j = i + 1;
  for (; j < s.length; j++) { if (s[j] === "\\") { j++; continue; } if (s[j] === "$" || s[j] === "\n") break; }
  if (s[j] !== "$") return null;
  const v = s.slice(i + 1, j), pv = s[j - 1];
  if (SPACE.test(pv) || (s[j + 1] && DIGIT.test(s[j + 1])) || !(WORD.test(pv) || /[)\]}|'!]/.test(pv))) return null;
  if (!/[\\^_=+{}<>]/.test(v) && SPACE.test(v)) return null;
  return { v, end: j + 1 };
}

// Địa chỉ trần: dừng ở khoảng trắng, bỏ dấu câu cuối, ngoặc đóng thừa không thuộc địa chỉ.
function urlEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && !/[\s<>"“”‘’]/.test(s[j]) && !s.startsWith("**", j)) j++;
  for (;;) {
    const c = s[j - 1];
    if (/[.,;:!?'*_~\]…]/.test(c)) { j--; continue; }
    if (c === ")") { const u = s.slice(i, j); if ((u.match(/\)/g) ?? []).length > (u.match(/\(/g) ?? []).length) { j--; continue; } }
    return j;
  }
}

function codeSpanEnd(s: string, i: number, n: number): number {
  for (let j = i + n; j < s.length;) {
    if (s[j] !== "`") { j++; continue; }
    let k = j; while (s[k] === "`") k++;
    if (k - j === n) return j;
    j = k;
  }
  return -1;
}

type Ref = { label: [number, number]; dest: string; end: number } | { label: [number, number]; partial: true };
function linkAt(s: string, i: number, open: boolean): Ref | null {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { j++; continue; }
    if (c === "\n" && s[j + 1] === "\n") return null;
    if (c === "`") { let n = 0; while (s[j + n] === "`") n++; const e = codeSpanEnd(s, j, n); j = e < 0 ? j + n - 1 : e + n - 1; continue; }
    if (c === "[") depth++;
    if (c === "]" && --depth === 0) break;
  }
  if (j >= s.length) return null;
  const label: [number, number] = [i + 1, j];
  if (s[j + 1] !== "(") return null;
  let k = j + 2;
  while (s[k] === " " || s[k] === "\t") k++;
  let dest = "";
  if (s[k] === "<") { const e = s.indexOf(">", k); if (e < 0) return open ? { label, partial: true } : null; dest = s.slice(k + 1, e); k = e + 1; }
  else {
    let par = 0, a = k;
    for (; k < s.length; k++) { const c = s[k]; if (c === "\\") { k++; continue; } if (/\s/.test(c)) break; if (c === "(") par++; if (c === ")") { if (!par) break; par--; } }
    dest = s.slice(a, k);
  }
  while (s[k] === " " || s[k] === "\t") k++;
  if (s[k] === '"' || s[k] === "'") { const e = s.indexOf(s[k], k + 1); if (e < 0) return open ? { label, partial: true } : null; k = e + 1; while (s[k] === " " || s[k] === "\t") k++; }
  if (s[k] !== ")") return open && k >= s.length ? { label, partial: true } : null;
  return dest ? { label, dest: dest.replace(/\\([()])/g, "$1"), end: k + 1 } : null;
}

// http(s) và thư là link thật. Còn lại (sandbox:/…, outputs/…, javascript:…) chỉ hiện chữ: tệp đã có thẻ tải ngay dưới tin nhắn.
export const safeHref = (u: string) => (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) ? u : /^www\.[^\s.]+\.[^\s]+/i.test(u) ? "https://" + u : null);

export function parseInline(s: string, opts: { open?: boolean; noLink?: boolean } = {}): Inl[] {
  const ts: Tok[] = [];
  let buf = "", seq = 0;
  const flush = () => { if (buf) { ts.push(buf); buf = ""; } };
  const push = (n: Inl) => { flush(); ts.push(n); };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\n") { push({ t: "br" }); i++; continue; }
    if (c === "\\") {
      if (s[i + 1] === "(" || s[i + 1] === "[") { const m = mathAt(s, i); if (m) { push({ t: "math", v: m.v, display: m.display }); i = m.end; continue; } }
      if (i + 1 < s.length && ESC.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      buf += c; i++; continue;
    }
    if (c === "`") {
      let n = 0; while (s[i + n] === "`") n++;
      const e = codeSpanEnd(s, i, n);
      if (e >= 0) {
        let v = s.slice(i + n, e).replace(/\n/g, " ");
        if (v.length > 2 && v[0] === " " && v[v.length - 1] === " " && v.trim()) v = v.slice(1, -1);
        push({ t: "code", v }); i = e + n; continue;
      }
      if (opts.open) { const v = s.slice(i + n); if (v) push({ t: "code", v }); i = s.length; continue; }
      buf += s.slice(i, i + n); i += n; continue;
    }
    if (c === "$") { const m = mathAt(s, i); if (m) { push({ t: "math", v: m.v, display: m.display }); i = m.end; continue; } buf += c; i++; continue; }
    if (c === "!" && s[i + 1] === "[") {
      const r = linkAt(s, i + 1, !!opts.open);
      if (r) {
        if ("partial" in r) { i = s.length; continue; }
        push({ t: "img", src: r.dest, alt: inlineText(parseInline(s.slice(r.label[0], r.label[1]))) }); i = r.end; continue;
      }
      buf += c; i++; continue;
    }
    if (c === "[") {
      const fn = /^\[\^(\d{1,4})\]/.exec(s.slice(i, i + 8)); // chỉ số: [^a-z] trong chữ thường là biểu thức chính quy
      if (fn) { push({ t: "fn", id: fn[1] }); i += fn[0].length; continue; }
      const r = opts.noLink ? null : linkAt(s, i, !!opts.open);
      if (r) {
        const label = parseInline(s.slice(r.label[0], r.label[1]), { noLink: true });
        if ("partial" in r) { push({ t: "span", c: label }); i = s.length; continue; }
        const href = safeHref(r.dest);
        push(href ? { t: "a", href, c: label } : { t: "span", c: label }); i = r.end; continue;
      }
      buf += c; i++; continue;
    }
    if (c === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/i.exec(s.slice(i, i + 2048));
      if (auto && !opts.noLink) { push({ t: "a", href: /^(https?:|mailto:)/i.test(auto[1]) ? auto[1] : "mailto:" + auto[1], c: [auto[1]] }); i += auto[0].length; continue; }
      const br = /^<br\s*\/?>/i.exec(s.slice(i, i + 8));
      if (br) { push({ t: "br" }); i += br[0].length; continue; }
      const tag = /^<([a-z]+)>/i.exec(s.slice(i, i + 12));
      if (tag && TAGS.has(tag[1].toLowerCase())) {
        const name = tag[1].toLowerCase(), close = "</" + name + ">";
        const e = s.toLowerCase().indexOf(close, i + tag[0].length);
        if (e > 0) { push({ t: TAG_NODE[name], c: parseInline(s.slice(i + tag[0].length, e), { noLink: opts.noLink }) }); i = e + close.length; continue; }
      }
      buf += c; i++; continue;
    }
    if (c === "&") {
      const m = /^&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/i.exec(s.slice(i, i + 12));
      const v = m ? (m[3] ? ENT[m[3]] : (() => { const cp = m[1] ? Number(m[1]) : parseInt(m[2], 16); return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : undefined; })()) : undefined;
      if (m && v !== undefined) { buf += v; i += m[0].length; continue; }
      buf += c; i++; continue;
    }
    if (c === "*" || c === "_" || c === "~") {
      let n = 0; while (s[i + n] === c) n++;
      const before = lastChar(s, i), after = nextChar(s, i + n);
      const wsB = SPACE.test(before), wsA = SPACE.test(after), pB = PUNCT.test(before), pA = PUNCT.test(after);
      let left = !wsA && (!pA || wsB || pB), right = !wsB && (!pB || wsA || pA);
      // "**Lưu ý:**tiếp" và "**"trích"**x": CommonMark không đóng được, model viết thế khá nhiều, bản cũ vẫn in đậm đúng.
      if (c === "*" && n >= 2) { left = !wsA; right = !wsB; }
      // Phép nhân, lũy thừa viết thẳng ("2*3*4", "a**2 + b**2") không phải dấu nhấn.
      const arith = c === "*" && WORD.test(before) && DIGIT.test(after) && !starOpen(ts);
      if (arith || (c === "~" && n !== 2)) { buf += s.slice(i, i + n); i += n; continue; }
      const open = c === "_" ? left && (!right || pB) : left, close = c === "_" ? right && (!left || pA) : right;
      flush();
      ts.push({ d: true, ch: c, n, orig: n, open, close, seq: seq++ });
      i += n; continue;
    }
    if ((c === "h" || c === "H" || c === "w" || c === "W") && !opts.noLink && !WORD.test(lastChar(s, i))) {
      const m = /^(?:https?:\/\/|www\.)[^\s<>]/i.exec(s.slice(i, i + 12));
      if (m) {
        const e = urlEnd(s, i), u = s.slice(i, e), href = safeHref(u);
        if (href && e > i + m[0].length - 1) { push({ t: "a", href, c: [u] }); i = e; continue; }
      }
    }
    buf += c; i++;
  }
  flush();
  emphasis(ts);
  if (opts.open) closeOpen(ts);
  return flat(ts);
}

// Chữ thuần của một đoạn nội dòng: chép bảng, tải CSV, sắp xếp cột.
export function inlineText(ns: Inl[]): string {
  return ns.map((n) => {
    if (typeof n === "string") return n;
    switch (n.t) {
      case "code": case "math": return n.v;
      case "img": return n.alt;
      case "br": return " ";
      case "fn": return "";
      default: return inlineText(n.c);
    }
  }).join("");
}

// Ảnh trong câu trả lời: chỉ tự tải từ chính Synchro hoặc ảnh nhúng sẵn. Tự tải ảnh từ địa chỉ model viết ra là đường rò dữ liệu kinh điển
// (model bị lừa ghép dữ liệu vào đường dẫn ảnh) và lộ IP người đọc, nên ảnh ngoài thành link để người dùng tự mở.
export function imageKind(src: string): "inline" | "link" | "text" {
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return "inline";
  if (/^\/api\/(outputs|files|artimg)\b/.test(src)) return "inline";
  return /^https?:\/\//i.test(src) ? "link" : "text";
}

// ---------------------------------------------------------------- khối
type Line = { s: string; n: number };
const blank = (s: string) => !s.trim();
function indentOf(s: string): number {
  let col = 0;
  for (const c of s) { if (c === " ") col++; else if (c === "\t") col += 4 - (col % 4); else break; }
  return col;
}
function stripIndent(s: string, n: number): string {
  let col = 0, i = 0;
  while (i < s.length && col < n) { if (s[i] === " ") col++; else if (s[i] === "\t") { const w = 4 - (col % 4); if (col + w > n) return " ".repeat(col + w - n) + s.slice(i + 1); col += w; } else break; i++; }
  return s.slice(i);
}
type Fence = { ind: number; ch: string; len: number; info: string };
function fenceOpen(s: string): Fence | null {
  const m = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(s);
  if (!m || (m[2][0] === "`" && m[3].includes("`"))) return null;
  return { ind: indentOf(m[1]), ch: m[2][0], len: m[2].length, info: m[3].trim() };
}
const fenceCloses = (s: string, f: Fence) => { const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(s); return !!m && m[1][0] === f.ch && m[1].length >= f.len; };
const HR = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEAD = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^\s{0,3}={2,}\s*$/;
const QUOTE = /^\s*>[ \t]?(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/;
const FNDEF = /^\s{0,3}\[\^(\d{1,4})\]:[ \t]*(.*)$/;
// Mở khối code giữa dòng ("Mã: ```python"): bản cũ cắt theo ``` ở bất cứ đâu nên câu trả lời cũ vẫn hiện đúng khối code.
const MIDFENCE = /^(.*?\S)[ \t]*(`{3,})([\w+#.-]*)[ \t]*$/;

type Marker = { ind: number; ordered: boolean; num: number; col: number; rest: string };
function markerOf(s: string): Marker | null {
  const m = /^([ \t]*)([-*+•]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/.exec(s);
  if (!m || HR.test(s)) return null;
  const ind = indentOf(m[1]), ordered = /\d/.test(m[2]), w = m[2].length;
  const rest = m[4] ?? "";
  if (m[3] === undefined) return null; // "-" trần đang gõ dở chưa là danh sách
  const pad = blank(rest) || m[3].length > 4 ? 1 : indentOf(m[3]);
  return { ind, ordered, num: ordered ? parseInt(m[2], 10) : 1, col: ind + w + pad, rest };
}
function splitCells(r: string): string[] {
  const t = r.trim().replace(/^\|/, "");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
    if (c === "`") { let n = 0; while (t[i + n] === "`") n++; const e = codeSpanEnd(t, i, n); if (e > 0) { cur += t.slice(i, e + n).replace(/\\\|/g, "|"); i = e + n - 1; continue; } cur += t.slice(i, i + n); i += n - 1; continue; }
    if (c === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() || !t.endsWith("|")) out.push(cur.trim());
  return out;
}
const isTableAt = (L: Line[], i: number) => ROW.test(L[i].s) || (L[i].s.includes("|") && i + 1 < L.length && L[i + 1].s.includes("-") && L[i + 1].s.includes("|") && SEP.test(L[i + 1].s));

function mathBlockAt(L: Line[], i: number): { v: string; next: number } | null {
  const t = L[i].s.trim();
  const [o, c] = t.startsWith("$$") ? ["$$", "$$"] : t.startsWith("\\[") ? ["\\[", "\\]"] : ["", ""];
  if (!o) return null;
  const rest = t.slice(2);
  if (rest.endsWith(c) && rest.length > 2) return { v: rest.slice(0, -2).trim(), next: i + 1 };
  if (rest.includes(c)) return null; // $$a$$ rồi còn chữ: để nội dòng xử lý
  const body = [rest];
  for (let j = i + 1; j < L.length && j < i + 200; j++) {
    const x = L[j].s.trim();
    if (x.endsWith(c)) { body.push(x.slice(0, -2)); return { v: body.join("\n").trim(), next: j + 1 }; }
    if (x.includes(c)) return null;
    body.push(L[j].s);
  }
  return null;
}

const startsBlock = (L: Line[], i: number) => {
  const s = L[i].s;
  if (fenceOpen(s) || HR.test(s) || HEAD.test(s) || QUOTE.test(s) || FNDEF.test(s)) return true;
  const m = markerOf(s);
  if (m && !blank(m.rest)) return true;
  return isTableAt(L, i) || !!mathBlockAt(L, i);
};

class Parser {
  code = 0;
  fns: { id: string; s: string }[] = [];

  blocks(L: Line[], depth: number, top?: { raw: string[]; out: Top[] }): Block[] {
    const out: Block[] = [];
    let i = 0;
    const add = (b: Block, from: number) => {
      out.push(b);
      if (top) { const n = L[from].n, end = L[Math.min(i, L.length) - 1].n; top.out.push({ b, n, end, src: top.raw.slice(n, end + 1).join("\n") }); }
    };
    while (i < L.length) {
      const s = L[i].s, from = i;
      if (blank(s)) { i++; continue; }
      const f = fenceOpen(s);
      if (f) { const b = this.fence(L, i, f); i = b.next; add(b.b, from); continue; }
      if (HR.test(s)) { i++; add({ t: "hr" }, from); continue; }
      const fd = FNDEF.exec(s);
      if (fd) { this.fns.push({ id: fd[1], s: fd[2] }); i++; continue; }
      const mb = mathBlockAt(L, i);
      if (mb) { i = mb.next; add({ t: "math", v: mb.v }, from); continue; }
      const h = HEAD.exec(s);
      if (h) { i++; add({ t: "h", level: h[1].length, s: h[2], n: L[from].n, end: L[from].n }, from); continue; }
      if (QUOTE.test(s) && depth < 16) {
        const inner: Line[] = [];
        while (i < L.length) { const q = QUOTE.exec(L[i].s); if (!q) break; inner.push({ s: q[1], n: L[i].n }); i++; }
        add({ t: "quote", c: this.blocks(inner, depth + 1) }, from);
        continue;
      }
      const m = markerOf(s);
      if (m && depth < 16) { const r = this.list(L, i, m, depth); i = r.next; add(r.b, from); continue; }
      if (isTableAt(L, i)) { const r = this.table(L, i); i = r.next; add(r.b, from); continue; }
      // Đoạn văn: gom các dòng liền nhau, tới dòng trống hoặc khối mới. Xuống dòng trong đoạn giữ nguyên như bản cũ.
      const para: string[] = [];
      while (i < L.length && !blank(L[i].s)) {
        if (para.length && (startsBlock(L, i) || SETEXT.test(L[i].s))) break;
        const mid = MIDFENCE.exec(L[i].s);
        if (mid && !mid[1].includes("```") && (mid[3] || L.slice(i + 1).some((x) => x.s.includes("```")))) {
          para.push(mid[1].trim());
          L.splice(i, 1, { s: mid[1], n: L[i].n }, { s: mid[2] + mid[3], n: L[i].n });
          i++;
          break;
        }
        para.push(L[i].s.trim().replace(/\\$/, ""));
        i++;
      }
      if (i < L.length && SETEXT.test(L[i].s)) { i++; add({ t: "h", level: 1, s: para.join("\n"), n: L[from].n, end: L[i - 1].n }, from); continue; }
      add({ t: "p", s: para.join("\n"), n: L[from].n, end: L[i - 1].n }, from);
    }
    return out;
  }

  fence(L: Line[], i: number, f: Fence): { b: Block; next: number } {
    const idx = this.code++;
    const lang = f.info.split(/\s+/)[0] ?? "";
    const body: string[] = [];
    // Model hay lồng khối cùng độ dài khi viết README ("```md" chứa "```js … ```"): dòng mở có tên ngôn ngữ cần một dòng đóng của riêng nó.
    for (const nest of [true, false]) {
      let depth = 0;
      body.length = 0;
      for (let j = i + 1; j < L.length; j++) {
        const inner = nest ? fenceOpen(L[j].s) : null;
        if (inner && inner.ch === f.ch && inner.len === f.len && inner.info) depth++;
        else if (fenceCloses(L[j].s, f)) {
          if (!depth) return { b: { t: "code", lang, code: body.join("\n"), closed: true, idx }, next: j + 1 };
          depth--;
        }
        body.push(stripIndent(L[j].s, f.ind));
      }
    }
    // Không có dòng đóng riêng nhưng có ``` cuối một dòng ("}```"): bản cũ đóng ở đó, giữ vậy để phần sau không bị nuốt vào khối code.
    for (let k = i + 1; k < L.length; k++) {
      const at = f.ch === "`" ? L[k].s.indexOf("```") : -1;
      if (at < 0) continue;
      const head = L.slice(i + 1, k).map((x) => stripIndent(x.s, f.ind));
      const tailText = L[k].s.slice(0, at);
      if (tailText.trim()) head.push(stripIndent(tailText, f.ind));
      const after = L[k].s.slice(at + 3);
      if (after.trim()) { L.splice(k, 1, { s: after.trim(), n: L[k].n }); return { b: { t: "code", lang, code: head.join("\n"), closed: true, idx }, next: k }; }
      return { b: { t: "code", lang, code: head.join("\n"), closed: true, idx }, next: k + 1 };
    }
    return { b: { t: "code", lang, code: body.join("\n"), closed: false, idx }, next: L.length };
  }

  table(L: Line[], i: number): { b: Block; next: number } {
    const head = splitCells(L[i].s);
    let j = i + 1;
    let align: Align[] = [];
    if (j < L.length && SEP.test(L[j].s) && L[j].s.includes("-")) {
      align = splitCells(L[j].s).map((c) => { const a = c.startsWith(":"), b = c.endsWith(":"); return a && b ? "center" : b ? "right" : a ? "left" : ""; });
      j++;
    }
    const rows: string[][] = [];
    // Dòng bảng đang chảy chữ chưa có "|" cuối vẫn thuộc bảng.
    while (j < L.length && !blank(L[j].s) && (ROW.test(L[j].s) || /^\s*\|/.test(L[j].s) || (!startsBlock(L, j) && L[j].s.includes("|")))) { rows.push(splitCells(L[j].s)); j++; }
    return { b: { t: "table", head, rows, align }, next: j };
  }

  list(L: Line[], i0: number, m0: Marker, depth: number): { b: Block; next: number } {
    const items: Item[] = [];
    const base = m0.ind;
    let i = i0;
    for (;;) {
      const m = markerOf(L[i].s)!;
      const body: Line[] = [{ s: m.rest, n: L[i].n }];
      let j = i + 1, pending: Line[] = [], fence: Fence | null = fenceOpen(m.rest), strip: number | null = null;
      for (; j < L.length; j++) {
        const x = L[j];
        if (blank(x.s)) { if (fence) body.push({ s: "", n: x.n }); else pending.push({ s: "", n: x.n }); continue; }
        const ind = indentOf(x.s);
        if (fence) {
          body.push({ s: stripIndent(x.s, strip ?? m.col), n: x.n });
          if (fenceCloses(x.s, fence)) fence = null;
          continue;
        }
        const mk = markerOf(x.s);
        let inside: boolean;
        if (mk) {
          // Con khi thụt từ 2 cột trở lên. Gạch đầu dòng sát lề ngay sau một bước đánh số là chi tiết của bước đó (1. / - chi tiết / 2. / - chi tiết).
          inside = mk.ind >= m.ind + 2 || (m.ordered && !mk.ordered && !pending.length);
        } else inside = ind >= Math.min(m.col, m.ind + 2);
        if (!inside && !mk && !pending.length && !startsBlock(L, j)) {
          body.push({ s: x.s.trim(), n: x.n }); // dòng tiếp của đoạn văn, không thụt
          continue;
        }
        if (!inside) break;
        if (strip === null) strip = ind >= m.col ? m.col : ind;
        for (const p of pending) body.push(p);
        pending = [];
        const y = stripIndent(x.s, Math.min(ind, strip));
        body.push({ s: y, n: x.n });
        const op = fenceOpen(y);
        if (op) fence = op;
      }
      const task = /^\[([ xX])\][ \t]+(.*)$/.exec(body[0].s);
      if (task) body[0] = { s: task[2], n: body[0].n };
      items.push({ task: !!task, done: !!task && task[1] !== " ", c: this.blocks(body, depth + 1) });
      // Dòng trống giữa hai mục vẫn cùng một danh sách: số thứ tự chạy tiếp.
      let k = j;
      while (k < L.length && blank(L[k].s)) k++;
      const nx = k < L.length ? markerOf(L[k].s) : null;
      if (!nx || nx.ordered !== m0.ordered || nx.ind >= base + 2) return { b: { t: "list", ordered: m0.ordered, start: m0.num, items }, next: j };
      i = k;
    }
  }
}

export function parseMarkdown(text: string): { tops: Top[]; lines: number } {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const L: Line[] = raw.map((s, n) => ({ s, n }));
  const p = new Parser();
  const tops: Top[] = [];
  p.blocks(L, 0, { raw, out: tops });
  if (p.fns.length) tops.push({ b: { t: "fns", items: p.fns }, src: JSON.stringify(p.fns), n: raw.length, end: raw.length });
  return { tops, lines: raw.length };
}
