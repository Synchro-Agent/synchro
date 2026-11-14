// B5 bước 0: so thứ tự thắng của cascade giữa hai phiên bản CSS (trước / sau một lần đổi chỉ-tái-cấu-trúc: bọc @layer, gỡ tiền tố
// html body, gỡ !important). Không cần trình duyệt: đọc CSS, tính độ ưu tiên (quan trọng, lớp, specificity, thứ tự), rồi với mọi cặp khai
// báo cùng thuộc tính có thể trúng cùng một phần tử, báo cặp nào đổi bên thắng. 0 cặp đổi = cascade giữ nguyên trên mọi phần tử mà
// phép xấp xỉ dưới đây coi là có thể trùng.
// Xấp xỉ "có thể trùng phần tử" (bảo thủ ở chỗ chắc, có giả định ở chỗ không chắc — báo cáo B5 ghi rõ):
// - chỉ xét phần tử chủ (phần ghép cuối của selector) và pseudo-element; tổ tiên bỏ qua (coi như luôn có thể khớp), trừ chủ đề sáng / tối;
// - hai lớp khác nhau chỉ coi là cùng phần tử khi cùng xuất hiện ở một selector ghép (.a.b) hoặc trong cùng một className / chuỗi của tsx;
// - @media theo chiều rộng tách được (max 760 / min 761 không giao nhau); @container, @supports coi như luôn có thể đúng.
// Không thấy: style nội dòng (style={{…}}) và kiểu đặt bằng JS — cascade-inline của bản báo cáo liệt kê !important bị gỡ ở thuộc tính
// mà tsx có đặt nội dòng, để soát tay.
// Dùng:
//   node scripts/css-cascade.mjs <trước> <sau> [--json tệp] [--max N]
//   mỗi phiên bản là một thư mục mã nguồn (src:<thư mục gốc dự án>, dịch Tailwind như bản dựng) hoặc bản build (build:<thư mục .next>,
//   thêm @<thư mục mã nguồn> để đọc thẻ <style> của tsx từ đúng phiên bản đó).
//   Thêm --order dev|prod cho src: dev = thứ tự import của layout.tsx (next dev); prod: thứ tự <link> của bản build webpack hiện tại
//   (glass+features trước globals, xem báo cáo B5). Mã thoát 1 khi có cặp đổi bên thắng hoặc khai báo mất / thừa.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

