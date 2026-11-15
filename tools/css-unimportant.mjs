// B5 bước 4: chuyển khai báo !important "chỉ để thắng thứ tự" của một tệp CSS sang lớp cascade syn-over (lớp sau syn), bỏ chữ !important.
// Vì sao tương đương: trong lớp syn, khai báo !important thắng mọi khai báo thường của syn (và của các lớp Tailwind đứng trước), còn giữa
// các khai báo !important với nhau thì theo specificity rồi thứ tự nạp. Ở syn-over, khai báo thường thắng mọi khai báo thường của syn và của
// Tailwind (lớp sau thắng lớp trước, bất kể specificity), còn giữa chúng với nhau vẫn theo specificity rồi thứ tự nạp: khối syn-over đặt
// cuối mỗi tệp, giữ nguyên thứ tự các luật, nên thứ tự giữa các tệp cũng giữ nguyên. Khác biệt duy nhất: khai báo thường ở syn-over thua
// style nội dòng, CSS không lớp, khai báo !important còn lại và hoạt ảnh (@keyframes, Web Animations), nên khai báo nào đang phải thắng
// những thứ đó thì giữ !important (KEEP bên dưới, kèm lý do). tools/css-cascade.mjs chứng minh phần còn lại không đổi bên thắng.
// Khai báo nào bỏ chữ !important tại chỗ (vẫn ở syn) mà không đổi bên thắng thì không cần chuyển (opt.plain). Bản chép sang syn-over bỏ
// được tiền tố html body khi tiền tố đó không quyết định bên thắng giữa các luật syn-over (opt.strip, opt.keepPrefix). Hai danh sách này
// tìm bằng cách lặp với tools/css-cascade.mjs: bỏ hết, khai báo / selector nào gây đổi bên thắng thì trả lại, tới khi 0 cặp đổi.
// Dùng: node tools/css-unimportant.mjs ui/styles/projects.css [--opts tệp.json] [--strip] [--dry]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { splitList } from "./css-cascade.mjs";

const postcss = createRequire(import.meta.url)("postcss");
export const LAYER = "syn-over";

