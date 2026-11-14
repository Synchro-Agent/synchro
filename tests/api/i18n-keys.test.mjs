// Cổng một cơ chế dịch (Blueprint B6 bước 9). Không cần máy chủ.
// 1. Mọi chữ giao diện trong app/ có khóa ở ngôn ngữ còn lại (tests/lib/i18n-scan.mjs, kể cả chữ trong toán tử ngôn ngữ và bảng [vi, en] cũ).
// 2. Không còn toán tử ngôn ngữ chọn chữ (en ? "English" : "Tiếng Việt") ngoài PAIR_ALLOW của bộ quét.
// 3. Không còn từ điển cục bộ: hàm L(vi, en), bảng ["Tiếng Việt", "English"], đối tượng { vi, en } ngoài PAIR_ALLOW.
// 4. Không có khóa trùng mà khác bản dịch giữa các tệp từ điển (Object.assign / addNew: chỉ một bản thắng, bản kia là chữ chết gây hiểu nhầm).
// 5. Một thuật ngữ cho mỗi khái niệm (B6 mục 4): connector, skill (Kho kỹ năng là tên kho), Speech, "Hội thoại" chỉ là Dialogue của Speech.
// Tên mặc định "Lâm Tùng" và việc tệp giao diện kéo theo i18n-server.ts đã chặn ở tests/api/i18n.test.mjs.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PAIR_ALLOW, VI, extract, scan } from "../lib/i18n-scan.mjs";
import { loadTs } from "../lib/ts.mjs";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 2000)); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p); } };
walk(path.join(process.cwd(), "app"));
const parse = (f, src = readFileSync(f, "utf8")) => ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

