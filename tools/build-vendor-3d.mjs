// Dựng public/vendor/synchro-3d-1.0.0.js: nền shader 3D (@shadergradient/react 2.4.20, bộ thông số của chủ dự án) và kính khúc xạ (drei MeshTransmissionMaterial) cho artifact.
// Khác các tệp vendor khác (chép nguyên bản npm): three 0.169.0 không có bản UMD, nên tệp này là bản ĐÓNG GÓI từ đúng các gói ghim trong tools/vendor-3d/package-lock.json
// (mã băm sha512 của npm), bằng esbuild 0.25.12 ghim cùng chỗ. React / ReactDOM lấy từ khung artifact (18.3.1), không đóng gói lần hai. Dựng lại cho ra cùng từng byte.
// Chạy: node tools/build-vendor-3d.mjs   (cần mạng để npm ci; không đụng node_modules của app)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = path.resolve("tools/vendor-3d"), OUT = path.resolve("public/vendor/synchro-3d-1.0.0.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-3d-"));
try {
  for (const f of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(SRC, f), path.join(tmp, f));
  fs.cpSync(path.join(SRC, "src"), path.join(tmp, "src"), { recursive: true });
  execFileSync("npm", ["ci", "--no-fund", "--no-audit", "--ignore-scripts"], { cwd: tmp, stdio: "inherit" });
  const esbuild = createRequire(path.join(tmp, "package.json"))("esbuild");
  // React của khung: mọi import react / react-dom / jsx-runtime trỏ về window.React, window.ReactDOM.
  const shims = {
    react: "module.exports = window.React;",
    "react-dom": "module.exports = window.ReactDOM;",
    "react-dom/client": "module.exports = window.ReactDOM;",
    "react/jsx-runtime": "var R = window.React; function j(t, p, k) { return R.createElement(t, k === undefined ? p : Object.assign({}, p, { key: k })); } module.exports = { jsx: j, jsxs: j, Fragment: R.Fragment };",
  };
  shims["react/jsx-dev-runtime"] = shims["react/jsx-runtime"];
  const pkgs = JSON.parse(fs.readFileSync(path.join(SRC, "package.json"), "utf8")).dependencies;
  const r = await esbuild.build({
    entryPoints: [path.join(tmp, "src/index.tsx")], bundle: true, format: "iife", minify: true, target: "es2020", platform: "browser", write: false, legalComments: "none",
    jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
    banner: { js: `/*! synchro-3d 1.0.0 — dựng bằng tools/build-vendor-3d.mjs từ ${Object.entries(pkgs).filter(([k]) => !k.startsWith("react")).map(([k, v]) => `${k}@${v}`).join(", ")} (MIT). Giấy phép: three.js © 2010-2024 three.js authors; pmndrs (@react-three/fiber, @react-three/drei) © Poimandres; ShaderGradient © ruucm. React lấy từ trang. */` },
    plugins: [{ name: "page-react", setup(b) {
      b.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime)$/ }, (a) => ({ path: a.path, namespace: "page-react" }));
      b.onLoad({ filter: /.*/, namespace: "page-react" }, (a) => ({ contents: shims[a.path], loader: "js" }));
    } }],
  });
  const code = Buffer.from(r.outputFiles[0].contents);
  fs.writeFileSync(OUT, code);
  const sri = "sha384-" + crypto.createHash("sha384").update(code).digest("base64");
  const gz = (await import("node:zlib")).gzipSync(code).length;
  console.log(`${path.relative(process.cwd(), OUT)}: ${code.length} byte (${Math.round(gz / 1024)} KB gzip) ${sri}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
