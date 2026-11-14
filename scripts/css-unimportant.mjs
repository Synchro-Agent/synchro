// B5 bước 4: chuyển khai báo !important "chỉ để thắng thứ tự" của một tệp CSS sang lớp cascade syn-over (lớp sau syn), bỏ chữ !important.
// Vì sao tương đương: trong lớp syn, khai báo !important thắng mọi khai báo thường của syn (và của các lớp Tailwind đứng trước), còn giữa
// các khai báo !important với nhau thì theo specificity rồi thứ tự nạp. Ở syn-over, khai báo thường thắng mọi khai báo thường của syn và của
// Tailwind (lớp sau thắng lớp trước, bất kể specificity), còn giữa chúng với nhau vẫn theo specificity rồi thứ tự nạp: khối syn-over đặt
// cuối mỗi tệp, giữ nguyên thứ tự các luật, nên thứ tự giữa các tệp cũng giữ nguyên. Khác biệt duy nhất: khai báo thường ở syn-over thua
// style nội dòng, CSS không lớp, khai báo !important còn lại và hoạt ảnh (@keyframes, Web Animations), nên khai báo nào đang phải thắng
// những thứ đó thì giữ !important (KEEP bên dưới, kèm lý do). scripts/css-cascade.mjs chứng minh phần còn lại không đổi bên thắng.
// Dùng: node scripts/css-unimportant.mjs app/projects.css [--dry]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const postcss = createRequire(import.meta.url)("postcss");
export const LAYER = "syn-over";

// Khai báo !important cần giữ: [tệp, selector (đã gộp khoảng trắng, so khớp nguyên văn), thuộc tính, lý do]. Chỉ giữ chỗ đang phải thắng
// style nội dòng đặt trong tsx (khai báo thường ở bất kỳ lớp nào cũng thua style nội dòng).
export const KEEP = [
  ["app/globals.css", ".dock[data-tight] .composer textarea", "flex", "đè style={{ flex: 1 }} nội dòng của ô soạn tin (home.tsx, Composer)"],
  ["app/codeview.css", ".cv-side", "width", "đè độ rộng nội dòng của cột bên Code (codeview.tsx, style={{ width: dragW ?? paneW }})"],
  ["app/codeview.css", ".cv-body.pane-max>.cv-side", "width", "đè độ rộng nội dòng của cột bên Code (codeview.tsx, style={{ width: dragW ?? paneW }})"],
  ["app/synchro-ds.css", "html body .modal.sm h2", "font-size", "đè fontSize nội dòng của tiêu đề hộp thoại nhỏ (modals, settings, adminui, mfaui, passkeyui, stepup, speech/voices)"],
  ["app/synchro-ds.css", "html body .modal.sm h2", "margin", "đè margin nội dòng của tiêu đề hộp thoại nhỏ (modals.tsx Confirm)"],
  ["app/synchro-ds.css", "html body .sk-mh .icon-btn", "width", "đè width nội dòng 22–24px của nút trong đầu hộp thoại skill (saveskill.tsx, skillsui.tsx)"],
  ["app/synchro-ds.css", "html body .sk-mh .icon-btn", "height", "đè height nội dòng 22–24px của nút trong đầu hộp thoại skill (saveskill.tsx, skillsui.tsx)"],
];

const norm = (s) => s.replace(/\s+/g, " ").trim();
export function keepReason(file, decl) {
  const sel = norm(decl.parent?.selector ?? "");
  for (const [f, s, prop, why] of KEEP) if (file.endsWith(f) && sel === s && prop === decl.prop) return why;
  return null;
}

/** Trả về CSS mới và danh sách khai báo đã chuyển / giữ. */
export function transform(css, file) {
  const root = postcss.parse(css, { from: file });
  const wrap = root.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params.trim() === "syn" && n.nodes);
  if (!wrap) throw new Error(`${file}: không thấy khối @layer syn { … }`);
  const moved = [], kept = [];
  const byRule = new Map();
  wrap.walkDecls((d) => {
    if (!d.important) return;
    for (let p = d.parent; p && p !== wrap; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return;
    const why = keepReason(file, d);
    if (why) { kept.push({ line: d.source.start.line, sel: norm(d.parent.selector ?? ""), prop: d.prop, value: d.value, why }); return; }
    (byRule.get(d.parent) ?? byRule.set(d.parent, []).get(d.parent)).push(d);
  });
  if (!byRule.size) return { css, moved, kept };
  // Khối syn-over: cùng thứ tự luật, cùng chuỗi @media / @supports bao quanh; các luật liền nhau cùng chuỗi bao gộp chung một khối.
  const over = postcss.atRule({ name: "layer", params: LAYER, raws: { afterName: " ", between: "", after: "\n" } });
  let last = null;
  for (const [rule, ds] of byRule) {
    const chain = [];
    for (let p = rule.parent; p && p !== wrap; p = p.parent) chain.unshift(p);
    const key = chain.map((a) => `@${a.name} ${norm(a.params)}`).join(" ");
    const nr = postcss.rule({ selector: rule.selector, raws: { before: "\n", between: "", semicolon: false, after: "" } });
    for (const d of ds) {
      nr.append(postcss.decl({ prop: d.prop, value: d.value, raws: { before: "", between: ":" } }));
      moved.push({ line: d.source.start.line, sel: norm(rule.selector), prop: d.prop, value: d.value });
    }
    if (last && last.key === key && last.box) last.box.append(nr);
    else if (!chain.length) { over.append(nr); last = { key, box: null }; }
    else {
      let outer = null, inner = null;
      for (const a of chain) {
        const c = postcss.atRule({ name: a.name, params: a.params, raws: { before: "\n", afterName: " ", between: "", after: "\n" } });
        if (inner) inner.append(c); else outer = c;
        inner = c;
      }
      inner.append(nr); over.append(outer); last = { key, box: inner };
    }
    for (const d of ds) d.remove();
    // Luật / khối @media rỗng hẳn sau khi chuyển thì bỏ (còn chú thích bên trong thì giữ).
    for (let p = rule; p && p !== wrap && !p.nodes.length; ) { const up = p.parent; p.remove(); p = up; }
  }
  over.prepend(postcss.comment({ text: `B5: khai báo trước đây mang !important chỉ để thắng thứ tự. Lớp ${LAYER} đứng sau syn nên các luật này thắng mọi luật thường của syn bất kể specificity; giữa chúng với nhau vẫn theo specificity rồi thứ tự. Sửa một luật ở trên thì tìm cùng selector ở đây.`, raws: { before: "\n", left: " ", right: " " } }));
  root.append(over);
  root.raws.after = "\n";
  return { css: root.toString(), moved, kept };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const file = process.argv[2];
  const r = transform(fs.readFileSync(file, "utf8"), file);
  if (!process.argv.includes("--dry")) fs.writeFileSync(file, r.css);
  console.log(`${file}: chuyển ${r.moved.length}, giữ ${r.kept.length}`);
  for (const k of r.kept) console.log(`  giữ :${k.line} ${k.sel} { ${k.prop} } — ${k.why}`);
}