// Điều kiện "đang ở tiếng Anh": en(), isEn(), getLang() === "en", lang === "en", biến en.
const LANG_COND = /\ben\(\)|\bisEn\(\)|getLang\(\)\s*===?\s*["']en["']|\blang\s*===?\s*["']en["']|^\s*!?\s*en\s*$|\ben\s*(&&|\|\|)|(&&|\|\|)\s*en\b/;
// Chuỗi là chữ cho người đọc (không phải "en-US", tên lớp, khóa): có dấu tiếng Việt, hoặc từ hai từ trở lên, hoặc một từ viết hoa.
const wordy = (s) => /\p{L}{2}/u.test(s) && (VI.test(s) || /[A-Za-z]{2,}[\s,.:;!?'’]+[A-Za-z]{2,}/.test(s) || /^[A-Z][a-z]{2,}$/.test(s.trim()));
// Nhánh có chữ: chuỗi / chuỗi ghép / JSX có chữ, xét cả nhánh lồng (a ? "x" : b ? "y" : "z") và (… , "x").
function textBranch(n, sf) {
  if (!n) return false;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) return textBranch(n.expression, sf);
  if (ts.isStringLiteralLike(n)) return wordy(n.text);
  if (ts.isTemplateExpression(n)) return wordy([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "));
  if (ts.isConditionalExpression(n)) return textBranch(n.whenTrue, sf) || textBranch(n.whenFalse, sf);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return textBranch(n.left, sf) || textBranch(n.right, sf);
  if (ts.isJsxElement(n) || ts.isJsxFragment(n)) { let t = false; const v = (c) => { if (ts.isJsxText(c) && wordy(c.text.trim())) t = true; else ts.forEachChild(c, v); }; v(n); return t; }
  return false;
}
// Tên phím trong bảng phím tắt ["Esc", "Đóng bảng"]: không phải chữ tiếng Anh cần dịch.
const KEY = /^(Esc|Tab|Enter|Space|Delete|Backspace|Home|End|Shift|Ctrl|Alt|Option)$/;
const allowed = (f, name) => own(PAIR_ALLOW, f) || (name && own(PAIR_ALLOW, `${f}#${name}`));
const declName = (n, sf) => { for (let p = n; p && !ts.isSourceFile(p); p = p.parent) if (ts.isVariableDeclaration(p)) return p.name.getText(sf); return null; };

/** Tìm chỗ chọn chữ theo ngôn ngữ ngay tại chỗ trong một tệp: toán tử ngôn ngữ, hàm L(vi, en), bảng [vi, en], đối tượng { vi, en }. */
function langPicks(f, src) {
  const sf = parse(f, src), r = rel(f), out = { ternary: [], helper: [], table: [] };
  const at = (n) => `${r}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n) => {
    if (ts.isConditionalExpression(n) && LANG_COND.test(n.condition.getText(sf)) && (textBranch(n.whenTrue, sf) || textBranch(n.whenFalse, sf)) && !allowed(r, declName(n, sf)))
      out.ternary.push(`${at(n)} ${n.getText(sf).replace(/\s+/g, " ").slice(0, 90)}`);
    if (ts.isFunctionLike(n) && n.parameters?.length >= 2) {
      const ps = n.parameters.slice(0, 2).map((p) => p.name.getText(sf).replace(/^_/, ""));
      if ((ps[0] === "vi" && ps[1] === "en") || (ps[0] === "en" && ps[1] === "vi")) if (!allowed(r, declName(n, sf))) out.helper.push(`${at(n)} ${(declName(n, sf) ?? "(hàm)")}(${ps.join(", ")})`);
    }
    if (ts.isArrayLiteralExpression(n) && n.elements.length === 2 && n.elements.every((e) => ts.isStringLiteralLike(e))) {
      const [a, b] = n.elements.map((e) => e.text);
      if (VI.test(a) !== VI.test(b) && wordy(a) && wordy(b) && !KEY.test(a) && !KEY.test(b) && !allowed(r, declName(n, sf))) out.table.push(`${at(n)} [${JSON.stringify(a).slice(0, 40)}, ${JSON.stringify(b).slice(0, 40)}]`);
    }
    if (ts.isObjectLiteralExpression(n)) {
      const get = (k) => n.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf).replace(/["']/g, "") === k);
      const vi = get("vi"), en = get("en");
      // Bảng mã ngôn ngữ → tên (vi: "Tiếng Việt", en: "Tiếng Anh") cùng một ngôn ngữ thì không phải cặp dịch.
      if (vi && en && [vi, en].every((p) => ts.isStringLiteralLike(p.initializer) && wordy(p.initializer.text)) && VI.test(vi.initializer.text) !== VI.test(en.initializer.text) && !allowed(r, declName(n, sf))) out.table.push(`${at(n)} { vi, en }`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

console.log("1. Mọi chữ giao diện có khóa (bộ quét không còn bỏ qua cặp chữ và L())");
const { total, missing } = await scan();
const show = (ms) => ms.slice(0, 30).map((m) => `\n     ${m.file}:${m.line} [${m.need}${m.kind === "tpl" ? ",ghép" : ""}] ${m.text.slice(0, 100)}${m.partial ? ` → dịch dở: ${m.partial.slice(0, 60)}` : ""}`).join("");
ok(total > 6000, `quét ${total} chuỗi giao diện`, total);
ok(!missing.length, `không thiếu khóa nào (thiếu: ${missing.length})`, show(missing));

console.log("2–3. Không chọn chữ theo ngôn ngữ ngay tại chỗ");
const picks = { ternary: [], helper: [], table: [] };
for (const f of files) { const p = langPicks(f, readFileSync(f, "utf8")); for (const k of Object.keys(picks)) picks[k].push(...p[k]); }
ok(!picks.ternary.length, `không còn toán tử ngôn ngữ chọn chữ ngoài PAIR_ALLOW (${Object.keys(PAIR_ALLOW).length} mục được miễn có lý do)`, picks.ternary.join("\n     "));
ok(!picks.helper.length, "không còn hàm dịch cục bộ L(vi, en)", picks.helper.join("\n     "));
ok(!picks.table.length, "không còn bảng [vi, en] / { vi, en } ngoài PAIR_ALLOW", picks.table.join("\n     "));
{
  // Mục miễn phải còn đúng: tệp còn tồn tại (tránh danh sách miễn cũ che lỗi mới).
  const gone = Object.keys(PAIR_ALLOW).map((k) => k.split("#")[0]).filter((f) => !files.some((x) => rel(x) === f));
  ok(!gone.length, "mọi tệp trong PAIR_ALLOW còn tồn tại", gone.join(", "));
}
{
  // Phép kiểm bắt được từng loại (tệp thử nằm ngoài app/ nên không thuộc PAIR_ALLOW).
  const dir = mkdtempSync(path.join(os.tmpdir(), "i18n-keys-"));
  const f = path.join(dir, "thu.tsx");
  const src = [
    `const L = (vi: string, en: string) => (en ? en : vi);`,
    `const T: [string, string][] = [["Đã lưu ghi chú", "Note saved"]];`,
    `const O = { vi: "Đóng bảng", en: "Close panel" };`,
    `export const A = ({ en }: { en: boolean }) => <p>{en ? "Saved the note" : "Đã lưu ghi chú"}{isEn() ? <b>Open it</b> : <b>Mở ra</b>}{en ? "en-US" : "vi-VN"}{isEn() ? { hour: "numeric" } : {}}</p>;`,
  ].join("\n");
  writeFileSync(f, src);
  const p = langPicks(f, src);
  rmSync(dir, { recursive: true, force: true });
  ok(p.ternary.length === 2 && p.helper.length === 1 && p.table.length === 2, "phép kiểm bắt được toán tử ngôn ngữ (chuỗi, chữ JSX), hàm L(vi, en), bảng [vi, en] và { vi, en }; bỏ qua toán tử chỉ chọn locale / tùy chọn định dạng", JSON.stringify(p));
}

console.log("4. Không có khóa trùng khác bản dịch giữa các tệp từ điển");
const DICT_FILES = ["i18n-dict.ts", "i18n-vi.ts", "i18n-ux.ts", "i18n-ops.ts", "i18n-models.ts", "i18n-auth.ts", "i18n-features.ts", "speech/i18n.ts", "cxactions.ts"].map((f) => path.join(process.cwd(), "app", f));
/** Mọi mục khóa → [{ bản dịch, chỗ }] theo chiều (VI2EN / EN2VI theo tên bảng: VI2EN, UX_VI2EN, Object.assign(FX_EN2VI, {…})…). */
function dictEntries(list) {
  const seen = { VI2EN: new Map(), EN2VI: new Map() };
  for (const [f, src] of list) {
    const sf = parse(f, src);
    const take = (name, obj) => {
      const dir = /VI2EN/.test(name) ? "VI2EN" : /EN2VI/.test(name) ? "EN2VI" : null;
      if (!dir) return;
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.initializer)) continue;
        const k = ts.isStringLiteralLike(p.name) ? p.name.text : p.name.getText(sf);
        if (!seen[dir].has(k)) seen[dir].set(k, []);
        seen[dir].get(k).push([p.initializer.text, `${rel(f)}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1}`]);
      }
    };
    const v = (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) take(n.name.getText(sf), n.initializer);
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "Object.assign") for (const a of n.arguments.slice(1)) if (ts.isObjectLiteralExpression(a)) take(n.arguments[0].getText(sf), a);
      ts.forEachChild(n, v);
    };
    v(sf);
  }
  const clash = [];
  for (const dir of ["VI2EN", "EN2VI"]) for (const [k, l] of seen[dir]) if (new Set(l.map((x) => x[0])).size > 1) clash.push(`${dir} ${JSON.stringify(k)}: ${l.map(([t, a]) => `${JSON.stringify(t)} @${a}`).join(" | ")}`);
  return { seen, clash };
}
{
  const { seen, clash } = dictEntries(DICT_FILES.map((f) => [f, readFileSync(f, "utf8")]));
  ok(seen.VI2EN.size > 3000 && seen.EN2VI.size > 1000, `đọc được các bảng từ điển (${seen.VI2EN.size} khóa VI→EN, ${seen.EN2VI.size} khóa EN→VI)`);
  ok(!clash.length, `không khóa nào có hai bản dịch khác nhau (${clash.length})`, clash.slice(0, 30).join("\n     "));
  const fake = dictEntries([[path.join(process.cwd(), "app", "zz-a.ts"), `export const A_VI2EN = { "Thử": "Try" };\nObject.assign(A_VI2EN, { "Thử": "Retry", "Khác": "Other" });\nexport const B_EN2VI = { "Other": "Khác" };`]]);
  ok(fake.clash.length === 1 && fake.clash[0].startsWith('VI2EN "Thử"'), "phép kiểm bắt được khóa trùng qua Object.assign", fake.clash.join("; "));
}

console.log("5. Một thuật ngữ cho mỗi khái niệm");
const { "i18n-dict": D, "i18n-vi": V } = await loadTs(["i18n-dict", "i18n-vi"]);
{
  // Chữ tiếng Việt của giao diện: chữ trong app/ (bộ quét) và bản dịch EN→VI.
  const viText = [];
  for (const f of files) if (!/i18n(-\w+)?\.ts$|speech[\\/]i18n\.ts$/.test(f)) for (const s of extract(f)) if (VI.test(s.text)) viText.push([`${rel(f)}:${s.line}`, s.text.replace(/ ‹[^›]*›$/, "")]);
  for (const [k, v] of Object.entries(V.EN2VI)) viText.push([`EN2VI ${JSON.stringify(k).slice(0, 50)}`, v]);
  const rules = [
    ["“trình kết nối” (dùng “connector”)", (t) => /trình kết nối/i.test(t)],
    ["“kỹ năng” cho từng skill (dùng “skill”; “Kho kỹ năng” là tên kho)", (t) => /kỹ năng/i.test(t.replace(/Kho kỹ năng/g, ""))],
    // Nhãn "Kết nối" viết thẳng trong mã (bảng lệnh từng ghi thế); bản dịch của nút động từ "Connect" thì đúng là "Kết nối".
    ["nhãn “Kết nối” đứng riêng trong mã (mục là “Connectors”)", (t, at) => t.trim() === "Kết nối" && !at.startsWith("EN2VI")],
    ["“Giọng nói (ElevenLabs)” (mục là “Speech”)", (t) => /Giọng nói \(ElevenLabs\)/.test(t)],
  ];
  for (const [what, bad] of rules) { const hit = viText.filter(([at, t]) => bad(t, at)); ok(!hit.length, `không còn ${what}`, hit.slice(0, 15).map(([a, t]) => `${a}: ${t.slice(0, 90)}`).join("\n     ")); }
  // Phía tiếng Anh: "Kết nối" là động từ Connect (nút Kết nối không được thành "Connectors"), mục Speech không gọi là Voice.
  ok(D.VI2EN["Kết nối"] === "Connect", "VI2EN “Kết nối” là “Connect”", D.VI2EN["Kết nối"]);
  const voice = files.filter((f) => /Voice \(ElevenLabs\)/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")) && !/i18n/.test(f)).map(rel);
  ok(!voice.length, "chữ tiếng Anh gốc gọi ElevenLabs là “Speech (ElevenLabs)”", voice.join(", "));
  // Tên mục trên thanh bên, tiêu đề trang, bảng lệnh: Connectors, Speech, Kho kỹ năng / Skill.
  const home = readFileSync(path.join(process.cwd(), "app", "home.tsx"), "utf8");
  ok(/id: "connectors", label: "Connectors"/.test(home) && /customize: "Kho kỹ năng"/.test(home) && /speech: "Speech"/.test(home) && /label: "Speech"/.test(home) && !/label: "(Kỹ năng|Kết nối|Giọng nói)"/.test(home),
    "thanh bên, tiêu đề trang và bảng lệnh: Connectors, Speech, Kho kỹ năng (nhãn ngắn Skill)");
  ok(D.VI2EN["Skill ‹tên mục›"] === "Skills" && D.VI2EN["Kho kỹ năng"] === "Skill Hub", "Skill → Skills, Kho kỹ năng → Skill Hub ở giao diện tiếng Anh");
  // "Hội thoại" là Dialogue (công cụ của Speech); lịch sử đoạn chat trong ngữ cảnh model là "Lịch sử hội thoại".
  const src = (f) => readFileSync(path.join(process.cwd(), "app", f), "utf8");
  ok(D.VI2EN["Hội thoại"] === "Dialogue" && D.VI2EN["Lịch sử hội thoại"] === "Conversation" && /history: "Lịch sử hội thoại"/.test(src("mixer.tsx")) && /k: "Lịch sử hội thoại"/.test(src("codeview.tsx")),
    "“Hội thoại” (Dialogue) chỉ còn ở Speech; ngữ cảnh model ghi “Lịch sử hội thoại” (Conversation)");
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
