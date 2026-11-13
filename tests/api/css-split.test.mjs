// CSS tách theo màn hình tải chậm: lớp trong tệp riêng không được dùng ở phần tải đầu (không thì mất kiểu ở trang chat), và mọi lối vào màn hình đều nạp tệp đó.
// Hàm thuần, chỉ đọc mã nguồn. Vì sao chỉ tách một phần: xem chú thích ở app/layout.tsx.
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "api" ? [] : walk(path.join(d, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const src = Object.fromEntries(walk("app").map((f) => [f, fs.readFileSync(f, "utf8")]));
const resolve = (from, spec) => { if (!spec.startsWith(".")) return null; const b = path.join(path.dirname(from), spec); return [`${b}.tsx`, `${b}.ts`].find((x) => src[x] !== undefined) ?? null; };
const imports = (f) => [...src[f].replace(/^import type .*$/gm, "").matchAll(/^(?:import|export)\s[^;'"]*?from\s+["']([^"']+)["']/gm)].map((m) => resolve(f, m[1])).filter(Boolean);
const reach = (roots) => { const out = new Set(roots), q = [...roots]; while (q.length) for (const n of imports(q.pop())) if (!out.has(n)) { out.add(n); q.push(n); } return out; };
const first = reach(["app/page.tsx", "app/layout.tsx"]);

const SHEETS = [
  { css: "app/speech/speech.css", entries: ["app/speech/view.tsx", "app/voicemode.tsx"], prefix: /^(sp|vm)(-|$)/ },
  { css: "app/codeview.css", entries: ["app/codeview.tsx", "app/browserhub.tsx"], prefix: /^(cvg?|bp|ctxp|ext)(-|$)/ },
  { css: "app/brainview.css", entries: ["app/brainui.tsx"], prefix: /^(bw|bn)(-|$)/ },
  { css: "app/download/download.css", entries: ["app/download/view.tsx"], prefix: /^dl(-|$)/ },
  // B3.4: Dự án, Cài đặt (Quản trị, Providers, Khả năng, Connectors, trang Mức dùng), Kho kỹ năng. Lớp cùng tiền tố mà trang chat vẫn dùng
  // (hàng dự án ở thanh bên, vòng Mức dùng, bộ chia trang, liên kết connector ở menu +) không thuộc tệp tách, vẫn ở tệp chung.
  { css: "app/projects.css", entries: ["app/projects.tsx"], prefix: /^pj-(?!(row|tg|ic|kids)$)/ },
  { css: "app/settings.css", entries: ["app/settings.tsx", "app/adminui.tsx", "app/healthui.tsx", "app/backupui.tsx", "app/botadmin.tsx", "app/usageui.tsx", "app/latencyui.tsx", "app/cliupdateui.tsx", "app/modelregui.tsx", "app/providersui.tsx", "app/connectorsui.tsx"],
    prefix: /^(perm-|cap-(?!ext$)|adm-(?!(pager|pg|pg-n|pg-b)$)|pv-(?!open$)|cn-(?!(logo|mono|link)$)|us-(?!(note|wrap|ring|ring-n|pop|h|row|row-t|bar|empty|more|v|v-h|tag|money|ctx|sub)$))/ },
  { css: "app/skills.css", entries: ["app/pluginsui.tsx", "app/skillsui.tsx", "app/skillscanui.tsx", "app/claudedirui.tsx", "app/studio.tsx", "app/appsui.tsx", "app/tasksui.tsx"], prefix: /^pl-/ },
];
const classes = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}").matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
// Lớp xuất hiện như một chữ riêng trong chuỗi của tệp (kể cả chuỗi ghép `sp-${x}`).
const mentions = (f, c) => new RegExp(`["'\`\\s]${c.replace(/-/g, "\\-")}["'\`\\s$]`).test(src[f]);

for (const s of SHEETS) {
  const css = fs.readFileSync(s.css, "utf8"), cl = classes(css);
  ok(cl.size > 20, `${s.css}: có nội dung`, cl.size);
  for (const e of s.entries) ok(new RegExp(`^import "[^"]*${path.basename(s.css).replace(".", "\\.")}";$`, "m").test(src[e]), `${e} nạp ${path.basename(s.css)}`);
  ok(!s.entries.some((e) => first.has(e)), `${s.css}: lối vào không nằm trong phần tải đầu`, s.entries.filter((e) => first.has(e)));
  const own = [...cl].filter((c) => s.prefix.test(c));
  const leak = own.filter((c) => [...first].some((f) => mentions(f, c)));
  ok(!leak.length, `${s.css}: lớp riêng không được dùng ở phần tải đầu`, leak.slice(0, 20));
  // Tệp tải chậm khác (Cài đặt, Dự án…) dùng lớp này mà không qua lối vào thì sẽ không có kiểu.
  const owners = reach(s.entries);
  const stray = own.flatMap((c) => Object.keys(src).filter((f) => !owners.has(f) && mentions(f, c)).map((f) => `${c} @ ${f}`));
  ok(!stray.length, `${s.css}: lớp riêng chỉ dùng trong chính màn hình đó`, stray.slice(0, 20));
}
console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
