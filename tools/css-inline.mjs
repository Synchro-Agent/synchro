// B5 bước 4 (canh gác): style nội dòng của tsx đè khai báo CSS từng mang !important.
// Vì sao cần: !important thắng style nội dòng, còn khai báo thường ở BẤT KỲ lớp nào (kể cả syn-over) thì thua. Gỡ !important (chuyển sang
// syn-over hoặc bỏ chữ tại chỗ) mà phần tử đó có style nội dòng cùng thuộc tính thì bên thắng đổi từ CSS sang style nội dòng. Công cụ so tĩnh
// tools/css-cascade.mjs không thấy style nội dòng, nên ba lỗi của vòng rà B5 lọt qua: Row top { borderTop: 0 } (điều kiện), h3 margin trong
// Cài đặt, và bottom nội dòng truyền qua prop style của Menu ở ô soạn tin trang dự án.
// Cách làm (xấp xỉ, bảo thủ ở phần tử chủ, bỏ qua tổ tiên):
// - CSS: mọi khai báo thường trong @layer syn-over, cộng các khai báo từng mang !important đã bỏ chữ tại chỗ (FORMER, chép cứng lúc gỡ);
// - tsx: mọi phần tử JSX có style=… ở mọi dạng (đối tượng viết thẳng, toán tử ba ngôi, ...spread biến cùng tệp), lấy tên thẻ và các lớp có thể
//   có (mọi chuỗi trong className). Component chuyển style xuống một thẻ HTML (Menu: style={style}) thì lớp = lớp tĩnh của thẻ đó + className
//   truyền vào ở chỗ gọi;
// - báo cặp (khai báo, phần tử) khi phần tử chủ của selector có thể là phần tử đó (mọi lớp của phần tử chủ nằm trong lớp có thể có, thẻ khớp,
//   không phải pseudo-element) và hai bên cùng đặt một thuộc tính gốc (viết tắt trải ra). Cặp cố ý (đã xem là không cùng phần tử vì tổ tiên,
//   hoặc chấp nhận) ghi ở ALLOW kèm lý do.
// Dùng: node tools/css-inline.mjs [thư mục gốc]  (mã thoát 1 khi có cặp chưa giải thích)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { SRC_ROOTS } from "../tests/lib/srcroots.mjs";
import { subject, atoms, splitList, parseSelector } from "./css-cascade.mjs";

const req = createRequire(import.meta.url);

// Khai báo từng mang !important, nay bỏ chữ tại chỗ (vẫn ở lớp syn): [tệp, selector đã gộp khoảng trắng, thuộc tính]. Lập từ diff main → B5
// bước 4 (457e674); khai báo nào không còn thấy thì bỏ qua (CSS đã đổi).
export const FORMER = [
  ["ui/styles/codeview.css", ".cv-thread:has(.cv-empty)", "mask-image"],
  ["ui/styles/codeview.css", ".cv-thread:has(.cv-empty)", "-webkit-mask-image"],
  ["ui/styles/projects.css", ".pj-memlink", "color"], ["ui/styles/projects.css", ".pj-memlink", "opacity"], ["ui/styles/projects.css", ".pj-memlink", "text-decoration"],
  ["ui/styles/projects.css", ".pj-ctx-empty", "border"],
  ["ui/styles/projects.css", ".pj-gridf", "grid-template-columns"], ["ui/styles/projects.css", ".pj-desk .pj-gridf", "grid-template-columns"],
  ["ui/styles/projects.css", ".pj-hero-f", "overflow"], ["ui/styles/projects.css", "html body .modal.pj-modal h2", "letter-spacing"],
  ["ui/styles/skills.css", ".modal.settings .pl-top", "padding-right"],
  ["ui/styles/skills.css", ".pl-sec", "font-weight"], ["ui/styles/skills.css", ".pl-sec", "font-size"], ["ui/styles/skills.css", ".pl-sec", "margin"],
  ["ui/styles/skills.css", "html body .pl-sec", "font-size"], ["ui/styles/skills.css", "html body .pl-sec", "font-weight"],
  ["ui/styles/skills.css", ".pl-row2", "padding"], ["ui/styles/skills.css", ".pl-row2", "border-radius"], ["ui/styles/skills.css", ".pl-row2:hover", "background"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-nav .s-search", "border"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-group", "font-weight"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-item", "border-radius"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-body .row", "padding"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-body .row", "border"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-body .row", "border-bottom"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-body .row:not(:has(+.row))", "border-bottom"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .bn-stats", "gap"],
  ["app/_shell/synchro-ds.css", "html body .sy-settings .s-body .row:has(+.inset)", "border-bottom"],
  ["app/_shell/synchro-ds.css", ".sy-settings .s-body .inset>.row", "padding-left"],
  ["app/_shell/synchro-ds.css", ".sy-settings .s-body .inset>.row:first-child", "border-top"],
  ["app/_shell/synchro-ds.css", ".sy-settings .s-body .inset:not(:has(+.row))>.row:last-child", "border-bottom"],
];

