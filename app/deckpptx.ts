"use client";
// Xuất bản trình bày HTML thành PowerPoint (.pptx) chỉnh sửa được, không cần model: chạy ngay trong khung xem của Synchro.
// Mỗi slide: (1) đo từng khối chữ đang hiện (vị trí, phông, cỡ, đậm / nghiêng, màu, giãn chữ, canh lề, khoảng cách dòng) → hộp chữ PowerPoint
// sửa được; (2) ẩn riêng phần chữ rồi chụp phần còn lại (nền, hình minh họa SVG, biểu đồ, đường kẻ, ảnh) thành ảnh nền nét cao đặt dưới hộp chữ.
// Chuyển động CSS dừng ở trạng thái cuối khi chụp (PowerPoint không đọc được CSS / JS). Tệp không nhúng được phông: phông web (Google Fonts, bộ thiết kế) đổi sang phông
// máy người nhận chắc có cùng dáng (Arial, Cambria đủ dấu tiếng Việt, Consolas), không thì PowerPoint tự thay bằng phông bất kỳ; phông máy khác (Georgia, Helvetica…) giữ đúng tên.
import { FONT_SPEC } from "./designpresets";

/** Một đoạn chữ cùng kiểu trong khối. br: xuống dòng sau đoạn này. */
export type DeckRun = { t: string; br?: boolean; f: string; s: number; b: boolean; i: boolean; u: boolean; c: string; a: number; ls: number };
/** Khối chữ (tọa độ px trong slide). one: chữ nằm trên một dòng trong trình duyệt (PowerPoint không tự xuống dòng). */
export type DeckBox = { x: number; y: number; w: number; h: number; al: "left" | "center" | "right" | "justify"; lh: number; one: boolean; runs: DeckRun[]; name?: string }; // lh: bước dòng, px
/** Vật thể có tên (data-pptx-object-name / data-sx-morph) xuất thành ảnh riêng mang đúng tên: tên "!!…" trùng ở hai slide liền nhau thì PowerPoint Morph nối chúng. */
export type DeckPic = { x: number; y: number; w: number; h: number; data: string; name: string };
/** Biểu đồ có dữ liệu (data-sx-chart) dựng lại thành biểu đồ gốc của PowerPoint. ink: màu (hex) của khung chứa biểu đồ. */
export type DeckChart = { x: number; y: number; w: number; h: number; spec: ChartSpec; ink: Partial<Record<"ink" | "muted" | "accent" | "accent2" | "neutral" | "line" | "pos" | "neg", string>> };
export type DeckSlide = { bg: string; boxes: DeckBox[]; pics?: DeckPic[]; charts?: DeckChart[] };
/** Dữ liệu biểu đồ dùng chung cho bộ biểu đồ ECharts trong khung (echartskit.ts) và PowerPoint. */
export type ChartSpec = {
  type: "bar" | "line" | "area" | "pie" | "doughnut" | "radar" | "waterfall" | "sankey";
  labels?: string[]; series?: { name: string; data: number[] }[]; unit?: string; horizontal?: boolean; stacked?: boolean;
  /** Chuỗi (tên hoặc số thứ tự) mà tiêu đề nhắc tới: tô màu nhấn, chuỗi khác màu trung tính. */
  highlight?: string | number;
  /** waterfall: phần tử đầu và cuối là tổng (cột đặc), ở giữa là phần tăng / giảm. */
  total?: boolean;
  nodes?: { name: string }[]; links?: { source: string; target: string; value: number }[];
};

/**
 * Phần chạy trong khung xem (gắn vào cầu nối của artifact): sxPptx(id) đi qua từng slide, gửi {t:"pptx-step"} sau mỗi slide và
 * {t:"pptx", slides, w, h} khi xong. Dùng post, htmlToImage của cầu nối; __sxAll / __sxGo / __sxCur / __sxIdx của bộ chạy bản trình bày.
 * Viết bằng JS thuần, không dấu ` và không chuỗi đóng thẻ script (nằm trong một thẻ script).
 */
