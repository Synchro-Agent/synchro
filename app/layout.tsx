import GlassFX from "./glass";
import { I18n } from "./i18n";
import type { Metadata } from "next";
import "./globals.css";
import "./glass.css";

export const metadata: Metadata = {
  title: "Synchro",
  description: "Synchro clone UI",
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
