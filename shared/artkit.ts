// Bộ CSS cho khung artifact: model viết ít CSS hơn, kết quả đồng đều (chữ, lưới 8pt, bề mặt nhuộm màu, hiệu ứng, chuyển động, in ấn).
// Chỉ chèn vào trang có dùng lớp sx-… hoặc data-sx-preset (usesKit): artifact cũ giữ nguyên từng byte, trang không dùng không tốn gì.
// Vì sao không bọc @layer: model hay viết *{margin:0;padding:0}, CSS ngoài layer thắng mọi layer nên .sx-card sẽ mất padding mà không ai biết.
// Một lớp đơn (0,1,0) thắng "*" và preflight của Tailwind; chèn đầu <head> nên CSS của model cùng độ đặc hiệu viết sau vẫn thắng.
// Mọi cỡ tính theo --sx-u: 1px ở trang thường; trong slide, poster là phần nhỏ hơn của chiều rộng và chiều cao, vì khung xem trước, trình chiếu, ảnh thu nhỏ, tệp tải về mở ở cửa sổ bất kỳ có cỡ khác nhau: khung giữ đúng tỉ lệ, không bị cắt đáy, không sinh thanh cuộn. Canh giữa bằng translate (phần trăm theo chính khung), không bằng margin: model tự đặt lại width:100vw thì khung vẫn đúng chỗ.
// Màu chữ luôn là mã màu thuần, chỉ nền và viền dùng color-mix: bộ xuất PowerPoint đọc màu chữ từ getComputedStyle.
import { DEFAULT_PRESET, FONT_SPEC, PRESETS, presetIds, presetOf, type Preset, type PresetColors } from "./designpresets";
import { chartKitJs } from "./design-engine/charts/echarts-presets";
import { CHART_CSS } from "./designcharts";
import { DOC_TPL_CSS } from "./designdocs";
import { SLIDE_TPL_CSS } from "./designtemplates";
import { TITLE_FLOOR, TITLE_SEL, TYPE_ELS_JS, TYPE_RATIO } from "./deckfit";

