import type { MetadataRoute } from "next";

// Cài Synchro như ứng dụng (Thêm vào màn hình chính / Cài đặt ứng dụng): biểu tượng của bộ nhận diện, nền Carbon khi mở.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Synchro",
    short_name: "Synchro",
    description: "Chat với mọi model AI, viết code, giọng nói và tự động hoá công việc, tất cả đồng bộ một nhịp.",
    start_url: "/",
    display: "standalone",
    background_color: "#111210",
    theme_color: "#111210",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
