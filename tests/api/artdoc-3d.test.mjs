// Gói 3D (nền shader, kính khúc xạ) và ECharts trong khung artifact (shared/artdoc.ts, shared/artkit.ts): chỉ nạp khi trang thật sự dùng, đúng tệp ghim SRI,
// CSP của khung không nới ra (không mạng, không tệp HDR), gói 3D dựng lại được từ nguồn ghim. Không cần máy chủ.
// Trình duyệt thật (WebGL vẽ ra, xuất PNG / PowerPoint / PDF không trắng, giảm chuyển động): tests/ui/media-kit.mjs.
import fs from "node:fs";
import crypto from "node:crypto";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const { artdoc: D, artkit: K } = await loadTs(["artdoc", "artkit"]);
const O = "https://app.test";
const libsOf = (html) => JSON.parse(/libs=(\[\[.*?\]\]),i=0/.exec(html)?.[1] ?? "[]").map((l) => l[0].split("/").pop());
const react = (src) => D.buildDocCore("react", src, O, "c", false, "");

console.log("1. React: chỉ nạp khi import");
{
  const base = libsOf(react(`import React from "react";\nexport default () => <p>x</p>;`));
  ok(base.length === D.LIBS.length && !base.some((f) => /^(synchro-3d|echarts)-/.test(f)), "không import: không gói 3D, không ECharts", base.join(","));
  for (const [name, src] of [
    ["shadergradient", `import { ShaderGradientCanvas, ShaderGradient } from "shadergradient";`],
    ["@shadergradient/react", `import { ShaderGradient } from '@shadergradient/react'`],
    ["three", `import * as THREE from "three";`],
    ["@react-three/fiber", `import { Canvas } from "@react-three/fiber";`],
    ["@react-three/drei", `import { MeshTransmissionMaterial } from "@react-three/drei";`],
    ["require", `const T = require("three");`],
  ]) {
    const l = libsOf(react(`${src}\nexport default () => null;`));
    ok(l.filter((f) => f === "synchro-3d-1.0.0.js").length === 1 && l.at(-1) === "synchro-3d-1.0.0.js" && !l.includes("echarts-6.1.0.min.js"), `import ${name}: thêm đúng một gói 3D, sau React`, l.join(","));
  }
  ok(!libsOf(react(`// dùng three.js sau\nconst s = "three";\nexport default () => null;`)).includes("synchro-3d-1.0.0.js"), "chữ \"three\" trong chuỗi / chú thích không kéo gói 3D");
  const e = libsOf(react(`import * as echarts from "echarts";\nexport default () => null;`));
  ok(e.includes("echarts-6.1.0.min.js") && !e.includes("synchro-3d-1.0.0.js"), "import echarts: chỉ thêm ECharts");
  const html = react(`import { ShaderGradient } from "shadergradient";\nexport default () => null;`);
  ok(/mods\.three=S3\.THREE/.test(html) && /mods\["@react-three\/fiber"\]=S3\.Fiber/.test(html) && /mods\["@react-three\/drei"\]=S3\.drei/.test(html) && /mods\.shadergradient=sg/.test(html) && /mods\["@shadergradient\/react"\]=sg/.test(html), "bản đồ mô-đun: three, fiber, drei, shadergradient, @shadergradient/react");
  ok(/Thư viện "'\+n\+'" không có sẵn/.test(html) && /shadergradient/.test(/không có sẵn trong artifact \(([^)]*\([^)]*\)[^)]*)\)/.exec(html)?.[1] ?? ""), "lỗi thư viện thiếu liệt kê đủ thư viện có sẵn");
}