export const PPTX_FRAME_JS = String.raw`
var sxKitFonts=${JSON.stringify(Object.keys(FONT_SPEC))};
// Dừng chuyển động ở trạng thái cuối để chụp: phần tử chưa tới lượt trong stagger (opacity 0) không mất khỏi ảnh. window.__sxStatic: biểu đồ, nền 3D vẽ trong lúc chụp
// (slide chưa xem lần nào) không chạy hoạt ảnh, ảnh không bắt được cột đang mọc dở. Trả về hàm gỡ.
function sxFreeze(){var fz=document.createElement("style");fz.setAttribute("data-sx-noprint","");
fz.textContent="*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important}";
document.head.appendChild(fz);window.__sxStatic=(window.__sxStatic||0)+1;return function(){fz.remove();window.__sxStatic=Math.max(0,window.__sxStatic-1)}}
// Canvas WebGL (nền shader 3D, cảnh three.js): html-to-image chép canvas bằng toDataURL, canvas WebGL không giữ bộ đệm vẽ thì ra ô trống trong PNG / PowerPoint.
// Bộ 3D của Synchro bật preserveDrawingBuffer nên đọc được; canvas nào đọc ra trống thì ẩn tạm để lớp nền CSS dự phòng ngay dưới nó hiện ra thay vì một mảng đen.
// window.__sxStatic: bộ 3D vẽ khung hình tĩnh trong lúc chụp. Trả về hàm trả lại như cũ.
function sxGlFreeze(){var back=[],t=document.createElement("canvas");t.width=t.height=12;var x=t.getContext("2d",{willReadFrequently:true});window.__sxStatic=(window.__sxStatic||0)+1;
[].forEach.call(document.querySelectorAll("canvas"),function(c){if(!c.width||!c.height)return;var blank=true;try{x.clearRect(0,0,12,12);x.drawImage(c,0,0,12,12);var d=x.getImageData(0,0,12,12).data;for(var i=3;i<d.length;i+=4)if(d[i]>8){blank=false;break}}catch(e){blank=true}
if(blank){back.push([c,c.style.getPropertyValue("visibility"),c.style.getPropertyPriority("visibility")]);c.style.setProperty("visibility","hidden","important")}});
return function(){window.__sxStatic=Math.max(0,(window.__sxStatic||1)-1);back.forEach(function(b){b[0].style.removeProperty("visibility");if(b[1])b[0].style.setProperty("visibility",b[1],b[2])})}}
// Loại biểu đồ PowerPoint dựng lại được thành biểu đồ gốc (waterfall: cột chồng có chuỗi nền trong suốt).
var sxNative=["bar","line","area","pie","doughnut","radar","waterfall"];
// Khối có phần hình ngoài chữ (nền, viền, bóng, ảnh, SVG, canvas): xuất thành ảnh riêng; khối chỉ có chữ thì không.
function sxVisual(e){if(/^(IMG|SVG|CANVAS|VIDEO|PICTURE)$/i.test(e.tagName)||e.querySelector("img,svg,canvas,video,picture"))return true;var c=getComputedStyle(e);
return(c.backgroundColor!=="rgba(0, 0, 0, 0)"&&c.backgroundColor!=="transparent")||c.backgroundImage!=="none"||c.boxShadow!=="none"||["Top","Right","Bottom","Left"].some(function(sd){return parseFloat(c["border"+sd+"Width"])>0&&c["border"+sd+"Style"]!=="none"})}
// Màu chữ và màu nhấn của khung chứa biểu đồ (biến --sx-…) để biểu đồ gốc trong PowerPoint cùng bảng màu với trang.
var sxCv=null;function sxHex(c){if(!c)return"";try{sxCv=sxCv||document.createElement("canvas").getContext("2d",{willReadFrequently:true});sxCv.clearRect(0,0,1,1);sxCv.fillStyle="#000";sxCv.fillStyle=c;sxCv.fillRect(0,0,1,1);var d=sxCv.getImageData(0,0,1,1).data;if(d[3]<8)return"";return[d[0],d[1],d[2]].map(function(x){return(x<16?"0":"")+x.toString(16)}).join("").toUpperCase()}catch(e){return""}}
function sxInk(e){var c=getComputedStyle(e),v=function(n){return sxHex(c.getPropertyValue(n).trim())};return{ink:sxHex(c.color),muted:v("--sx-muted"),accent:v("--sx-accent"),accent2:v("--sx-accent2"),neutral:v("--sx-neutral"),line:v("--sx-line"),pos:v("--sx-pos"),neg:v("--sx-neg")}}
// Chụp PNG: slide đang xem, poster 3:4 hay ảnh chia sẻ 1200×630 (đúng khung, không kèm phần nền hai bên), hoặc cả trang. translate:none vì khung tự canh giữa bằng translate, bản sao trong ảnh không được lệch theo.
// scale (poster, ảnh chia sẻ): ảnh đúng scale lần cỡ thiết kế (3 → 3240×4320, 3600×1890). Chữ trong ảnh là vector vẽ lại ở cỡ đích nên vẫn nét, không phải phóng ảnh nhỏ.
function sxCapture(id,fontCss,scale){var thaw=sxFreeze(),gl=sxGlFreeze();requestAnimationFrame(function(){requestAnimationFrame(function(){
var P=document.querySelectorAll(".sx-poster,.sx-og"),fx=(window.__sxCur&&window.__sxCur())||(P.length===1?P[0]:null),el=fx||document.body;
var bg=getComputedStyle(el).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg=getComputedStyle(document.body).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg="#ffffff";
var w=el.scrollWidth||innerWidth,pr=fx?Math.max(2,1920/w):2,o={pixelRatio:pr,skipFonts:true,fontEmbedCSS:fontCss||undefined,backgroundColor:bg,style:fx?{translate:"none"}:undefined,width:w,height:el===document.body?Math.max(document.documentElement.scrollHeight,innerHeight):el.scrollHeight||innerHeight};
var dw=fx&&fx.matches(".sx-og")?1200:fx&&fx.matches(".sx-poster")?1080:0;
if(scale&&dw){var R=fx.getBoundingClientRect();o.width=R.width;o.height=R.height;o.pixelRatio=1;o.canvasWidth=dw*scale;o.canvasHeight=Math.round(dw*scale*R.height/R.width/10)*10}
function done(){gl();thaw()}
htmlToImage.toPng(el,o).then(function(u){done();post({t:"png",id:id,data:u})},function(x){done();post({t:"png",id:id,error:String(x&&x.message||x)})})})})}
function sxPptx(id,fontCss){
var all=window.__sxAll?window.__sxAll():[];
if(!all.length||!window.__sxGo||!window.__sxCur)return post({t:"pptx",id:id,error:"Không tìm thấy slide nào"});
var back=window.__sxIdx?window.__sxIdx():0,out=[],W=0,H=0;
var thaw=sxFreeze();
var cv=null;
// Trình duyệt trả màu oklch(), color-mix() dưới dạng color(srgb …) / oklch(…): đọc qua canvas về rgba, không thì chữ màu đó mất khỏi tệp PowerPoint.
function norm(c){try{cv=cv||document.createElement("canvas").getContext("2d",{willReadFrequently:true});cv.clearRect(0,0,1,1);cv.fillStyle=c;cv.fillRect(0,0,1,1);var d=cv.getImageData(0,0,1,1).data;return"rgba("+d[0]+","+d[1]+","+d[2]+","+d[3]/255+")"}catch(e){return""}}
function col(c){if(c&&/^(color|oklch|oklab|lab|lch|hwb|color-mix)\(/.test(c))c=norm(c);var m=/rgba?\(([^)]+)\)/.exec(c||"");if(!m)return null;var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);var a=p.length>3?p[3]:1;
function h(v){v=Math.max(0,Math.min(255,Math.round(v)));return(v<16?"0":"")+v.toString(16)}return{hex:(h(p[0])+h(p[1])+h(p[2])).toUpperCase(),a:a}}
function firstStop(bg){var m=/rgba?\([^)]+\)/.exec(bg||"");return m?col(m[0]):null}
function blockOf(n,root){for(var e=n.parentElement;e&&e!==root;e=e.parentElement){var d=getComputedStyle(e).display;if(d!=="inline"&&d!=="contents")return e}return root}
var web=null;function isWeb(x){if(!web){web=sxKitFonts.slice();try{document.fonts.forEach(function(f){web.push(f.family.replace(/["']/g,""))})}catch(e){}}return web.indexOf(x)>=0}
function fam(f){var x=(f||"").split(",")[0].replace(/["']/g,"").trim();
if(!x||/^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|ui-sans-serif)$/i.test(x))return"Arial";if(/^(serif|ui-serif)$/i.test(x))return"Georgia";if(/^(monospace|ui-monospace)$/i.test(x))return"Consolas";
if(isWeb(x))return/\bmonospace\b|ui-monospace/.test(f)?"Consolas":/(?:^|[,\s])(?:ui-)?serif\b/.test(f)?"Cambria":"Arial";return x}
function tf(x,cs){return cs.textTransform==="uppercase"?x.toUpperCase():cs.textTransform==="lowercase"?x.toLowerCase():x}
function hasBr(a,b){var r=document.createRange();r.setStart(a,a.nodeValue.length);r.setEnd(b,0);var f=r.cloneContents();return !!(f.querySelector&&f.querySelector("br"))}
function fail(x,restore){if(restore)restore();thaw();try{window.__sxGo(back)}catch(e){}post({t:"pptx",id:id,error:String(x&&x.message||x)})}
function step(i){
if(i>=all.length){thaw();window.__sxGo(back);return post({t:"pptx",id:id,slides:out,w:W,h:H})}
window.__sxGo(i);
requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){
var el=window.__sxCur();if(!el)return fail("Không mở được slide "+(i+1));
var gl=sxGlFreeze();
var R=el.getBoundingClientRect();W=R.width;H=R.height;
// Biểu đồ có dữ liệu (data-sx-chart, bộ biểu đồ của Synchro): PowerPoint dựng lại thành biểu đồ gốc sửa được số liệu; sankey không có trong PowerPoint nên giữ trong ảnh nền.
var charts=[],chartEls=[];[].forEach.call(el.querySelectorAll("[data-sx-chart]"),function(c){var sp=null;try{sp=JSON.parse(c.getAttribute("data-sx-chart"))}catch(e){}
if(!sp||sxNative.indexOf(sp.type)<0||!c.getClientRects().length)return;var r=c.getBoundingClientRect();charts.push({x:r.left-R.left,y:r.top-R.top,w:r.width,h:r.height,spec:sp,ink:sxInk(c)});chartEls.push(c)});
// Vật thể có tên (data-pptx-object-name, data-sx-morph: "!!hero" để PowerPoint Morph nối hai slide): khối có hình (ảnh, nền, viền, bóng) thành một ảnh riêng mang đúng tên,
// không bị dàn phẳng vào ảnh nền; khối chỉ có chữ thì tên gắn vào hộp chữ. Chỉ lấy khối ngoài cùng, khối lồng bên trong nằm trong ảnh của khối ngoài.
var NAMED="[data-pptx-object-name],[data-sx-morph]",objs=[];
function nm(e){return(e.getAttribute("data-pptx-object-name")||e.getAttribute("data-sx-morph")||"").trim().slice(0,80)}
[].forEach.call(el.querySelectorAll(NAMED),function(e){if(!nm(e)||!e.getClientRects().length)return;var up=e.parentElement&&e.parentElement.closest(NAMED);if(up&&el.contains(up))return;if(chartEls.some(function(c){return c===e||c.contains(e)}))return;objs.push({el:e,name:nm(e),pic:sxVisual(e),k:0})});
function objOf(e){for(var k=0;k<objs.length;k++)if(objs[k].el===e||objs[k].el.contains(e))return objs[k];return null}
var tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),groups=[],map=new Map(),n;
while((n=tw.nextNode())){
if(!n.nodeValue.trim())continue;var p=n.parentElement;
if(!p||p.closest("svg,script,style,noscript,template,[data-sx-noprint]"))continue;
if(chartEls.some(function(c){return c.contains(p)}))continue;
if(p.checkVisibility&&!p.checkVisibility({opacityProperty:true,visibilityProperty:true}))continue;
var b=blockOf(n,el),g=map.get(b);if(!g){g={b:b,nodes:[]};map.set(b,g);groups.push(g)}g.nodes.push(n)}
var boxes=[],wraps=[],clears=[];
groups.forEach(function(g){
var rg=document.createRange(),last=g.nodes[g.nodes.length-1];rg.setStart(g.nodes[0],0);rg.setEnd(last,last.nodeValue.length);
var r=rg.getBoundingClientRect();if(r.width<1||r.height<1)return;
var bcs=getComputedStyle(g.b),runs=[],lineTop=null;
g.nodes.forEach(function(t,k){
var cs=getComputedStyle(t.parentElement),txt=t.nodeValue.replace(/\s+/g," ");
if(k===0)txt=txt.replace(/^ /,"");if(k===g.nodes.length-1)txt=txt.replace(/ $/,"");
var fill=col(cs.webkitTextFillColor),c=fill&&fill.a>0.05?fill:col(cs.color),clip=null;
for(var e=t.parentElement;e&&e!==g.b.parentElement;e=e.parentElement){var ec=getComputedStyle(e);if(ec.webkitBackgroundClip==="text"||ec.backgroundClip==="text"){clip=e;break}}
if(clip&&(!fill||fill.a<0.05)){c=firstStop(getComputedStyle(clip).backgroundImage)||c;if(clears.indexOf(clip)<0)clears.push(clip)}
if(!c||c.a<0.05||!txt)return;
if(k>0&&runs.length&&hasBr(g.nodes[k-1],t)){runs[runs.length-1].br=true;lineTop=null}
var st={f:fam(cs.fontFamily),s:parseFloat(cs.fontSize)||16,b:(parseInt(cs.fontWeight,10)||400)>=600,i:cs.fontStyle==="italic",u:/underline/.test(cs.textDecorationLine||""),c:c.hex,a:c.a,ls:parseFloat(cs.letterSpacing)||0};
// Giữ đúng chỗ xuống dòng của trình duyệt: đo dòng của từng từ, sang dòng mới thì ngắt dòng ở đó (PowerPoint không tự xuống dòng nữa,
// phông thay thế rộng hơn cũng không làm vỡ thêm dòng hay đè lên khối bên dưới).
var src=t.nodeValue,re=/\S+\s*/g,m,seg=k>0&&/^\s/.test(t.nodeValue)?" ":"",lh0=parseFloat(cs.lineHeight)||st.s*1.2,wr=document.createRange();
while((m=re.exec(src))){wr.setStart(t,m.index);wr.setEnd(t,m.index+m[0].replace(/\s+$/,"").length);var rr=wr.getClientRects()[0];
if(rr&&lineTop!==null&&rr.top>lineTop+lh0*0.5&&(seg.trim()||runs.length)){if(seg.trim())runs.push(Object.assign({t:tf(seg.replace(/\s+$/,""),cs)},st));if(runs.length)runs[runs.length-1].br=true;seg=""}
if(rr)lineTop=rr.top;seg+=m[0].replace(/\s+/g," ")}
if(k===0)seg=seg.replace(/^ /,"");if(k===g.nodes.length-1)seg=seg.replace(/ $/,"");
if(seg)runs.push(Object.assign({t:tf(seg,cs)},st))});
if(!runs.length)return;
var fs=parseFloat(bcs.fontSize)||runs[0].s,lh=parseFloat(bcs.lineHeight);if(isNaN(lh))lh=fs*1.2;
var al=bcs.textAlign;al=al==="center"?"center":al==="right"||al==="end"?"right":al==="justify"?"justify":"left";
var ob=objOf(g.b),bn=ob?(++ob.k===1&&!ob.pic?ob.name:ob.name+"·"+ob.k):undefined;
boxes.push({x:r.left-R.left,y:r.top-R.top,w:r.width,h:r.height,al:al,lh:lh,one:r.height<lh*1.6,runs:runs,name:bn});
g.nodes.forEach(function(t){var s=document.createElement("span");s.setAttribute("data-sx-t","");s.style.cssText="color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important";t.parentNode.insertBefore(s,t);s.appendChild(t);wraps.push(s)})});
var saved=clears.map(function(e){var v=e.style.getPropertyValue("background-image"),pr=e.style.getPropertyPriority("background-image");e.style.setProperty("background-image","none","important");return[e,v,pr]});
function restore(){gl();wraps.forEach(function(s){var t=s.firstChild;if(t&&s.parentNode)s.parentNode.insertBefore(t,s);s.remove()});saved.forEach(function(x){x[0].style.removeProperty("background-image");if(x[1])x[0].style.setProperty("background-image",x[1],x[2])})}
var bg=getComputedStyle(el).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg=getComputedStyle(document.body).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg="#ffffff";
var pr=Math.max(1,2560/W),pics=[],hid=[];
function hide(e){hid.push([e,e.style.getPropertyValue("visibility"),e.style.getPropertyPriority("visibility")]);e.style.setProperty("visibility","hidden","important")}
function unhide(){hid.forEach(function(x){x[0].style.removeProperty("visibility");if(x[1])x[0].style.setProperty("visibility",x[1],x[2])});hid=[]}
var restore0=restore;restore=function(){unhide();restore0()};
var todo=objs.filter(function(o){return o.pic});
(function pic(k){if(k>=todo.length){todo.forEach(function(o){hide(o.el)});chartEls.forEach(hide);
return htmlToImage.toPng(el,{pixelRatio:pr,skipFonts:true,fontEmbedCSS:fontCss||undefined,backgroundColor:bg,style:{translate:"none"},width:W,height:H}).then(function(u){
restore();out.push({bg:u,boxes:boxes,pics:pics,charts:charts});post({t:"pptx-step",id:id,i:i+1,n:all.length});step(i+1)},function(x){fail(x,restore)})}
var o=todo[k],r=o.el.getBoundingClientRect();
htmlToImage.toPng(o.el,{pixelRatio:pr,skipFonts:true,fontEmbedCSS:fontCss||undefined,style:{translate:"none",margin:"0"},width:r.width,height:r.height}).then(function(u){
pics.push({x:r.left-R.left,y:r.top-R.top,w:r.width,h:r.height,data:u,name:o.name});pic(k+1)},function(x){fail(x,restore)})})(0)
},80)})})}
step(0)}
`;

