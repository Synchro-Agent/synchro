// Nút không được nhảy chỗ khi rê chuột (chủ dự án quay lại 16/11/2026: nút "cuộn xuống cuối" giật qua lại 17px khi rê chuột).
// Nguyên nhân: nút canh giữa bằng transform:translateX(-50%), còn hiệu ứng kính (glass.css) đặt transform:none lúc :hover / :active,
// nên rê chuột thì nút lệch nửa bề rộng, chuột rơi ra ngoài, nút về chỗ cũ, lặp mãi. Bài này đọc CSS: phần tử nào bị đổi transform lúc
// :hover / :active thì không được dùng transform để định vị (dùng left/top tính sẵn, hoặc thuộc tính translate riêng).
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra); } };

const roots = ["app", "ui"];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); } else if (p.endsWith(".css")) files.push(p); } };
for (const r of roots) if (fs.existsSync(r)) walk(r);
ok(files.length > 5, `đọc được CSS (${files.length} tệp)`);

// Bỏ chú thích, tách thành (selector, khai báo); @media / @layer lồng nhau: lấy các khối lá.
const rules = [];
for (const f of files) {
  const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}@;]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) rules.push({ f, sel: m[1].trim(), body: m[2] });
}

// Các lớp bị đổi transform lúc rê chuột / bấm.
const hoverTargets = new Set();
for (const r of rules) {
  if (!/:(hover|active)/.test(r.sel) || !/(^|;)\s*transform\s*:/.test(r.body)) continue;
  for (const part of r.sel.split(/,(?![^(]*\))/)) {
    const inner = part.match(/:is\(([^)]*)\):is\([^)]*(hover|active)/);
    const cands = inner ? inner[1].split(",") : [part.replace(/:(hover|active)[^ ]*$/, "")];
    for (const c of cands) { const cls = c.trim().match(/\.[\w-]+$/); if (cls) hoverTargets.add(cls[0]); }
  }
}
ok(hoverTargets.has(".scroll-down"), "tìm thấy nút cuộn xuống trong danh sách bị đổi transform lúc rê chuột", [...hoverTargets].join(" "));

// Phần tử đó không được định vị (canh giữa / căn giữa dọc) bằng transform: translate…(-50%).
const bad = [];
for (const r of rules) {
  if (/:(hover|active|focus)/.test(r.sel) || /@keyframes|^(from|to|\d+%)$/.test(r.sel)) continue;
  if (!/(^|;)\s*transform\s*:[^;]*translate[XY]?\(\s*-50%/.test(r.body)) continue;
  for (const part of r.sel.split(/,(?![^(]*\))/)) {
    const last = part.trim().match(/\.[\w-]+(?=[^.\s]*$)/);
    if (last && hoverTargets.has(last[0])) bad.push(`${r.f}: ${part.trim()}`);
  }
}
ok(bad.length === 0, "nút đổi transform lúc rê chuột không canh vị trí bằng transform:translate(-50%)", bad.join(" | "));

const g = fs.readFileSync("app/_shell/globals.css", "utf8");
ok(/\.scroll-down\{position:absolute;left:calc\(50% - 17px\)/.test(g), "nút cuộn xuống canh giữa bằng left tính sẵn");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