console.log("2. Tệp ghim, CSP");
{
  const f = fs.readFileSync("public/vendor/synchro-3d-1.0.0.js");
  const sri = "sha384-" + crypto.createHash("sha384").update(f).digest("base64");
  ok(K.SYNCHRO_3D[0] === "synchro-3d-1.0.0.js" && K.SYNCHRO_3D[2] === sri, "SRI trong artkit khớp tệp vendor", sri);
  ok(f.length < 1_200_000, "gói 3D dưới 1,2 MB", f.length);
  const src = f.toString("utf8");
  ok(/window\.Synchro3D|\.Synchro3D=/.test(src) && !/ruucm\.github\.io[^"']*\.hdr["']\)/.test(src.replace(/envBasePath[^,]*,/g, "")), "gói đặt window.Synchro3D");
  const pkg = JSON.parse(fs.readFileSync("tools/vendor-3d/package.json", "utf8")), lock = JSON.parse(fs.readFileSync("tools/vendor-3d/package-lock.json", "utf8"));
  const want = { three: "0.169.0", "@react-three/fiber": "8.18.0", "@react-three/drei": "9.122.0", "@shadergradient/react": "2.4.20", react: "18.3.1" };
  ok(Object.entries(want).every(([k, v]) => pkg.dependencies[k] === v && lock.packages[`node_modules/${k}`]?.version === v && /^sha512-/.test(lock.packages[`node_modules/${k}`]?.integrity ?? "")), "phiên bản ghim đúng (không ^ ~), lockfile có sha512");
  ok(pkg.devDependencies.esbuild === "0.25.12", "esbuild ghim trong lockfile riêng, không vào package.json của app");
  ok(!JSON.parse(fs.readFileSync("package.json", "utf8")).devDependencies?.esbuild && !JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies?.three, "package.json của app không thêm gói");
  const cspNow = D.csp(O);
  ok(/connect-src 'none'/.test(cspNow) && /img-src data: blob:;/.test(cspNow) && !/ruucm|github\.io/.test(cspNow), "CSP không nới: không gọi mạng, không tải ảnh / HDR ngoài");
  ok(/README/.test("README") && /synchro-3d-1\.0\.0\.js — dựng bằng node tools\/build-vendor-3d\.mjs/.test(fs.readFileSync("public/vendor/README.md", "utf8")), "README vendor ghi rõ tệp đóng gói và cách dựng lại");
}

console.log("3. Trang HTML / bản trình bày: bộ CSS");
{
  const page = `<html data-sx-preset="midnight-tech"><body><section class="slide sx-slide"><div class="sx-shader" data-sx-shader="silk"></div><h1 class="sx-display">Bìa</h1></section></body></html>`;
  const h = K.kitHead(page, O);
  ok(/<script data-sx-3d>/.test(h) && h.includes(`${O}/vendor/synchro-3d-1.0.0.js`) && h.includes(K.SYNCHRO_3D[2]), "có data-sx-shader: bộ nạp 3D từ /vendor với SRI");
  ok(/radial-gradient\(ellipse 70% 60% at 22% 30%,#4F46E5cc/.test(K.KIT_CSS) && /linear-gradient\(160deg,#08090E 0%,#0F172A 100%\)/.test(K.KIT_CSS), "lớp CSS dự phòng đúng màu của chủ dự án (color1-3, bgColor1-2)");
  ok(!/<script data-sx-3d>/.test(K.kitHead(`<div class="sx-card">x</div>`, O)) && !/<script data-sx-charts>/.test(K.kitHead(`<div class="sx-card">x</div>`, O)), "trang không dùng: không bộ nạp 3D, không ECharts");
  ok(/<script data-sx-charts>/.test(K.kitHead(`<div class="sx-chart" data-sx-chart='{"type":"bar"}'></div>`, O)), "có data-sx-chart: bộ nạp biểu đồ");
  ok(/window\.__sxThumb\)return/.test(h) && /window\.__sxStatic=1;window\.__sxThumb=1;/.test(D.deckRuntime(0)) && !/__sxThumb/.test(D.deckRuntime(null)), "ảnh thu nhỏ (khung cố định) không nạp 3D; khung xem thường thì nạp");
  ok(/beforeprint/.test(h) && /afterprint/.test(h), "in PDF: đổi canvas WebGL thành ảnh rồi trả lại");
  const exp = D.deckExport(page, O);
  ok(exp.includes(`${O}/vendor/synchro-3d-1.0.0.js`), "tệp HTML tải về nạp gói 3D từ địa chỉ Synchro");
  const noOrigin = K.kitHead(page, "");
  ok(/"",\s*"sha384-/.test(noOrigin) || /\["","sha384-/.test(noOrigin), "không biết địa chỉ Synchro: không nạp gói 3D (không có bản CDN), lớp CSS vẫn là nền");
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
