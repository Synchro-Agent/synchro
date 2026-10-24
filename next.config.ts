import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // npm run dev:mock dùng thư mục build riêng để chạy song song với npm run dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // WebContainers cần trang cô lập (SharedArrayBuffer). credentialless vẫn cho phép tải CDN (Monaco, Pyodide).
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ] }];
  },
};

export default nextConfig;
