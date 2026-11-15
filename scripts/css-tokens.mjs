// B5 bước 6a / 7a: thay số cứng bằng token của app/tokens.css, KHÔNG đổi giá trị (chỉ ánh xạ đúng bằng; số lệch thang để nguyên cho bước
// 6b / 7b, cần chủ dự án duyệt ảnh trước / sau).
// - font-size và cỡ chữ trong font: viết tắt: 12/13/14/16/20/24/28px → var(--fs-1..7), 12.5px → var(--fs-label), 13.5px → var(--fs-chat).
// - z-index ≥ 20 → tầng --z-* theo bảng ZMAP (giữ nguyên thứ tự tương đối: calc(var(--z-bậc dưới) + n) cho số xen giữa).
// - tsx: style={{ fontSize: 13 }} / CSSProperties = { … fontSize: 13 } → "var(--fs-2)"; zIndex: 70 → "var(--z-overlay)".
//   Bỏ qua: home.tsx (B2 đang tách tệp), tùy chọn của xterm / Monaco (cần số), cỡ tính từ biến (Math.round(size * .6)…).
// Dùng: node scripts/css-tokens.mjs [--write] [--only fs|z]   (không có --write: chỉ in số chỗ sẽ đổi)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SRC_ROOTS } from "../tests/lib/srcroots.mjs";

const postcss = createRequire(import.meta.url)("postcss");
export const FS = { 12: "--fs-1", 13: "--fs-2", 14: "--fs-3", 16: "--fs-4", 20: "--fs-5", 24: "--fs-6", 28: "--fs-7", 12.5: "--fs-label", 13.5: "--fs-chat" };
export const ZLEVELS = [["--z-sticky", 20], ["--z-pop", 30], ["--z-menu", 40], ["--z-modal", 50], ["--z-drawer", 60], ["--z-overlay", 70], ["--z-full", 200], ["--z-top", 1000], ["--z-toast", 1100], ["--z-tip", 2147483000]];
/** z-index ≥ 20 → biểu thức token (bậc ngay dưới + phần lẻ), null nếu < 20. */
export function zToken(n) {
  if (!(n >= 20) || ONLY === "fs") return null;
  let best = null; for (const [name, v] of ZLEVELS) if (v <= n) best = [name, v];
  return best[1] === n ? `var(${best[0]})` : `calc(var(${best[0]}) + ${n - best[1]})`;
}
// --only fs | z: chỉ đổi một loại (mỗi loại một commit).
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
const fsToken = (px) => (ONLY !== "z" && FS[px] ? `var(${FS[px]})` : null);

const SKIP_CSS = new Set(["app/tokens.css"]);
const walk = (d, ext, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!["api", "node_modules", "vendor", "design-engine"].includes(e.name)) walk(p, ext, out); }
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
};

/** Đổi một tệp CSS; trả về [css mới, số font-size, số z-index]. */
export function rewriteCss(css, from = "") {
  const root = postcss.parse(css, { from });
  let nf = 0, nz = 0;
  root.walkDecls((d) => {
    if (d.parent?.parent?.type === "atrule" && /keyframes$/i.test(d.parent.parent.name)) return;
    const p = d.prop.toLowerCase();
    if (p === "font-size") {
      const m = /^(\d*\.?\d+)px$/.exec(d.value.trim()); const t = m && fsToken(+m[1]);
      if (t) { d.value = t; nf++; }
    } else if (p === "font") {
      const parts = d.value.trim().split(/\s+/);
      const i = parts.findIndex((x) => /^\d*\.?\d+px(\/.+)?$/.test(x));
      if (i >= 0) { const [, num, rest] = /^(\d*\.?\d+)px(\/.+)?$/.exec(parts[i]); const t = fsToken(+num); if (t) { parts[i] = t + (rest ?? ""); d.value = parts.join(" "); nf++; } }
    } else if (p === "z-index") {
      const v = d.value.trim(); const t = /^\d+$/.test(v) && zToken(+v);
      if (t) { d.value = t; nz++; }
    }
  });
  return [root.toString(), nf, nz];
}

const TSX_SKIP = new Set(["ui/home.tsx", "ui/codepanes.tsx", "ui/codeview.tsx", "ui/deckpptx.ts"]);
/** Đổi fontSize / zIndex số trong style của một tệp tsx. */
export function rewriteTsx(src) {
  let nf = 0, nz = 0;
  const out = src.split("\n").map((line) => {
    if (!/style=\{\{|CSSProperties\s*=\s*\{|style:\s*\{/.test(line) || /options=\{\{|new Terminal\(/.test(line)) return line;
    line = line.replace(/\bfontSize:\s*(\d+(?:\.\d+)?)(?=\s*[,}])/g, (m, n) => { const t = fsToken(+n); if (!t) return m; nf++; return `fontSize: "${t}"`; });
    line = line.replace(/\bzIndex:\s*(\d+)(?=\s*[,}])/g, (m, n) => { const t = zToken(+n); if (!t) return m; nz++; return `zIndex: "${t}"`; });
    return line;
  });
  return [out.join("\n"), nf, nz];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  let F = 0, Z = 0, TF = 0, TZ = 0;
  for (const f of ["app", "ui"].filter((r) => fs.existsSync(r)).flatMap((r) => walk(r, /\.css$/))) {
    if (SKIP_CSS.has(f)) continue;
    const css = fs.readFileSync(f, "utf8"); const [next, nf, nz] = rewriteCss(css, f);
    if (nf || nz) { console.log(`${f}: font-size ${nf}, z-index ${nz}`); F += nf; Z += nz; if (write) fs.writeFileSync(f, next); }
  }
  for (const f of SRC_ROOTS.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r, /\.tsx$/))) {
    if (TSX_SKIP.has(f)) continue;
    const src = fs.readFileSync(f, "utf8"); const [next, nf, nz] = rewriteTsx(src);
    if (nf || nz) { console.log(`${f}: fontSize ${nf}, zIndex ${nz}`); TF += nf; TZ += nz; if (write) fs.writeFileSync(f, next); }
  }
  console.log(`${write ? "đã đổi" : "sẽ đổi"}: CSS font-size ${F}, z-index ${Z}; tsx fontSize ${TF}, zIndex ${TZ}`);
}