// Cặp đã xem và chấp nhận: [tsx, chữ ký phần tử (thẻ.lớp.lớp, lớp sắp theo chữ cái), selector CSS (khớp nguyên văn), lý do].
export const ALLOW = [
  ["ui/brainui.tsx", "div.bn-graph.mini", ".bw-graph .bn-graph", "trong .bw-graph BrainGraph nhận height=\"100%\": style nội dòng cùng giá trị với CSS"],
  ["ui/modals.tsx", "input", ".bp-addr-w input", "ô đánh dấu của hộp xác nhận Đăng xuất, không nằm trong thanh địa chỉ trình duyệt (.bp-addr-w)"],
  ["ui/settings.tsx", "input.field", ".bp-addr-w input", "ô của Cài đặt (Select tìm kiếm, ô hồ sơ), không nằm trong thanh địa chỉ trình duyệt (.bp-addr-w)"],
  ["ui/settings.tsx", "input.field", "html body .cm-find input", "ô tìm trong menu Select của Cài đặt, không nằm trong .cm-find (menu + và thẻ)"],
  ["ui/speech/view.tsx", "i", ".sp-progress.ind i", "vạch credit trong .sp-credit-bar, không phải thanh tiến độ .sp-progress"],
  ["ui/brainui.tsx", "h3", "html body .sy-settings .s-body h3", "tiêu đề đầu trang .bn: trong Cài đặt bị ẩn (.sy-settings .bn>h3:first-child { display:none }), ngoài Cài đặt style nội dòng vẫn áp như trước"],
  ["ui/brainui.tsx", "h3", ".sy-settings .sy-sbody-h+*>h3:first-child", "như trên: tiêu đề đầu trang .bn bị ẩn trong Cài đặt"],
  ["ui/usageui.tsx", "h3", "html body .sy-settings .s-body h3", "tiêu đề đầu trang .us-page: trong Cài đặt bị ẩn (.sy-settings .us-page>h3:first-child { display:none })"],
  ["ui/usageui.tsx", "h3", ".sy-settings .sy-sbody-h+*>h3:first-child", "như trên: tiêu đề đầu trang .us-page bị ẩn trong Cài đặt"],
  ["ui/healthui.tsx", "div.d", ".sy-settings .s-body .row .d", "dòng sự cố nằm trong .adm-card > .adm-perm-row, không trong .row"],
  ["ui/healthui.tsx", "p.d", ".sy-settings .s-body .row .d", "kết quả thư thử nằm trong .adm-card, không trong .row"],
  ["ui/home.tsx", "label", ".sy-fieldrow label", "nhãn ô đánh dấu trong hộp Confirm (.modal.sm), không có .sy-fieldrow (chỉ ở hộp Dự án của modals.tsx)"],
  ["ui/settings.tsx", "input.field", ".sy-settings .s-body .row>.field", "≤860px cỡ ô do flex:1 1 100% (luật syn cùng chỗ) quyết định, width không dùng tới: width: 280 nội dòng thắng cũng không đổi bề rộng (tests/ui/inline-over.mjs đo)"],
  ["ui/filemenu.tsx", "div.fm-menu.menu", ".pj-compose :is(.model-menu,.mic-wrap .menu)", "menu tệp mở theo tọa độ chuột, không nằm trong .mic-wrap"],
  ["ui/settings.tsx", "div.down.menu.out", ".pj-compose :is(.model-menu,.mic-wrap .menu)", "menu của Select trong Cài đặt, không nằm trong ô soạn tin dự án"],
];

