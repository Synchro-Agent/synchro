import GlassFX from "./_shell/glass";
import { I18n } from "./_shell/i18n";
import { ChunkGuard } from "./_shell/chunkguard";
import { langScript } from "../server/langdetect";
import type { Metadata, Viewport } from "next";
// Unbounded của bộ nhận diện (tự lưu trên máy chủ, đủ dấu tiếng Việt): chỉ cho logo và tiêu đề; chữ thường là Be Vietnam Pro (globals.css).
import "@fontsource-variable/unbounded/wght.css";
// Hai bộ chữ của lời chào (Latin, tiếng Việt) lấy từ /fonts để tải trước được: tên tệp trong gói bị băm khi dựng. Khai báo sau nên thắng bản của gói cho đúng các chữ đó.
import "./_shell/unbounded-preload.css";
// Thứ tự cascade (B5) do câu lệnh @layer quyết định, lặp y hệt ở đầu mọi tệp CSS: properties, theme, base, components, utilities (Tailwind),
// rồi syn (mọi CSS của app, kể cả katex / xterm bọc lại) và syn-over (khối cuối mỗi tệp: luật trước đây cần !important chỉ để thắng thứ tự;
// lớp sau thắng mọi luật thường của syn bất kể specificity, vẫn thua style nội dòng). Trong syn, bên thắng theo specificity rồi thứ tự nạp:
// - tokens.css (globals.css @import nó; không import riêng ở đây: thêm một tệp CSS vào layout làm webpack gom và xếp lại các tệp CSS của bản
//   build) chỉ định nghĩa biến (thang cỡ chữ, khoảng cách, bo góc, tầng z-index, mốc màn hình, màu bổ sung), vị trí không quan trọng;
// - globals.css → glass.css → synchro-ds.css → features.css là thứ tự ghi đè ở next dev, đừng đổi. Bản build webpack gộp glass.css +
//   features.css thành một tệp nạp TRƯỚC globals.css, nên luật của hai tệp đó muốn thắng globals.css phải hơn specificity. Thứ tự đó đến
//   từ phép sắp xếp theo tên đường dẫn của next (flight-client-entry-plugin) trộn các tệp CSS này với ba component client nhập ở trên và so
//   chúng với đường dẫn node_modules/ của bộ chữ: các tệp CSS tải đầu và ba ranh giới client đó phải cùng ở app/_shell/ (thư mục riêng, Next
//   không coi là route; chữ "app" xếp trước "node_modules", "ui" thì sau). Ba tệp trong app/_shell/ chỉ chuyển tiếp sang ui/glass.tsx,
//   ui/i18n.tsx, ui/chunkguard.tsx. Đổi tên / chuyển các tệp app/_shell/ đi là đổi thứ tự (tests/api/paths-guard.test.mjs canh);
// - CSS riêng của từng màn tải chậm (ui/styles/: codeview.css, speech.css, brainview.css, download.css, projects.css, settings.css,
//   skills.css) nạp cùng màn đó, luôn sau bốn tệp trên. Luật chỉ được chuyển sang đó khi mọi selector neo vào tệp riêng của màn và không đổi
//   bên thắng với luật chung đứng sau nó: tools/css-move.mjs + css-move-verify.mjs; tests/api/css-split.test.mjs canh lớp đã tách.
//   Thành phần dùng chung chỉ màn tải chậm vẽ có tệp riêng nạp cùng thành phần (ui/colorpick.tsx → colorpick.css, ui/pearlorb.tsx →
//   pearlorb.css): có thể nạp trước hay sau CSS riêng của màn, nên css-cascade kiểm cả hai thứ tự (CSS_LAZY_ORDER=first).
import "./_shell/globals.css";
import "./_shell/glass.css";
import "./_shell/synchro-ds.css";
import "./_shell/features.css";

const DESC = "Synchro: chat với mọi model AI, viết code, giọng nói và tự động hoá công việc, tất cả đồng bộ một nhịp.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://synchro.net.nz"),
  title: "Synchro",
  description: DESC,
  applicationName: "Synchro",
  appleWebApp: { title: "Synchro", statusBarStyle: "black-translucent" },
  openGraph: { title: "Synchro", description: DESC, siteName: "Synchro", type: "website" },
  twitter: { card: "summary_large_image", title: "Synchro", description: DESC },
};

// Màu thanh trình duyệt / thanh trạng thái: Ivory ở giao diện sáng, Carbon ở giao diện tối (page.tsx đổi theo giao diện người dùng chọn).
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#EEECE5" }, { media: "(prefers-color-scheme: dark)", color: "#111210" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Phông chữ thường của toàn bộ giao diện (Be Vietnam Pro, hai độ đậm dùng nhiều nhất: chữ thường và chữ vừa): tải sớm để chữ không nhảy khi phông về. */}
        <link rel="preload" href="/fonts/BeVietnamPro-Regular.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/BeVietnamPro-Medium.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/unbounded-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/unbounded-vietnamese-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script
          dangerouslySetInnerHTML={{
            __html: langScript(process.env.SYNCHRO_FIXED_LANG),
          }}
        />
        {/* Mở thẳng một đoạn chat (#c=…): màn chờ trong HTML dựng ở máy chủ hiện dạng tin nhắn ngay, trước khi trang chạy mã (globals.css, BootSkeleton). */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(/^#c=/.test(location.hash))document.documentElement.setAttribute("data-boot-chat","")}catch(e){}` }} />
      </head>
      <body>{children}<GlassFX /><I18n /><ChunkGuard /></body>
    </html>
  );
}