const SLIDE_W = 13.333, SLIDE_H = 7.5;
// Bản trình duyệt của pptxgenjs (MIT, kèm JSZip), lưu ở public/vendor; dự phòng jsDelivr cùng mã kiểm tra. Không dùng gói npm: bản ES của
// nó đòi node:https nên webpack không dựng được cho trình duyệt.
const LIB = ["/vendor/pptxgen-4.0.1.bundle.js", "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js"];
const SRI = "sha384-qb0Xhi7LLYpvW1HCK6oMrmDLSY9sy7vwm6ZlV6KjtrlL9yg30+YN4neTwnmX+Kp8";
// Phần API của pptxgenjs 4 mà Synchro dùng (thư viện nạp lúc chạy, không cài gói npm).
type PptxSlide = {
  background: { data: string };
  addText: (runs: { text: string; options: Record<string, unknown> }[], opts: Record<string, unknown>) => void;
  addImage: (opts: Record<string, unknown>) => void;
  addChart: (type: string, data: { name: string; labels: string[]; values: number[] }[], opts: Record<string, unknown>) => void;
};
type Pptx = { layout: string; title: string; company: string; addSlide: () => PptxSlide; write: (o: { outputType: "blob" }) => Promise<unknown> };
type Ctor = new () => Pptx;
let lib: Promise<Ctor> | null = null;
function loadLib(): Promise<Ctor> {
  const w = window as unknown as { PptxGenJS?: Ctor };
  if (w.PptxGenJS) return Promise.resolve(w.PptxGenJS);
  lib ??= new Promise<Ctor>((ok, no) => {
    const tryAt = (i: number) => {
      if (i >= LIB.length) { lib = null; return no(new Error("Không tải được thư viện PowerPoint")); }
      const s = document.createElement("script");
      s.src = LIB[i]; s.integrity = SRI; s.crossOrigin = "anonymous";
      s.onload = () => (w.PptxGenJS ? ok(w.PptxGenJS) : (s.remove(), tryAt(i + 1)));
      s.onerror = () => { s.remove(); tryAt(i + 1); };
      document.head.appendChild(s);
    };
    tryAt(0);
  });
  return lib;
}

