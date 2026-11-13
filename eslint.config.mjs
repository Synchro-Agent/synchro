// ESLint (H2.5): next/core-web-vitals (React, hooks, Next) + jsx-a11y (trợ năng). Chạy: npm run lint (scripts/lint.mjs).
// Cần các gói dev (chưa cài trong repo, xem scripts/lint.mjs): eslint, eslint-config-next, @eslint/eslintrc, eslint-plugin-jsx-a11y.
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
    ignores: [
      "node_modules/**", ".next/**", ".next-*/**", "out/**", "data/**", "data-mock/**", "workspace/**", "public/**", "catalog/**",
      ".mkvenv/**", ".cache/**", "scripts/vendor-3d/**", "extension/dist/**", "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["**/*.tsx", "**/*.jsx"], rules: a11yRules },
  {
    rules: {
      // tsc --noEmit (strict) đã là cổng kiểu; ESLint không lặp lại.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Ảnh trong app phần lớn là blob: / data: do người dùng tạo, next/image không áp dụng được.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Kiểm thử và script Node: không phải mã React.
    files: ["tests/**", "scripts/**", "extension/**"],
    rules: { "@typescript-eslint/no-require-imports": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
];