// Khai báo !important cần giữ: [tệp, selector (đã gộp khoảng trắng, so khớp nguyên văn), thuộc tính, lý do]. Chỉ giữ chỗ đang phải thắng
// style nội dòng đặt trong tsx (khai báo thường ở bất kỳ lớp nào cũng thua style nội dòng).
export const KEEP = [
  ["app/_shell/globals.css", ".dock[data-tight] .composer textarea", "flex", "đè style={{ flex: 1 }} nội dòng của ô soạn tin (home.tsx, Composer)"],
  ["ui/styles/codeview.css", ".cv-side", "width", "đè độ rộng nội dòng của cột bên Code (codeview.tsx, style={{ width: dragW ?? paneW }})"],
  ["ui/styles/codeview.css", ".cv-body.pane-max>.cv-side", "width", "đè độ rộng nội dòng của cột bên Code (codeview.tsx, style={{ width: dragW ?? paneW }})"],
  ["app/_shell/synchro-ds.css", "html body .modal.sm h2", "font-size", "đè fontSize nội dòng của tiêu đề hộp thoại nhỏ (modals, settings, adminui, mfaui, passkeyui, stepup, speech/voices)"],
  ["app/_shell/synchro-ds.css", "html body .modal.sm h2", "margin", "đè margin nội dòng của tiêu đề hộp thoại nhỏ (modals.tsx Confirm)"],
  ["app/_shell/synchro-ds.css", "html body .sk-mh .icon-btn", "width", "đè width nội dòng 22–24px của nút trong đầu hộp thoại skill (saveskill.tsx, skillsui.tsx)"],
  ["app/_shell/synchro-ds.css", "html body .sk-mh .icon-btn", "height", "đè height nội dòng 22–24px của nút trong đầu hộp thoại skill (saveskill.tsx, skillsui.tsx)"],
  // Nền tấm của thẻ trong Cài đặt đang thắng hoạt ảnh nháy sHit (features.css, .adm-card.s-hit khi tìm kiếm trong Cài đặt nhảy tới): hoạt ảnh
  // CSS thắng khai báo thường ở mọi lớp nhưng thua !important, nên bỏ !important thì thẻ .adm-card bắt đầu nháy nền.
  ["ui/styles/settings.css", "html body .sy-settings :is(.api-card:not(.bare),.us-card,.inset,.promo,.dcard,.adm-stat,.adm-card,.cn-row,.cn-card,.us-vc,.pl-hero)", "background", "thắng hoạt ảnh sHit (nháy nền khi tìm kiếm) trên .adm-card"],
  ["app/_shell/synchro-ds.css", "html body :is(.group,.pl-seg):not(.auth-root *)>button.on", "background", "thắng nền tấm thẻ Cài đặt (giữ ở trên) theo specificity"],
  ["app/_shell/synchro-ds.css", "html body .shell-side .side-tools .nav-item.active", "background", "thắng nền nút đang chọn của .group (giữ ở trên) theo specificity"],
  // Bốn khai báo dưới đây không đè style nội dòng, nhưng đang thắng một khai báo giữ !important ở trên (cùng thuộc tính, phần tử mà công cụ
  // so tĩnh không loại được là trúng cả hai); bỏ !important thì đổi bên thắng. Gỡ được cùng lúc với khai báo kia khi bỏ style nội dòng.
  ["app/_shell/synchro-ds.css", "html body :is(.group,.pl-seg):not(.auth-root *)>button", "height", "thắng .sk-mh .icon-btn { height !important } theo specificity"],
  ["ui/styles/projects.css", "html body .modal.pj-modal h2", "font", "thắng .modal.sm h2 { font-size !important } theo thứ tự nạp"],
  ["ui/styles/skills.css", "html body .modal.pl-modal h2", "font-size", "thắng .modal.sm h2 { font-size !important } theo thứ tự nạp"],
  ["ui/styles/skills.css", "html body .modal.pl-modal h2", "font-weight", "thắng .modal.pj-modal h2 { font !important } (giữ ở trên) theo thứ tự nạp"],
  // Bốn khai báo dưới đây trả lại !important sau vòng rà B5: chúng đè style nội dòng mà lần soát tay bỏ sót vì style đi qua prop
  // (Menu style={…}) hoặc chỉ đè ở một khoảng rộng; tools/css-inline.mjs giờ bắt loại này. Ba khai báo nằm ngay trong khối syn-over (nơi
  // codemod đã chuyển tới); bottom của menu + về lại luật syn gốc vì nó phải thua .codebox.cb-copy .cb-btn { bottom !important } theo
  // specificity như trước (!important ở syn-over thua mọi !important ở syn).
  ["ui/styles/projects.css", "html body .pj-compose .plus-menu", "bottom", "đè bottom: 40 nội dòng của menu + (home.tsx, Menu style) trong ô soạn tin dự án"],
  ["ui/styles/projects.css", ".pj-compose .model-sub:not(.msub-models)", "bottom", "đè bottom: 0 nội dòng của menu con Mức độ nỗ lực (home.tsx, Menu style)"],
  ["app/_shell/synchro-ds.css", ".pj-compose :is(.model-menu,.mic-wrap .menu)", "bottom", "đè bottom: calc(100% + 8px) nội dòng của menu micro (home.tsx, Menu style)"],
  ["app/_shell/synchro-ds.css", ".sy-settings .s-body .row>:is(.group,.pl-seg)>button", "padding", "≤860px: đè padding: 0 9px nội dòng của nút chủ đề (settings.tsx General)"],
];

const norm = (s) => s.replace(/\s+/g, " ").trim();
export function keepReason(file, decl) {
  const sel = norm(decl.parent?.selector ?? "");
  for (const [f, s, prop, why] of KEEP) if (file.endsWith(f) && sel === s && prop === decl.prop) return why;
  return null;
}