/**
 * Tùy chọn hộp chữ PowerPoint cho một khối đã đo. Bước dòng ghi bằng điểm (spcPts), không ghi bội số: line-height của CSS là bội của cỡ chữ, spcPct của PowerPoint là bội của
 * chiều cao dòng tự nhiên của phông (Plus Jakarta Sans 1,26em), ghi thẳng thì dòng rộng thêm khoảng 20%, tiêu đề cao hơn hộp và đè khối dưới. Điểm thì phông thay thế cũng giữ đúng bước dòng.
 */
export function boxOptions(b: DeckBox, w: number, h: number) {
  const sx = SLIDE_W / w, sy = SLIDE_H / h, pt = (px: number) => Math.round(px * (SLIDE_W * 72) / w * 10) / 10;
  // Chỗ xuống dòng đã lấy đúng theo trình duyệt (breakLine): PowerPoint không tự xuống dòng; nới khung 8% cho phông thay thế rộng hơn.
  const extra = b.w * 0.08;
  const x = b.al === "center" ? b.x - extra / 2 : b.al === "right" ? b.x - extra : b.x;
  return { x: Math.max(0, x * sx), y: Math.max(0, b.y * sy), w: Math.min(SLIDE_W, (b.w + extra) * sx), h: Math.max(0.1, b.h * sy), align: b.al, valign: "top", margin: 0, wrap: false, fit: "none", lineSpacing: pt(b.lh) };
}

