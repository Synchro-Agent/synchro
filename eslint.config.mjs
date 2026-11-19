// ESLint (H2.5): next/core-web-vitals (React, hooks, Next) + jsx-a11y (trợ năng). Chạy: npm run lint (tools/lint.mjs), CI chạy ở job verify
// và chỉ đỏ khi có lỗi (error); cảnh báo (warn) không chặn. Gói dev trong package.json: eslint, eslint-config-next (cùng số phiên bản với
// next), @eslint/eslintrc, eslint-plugin-jsx-a11y.
// Trợ năng để mức "warn" ở lần bật đầu: mã hiện có chưa từng chạy qua bộ luật này, chặn ngay thì CI đỏ vì nợ cũ. Khi số cảnh báo
// về 0 thì đổi sang "error" (một dòng ở A11Y_LEVEL) để từ đó không thêm lỗi mới.
import { FlatCompat } from "@eslint/eslintrc";
import jsxA11y from "eslint-plugin-jsx-a11y";

const A11Y_LEVEL = "warn";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
// eslint-config-next đã đăng ký plugin jsx-a11y (vài luật); chỉ lấy thêm bộ luật recommended, không đăng ký lại plugin (trùng tên plugin là lỗi cấu hình).
const a11yRules = Object.fromEntries(Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([k, v]) => [k, Array.isArray(v) ? [A11Y_LEVEL, ...v.slice(1)] : v === "off" ? "off" : A11Y_LEVEL]));

export default [
  {
    // ESLint 9 (flat config) chỉ tự bỏ node_modules và .git; thư mục chấm khác vẫn bị lint. .claude/worktrees chứa hàng chục bản sao cả repo
    // (worktree của các phiên làm việc), nên bỏ mọi thư mục chấm (.claude, .tools, .mkvenv, .cache…: không thư mục nào chứa mã của app).
    ignores: [
      "node_modules/**", ".next/**", ".next-*/**", "out/**", "data/**", "data-mock/**", "workspace/**", "public/**", "catalog/**",
      "**/.*/**","tools/vendor-3d/**", "extension/dist/**", "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["**/*.tsx", "**/*.jsx"], rules: a11yRules },
  {
    rules: {
      // Quy ước của repo: không `any`, không @ts-ignore. tsc --noEmit (strict) chỉ cấm `any` ngầm định, không cấm `any` viết ra, nên ESLint chặn.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Ảnh trong app phần lớn là blob: / data: do người dùng tạo, next/image không áp dụng được.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Kiểm thử và script Node: không phải mã React. ecosystem.config.cjs là cấu hình pm2 (CommonJS, phải dùng require).
    files: ["tests/**", "scripts/**", "tools/**", "ops/**", "extension/**", "**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    // Mã chỉ chạy trên Node (máy chủ, công cụ, kiểm thử) không có React hook: các hàm tên use… ở đây là hàm thường (useProfile, useMemory,
    // useSite trong server/, use() trong tools/css-inline.mjs). rules-of-hooks đoán hook theo tên nên báo nhầm (12 chỗ lúc bật). Chỉ tắt cho
    // tệp .ts / .mjs; .tsx dưới server/ (poster dựng bằng React) vẫn được kiểm.
    files: ["server/**/*.ts", "tools/**/*.{js,mjs,ts}", "ops/**", "scripts/**", "tests/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
