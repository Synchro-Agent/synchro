// Danh mục plugin dựng sẵn (dùng ở cả trình duyệt và máy chủ). Mỗi plugin gom skill từ một hoặc nhiều repo GitHub công khai;
// chỉ lấy skill có giấy phép mở (MIT / Apache-2.0). Ba plugin "studio" gắn với nút Thiết kế / Trình bày / Tài liệu ở trang Artifacts.
import type { PluginDef } from "./plugins";

export type DirPlugin = PluginDef & { catalogId: string; category: "studio" | "design" | "dev" | "writing"; tagline: string; skillCount: number; license: string };

const AS = "anthropics/skills", EMIL = "emilkowalski/skills", UUX = "nextlevelbuilder/ui-ux-pro-max-skill", VC = "vercel-labs/agent-skills";

export const PLUGIN_DIR: DirPlugin[] = [
  {
    catalogId: "design-studio", slug: "design-studio", name: "Design Studio", studio: "design", category: "studio", color: "#7c3aed", license: "MIT · Apache-2.0", skillCount: 32,
    tagline: "Mọi kiến thức thiết kế trong một nút: giao diện, thẩm mỹ, chuyển động, thương hiệu, minh họa.",
    description: "Thư viện thiết kế cho nút Thiết kế: frontend-design, canvas-design và theme-factory của Anthropic; Taste; UI/UX Pro Max (design system, UI styling, brand, banner); triết lý design engineering và animation của Emil Kowalski; Web Interface Guidelines của Vercel; UX Designer; 118 mẫu HTML của Awesome Design HTML; ảnh chụp App Store. Model tự chọn skill phù hợp cho từng việc.",
    author: "Nhiều tác giả", homepage: "https://github.com/anthropics/skills",
    sources: [
      { repo: AS, path: "skills", include: ["frontend-design", "canvas-design", "theme-factory", "algorithmic-art", "web-artifacts-builder"] },
      { repo: "Leonxlnx/taste-skill" },
      { repo: UUX, path: ".claude/skills", include: ["ui-ux-pro-max", "design", "design-system", "ui-styling", "brand", "banner-design"] },
      { repo: EMIL, path: "skills", include: ["emil-design-eng", "apple-design", "animate", "animation-performance", "animation-vocabulary", "improve-animations", "review-animations", "find-animation-opportunities", "prototype", "mobile-native", "break-ui", "pick-ui-library", "animate-expo"] },
      { repo: VC, path: "skills", include: ["web-design-guidelines", "vercel-react-view-transitions"] },
      { repo: "szilu/ux-designer-skill" },
      { repo: "yzfly/awesome-design-html" },
      { repo: "ParthJadhav/app-store-screenshots" },
    ],
  },
  {
    catalogId: "slides-studio", slug: "slides-studio", name: "Slides Studio", studio: "slides", category: "studio", color: "#ea580c", license: "MIT · Apache-2.0", skillCount: 6,
    tagline: "Bản trình bày có câu chuyện, bố cục và chủ đề đẹp; xuất HTML hoặc PowerPoint.",
    description: "Cho nút Trình bày: slides (HTML có Chart.js, công thức viết slide) và design-system của UI/UX Pro Max, theme-factory và frontend-design của Anthropic, writing-guidelines của Vercel. Tệp .pptx được tạo bằng chạy code (python-pptx).",
    author: "Nhiều tác giả", homepage: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    sources: [
      { repo: UUX, path: ".claude/skills", include: ["slides", "design-system"] },
      { repo: AS, path: "skills", include: ["theme-factory", "frontend-design"] },
      { repo: VC, path: "skills", include: ["writing-guidelines"] },
      { repo: EMIL, path: "skills", include: ["animation-vocabulary"] },
    ],
  },
  {
    catalogId: "docs-studio", slug: "docs-studio", name: "Docs Studio", studio: "docs", category: "studio", color: "#2563eb", license: "MIT · Apache-2.0", skillCount: 4,
    tagline: "Tài liệu rõ ràng, đúng giọng văn, trình bày đẹp; xuất Word, PDF hoặc Markdown.",
    description: "Cho nút Tài liệu: internal-comms và theme-factory của Anthropic, writing-guidelines của Vercel, brand (giọng văn thương hiệu) của UI/UX Pro Max. Tệp .docx / .pdf được tạo bằng chạy code (python-docx, reportlab).",
    author: "Nhiều tác giả", homepage: "https://github.com/anthropics/skills",
    sources: [
      { repo: AS, path: "skills", include: ["internal-comms", "theme-factory"] },
      { repo: VC, path: "skills", include: ["writing-guidelines"] },
      { repo: UUX, path: ".claude/skills", include: ["brand"] },
    ],
  },
  {
    catalogId: "web-dev-qa", slug: "web-dev-qa", name: "Web Dev & QA", category: "dev", color: "#0f766e", license: "MIT · Apache-2.0", skillCount: 7,
    tagline: "Kiểm thử giao diện bằng trình duyệt thật, xây máy chủ MCP, tối ưu React.",
    description: "playwright-cli của Microsoft, webapp-testing, mcp-builder và skill-creator của Anthropic, react-best-practices và composition-patterns của Vercel. Hợp với Synchro Code.",
    author: "Microsoft, Anthropic, Vercel", homepage: "https://github.com/microsoft/playwright-cli",
    sources: [
      { repo: "microsoft/playwright-cli", path: "skills" },
      { repo: AS, path: "skills", include: ["webapp-testing", "mcp-builder", "skill-creator"] },
      { repo: VC, path: "skills", include: ["vercel-react-best-practices", "vercel-composition-patterns"] },
    ],
  },
  { catalogId: "emil-kowalski", slug: "emil-kowalski", name: "Emil Kowalski Design Engineering", category: "design", color: "#111827", license: "MIT", skillCount: 15, tagline: "Độ tinh tế của giao diện và animation, từ tác giả Sonner và Vaul.", description: "15 skill về animation, độ mượt, cảm giác native, rà soát chuyển động.", author: "Emil Kowalski", homepage: "https://github.com/emilkowalski/skills", sources: [{ repo: EMIL }] },
  { catalogId: "ui-ux-pro-max", slug: "ui-ux-pro-max", name: "UI/UX Pro Max", category: "design", color: "#db2777", license: "MIT", skillCount: 7, tagline: "Design intelligence: style, bảng màu, font, design system, thương hiệu.", description: "Gồm ui-ux-pro-max, design, design-system, ui-styling, brand, banner-design, slides.", author: "Next Level Builder", homepage: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill", sources: [{ repo: UUX, path: ".claude/skills" }] },
  { catalogId: "taste", slug: "taste", name: "Taste", category: "design", color: "#a16207", license: "MIT", skillCount: 1, tagline: "Gu thẩm mỹ cho frontend: tránh giao diện AI chung chung.", description: "design-taste-frontend.", author: "Leonxlnx", homepage: "https://github.com/Leonxlnx/taste-skill", sources: [{ repo: "Leonxlnx/taste-skill" }] },
  { catalogId: "awesome-design-html", slug: "awesome-design-html", name: "Awesome Design HTML", category: "design", color: "#b91c1c", license: "MIT", skillCount: 1, tagline: "118 mẫu trang HTML đơn để tham khảo phong cách.", description: "Bộ tham chiếu thiết kế trang đơn.", author: "yzfly", homepage: "https://github.com/yzfly/awesome-design-html", sources: [{ repo: "yzfly/awesome-design-html" }] },
  { catalogId: "app-store-screenshots", slug: "app-store-screenshots", name: "App Store Screenshots", category: "design", color: "#0ea5e9", license: "MIT", skillCount: 1, tagline: "Trang ảnh chụp App Store / Google Play xuất được.", description: "Tạo ảnh marketing cho ứng dụng di động.", author: "Parth Jadhav", homepage: "https://github.com/ParthJadhav/app-store-screenshots", sources: [{ repo: "ParthJadhav/app-store-screenshots" }] },
  { catalogId: "ux-designer", slug: "ux-designer", name: "UX Designer", category: "design", color: "#4f46e5", license: "MIT", skillCount: 1, tagline: "Hướng dẫn và phản biện UX/UI cho giao diện và code frontend.", description: "ux-designer.", author: "Szilárd Hajba", homepage: "https://github.com/szilu/ux-designer-skill", sources: [{ repo: "szilu/ux-designer-skill" }] },
  { catalogId: "vercel-agent-skills", slug: "vercel-agent-skills", name: "Vercel Agent Skills", category: "dev", color: "#000000", license: "MIT", skillCount: 9, tagline: "React, Next.js, giao diện web và triển khai lên Vercel.", description: "Web design guidelines, React best practices, view transitions, deploy.", author: "Vercel", homepage: "https://github.com/vercel-labs/agent-skills", sources: [{ repo: VC, path: "skills" }] },
  { catalogId: "anthropic-skills", slug: "anthropic-skills", name: "Anthropic Skills (mã nguồn mở)", category: "dev", color: "#d97757", license: "Apache-2.0", skillCount: 14, tagline: "Skill mẫu của Anthropic có giấy phép Apache-2.0.", description: "Các skill độc quyền (docx, pdf, pptx, xlsx) bị bỏ qua vì giấy phép không cho sao chép.", author: "Anthropic", homepage: "https://github.com/anthropics/skills", sources: [{ repo: AS, path: "skills" }] },
];

export const STUDIO_LABEL = { design: "Thiết kế", slides: "Trình bày", docs: "Tài liệu" } as const;
