// B5 bước 10 (ngân sách CSS tải đầu): chuyển luật của một tệp CSS tải đầu (mặc định globals.css) sang tệp CSS của màn tải chậm khi luật
// đó chỉ có thể trúng phần tử của màn ấy. Một selector "neo" vào màn tải chậm S khi có một lớp (ngoài :not / :is / :where / :has) chỉ được
// nhắc tới trong các tệp tsx thuộc S (tới được từ lối vào của S, ngoài phần tải đầu của trang chính); mọi selector của luật phải neo vào
// cùng một S. Màn S chưa hiện thì phần tử đó chưa có, khi hiện thì tệp CSS của S đã nạp xong (webpack tải CSS của chunk trước khi chạy).
// Luật chuyển giữ nguyên lớp (syn / syn-over) và @media, đặt ở ĐẦU khối lớp tương ứng của tệp đích (trước luật riêng của tệp đó, như khi
// còn ở globals.css). Thứ tự so với luật chung đứng sau nó thì đổi: chạy tools/css-cascade.mjs (dev và prod) để tìm cặp đổi bên thắng
// và ghi luật liên quan vào KEEP (giữ lại ở tệp tải đầu), rồi chạy lại.
// Dùng: node tools/css-move.mjs [--write] [--from app/_shell/globals.css] [--keep tệp.json]   (in số byte chuyển được theo tệp đích)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SRC_ROOTS } from "../tests/lib/srcroots.mjs";
import { splitList } from "./css-cascade.mjs";

const postcss = createRequire(import.meta.url)("postcss");
// Màn tải chậm và lối vào của chúng (cùng danh sách với tests/api/css-split.test.mjs).
export const SHEETS = [
  { css: "ui/styles/speech.css", entries: ["ui/speech/view.tsx", "ui/voicemode.tsx"], prefix: /^(sp|vm)(-|$)/ },
  { css: "ui/styles/codeview.css", entries: ["ui/codeview.tsx", "ui/browserhub.tsx"], prefix: /^(cvg?|bp|ctxp|ext)(-|$)/ },
  { css: "ui/styles/brainview.css", entries: ["ui/brainui.tsx"], prefix: /^(bw|bn)(-|$)/ },
  { css: "ui/styles/download.css", entries: ["ui/download/view.tsx"], prefix: /^dl(-|$)/ },
  { css: "ui/styles/projects.css", entries: ["ui/projects.tsx"], prefix: /^pj-(?!(row|tg|ic|kids)$)/ },
  { css: "ui/styles/settings.css", entries: ["ui/settings.tsx", "ui/adminui.tsx", "ui/healthui.tsx", "ui/backupui.tsx", "ui/botadmin.tsx", "ui/usageui.tsx", "ui/latencyui.tsx", "ui/cliupdateui.tsx", "ui/modelregui.tsx", "ui/providersui.tsx", "ui/connectorsui.tsx"],
    prefix: /^(perm-|cap-(?!ext$)|adm-(?!(pager|pg|pg-n|pg-b)$)|pv-(?!open$)|cn-(?!(logo|mono|link)$)|us-(?!(note|wrap|ring|ring-n|pop|h|row|row-t|bar|empty|more|v|v-h|tag|money|ctx|sub)$))/ },
  { css: "ui/styles/skills.css", entries: ["ui/pluginsui.tsx", "ui/skillsui.tsx", "ui/skillscanui.tsx", "ui/claudedirui.tsx", "ui/studio.tsx", "ui/appsui.tsx", "ui/tasksui.tsx"], prefix: /^pl-/ },
];
// Mốc @media trong danh sách của tools/css-metrics.mjs: luật nằm trong @media ngoài danh sách thì không chuyển (chuyển sẽ tách khối, tăng mediaWidth).
const WIDTHS = new Set([480, 640, 760, 761, 860, 1100]);