// ---------------------------------------------------------------- selector
/** Tách một selector phức thành các phần ghép, mỗi phần là danh sách selector đơn {k, v, args}. */
export function parseSelector(s) {
  const out = [[]]; let i = 0; const n = s.length;
  const ident = () => { let r = ""; while (i < n) { const c = s[i]; if (c === "\\") { r += s.slice(i, i + 2); i += 2; continue; } if (/[\w\- -￿]/.test(c)) { r += c; i++; } else break; } return r; };
  const balanced = (open, close) => { let d = 0, r = "", q = null; while (i < n) { const c = s[i]; if (q) { r += c; if (c === "\\") { r += s[i + 1] ?? ""; i += 2; continue; } if (c === q) q = null; i++; continue; } if (c === '"' || c === "'") { q = c; r += c; i++; continue; } if (c === open) d++; if (c === close) { d--; if (d === 0) { i++; return r.slice(1); } } r += c; i++; } return r.slice(1); };
  let comb = null;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; if (out[out.length - 1].length && !comb) comb = " "; continue; }
    if (c === ">" || c === "+" || c === "~") { comb = c; i++; continue; }
    if (comb) { out.push([]); out[out.length - 1].comb = comb; comb = null; }
    const cur = out[out.length - 1];
    if (c === ".") { i++; cur.push({ k: "class", v: ident() }); }
    else if (c === "#") { i++; cur.push({ k: "id", v: ident() }); }
    else if (c === "[") { const body = balanced("[", "]"); const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("[^"]*"|'[^']*'|[^\s\]]+)\s*(i|s)?)?\s*$/.exec(body); cur.push({ k: "attr", v: m ? m[1] : body, op: m?.[2] ?? null, val: m?.[3] ? m[3].replace(/^["']|["']$/g, "") : null }); }
    else if (c === ":") {
      i++; let el = false; if (s[i] === ":") { el = true; i++; }
      const name = ident().toLowerCase(); let args = null;
      if (s[i] === "(") args = balanced("(", ")");
      if (el || ["before", "after", "first-line", "first-letter"].includes(name)) cur.push({ k: "pel", v: name, args });
      else cur.push({ k: "pc", v: name, args });
    } else if (c === "*") { i++; cur.push({ k: "any" }); }
    else if (c === "&") { i++; cur.push({ k: "nest" }); }
    else if (c === "|") { i++; }
    else { const t = ident(); if (!t) { i++; continue; } cur.push({ k: "tag", v: t.toLowerCase() }); }
  }
  return out;
}
/** Tách danh sách selector theo dấu phẩy ngoài cùng (bỏ qua phẩy trong ngoặc / chuỗi). */
export function splitList(s) {
  const r = []; let d = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "\\") { cur += s[++i] ?? ""; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[") d++; else if (c === ")" || c === "]") d--;
    if (c === "," && d === 0) { r.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) r.push(cur.trim());
  return r;
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp3 = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const maxSpec = (list) => splitList(list).map(specificity).reduce((m, x) => (cmp3(x, m) > 0 ? x : m), [0, 0, 0]);
/** Specificity [id, lớp, kiểu] của một selector phức, theo Selectors 4 (:where = 0, :is/:not/:has = lớn nhất trong đối số). */
export function specificity(sel) {
  let sp = [0, 0, 0];
  for (const comp of parseSelector(sel)) for (const x of comp) {
    if (x.k === "id") sp = add(sp, [1, 0, 0]);
    else if (x.k === "class" || x.k === "attr") sp = add(sp, [0, 1, 0]);
    else if (x.k === "tag" || x.k === "pel") sp = add(sp, [0, 0, 1]);
    else if (x.k === "pc") {
      if (x.v === "where") continue;
      if (["is", "matches", "-webkit-any", "-moz-any", "not", "has"].includes(x.v) && x.args != null) sp = add(sp, maxSpec(x.args));
      else if (/^nth-(last-)?child$/.test(x.v) && x.args && / of /.test(x.args)) sp = add(add(sp, [0, 1, 0]), maxSpec(x.args.split(/ of /)[1]));
      else sp = add(sp, [0, 1, 0]);
    }
  }
  return sp;
}
const LEGACY_EL = new Set(["before", "after", "first-line", "first-letter"]);
/** Đặc điểm phần tử chủ: các phương án (do :is/:where ở phần ghép cuối), pseudo-element, chủ đề. */
export function subject(sel) {
  const comps = parseSelector(sel);
  const last = comps[comps.length - 1] ?? [];
  let theme = null;
  const scanTheme = (list, neg) => {
    for (const comp of list) for (const x of comp) {
      if (x.k === "attr" && x.v === "data-theme" && x.val) { const t = x.val === "dark" ? "D" : x.val === "light" ? "L" : null; if (t) theme = neg ? (t === "D" ? "L" : "D") : t; }
      if (x.k === "pc" && x.v === "not" && x.args) for (const a of splitList(x.args)) scanTheme(parseSelector(a), !neg);
      if (x.k === "pc" && (x.v === "is" || x.v === "where") && x.args) { const al = splitList(x.args); if (al.length === 1) scanTheme(parseSelector(al[0]), neg); }
    }
  };
  scanTheme(comps, false);
  let pel = null;
  const base = { tag: null, ids: [], cls: [], attrs: [], pcs: [], negCls: [], negPcs: [], negAttrs: [] };
  let alts = [base];
  for (const x of last) {
    if (x.k === "pel") { pel = x.v + (x.args != null ? `(${x.args})` : ""); continue; }
    if (pel) continue; // :hover sau ::before … thuộc pseudo-element, bỏ qua
    if (x.k === "tag") for (const a of alts) a.tag = x.v === "html" ? "html" : x.v;
    if (x.k === "id") for (const a of alts) a.ids.push(x.v);
    if (x.k === "class") for (const a of alts) a.cls.push(x.v);
    if (x.k === "attr") for (const a of alts) a.attrs.push(x);
    if (x.k === "pc") {
      if (x.v === "root") for (const a of alts) a.tag = "html";
      else if (x.v === "not" && x.args) {
        for (const arg of splitList(x.args)) { const c = parseSelector(arg); if (c.length !== 1 || c[0].length !== 1) continue; const y = c[0][0]; for (const a of alts) { if (y.k === "class") a.negCls.push(y.v); else if (y.k === "pc" && !y.args) a.negPcs.push(y.v); else if (y.k === "attr") a.negAttrs.push(y); } }
      } else if ((x.v === "is" || x.v === "where" || x.v === "matches") && x.args) {
        const sub = splitList(x.args).map((a) => subject(a));
        const nalts = [];
        for (const a of alts) for (const s of sub) for (const b of s.alts) nalts.push({ tag: b.tag ?? a.tag, ids: [...a.ids, ...b.ids], cls: [...a.cls, ...b.cls], attrs: [...a.attrs, ...b.attrs], pcs: [...a.pcs, ...b.pcs], negCls: [...a.negCls, ...b.negCls], negPcs: [...a.negPcs, ...b.negPcs], negAttrs: [...a.negAttrs, ...b.negAttrs] });
        if (nalts.length && nalts.length <= 64) alts = nalts;
      } else if (!x.args) for (const a of alts) a.pcs.push(x.v);
    }
  }
  return { alts, pel: pel && LEGACY_EL.has(pel) ? pel : pel, theme };
}