const pxIn = (w: number) => (px: number) => (px * SLIDE_W) / w;

/** Dữ liệu và tùy chọn addChart của pptxgenjs cho một biểu đồ; null khi PowerPoint không có loại đó (sankey) hay dữ liệu hỏng. */
export function chartArgs(c: DeckChart, w: number) {
  const sp = c.spec, labels = (sp.labels ?? []).map(String), series = (sp.series ?? []).filter((x) => x && Array.isArray(x.data)).slice(0, 8);
  if (!labels.length || !series.length || sp.type === "sankey") return null;
  const k = c.ink, ink = k.ink || "1F2937", muted = k.muted || "6B7280", accent = k.accent || "2563EB", neutral = k.neutral || k.line || "9CA3AF";
  const pt = (px: number) => Math.max(8, Math.round(px * (SLIDE_W * 72) / w));
  const hi = typeof sp.highlight === "number" ? sp.highlight : series.findIndex((x) => x.name === sp.highlight);
  // Một chuỗi nhấn, các chuỗi khác trung tính (luật biểu đồ của bộ thiết kế); không nói chuỗi nào thì chuỗi đầu nhấn, chuỗi sau dùng màu phụ rồi trung tính.
  const palette = series.map((_, i) => (hi >= 0 ? (i === hi ? accent : neutral) : [accent, k.accent2 || neutral, neutral, muted, k.line || "D1D5DB"][i] ?? neutral));
  const base = { x: pxIn(w)(c.x), y: pxIn(w)(c.y), w: pxIn(w)(c.w), h: pxIn(w)(c.h), fontFace: "Arial", catAxisLabelColor: muted, valAxisLabelColor: muted, catAxisLabelFontSize: pt(13), valAxisLabelFontSize: pt(12),
    dataLabelColor: ink, dataLabelFontSize: pt(12), legendColor: muted, legendFontSize: pt(12), valGridLine: { style: "none" }, catGridLine: { style: "none" }, catAxisLineShow: true, valAxisHidden: true,
    showLegend: series.length > 1, legendPos: "t", showValue: true, dataLabelFormatCode: (series.every((x) => x.data.every((v) => Number.isInteger(Number(v)))) ? "#,##0" : "#,##0.0") + (sp.unit ? `"${sp.unit.replace(/"/g, "")}"` : ""), chartColors: palette };
  const data = series.map((x) => ({ name: x.name || "", labels, values: labels.map((_, i) => Number(x.data[i]) || 0) }));
  switch (sp.type) {
    case "bar": return { type: "bar", data, opts: { ...base, barDir: sp.horizontal ? "bar" : "col", barGrouping: sp.stacked ? "stacked" : "clustered", barGapWidthPct: 60 } };
    case "line": return { type: "line", data, opts: { ...base, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 6, showValue: series.length === 1, valAxisHidden: series.length !== 1 ? false : true } };
    case "area": return { type: "area", data, opts: { ...base, barGrouping: sp.stacked ? "stacked" : "standard", chartColorsOpacity: 60, showValue: false, valAxisHidden: false } };
    case "pie": case "doughnut": {
      const pal = labels.map((_, i) => [accent, k.accent2 || neutral, neutral, muted, k.line || "D1D5DB", k.pos || "059669"][i % 6]);
      return { type: sp.type, data: data.slice(0, 1), opts: { ...base, chartColors: pal, holeSize: 62, showLegend: true, legendPos: "r", showValue: false, showPercent: true, dataLabelColor: "FFFFFF", dataBorder: { pt: 1, color: "FFFFFF" } } };
    }
    case "radar": return { type: "radar", data, opts: { ...base, radarStyle: "marker", lineSize: 2, showValue: false, valAxisHidden: false } };
    case "waterfall": {
      // Cột chồng: chuỗi nền trong suốt (tên __sx_base, xuất xong thì bỏ màu) + tăng + giảm + tổng.
      const d = data[0].values, n = d.length, up: number[] = [], down: number[] = [], tot: number[] = [], basev: number[] = [];
      let cum = 0;
      d.forEach((v, i) => {
        const isTot = !!sp.total && (i === 0 || i === n - 1);
        if (isTot) { const t = i === 0 ? v : cum; basev.push(0); tot.push(t); up.push(0); down.push(0); cum = i === 0 ? v : cum; return; }
        basev.push(v >= 0 ? cum : cum + v); up.push(v >= 0 ? v : 0); down.push(v < 0 ? -v : 0); tot.push(0); cum += v;
      });
      const wf = [{ name: "__sx_base", labels, values: basev }, { name: "Tăng", labels, values: up }, { name: "Giảm", labels, values: down }, { name: "Tổng", labels, values: tot }];
      return { type: "bar", data: wf, opts: { ...base, barDir: "col", barGrouping: "stacked", barGapWidthPct: 40, showLegend: false, showValue: false, valAxisHidden: false, chartColors: [neutral, k.pos || "059669", k.neg || "DC2626", accent] } };
    }
  }
  return null;
}

