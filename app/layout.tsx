import GlassFX from "./glass";
import { I18n } from "./i18n";
import type { Metadata, Viewport } from "next";
// Unbounded của bộ nhận diện (tự lưu trên máy chủ, đủ dấu tiếng Việt): chỉ cho logo và tiêu đề; chữ thường vẫn là Anthropic Sans.
import "@fontsource-variable/unbounded/wght.css";
import "./globals.css";
import "./glass.css";
import "./synchro-ds.css";

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
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme')||'light';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;var u=JSON.parse(localStorage.getItem('p:uilang')||'"vi"');document.documentElement.lang=u==='en'?'en':'vi'}catch(e){}`,
          }}
        />
      </head>
      <body>{children}<GlassFX /><I18n /></body>
    </html>
  );
}