const norm = (s) => s.replace(/\s+/g, " ").trim();
const kebab = (p) => (p.startsWith("--") ? p : p.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (m) => `-${m.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

/** Khai báo cần soát: syn-over (thường) + FORMER (thường, ở bất kỳ lớp nào). */
export function cssTargets(root) {
  const postcss = req("postcss");
  const files = [];
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "vendor") walkDir(p); } else if (e.name.endsWith(".css")) files.push(p); } };
  for (const r of ["app", "ui"]) if (fs.existsSync(path.join(root, r))) walkDir(path.join(root, r));
  const former = new Set(FORMER.map(([f, s, p]) => `${f}|${norm(s)}|${p}`));
  const out = [], imp = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    const ast = postcss.parse(fs.readFileSync(f, "utf8"), { from: f });
    ast.walkDecls((d) => {
      if (d.parent?.type !== "rule") return;
      let over = false, kf = false;
      for (let p = d.parent; p; p = p.parent) if (p.type === "atrule") { if (p.name === "layer" && p.params.trim() === "syn-over") over = true; if (/keyframes$/i.test(p.name)) kf = true; }
      if (kf) return;
      const sel = norm(d.parent.selector);
      if (d.important) { imp.push({ sel, atoms: new Set(atoms(d.prop)) }); return; }
      if (!over && !former.has(`${rel}|${sel}|${d.prop}`)) return;
      out.push({ file: rel, line: d.source?.start?.line, sel, prop: d.prop, atoms: new Set(atoms(d.prop)), why: over ? "syn-over" : "từng !important" });
    });
  }
  out.imp = imp;
  return out;
}

/** Lớp của từng phần ghép tổ tiên trong selector (mỗi phần ghép là các phương án do :is): [[["a","b"],["c"]], …]. */
const ancestorAlts = (sel) => parseSelector(sel).slice(0, -1).map((comp) => {
  let alts = [[]];
  for (const x of comp) {
    if (x.k === "class") alts = alts.map((a) => [...a, x.v]);
    if (x.k === "pc" && (x.v === "is" || x.v === "where") && x.args) {
      const sub = splitList(x.args).map((a) => { const c = parseSelector(a); return c.length === 1 ? c[0].filter((y) => y.k === "class").map((y) => y.v) : []; });
      alts = alts.flatMap((a) => sub.map((b) => [...a, ...b]));
    }
  }
  return alts;
}).filter((alts) => alts.some((a) => a.length));
/** :is(…) / :where(…) có đối số phức (có khoảng trắng hoặc >) trải thành các selector riêng: .a :is(.b,.c .d) → .a .b, .a .c .d
 *  (xấp xỉ: tổ tiên trong đối số đặt sau tổ tiên bên ngoài). */
export function expandIs(sel) {
  const re = /:(?:is|where)\(/g; let m;
  while ((m = re.exec(sel))) {
    let d = 1, i = m.index + m[0].length;
    for (; i < sel.length && d; i++) { if (sel[i] === "(") d++; else if (sel[i] === ")") d--; }
    const args = splitList(sel.slice(m.index + m[0].length, i - 1));
    if (!args.some((a) => /[\s>+~]/.test(a.trim()))) continue;
    const head = sel.slice(0, m.index), tail = sel.slice(i);
    // Gắn vào một phần ghép (.x:is(.a .b)): chỉ giữ phần ghép cuối của đối số (bỏ tổ tiên của nó: rộng hơn, không hẹp hơn).
    const glue = (a) => (head && !/[\s>+~]$/.test(head) ? `${head}${a.split(/\s*[\s>+~]\s*/).pop()}` : `${head}${a}`);
    return args.flatMap((a) => expandIs(`${glue(a.trim())}${tail}`));
  }
  return [sel];
}

/** Chủ của selector có thể là phần tử: mọi lớp của một phương án nằm trong lớp có thể có, thẻ khớp, không phải pseudo-element. */
const subjectHits = (item, el) => {
  const sub = subject(item);
  return !sub.pel && sub.alts.some((a) => (a.cls.length || a.tag) && a.cls.every((c) => el.cls.has(c)) && (!a.tag || a.tag === el.tag));
};
/** Có bằng chứng trong cùng tệp: mọi phần ghép tổ tiên (có lớp) đều thấy trong chuỗi tổ tiên JSX của phần tử. */
const ancestorsSeen = (item, el) => ancestorAlts(item).every((alts) => alts.some((a) => a.every((c) => el.inFile.has(c))));

/** Tổ tiên có thể có: mọi phần ghép tổ tiên (có lớp) có một phương án mà mọi lớp đều xuất hiện trong ngữ cảnh lớp của tệp (xem ctx trong
 *  inlineStyles). Bỏ qua thứ tự và quan hệ cha con: chỉ loại phần tử ở tệp không hề ở gần lớp tổ tiên đó. */
const ancestorsInContext = (item, el) => ancestorAlts(item).every((alts) => alts.some((a) => a.every((c) => el.inFile.has(c) || el.outside.has(c))));

/** Phần tử JSX có style: { file, line, tag, cls:Set, props:Set (kebab) }. */
export function inlineStyles(root) {
  const ts = req(path.resolve(root, "node_modules/typescript"));
  const files = [];
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["node_modules", ".next", "vendor"].includes(e.name) && !e.name.startsWith(".next")) walkDir(p); } else if (/\.tsx$/.test(e.name)) files.push(p); } };
  for (const r of SRC_ROOTS) if (fs.existsSync(path.join(root, r))) walkDir(path.join(root, r));
  if (fs.existsSync(path.join(root, "components"))) walkDir(path.join(root, "components"));
  const parsed = files.map((f) => ({ f, rel: path.relative(root, f).split(path.sep).join("/"), sf: ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }));

  const tagName = (n) => n.tagName.getText();
  const attr = (n, name) => n.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
  const strings = (node) => {
    const r = [];
    const go = (x) => {
      if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) r.push(x.text);
      else if (ts.isTemplateExpression(x)) { r.push(x.head.text + " "); for (const s of x.templateSpans) { go(s.expression); r.push(" " + s.literal.text); } return; }
      ts.forEachChild(x, go);
    };
    if (node) go(node);
    // "a-${x}" → "a-" (lớp ghép động): bỏ mảnh kết thúc bằng "-".
    return r.join(" ").split(/\s+/).filter((t) => t && /^[\w-]+$/.test(t) && !t.endsWith("-"));
  };
  const clsOf = (n) => { const a = attr(n, "className"); return a?.initializer ? strings(a.initializer) : []; };

  // Lớp của từng tệp (mọi chuỗi trong className), nơi định nghĩa component nhập từ tệp khác (import tĩnh hoặc lazyView(() => import(…))),
  // và các tệp import nó tới hai bậc: tổ tiên ở ngoài tệp của một component export (settings.tsx nằm trong .sy-settings .s-body của
  // modals.tsx; adminui.tsx / brainui.tsx nằm trong settings.tsx).
  const own = new Map(), imports = new Map(), defs = new Map();
  for (const { sf, rel } of parsed) {
    const set = new Set(), dep = new Set(), def = new Map();
    const resolve = (spec) => {
      if (!spec.startsWith(".")) return null;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      return [`${base}.tsx`, `${base}/index.tsx`, base].find((x) => parsed.some((p) => p.rel === x)) ?? null;
    };
    const dynTarget = (node) => { let t = null; const g = (y) => { if (t) return; if (ts.isCallExpression(y) && y.expression.kind === ts.SyntaxKind.ImportKeyword && y.arguments[0] && ts.isStringLiteral(y.arguments[0])) t = resolve(y.arguments[0].text); else ts.forEachChild(y, g); }; g(node); return t; };
    const go = (x) => {
      if (ts.isJsxAttribute(x) && x.name.getText() === "className" && x.initializer) for (const c of strings(x.initializer)) set.add(c);
      if (ts.isImportDeclaration(x) && ts.isStringLiteral(x.moduleSpecifier)) {
        const t = resolve(x.moduleSpecifier.text);
        if (t) {
          dep.add(t);
          const cl = x.importClause;
          if (cl?.name) def.set(cl.name.text, t);
          if (cl?.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const e of cl.namedBindings.elements) def.set(e.name.text, t);
        }
      }
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) { const t = dynTarget(x.initializer); if (t) { dep.add(t); def.set(x.name.text, t); } }
      ts.forEachChild(x, go);
    };
    go(sf); own.set(rel, set); imports.set(rel, dep); defs.set(rel, def);
  }
  const importers = new Map([...own.keys()].map((k) => [k, new Set()]));
  for (const [f, dep] of imports) for (const d of dep) importers.get(d)?.add(f);
  const outer = new Map();
  for (const rel of own.keys()) {
    const files = new Set();
    for (const a of importers.get(rel)) { files.add(a); for (const b of importers.get(a)) files.add(b); }
    files.delete(rel);
    const set = new Set(); for (const f of files) for (const c of own.get(f)) set.add(c);
    outer.set(rel, set);
  }

  // Biến cùng tệp (const x = {...}) để trải ...x / style={x}.
  const vars = new Map();
  for (const { sf, rel } of parsed) {
    const m = new Map();
    const go = (x) => { if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) m.set(x.name.text, x.initializer); ts.forEachChild(x, go); };
    go(sf); vars.set(rel, m);
  }
  const propsOf = (expr, rel, seen = new Set()) => {
    const out = new Set(); let forwards = false;
    const go = (x) => {
      if (ts.isObjectLiteralExpression(x)) {
        for (const p of x.properties) {
          if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) {
            const n = ts.isComputedPropertyName(p.name) ? null : p.name.text ?? p.name.getText();
            if (n) out.add(kebab(String(n)));
            if (ts.isPropertyAssignment(p)) go(p.initializer);
          } else go(p);
        }
        return;
      }
      if (ts.isIdentifier(x)) {
        if (x.text === "style") forwards = true;
        const init = vars.get(rel)?.get(x.text);
        if (init && !seen.has(x.text)) { seen.add(x.text); go(init); }
        return;
      }
      if (ts.isPropertyAccessExpression(x)) { if (x.name.text === "style") forwards = true; go(x.expression); return; }
      if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return;
      ts.forEachChild(x, go);
    };
    go(expr);
    return { props: out, forwards };
  };

  // Component chuyển style xuống thẻ HTML: tên → { tag, base lớp tĩnh }.
  const fwd = new Map();
  // Tổ tiên trong cùng tệp: chuỗi lớp của các thẻ JSX bao quanh, nối qua chỗ dùng của "chủ" cây JSX (component viết hoa: <Row …>; biến / hàm
  // viết thường: {plus}, {row(x)}). Chủ không có chỗ dùng trong tệp (component export ra ngoài) thì "mở": tổ tiên có thể là lớp của tệp khác.
  const styled = [], uses = new Map(); // uses: tệp → [{ name, chain, owner }]
  const compCls = new Map(); // "tệp|Component" → lớp viết trong JSX của component đó
  const visit = (rel, sf, pass) => {
    let comp = null, owner = null, inExpr = 0; const chain = [];
    const use = (name) => { if (pass !== 0) return; const l = uses.get(rel) ?? uses.set(rel, []).get(rel); l.push({ name, chain: [...chain], owner }); };
    const go = (x) => {
      const prev = comp, prevOwner = owner, prevExpr = inExpr; let pushed = false;
      if (ts.isFunctionDeclaration(x) && x.name) { owner = x.name.text; if (/^[A-Z]/.test(owner)) comp = owner; }
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) {
        owner = x.name.text;
        if (/^[A-Z]/.test(owner) && (ts.isArrowFunction(x.initializer) || ts.isCallExpression(x.initializer) || ts.isFunctionExpression(x.initializer))) comp = owner;
      }
      if (ts.isJsxExpression(x)) inExpr++;
      if (inExpr && ts.isIdentifier(x) && !ts.isPropertyAccessExpression(x.parent)) use(x.text);
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) {
        const open = ts.isJsxElement(x) ? x.openingElement : x;
        const name = tagName(open);
        const intrinsic = /^[a-z]/.test(name) || /^motion\./.test(name);
        if (!intrinsic) use(name);
        if (pass === 0 && intrinsic && comp) { const k = `${rel}|${comp}`; const set = compCls.get(k) ?? compCls.set(k, new Set()).get(k); for (const c of clsOf(open)) set.add(c); }
        const st = attr(open, "style");
        const tag = intrinsic ? name.replace(/^motion\./, "").toLowerCase() : null;
        if (st?.initializer) {
          const expr = ts.isJsxExpression(st.initializer) ? st.initializer.expression : st.initializer;
          const { props, forwards } = expr ? propsOf(expr, rel) : { props: new Set(), forwards: false };
          if (pass === 0 && intrinsic && forwards && comp && !fwd.has(comp)) fwd.set(comp, { tag, base: clsOf(open) });
          if (pass === 1 && props.size) {
            const f = intrinsic ? null : fwd.get(name);
            if (intrinsic || f) styled.push({ file: rel, line: sf.getLineAndCharacterOfPosition(open.getStart()).line + 1, tag: f ? f.tag : tag, cls: new Set(f ? [...f.base, ...clsOf(open)] : clsOf(open)), props, up: [...chain], owner });
          }
        }
        // Thẻ HTML: lớp của nó bao các con (và phần tử truyền qua prop). Component nhập từ tệp khác: con / phần tử truyền qua prop của nó có
        // thể nằm trong bất kỳ lớp nào tệp đó viết (ô soạn tin truyền qua composer={…} vào .pj-compose của projects.tsx).
        // Component cùng tệp: lớp viết trong JSX của nó (Row bọc con trong .row).
        const dt = intrinsic ? null : defs.get(rel)?.get(name.split(".")[0]);
        chain.unshift(new Set(intrinsic ? clsOf(open) : dt ? own.get(dt) : compCls.get(`${rel}|${name}`) ?? [])); pushed = true;
        inExpr = 0;
      }
      ts.forEachChild(x, go);
      if (pushed) chain.shift();
      comp = prev; owner = prevOwner; inExpr = prevExpr;
    };
    go(sf);
  };
  for (const { rel, sf } of parsed) visit(rel, sf, 0);
  for (const { rel, sf } of parsed) visit(rel, sf, 1);
  const memo = new Map();
  const anc = (rel, name, depth = 0) => {
    const k = `${rel}|${name}`;
    if (memo.has(k)) return memo.get(k);
    if (!name || depth > 8) return { set: new Set(), open: true };
    memo.set(k, { set: new Set(), open: false }); // chặn vòng lặp
    const set = new Set(); let open = false;
    const us = (uses.get(rel) ?? []).filter((u) => u.name === name && u.owner !== name);
    if (!us.length) open = true;
    for (const u of us) {
      for (const c of u.chain) for (const x of c) set.add(x);
      const up = anc(rel, u.owner, depth + 1);
      for (const x of up.set) set.add(x);
      if (up.open) open = true;
    }
    const r = { set, open };
    memo.set(k, r);
    return r;
  };
  const elements = styled.map((el) => {
    const a = anc(el.file, el.owner);
    const inFile = new Set(a.set); for (const c of el.up) for (const x of c) inFile.add(x);
    const outside = a.open ? outer.get(el.file) : new Set();
    return { ...el, inFile, outside };
  });
  return { elements, forwarders: fwd };
}

/** Cặp (khai báo thường từng thắng nhờ !important, phần tử có style nội dòng cùng thuộc tính) có thể trùng phần tử. */
export function conflicts(root) {
  const css = cssTargets(root);
  const { elements } = inlineStyles(root);
  const out = [];
  for (const d of css) {
    for (const item of splitList(d.sel).flatMap(expandIs)) {
      for (const el of elements) {
        const hit = [...new Set([...el.props].flatMap((p) => atoms(p)))].filter((a) => d.atoms.has(a));
        if (!hit.length || !subjectHits(item, el) || !ancestorsInContext(item, el)) continue;
        // Khai báo !important còn lại cùng thuộc tính, trúng chính phần tử này (tổ tiên thấy trong tệp): CSS vẫn thắng style nội dòng như
        // trên main; thứ tự giữa khai báo !important đó và khai báo thường ở đây do css-cascade.mjs canh.
        const left = hit.filter((a) => !css.imp.some((k) => k.atoms.has(a) && splitList(k.sel).some((it) => subjectHits(it, el) && ancestorsSeen(it, el))));
        if (!left.length) continue;
        const allowed = ALLOW.find(([f, e, s]) => f === el.file && sig(el) === e && s === d.sel);
        out.push({ css: `${d.file}:${d.line} ${d.sel} { ${d.prop} } (${d.why})`, el: `${el.file}:${el.line} ${sig(el)} style: ${[...el.props].join(", ")}`, atoms: left, allowed: allowed?.[3] ?? null, file: el.file, sig: sig(el), sel: d.sel, seen: ancestorsSeen(item, el) });
      }
    }
  }
  // Một cặp (khai báo, phần tử) có thể trùng qua nhiều mục của danh sách selector: gộp.
  const seen = new Set();
  return out.filter((c) => { const k = c.css + "|" + c.el; if (seen.has(k)) return false; seen.add(k); return true; });
}
/** Chữ ký phần tử cho ALLOW: thẻ + lớp tĩnh đã sắp. */
const sig = (el) => [el.tag, ...[...el.cls].sort()].join(".");

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = path.resolve(process.argv[2] ?? ".");
  const r = conflicts(root);
  const bad = r.filter((c) => !c.allowed);
  console.log(`Cặp style nội dòng ↔ khai báo từng !important: ${r.length} (chấp nhận ${r.length - bad.length}, chưa giải thích ${bad.length})`);
  for (const c of bad) console.log(`  ✗ ${c.atoms.join(",")}${c.seen ? " [tổ tiên thấy trong tệp]" : ""}\n      CSS: ${c.css}\n      tsx: ${c.el}`);
  process.exit(bad.length ? 1 : 0);
}