// Bỏ tiền tố chỉ để tăng specificity (B5 bước 3) ở bản chép sang syn-over: html body X → X, html[…] body X → html[…] X.
export const stripPrefix = (sel) => sel.replace(/(^|[\s(,])html body /g, "$1").replace(/(^|[\s(,])(html\[[^\]]*\]) body /g, "$1$2 ");
/** Bỏ tiền tố ở từng selector của danh sách (mỗi selector có specificity riêng), trừ selector có trong keep. */
export const stripItems = (sel, keep = new Set()) => splitList(sel).map((x) => (keep.has(norm(x)) ? x : stripPrefix(x))).join(",");
export const keyOf = (file, sel, prop) => `${file.replace(/^.*?app\//, "")}|${norm(sel)}|${prop}`;

/** Trả về CSS mới và danh sách khai báo đã chuyển / giữ / bỏ chữ !important tại chỗ.
 * opt.plain: khóa (keyOf) của khai báo chỉ cần bỏ chữ !important tại chỗ (đã chứng minh không đổi bên thắng), không chuyển lớp.
 * opt.strip: bỏ tiền tố html body ở bản chép sang syn-over, trừ selector (từng mục của danh sách) có trong opt.keepPrefix (bỏ thì đổi bên thắng). */
export function transform(css, file, opt = {}) {
  const plain = opt.plain ?? new Set(), keepPrefix = opt.keepPrefix ?? new Set();
  const root = postcss.parse(css, { from: file });
  const wrap = root.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params.trim() === "syn" && n.nodes);
  if (!wrap) throw new Error(`${file}: không thấy khối @layer syn { … }`);
  const moved = [], kept = [], dropped = [];
  const byRule = new Map();
  wrap.walkDecls((d) => {
    if (!d.important) return;
    for (let p = d.parent; p && p !== wrap; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return;
    const why = keepReason(file, d);
    if (why) { kept.push({ line: d.source.start.line, sel: norm(d.parent.selector ?? ""), prop: d.prop, value: d.value, why }); return; }
    if (plain.has(keyOf(file, d.parent.selector, d.prop))) { d.important = false; delete d.raws.important; dropped.push({ line: d.source.start.line, sel: norm(d.parent.selector), prop: d.prop }); return; }
    (byRule.get(d.parent) ?? byRule.set(d.parent, []).get(d.parent)).push(d);
  });
  if (!byRule.size) return { css: dropped.length ? root.toString() : css, moved, kept, dropped };
  // Khối syn-over: cùng thứ tự luật, cùng chuỗi @media / @supports bao quanh; các luật liền nhau cùng chuỗi bao gộp chung một khối.
  const over = postcss.atRule({ name: "layer", params: LAYER, raws: { afterName: " ", between: "", after: "\n" } });
  let last = null;
  for (const [rule, ds] of byRule) {
    const chain = [];
    for (let p = rule.parent; p && p !== wrap; p = p.parent) chain.unshift(p);
    const key = chain.map((a) => `@${a.name} ${norm(a.params)}`).join(" ");
    const sel = opt.strip ? stripItems(rule.selector, keepPrefix) : rule.selector;
    const nr = postcss.rule({ selector: sel, raws: { before: "\n", between: "", semicolon: false, after: "" } });
    for (const d of ds) {
      nr.append(postcss.decl({ prop: d.prop, value: d.value, raws: { before: "", between: ":" } }));
      moved.push({ line: d.source.start.line, sel: norm(rule.selector), newSel: norm(sel), prop: d.prop, value: d.value });
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
  return { css: root.toString(), moved, kept, dropped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  // --opts tệp.json: { "plain": [khóa keyOf…], "keepPrefix": [selector…] }; --strip: bỏ tiền tố html body ở bản chép.
  const file = process.argv[2];
  const oi = process.argv.indexOf("--opts");
  const o = oi > 0 ? JSON.parse(fs.readFileSync(process.argv[oi + 1], "utf8")) : {};
  const r = transform(fs.readFileSync(file, "utf8"), file, { plain: new Set(o.plain ?? []), keepPrefix: new Set(o.keepPrefix ?? []), strip: process.argv.includes("--strip") });
  if (!process.argv.includes("--dry")) fs.writeFileSync(file, r.css);
  console.log(`${file}: bỏ !important tại chỗ ${r.dropped.length}, chuyển sang ${LAYER} ${r.moved.length}, giữ ${r.kept.length}`);
  for (const k of r.kept) console.log(`  giữ :${k.line} ${k.sel} { ${k.prop} } — ${k.why}`);
}