/** Đồ thị import tĩnh của app/ (bỏ import type, bỏ import() động: đó là ranh giới tải chậm). */
export function graph(root = ".") {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "api" ? [] : walk(path.join(d, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const src = Object.fromEntries(SRC_ROOTS.filter((r) => fs.existsSync(path.join(root, r))).flatMap((r) => walk(path.join(root, r))).map((f) => [path.relative(root, f), fs.readFileSync(f, "utf8")]));
  const resolve = (from, spec) => { if (!spec.startsWith(".")) return null; const b = path.join(path.dirname(from), spec); return [`${b}.tsx`, `${b}.ts`, `${b}/index.tsx`, `${b}/index.ts`].find((x) => src[x] !== undefined) ?? null; };
  const imports = (f) => [...src[f].replace(/^import type .*$/gm, "").matchAll(/^(?:import|export)\s[^;'"]*?from\s+["']([^"']+)["']/gm)].map((m) => resolve(f, m[1])).filter(Boolean);
  const reach = (roots) => { const out = new Set(roots), q = [...roots]; while (q.length) for (const n of imports(q.pop())) if (!out.has(n)) { out.add(n); q.push(n); } return out; };
  const first = reach(["app/page.tsx", "app/layout.tsx"]);
  // Tiền tố lớp ghép động ở phần tải đầu (`cv-${x}`): mọi lớp bắt đầu bằng tiền tố đó coi như có thể dùng ở phần tải đầu.
  const dyn = new Set(); for (const f of first) for (const m of src[f].matchAll(/([\w-]+-)\$\{/g)) dyn.add(m[1]);
  const cache = new Map();
  const usedIn = (c) => {
    if (!cache.has(c)) { const re = new RegExp(`["'\`\\s]${c.replace(/[-\\]/g, "\\$&")}["'\`\\s$]`); cache.set(c, Object.keys(src).filter((f) => re.test(src[f]))); }
    return cache.get(c);
  };
  // Đồ thị đầy đủ (tĩnh + import() động) từ mọi trang của app: tệp "riêng" của màn S là tệp chỉ tới được khi đi qua lối vào của S.
  // (Một tệp vừa trong S vừa được trang chat import() thẳng — như artifactui.tsx — không riêng: nó hiện được khi CSS của S chưa nạp.)
  const dynImports = (f) => [...src[f].matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => resolve(f, m[1])).filter(Boolean);
  const roots = Object.keys(src).filter((f) => /(^|\/)(page|layout|error|not-found|global-error|template|default)\.tsx$/.test(f));
  const closure = (from, blocked = new Set()) => { const out = new Set(), q = from.filter((f) => !blocked.has(f)); while (q.length) { const f = q.pop(); if (out.has(f)) continue; out.add(f); for (const n of [...imports(f), ...dynImports(f)]) if (!out.has(n) && !blocked.has(n)) q.push(n); } return out; };
  const exclusive = (entries) => { const without = closure(roots, new Set(entries)); return new Set([...closure(entries)].filter((f) => !without.has(f))); };
  return { src, reach, first, dyn, usedIn, exclusive };
}

/** Bỏ phần trong :not() / :is() / :where() / :has(): lớp ở đó không chắc chắn có mặt trên phần tử. */
const strip = (sel) => { let out = "", i = 0; while (i < sel.length) { const m = /^:(not|is|where|has|matches|-webkit-any)\(/.exec(sel.slice(i)); if (m) { let d = 0, j = i + m[0].length - 1; for (; j < sel.length; j++) { if (sel[j] === "(") d++; else if (sel[j] === ")" && !--d) break; } out += " "; i = j + 1; } else out += sel[i++]; } return out; };

/** Màn tải chậm mà selector neo vào (null nếu không neo được). */
export function anchor(sel, G, sheets) {
  const cls = [...strip(sel).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  const out = [];
  for (const c of cls) {
    const u = G.usedIn(c);
    if (!u.length || u.some((f) => G.first.has(f)) || [...G.dyn].some((p) => c.startsWith(p))) continue;
    for (const s of sheets) if (u.every((f) => s.only.has(f))) out.push(s.css);
  }
  return out;
}

const condKey = (n) => { const k = []; for (let p = n.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule") k.unshift(`@${p.name} ${p.params}`); return k; };
export const ruleKey = (r) => `${condKey(r).join(" ")} ${r.selector.replace(/\s+/g, " ")} {${r.nodes.filter((n) => n.type === "decl").map((d) => `${d.prop}:${d.value}`).join(";")}}`;

export function move(root = ".", { from = "app/_shell/globals.css", keep = [], write = false } = {}) {
  const G = graph(root);
  const sheets = SHEETS.map((s) => ({ ...s, owners: G.reach(s.entries), only: G.exclusive(s.entries) }));
  const keepSet = new Set(keep);
  const srcRoot = postcss.parse(fs.readFileSync(path.join(root, from), "utf8"), { from });
  const moved = new Map(); // sheet → [{ layer, conds, nodes }]
  const bytes = {};
  srcRoot.walkRules((r) => {
    let layer = null; for (let p = r.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule" && p.name === "layer") layer = p.params.trim();
    if (!layer || !["syn", "syn-over"].includes(layer)) return;
    for (let p = r.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule" && !["layer", "media", "supports"].includes(p.name)) return;
    if (r.parent.type === "rule") return;
    if (keepSet.has(ruleKey(r))) return;
    if (condKey(r).some((c) => c.startsWith("@media") && [...c.matchAll(/([\d.]+)px/g)].some((m) => !WIDTHS.has(+m[1])))) return;
    const per = splitList(r.selector).map((s) => anchor(s, G, sheets));
    const common = per.reduce((a, b) => a.filter((x) => b.includes(x)));
    if (!per.every((x) => x.length) || !common.length) return;
    // Màn có nhiều tệp đích phù hợp (lối vào lồng nhau): chọn tệp đầu theo SHEETS.
    const dest = sheets.find((s) => common.includes(s.css)).css;
    // tests/api/css-split.test.mjs: lớp mang tiền tố của tệp đích phải chỉ dùng trong màn đó (không ở phần tải đầu, không ở màn khác).
    const S = sheets.find((s) => s.css === dest);
    const cls = [...r.selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((c) => S.prefix.test(c));
    if (cls.some((c) => G.usedIn(c).some((f) => G.first.has(f) || !S.owners.has(f)))) return;
    const conds = condKey(r).filter((c) => !c.startsWith("@layer"));
    const prev = r.prev();
    const nodes = [r.clone()];
    if (prev?.type === "comment" && !(prev.prev()?.type === "comment")) { nodes.unshift(prev.clone()); prev.remove(); }
    (moved.get(dest) ?? moved.set(dest, []).get(dest)).push({ layer, conds, nodes, key: ruleKey(r), sel: r.selector });
    bytes[dest] = (bytes[dest] ?? 0) + r.toString().length;
    let p = r.parent; r.remove();
    while (p && p.type === "atrule" && p.name !== "layer" && !(p.nodes ?? []).some((n) => n.type !== "comment")) { const q = p.parent; p.remove(); p = q; }
  });
  if (write) {
    fs.writeFileSync(path.join(root, from), srcRoot.toString());
    for (const [dest, list] of moved) {
      const d = postcss.parse(fs.readFileSync(path.join(root, dest), "utf8"), { from: dest });
      for (const layer of ["syn", "syn-over"]) {
        const items = list.filter((x) => x.layer === layer);
        if (!items.length) continue;
        let block = d.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params.trim() === layer && n.nodes);
        if (!block) { block = postcss.atRule({ name: "layer", params: layer, nodes: [] }); d.append(block); }
        // Gom luật liền nhau cùng @media vào một khối @media.
        const out = [postcss.comment({ text: `Chuyển từ ${path.basename(from)} (B5 bước 10, tools/css-move.mjs): luật chỉ trúng phần tử của màn này, giữ thứ tự cũ (đứng trước luật riêng của tệp).` })];
        let cur = null, curKey = null;
        for (const it of items) {
          const k = it.conds.join(" ");
          if (!k) { cur = null; curKey = null; for (const n of it.nodes) out.push(n); continue; }
          if (k !== curKey) {
            // Khối @media lồng: dựng từ ngoài vào trong.
            let outer = null, inner = null;
            for (const c of it.conds) { const [, name, params] = /^@(\S+) (.*)$/.exec(c); const a = postcss.atRule({ name, params, nodes: [] }); if (inner) inner.append(a); else outer = a; inner = a; }
            out.push(outer); cur = inner; curKey = k;
          }
          for (const n of it.nodes) cur.append(n);
        }
        out.push(postcss.comment({ text: `Hết phần chuyển từ ${path.basename(from)}.` }));
        block.prepend(...out);
      }
      fs.writeFileSync(path.join(root, dest), d.toString());
    }
  }
  return { bytes, moved: [...moved.values()].flat().map((x) => ({ key: x.key, sel: x.sel, dest: [...moved].find(([, l]) => l.includes(x))[0] })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv; const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const keepFile = opt("--keep", null);
  const keep = keepFile && fs.existsSync(keepFile) ? JSON.parse(fs.readFileSync(keepFile, "utf8")) : [];
  const r = move(".", { from: opt("--from", "app/_shell/globals.css"), keep, write: a.includes("--write") });
  for (const [k, v] of Object.entries(r.bytes)) console.log(`${k}: ${v} byte`);
  console.log(`${a.includes("--write") ? "đã chuyển" : "sẽ chuyển"} ${r.moved.length} luật, ${Object.values(r.bytes).reduce((x, y) => x + y, 0)} byte`);
}
