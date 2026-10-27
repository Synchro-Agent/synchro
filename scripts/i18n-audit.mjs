// Rà chữ hiện trên giao diện còn thiếu bản dịch (giao diện tự dịch từng đoạn chữ theo app/i18n-dict.ts khi chạy):
// chữ tiếng Việt cần bản tiếng Anh (VI2EN / RULES_EN), chữ tiếng Anh cần bản tiếng Việt (EN2VI / RULES_VI).
// Dùng: node scripts/i18n-audit.mjs [--json out.json] [--files app/speech]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../tests/lib/ts.mjs";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const { "i18n-dict": D } = await loadTs(["i18n-dict"]);
const args = process.argv.slice(2);
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const only = args.includes("--files") ? args[args.indexOf("--files") + 1] : "app";

const VI = /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i;
const has = (map, t) => Object.prototype.hasOwnProperty.call(map, t);
const ruled = (rules, t) => rules.some(([re]) => re.test(t));
const okVi = (t) => has(D.VI2EN, t) || ruled(D.RULES_EN, t);
const okEn = (t) => has(D.EN2VI, t) || ruled(D.RULES_VI, t);
// Chữ tiếng Anh hiện cho người dùng: có chữ cái, không phải tên lớp CSS, đường dẫn, mã, biến…
const looksEn = (t) => /[A-Za-z]{2}/.test(t) && !VI.test(t) && /^[A-Z0-9"“(¿¡]/.test(t) && !/^[A-Z0-9_]+$/.test(t) && !/^[\w.-]+\/[\w./-]+$/.test(t)
  && !/^(https?:|mailto:|data:|#|\.|\/)/.test(t) && !/^[a-z]+[A-Z]\w*$/.test(t) && !/[{};=<>]|=>/.test(t) && t.length < 400;
// Tên riêng / thương hiệu giữ nguyên ở cả hai ngôn ngữ.
const KEEP = /^(Synchro|Claude|ChatGPT|Gemini|OpenAI|Anthropic|Google|GitHub|ElevenLabs|Codex|Antigravity|Notion|Linear|Figma|Slack|MCP|API|URL|ID|OK|PDF|CSV|JSON|HTML|CSS|SVG|PNG|JPG|MP3|WAV|Opus|Python|Node|React|Next\.js|TypeScript|JavaScript|Markdown|Vercel|Stripe|Pro|Max|Free|Plus|Team|Enterprise|Business|Starter|Creator|Scale|Ultra|Eleven \w+.*|Scribe.*|Voice ID|Beta|Alpha|Auto|Fable|Opus|Sonnet|Haiku|Mythos|[A-Z]{1,4}|\d.*)$/;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); }
    else if (/\.tsx$/.test(e.name) || (/\.ts$/.test(e.name) && /app\/(speech\/(client|data)|store|wsclient|worklog)\.ts$/.test(p))) files.push(p);
  }
})(only);

const miss = { vi: new Map(), en: new Map(), tpl: new Map() };
const add = (kind, t, where) => { const m = miss[kind]; if (!m.has(t)) m.set(t, new Set()); m.get(t).add(where); };
// Thuộc tính JSX hiện ra màn hình (tên thuộc tính của Synchro: label, hint, desc, title, placeholder…); bỏ className, key, href…
const SKIP_ATTR = /^(className|key|href|src|id|htmlFor|type|name|role|rel|target|value|defaultValue|ref|style|lang|dir|method|action|accept|autoComplete|inputMode|d|viewBox|fill|stroke\w*|transform|points|cx|cy|r|x|y|width|height|k|v|t|f|icon|kind|mode|variant|size|as|data-\w+|aria-(?!label)\w+|tab|sub|cmd|keys?|shortcut|model|voice|lang\w*|path|url|to)$/;

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(process.cwd(), f);
  const check = (raw, node) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || t.length < 2 || KEEP.test(t)) return;
    const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    if (VI.test(t)) { if (!okVi(t)) add("vi", t, where); }
    else if (looksEn(t) && !okEn(t)) add("en", t, where);
  };
  const inSkippedAttr = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p)) return SKIP_ATTR.test(p.name.getText());
      if (ts.isCallExpression(p)) {
        const c = p.expression.getText();
        // Lời nhắc gửi model, log, khóa cài đặt, đường dẫn API: không phải chữ giao diện.
        if (/^(console\.\w+|usePref|readPref|fetch|api|post|del|postForm|JSON\.\w+|new RegExp|RegExp|localStorage\.\w+|ls\.\w+|\w+\.test|\w+\.match|\w+\.replace|\w+\.split|\w+\.startsWith|\w+\.includes|\w+\.endsWith|\w+\.join|setSetting|getSetting|require|import)$/.test(c)) return true;
      }
      if (ts.isElementAccessExpression(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      if (ts.isPropertyAssignment(p) && /^(system|prompt|instructions|cmd|className|key|id|href|url|path|model|voice|icon|kind|k|type|lang|code|desc_en)$/.test(p.name.getText())) return true;
      if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText())) return true;
      if (ts.isCaseClause(p) || ts.isTypeNode?.(p) || ts.isLiteralTypeNode(p)) return true;
    }
    return false;
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) check(n.getText(), n);
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !inSkippedAttr(n)) {
      // Chuỗi ngoài JSX chỉ xét khi là chữ tiếng Việt (gần như chắc chắn hiện cho người dùng) hoặc nằm trong JSX.
      const inJsx = !!ts.findAncestor(n, (p) => ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxFragment(p));
      if (VI.test(n.text) || inJsx || /^(say|toast|app\.say|setErr|setError|confirm|app\.confirm|alert)\b/.test(n.parent?.expression?.getText?.() ?? "")) check(n.text, n);
    } else if (ts.isTemplateExpression(n) && !inSkippedAttr(n)) {
      const pat = n.head.text + n.templateSpans.map((s) => `{…}${s.literal.text}`).join("");
      // Thử quy tắc với giá trị mẫu thay cho phần chèn (số / tên); đã có quy tắc khớp thì không báo.
      const t = pat.replace(/\s+/g, " ").trim();
      const tries = [t.replace(/\{…\}/g, "3"), t.replace(/\{…\}/g, "Claude"), t.replace(/\{…\}/g, "Mẫu")];
      const covered = VI.test(t) ? tries.some(okVi) : tries.some(okEn);
      // Mã HTML / CSS / lời nhắc gửi model (có thẻ, dấu ngoặc nhọn, nhiều dòng) không phải chữ giao diện.
      const code = /<[a-z!/]|[{};]\s*[a-z-]+:|function\s*\(|=>/i.test(t) || t.length > 240;
      if (!covered && !code && (VI.test(t) || /[A-Za-z]{3} [A-Za-z]{2}/.test(t))) add("tpl", t, `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const dump = (m) => [...m].map(([t, w]) => ({ t, at: [...w].slice(0, 3) })).sort((a, b) => a.at[0].localeCompare(b.at[0]));
const res = { vi: dump(miss.vi), en: dump(miss.en), tpl: dump(miss.tpl) };
console.log(`Thiếu bản tiếng Anh (chữ tiếng Việt): ${res.vi.length}\nThiếu bản tiếng Việt (chữ tiếng Anh): ${res.en.length}\nChuỗi ghép cần quy tắc: ${res.tpl.length}`);
const byFile = (list) => { const c = {}; for (const x of list) { const f = x.at[0].split(":")[0]; c[f] = (c[f] ?? 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 25); };
console.log("Theo tệp (vi):", JSON.stringify(byFile(res.vi)));
console.log("Theo tệp (en):", JSON.stringify(byFile(res.en)));
if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
