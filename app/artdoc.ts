// Dựng trang chạy artifact (html / react / svg, bản trình bày): dùng chung cho khung xem trước trong trình duyệt và cho máy chủ
// (kiểm tra hiển thị artifact bằng Chromium trong workspace, artcheck.ts). Không phụ thuộc giao diện: cầu nối với khung cha truyền vào.
import type { ArtType } from "./artifacts";
import { ECHARTS, KIT_CSS, kitHead, SYNCHRO_3D, usesKit } from "./artkit";
import { instrumentHtml, LOC_ATTR } from "./srcloc";

export const V = "/vendor/";
// Thư viện cho artifact React: tải từ /vendor của Synchro; nếu trình duyệt chặn (khung cô lập không được gọi về máy
// localhost khi chạy thử cục bộ) thì tải bản giống hệt từ jsDelivr. Mã băm toàn vẹn (SRI) bảo đảm đúng từng byte.
export const LIBS: [string, string, string][] = [
  ["tailwind-browser-4.3.3.js", "@tailwindcss/browser@4.3.3/dist/index.global.js", "sha384-2ql948lIdLcGEE0/qxNiudyTjgauA3RDJERu5xW75kFCvSl5a9odyQYCb6tEjnmB"],
  ["react-18.3.1.min.js", "react@18.3.1/umd/react.production.min.js", "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"],
  ["react-dom-18.3.1.min.js", "react-dom@18.3.1/umd/react-dom.production.min.js", "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"],
  ["prop-types-15.8.1.min.js", "prop-types@15.8.1/prop-types.min.js", "sha384-/AfDwVDXNopzPvhxMPQ11y1OCpR6mVkWx47qzSwIiquvxkcMkZddEzDNtIOtfCpk"],
  ["recharts-2.15.4.min.js", "recharts@2.15.4/umd/Recharts.js", "sha384-8WLbYxXTeAFm5KD1lWOhUghb4T1QP+Y15d4aEGIFc6zzN2BMObhTK1u7mXiLbp8p"],
  ["lucide-react-0.460.0.min.js", "lucide-react@0.460.0/dist/umd/lucide-react.min.js", "sha384-JEoKym/kMViouWwSkyVNKeAyxFMvD/XeYv4VtG86kNEtGxzuvjSjTqWulOQd6dNY"],
  ["babel-7.29.11.min.js", "@babel/standalone@7.29.11/babel.min.js", "sha384-WLl8kKG54INe3zxB+zrpQr6Z1cgCoBg+ZirrqnCcjzA5sjvtSirQ11bgyU91deI+"],
];
// Thư viện tải khi cần: chụp ảnh PNG của artifact (html-to-image); xuất PowerPoint cũng dùng nó để chụp nền từng slide (deckpptx.ts).
export const H2I: [string, string, string] = ["html-to-image-1.11.11.js", "html-to-image@1.11.11/dist/html-to-image.js", "sha384-UbfRVKN3/elS1r7JcK2FhmPP+KlJ4CvYwbyYD7tH+uTkbT9bNJr9eJeQ0FoFbAgz"];
export const libUrls = (origin: string, l: [string, string, string]) => [`${origin}${V}${l[0]}`, `https://cdn.jsdelivr.net/npm/${l[1]}`, l[2]];
export const CDNS = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
export const THREE_MODS = ["three", "@react-three/fiber", "@react-three/drei", "shadergradient", "@shadergradient/react", "synchro-3d"];
/** Mã React có import thư viện này (import … from "x", import "x", require("x")). */
export const IMPORTS = (content: string, ...names: string[]) => names.some((n) => new RegExp(`(?:from\\s*|import\\s*|require\\(\\s*)["']${n.replace(/[/.]/g, "\\$&")}["']`).test(content));
export const esc = (s: string) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Bản trình bày HTML: mỗi slide là <section class="slide"> (hoặc các <section> nối nhau của bản trình chiếu tự viết).
// Synchro điều khiển: chỉ hiện slide đang xem, nhận lệnh chuyển slide, báo số slide; in thì mỗi slide một trang (PDF 16:9).
// fixed: khung ảnh thu nhỏ chỉ hiện đúng một slide, không nhận thao tác.
export const isDeck = (a: { type: ArtType; content: string }) => a.type === "html" &&
  ((a.content.match(/<section\b[^>]*(class=["'][^"']*\bslide\b|data-slide)/gi)?.length ?? 0) >= 2 || ((a.content.match(/<section\b/gi)?.length ?? 0) >= 2 && /ArrowRight|PageDown/.test(a.content)));
export const deckRuntime = (fixed: number | null) => `<style>[data-sx-hide]{display:none!important}[data-sx-on]{opacity:1!important;visibility:visible!important;transform:none!important}
${fixed !== null ? "html{pointer-events:none}html,body{overflow:hidden!important}" : ""}
@media print{@page{size:13.333in 7.5in;margin:0}html,body{height:auto!important;overflow:visible!important}[data-sx-slide]{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;opacity:1!important;visibility:visible!important;transform:none!important;width:100vw!important;height:100vh!important;break-after:page;page-break-after:always;box-sizing:border-box}[data-sx-noprint]{display:none!important}}</style>
<script>${fixed !== null ? "window.__sxStatic=1;window.__sxThumb=1;" : ""}(function(){var fixed=${fixed === null ? "null" : fixed},cur=0,S=[],CL=["on","active","current","is-active","visible","present"];
function post(m){m.__synchro=window.__sxCh;try{parent.postMessage(m,"*")}catch(e){}}
function find(){var s=[].slice.call(document.querySelectorAll("section.slide,[data-slide]"));if(s.length<2)s=[].slice.call(document.querySelectorAll("body>section,body>main>section,body>div>section,.slides>section"));return s.length>1?s:[]}
function show(i){S=find();if(!S.length){post({t:"slides",n:0,cur:0});return}cur=Math.max(0,Math.min(i,S.length-1));
S.forEach(function(el,k){el.setAttribute("data-sx-slide","");if(k===cur){el.removeAttribute("data-sx-hide");el.setAttribute("data-sx-on","");CL.forEach(function(c){el.classList.add(c)})}else{el.setAttribute("data-sx-hide","");el.removeAttribute("data-sx-on");CL.forEach(function(c){el.classList.remove(c)})}});
if(fixed===null)post({t:"slides",n:S.length,cur:cur})}
window.__sxGo=function(i){show(i)};window.__sxCur=function(){return S[cur]||null};window.__sxAll=function(){S=find();return S};window.__sxIdx=function(){return cur};
function reveal(){S=find();S.forEach(function(el){el.removeAttribute("data-sx-hide");el.setAttribute("data-sx-on","")});
[].forEach.call(document.body.querySelectorAll("*"),function(el){if(S.indexOf(el)<0&&!S.some(function(s){return s.contains(el)||el.contains(s)})&&getComputedStyle(el).position==="fixed")el.setAttribute("data-sx-noprint","")})}
window.__sxPrint=function(){reveal();setTimeout(function(){print();show(cur)},60)};
addEventListener("beforeprint",reveal);addEventListener("afterprint",function(){show(cur)});
if(fixed===null){addEventListener("keydown",function(e){var k=e.key,n=["ArrowRight","ArrowDown","PageDown"," ","Enter"].indexOf(k)>=0?1:["ArrowLeft","ArrowUp","PageUp","Backspace"].indexOf(k)>=0?-1:0;
if(k==="Home"||k==="End"){e.preventDefault();e.stopImmediatePropagation();show(k==="Home"?0:1e9);return}if(n){e.preventDefault();e.stopImmediatePropagation();show(cur+n)}},true);
addEventListener("click",function(e){if(e.target.closest&&e.target.closest("a,button,input,select,textarea,label,[onclick]"))return;e.stopImmediatePropagation();if(window.__sxPresent)show(cur+(e.clientX>innerWidth/3?1:-1))},true)}
function start(){show(fixed===null?0:fixed);setTimeout(function(){show(fixed===null?cur:fixed)},120)}
if(document.readyState==="loading")addEventListener("DOMContentLoaded",start);else start()})();</script>`;

export function csp(origin: string) {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}${V} ${CDNS}; style-src 'unsafe-inline' https://fonts.googleapis.com ${CDNS}; font-src https://fonts.gstatic.com ${CDNS} data:; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}
export const BASE_CSS = `<style>:root{color-scheme:light dark}html,body{margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style>`;

// Chèn vào <head> của trang (hoặc bọc trang nếu model chỉ viết phần thân).
// kit: bộ CSS (artkit.ts) đứng sau BASE_CSS để thắng phông mặc định, trước CSS của model để model vẫn sửa được.
// Không để <head> khớp <header>: trang chỉ viết phần thân có <header> thì CSP, cầu nối, bộ CSS rơi vào trong thẻ đó, mất doctype và meta CSP mất tác dụng.
const HEAD_TAG = /<head(?:\s[^>]*)?>/i, HTML_TAG = /<html(?:\s[^>]*)?>/i;
export function withHead(content: string, head: string, kit = "") {
  if (HEAD_TAG.test(content)) return content.replace(HEAD_TAG, (m) => m + head + kit);
  if (HTML_TAG.test(content)) return content.replace(HTML_TAG, (m) => `${m}<head>${head}${kit}</head>`);
  return `<!doctype html><html><head>${head}${BASE_CSS}${kit}</head><body>${content}</body></html>`;
}
// Tệp HTML tải về của bản trình bày: mở bằng trình duyệt là trình chiếu được (phím mũi tên, bấm chuột), in ra mỗi slide một trang.
export const deckExport = (content: string, origin = "") => withHead(content, `<meta charset="utf-8"><script>window.__sxPresent=true</script>${deckRuntime(null)}`, kitHead(content, origin));
/** Tệp HTML tải về của trang thường: trang dùng bộ CSS phải kèm bộ CSS, không thì mở ra vỡ hết; trang khác giữ nguyên từng byte. */
export const htmlExport = (content: string, origin = "") => (usesKit(content) ? withHead(content, `<meta charset="utf-8">`, kitHead(content, origin)) : content);
/** Tệp SVG tải về đứng một mình: hình dùng biến --sx-… phải mang theo bộ CSS trong chính tệp (CDATA vì tệp là XML); hình khác giữ nguyên từng byte. */
export const svgExport = (content: string) => (usesKit(content) ? content.replace(/<svg\b[^>]*>/i, (m) => `${m}<style><![CDATA[${KIT_CSS}]]></style>`) : content);

// loc: đánh dấu dòng mã nguồn lên từng phần tử (Alt+Click → đúng dòng), chỉ ở khung xem trước, không có trong bản tải về.
// bridge: cầu nối với khung cha (postMessage) của khung xem trước; máy chủ kiểm tra hiển thị thì truyền phần báo lỗi riêng.
export function buildDocCore(type: ArtType, content: string, origin: string, ch: string, dark: boolean, bridge: string, deck?: { fixed: number | null }, title = "", loc = false): string {
  if (loc && (type === "html" || type === "svg")) content = instrumentHtml(content);
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp(origin)}${bridge}${deck && type === "html" ? `<script>window.__sxCh=${JSON.stringify(ch)}</script>${deckRuntime(deck.fixed)}` : ""}`;
  // Chèn CSP + cầu nối; trang HTML giữ tiêu đề của chính nó, React / SVG lấy tên artifact (tên mặc định khi lưu PDF).
  const kit = kitHead(content, origin);
  if (type === "html") return withHead(content, head, kit);
  const titled = (title ? `${head}<title>${htmlEsc(title)}</title>` : head) + (type === "react" ? "<script>window.__sxReact=1</script>" : "");
  if (type === "svg") {
    // kit đứng trước để nền của khung SVG vẫn thắng nền của bộ CSS; hình không dùng thì kit rỗng.
    return `<!doctype html><html><head>${titled}${kit}<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:${dark ? "#1b1b1b" : "#fff"}}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${content}</body></html>`;
  }
  // React: tải thư viện theo thứ tự, dịch JSX/TSX bằng Babel trong khung, import được react, recharts, lucide-react; có Tailwind.
  // Thư viện nặng chỉ nạp khi mã thật sự import: ECharts (~1,1 MB).
  // Gói 3D (~1,1 MB, 283 KB nén): import three / @react-three/* / shadergradient / synchro-3d, hoặc nền data-sx-shader của bộ CSS. Chỉ có ở /vendor của Synchro.
  const three = IMPORTS(content, ...THREE_MODS) || /data-sx-shader/.test(content);
  const extra: [string, string, string][] = [...(IMPORTS(content, "echarts") ? [ECHARTS] : []), ...(three ? [SYNCHRO_3D] : [])];
  const libs = [...LIBS, ...extra].map(([f, cdn, sri]) => [`${origin}${V}${f}`, cdn ? `https://cdn.jsdelivr.net/npm/${cdn}` : `${origin}${V}${f}`, sri]);
  const loading = `<style>.__ld{position:fixed;inset:0;display:grid;place-items:center}.__ld i{width:22px;height:22px;border-radius:50%;border:2px solid #d6d6d0;border-top-color:#545452;animation:__s .8s linear infinite}@keyframes __s{to{transform:rotate(360deg)}}</style><div class="__ld"><i></i></div>`;
  return `<!doctype html><html><head>${titled}${BASE_CSS}${kit}</head><body><div id="root">${loading}</div>
<script>(function(){var src=${esc(JSON.stringify(content))},libs=${JSON.stringify(libs)},i=0;
function load(u,sri,cb){var s=document.createElement("script");s.src=u;s.crossOrigin="anonymous";s.integrity=sri;s.onload=function(){cb(true)};s.onerror=function(){s.remove();cb(false)};document.head.appendChild(s)}
function next(){if(i>=libs.length)return run();var l=libs[i++];load(l[0],l[2],function(ok){if(ok)return step();load(l[1],l[2],function(ok2){if(!ok2)throw new Error("Không tải được thư viện cho artifact. Kiểm tra kết nối mạng rồi bấm Chạy lại.");step()})})}
function step(){if(window.React&&!window.react)window.react=window.React;next()}
function run(){var mods={"react":React,"react-dom":ReactDOM,"react-dom/client":ReactDOM,"recharts":Recharts,"lucide-react":LucideReact,"prop-types":PropTypes};
if(window.echarts)mods.echarts=window.echarts;
var S3=window.Synchro3D;if(S3){var sg={ShaderGradient:S3.ShaderGradient,ShaderGradientCanvas:S3.ShaderGradientCanvas};mods.three=S3.THREE;mods["@react-three/fiber"]=S3.Fiber;mods["@react-three/drei"]=S3.drei;mods.shadergradient=sg;mods["@shadergradient/react"]=sg;mods["synchro-3d"]=S3}
function req(n){if(mods[n])return mods[n];throw new Error('Thư viện "'+n+'" không có sẵn trong artifact (có react, recharts, lucide-react, echarts, three, @react-three/fiber, @react-three/drei (Environment, Float, Lightformer, MeshTransmissionMaterial), shadergradient, synchro-3d).')}
${loc ? `function sxLoc(b){var t=b.types;return{visitor:{JSXOpeningElement:function(p){var n=p.node,el=p.parent;if(!n.loc||n.name.type!=="JSXIdentifier"||!/^[a-z]/.test(n.name.name))return;if(n.attributes.some(function(a){return a.type==="JSXAttribute"&&a.name&&a.name.name==="${LOC_ATTR}"}))return;n.attributes.push(t.jsxAttribute(t.jsxIdentifier("${LOC_ATTR}"),t.stringLiteral(n.loc.start.line+"-"+(el&&el.loc?el.loc.end.line:n.loc.end.line))))}}}}
` : ""}var out=Babel.transform(src,{filename:"App.tsx",presets:[["typescript",{isTSX:true,allExtensions:true}],["react",{runtime:"classic"}]],plugins:[${loc ? "sxLoc," : ""}"transform-modules-commonjs"]}).code;
var module={exports:{}};new Function("module","exports","require","React",out)(module,module.exports,req,React);
var C=module.exports.default||module.exports.App||Object.values(module.exports).find(function(v){return typeof v==="function"});
if(!C)throw new Error("Không tìm thấy component (cần export default).");
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(C))}
next()})();</script></body></html>`;
}

const htmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- ảnh từ URL ngoài
// Khung artifact chỉ cho ảnh data: / blob: (CSP img-src): mở cho mọi trang thì artifact gửi lén được dữ liệu ra ngoài qua đường dẫn ảnh.
// Model hay dùng ảnh từ URL công khai (Wikimedia, Unsplash…) nên ảnh "biến mất": Synchro tải các ảnh đó qua máy chủ (chặn địa chỉ nội bộ,
// chỉ nhận tệp ảnh) rồi nhúng thành data: trước khi dựng khung — khung xem trước (artifactui.tsx) và máy kiểm tra hiển thị (artcheck.ts).
const IMG_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:[?#][^"'`\s)]*)?$/i;
const FONT = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)|^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//i;
// Kho ảnh hay dùng mà đường dẫn không có đuôi tệp (Unsplash, Pexels, Picsum…).
const IMG_HOST = /^https?:\/\/(?:images\.unsplash\.com|plus\.unsplash\.com|upload\.wikimedia\.org|images\.pexels\.com|picsum\.photos|i\.imgur\.com|cdn\.pixabay\.com|[\w-]+\.googleusercontent\.com|avatars\.githubusercontent\.com)\//i;
// Ảnh generate_image trong artifact: địa chỉ giả (tên miền .invalid không bao giờ có thật) đi chung đường với ảnh ngoài ở mọi nơi: khung xem trước, máy kiểm tra hiển thị, bản chia sẻ.
// Chỉ máy chủ đổi được địa chỉ này thành ảnh, và chỉ với đúng chủ tài khoản (artimg.ts); artifact không giữ đường dẫn hay dữ liệu riêng nào.
export const genImageUrl = (id: string) => `https://image.synchro.invalid/${id}.png`;
export const genImageId = (u: string) => /^https:\/\/image\.synchro\.invalid\/([\w-]{8,40})\.png$/.exec(u)?.[1] ?? null;
/** Ảnh giữ chỗ của ảnh đang dựng ở chế độ nền (PNG 1×1, chatengine.ts placeholderImage): /api/artimg báo "đang chờ" để khung xem trước hỏi lại
 *  tới khi byte thật thay vào (W23-2). Ảnh dựng thật không bao giờ là 1×1. */
/** Khoảng chờ trước lần hỏi lại thứ n ảnh đang dựng nền: 5 s, tăng dần tới 30 s; null là thôi (sau khoảng 17 phút, quá thời gian dựng ảnh). */
export const pendingRetryMs = (n: number): number | null => (n >= 40 ? null : Math.min(30_000, Math.round(5000 * 1.4 ** n)));
export function isPlaceholderPng(b: Uint8Array): boolean {
  if (b.length < 24 || b.length > 512) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((x, k) => b[k] === x)) return false;
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return u32(16) === 1 && u32(20) === 1; // IHDR: rộng, cao
}
export function externalImageUrls(content: string, max = 60): string[] {
  const out = new Set<string>();
  const add = (u: string) => { u = u.replace(/&amp;/g, "&"); if (/^https?:\/\//i.test(u) && !FONT.test(u) && u.length < 2000 && out.size < max) out.add(u); };
  // Thuộc tính ảnh (src, srcset, poster, href của <image> trong SVG) và url(...) trong CSS.
  for (const m of content.matchAll(/\b(?:src|poster|xlink:href|href)\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/gi)) if (!/\bhref\s*=/i.test(m[0]) || IMG_EXT.test(m[1]) || /<image\b[^>]*$/i.test(content.slice(Math.max(0, m.index! - 200), m.index))) add(m[1]);
  for (const m of content.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) for (const part of m[1].split(",")) add(part.trim().split(/\s+/)[0]);
  for (const m of content.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi)) add(m[1]);
  // Chuỗi trong mã (ứng dụng React, dữ liệu slide): URL có đuôi ảnh.
  for (const m of content.matchAll(/["'`](https?:\/\/[^"'`\s<>]+)["'`]/g)) if (IMG_EXT.test(m[1]) || IMG_HOST.test(m[1])) add(m[1]);
  return [...out];
}
/** Thay từng URL ảnh (cả dạng &amp; trong HTML) bằng data: đã tải. */
export function swapUrls(content: string, map: Map<string, string>): string {
  let s = content;
  for (const [u, d] of map) { s = s.split(u).join(d); const a = u.replace(/&/g, "&amp;"); if (a !== u) s = s.split(a).join(d); }
  return s;
}
