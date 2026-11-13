// npm run lint: ESLint theo eslint.config.mjs (next/core-web-vitals + jsx-a11y). Các gói ESLint chưa nằm trong package.json (thêm gói là
// quyết định của chủ sở hữu, đổi package-lock): thiếu gói thì in lệnh cài và thoát 0 để npm run lint / CI không đỏ vì chưa cài.
// LINT_STRICT=1 (hoặc --strict): thiếu gói cũng là lỗi. Tham số khác chuyển thẳng cho eslint (vd. npm run lint -- app/page.tsx).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

// Phiên bản khớp Next / React 19 (eslint-config-next luôn cùng số phiên bản với gói next trong package.json).
const LINT_DEPS = { eslint: "^9.39.0", "eslint-config-next": "15.5.28", "@eslint/eslintrc": "^3.3.1", "eslint-plugin-jsx-a11y": "^6.10.2" };

const R = createRequire(path.join(process.cwd(), "package.json"));
const has = (m) => { try { R.resolve(`${m}/package.json`); return true; } catch { try { R.resolve(m); return true; } catch { return false; } } };
const args = process.argv.slice(2).filter((a) => a !== "--strict");
const strict = process.env.LINT_STRICT === "1" || process.argv.includes("--strict");
const missing = Object.keys(LINT_DEPS).filter((m) => !has(m));
if (missing.length) {
  console.log(`ESLint chưa cài (thiếu ${missing.join(", ")}): bỏ qua bước lint.`);
  console.log(`Cài một lần: npm i -D ${Object.entries(LINT_DEPS).map(([k, v]) => `${k}@${v}`).join(" ")}`);
  process.exit(strict ? 1 : 0);
}
const bin = R.resolve("eslint/bin/eslint.js");
const r = spawnSync(process.execPath, [bin, "--max-warnings=-1", ...(args.length ? args : ["."])], { stdio: "inherit" });
process.exit(r.status ?? 1);
