import GlassFX from "./glass";
import { I18n } from "./i18n";
import { ChunkGuard } from "./chunkguard";
import { langScript } from "./langdetect";
import type { Metadata, Viewport } from "next";
// Unbounded của bộ nhận diện (tự lưu trên máy chủ, đủ dấu tiếng Việt): chỉ cho logo và tiêu đề; chữ thường là Be Vietnam Pro (globals.css).
import "@fontsource-variable/unbounded/wght.css";
// Hai bộ chữ của lời chào (Latin, tiếng Việt) lấy từ /fonts để tải trước được: tên tệp trong gói bị băm khi dựng. Khai báo sau nên thắng bản của gói cho đúng các chữ đó.
import "./unbounded-preload.css";
// Mọi CSS của app nằm trong một lớp cascade syn (sau các lớp của Tailwind, câu lệnh @layer lặp ở đầu mỗi tệp; B5). Trong lớp đó bên thắng vẫn
// theo specificity rồi thứ tự nạp. Lưu ý: bản build webpack gộp glass.css + features.css thành một tệp nạp TRƯỚC globals.css (next dev nạp
// đúng thứ tự import), nên luật của hai tệp đó muốn thắng globals.css phải hơn specificity, không dựa vào thứ tự.
// Thứ tự bốn tệp này là thứ tự ghi đè, đừng đổi. CSS riêng của Code, Speech, Bộ não, trang tải ứng dụng nằm ở tệp nạp cùng màn hình đó (codeview.css, speech/speech.css, brainview.css, download/download.css).
// Tệp nạp chậm luôn đứng sau bốn tệp này, nên chỉ quy tắc không tranh chấp (cùng độ ưu tiên, cùng thuộc tính, cùng phần tử) với quy tắc chung đứng sau nó mới được chuyển; phần còn lại vẫn ở globals.css. tests/api/css-split.test.mjs giữ các lớp đã tách không bị dùng ở trang chat.
import "./globals.css";
import "./glass.css";
import "./synchro-ds.css";
import "./features.css";

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