/** Chuỗi nền của waterfall (__sx_base) không màu, không nhãn: phần chuỗi đó trong tệp biểu đồ. */
export function clearWaterfallBase(xml: string): string {
  return xml.replace(/<c:ser>(?:(?!<\/c:ser>)[\s\S])*?<c:v>__sx_base<\/c:v>[\s\S]*?<\/c:ser>/g, (ser) => {
    let out = ser.replace(/<c:spPr>[\s\S]*?<\/c:spPr>/, "<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>").replace(/<c:dLbls>[\s\S]*?<\/c:dLbls>/, "<c:dLbls><c:delete val=\"1\"/></c:dLbls>");
    if (!/<c:spPr>/.test(out)) out = out.replace(/(<\/c:tx>)/, "$1<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>");
    return out;
  });
}

// Chuyển cảnh Morph (PowerPoint 2019 / 365) đúng như PowerPoint tự ghi: p159:morph trong mc:AlternateContent, máy không hỗ trợ (Keynote, LibreOffice, PowerPoint cũ) dùng Fade.
// pptxgenjs không ghi chuyển cảnh nên chèn thẳng vào XML của slide, ngay sau </p:clrMapOvr> (đúng thứ tự phần tử của p:sld).
export const MORPH_XML = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
export function withMorphXml(xml: string): string {
  if (xml.includes("p159:morph")) return xml;
  return xml.replace(/<p:transition\b[\s\S]*?<\/p:transition>|<p:transition\b[^>]*\/>/g, "").replace("</p:clrMapOvr>", `</p:clrMapOvr>${MORPH_XML}`);
}
/** Slide (đếm từ 0) cần Morph: có vật thể tên "!!…" trùng với slide ngay trước. */
export function morphSlides(slides: DeckSlide[]): number[] {
  const names = slides.map((s) => new Set([...s.boxes.map((b) => b.name), ...(s.pics ?? []).map((p) => p.name)].filter((n): n is string => !!n && n.startsWith("!!"))));
  return names.flatMap((set, i) => (i > 0 && [...set].some((n) => names[i - 1].has(n)) ? [i] : []));
}
type Zip = { file: { (name: string): { async: (t: "string") => Promise<string> } | null; (name: string, data: string): unknown }; generateAsync: (o: Record<string, unknown>) => Promise<Blob> };
type ZipCtor = { loadAsync: (b: Blob | ArrayBuffer | Uint8Array) => Promise<Zip & { files: Record<string, unknown> }> };
/** Hậu kỳ tệp pptxgenjs: chèn Morph vào các slide cần, bỏ màu chuỗi nền của waterfall. JSZip: bản kèm trong pptxgen.bundle.js (window.JSZip). */
export async function finishPptx(blob: Blob, JSZip: ZipCtor, morph: number[]): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  let touched = false;
  for (const i of morph) {
    const f = `ppt/slides/slide${i + 1}.xml`, x = await zip.file(f)?.async("string");
    if (x) { zip.file(f, withMorphXml(x)); touched = true; }
  }
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) {
    const x = await zip.file(f)?.async("string");
    if (x && x.includes("__sx_base")) { zip.file(f, clearWaterfallBase(x)); touched = true; }
  }
  return touched ? zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" }) : blob;
}