// Không đụng data-sx-loc, data-sx-on… của Synchro (đứng sau dấu "-"), chỉ nhận lớp thật, biến thật, và thuộc tính preset.
// Tên lớp trong master-microcraft.css / visual-fx.css của chủ dự án (typo-…, fx-…, anim-stagger-card) cũng nhận: đều là tên riêng, trang cũ không tình cờ dùng.
export const usesKit = (content: string) => /["'`\s.]sx-[a-z]|var\(--sx-|data-sx-preset=|["'`\s.](?:typo-(?:hero-kpi|action-title|eyebrow)|fx-(?:ambient-shadow|specular-rim|frosted-glass|aurora-bg|film-grain|gradient-text)|anim-stagger-card|surface-tinted-badge|bento-grid-hero-left|concentric-(?:outer|inner))\b|data-sx-(?:chart|shader)\b/.test(content);
const VENDOR = "/vendor/";
/** Apache ECharts 6.1.0 (Apache-2.0), bản dist nguyên vẹn từ npm: [tệp trong public/vendor, đường dẫn jsDelivr, SRI]. Chỉ nạp khi trang có biểu đồ (data-sx-chart) hoặc import "echarts". */
export const ECHARTS: [string, string, string] = ["echarts-6.1.0.min.js", "echarts@6.1.0/dist/echarts.min.js", "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD"];
// Trang có biểu đồ ECharts (data-sx-chart chứa cấu hình JSON). Biểu đồ SVG điền sẵn của designcharts.ts cũng mang data-sx-chart="bar" (tên loại, đã vẽ xong) nên không nạp ECharts.
const ECHARTS_ON = /data-sx-chart(?!=["'](?:bar|column|line|area|doughnut|donut|pie|waterfall|sankey|radar)["'])/;
/** Gói 3D tự dựng (tools/build-vendor-3d.mjs: three 0.169.0, @react-three/fiber 8.18.0, drei 9.122.0, @shadergradient/react 2.4.20): chỉ có ở /vendor của Synchro, không có bản CDN. */
export const SYNCHRO_3D: [string, string, string] = ["synchro-3d-1.0.0.js", "", "sha384-HmyfO5IR9ZCEqYGNwKGFjko0PIXroYlObNS9VE8cyS8cMOUXQ25uiSvJHEzMeVmJ"];
const REACT_UMD: [string, string, string][] = [
  ["react-18.3.1.min.js", "react@18.3.1/umd/react.production.min.js", "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"],
  ["react-dom-18.3.1.min.js", "react-dom@18.3.1/umd/react-dom.production.min.js", "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"],
];
// Màu cực quang dự phòng của nền shader (cùng bộ thông số sóng lụa của chủ dự án): hiện ngay khi trang mở, khi không có WebGL, và trong ảnh xuất nếu canvas chưa kịp vẽ.
const SHADER_FALLBACK = "radial-gradient(ellipse 70% 60% at 22% 30%,#4F46E5cc 0%,transparent 62%),radial-gradient(ellipse 60% 55% at 78% 26%,#0EA5E999 0%,transparent 60%),radial-gradient(ellipse 75% 65% at 62% 88%,#10B98188 0%,transparent 64%),linear-gradient(160deg,#08090E 0%,#0F172A 100%)";
/**
 * Nền shader 3D trong trang HTML: <div class="sx-shader" data-sx-shader="silk"></div> (đầu khối, nội dung phía sau tự nằm trên) hoặc data-sx-shader="glass" (khối kính khúc xạ).
 * Nạp React, ReactDOM (nếu trang chưa có) rồi gói 3D từ /vendor với SRI, chỉ khi trang có phần tử đó. Ảnh thu nhỏ của bản trình bày (window.__sxStatic lúc mở trang) không nạp:
 * chỉ hiện lớp CSS dự phòng, không tốn ngữ cảnh WebGL. In (PDF): canvas WebGL đổi tạm thành ảnh của chính nó.
 */
const shaderKitJs = (origin: string) => String.raw`(function(){var R=${JSON.stringify(REACT_UMD.map((l) => libAt(origin, l)))},G=${JSON.stringify([origin ? `${origin}${VENDOR}${SYNCHRO_3D[0]}` : "", SYNCHRO_3D[2]])},busy=0,q=[];
function one(u,sri,cb){if(!u)return cb(false);var s=document.createElement("script");s.src=u;s.crossOrigin="anonymous";s.integrity=sri;s.onload=function(){cb(true)};s.onerror=function(){s.remove();cb(false)};document.head.appendChild(s)}
function lib(l,cb){one(l[0],l[2],function(ok){if(ok)return cb(true);one(l[1],l[2],cb)})}
function load(cb){if(window.Synchro3D)return cb();q.push(cb);if(busy)return;busy=1;
if(window.__sxReact){var n=0,t=setInterval(function(){if(window.Synchro3D||++n>300){clearInterval(t);var f=q;q=[];if(window.Synchro3D)f.forEach(function(x){x()})}},200);return}
var steps=[];if(!window.React)steps.push(function(n){lib(R[0],n)});if(!window.ReactDOM)steps.push(function(n){lib(R[1],n)});steps.push(function(n){one(G[0],G[1],n)});
(function next(i){if(i>=steps.length){var f=q;q=[];if(window.Synchro3D)f.forEach(function(x){x()});return}steps[i](function(ok){if(!ok){document.documentElement.setAttribute("data-sx-3d-error","");return}next(i+1)})})(0)}
function scan(){var els=[].slice.call(document.querySelectorAll("[data-sx-shader]")).filter(function(e){return !e.__sx3d});if(!els.length)return;
if(window.__sxThumb)return;
load(function(){els.forEach(function(e){e.__sx3d=1;var k=e.getAttribute("data-sx-shader");var o={};try{o=JSON.parse(e.getAttribute("data-sx-shader-props")||"{}")}catch(x){}window.Synchro3D.mount(e,k==="glass"?"glass":"silk",o)})})}
var swapped=[];addEventListener("beforeprint",function(){[].forEach.call(document.querySelectorAll("canvas[data-sx-gl]"),function(c){try{var u=c.toDataURL("image/png"),i=new Image();i.src=u;i.setAttribute("data-sx-gl-print","");i.style.cssText="position:absolute;inset:0;width:100%;height:100%";c.parentNode.insertBefore(i,c);c.style.visibility="hidden";swapped.push([c,i])}catch(x){}})});
addEventListener("afterprint",function(){swapped.forEach(function(p){p[0].style.visibility="";p[1].remove()});swapped=[]});
function start(){scan();if(window.MutationObserver)new MutationObserver(scan).observe(document.body,{subtree:true,childList:true})}
if(document.readyState==="loading")addEventListener("DOMContentLoaded",start);else start()})();`;
const libAt = (origin: string, l: [string, string, string]): [string, string, string] => [origin ? `${origin}${VENDOR}${l[0]}` : `https://cdn.jsdelivr.net/npm/${l[1]}`, `https://cdn.jsdelivr.net/npm/${l[1]}`, l[2]];

// --sx-vivid / --sx-vivid2: màu nhấn gốc của bảng phong cách cho phần không phải chữ (cột được nhấn, quầng cực quang); bảng tối dùng luôn màu nhấn của nó.
const colorVars = (c: PresetColors, p?: Preset) => `--sx-bg:${c.bg};--sx-surface:${c.surface};--sx-raised:${c.raised};--sx-ink:${c.ink};--sx-muted:${c.muted};--sx-accent:${c.accent};--sx-accent2:${c.accent2};--sx-line:${c.line};--sx-neutral:${c.neutral};--sx-pos:${c.pos};--sx-neg:${c.neg};--sx-vivid:${p?.vivid ?? c.accent};--sx-vivid2:${p?.vivid2 ?? c.accent2};`;
// Bộ chọn của một phong cách gồm cả mã theo bảng của chủ dự án (PRESET_ALIASES): trang viết data-sx-preset="linear-dark" vẫn đúng màu.
const sel = (id: string, f: (x: string) => string) => presetIds(id).map(f).join(",");
const presetCss = PRESETS.map((p) => {
  const vars = `${colorVars(p, p)}--sx-bw:${p.bw};--sx-r:${p.r};--sx-ri:${p.ri};--sx-shadow:${p.shadow};--sx-blur:${p.blur}px;${p.lh ? `--sx-lh:${p.lh};` : ""}--sx-head:${FONT_SPEC[p.head].stack};--sx-body:${FONT_SPEC[p.body].stack};--sx-mono:${FONT_SPEC[p.mono].stack};`;
  // Chỉ màn hình: in ra luôn dùng bảng sáng, dù máy đang ở chế độ tối.
  return `${sel(p.id, (x) => `[data-sx-preset=${x}]`)}{${vars}}${p.dark ? `@media screen and (prefers-color-scheme:dark){${sel(p.id, (x) => `[data-sx-preset=${x}][data-sx-theme=auto],[data-sx-theme=auto] [data-sx-preset=${x}]`)}{${colorVars(p.dark)}}}` : ""}`
    // Phong cách kính: thẻ là kính trắng trong mờ trên nền cực quang (chỉ màn hình; in và xuất PowerPoint giữ nền đặc của thẻ).
    + (p.glass ? `@media screen{${sel(p.id, (x) => `[data-sx-preset=${x}] .sx-card:not(.sx-solid,.sx-tint)`)}{background:color-mix(in oklab,var(--sx-surface) 65%,transparent);backdrop-filter:blur(var(--sx-blur)) saturate(160%);-webkit-backdrop-filter:blur(var(--sx-blur)) saturate(160%)}}` : "");
}).join("");
const base = presetOf(DEFAULT_PRESET)!;

// u(24) → calc(24*var(--sx-u)): cỡ theo thang 1280 trong slide, đúng px ở trang thường.
const u = (n: number | string) => `calc(${n}*var(--sx-u))`;
const fs = (t: string) => `font-size:${u(`var(--sx-fs-${t})`)}`;
const GAPS = [8, 16, 24, 32, 48, 64];
const NOT_FIXED = `html:not(:has(.sx-slide,.slide,[data-slide],.sx-poster,.sx-og))`; // trang đọc, in được, co lại trên điện thoại; slide, poster, ảnh chia sẻ là hình cố định
// Biến theo tên trong master-microcraft.css / visual-fx.css của chủ dự án, trỏ về biến của bộ thiết kế: CSS viết theo bảng đó chạy đúng trong mọi phong cách.
// Khai báo lại ở mỗi khung (slide, poster, trang A4) vì thang chữ đổi theo khung; var() lồng nhau tính tại phần tử khai báo.
const OWNER_VARS = `:root,[data-sx-preset],.sx-slide,.sx-poster,.sx-page{--text-xs:${u("var(--sx-fs-xs)")};--text-sm:${u("var(--sx-fs-sm)")};--text-base:${u("var(--sx-fs-md)")};--text-lg:${u("var(--sx-fs-lg)")};--text-xl:${u("var(--sx-fs-xl)")};--text-2xl:${u("var(--sx-fs-2xl)")};--text-kpi:${u("var(--sx-fs-kpi)")};--bg-canvas:var(--sx-bg);--bg-surface:var(--sx-surface);--text-primary:var(--sx-ink);--text-secondary:var(--sx-muted);--accent-primary:var(--sx-accent);--accent-secondary:var(--sx-accent2);--border-color:var(--sx-line);--font-heading:var(--sx-head);--font-body:var(--sx-body);--font-mono:var(--sx-mono);--radius-outer:${u("var(--sx-r)")};--radius-inner:${u("var(--sx-ri)")};--backdrop-blur:var(--sx-blur);--ease-out-expo:var(--sx-ease);--ease-spring:var(--sx-spring)}`; // trang đọc, in được, co lại trên điện thoại; slide và poster là hình cố định

const CSS = `:root{--sx-u:1px;--sx-fs-xs:12;--sx-fs-sm:14;--sx-fs-md:16;--sx-fs-lg:21;--sx-fs-xl:28;--sx-fs-2xl:38;--sx-fs-3xl:56;--sx-fs-kpi:60;--sx-ease:cubic-bezier(.16,1,.3,1);--sx-spring:cubic-bezier(.34,1.56,.64,1);${colorVars(base, base)}--sx-bw:${base.bw};--sx-r:${base.r};--sx-ri:${base.ri};--sx-shadow:${base.shadow};--sx-blur:${base.blur}px;--sx-head:${FONT_SPEC[base.head].stack};--sx-body:${FONT_SPEC[base.body].stack};--sx-mono:${FONT_SPEC[base.mono].stack}}
${presetCss}
${OWNER_VARS}
html,body{margin:0}
*,*::before,*::after{box-sizing:border-box}
body{background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body);${fs("md")};line-height:1.55;-webkit-font-smoothing:antialiased;print-color-adjust:exact;-webkit-print-color-adjust:exact}
h1,h2,h3,h4{text-wrap:balance;font-variant-numeric:lining-nums}p,li{text-wrap:pretty}
table,th,td{font-variant-numeric:tabular-nums lining-nums}
.sx-slide,:where(section.slide,[data-slide]){--sx-u:min(calc(100vw/1280),calc(100vh/720));--sx-fs-xs:14;--sx-fs-sm:16;--sx-fs-md:20;--sx-fs-lg:26;--sx-fs-xl:44;--sx-fs-2xl:56;--sx-fs-3xl:80;--sx-fs-kpi:96;width:${u(1280)};height:${u(720)};translate:max(0px,calc((100vw - 100%)/2)) max(0px,calc((100vh - 100%)/2));padding:${u(56)} ${u(64)};display:flex;flex-direction:column;gap:${u(24)};overflow:hidden;background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body);${fs("md")};line-height:1.45}
.sx-page{--sx-fs-kpi:44;--sx-fs-3xl:44;width:100%;max-width:794px;margin:0 auto;padding:${u(48)};display:flex;flex-direction:column;gap:${u(24)}}
.sx-poster{--sx-u:min(calc(100vw/1080),calc(100vh/1440));--sx-fs-xs:20;--sx-fs-sm:24;--sx-fs-md:30;--sx-fs-lg:40;--sx-fs-xl:64;--sx-fs-2xl:96;--sx-fs-3xl:152;--sx-fs-kpi:200;width:min(100%,${u(1080)});aspect-ratio:3/4;margin-inline:auto;translate:0 max(0px,calc((100vh - 100%)/2));padding:${u(72)};display:flex;flex-direction:column;gap:${u(32)};overflow:hidden;position:relative;background:var(--sx-bg);color:var(--sx-ink)}
.sx-og{--sx-u:min(calc(100vw/1200),calc(100vh/630));--sx-fs-xs:16;--sx-fs-sm:18;--sx-fs-md:22;--sx-fs-lg:28;--sx-fs-xl:44;--sx-fs-2xl:60;--sx-fs-3xl:72;--sx-fs-kpi:96;width:min(100%,${u(1200)});aspect-ratio:1200/630;margin-inline:auto;translate:0 max(0px,calc((100vh - 100%)/2));padding:${u(64)};display:flex;flex-direction:column;justify-content:space-between;gap:${u(24)};overflow:hidden;position:relative;background:var(--sx-bg);color:var(--sx-ink)}
div[data-sx-preset]{min-height:100vh;background:var(--sx-bg);color:var(--sx-ink);font-family:var(--sx-body)}
.sx-eyebrow,.typo-eyebrow{font-family:var(--sx-mono);${fs("xs")};font-weight:600;line-height:1.4;text-transform:uppercase;letter-spacing:.1em;color:var(--sx-accent);margin:0}
.sx-title,.typo-action-title{font-family:var(--sx-head);${fs("xl")};font-weight:700;line-height:var(--sx-lh,1.2);letter-spacing:-.02em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-display{font-family:var(--sx-head);${fs("3xl")};font-weight:800;line-height:var(--sx-lh,1.2);letter-spacing:-.025em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-kicker{${fs("md")};line-height:1.45;color:var(--sx-muted);text-wrap:pretty;margin:0}
.sx-h2{font-family:var(--sx-head);${fs("lg")};font-weight:700;line-height:1.3;letter-spacing:-.01em;text-wrap:balance;font-variant-numeric:lining-nums;margin:0}
.sx-h3{font-family:var(--sx-head);${fs("md")};font-weight:600;line-height:1.35;font-variant-numeric:lining-nums;margin:0}
.sx-text,.body-copy{${fs("md")};line-height:1.55;text-wrap:pretty;max-width:68ch;margin:0}
.sx-small{${fs("sm")};line-height:1.5;color:var(--sx-muted);margin:0}
.sx-source{${fs("xs")};line-height:1.4;color:var(--sx-muted);margin:0}
.sx-kpi,.typo-hero-kpi{font-family:var(--sx-head);${fs("kpi")};font-weight:800;line-height:1.15;letter-spacing:-.03em;font-variant-numeric:tabular-nums lining-nums;margin:0}
.sx-num,.metric-num{font-variant-numeric:tabular-nums lining-nums}
.sx-mono{font-family:var(--sx-mono)}.sx-muted{color:var(--sx-muted)}.sx-accent{color:var(--sx-accent)}.sx-up{color:var(--sx-pos)}.sx-down{color:var(--sx-neg)}
.sx-stack{display:flex;flex-direction:column;gap:${u(16)};min-width:0}.sx-row{display:flex;flex-wrap:wrap;align-items:center;gap:${u(16)};min-width:0}.sx-between{justify-content:space-between}.sx-grow{flex:1 1 0;min-height:0;min-width:0}.sx-end{margin-top:auto}
${GAPS.map((g) => `.sx-gap-${g}{gap:${u(g)}}.sx-p-${g}{padding:${u(g)}}`).join("")}
.sx-grid-hero,.sx-grid-4060,.sx-grid-6040,.sx-grid-bento4,.sx-grid-dash,.sx-grid-3{display:grid;gap:${u(24)};min-height:0}
.sx-grid-hero>*,.sx-grid-4060>*,.sx-grid-6040>*,.sx-grid-bento4>*,.sx-grid-dash>*,.sx-grid-3>*{min-width:0;min-height:0}
.sx-grid-hero,.bento-grid-hero-left{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}:is(.sx-grid-hero,.bento-grid-hero-left)>:first-child{grid-row:span 2}.bento-grid-hero-left{display:grid;gap:${u(24)}}
.sx-grid-4060{grid-template-columns:minmax(0,4fr) minmax(0,6fr)}.sx-grid-6040{grid-template-columns:minmax(0,6fr) minmax(0,4fr)}
.sx-grid-bento4{grid-template-columns:repeat(12,minmax(0,1fr))}.sx-grid-bento4>:nth-child(4n+1),.sx-grid-bento4>:nth-child(4n){grid-column:span 7}.sx-grid-bento4>:nth-child(4n+2),.sx-grid-bento4>:nth-child(4n+3){grid-column:span 5}
.sx-grid-dash{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:auto minmax(0,1fr)}.sx-grid-dash>:nth-child(n+5){grid-column:1/-1}
.sx-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.sx-card{--sx-pad:${u(24)};background:var(--sx-surface);border:${u("var(--sx-bw)")} solid var(--sx-line);border-radius:${u("var(--sx-r)")};padding:var(--sx-pad);box-shadow:var(--sx-shadow);display:flex;flex-direction:column;gap:${u(8)};min-width:0}
.sx-inner{border-radius:max(0px,calc(${u("var(--sx-r)")} - var(--sx-pad)));overflow:hidden}
.sx-concentric,.concentric-outer{--sx-pad:${u(16)};padding:var(--sx-pad);border-radius:calc(${u("var(--sx-ri)")} + var(--sx-pad));background:var(--sx-surface)}.concentric-inner{border-radius:${u("var(--sx-ri)")};overflow:hidden}
.sx-tint{background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 8%,var(--sx-surface))}
.sx-solid{background:var(--sx-accent);color:var(--sx-bg);border-color:transparent}
.sx-badge,.surface-tinted-badge{display:inline-flex;align-items:center;width:fit-content;padding:${u(4)} ${u(10)};border-radius:999px;${fs("xs")};font-weight:600;line-height:1.3;color:var(--sx-accent);background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 12%,var(--sx-surface));border:${u(1)} solid var(--sx-line);border-color:color-mix(in oklab,var(--sx-accent) 28%,var(--sx-surface))}
.sx-callout{padding:${u(16)} ${u(20)};border-left:${u(3)} solid var(--sx-accent);background:var(--sx-raised);background:color-mix(in oklab,var(--sx-accent) 6%,var(--sx-surface));border-radius:0 ${u("var(--sx-ri)")} ${u("var(--sx-ri)")} 0}
.sx-rule{border:0;border-top:${u(1)} solid var(--sx-line);margin:0;width:100%}
.sx-table{width:100%;border-collapse:collapse;${fs("sm")};line-height:1.4}
.sx-table th{text-align:left;font-weight:600;color:var(--sx-muted);padding:${u(8)} ${u(12)};border-bottom:${u(1)} solid var(--sx-ink)}
.sx-table td{padding:${u(8)} ${u(12)};border-bottom:${u(1)} solid var(--sx-line)}
.sx-table .n{text-align:right;white-space:nowrap}
.sx-total td{font-weight:700;border-top:${u(1)} solid var(--sx-ink);border-bottom:${u(3)} double var(--sx-ink)}
.sx-bar{background-image:linear-gradient(90deg,var(--sx-raised) var(--sx-v,0%),transparent 0);background-image:linear-gradient(90deg,color-mix(in oklab,var(--sx-accent) 18%,var(--sx-surface)) var(--sx-v,0%),transparent 0)}
.sx-heat{background:var(--sx-raised);background:color-mix(in oklab,var(--sx-vivid) calc(var(--sx-v,0%)*.9),var(--sx-surface))}
${SLIDE_TPL_CSS}
${DOC_TPL_CSS}
${CHART_CSS}
.sx-gradient-text,.fx-gradient-text{color:var(--sx-ink);background:linear-gradient(135deg,var(--sx-ink) 20%,var(--sx-accent) 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sx-shadow,.fx-ambient-shadow{box-shadow:0 1px 2px -1px rgba(15,23,42,.04),0 8px 16px -4px rgba(15,23,42,.06),0 24px 48px -12px rgba(15,23,42,.08)}
.sx-rim,.fx-specular-rim{border:${u(1)} solid rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 16px 32px -8px rgba(0,0,0,.5)}
.sx-glass,.fx-frosted-glass{background:rgba(255,255,255,.6);background:color-mix(in oklab,var(--sx-surface) 62%,transparent);backdrop-filter:blur(var(--sx-blur,16px)) saturate(160%);-webkit-backdrop-filter:blur(var(--sx-blur,16px)) saturate(160%)}
.sx-aurora,.fx-aurora-bg{background-color:var(--sx-bg);background-image:radial-gradient(at 15% 15%,color-mix(in oklab,var(--sx-vivid) 24%,transparent) 0,transparent 55%),radial-gradient(at 85% 20%,color-mix(in oklab,var(--sx-vivid2) 18%,transparent) 0,transparent 50%),radial-gradient(at 50% 85%,color-mix(in oklab,var(--sx-vivid) 12%,transparent) 0,transparent 60%)}
.sx-noise,.fx-film-grain{position:relative}:is(.sx-noise,.fx-film-grain)::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.03;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.sx-shader,[data-sx-shader]:not([data-sx-shader=glass]){position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:${SHADER_FALLBACK};border-radius:inherit}
:where(.sx-slide,section.slide,[data-slide],.sx-poster,.sx-og,.sx-page,.sx-card,header,section,div):has(>.sx-shader,>[data-sx-shader]:not([data-sx-shader=glass])){position:relative;isolation:isolate}
:is(.sx-shader,[data-sx-shader]:not([data-sx-shader=glass]))~*{position:relative;z-index:1}
[data-sx-shader=glass]{position:relative;display:block;width:100%;height:${u(320)};min-height:0;pointer-events:none}
/* Khung biểu đồ ECharts (data-sx-chart='{…}'): không áp cho biểu đồ SVG điền sẵn <figure class="sx-chart"> của designcharts.ts. */
.sx-chart:not(figure){position:relative;display:block;width:100%;height:${u(320)};min-height:0;min-width:0}.sx-chart text{font-variant-numeric:tabular-nums lining-nums}
@keyframes sx-rise{from{opacity:0;transform:translateY(calc(14*var(--sx-u)))}}
@keyframes sx-fade{from{opacity:0}}
@keyframes sx-pop{from{opacity:0;transform:scale(.96)}}
@keyframes sx-draw{from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}}
.sx-rise,.sx-fade,.sx-pop,.anim-stagger-card{animation:sx-rise .6s var(--sx-ease) backwards;animation-delay:calc(var(--sx-i,var(--stagger-index,0))*70ms)}.sx-fade{animation-name:sx-fade}.sx-pop{animation-name:sx-pop;animation-timing-function:var(--sx-spring)}
.sx-draw{animation:sx-draw 1.2s var(--sx-ease) backwards;animation-delay:calc(var(--sx-i,0)*70ms)}
@media (prefers-reduced-motion:reduce){.sx-rise,.sx-fade,.sx-pop,.sx-draw,.anim-stagger-card{animation:none!important}}
@media (max-width:640px){${NOT_FIXED} :is(.sx-grid-hero,.sx-grid-4060,.sx-grid-6040,.sx-grid-bento4,.sx-grid-dash,.sx-grid-3){grid-template-columns:minmax(0,1fr);grid-template-rows:none}${NOT_FIXED} :is(.sx-grid-hero,.sx-grid-bento4,.sx-grid-dash)>*{grid-row:auto;grid-column:auto}${NOT_FIXED} .sx-page{padding:${u(24)}}${NOT_FIXED} .sx-table{display:block;overflow-x:auto}${NOT_FIXED} .sx-table :is(th,td){padding:${u(8)} ${u(6)}}${NOT_FIXED} .sx-table th{white-space:normal}${NOT_FIXED} .sx-table :is(th,td):first-child{min-width:${u(104)}}}
@page sx-a4{size:A4;margin:20mm 18mm;@bottom-right{content:counter(page) " / " counter(pages);font:9pt Arial,sans-serif;color:#64748b}}
@page sx-poster{margin:0}
@page sx-og{size:12.5in 6.5625in;margin:0}
@media print{.sx-rise,.sx-fade,.sx-pop,.sx-draw,.anim-stagger-card{animation:none!important}.sx-gradient-text,.fx-gradient-text{background:none;-webkit-text-fill-color:currentColor}
${NOT_FIXED},${NOT_FIXED} [data-sx-preset]{--sx-bg:#fff;--sx-surface:#fff;--sx-raised:#f5f5f4;--sx-ink:#111827;--sx-muted:#475569;--sx-line:#d4d4d8}
${PRESETS.filter((p) => p.print).map((p) => `${sel(p.id, (x) => `${NOT_FIXED}[data-sx-preset=${x}],${NOT_FIXED} [data-sx-preset=${x}]`)}{${Object.entries(p.print!).map(([k, v]) => `--sx-${k}:${v}`).join(";")};--sx-vivid:${p.print!.accent};--sx-vivid2:${p.print!.accent2}}`).join("")}
${NOT_FIXED} :is(.sx-shadow,.sx-rim,.sx-card){box-shadow:none}${NOT_FIXED} .sx-glass{backdrop-filter:none;-webkit-backdrop-filter:none}${NOT_FIXED} .sx-noise::after{display:none}${NOT_FIXED} .sx-aurora{background-image:none}
.sx-page{--sx-fs-xs:11;--sx-fs-sm:12.5;--sx-fs-md:14.67;--sx-fs-lg:18.67;--sx-fs-xl:25;--sx-fs-2xl:32;--sx-fs-3xl:38;--sx-fs-kpi:34;page:sx-a4;max-width:none;padding:0;gap:${u(16)};${fs("md")}}
.sx-poster{page:sx-poster;width:100vw;height:100vh;aspect-ratio:auto;margin:0;translate:none}
.sx-og{page:sx-og;width:100vw;height:100vh;aspect-ratio:auto;margin:0;translate:none}
.sx-slide,:where(section.slide,[data-slide]){translate:none}
h1,h2,h3,h4,.sx-title,.sx-h2,.sx-h3,.sx-eyebrow{break-after:avoid-page}p,li{orphans:3;widows:3}
.sx-card,.sx-callout,figure,tr,.sx-keep{break-inside:avoid}.sx-table:not(.sx-long){break-inside:avoid}thead{display:table-header-group}}`;

// Tự vá sau khi vẽ (tầng 1 của bộ tự kiểm, chạy trong khung, không gọi model):
// (1) khung (slide, poster, thẻ) có ô chữ data-node-id (mẫu điền sẵn đánh dấu mọi ô chữ) hay data-sx-fit mà khung đó hoặc thẻ bên trong tràn: co mọi ô chữ của khung
//     cùng tỉ lệ, mỗi bước ~3% (1px ở chữ 32px), thấp nhất 11 (px ở thang 1280 của slide), ghi bằng calc(N*var(--sx-u)) nên vẫn co giãn theo khung và bộ xuất PowerPoint đọc đúng cỡ;
// (2) chữ của các khối đó, ô nhiệt .sx-heat và phần tử data-sx-autoink có tương phản dưới 4.5:1 với nền thật phía sau (cộng dồn các lớp nền trong suốt): đổi sang
//     #F8FAFC hoặc #0F172A, chọn màu cho tỉ lệ cao hơn. Chữ chuyển màu (background-clip:text) bỏ qua. Slide đang ẩn được vá khi hiện ra (data-sx-on).
// Slide vừa hiện được vá SAU lần vẽ đầu (rAF rồi setTimeout) và chỉ một lần (data-sx-fitok, bỏ khi reset): vá trong rAF chặn lần vẽ, bấm chuyển slide nhanh thì
// khung lớn đứng ở slide cũ ~1,5 giây trong khi nhãn "Slide n / N" đã sang slide mới (lỗi 14 của ma trận H1).
// Vá khi phông web chưa tải xong (document.fonts.status khác "loaded") là đo bằng phông dự phòng: slide đó chỉ ghi data-sx-fitpre, không ghi xong.
// Phông tải xong (fonts.ready, loadingdone): slide đang hiện được vá lại từ đầu ngay (reset rồi vá), slide đang ẩn đã vá thì vá lại từ đầu lần hiện ra tới.
// Viết bằng JS thuần, không dấu ` và không chuỗi đóng thẻ script.
export const FIT_JS = String.raw`(function(){var cv;
function norm(c){if(/^rgba?\(/.test(c))return c;try{cv=cv||document.createElement("canvas").getContext("2d",{willReadFrequently:true});cv.clearRect(0,0,1,1);cv.fillStyle="rgba(0,0,0,0)";cv.fillStyle=c;cv.fillRect(0,0,1,1);var d=cv.getImageData(0,0,1,1).data;return"rgba("+d[0]+","+d[1]+","+d[2]+","+d[3]/255+")"}catch(e){return""}}
function rgb(c){var m=/rgba?\(([^)]+)\)/.exec(norm(c||""));if(!m)return null;var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}}
function lum(o){function f(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}return .2126*f(o.r)+.7152*f(o.g)+.0722*f(o.b)}
function ratio(a,b){var x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
function bgOf(el){var st=[];for(var e=el;e;e=e.parentElement){var c=rgb(getComputedStyle(e).backgroundColor);if(c&&c.a>0){st.push(c);if(c.a>=.99)break}}
var o={r:255,g:255,b:255};for(var i=st.length-1;i>=0;i--){var k=st[i];o={r:k.r*k.a+o.r*(1-k.a),g:k.g*k.a+o.g*(1-k.a),b:k.b*k.a+o.b*(1-k.a)}}return o}
var L={r:248,g:250,b:252},D={r:15,g:23,b:42};
function ink(el){var cs=getComputedStyle(el);if(cs.webkitBackgroundClip==="text"||cs.backgroundClip==="text")return;var c=rgb(cs.color);if(!c||c.a<.05)return;var b=bgOf(el);
if(ratio(c,b)>=4.5)return;var l=ratio(L,b),d=ratio(D,b);if(Math.max(l,d)<=ratio(c,b))return;keep(el,"data-sx-ink0",el.style.color);el.style.color=l>d?"#F8FAFC":"#0F172A";el.setAttribute("data-sx-inked","")}
// Giá trị nội dòng trước lần vá đầu tiên (data-sx-ink0, data-sx-fs0): reset() trả về đúng như vậy khi đổi phong cách, rồi vá lại theo phong cách mới.
function keep(el,k,v){if(!el.hasAttribute(k))el.setAttribute(k,v||"")}
function unit(el){var p=document.createElement("i");p.style.cssText="position:absolute;visibility:hidden;width:calc(1000*var(--sx-u));height:0";(el.parentElement||el).appendChild(p);var w=p.getBoundingClientRect().width/1000;p.remove();return w||1}
function over(e,t){t=t||1;return!!e&&(e.scrollHeight>e.clientHeight+t||e.scrollWidth>e.clientWidth+t)}
var BOX="[data-sx-box],.sx-card,.sx-slide,section.slide,[data-slide],.sx-poster,.sx-tpl-box";
function vis(e){return e.getClientRects().length>0}
function bad(f,t){if(over(f,t))return true;var bs=f.querySelectorAll(BOX);
for(var i=0;i<bs.length;i++)if(vis(bs[i])&&over(bs[i],t))return true;return false}
${TYPE_ELS_JS}
// Sàn của tiêu đề slide: ${TITLE_FLOOR}px ở khung rộng 1280 và ${TYPE_RATIO} lần chữ thân lớn nhất (sxTitleMin, cùng
// tỉ lệ bộ kiểm tra thứ bậc cỡ chữ dùng). Ô data-sx-fit hay chỉ có ở tiêu đề (model được dặn đánh dấu tiêu đề, KPI);
// đoạn văn dài làm tràn thì cả khung co mà chỉ tiêu đề nhỏ đi, từng còn ~14px, nhỏ hơn cả dòng mô tả.
var SLIDE=".sx-slide,section.slide,[data-slide]",TT="${TITLE_SEL}";
function tfloor(s,uu){return ${TITLE_FLOOR}*s.offsetWidth/uu/1280}
function px(e,uu){return parseFloat(getComputedStyle(e).fontSize)/uu}
function selfFloor(el,uu){
var s=el.closest(SLIDE),t=el.closest(TT);
if(!s||!t||!s.contains(t))return 11;
var bm=0;
sxTypeEls(s).b.forEach(function(b){bm=Math.max(bm,px(b,uu))});
return Math.max(Math.ceil(tfloor(s,uu)),sxTitleMin(bm))}
// Cả khung (slide, poster, thẻ đứng riêng) co cùng tỉ lệ: mỗi bậc mọi ô chữ nhỏ đi khoảng 3% (1px với chữ 32px), ô nào chạm 11 thì dừng ở 11.
// Co theo tỉ lệ giữ thứ bậc tiêu đề / số / thân; co riêng ô lớn nhất từng làm số KPI teo lại trong khi thủ phạm là đoạn văn dài.
// Tìm bậc lớn nhất vừa khung bằng chia đôi (~5 lần dàn trang thay vì tới 24): cùng kết quả với dò từng bậc vì chữ nhỏ đi thì khung không tràn thêm.
// Mỗi lần dàn trang ở slide nhiều ô chữ tốn hàng chục ms, nên đây là phần lớn thời gian chữ chưa vá hiện trên slide vừa chuyển tới (lỗi 14 của ma trận H1).
// Co hết bậc mà vẫn tràn: trả mọi ô về cỡ trước khi co và ghi data-sx-fitover lên khung. Giữ chữ đã co mà khung vẫn
// tràn thì không sửa được gì, chỉ làm tiêu đề, KPI, chú thích nhỏ hơn cả chữ thân không co được (đoạn văn không đánh
// dấu); cờ báo để bộ kiểm tra hiển thị nói slide tràn và model sửa bố cục, vì slide tự cắt phần thừa (overflow hidden)
// nên số đo cao / rộng không thấy được lỗi này. Khung không có ô nào co được cũng ghi cờ như vậy.
function fitFrame(f){
f.removeAttribute("data-sx-fitover");
if(!vis(f)||!bad(f))return;
var ns=[].slice.call(f.querySelectorAll("[data-node-id],[data-sx-fit]")).filter(vis);
if(!ns.length){
if(bad(f,4))f.setAttribute("data-sx-fitover","");
return}
// Đơn vị đo bên trong khung (ô chữ đầu tiên): --sx-u của slide khác của trang (1px) khi khung hẹp hơn 1280, đo ngoài
// khung thì cỡ gốc tính sai đơn vị và chữ bị co thêm đúng tỉ lệ thu nhỏ của khung (khung xem, ảnh thu nhỏ).
var uu=unit(ns[0]);
var o=ns.map(function(e){return px(e,uu)});
var pre=ns.map(function(e){return[e.style.fontSize,e.getAttribute("data-sx-fitted")]});
var ty=f.matches(SLIDE)?sxTypeEls(f):null;
var tf=ty?Math.ceil(tfloor(f,uu)):11;
var ti=ns.map(function(e){
var t=ty&&e.closest(ty.T);
return!!t&&f.contains(t)});
var bd=ty?ty.b.map(function(e){return{k:ns.indexOf(e),v:px(e,uu)}}):[];
function put(i,n){
keep(ns[i],"data-sx-fs0",pre[i][0]);
ns[i].style.fontSize="calc("+n+"*var(--sx-u))";
ns[i].setAttribute("data-sx-fitted",String(n))}
function back(i){
ns[i].style.fontSize=pre[i][0];
if(pre[i][1]!==null){
ns[i].setAttribute("data-sx-fitted",pre[i][1]);
return}
ns[i].removeAttribute("data-sx-fitted");
ns[i].removeAttribute("data-sx-fs0")}
function at(s){
var sc=1-.03*s;
var nn=o.map(function(v){return Math.max(11,Math.round(v*sc*2)/2)});
var bm=0;
bd.forEach(function(b){bm=Math.max(bm,b.k<0?b.v:Math.min(nn[b.k],o[b.k]))});
var tm=Math.max(tf,sxTitleMin(bm));
for(var i=0;i<ns.length;i++){
var n=ti[i]?Math.max(tm,nn[i]):nn[i];
if(n<o[i])put(i,n);
else back(i)}}
var lo=1,hi=24;
while(lo<hi){
var m=(lo+hi)>>1;
at(m);
if(bad(f))lo=m+1;
else hi=m}
at(lo);
// Bậc dưới 24 đã đo là vừa trong vòng chia đôi; đo lại thì thêm một lần dàn trang mỗi slide, lần dàn trang đó
// là phần lớn thời gian chữ chưa vá hiện trên slide vừa chuyển tới.
if(lo<24||!bad(f,4))return;
for(var i=0;i<ns.length;i++)back(i);
f.setAttribute("data-sx-fitover","")}
// Ô tự có khung cố định (overflow khác visible) đứng ngoài khung lớn: co chính nó, cỡ lớn nhất còn vừa (chia đôi,
// thấp nhất 11; tiêu đề slide thấp nhất là sàn của tiêu đề). Ở sàn mà vẫn tràn: giữ cỡ gốc và ghi data-sx-fitover,
// cùng lý do với fitFrame.
function fitSelf(el){
var cs=getComputedStyle(el);
el.removeAttribute("data-sx-fitover");
if(!vis(el)||cs.overflow==="visible"||!over(el))return;
var uu=unit(el),n=Math.round(parseFloat(cs.fontSize)/uu),fl=selfFloor(el,uu),p0=el.style.fontSize;
function size(m){el.style.fontSize="calc("+m+"*var(--sx-u))"}
var lo=fl,hi=n-1;
while(lo<hi){
var m=(lo+hi+1)>>1;
size(m);
if(over(el))hi=m-1;
else lo=m}
if(n>fl)size(lo);
else lo=n;
// Bậc trên sàn đã đo là vừa trong vòng chia đôi; chỉ sàn (hay cỡ gốc đã ở sàn) chưa đo. Đo sàn trước vòng chia đôi
// thì mỗi ô thêm một lần dàn trang, slide nhiều ô chữ chậm hẳn.
if(lo<=fl&&over(el,4)){
el.style.fontSize=p0;
el.setAttribute("data-sx-fitover","");
return}
if(n>fl)keep(el,"data-sx-fs0",p0);
el.setAttribute("data-sx-fitted",String(lo))}
function top(e){var t=null;for(var b=e.closest(BOX);b;b=b.parentElement&&b.parentElement.closest(BOX))t=b;return t}
// Slide không có ô nào co được cũng qua fitFrame để được ghi cờ tràn: model hay bỏ data-sx-fit, và slide của bộ thiết
// kế tự cắt phần thừa nên không có cờ thì bộ kiểm tra hiển thị coi slide đó là vừa.
function frames(root,fr){
var sl=[].slice.call(root.querySelectorAll(SLIDE));
if(root.matches&&root.matches(SLIDE))sl.push(root);
sl.forEach(function(s){
var t=top(s);
if(t&&fr.indexOf(t)<0)fr.push(t)})}
function run(root){root=root||document;var a=root.querySelectorAll("[data-node-id],[data-sx-fit]"),fr=[];for(var i=0;i<a.length;i++){try{fitSelf(a[i])}catch(e){}var t=top(a[i]);if(t&&fr.indexOf(t)<0)fr.push(t)}
frames(root,fr);
fr.forEach(function(f){try{fitFrame(f)}catch(e){}});
var c=root.querySelectorAll("[data-node-id],.sx-heat,[data-sx-autoink]");for(var j=0;j<c.length;j++)try{if(vis(c[j]))ink(c[j])}catch(e){}}
// Bỏ mọi chỗ đã vá (màu chữ, cỡ chữ) về như trang gốc: đổi phong cách thử (data-sx-preset) thì vá lại từ đầu, không giữ màu / cỡ hợp với phong cách cũ.
function reset(root){root=root||document;var ok=root.querySelectorAll("[data-sx-fitok],[data-sx-fitpre]");for(var q=0;q<ok.length;q++){ok[q].removeAttribute("data-sx-fitok");ok[q].removeAttribute("data-sx-fitpre")}var a=root.querySelectorAll("[data-sx-inked]");for(var i=0;i<a.length;i++){if(a[i].hasAttribute("data-sx-ink0"))a[i].style.color=a[i].getAttribute("data-sx-ink0");a[i].removeAttribute("data-sx-ink0");a[i].removeAttribute("data-sx-inked")}
var f=root.querySelectorAll("[data-sx-fitted]");
for(var j=0;j<f.length;j++){
if(f[j].hasAttribute("data-sx-fs0"))f[j].style.fontSize=f[j].getAttribute("data-sx-fs0");
f[j].removeAttribute("data-sx-fs0");
f[j].removeAttribute("data-sx-fitted")}
var v=root.querySelectorAll("[data-sx-fitover]");
for(var k=0;k<v.length;k++)v[k].removeAttribute("data-sx-fitover");
if(root.removeAttribute)root.removeAttribute("data-sx-fitover")}
window.__sxFit=run;window.__sxReset=reset;
function fontsOk(){try{return document.fonts.status==="loaded"}catch(e){return true}}
// Vá một slide vừa hiện: đã vá bằng phông dự phòng thì trả về như gốc rồi vá lại; ghi xong (data-sx-fitok) chỉ khi phông đã tải.
function fitSlide(t){if(t.hasAttribute("data-sx-fitpre"))reset(t);run(t);t.removeAttribute("data-sx-fitpre");t.setAttribute(fontsOk()?"data-sx-fitok":"data-sx-fitpre","")}
function refont(){var a=document.querySelectorAll("[data-sx-fitok],[data-sx-fitpre]");for(var i=0;i<a.length;i++){var t=a[i];try{if(vis(t)){t.setAttribute("data-sx-fitpre","");fitSlide(t)}else{t.removeAttribute("data-sx-fitok");t.setAttribute("data-sx-fitpre","")}}catch(e){}}run()}
function go(){requestAnimationFrame(function(){run()});try{document.fonts.ready.then(refont);document.fonts.addEventListener("loadingdone",refont)}catch(e){}
try{new MutationObserver(function(ms){ms.forEach(function(m){var t=m.target;if(t.hasAttribute&&t.hasAttribute("data-sx-on")&&!t.hasAttribute("data-sx-fitok"))requestAnimationFrame(function(){setTimeout(function(){if(!t.hasAttribute("data-sx-on")||t.hasAttribute("data-sx-fitok"))return;fitSlide(t)},0)})})}).observe(document.body,{subtree:true,attributes:true,attributeFilter:["data-sx-on"]})}catch(e){}}
if(document.readyState==="loading")addEventListener("DOMContentLoaded",go);else go()})();`;

/** Đường dẫn Google Fonts chỉ gồm các phông trang dùng: khung cho phép fonts.googleapis.com và fonts.gstatic.com (csp ở artdoc.ts). */
export function kitFontUrl(content: string): string {
  const ids = [...content.matchAll(/data-sx-preset=["']?([\w-]+)/g)].map((m) => m[1]).filter((i) => presetOf(i)).map((i) => presetOf(i)!.id);
  const used = ids.length ? ids : [DEFAULT_PRESET];
  const names = new Set(used.flatMap((i) => { const p = presetOf(i)!; return [p.head, p.body, p.mono]; }));
  return `https://fonts.googleapis.com/css2?${[...names].map((n) => `family=${FONT_SPEC[n].css}`).join("&")}&display=swap`;
}
/** Phần chèn vào <head> của trang có dùng bộ CSS; trang không dùng thì rỗng. */
// Nạp phông sau sự kiện load, không dùng <link> trong <head>: thẻ đó chặn lần vẽ đầu, mạng treo (tường lửa, gói tin bị bỏ) thì trang trắng tới khi yêu cầu hết giờ. Kể cả media="print" cũng giữ
// sự kiện load, khung không báo được chiều cao. Phông là phần thêm, chữ phải hiện trước; font-display:swap đổi phông khi tải xong.
// origin: địa chỉ Synchro để nạp thư viện từ /vendor (khung xem, tệp tải về); rỗng thì nạp từ jsDelivr (cùng SRI).
export const kitHead = (content: string, origin = "") => {
  if (!usesKit(content)) return "";
  const url = kitFontUrl(content);
  const charts = ECHARTS_ON.test(content) ? `<script data-sx-charts>${chartKitJs(libAt(origin, ECHARTS))}</script>` : "";
  const shader = /data-sx-shader/.test(content) ? `<script data-sx-3d>${shaderKitJs(origin)}</script>` : "";
  return `<script>addEventListener("load",function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(url)};l.setAttribute("data-sx-font","");document.head.appendChild(l)});${FIT_JS}</script><noscript><link rel="stylesheet" href="${url.replace(/&/g, "&amp;")}"></noscript><style data-sx-kit>${CSS}</style>${charts}${shader}`;
};
export const KIT_CSS = CSS;
/** Phong cách đang dùng của trang (mã chính), hoặc "" nếu trang không đặt data-sx-preset hợp lệ. */
export const presetIn = (content: string) => { const m = /data-sx-preset=["']?([\w-]+)/.exec(content); return m && presetOf(m[1]) ? presetOf(m[1])!.id : ""; };
/**
 * Đổi phong cách không gọi model: các khối SEARCH/REPLACE thay mọi data-sx-preset="…" bằng phong cách mới (áp lần lượt từ đầu tệp nên mỗi khối trúng một chỗ).
 * Trang không có data-sx-preset, hay đã đúng phong cách đó: null.
 */
export function restylePatch(content: string, id: string): string | null {
  const to = presetOf(id)?.id;
  if (!to) return null;
  const hits = [...content.matchAll(/data-sx-preset=(["']?)([\w-]+)\1/g)].filter((m) => presetOf(m[2]) && presetOf(m[2])!.id !== to);
  if (!hits.length) return null;
  return hits.map((m) => `<<<<<<< SEARCH\n${m[0]}\n=======\ndata-sx-preset=${m[1]}${to}${m[1]}\n>>>>>>> REPLACE`).join("\n");
}
/** Để lấy phông nhúng khi chụp ảnh / xuất PowerPoint (artfonts.ts tìm đường dẫn Google Fonts trong chữ của trang). */
export const withKitFontLink = (content: string) => (usesKit(content) ? `${content}\n<!-- ${kitFontUrl(content)} -->` : content);