// ---------------------------------------------------------------- media
const px = (v, u) => (u === "em" || u === "rem" ? v * 16 : v);
/** @media → danh sách phương án (phẩy = hoặc), mỗi phương án {lo, hi, flags}. */
export function parseMedia(q) {
  return splitList(q.toLowerCase()).map((part) => {
    const m = { lo: -Infinity, hi: Infinity, flags: {} };
    if (/^\s*not\b/.test(part)) return { ...m, unknown: true };
    for (const r of part.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g)) { const v = px(+r[2], r[3]); if (r[1] === "min") m.lo = Math.max(m.lo, v); else m.hi = Math.min(m.hi, v); }
    for (const r of part.matchAll(/\(\s*width\s*(<=|>=|<|>)\s*([\d.]+)(px|em|rem)\s*\)/g)) { const v = px(+r[2], r[3]); if (r[1] === "<=") m.hi = Math.min(m.hi, v); else if (r[1] === "<") m.hi = Math.min(m.hi, v - 0.01); else if (r[1] === ">=") m.lo = Math.max(m.lo, v); else m.lo = Math.max(m.lo, v + 0.01); }
    for (const r of part.matchAll(/\(\s*([\d.]+)(px|em|rem)\s*(<=|<)\s*width\s*(<=|<)\s*([\d.]+)(px|em|rem)\s*\)/g)) { m.lo = Math.max(m.lo, px(+r[1], r[2]) + (r[3] === "<" ? 0.01 : 0)); m.hi = Math.min(m.hi, px(+r[5], r[6]) - (r[4] === "<" ? 0.01 : 0)); }
    for (const r of part.matchAll(/\(\s*(hover|pointer|any-hover|any-pointer|prefers-reduced-motion|prefers-color-scheme|orientation)\s*:\s*([\w-]+)\s*\)/g)) m.flags[r[1]] = r[2];
    if (/\bprint\b/.test(part)) m.flags.type = "print"; else if (/\bscreen\b/.test(part)) m.flags.type = "screen";
    return m;
  });
}
const altDisjoint = (a, b) => {
  if (a.unknown || b.unknown) return false;
  if (Math.max(a.lo, b.lo) > Math.min(a.hi, b.hi)) return true;
  for (const k of Object.keys(a.flags)) if (k in b.flags && a.flags[k] !== b.flags[k]) return true;
  return false;
};
/** Ngữ cảnh @media lồng nhau (và-nối) → một danh sách phương án đã giao. */
const conj = (ctxs) => ctxs.reduce((acc, q) => { const r = []; for (const a of acc) for (const b of q) r.push({ lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi), flags: { ...a.flags, ...b.flags }, unknown: a.unknown || b.unknown }); return r; }, [{ lo: -Infinity, hi: Infinity, flags: {} }]);
const mediaDisjoint = (A, B) => A.every((a) => B.every((b) => altDisjoint(a, b)));

// ---------------------------------------------------------------- properties
const SIDES = ["top", "right", "bottom", "left"];
const LOGICAL = { "inline-start": ["left"], "inline-end": ["right"], "block-start": ["top"], "block-end": ["bottom"], inline: ["left", "right"], block: ["top", "bottom"] };
const sh = {};
for (const p of ["margin", "padding", "scroll-margin", "scroll-padding"]) { sh[p] = SIDES.map((s) => `${p}-${s}`); for (const [l, ss] of Object.entries(LOGICAL)) sh[`${p}-${l}`] = ss.map((s) => `${p}-${s}`); }
sh.inset = [...SIDES]; for (const [l, ss] of Object.entries(LOGICAL)) sh[`inset-${l}`] = ss;
const BP = ["width", "style", "color"];
sh.border = SIDES.flatMap((s) => BP.map((p) => `border-${s}-${p}`)).concat(["border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"]);
for (const s of SIDES) sh[`border-${s}`] = BP.map((p) => `border-${s}-${p}`);
for (const [l, ss] of Object.entries(LOGICAL)) { sh[`border-${l}`] = ss.flatMap((s) => BP.map((p) => `border-${s}-${p}`)); for (const p of BP) sh[`border-${l}-${p}`] = ss.map((s) => `border-${s}-${p}`); }
for (const p of BP) sh[`border-${p}`] = SIDES.map((s) => `border-${s}-${p}`);
sh["border-image"] = ["border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"];
sh["border-radius"] = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
sh["border-start-start-radius"] = ["border-top-left-radius"]; sh["border-start-end-radius"] = ["border-top-right-radius"]; sh["border-end-start-radius"] = ["border-bottom-left-radius"]; sh["border-end-end-radius"] = ["border-bottom-right-radius"];
sh.background = ["background-color", "background-image", "background-position-x", "background-position-y", "background-size", "background-repeat", "background-attachment", "background-origin", "background-clip"];
sh["background-position"] = ["background-position-x", "background-position-y"];
sh.font = ["font-style", "font-variant-caps", "font-variant-ligatures", "font-variant-numeric", "font-variant-east-asian", "font-variant-alternates", "font-variant-position", "font-weight", "font-stretch", "font-size", "line-height", "font-family", "font-size-adjust", "font-kerning", "font-optical-sizing", "font-feature-settings", "font-variation-settings"];
sh["font-variant"] = ["font-variant-caps", "font-variant-ligatures", "font-variant-numeric", "font-variant-east-asian", "font-variant-alternates", "font-variant-position"];
sh.flex = ["flex-grow", "flex-shrink", "flex-basis"]; sh["flex-flow"] = ["flex-direction", "flex-wrap"];
sh.grid = ["grid-template-rows", "grid-template-columns", "grid-template-areas", "grid-auto-rows", "grid-auto-columns", "grid-auto-flow"];
sh["grid-template"] = ["grid-template-rows", "grid-template-columns", "grid-template-areas"];
sh["grid-area"] = ["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"];
sh["grid-row"] = ["grid-row-start", "grid-row-end"]; sh["grid-column"] = ["grid-column-start", "grid-column-end"];
sh.gap = ["row-gap", "column-gap"]; sh["grid-gap"] = sh.gap; sh["grid-row-gap"] = ["row-gap"]; sh["grid-column-gap"] = ["column-gap"];
sh["place-items"] = ["align-items", "justify-items"]; sh["place-content"] = ["align-content", "justify-content"]; sh["place-self"] = ["align-self", "justify-self"];
sh.overflow = ["overflow-x", "overflow-y"]; sh["overscroll-behavior"] = ["overscroll-behavior-x", "overscroll-behavior-y"];
sh.outline = ["outline-color", "outline-style", "outline-width"];
sh["text-decoration"] = ["text-decoration-line", "text-decoration-style", "text-decoration-color", "text-decoration-thickness"];
sh.transition = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay", "transition-behavior"];
sh.animation = ["animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state", "animation-timeline"];
sh["list-style"] = ["list-style-type", "list-style-position", "list-style-image"];
sh.columns = ["column-width", "column-count"]; sh["column-rule"] = ["column-rule-width", "column-rule-style", "column-rule-color"];
sh.mask = ["mask-image", "mask-mode", "mask-repeat", "mask-position", "mask-clip", "mask-origin", "mask-size", "mask-composite"];
sh["-webkit-mask"] = ["-webkit-mask-image", "-webkit-mask-repeat", "-webkit-mask-position", "-webkit-mask-clip", "-webkit-mask-origin", "-webkit-mask-size", "-webkit-mask-composite"];
sh.container = ["container-name", "container-type"];
sh["text-wrap"] = ["text-wrap-mode", "text-wrap-style"]; sh["white-space"] = ["white-space-collapse", "text-wrap-mode"];
sh["contain-intrinsic-size"] = ["contain-intrinsic-width", "contain-intrinsic-height"];
sh["-webkit-text-stroke"] = ["-webkit-text-stroke-width", "-webkit-text-stroke-color"];
sh["text-emphasis"] = ["text-emphasis-style", "text-emphasis-color"];
// Kích thước logic → vật lý (chữ ngang, LTR).
const ALIAS = { "inline-size": "width", "block-size": "height", "min-inline-size": "min-width", "min-block-size": "min-height", "max-inline-size": "max-width", "max-block-size": "max-height", "word-wrap": "overflow-wrap", "-webkit-box-orient": "-webkit-box-orient" };
/** Thuộc tính → các thuộc tính gốc mà nó đặt (viết tắt trải ra). */
export function atoms(prop) {
  const p = prop.toLowerCase();
  if (p.startsWith("--")) return [prop];
  if (p === "all") return ["*all*"];
  const a = ALIAS[p] ?? p;
  const r = sh[a];
  if (!r) return [a];
  return r.flatMap((x) => (sh[x] && x !== a ? atoms(x) : [x]));
}

