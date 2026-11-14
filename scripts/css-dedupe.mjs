// B5 bước 8: tìm (và --write thì xóa) khai báo CSS chết chắc chắn: khai báo không bao giờ thắng vì có một khai báo khác cùng selector (đúng
// từng chữ), cùng điều kiện @media / @supports / @container, cùng thuộc tính gốc, luôn được nạp cùng lúc và luôn đứng trên nó trong cascade
// (lớp sau, hoặc cùng lớp mà nạp sau) ở CẢ thứ tự next dev lẫn thứ tự bản build webpack (glass + features trước globals, xem app/layout.tsx).
// Xóa những khai báo đó không đổi computed style của phần tử nào: selector giống hệt nên trúng đúng cùng phần tử, cùng specificity.
// Giữ nguyên (không coi là chết):
// - khai báo !important, khai báo trong @keyframes / @font-face / @property;
// - cặp trong CÙNG một luật mà giá trị khác nhau (mẫu dự phòng: height:100vh; height:100dvh);
// - khai báo bị che bởi giá trị cú pháp mới mà trình duyệt cũ có thể bỏ qua (dvh, color-mix, oklch, light-dark…): khi đó khai báo cũ là dự phòng;
// - khai báo của tệp tải chậm chỉ bị che bởi tệp tải chậm khác (tệp kia có thể chưa nạp). Tệp tải chậm chỉ bị che bởi chính nó hoặc tệp tải đầu.
// Luật trống sau khi xóa thì xóa luôn luật; khối @media trống thì xóa khối.
// Dùng: node scripts/css-dedupe.mjs [--write] [--list]   (mã thoát 1 khi còn khai báo chết: dùng như một bộ kiểm)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { splitList, specificity, atoms } from "./css-cascade.mjs";

