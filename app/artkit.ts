// Bộ CSS cho khung artifact: model viết ít CSS hơn, kết quả đồng đều (chữ, lưới 8pt, bề mặt nhuộm màu, hiệu ứng, chuyển động, in ấn).
// Chỉ chèn vào trang có dùng lớp sx-… hoặc data-sx-preset (usesKit): artifact cũ giữ nguyên từng byte, trang không dùng không tốn gì.
// Vì sao không bọc @layer: model hay viết *{margin:0;padding:0}, CSS ngoài layer thắng mọi layer nên .sx-card sẽ mất padding mà không ai biết.
// Một lớp đơn (0,1,0) thắng "*" và preflight của Tailwind; chèn đầu <head> nên CSS của model cùng độ đặc hiệu viết sau vẫn thắng.
// Mọi cỡ tính theo --sx-u: 1px ở trang thường; trong slide, poster là phần nhỏ hơn của chiều rộng và chiều cao, vì khung xem trước, trình chiếu, ảnh thu nhỏ, tệp tải về mở ở cửa sổ bất kỳ có cỡ khác nhau: khung giữ đúng tỉ lệ, không bị cắt đáy, không sinh thanh cuộn. Canh giữa bằng translate (phần trăm theo chính khung), không bằng margin: model tự đặt lại width:100vw thì khung vẫn đúng chỗ.
// Màu chữ luôn là mã màu thuần, chỉ nền và viền dùng color-mix: bộ xuất PowerPoint đọc màu chữ từ getComputedStyle.
import { DEFAULT_PRESET, FONT_SPEC, PRESETS, presetOf, type PresetColors } from "./designpresets";

