import type { NextConfig } from "next";

// script-src của CSP thử (Report-Only). Cloudflare Turnstile (app/turnstilebox.tsx) chỉ chạy ở màn đăng nhập, đăng ký và quên mật khẩu, tức khi
// chưa có cookie phiên: chỉ những trang đó mới cho thêm challenges.cloudflare.com (luật sau đè luật trước cùng tên header).
const SCRIPT_SRC = "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
const cspTrial = (extra = "") => `${SCRIPT_SRC}${extra}; object-src 'none'; base-uri 'self'; report-uri /api/csp-report`;

// --- CSP CHẶN THẬT (chưa bật) -----------------------------------------------------------------------------------------
// Chính sách sẵn sàng bật khi báo cáo report-only đã sạch một thời gian (blueprint: chạy report-only ~1 tuần trước).
// Khác với bản thử: BỎ 'unsafe-eval' (chặn eval/new Function — nguồn XSS lớn nhất). Vẫn giữ 'unsafe-inline' vì Next chưa
// gắn nonce cho script nội tuyến của nó.
// TODO(CSP enforce): để bỏ nốt 'unsafe-inline', cần middleware sinh nonce mỗi request và truyền vào <Script nonce> + thẻ
//   inline của layout; headers() tĩnh này không có ngữ cảnh request nên không chèn được nonce. Khi có nonce: thay
//   'unsafe-inline' bằng 'nonce-<giá trị>' trong SCRIPT_SRC_ENFORCED. Bật bằng SYNCHRO_CSP_ENFORCE=1 (mặc định tắt —
//   không đổi hành vi VPS đang chạy). Khi bật, trang phục vụ header Content-Security-Policy chặn thật thay cho -Report-Only.
const SCRIPT_SRC_ENFORCED = "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
const cspEnforced = (extra = "") => `${SCRIPT_SRC_ENFORCED}${extra}; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; report-uri /api/csp-report`;
const CSP_ENFORCE = process.env.SYNCHRO_CSP_ENFORCE === "1";
// Trả về cặp header CSP cho một trang: mặc định frame-ancestors chặn thật + script-src report-only (như hôm nay);
// khi SYNCHRO_CSP_ENFORCE=1 thì phục vụ chính sách chặn thật (gồm cả frame-ancestors) qua header Content-Security-Policy.
const cspHeaders = (extra = "") => CSP_ENFORCE
  ? [{ key: "Content-Security-Policy", value: cspEnforced(extra) }]
  : [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }, { key: "Content-Security-Policy-Report-Only", value: cspTrial(extra) }];
// Override cho các trang đăng nhập (thêm challenges.cloudflare.com): chỉ đổi script-src, không lặp lại frame-ancestors (block gốc đã có).
const cspOverride = (extra = "") => CSP_ENFORCE
  ? [{ key: "Content-Security-Policy", value: cspEnforced(extra) }]
  : [{ key: "Content-Security-Policy-Report-Only", value: cspTrial(extra) }];

const nextConfig: NextConfig = {
  devIndicators: false,
  // npm run dev:mock dùng thư mục build riêng để chạy song song với npm run dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dữ liệu lúc chạy (skill đã cài, tệp người dùng, Python cục bộ…) không phải mã nguồn: không cho bước dò tệp của bản build quét vào.
  // Từ khi cài sẵn cả danh mục skill của Claude, data/skills có hàng trăm nghìn tệp (1GB+) và bản build hết bộ nhớ khi dò qua chúng.
  outputFileTracingExcludes: { "*": ["data/**", "data-mock/**", "workspace/**", ".mkvenv/**", "tests/**", ".next-mock/**", ".next-mockfast/**", ".cache/**", ".next-blue/**", ".next-green/**"] },
  // WebContainers cần trang cô lập (SharedArrayBuffer). credentialless vẫn cho phép tải CDN (Monaco, Pyodide).
  async headers() {
    return [{
      // HSTS: không kèm includeSubDomains / preload, vì tên miền con khác của synchro.net.nz chưa chắc đều có https. nosniff và chống nhúng không ảnh hưởng artifact
      // (khung srcDoc, không tải trang của Synchro) hay WebContainers. CSP chặn thật chỉ có frame-ancestors: script-src đang chạy thử report-only, vì khung
      // srcDoc của artifact thừa hưởng CSP của trang mẹ và Monaco, Pyodide tải từ CDN.
      source: "/:path*", headers: [
        { key: "Strict-Transport-Security", value: "max-age=15552000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }, {
      // Chỉ cho trang, không cho /api/: header ở đây đè header của route, mà tệp người dùng (/api/outputs, /api/artimg) cần CSP sandbox riêng của nó.
      // Report-Only: chỉ báo về Cài đặt → Sức khỏe hệ thống (/api/csp-report), không chặn gì. 'unsafe-inline' vì Next chưa dùng nonce, nên việc bắt được là script nạp từ nguồn lạ. Báo cáo sạch một thời gian mới nên chuyển thành chặn thật.
      source: "/((?!api/).*)", headers: cspHeaders(),
    }, {
      source: "/((?!api/).*)", missing: [{ type: "cookie", key: "synchro_session" }],
      headers: cspOverride(" https://challenges.cloudflare.com"),
    }, {
      // /reset mở được cả khi đang đăng nhập (quên mật khẩu từ trang khác).
      source: "/reset",
      headers: cspOverride(" https://challenges.cloudflare.com"),
    }, { source: "/:path*", headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ] }, {
      // Thư viện cho artifact: khung artifact không cùng nguồn gốc (sandbox) nên cần cho phép tải chéo nguồn.
      source: "/vendor/:path*", headers: [
        { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    }, {
      // Phông chữ không đổi nội dung theo bản phát hành: giữ lâu, mở lại không phải hỏi lại máy chủ từng tệp.
      source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }, ...["/brand/:path*", "/connectors/:path*", "/logos/:path*", "/ts/:path*", "/intro/:path*", "/icon-:size(\\d+).png", "/icon-maskable-:size(\\d+).png"].map((source) => ({
      // Biểu tượng, logo (cả /logos), bộ đọc cú pháp tree-sitter /ts, phim giới thiệu /intro: tên tệp không đổi khi nội dung đổi nên giữ một tuần,
      // sau đó vẫn dùng bản cũ trong lúc tải bản mới (blueprint B3.6). /ts phải khớp phiên bản với phần JS của web-tree-sitter: app/heavy.ts
      // tải bằng URL có phiên bản (?v=TS_REV), nâng gói là đổi URL nên không dính bản .wasm cũ trong bộ đệm.
      source, headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
    }))];
  },
};

export default nextConfig;