// ---------------------------------------------------------------- sheets → declarations
const normSel = (s) => s.replace(/\s+/g, " ").replace(/\[([\w-]+)(=|~=|\^=|\$=|\*=|\|=)'([^']*)'\]/g, '[$1$2"$3"]').replace(/\[([\w-]+)(=|~=|\^=|\$=|\*=|\|=)([^"'\]\s]+)\]/g, '[$1$2"$3"]')
  .replace(/(^|[\s(,])html body /g, "$1").replace(/(^|[\s(,])(html\[[^\]]*\]) body /g, "$1$2 ").trim();
const normVal = (v) => v.replace(/\s+/g, " ").replace(/\s*!\s*important\s*$/i, "").trim();
const normMedia = (m) => m.replace(/\s+/g, "").toLowerCase();

/** Đọc các tệp CSS theo thứ tự nạp → khai báo đã trải theo selector và thuộc tính gốc. */
export function collect(sheets) {
  const postcss = req("postcss");
  const layerOrder = []; const layerIdx = new Map();
  const regLayer = (name) => { if (!layerIdx.has(name)) { layerIdx.set(name, layerOrder.length); layerOrder.push(name); } };
  const decls = []; let order = 0; let anon = 0;
  for (const sh0 of sheets) {
    const root = postcss.parse(sh0.css, { from: sh0.name });
    const walk = (node, ctx) => {
      for (const ch of node.nodes ?? []) {
        if (ch.type === "atrule") {
          const name = ch.name.toLowerCase();
          if (name === "layer") {
            if (!ch.nodes) { for (const l of ch.params.split(",").map((x) => x.trim()).filter(Boolean)) regLayer(ctx.layer ? `${ctx.layer}.${l}` : l); continue; }
            const l = ch.params.trim() || `<anon${anon++}>`; const full = ctx.layer ? `${ctx.layer}.${l}` : l; regLayer(full);
            walk(ch, { ...ctx, layer: full });
          } else if (name === "media") walk(ch, { ...ctx, media: [...ctx.media, ch.params] });
          else if (name === "supports" || name === "container" || name === "scope" || name === "starting-style") walk(ch, { ...ctx, cond: [...ctx.cond, `@${name} ${ch.params}`] });
          // @keyframes, @font-face, @property, @page, @import, @theme… không vào cascade của phần tử.
          continue;
        }
        if (ch.type !== "rule") continue;
        if (ch.parent?.type === "atrule" && /keyframes$/i.test(ch.parent.name)) continue;
        const sels = splitList(ch.selector);
        const ds = (ch.nodes ?? []).filter((d) => d.type === "decl");
        for (const s of sels) {
          const n = normSel(s), sp = specificity(s), sub = subject(s);
          const media = conj(ctx.media.map(parseMedia));
          for (const d of ds) {
            const value = normVal(d.value);
            for (const at of atoms(d.prop)) decls.push({ sheet: sh0.name, rsel: ch.selector, sel: s, nsel: n, spec: sp, sub, media, mkey: [...ctx.media.map(normMedia), ...ctx.cond.map(normMedia)].join("&"), layer: ctx.layer, prop: d.prop.toLowerCase(), atom: at, value, imp: !!d.important, order: order, line: d.source?.start?.line });
            order++;
          }
        }
      }
    };
    walk(root, { layer: null, media: [], cond: [] });
  }
  return { decls, layerOrder, layerIdx };
}

// ---------------------------------------------------------------- class co-occurrence from tsx
/** Lớp nào có thể cùng nằm trên một phần tử, và trên thẻ nào. Nhóm = các lớp có thể cùng nằm trên một phần tử:
 *  - một className={…} / className="…" / class="…" trong tsx/ts (kèm tên thẻ khi là thẻ HTML), một phần ghép trong CSS (.a.b);
 *  - lớp "rời" (chuỗi ngoài className: biến, toán tử ba ngôi, hằng) và lớp ghép động `tiền-tố-${x}` đi với các lớp tĩnh của mọi className
 *    động (có biến) trong CÙNG tệp — giả định: lớp rời được dùng ở chính tệp khai báo nó;
 *  - lớp không có ở đâu trong mã của app (do thư viện sinh: KaTeX, xterm, shiki…, hoặc CSS chết) chỉ đi với nhau.
 *  Lớp "mở" (wild) đi với mọi lớp, mọi thẻ: lớp truyền qua className của component (trừ Link = thẻ a), lớp thêm bằng classList, lớp chỉ
 *  thấy trong mã ở dạng khác (querySelector, chuỗi HTML…). */
export function cooccurrence(root, decls) {
  const known = new Set(); for (const d of decls) for (const a of d.sub.alts) for (const c of a.cls) known.add(c);
  const groups = []; const seen = new Set(); const wild = new Set(); const why = new Map();
  const mark = (c, r) => { if (!known.has(c)) return; wild.add(c); if (!why.has(c)) why.set(c, r); };
  const group = (list, tag = null, css = false) => { const k = [...new Set(list.filter((c) => known.has(c)))]; if (k.length) groups.push({ cls: new Set(k), tag, css }); return k; };
  for (const d of decls) for (const comp of parseSelector(d.sel)) group(comp.filter((x) => x.k === "class").map((x) => x.v), null, true);
  const byPrefix = (p) => [...known].filter((c) => c.startsWith(p) && c.length > p.length);
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === "node_modules" || e.name.startsWith(".")) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(e.name)) files.push(p); } };
  walk(path.join(root, "app"));
  let all = "";
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8"); all += src + "\n";
    const spans = [], dyn = [], loose = new Set();
    for (const m of src.matchAll(/\bclass(?:Name)?\s*=\s*/g)) {
      let i = m.index + m[0].length; const c = src[i]; let expr = ""; const st = i;
      if (c === '"' || c === "'") { const e = src.indexOf(c, i + 1); expr = src.slice(i + 1, e); i = e; }
      else if (c === "{") { let d = 0; for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) break; } } expr = src.slice(st, i + 1); }
      else if (c === "`") { const e = src.indexOf("`", i + 1); expr = src.slice(i + 1, e); i = e; }
      else continue;
      spans.push([st, i]);
      const before = src.slice(Math.max(0, m.index - 1500), m.index);
      let t = [...before.matchAll(/<([A-Za-z][\w.]*)[\s>]/g)].pop()?.[1] ?? null;
      if (t === "Link") t = "a";
      const intrinsic = t && /^[a-z]/.test(t);
      const k = group(expr.split(/[^\w-]+/), intrinsic ? t : null);
      for (const x of k) seen.add(x);
      if (!intrinsic) for (const x of k) mark(x, `className của <${t}> ở ${path.basename(f)}`);
      const pre = [...expr.matchAll(/([\w-]*-)\$\{/g)].map((x) => x[1]);
      for (const p of pre) for (const x of byPrefix(p)) { group([...k, x], intrinsic ? t : null); seen.add(x); }
      // Biểu thức có biến: lớp rời của tệp có thể đổ vào đây.
      if (c === "{" && !/^\{\s*(["'])[^"'`]*\1\s*\}$/.test(expr) || c === "`" && expr.includes("${")) dyn.push({ k, tag: intrinsic ? t : null });
    }
    const inSpan = (i) => spans.some(([a, b]) => i >= a && i <= b);
    for (const m of src.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){1,400}?)\1/g)) {
      if (inSpan(m.index)) continue;
      const toks = m[2].split(/[\s${}?:]+/).filter(Boolean);
      for (const x of toks) if (known.has(x)) { loose.add(x); seen.add(x); }
      if (toks.length > 1) group(toks);
      for (const p of [...m[2].matchAll(/([\w-]*-)\$\{/g)].map((x) => x[1])) for (const x of byPrefix(p)) { loose.add(x); seen.add(x); }
    }
    for (const e of dyn) for (const x of loose) group([...e.k, x], e.tag);
    for (const m of src.matchAll(/classList\.(?:add|toggle|replace)\(\s*["'`]([\w-]+)/g)) mark(m[1], `classList ở ${path.basename(f)}`);
  }
  // Lớp không thấy trong className / chuỗi nào: có nhắc ở đâu đó trong mã (querySelector…) thì coi là mở; không có thì là lớp của thư viện.
  const lib = [];
  for (const c of known) if (!seen.has(c)) { if (new RegExp(`(^|[^\\w-])${c.replace(/[-\\]/g, "\\$&")}([^\\w-]|$)`).test(all)) mark(c, "chỉ thấy trong mã ở dạng khác className"); else lib.push(c); }
  if (lib.length) groups.push({ cls: new Set(lib), tag: null, css: true });
  const byCls = new Map(), tags = new Map();
  for (const g of groups) for (const c of g.cls) { (byCls.get(c) ?? byCls.set(c, []).get(c)).push(g); if (g.tag) (tags.get(c) ?? tags.set(c, new Set()).get(c)).add(g.tag); }
  // Lớp có ít nhất một nhóm không rõ thẻ thì không suy được thẻ.
  for (const g of groups) if (!g.tag && !g.css) for (const c of g.cls) tags.delete(c);
  return { groups, byCls, wild, tags, why, lib: new Set(lib) };
}

// ---------------------------------------------------------------- overlap and precedence
const tagOk = (a, b) => !a.tag || !b.tag || a.tag === b.tag;
const attrClash = (a, b) => a.attrs.some((x) => x.op === "=" && b.attrs.some((y) => y.v === x.v && y.op === "=" && y.val !== x.val));
const negClash = (a, b) => a.negCls.some((c) => b.cls.includes(c)) || a.negPcs.some((c) => b.pcs.includes(c)) || a.negAttrs.some((x) => b.attrs.some((y) => y.v === x.v && (!x.op || (x.op === y.op && x.val === y.val))));
function altOverlap(a, b, co) {
  if (!tagOk(a, b)) return false;
  if (a.ids.length && b.ids.length && !a.ids.some((x) => b.ids.includes(x))) return false;
  if (attrClash(a, b) || negClash(a, b) || negClash(b, a)) return false;
  // Phần tử phải mang đủ mọi lớp của cả hai selector: cần một nhóm chứa hết các lớp không mở (và đúng thẻ, nếu nhóm biết thẻ).
  const U = [...new Set([...a.cls, ...b.cls])].filter((c) => !co.wild.has(c));
  if (!U.length) return true;
  const tag = a.tag ?? b.tag;
  // Lớp không mở chỉ xuất hiện trên thẻ HTML đã biết: selector theo thẻ khác không trúng nó.
  if (tag && U.some((c) => co.tags.get(c) && !co.tags.get(c).has(tag))) return false;
  return (co.byCls.get(U[0]) ?? []).some((g) => U.every((c) => g.cls.has(c)));
}
export function overlap(x, y, co) {
  if (x.sub.pel !== y.sub.pel) return false;
  if (x.sub.theme && y.sub.theme && x.sub.theme !== y.sub.theme) return false;
  if (mediaDisjoint(x.media, y.media)) return false;
  return x.sub.alts.some((a) => y.sub.alts.some((b) => altOverlap(a, b, co)));
}
/** > 0 khi x thắng y. */
export function precede(x, y, L) {
  if (x.imp !== y.imp) return x.imp ? 1 : -1;
  const n = L.layerOrder.length;
  const lr = (d) => (d.layer == null ? (d.imp ? -1 : n) : d.imp ? n - L.layerIdx.get(d.layer) : L.layerIdx.get(d.layer));
  return lr(x) - lr(y) || cmp3(x.spec, y.spec) || x.order - y.order;
}
const why = (x, y, L) => {
  if (x.imp !== y.imp) return "!important";
  if (x.layer !== y.layer) return `lớp ${x.layer ?? "(không lớp)"} / ${y.layer ?? "(không lớp)"}`;
  if (cmp3(x.spec, y.spec)) return `specificity ${x.spec.join(",")} / ${y.spec.join(",")}`;
  return "thứ tự";
};

// ---------------------------------------------------------------- diff
/** Ghép khai báo hai phiên bản theo (selector chuẩn hóa, @media, thuộc tính gốc, giá trị, lần xuất hiện). */
// raw: khóa theo selector gốc (không bỏ html body) và lớp: dùng khi chỉ CHUYỂN luật giữa các tệp (scripts/css-move.mjs), selector không đổi —
// hai khai báo cùng khóa thì giống hệt nhau, đổi chỗ cho nhau không đổi kết quả.
function keyed(decls, raw = false) {
  const seen = new Map(); const m = new Map();
  for (const d of decls) { const k = raw ? `${d.sel.replace(/\s+/g, " ").trim()}|${d.mkey}|${d.layer}|${d.imp}|${d.atom}|${d.prop}|${d.value}` : `${d.nsel}|${d.mkey}|${d.atom}|${d.prop}|${d.value}`; const i = seen.get(k) ?? 0; seen.set(k, i + 1); d.key = `${k}#${i}`; m.set(d.key, d); }
  return m;
}
export function diff(A, B, co, { max = 200, filter = () => true, raw = false } = {}) {
  const ka = keyed(A.decls, raw), kb = keyed(B.decls, raw);
  const lost = [...ka.keys()].filter((k) => !kb.has(k)), extra = [...kb.keys()].filter((k) => !ka.has(k));
  // Nhóm theo (pseudo-element, thuộc tính gốc), đánh chỉ mục theo lớp để chỉ so cặp có thể trùng phần tử.
  const groups = new Map();
  for (const d of A.decls) { if (!kb.has(d.key)) continue; const g = `${d.sub.pel}|${d.atom}`; (groups.get(g) ?? groups.set(g, []).get(g)).push(d); }
  const flips = []; let pairs = 0;
  // Lớp giữ nguyên thứ tự thì cặp hai khai báo không đổi (cùng !important, lớp, specificity) giữ nguyên bên thắng: chỉ so cặp có ít nhất một
  // khai báo đổi (đổi nhiều nhanh gấp chục lần khi chỉ một vài luật đổi). Thêm lớp mới (như syn-over ở cuối) không đổi thứ tự giữa các
  // lớp cũ: vẫn tính là giữ nguyên, miễn mọi lớp của bản trước còn ở bản sau theo đúng thứ tự.
  const idxB = A.layerOrder.map((l) => B.layerIdx.get(l));
  const sameLayers = idxB.every((i, k) => i != null && (k === 0 || i > idxB[k - 1]));
  // Khai báo chuyển sang tệp khác (scripts/css-move.mjs) đổi thứ tự so với mọi khai báo khác: cũng tính là đổi.
  const changed = (d) => { const e = kb.get(d.key); return !sameLayers || e.imp !== d.imp || e.layer !== d.layer || cmp3(e.spec, d.spec) !== 0 || e.sheet !== d.sheet; };
  for (const d of A.decls) if (kb.has(d.key)) d.ch = changed(d);
  for (const list of groups.values()) {
    // Chỉ mục theo lớp không mở; selector chỉ có lớp mở (hay không lớp) là ứng viên của mọi khai báo.
    const byCls = new Map(), bare = [];
    const own = (a) => a.cls.filter((c) => !co.wild.has(c));
    list.forEach((d, i) => { d.i = i; if (d.sub.alts.some((a) => !own(a).length)) bare.push(d); for (const a of d.sub.alts) for (const c of own(a)) (byCls.get(c) ?? byCls.set(c, []).get(c)).push(d); });
    for (const x of list) {
      let cand;
      if (x.sub.alts.some((a) => !own(a).length)) cand = list;
      else { cand = new Set(bare); for (const a of x.sub.alts) for (const c of own(a)) for (const g of co.byCls.get(c) ?? []) for (const c2 of g.cls) for (const y of byCls.get(c2) ?? []) cand.add(y); }
      for (const y of cand) {
        if (y.i <= x.i) continue;
        if (!x.ch && !y.ch) continue;
        if (!overlap(x, y, co)) continue;
        pairs++;
        const xb = kb.get(x.key), yb = kb.get(y.key);
        const s1 = Math.sign(precede(x, y, A)), s2 = Math.sign(precede(xb, yb, B));
        // Cùng thuộc tính, cùng giá trị: bên nào thắng cũng ra một kết quả.
        if (s1 !== s2 && !(x.prop === y.prop && x.value === y.value) && filter(x, y)) { const [w, l] = s1 > 0 ? [x, y] : [y, x]; flips.push({ atom: x.atom, pel: x.sub.pel, sides: [x, y].map((d) => ({ sheet: d.sheet, nsel: d.nsel, sel: d.sel, changed: d.ch, declKey: `${d.rsel.replace(/\s+/g, " ").trim()}|${d.prop}|${d.value}` })), before: { win: fmt(w), lose: fmt(l), why: why(w, l, A) }, after: { win: fmt(s2 > 0 ? xb : yb), why: why(s2 > 0 ? xb : yb, s2 > 0 ? yb : xb, B) } }); }
      }
    }
  }
  return { flips, pairs, lost: lost.map((k) => fmt(ka.get(k))), extra: extra.map((k) => fmt(kb.get(k))), max };
}
const fmt = (d) => `${d.sheet}${d.line ? `:${d.line}` : ""} ${d.media.length && d.mkey ? `@${d.mkey} ` : ""}${d.layer ? `[${d.layer}] ` : ""}${d.sel} { ${d.prop}: ${d.value}${d.imp ? " !important" : ""} }`;

// ---------------------------------------------------------------- loading versions
// Kiểu chèn nội dòng không lớp của app (thẻ <style> trong tsx): luôn nạp sau tệp CSS.
function injected(root) {
  const out = [];
  const gf = fs.readFileSync(path.join(root, "app/glass-folder.tsx"), "utf8"); const m1 = /const GF_CSS = `([\s\S]*?)`;/.exec(gf); if (m1) out.push({ name: "glass-folder.tsx GF_CSS", css: m1[1] });
  const au = fs.readFileSync(path.join(root, "app/auth.tsx"), "utf8"); const m2 = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(au); if (m2) out.push({ name: "auth.tsx <style>", css: m2[1].replace(/\$\{[^}]*\}/g, "0") });
  return out;
}
// Thư viện ngoài nạp chậm: qua tệp bọc app/vendor/*.css (B5, dịch như bản dựng để có lớp), hay thẳng tệp trong node_modules (không lớp).
async function vendor(root, compile) {
  const out = [];
  for (const [wrap, raw] of [["app/vendor/katex.css", "katex/dist/katex.min.css"], ["app/vendor/xterm.css", "@xterm/xterm/css/xterm.css"]]) {
    const w = path.join(root, wrap);
    out.push(fs.existsSync(w) ? { name: raw, css: await compile(w) } : { name: raw, css: fs.readFileSync(path.join(root, "node_modules", raw), "utf8") });
  }
  return out;
}
const LAZY = ["app/codeview.css", "app/speech/speech.css", "app/brainview.css", "app/download/download.css", "app/projects.css", "app/settings.css", "app/skills.css"];
/** Bản mã nguồn: dịch globals.css qua Tailwind như bản dựng, rồi xếp theo thứ tự nạp. */
export async function loadSource(root, order = "dev") {
  const postcss = req("postcss");
  const tw = (await import(path.join(root, "node_modules/@tailwindcss/postcss/dist/index.mjs"))).default;
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const compile = async (f) => (await postcss([tw({ base: root, optimize: false })]).process(fs.readFileSync(f, "utf8"), { from: f })).css;
  const g = { css: await compile(path.join(root, "app/globals.css")) };
  const font = { name: "unbounded", css: read("node_modules/@fontsource-variable/unbounded/wght.css") + read("app/unbounded-preload.css") };
  const s = (p) => ({ name: p.replace(/^app\//, ""), css: read(p) });
  // app/tokens.css (B5 bước 5) chỉ định nghĩa biến trên :root, mỗi biến một lần: vị trí trong thứ tự không đổi bên thắng nào.
  const tok = fs.existsSync(path.join(root, "app/tokens.css")) ? [s("app/tokens.css")] : [];
  const first = order === "prod" ? [...tok, s("app/glass.css"), s("app/features.css"), { name: "globals.css", css: g.css }, font, s("app/synchro-ds.css")]
    : [font, ...tok, { name: "globals.css", css: g.css }, s("app/glass.css"), s("app/synchro-ds.css"), s("app/features.css")];
  return [...first, ...LAZY.map(s), ...(await vendor(root, compile)), ...injected(root)];
}
/** Bản build: tệp CSS tải đầu theo thứ tự <link> của trang tĩnh, rồi các tệp còn lại (tải chậm). */
export function loadBuild(dir, root) {
  const html = fs.readFileSync(path.join(dir, "server/app/terms.html"), "utf8");
  const first = [...html.matchAll(/href="\/_next\/(static\/css\/[^"]+\.css)"/g)].map((m) => m[1]);
  const all = fs.readdirSync(path.join(dir, "static/css")).map((f) => `static/css/${f}`);
  // Tệp tải chậm: xếp theo nội dung (tên băm đổi theo nội dung) để hai bản build so cùng thứ tự: theo lớp đầu tiên của tệp.
  const rest = all.filter((f) => !first.includes(f)).map((f) => ({ f, css: fs.readFileSync(path.join(dir, f), "utf8") }));
  const tag = (css) => (/KaTeX/.test(css.slice(0, 400)) ? "~katex" : /xterm/.test(css.slice(0, 2000)) ? "~xterm" : /\.([\w-]+)/.exec(css.replace(/@layer[^;{]*;/g, ""))?.[1] ?? "");
  rest.sort((a, b) => tag(a.css).localeCompare(tag(b.css)));
  return [...first.map((f) => ({ name: f, css: fs.readFileSync(path.join(dir, f), "utf8") })), ...rest.map((x) => ({ name: `${x.f} (${tag(x.css)})`, css: x.css })), ...injected(root)];
}

async function load(spec, root, order) {
  if (spec.startsWith("build:")) return loadBuild(spec.slice(6), root);
  const r = spec.replace(/^src:/, "");
  return loadSource(r, order);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const json = opt("--json"), max = +opt("--max", 60), oa = opt("--order-a", opt("--order", "dev")), ob = opt("--order-b", oa);
  const [a, b] = args;
  if (!a || !b) { console.log("Dùng: node scripts/css-cascade.mjs <src:thư mục | build:.next-x> <src:… | build:…> [--order dev|prod] [--json tệp]"); process.exit(2); }
  // build:<thư mục .next>@<thư mục mã nguồn>: thẻ <style> trong tsx đọc từ mã nguồn đó (mặc định thư mục hiện tại).
  const rootOf = (x) => path.resolve(x.startsWith("src:") ? x.slice(4) : x.includes("@") ? x.split("@")[1] : ".");
  const strip = (x) => (x.startsWith("build:") ? x.split("@")[0] : x);
  const root = rootOf(a);
  const A = collect(await load(strip(a), root, oa)), B = collect(await load(strip(b), rootOf(b), ob));
  const co = cooccurrence(root, A.decls);
  const r = diff(A, B, co, { raw: args.includes("--raw-key") });
  console.log(`Lớp (trước): ${A.layerOrder.join(", ") || "(không)"}\nLớp (sau):   ${B.layerOrder.join(", ") || "(không)"}`);
  console.log(`Khai báo: trước ${A.decls.length}, sau ${B.decls.length}; cặp có thể trùng phần tử đã so: ${r.pairs}`);
  console.log(`Mất ${r.lost.length}, thừa ${r.extra.length}, đổi bên thắng ${r.flips.length}`);
  for (const x of r.lost.slice(0, max)) console.log(`  - mất: ${x}`);
  for (const x of r.extra.slice(0, max)) console.log(`  + thừa: ${x}`);
  for (const f of r.flips.slice(0, max)) console.log(`  ⇄ ${f.atom}${f.pel ? `::${f.pel}` : ""}\n      trước thắng (${f.before.why}): ${f.before.win}\n      trước thua:  ${f.before.lose}\n      sau thắng (${f.after.why}): ${f.after.win}`);
  if (json) fs.writeFileSync(json, JSON.stringify(r, null, 1));
  process.exit(r.flips.length || r.lost.length || r.extra.length ? 1 : 0);
}
