// Chế độ làm việc và bộ luật có sẵn của Synchro Code: tách khỏi codeview.tsx (nặng) vì Cài đặt cũng cần.
export const MODES = [
  { k: "auto", label: "Tự động", short: "Auto", desc: "Tự lập kế hoạch, viết code hay gỡ lỗi theo từng việc, và chuyển qua lại khi đang làm." },
  { k: "plan", label: "Architect / Plan", short: "Plan", desc: "Chỉ phân tích cấu trúc và lập kế hoạch, không viết code dài." },
  { k: "code", label: "Write / Code", short: "Code", desc: "Tập trung sinh code hoàn chỉnh, sẵn sàng chạy ngay." },
  { k: "debug", label: "Debug", short: "Debug", desc: "Đọc lỗi, truy nguyên nhân gốc và đề xuất cách sửa." },
] as const;
export const PRESETS = [
  { k: "next", label: "Next.js + Tailwind + TypeScript", rule: "Dùng Next.js App Router, Tailwind CSS và TypeScript strict. Ưu tiên Server Components, đặt tên file kebab-case." },
  { k: "vite", label: "React + Vite + TypeScript", rule: "Dùng React 19 function components + hooks, Vite, TypeScript strict, CSS Modules." },
  { k: "fastapi", label: "Python + FastAPI", rule: "Dùng Python 3.12, FastAPI, Pydantic v2, type hints đầy đủ, async/await." },
  { k: "express", label: "Node.js + Express", rule: "Dùng Node.js 20, Express, ES modules, xử lý lỗi bằng middleware tập trung." },
  { k: "go", label: "Go (net/http)", rule: "Dùng Go 1.22, net/http chuẩn, trả lỗi tường minh, không dùng global state." },
] as const;