const postcss = createRequire(import.meta.url)("postcss");
export const FIRST = ["app/globals.css", "app/glass.css", "app/synchro-ds.css", "app/features.css"];
export const LAZY = ["app/codeview.css", "app/speech/speech.css", "app/brainview.css", "app/download/download.css", "app/projects.css", "app/settings.css", "app/skills.css"];
// Thứ tự nạp: dev = thứ tự import của layout.tsx; prod = thứ tự <link> của bản build webpack (glass + features gộp một tệp, trước globals).
const ORDERS = {
  dev: ["app/globals.css", "app/glass.css", "app/synchro-ds.css", "app/features.css", ...LAZY],
  prod: ["app/glass.css", "app/features.css", "app/globals.css", "app/synchro-ds.css", ...LAZY],
};
const LAYERS = ["properties", "theme", "base", "components", "utilities", "syn", "syn-over"];
// Giá trị có thể không được trình duyệt cũ hiểu (bị bỏ khi phân tích) — khai báo nó che có thể là dự phòng.
const MODERN = /(?<![a-z])\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw|cqw|cqh|cqi|cqb|cqmin|cqmax)\b|color-mix|oklch|oklab|\blch\(|\blab\(|light-dark|anchor|\bfrom\s|round\(|text-wrap|interpolate-size|calc-size|-webkit-|-moz-/i;

const normSel = (s) => s.replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, " $1 ").trim();
const normCond = (m) => m.replace(/\s+/g, "").toLowerCase();
const normVal = (v) => v.replace(/\s+/g, " ").trim();

/** Mọi khai báo của các tệp (đọc mã nguồn), kèm nút postcss để xóa. */
export function load(root = ".") {
  const files = [...FIRST, ...LAZY];
  const sheets = files.map((f) => ({ f, root: postcss.parse(fs.readFileSync(path.join(root, f), "utf8"), { from: f }) }));
  const entries = [];
  for (const sh of sheets) {
    let pos = 0;
    const walk = (node, ctx) => {
      for (const ch of node.nodes ?? []) {
        if (ch.type === "atrule") {
          const name = ch.name.toLowerCase();
          if (name === "layer") { if (ch.nodes) walk(ch, { ...ctx, layer: ch.params.trim() }); continue; }
          if (name === "media" || name === "supports" || name === "container") walk(ch, { ...ctx, cond: [...ctx.cond, `@${name}${normCond(ch.params)}`] });
          continue;
        }
        if (ch.type !== "rule") continue;
        const sels = splitList(ch.selector).map(normSel);
        for (const d of ch.nodes ?? []) {
          if (d.type !== "decl") continue;
          const at = atoms(d.prop);
          for (const s of sels) for (const a of at) entries.push({ f: sh.f, node: d, rule: ch, sel: s, spec: specificity(s), cond: ctx.cond.join("&"), layer: ctx.layer, imp: !!d.important, atom: a, prop: d.prop.toLowerCase(), value: normVal(d.value), pos: pos });
          pos++;
        }
      }
    };
    walk(sh.root, { layer: null, cond: [] });
  }
  return { sheets, entries };
}

// Phần chủ của selector chắc chắn không phải <html> / <body>: có một lớp (không phải lớp đặt lên body) hay một thẻ khác html / body.
const BODY_CLASSES = new Set(["cv-dragging"]);
function inBody(sel) {
  if (/^html\b/.test(sel) || /:root|:host|:scope/.test(sel)) return false;
  const last = sel.split(/\s*[ >+~]\s*/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, "");
  const cls = [...last.matchAll(/\.(-?[\w-]+)/g)].map((m) => m[1]);
  const tag = /^[a-z][\w-]*/i.exec(last)?.[0]?.toLowerCase();
  return cls.some((c) => !BODY_CLASSES.has(c)) || (!!tag && tag !== "html" && tag !== "body");
}
// Tiền tố hãng (-webkit-backdrop-filter) và tên đồng nghĩa (inline-size → width) gộp về một thuộc tính gốc ở css-cascade, nhưng trình duyệt
// cũ có thể chỉ hiểu một trong hai tên: chỉ coi là che nhau khi cùng tên, hay khi là viết tắt / viết đủ không tiền tố của nhau.
const aliased = (p) => p.startsWith("-") && !p.startsWith("--") || (!p.startsWith("--") && atoms(p).length === 1 && atoms(p)[0] !== p);
const sameName = (x, y) => x.prop === y.prop || (!aliased(x.prop) && !aliased(y.prop));
const rank = (e) => (e.layer == null ? 1000 : LAYERS.indexOf(e.layer));
/** y luôn thắng x (cùng selector, cùng !important = false) ở thứ tự o? */
function beats(y, x, o) {
  const ly = rank(y), lx = rank(x);
  if (ly !== lx) return ly > lx;
  const iy = ORDERS[o].indexOf(y.f), ix = ORDERS[o].indexOf(x.f);
  return iy !== ix ? iy > ix : y.pos > x.pos;
}

/** Khai báo chết: Map nút decl → lý do (khai báo che nó). */
export function findDead({ entries }) {
  const by = new Map();
  for (const e of entries) { if (e.imp) continue; const k = `${e.sel}|${e.cond}|${e.atom}`; (by.get(k) ?? by.set(k, []).get(k)).push(e); }
  const shadowOf = (x) => {
    // "html body X" trúng mọi phần tử X nằm trong body (độ ưu tiên cao hơn X): che X ở cùng lớp hoặc lớp sau, bất kể thứ tự nạp — trừ khi X
    // có thể là chính <html> / <body> (lớp đặt lên body: cv-dragging).
    for (const y of inBody(x.sel) ? by.get(`html body ${x.sel}|${x.cond}|${x.atom}`) ?? [] : []) {
      if (!(FIRST.includes(y.f) || y.f === x.f) || rank(y) < rank(x) || !sameName(x, y)) continue;
      if (y.value !== x.value && MODERN.test(y.value)) continue;
      return y;
    }
    for (const y of by.get(`${x.sel}|${x.cond}|${x.atom}`) ?? []) {
      if (y === x || y.node === x.node || !sameName(x, y)) continue;
      if (!(FIRST.includes(y.f) || y.f === x.f)) continue;
      if (!beats(y, x, "dev") || !beats(y, x, "prod")) continue;
      if (y.rule === x.rule && y.value !== x.value) continue;
      if (y.value !== x.value && MODERN.test(y.value)) continue;
      return y;
    }
    return null;
  };
  const perNode = new Map();
  for (const x of entries) {
    if (x.imp) continue;
    const cur = perNode.get(x.node) ?? { all: true, by: null };
    const y = shadowOf(x);
    if (!y) cur.all = false; else cur.by ??= y;
    perNode.set(x.node, cur);
  }
  const dead = new Map();
  for (const [n, v] of perNode) if (v.all) dead.set(n, v.by);
  return dead;
}

/** Xóa khai báo chết (lặp tới khi không còn), trả về số khai báo / luật đã xóa theo tệp. */
export function dedupe(root = ".", write = false) {
  const stats = {}; let round = 0;
  for (;;) {
    const data = load(root);
    const dead = findDead(data);
    if (!dead.size) break;
    round++;
    for (const [d] of dead) {
      const f = data.entries.find((e) => e.node === d).f;
      (stats[f] ??= { decls: 0, rules: 0, list: [] }).decls++;
      const rule = d.parent; const by = dead.get(d);
      stats[f].list.push(`${f}:${d.source?.start?.line} ${rule.selector.replace(/\s+/g, " ").slice(0, 90)} { ${d.prop}: ${d.value} }  ← ${by.f}:${by.node.source?.start?.line}`);
      d.remove();
      if (!rule.nodes.some((n) => n.type !== "comment")) {
        // Luật chỉ còn chú thích: xóa luôn (chú thích ngay trước luật đi cùng nó? không — giữ chú thích đứng riêng).
        let p = rule.parent; rule.remove(); stats[f].rules++;
        while (p && p.type === "atrule" && p.name !== "layer" && !(p.nodes ?? []).some((n) => n.type !== "comment")) { const q = p.parent; p.remove(); p = q; }
      }
    }
    if (!write) break;
    for (const sh of data.sheets) fs.writeFileSync(path.join(root, sh.f), sh.root.toString());
    if (round > 10) break;
  }
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write"), list = process.argv.includes("--list");
  const stats = dedupe(".", write);
  let n = 0;
  for (const [f, s] of Object.entries(stats)) { n += s.decls; console.log(`${f}: ${s.decls} khai báo chết${s.rules ? `, ${s.rules} luật trống` : ""}`); if (list) for (const l of s.list) console.log("   " + l); }
  console.log(n ? `${write ? "đã xóa" : "còn"} ${n} khai báo chết` : "✓ không còn khai báo chết (bị che hẳn bởi khai báo cùng selector)");
  process.exit(n && !write ? 1 : 0);
}