// Không đụng data-sx-loc, data-sx-on… của Synchro (đứng sau dấu "-"), chỉ nhận lớp thật, biến thật, và thuộc tính preset.
export const usesKit = (content: string) => /["'`\s.]sx-[a-z]|var\(--sx-|data-sx-preset=/.test(content);

const colorVars = (c: PresetColors) => `--sx-bg:${c.bg};--sx-surface:${c.surface};--sx-raised:${c.raised};--sx-ink:${c.ink};--sx-muted:${c.muted};--sx-accent:${c.accent};--sx-accent2:${c.accent2};--sx-line:${c.line};--sx-neutral:${c.neutral};--sx-pos:${c.pos};--sx-neg:${c.neg};`;
const presetCss = PRESETS.map((p) => {
  const vars = `${colorVars(p)}--sx-bw:${p.bw};--sx-r:${p.r};--sx-ri:${p.ri};--sx-shadow:${p.shadow};--sx-blur:${p.blur}px;${p.lh ? `--sx-lh:${p.lh};` : ""}--sx-head:${FONT_SPEC[p.head].stack};--sx-body:${FONT_SPEC[p.body].stack};--sx-mono:${FONT_SPEC[p.mono].stack};`;
  // Chỉ màn hình: in ra luôn dùng bảng sáng, dù máy đang ở chế độ tối.
  return `[data-sx-preset=${p.id}]{${vars}}${p.dark ? `@media screen and (prefers-color-scheme:dark){[data-sx-preset=${p.id}][data-sx-theme=auto],[data-sx-theme=auto] [data-sx-preset=${p.id}]{${colorVars(p.dark)}}}` : ""}`;
}).join("");
const base = presetOf(DEFAULT_PRESET)!;

// u(24) → calc(24*var(--sx-u)): cỡ theo thang 1280 trong slide, đúng px ở trang thường.
const u = (n: number | string) => `calc(${n}*var(--sx-u))`;
const fs = (t: string) => `font-size:${u(`var(--sx-fs-${t})`)}`;
const GAPS = [8, 16, 24, 32, 48, 64];
const NOT_FIXED = `html:not(:has(.sx-slide,.slide,[data-slide],.sx-poster))`; // trang đọc, in được, co lại trên điện thoại; slide và poster là hình cố định

const CSS = `:root{--sx-u:1px;--sx-fs-xs:12;--sx-fs-sm:14;--sx-fs-md:16;--sx-fs-lg:21;--sx-fs-xl:28;--sx-fs-2xl:38;--sx-fs-3xl:56;--sx-fs-kpi:56;--sx-ease:cubic-bezier(.16,1,.3,1);--sx-spring:cubic-bezier(.34,1.56,.64,1);${colorVars(base)}--sx-bw:${base.bw};--sx-r:${base.r};--sx-ri:${base.ri};--sx-shadow:${base.shadow};--sx-blur:${base.blur}px;--sx-head:${FONT_SPEC[base.head].stack};--sx-body:${FONT_SPEC[base.body].stack};--sx-mono:${FONT_SPEC[base.mono].stack}}
${presetCss}
html,body{margin:0}
*,*::before,*::after{box-sizing:border-box}
body{background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body);${fs("md")};line-height:1.55;-webkit-font-smoothing:antialiased;print-color-adjust:exact;-webkit-print-color-adjust:exact}
h1,h2,h3,h4{text-wrap:balance;font-variant-numeric:lining-nums}p,li{text-wrap:pretty}
table,th,td{font-variant-numeric:tabular-nums lining-nums}
.sx-slide,:where(section.slide,[data-slide]){--sx-u:min(calc(100vw/1280),calc(100vh/720));--sx-fs-xs:14;--sx-fs-sm:16;--sx-fs-md:20;--sx-fs-lg:26;--sx-fs-xl:44;--sx-fs-2xl:56;--sx-fs-3xl:80;--sx-fs-kpi:96;width:${u(1280)};height:${u(720)};translate:max(0px,calc((100vw - 100%)/2)) max(0px,calc((100vh - 100%)/2));padding:${u(56)} ${u(64)};display:flex;flex-direction:column;gap:${u(24)};overflow:hidden;background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body);${fs("md")};line-height:1.45}
.sx-page{--sx-fs-kpi:44;--sx-fs-3xl:44;width:100%;max-width:794px;margin:0 auto;padding:${u(48)};display:flex;flex-direction:column;gap:${u(24)}}
.sx-poster{--sx-u:min(calc(100vw/1080),calc(100vh/1440));--sx-fs-xs:20;--sx-fs-sm:24;--sx-fs-md:30;--sx-fs-lg:40;--sx-fs-xl:64;--sx-fs-2xl:96;--sx-fs-3xl:152;--sx-fs-kpi:200;width:min(100%,${u(1080)});aspect-ratio:3/4;margin-inline:auto;translate:0 max(0px,calc((100vh - 100%)/2));padding:${u(72)};display:flex;flex-direction:column;gap:${u(32)};overflow:hidden;position:relative;background:var(--sx-bg);color:var(--sx-ink)}
div[data-sx-preset]{min-height:100vh;background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body)}
.sx-eyebrow{font-family:var(--sx-mono);${fs("xs")};font-weight:600;line-height:1.4;text-transform:uppercase;letter-spacing:.08em;color:var(--sx-accent);margin:0}
.sx-title{font-family:var(--sx-head);${fs("xl")};font-weight:700;line-height:var(--sx-lh,1.2);letter-spacing:-.02em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-display{font-family:var(--sx-head);${fs("3xl")};font-weight:800;line-height:var(--sx-lh,1.2);letter-spacing:-.025em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-kicker{${fs("md")};line-height:1.45;color:var(--sx-muted);text-wrap:pretty;margin:0}
.sx-h2{font-family:var(--sx-head);${fs("lg")};font-weight:700;line-height:1.3;letter-spacing:-.01em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-h3{font-family:var(--sx-head);${fs("md")};font-weight:600;line-height:1.35;font-variant-numeric:lining-nums;margin:0}
.sx-text{${fs("md")};line-height:1.55;text-wrap:pretty;max-width:68ch;margin:0}
.sx-small{${fs("sm")};line-height:1.5;color:var(--sx-muted);margin:0}
.sx-source{${fs("xs")};line-height:1.4;color:var(--sx-muted);margin:0}
.sx-kpi{font-family:var(--sx-head);${fs("kpi")};font-weight:800;line-height:1.15;letter-spacing:-.03em;font-variant-numeric:tabular-nums lining-nums;margin:0}
.sx-num{font-variant-numeric:tabular-nums lining-nums}
.sx-mono{font-family:var(--sx-mono)}.sx-muted{color:var(--sx-muted)}.sx-accent{color:var(--sx-accent)}.sx-up{color:var(--sx-pos)}.sx-down{color:var(--sx-neg)}
.sx-stack{display:flex;flex-direction:column;gap:${u(16)};min-width:0}.sx-row{display:flex;flex-wrap:wrap;align-items:center;gap:${u(16)};min-width:0}.sx-between{justify-content:space-between}.sx-grow{flex:1 1 0;min-height:0;min-width:0}.sx-end{margin-top:auto}
${GAPS.map((g) => `.sx-gap-${g}{gap:${u(g)}}.sx-p-${g}{padding:${u(g)}}`).join("")}
.sx-grid-hero,.sx-grid-4060,.sx-grid-6040,.sx-grid-bento4,.sx-grid-dash,.sx-grid-3{display:grid;gap:${u(24)};min-height:0}
.sx-grid-hero>*,.sx-grid-4060>*,.sx-grid-6040>*,.sx-grid-bento4>*,.sx-grid-dash>*,.sx-grid-3>*{min-width:0;min-height:0}
.sx-grid-hero{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}.sx-grid-hero>:first-child{grid-row:span 2}
.sx-grid-4060{grid-template-columns:minmax(0,4fr) minmax(0,6fr)}.sx-grid-6040{grid-template-columns:minmax(0,6fr) minmax(0,4fr)}
.sx-grid-bento4{grid-template-columns:repeat(12,minmax(0,1fr))}.sx-grid-bento4>:nth-child(4n+1),.sx-grid-bento4>:nth-child(4n){grid-column:span 7}.sx-grid-bento4>:nth-child(4n+2),.sx-grid-bento4>:nth-child(4n+3){grid-column:span 5}
.sx-grid-dash{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:auto minmax(0,1fr)}.sx-grid-dash>:nth-child(n+5){grid-column:1/-1}
.sx-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.sx-card{--sx-pad:${u(24)};background:var(--sx-surface);border:${u("var(--sx-bw)")} solid var(--sx-line);border-radius:${u("var(--sx-r)")};padding:var(--sx-pad);box-shadow:var(--sx-shadow);display:flex;flex-direction:column;gap:${u(8)};min-width:0}
.sx-inner{border-radius:max(0px,calc(${u("var(--sx-r)")} - var(--sx-pad)));overflow:hidden}
.sx-tint{background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 8%,var(--sx-surface))}
.sx-solid{background:var(--sx-accent);color:var(--sx-bg);border-color:transparent}
.sx-badge{display:inline-flex;align-items:center;width:fit-content;padding:${u(4)} ${u(10)};border-radius:999px;${fs("xs")};font-weight:600;line-height:1.3;color:var(--sx-accent);background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 12%,var(--sx-surface));border:${u(1)} solid var(--sx-line);border-color:color-mix(in oklab,var(--sx-accent) 28%,var(--sx-surface))}
.sx-callout{padding:${u(16)} ${u(20)};border-left:${u(3)} solid var(--sx-accent);background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 6%,var(--sx-surface));border-radius:0 ${u("var(--sx-ri)")} ${u("var(--sx-ri)")} 0}
.sx-rule{border:0;border-top:${u(1)} solid var(--sx-line);margin:0;width:100%}
.sx-table{width:100%;border-collapse:collapse;${fs("sm")};line-height:1.4}
.sx-table th{text-align:left;font-weight:600;color:var(--sx-muted);padding:${u(8)} ${u(12)};border-bottom:${u(1)} solid var(--sx-ink)}
.sx-table td{padding:${u(8)} ${u(12)};border-bottom:${u(1)} solid var(--sx-line)}
.sx-table .n{text-align:right;white-space:nowrap}
.sx-total td{font-weight:700;border-top:${u(1)} solid var(--sx-ink);border-bottom:${u(3)} double var(--sx-ink)}
.sx-bar{background-image:linear-gradient(90deg,var(--sx-raised) var(--sx-v,0%),transparent 0);background-image:linear-gradient(90deg,color-mix(in oklab,var(--sx-accent) 18%,var(--sx-surface)) var(--sx-v,0%),transparent 0)}
.sx-shadow{box-shadow:0 1px 2px -1px rgba(15,23,42,.04),0 8px 16px -4px rgba(15,23,42,.06),0 24px 48px -12px rgba(15,23,42,.08)}
.sx-rim{border:${u(1)} solid rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 16px 32px -8px rgba(0,0,0,.5)}
.sx-glass{background:rgba(255,255,255,.6);background:color-mix(in oklab,var(--sx-surface) 62%,transparent);backdrop-filter:blur(var(--sx-blur,16px)) saturate(160%);-webkit-backdrop-filter:blur(var(--sx-blur,16px)) saturate(160%)}
.sx-aurora{background-color:var(--sx-bg);background-image:radial-gradient(at 15% 15%,color-mix(in oklab,var(--sx-accent) 22%,transparent) 0,transparent 55%),radial-gradient(at 85% 20%,color-mix(in oklab,var(--sx-accent2) 18%,transparent) 0,transparent 50%),radial-gradient(at 50% 85%,color-mix(in oklab,var(--sx-accent) 12%,transparent) 0,transparent 60%)}
.sx-noise{position:relative}.sx-noise::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.03;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes sx-rise{from{opacity:0;transform:translateY(calc(14*var(--sx-u)))}}
@keyframes sx-fade{from{opacity:0}}
@keyframes sx-pop{from{opacity:0;transform:scale(.96)}}
@keyframes sx-draw{from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}}
.sx-rise,.sx-fade,.sx-pop{animation:sx-rise .6s var(--sx-ease) backwards;animation-delay:calc(var(--sx-i,0)*70ms)}.sx-fade{animation-name:sx-fade}.sx-pop{animation-name:sx-pop;animation-timing-function:var(--sx-spring)}
.sx-draw{animation:sx-draw 1.2s var(--sx-ease) backwards;animation-delay:calc(var(--sx-i,0)*70ms)}
@media (prefers-reduced-motion:reduce){.sx-rise,.sx-fade,.sx-pop,.sx-draw{animation:none!important}}
@media (max-width:640px){${NOT_FIXED} :is(.sx-grid-hero,.sx-grid-4060,.sx-grid-6040,.sx-grid-bento4,.sx-grid-dash,.sx-grid-3){grid-template-columns:minmax(0,1fr);grid-template-rows:none}${NOT_FIXED} :is(.sx-grid-hero,.sx-grid-bento4,.sx-grid-dash)>*{grid-row:auto;grid-column:auto}${NOT_FIXED} .sx-page{padding:${u(24)}}${NOT_FIXED} .sx-table{display:block;overflow-x:auto}${NOT_FIXED} .sx-table :is(th,td){padding:${u(8)} ${u(6)}}${NOT_FIXED} .sx-table th{white-space:normal}${NOT_FIXED} .sx-table :is(th,td):first-child{min-width:${u(104)}}}
@page sx-a4{size:A4;margin:20mm 18mm;@bottom-right{content:counter(page) " / " counter(pages);font:9pt Arial,sans-serif;color:#64748b}}
@page sx-poster{margin:0}
@media print{.sx-rise,.sx-fade,.sx-pop,.sx-draw{animation:none!important}
${NOT_FIXED},${NOT_FIXED} [data-sx-preset]{--sx-bg:#fff;--sx-surface:#fff;--sx-raised:#f5f5f4;--sx-ink:#111827;--sx-muted:#475569;--sx-line:#d4d4d8}
${PRESETS.filter((p) => p.print).map((p) => `${NOT_FIXED}[data-sx-preset=${p.id}],${NOT_FIXED} [data-sx-preset=${p.id}]{${Object.entries(p.print!).map(([k, v]) => `--sx-${k}:${v}`).join(";")}}`).join("")}
${NOT_FIXED} :is(.sx-shadow,.sx-rim,.sx-card){box-shadow:none}${NOT_FIXED} .sx-glass{backdrop-filter:none;-webkit-backdrop-filter:none}${NOT_FIXED} .sx-noise::after{display:none}${NOT_FIXED} .sx-aurora{background-image:none}
.sx-page{--sx-fs-xs:11;--sx-fs-sm:12.5;--sx-fs-md:14.67;--sx-fs-lg:18.67;--sx-fs-xl:25;--sx-fs-2xl:32;--sx-fs-3xl:38;--sx-fs-kpi:34;page:sx-a4;max-width:none;padding:0;gap:${u(16)};${fs("md")}}
.sx-poster{page:sx-poster;width:100vw;height:100vh;aspect-ratio:auto;margin:0;translate:none}
.sx-slide,:where(section.slide,[data-slide]){translate:none}
h1,h2,h3,h4,.sx-title,.sx-h2,.sx-h3,.sx-eyebrow{break-after:avoid-page}p,li{orphans:3;widows:3}
.sx-card,.sx-callout,figure,tr,.sx-keep{break-inside:avoid}.sx-table:not(.sx-long){break-inside:avoid}thead{display:table-header-group}}`;

/** Đường dẫn Google Fonts chỉ gồm các phông trang dùng: khung cho phép fonts.googleapis.com và fonts.gstatic.com (csp ở artdoc.ts). */
export function kitFontUrl(content: string): string {
  const ids = [...content.matchAll(/data-sx-preset=["']?([\w-]+)/g)].map((m) => m[1]).filter((i) => presetOf(i));
  const used = ids.length ? ids : [DEFAULT_PRESET];
  const names = new Set(used.flatMap((i) => { const p = presetOf(i)!; return [p.head, p.body, p.mono]; }));
  return `https://fonts.googleapis.com/css2?${[...names].map((n) => `family=${FONT_SPEC[n].css}`).join("&")}&display=swap`;
}
/** Phần chèn vào <head> của trang có dùng bộ CSS; trang không dùng thì rỗng. */
// Nạp phông sau sự kiện load, không dùng <link> trong <head>: thẻ đó chặn lần vẽ đầu, mạng treo (tường lửa, gói tin bị bỏ) thì trang trắng tới khi yêu cầu hết giờ. Kể cả media="print" cũng giữ
// sự kiện load, khung không báo được chiều cao. Phông là phần thêm, chữ phải hiện trước; font-display:swap đổi phông khi tải xong.
export const kitHead = (content: string) => {
  if (!usesKit(content)) return "";
  const url = kitFontUrl(content);
  return `<script>addEventListener("load",function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(url)};l.setAttribute("data-sx-font","");document.head.appendChild(l)})</script><noscript><link rel="stylesheet" href="${url.replace(/&/g, "&amp;")}"></noscript><style data-sx-kit>${CSS}</style>`;
};
export const KIT_CSS = CSS;
/** Để lấy phông nhúng khi chụp ảnh / xuất PowerPoint (artfonts.ts tìm đường dẫn Google Fonts trong chữ của trang). */
export const withKitFontLink = (content: string) => (usesKit(content) ? `${content}\n<!-- ${kitFontUrl(content)} -->` : content);
