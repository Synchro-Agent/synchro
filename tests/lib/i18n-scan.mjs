// Quét chữ giao diện trong app/ để biết chuỗi nào chưa có bản dịch sang ngôn ngữ còn lại.
// Giao diện dịch bằng từ điển (app/i18n-dict.ts): chữ gốc tiếng Việt cần mục trong VI2EN (hoặc luật RULES_EN), chữ gốc tiếng Anh cần
// mục trong EN2VI (hoặc RULES_VI); chuỗi giữ nguyên ở cả hai ngôn ngữ (tên riêng, thuật ngữ) ghi trong SAME.
// Dùng: node tests/lib/i18n-scan.mjs [--all]  — in các chuỗi thiếu bản dịch theo tệp.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadTs } from "./ts.mjs";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
export const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
// Chữ chỉ tiếng Việt mới có (không lẫn với café, à la…): dùng để bắt bản dịch tiếng Anh còn sót tiếng Việt.
const VI_ONLY = /[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i;

// Thuộc tính JSX không phải chữ hiển thị.
const NOT_TEXT = new Set(["className", "class", "id", "key", "href", "src", "type", "role", "name", "style", "target", "rel", "method", "action", "accept",
  "autoComplete", "inputMode", "d", "viewBox", "fill", "stroke", "htmlFor", "mode", "variant", "size", "kind", "icon", "k", "lang", "dir", "tab", "pref",
  "value", "defaultValue", "pattern", "form", "list", "ref", "xmlns", "transform", "points", "gradientUnits", "offset", "stopColor", "strokeLinecap",
  "strokeLinejoin", "fillRule", "clipRule", "clipPath", "mask", "filter", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "width", "height",
  "preserveAspectRatio", "allow", "sandbox", "loading", "decoding", "referrerPolicy", "crossOrigin", "encType", "wrap", "spellCheck", "autoCapitalize",
  "enterKeyHint", "draggable", "tabIndex", "for", "media", "sizes", "srcSet", "poster", "preload", "download", "language", "theme", "path", "file", "url",
  "provider", "model", "vendor", "brand", "color", "align", "justify", "side", "place", "position", "anchor", "sel", "cls", "at", "order", "group", "slot"]);
// Hàm nhận chuỗi kỹ thuật (khóa, bộ chọn, sự kiện, đường dẫn…), không phải chữ hiển thị.
const TECH_CALL = /^(querySelector(All)?|closest|matches|addEventListener|removeEventListener|getItem|setItem|removeItem|fetch|usePref|useState|get|set|has|delete|getAttribute|setAttribute|removeAttribute|toggleAttribute|startsWith|endsWith|includes|indexOf|split|join|replace|replaceAll|match|test|exec|RegExp|createElement|createElementNS|dispatchEvent|CustomEvent|Event|postMessage|on|off|emit|send|require|import|getComputedStyle|getPropertyValue|setProperty|toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.\w+|DateTimeFormat|NumberFormat|localeCompare|padStart|padEnd|L|en|api|post|put|del|go|open|track|log|warn|error|info|debug|cn|clsx|twMerge|cva|encodeURIComponent|decodeURIComponent|atob|btoa|Blob|File|URL|URLSearchParams|append|Headers|keys|execCommand|focus|scrollTo|mark|measure|countRender|lsGet|lsSet|ss|key|pref|copy|write|writeText|download|saveAs)$/;

function walkDir(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (/\.(tsx|ts)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

// Chữ JSX như React hiển thị: bỏ khoảng trắng đầu / cuối từng dòng, nối các dòng bằng một dấu cách.
const jsxText = (raw) => {
  const lines = raw.split(/\r\n|\n|\r/);
  const keep = [];
  lines.forEach((l, i) => {
    let s = l.replace(/\t/g, " ");
    if (i) s = s.replace(/^ +/, "");
    if (i < lines.length - 1) s = s.replace(/ +$/, "");
    if (s) keep.push(s);
  });
  return keep.join(" ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
};

// Chuỗi trông như chữ cho người đọc (không phải lớp CSS, khóa, mã, đường dẫn…).
function textLike(s, strict) {
  const t = s.trim();
  if (t.length < 2 || !/\p{L}{2,}/u.test(t)) return false;
  if (VI.test(t)) return true;
  if (/^(https?:|mailto:|\/|\.\/|#|\.|\$|@|data:|blob:|var\(|calc\(|rgba?\(|hsla?\(|url\()/.test(t)) return false;
  if (/^[\w.-]+\/[\w./-]+$/.test(t) || /^[\w-]+\.[a-z0-9]{1,5}$/i.test(t)) return false; // đường dẫn, tên tệp
  if (/[{}<>;=`\\]|=>|\|\||&&/.test(t) && !/^[A-Z][^{}<>;=`\\]*$/.test(t)) return false;
  if (/^[a-z][\w-]*$/.test(t) && strict) return false; // từ thường viết liền: lớp, khóa
  if (/^[a-z]+(-[a-z0-9]+)+( [a-z]+(-[a-z0-9]+)*)*$/.test(t)) return false; // lớp CSS
  if (/^[a-z][a-zA-Z0-9]*([A-Z][a-z0-9]*)+$/.test(t)) return false; // camelCase
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 1 && /_/.test(t)) return false; // HẰNG_SỐ
  if (/^\d/.test(t) && !/ [a-z]{3,}/i.test(t)) return false;
  if (strict && !/^[A-Z“"'(«¿¡…·•⌘⇧⌥→←↑↓✓✕]/.test(t) && !/ /.test(t)) return false;
  if (strict && /^[a-z]/.test(t) && !/^[a-z]+( [a-z'’]+){1,}[.…!?]?$/.test(t)) return false;
  return true;
}

const SVG_TAG = /^(svg|path|g|circle|ellipse|rect|line|polyline|polygon|defs|filter|fe[A-Z]\w*|linearGradient|radialGradient|stop|mask|clipPath|pattern|use|symbol|marker|text|tspan|image)$/;
// Thuộc tính đối tượng mang giá trị kỹ thuật (khóa, kiểu, màu, phương thức…), không phải chữ.
const TECH_PROP = new Set([...NOT_TEXT, "method", "headers", "credentials", "cache", "mime", "ext", "cmd", "engine", "effort", "font", "fontFamily", "format", "re",
  "selector", "event", "cli", "plan", "scope", "op", "state", "env", "bg", "fg", "accent", "border", "shadow", "background", "display", "cursor", "transition",
  "animation", "boxShadow", "fontWeight", "flex", "gap", "grid", "gridTemplateColumns", "inset", "margin", "padding", "top", "left", "right", "bottom", "zIndex",
  "opacity", "outline", "overflow", "whiteSpace", "textAlign", "alignItems", "justifyContent", "flexDirection", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "lineHeight", "letterSpacing", "fontSize", "textTransform", "textDecoration", "borderRadius", "borderColor", "objectFit", "pointerEvents", "userSelect",
  "fontFeatureSettings", "fontVariantNumeric", "gridColumn", "gridRow", "flexWrap", "flexShrink", "flexGrow", "verticalAlign", "wordBreak", "textOverflow",
  "WebkitLineClamp", "WebkitBoxOrient", "mixBlendMode", "backdropFilter", "WebkitBackdropFilter", "boxSizing", "visibility", "resize", "aspectRatio",
  "content-type", "Content-Type", "contentType", "accept", "authorization", "q",
  // Bản dịch sẵn (descVi…), mô tả công cụ / tham số gửi model (description).
  "descVi", "vi", "describe", "kw", "keys", "keywords", "alias", "aliases", "match", "search", "terms", "hay"]);
// Lời nhắc gửi model đặt trong biến / thuộc tính tên kiểu SYS, prompt, rule…: không hiện trên màn hình.
const PROMPT_NAME = /(^|_)(SYS|sys)$|SYS_|^sys|system|prompt|PROMPT|instruct|INSTRUCT|^rule$|^rules$|RULES_SYS|^ask$|^q$/;

// Lấy mọi chuỗi giao diện trong một tệp: [{ line, text, kind }].
export function extract(file) {
  const src = readFileSync(file, "utf8");
  const isTsx = file.endsWith(".tsx");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const callName = (c) => { const e = c.expression; return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ""; };
  const UI_PROP = /^(label|title|desc|hint|tip|tips|text|note|reason|placeholder|summary|detail|caption|sub|subtitle|cta|empty|error|message|help|what|how|steps|info|heading|short|blurb|tagline|example|examples|cat|category|action|button|confirm|done|busy|status|warn|warning|tag|unit|badge|kindLabel|vi|l|t|d|name|author|description|about|long|intro)$/;
  const transparent = (p, c) => ts.isConditionalExpression(p) && p.condition !== c || ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind)
    || ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isNonNullExpression(p);
  // Ngữ cảnh của một chuỗi: thuộc tính JSX, tên thuộc tính đối tượng, có phải lời nhắc gửi model không.
  const ctx = (n) => {
    const r = { attr: null, tag: null, jsx: false, prop: null, prompt: false, err: false, call: null };
    let c = n, direct = true;
    for (let p = n.parent; p; c = p, p = p.parent) {
      // Cặp chữ theo ngôn ngữ: en() ? "English" : "Tiếng Việt", hoặc bộ ["Tiếng Việt", "English"] — đã tự chọn đúng ngôn ngữ.
      if (ts.isConditionalExpression(p) && p.condition !== c && /\ben\(\)|getLang\(\)|lang\s*===?\s*"en"|isEn\b|\ben\b/.test(p.condition.getText(sf))) { r.pair = true; break; }
      if (ts.isArrayLiteralExpression(p) && p.elements.length === 2 && p.elements.every((e) => ts.isStringLiteralLike(e)) && VI.test(p.elements[0].text) !== VI.test(p.elements[1].text)) { r.pair = true; break; }
      if (ts.isPropertyAccessExpression(p) && p.expression === c && TECH_CALL.test(p.name.text)) { r.call = p.name.text; break; }
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "join" && p.expression.expression === c) {
        const a = p.arguments[0]; if (a && ts.isStringLiteralLike(a) && /\n/.test(a.text)) r.prompt = true;
        continue;
      }
      if (direct && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression !== c) {
        r.call = ts.isCallExpression(p) ? callName(p) : ts.isIdentifier(p.expression) ? p.expression.text : "";
        if (ts.isNewExpression(p) && /Err(or)?$/.test(r.call)) r.err = true;
        direct = false; continue;
      }
      if (ts.isThrowStatement(p)) { r.err = true; break; }
      if (ts.isJsxAttribute(p)) { r.attr = p.name.getText(sf); r.tag = p.parent.parent.tagName.getText(sf); r.jsx = true; break; }
      if (ts.isJsxExpression(p)) { r.jsx = true; if (p.parent && ts.isJsxAttribute(p.parent)) continue; break; }
      if (ts.isPropertyAssignment(p)) {
        const nm = p.name.getText(sf).replace(/^["']|["']$/g, "");
        if (direct && r.prop === null) { r.prop = nm; r.schema = ts.isObjectLiteralExpression(p.parent) && p.parent.properties.some((q) => q.name && /^(type|properties|parameters|input_schema|inputSchema|schema|enum|items|required)$/.test(q.name.getText(sf))); } if (PROMPT_NAME.test(nm)) r.prompt = true; direct = false; continue; }
      if (ts.isVariableDeclaration(p)) { if (PROMPT_NAME.test(p.name.getText(sf))) r.prompt = true; break; }
      if (ts.isFunctionLike(p) || ts.isSourceFile(p) || ts.isBlock(p)) break;
      if (direct && !transparent(p, c)) direct = false;
    }
    return r;
  };
  const skipCtx = (r, text) => {
    if (r.prompt || r.pair) return true;
    if (r.call && TECH_CALL.test(r.call)) return true;
    if (r.attr) {
      if (r.tag && SVG_TAG.test(r.tag) && r.attr !== "aria-label") return true;
      if (NOT_TEXT.has(r.attr) || /^on[A-Z]/.test(r.attr) || r.attr === "style" || (r.attr.startsWith("data-") && r.attr !== "data-tip") || (r.attr.startsWith("aria-") && r.attr !== "aria-label")) return true;
    }
    if (r.prop && TECH_PROP.has(r.prop)) return true;
    if (r.prop === "description" && r.schema) return true; // mô tả công cụ / tham số gửi model
    if (!isTsx && !(r.err || (r.prop && UI_PROP.test(r.prop)))) return true; // tệp .ts: chỉ thông báo / nhãn cho người dùng
    if (!isTsx && (/\n/.test(text) || /^</.test(text.trim()) || text.length > 400)) return true;
    return false;
  };
  const literal = (n) => {
    const s = n.text, p = n.parent;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p) || ts.isExpressionStatement(p)) return;
    if (/^\(prefers-|^\(max-|^\(min-|^WEBGL_|^OES_|^EXT_/.test(s)) return;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isEnumMember(p)) && p.name === n) return;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword].includes(p.operatorToken.kind)) return;
    if (ts.isCaseClause(p)) return;
    // tr("…"): chữ hiển thị đi qua từ điển, luôn cần bản dịch (kể cả khi nằm trong ${…}).
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "tr" && p.arguments[0] === n) { if (/\p{L}{2}/u.test(s)) out.push({ line: lineOf(n), text: s, kind: "str" }); return; }
    const r = ctx(n);
    if (skipCtx(r, s)) return;
    if (!textLike(s, !VI.test(s)) || /\n/.test(s)) return;
    for (let q = n.parent; q && !ts.isSourceFile(q) && !ts.isBlock(q); q = q.parent) if (ts.isTemplateSpan(q)) return; // nằm trong ${…}: kiểm tra cùng chuỗi ngoài
    const glued = ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken;
    out.push({ line: lineOf(n), text: s, kind: r.attr ? "attr" : r.jsx ? "jsx" : "str", glued });
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) {
      const t = jsxText(n.text).trim();
      const tag = n.parent && ts.isJsxElement(n.parent) ? n.parent.openingElement.tagName.getText(sf) : "";
      if (t && /\p{L}/u.test(t) && !/^(style|script|code|pre)$/.test(tag)) out.push({ line: lineOf(n), text: t, kind: "jsx" });
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literal(n);
    else if (ts.isTemplateExpression(n)) {
      // Chuỗi ghép nằm trong ${…} của một chuỗi ghép khác: đã được kiểm tra cùng chuỗi ngoài.
      let nested = false;
      for (let p = n.parent; p && !ts.isSourceFile(p) && !ts.isBlock(p); p = p.parent) if (ts.isTemplateSpan(p)) { nested = true; break; }
      const r = nested ? { prompt: true } : ctx(n);
      const parts = [n.head.text, ...n.templateSpans.map((x) => x.literal.text)];
      const joined = parts.join(" ");
      if (!skipCtx(r, n.getText(sf)) && !/\n/.test(joined) && parts.some((x) => VI.test(x) || /[A-Za-z]{3,} [A-Za-z]{2,}|^ ?[A-Za-z]{3,}/.test(x)) && textLike(joined, !VI.test(joined)))
        out.push({ line: lineOf(n), text: parts.join("${…}"), kind: "tpl", parts });
      // Chuỗi con trong ${…} vẫn được duyệt riêng.
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export async function scan({ files } = {}) {
  const { "i18n-dict": D0, "i18n-vi": V } = await loadTs(["i18n-dict", "i18n-vi"]);
  const D = { ...D0, EN2VI: V.EN2VI, RULES_VI: V.RULES_VI };
  const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
  const rule = (rules, t) => rules.some(([re]) => re.test(t));
  const sameWords = D.SAME_WORDS ?? new Set();
  // Chuỗi trung tính: chỉ gồm tên riêng / thuật ngữ giữ nguyên, chữ viết tắt, số, phím tắt.
  const neutral = (t) => t.split(/[\s+&/()·:;,.\-–—|•@#'"“”!?…×=*%$€£¥→←↑↓~≈]+/).filter(Boolean)
    .every((w) => sameWords.has(w) || /^\d/.test(w) || /^[A-Z0-9]{2,}s?$/.test(w) || /^[⌘⇧⌥⌃↵⏎]+\w?$/.test(w) || /^\p{L}$/u.test(w) || /^v\d/.test(w));
  const same = { has: (t) => (D.SAME ?? new Set()).has(t) || neutral(t) };
  const strip = (t) => t.split(/\s+/).filter((w) => !sameWords.has(w.replace(/[^\p{L}\d]/gu, ""))).join(" ");
  const trEn = (t) => {
    if (has(D.VI2EN, t)) return D.VI2EN[t];
    for (const [re, f] of D.RULES_EN) { const m = t.match(re); if (m) return f(m); }
    return t;
  };
  const enOk = (t) => has(D.VI2EN, t) || rule(D.RULES_EN, t) || same.has(t);
  const viOk = (t) => has(D.EN2VI, t) || rule(D.RULES_VI, t) || same.has(t);
  const all = walkDir(path.join(process.cwd(), "app"));
  const list = files ?? all.filter((f) => !/i18n(-dict|-vi)?\.ts$|speech[\\/]i18n\.ts$/.test(f));
  const missing = [];
  let total = 0;
  for (const f of list) {
    for (const s of extract(f)) {
      total++;
      const rel = path.relative(process.cwd(), f);
      if (s.kind === "tpl") {
        // Chuỗi ghép: thử với giá trị mẫu, cần có luật dịch.
        if (/\.[a-z0-9]{2,4}$/i.test(s.parts[s.parts.length - 1])) continue; // tên tệp tải về
        const samples = ["3", "Synchro", "", "a"].map((v) => s.parts.join(v));
        const vi = s.parts.some((x) => VI.test(x));
        const okk = samples.some((x) => (vi ? enOk(x.trim()) : viOk(x.trim()) || enOk(x.trim())));
        if (!okk) missing.push({ file: rel, line: s.line, text: s.text, kind: "tpl", need: vi ? "en" : "vi" });
        continue;
      }
      const t = s.text.trim();
      const vi = VI.test(t);
      // Chữ không dấu có thể là tiếng Việt không dấu ("Ghim", "Xem") nên nhận cả mục VI2EN.
      // Bản dịch tiếng Anh còn sót chữ tiếng Việt (luật dịch quá rộng): vẫn tính là thiếu.
      if (vi && enOk(t) && !same.has(t) && VI_ONLY.test(strip(trEn(t)))) { missing.push({ file: rel, line: s.line, text: t, kind: s.kind, need: "en", partial: trEn(t) }); continue; }
      if (vi ? enOk(t) : viOk(t) || has(D.VI2EN, t)) continue;
      // Mảnh của chuỗi nối bằng +: thử ghép với một giá trị mẫu.
      if (s.glued && [`${s.text}Synchro`, `Synchro${s.text}`].some((x) => (vi ? enOk(x.trim()) : viOk(x.trim())))) continue;
      missing.push({ file: rel, line: s.line, text: t, kind: s.kind, need: vi ? "en" : "vi" });
    }
  }
  return { total, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, missing } = await scan();
  const by = new Map();
  for (const m of missing) { if (!by.has(m.file)) by.set(m.file, []); by.get(m.file).push(m); }
  for (const [f, ms] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${f} (${ms.length})`);
    for (const m of ms.slice(0, process.argv.includes("--all") ? 1e9 : 12)) console.log(`  ${String(m.line).padStart(5)} [${m.need}${m.kind === "tpl" ? ",ghép" : ""}] ${m.text.slice(0, 140)}${m.partial ? `  → dịch dở: ${m.partial.slice(0, 80)}` : ""}`);
  }
  console.log(`\n${missing.length} / ${total} chuỗi chưa có bản dịch · thiếu tiếng Anh: ${missing.filter((m) => m.need === "en").length} · thiếu tiếng Việt: ${missing.filter((m) => m.need === "vi").length}`);
}
