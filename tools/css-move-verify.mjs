// B5 bước 10: vòng chuyển + kiểm cho tools/css-move.mjs. Chuyển luật, so cascade tĩnh (tools/css-cascade.mjs --raw-key, thứ tự dev và
// prod) với bản gốc, ghi mọi luật đã chuyển có selector dính một cặp đổi bên thắng vào tệp KEEP, khôi phục tệp CSS rồi chạy lại tới khi 0 cặp.
// Mặc định bảo thủ hoàn toàn (mọi cặp css-cascade coi là có thể trùng phần tử đều tính). APART=1: bỏ cặp mà hai bên chắc chắn khác phần tử
// theo các giả định ghi ở hàm apart (chưa dùng cho lần chuyển của B5).
// Dùng: node tools/css-move-verify.mjs <thư mục mã nguồn gốc (có app/ và node_modules)> <keep.json> [tệp nguồn, mặc định app/_shell/globals.css]
// Cần cây làm việc sạch ở các tệp CSS (lệnh này git checkout chúng mỗi vòng).
import fs from "node:fs"; import { execSync } from "node:child_process";
const W = process.cwd(); const T = (await import("node:os")).tmpdir();
const BASE = process.argv[2]; const KEEP = process.argv[3]; const FROM = process.argv[4] ?? "app/_shell/globals.css";
const files = ["app/_shell/globals.css", "app/_shell/synchro-ds.css", "app/_shell/glass.css", "app/_shell/features.css", "ui/styles/speech.css", "ui/styles/codeview.css", "ui/styles/brainview.css", "ui/styles/download.css", "ui/styles/projects.css", "ui/styles/settings.css", "ui/styles/skills.css"];
const M = await import(W + "/tools/css-move.mjs");
const { splitList } = await import(W + "/tools/css-cascade.mjs");
const C = await import(W + "/tools/css-cascade.mjs");
const A0 = C.collect(await C.loadSource(BASE, "dev")); const co = C.cooccurrence(BASE, A0.decls);
const G = M.graph(W); const sheets = M.SHEETS.map((s) => ({ ...s, owners: G.reach(s.entries) }));
const ownSrc = new Map(sheets.map((s) => [s.css, [...s.owners].map((f) => G.src[f]).join("\n")]));
const mentioned = (text, c) => new RegExp(`(^|[^\\w-])${c.replace(/[-\\]/g, "\\$&")}([^\\w-]|$)`).test(text);
const lazySheets = (c) => { const u = G.usedIn(c); if (!u.length || u.some((f) => G.first.has(f)) || [...G.dyn].some((p) => c.startsWith(p))) return []; return sheets.filter((s) => u.every((f) => s.owners.has(f))).map((s) => s.css); };
// Đồ thị import đầy đủ (tĩnh + import() động): tệp nào có thể vẽ ra tệp nào.
const resolveAny = (from, spec) => { if (!spec.startsWith(".")) return null; const b = (from.split("/").slice(0, -1).join("/") + "/" + spec).split("/").reduce((a, x) => (x === ".." ? a.slice(0, -1) : x === "." ? a : [...a, x]), []).join("/"); return [`${b}.tsx`, `${b}.ts`, `${b}/index.tsx`].find((x) => G.src[x] !== undefined) ?? null; };
const dynImports = (f) => [...G.src[f].matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => resolveAny(f, m[1])).filter(Boolean);
const statImports = (f) => [...G.reach([f])];
const closAll = (roots) => { const out = new Set(), q = [...roots]; while (q.length) { const f = q.pop(); if (out.has(f)) continue; out.add(f); for (const n of [...statImports(f), ...dynImports(f)]) if (!out.has(n)) q.push(n); } return out; };
const sheetClos = new Map(sheets.map((s) => [s.css, closAll(s.entries)]));
const mount = new Map(sheets.map((s) => [s.css, Object.keys(G.src).filter((f) => dynImports(f).some((x) => s.entries.includes(x)))]));
const ctxSrc = new Map(sheets.map((s) => [s.css, [...s.owners, ...mount.get(s.css)].map((f) => G.src[f]).join("\n")]));
const strip = (sel) => { let out = "", i = 0; while (i < sel.length) { const m = /^:(not|is|where|has|matches|-webkit-any)\(/.exec(sel.slice(i)); if (m) { let d = 0, j = i + m[0].length - 1; for (; j < sel.length; j++) { if (sel[j] === "(") d++; else if (sel[j] === ")" && !--d) break; } out += " "; i = j + 1; } else out += sel[i++]; } return out; };
const classesOf = (sel) => [...strip(sel).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
// Lớp b chỉ dùng ở màn tải chậm T không liên quan tới S: T không vẽ ra S, S không vẽ ra T (kể cả qua import() động).
const unrelated = (S, b) => { const u = G.usedIn(b); if (!u.length || u.some((f) => G.first.has(f)) || co.wild.has(b) || [...G.dyn].some((p) => b.startsWith(p))) return false;
  const cs = sheetClos.get(S); const ent = sheets.find((x) => x.css === S).entries;
  return u.every((f) => !cs.has(f) && !mount.get(S).includes(f) && !ent.some((e) => closAll([f]).has(e))); };
// Hai bên chắc chắn không cùng phần tử:
// (A) phần chủ của bên chuyển có lớp neo vào S, phần chủ bên kia có lớp không mở mà tệp nào của S (và tệp gắn S vào trang) cũng không nhắc;
// (B) bên kia cần một lớp (ở bất kỳ phần nào của selector) chỉ dùng ở màn tải chậm khác, không lồng được với S.
const apart = (mx, py) => {
  const anchors = classesOf(mx.sel).flatMap((a) => lazySheets(a));
  if (anchors.some((S) => classesOf(py.sel).some((b) => unrelated(S, b)))) return true;
  const X = C.subject(mx.sel).alts, Y = C.subject(py.sel).alts;
  return X.every((ax) => Y.every((ay) => ax.cls.some((a) => lazySheets(a).some((S) => ay.cls.some((b) => !co.wild.has(b) && !mentioned(ctxSrc.get(S), b))))));
};
const apartCache = new Map(); const apartC = (m, o) => { const k = m.sel + "\u0000" + o.sel; if (!apartCache.has(k)) apartCache.set(k, apart(m, o)); return apartCache.get(k); };
let dropped = 0;
let keep = fs.existsSync(KEEP) ? JSON.parse(fs.readFileSync(KEEP, "utf8")) : [];
for (let it = 0; it < 12; it++) {
  execSync(`git checkout -- ${files.join(" ")}`);
  const r = M.move(".", { from: FROM, keep, write: true });
  const flips = [];
  for (const o of ["dev", "prod"]) {
    fs.rmSync(`${T}/mv-${o}.json`, { force: true }); try { execSync(`node tools/css-cascade.mjs src:${BASE} src:${W} --order ${o} --raw-key --json ${T}/mv-${o}.json --max 1`, { stdio: "ignore" }); } catch {} const J = JSON.parse(fs.readFileSync(`${T}/mv-${o}.json`, "utf8")); const real = J.flips.filter((f) => { const m = f.sides.filter((x) => x.changed), o = f.sides.filter((x) => !x.changed); if (!process.env.APART || m.length !== 1 || o.length !== 1) return true; return !apartC(m[0], o[0]); }); dropped += J.flips.length - real.length; flips.push(...real); console.log(`  ${o}: mất ${J.lost.length}, thừa ${J.extra.length}, đổi ${J.flips.length}, cặp ${J.pairs}`);
  }
  // Luật đã chuyển nào có selector trùng selector của một bên trong cặp đổi → giữ lại.
  const sels = new Set(flips.flatMap((f) => f.sides.map((s) => s.sel.replace(/\s+/g, " ").trim())));
  const add = r.moved.filter((m) => splitList(m.sel).some((s) => sels.has(s.replace(/\s+/g, " ").trim()))).map((m) => m.key);
  const bytes = Object.values(r.bytes).reduce((a, b) => a + b, 0);
  console.log(`(bỏ ${dropped} cặp chắc chắn khác phần tử)`); dropped = 0; console.log(`vòng ${it}: chuyển ${r.moved.length} luật / ${bytes} byte, ${flips.length} cặp đổi, giữ thêm ${add.length}`);
  if (!flips.length) break;
  if (!add.length) { console.log("cặp đổi không dính luật đã chuyển:"); for (const f of flips.slice(0, 8)) console.log(JSON.stringify(f).slice(0, 600)); break; }
  keep = [...new Set([...keep, ...add])]; fs.writeFileSync(KEEP, JSON.stringify(keep, null, 1));
}