/** Dựng tệp .pptx (16:9) từ dữ liệu khung xem đã đo: ảnh nền mỗi slide + vật thể có tên + biểu đồ gốc + hộp chữ sửa được, rồi Morph giữa các slide chung vật thể "!!…". */
export async function buildPptx(slides: DeckSlide[], w: number, h: number, title: string): Promise<Blob> {
  const PptxGenJS = await loadLib();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.company = "Synchro";
  const pt = (px: number) => Math.round(px * (SLIDE_W * 72) / w * 10) / 10, inch = pxIn(w);
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { data: s.bg };
    for (const p of s.pics ?? []) slide.addImage({ data: p.data, x: inch(p.x), y: inch(p.y), w: inch(p.w), h: inch(p.h), objectName: p.name });
    for (const c of s.charts ?? []) { const a = chartArgs(c, w); if (a) slide.addChart(a.type, a.data, a.opts); }
    for (const b of s.boxes) {
      slide.addText(b.runs.map((r) => ({
        text: r.t,
        options: {
          fontFace: r.f, fontSize: pt(r.s), bold: r.b, italic: r.i, underline: r.u ? { style: "sng" as const } : undefined,
          color: r.c, transparency: r.a < 1 ? Math.round((1 - r.a) * 100) : undefined, charSpacing: r.ls ? pt(r.ls) : undefined, breakLine: r.br || undefined,
        },
      })), { ...boxOptions(b, w, h), ...(b.name ? { objectName: b.name } : {}) });
    }
  }
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  const JSZip = (window as unknown as { JSZip?: ZipCtor }).JSZip;
  const morph = morphSlides(slides);
  if (!JSZip || (!morph.length && !slides.some((s) => s.charts?.some((c) => c.spec.type === "waterfall")))) return blob;
  return finishPptx(blob, JSZip, morph);
}
