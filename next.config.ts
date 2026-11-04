import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // npm run dev:mock dùng thư mục build riêng để chạy song song với npm run dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dữ liệu lúc chạy (skill đã cài, tệp người dùng, Python cục bộ…) không phải mã nguồn: không cho bước dò tệp của bản build quét vào.
  // Từ khi cài sẵn cả danh mục skill của Claude, data/skills có hàng trăm nghìn tệp (1GB+) và bản build hết bộ nhớ khi dò qua chúng.
  outputFileTracingExcludes: { "*": ["data/**", "data-mock/**", "workspace/**", ".mkvenv/**", "tests/**", ".next-mock/**", ".next-mockfast/**"] },
  // WebContainers cần trang cô lập (SharedArrayBuffer). credentialless vẫn cho phép tải CDN (Monaco, Pyodide).
  async headers() {
    return [{ source: "/:path*", headers: [
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
    }, ...["/brand/:path*", "/connectors/:path*", "/icon-:size(\\d+).png", "/icon-maskable-:size(\\d+).png"].map((source) => ({
      // Biểu tượng, logo: tên tệp không đổi khi nội dung đổi nên giữ một tuần, sau đó vẫn dùng bản cũ trong lúc tải bản mới.
      source, headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
    }))];
  },
};

export default nextConfig;
