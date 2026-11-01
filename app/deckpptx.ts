"use client";
// Xuất bản trình bày HTML thành PowerPoint (.pptx) chỉnh sửa được, không cần model: chạy ngay trong khung xem của Synchro.
// Mỗi slide: (1) đo từng khối chữ đang hiện (vị trí, phông, cỡ, đậm / nghiêng, màu, giãn chữ, canh lề, khoảng cách dòng) → hộp chữ PowerPoint
// sửa được; (2) ẩn riêng phần chữ rồi chụp phần còn lại (nền, hình minh họa SVG, biểu đồ, đường kẻ, ảnh) thành ảnh nền nét cao đặt dưới hộp chữ.
// Chuyển động CSS dừng ở trạng thái cuối khi chụp (PowerPoint không đọc được CSS / JS). Phông chữ đặt đúng tên của bản trình bày; máy chưa cài
// phông đó thì PowerPoint thay phông khác.

/** Một đoạn chữ cùng kiểu trong khối. br: xuống dòng sau đoạn này. */
export type DeckRun = { t: string; br?: boolean; f: string; s: number; b: boolean; i: boolean; u: boolean; c: string; a: number; ls: number };
/** Khối chữ (tọa độ px trong slide). one: chữ nằm trên một dòng trong trình duyệt (PowerPoint không tự xuống dòng). */
export type DeckBox = { x: number; y: number; w: number; h: number; al: "left" | "center" | "right" | "justify"; lh: number; one: boolean; runs: DeckRun[] };
export type DeckSlide = { bg: string; boxes: DeckBox[] };

/**
 * Phần chạy trong khung xem (gắn vào cầu nối của artifact): sxPptx(id) đi qua từng slide, gửi {t:"pptx-step"} sau mỗi slide và
 * {t:"pptx", slides, w, h} khi xong. Dùng post, htmlToImage của cầu nối; __sxAll / __sxGo / __sxCur / __sxIdx của bộ chạy bản trình bày.
 * Viết bằng JS thuần, không dấu ` và không chuỗi đóng thẻ script (nằm trong một thẻ script).
 */
export const PPTX_FRAME_JS = String.raw`
function sxPptx(id){
var all=window.__sxAll?window.__sxAll():[];
if(!all.length||!window.__sxGo||!window.__sxCur)return post({t:"pptx",id:id,error:"Không tìm thấy slide nào"});
var back=window.__sxIdx?window.__sxIdx():0,out=[],W=0,H=0;
var fz=document.createElement("style");fz.setAttribute("data-sx-noprint","");
fz.textContent="*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important}";
document.head.appendChild(fz);
function col(c){var m=/rgba?\(([^)]+)\)/.exec(c||"");if(!m)return null;var p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);var a=p.length>3?p[3]:1;
function h(v){v=Math.max(0,Math.min(255,Math.round(v)));return(v<16?"0":"")+v.toString(16)}return{hex:(h(p[0])+h(p[1])+h(p[2])).toUpperCase(),a:a}}
function firstStop(bg){var m=/rgba?\([^)]+\)/.exec(bg||"");return m?col(m[0]):null}
function blockOf(n,root){for(var e=n.parentElement;e&&e!==root;e=e.parentElement){var d=getComputedStyle(e).display;if(d!=="inline"&&d!=="contents")return e}return root}
function fam(f){var x=(f||"").split(",")[0].replace(/["']/g,"").trim();
if(!x||/^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|ui-sans-serif)$/i.test(x))return"Arial";if(/^(serif|ui-serif)$/i.test(x))return"Georgia";if(/^(monospace|ui-monospace)$/i.test(x))return"Consolas";return x}
function tf(x,cs){return cs.textTransform==="uppercase"?x.toUpperCase():cs.textTransform==="lowercase"?x.toLowerCase():x}
function hasBr(a,b){var r=document.createRange();r.setStart(a,a.nodeValue.length);r.setEnd(b,0);var f=r.cloneContents();return !!(f.querySelector&&f.querySelector("br"))}
function fail(x,restore){if(restore)restore();fz.remove();try{window.__sxGo(back)}catch(e){}post({t:"pptx",id:id,error:String(x&&x.message||x)})}
function step(i){
if(i>=all.length){fz.remove();window.__sxGo(back);return post({t:"pptx",id:id,slides:out,w:W,h:H})}
window.__sxGo(i);
requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){
var el=window.__sxCur();if(!el)return fail("Không mở được slide "+(i+1));
var R=el.getBoundingClientRect();W=R.width;H=R.height;
var tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),groups=[],map=new Map(),n;
while((n=tw.nextNode())){
if(!n.nodeValue.trim())continue;var p=n.parentElement;
if(!p||p.closest("svg,script,style,noscript,template,[data-sx-noprint]"))continue;
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
boxes.push({x:r.left-R.left,y:r.top-R.top,w:r.width,h:r.height,al:al,lh:lh/fs,one:r.height<lh*1.6,runs:runs});
g.nodes.forEach(function(t){var s=document.createElement("span");s.setAttribute("data-sx-t","");s.style.cssText="color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important";t.parentNode.insertBefore(s,t);s.appendChild(t);wraps.push(s)})});
var saved=clears.map(function(e){var v=e.style.getPropertyValue("background-image"),pr=e.style.getPropertyPriority("background-image");e.style.setProperty("background-image","none","important");return[e,v,pr]});
function restore(){wraps.forEach(function(s){var t=s.firstChild;if(t&&s.parentNode)s.parentNode.insertBefore(t,s);s.remove()});saved.forEach(function(x){x[0].style.removeProperty("background-image");if(x[1])x[0].style.setProperty("background-image",x[1],x[2])})}
var bg=getComputedStyle(el).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg=getComputedStyle(document.body).backgroundColor;if(!bg||bg==="rgba(0, 0, 0, 0)")bg="#ffffff";
htmlToImage.toPng(el,{pixelRatio:Math.max(1,2560/W),skipFonts:true,backgroundColor:bg,width:W,height:H}).then(function(u){
restore();out.push({bg:u,boxes:boxes});post({t:"pptx-step",id:id,i:i+1,n:all.length});step(i+1)},function(x){fail(x,restore)})
},80)})})}
step(0)}
`;

const SLIDE_W = 13.333, SLIDE_H = 7.5;
// Bản trình duyệt của pptxgenjs (MIT, kèm JSZip), lưu ở public/vendor; dự phòng jsDelivr cùng mã kiểm tra. Không dùng gói npm: bản ES của
// nó đòi node:https nên webpack không dựng được cho trình duyệt.
const LIB = ["/vendor/pptxgen-4.0.1.bundle.js", "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js"];
const SRI = "sha384-qb0Xhi7LLYpvW1HCK6oMrmDLSY9sy7vwm6ZlV6KjtrlL9yg30+YN4neTwnmX+Kp8";
// Phần API của pptxgenjs 4 mà Synchro dùng (thư viện nạp lúc chạy, không cài gói npm).
type PptxSlide = { background: { data: string }; addText: (runs: { text: string; options: Record<string, unknown> }[], opts: Record<string, unknown>) => void };
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

/** Dựng tệp .pptx (16:9) từ dữ liệu khung xem đã đo: ảnh nền mỗi slide + hộp chữ sửa được. */
export async function buildPptx(slides: DeckSlide[], w: number, h: number, title: string): Promise<Blob> {
  const PptxGenJS = await loadLib();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.company = "Synchro";
  const sx = SLIDE_W / w, sy = SLIDE_H / h, pt = (px: number) => Math.round(px * (SLIDE_W * 72) / w * 10) / 10;
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { data: s.bg };
    for (const b of s.boxes) {
      // Chỗ xuống dòng đã lấy đúng theo trình duyệt (breakLine): PowerPoint không tự xuống dòng; nới khung 8% cho phông thay thế rộng hơn.
      const extra = b.w * 0.08;
      const x = b.al === "center" ? b.x - extra / 2 : b.al === "right" ? b.x - extra : b.x;
      slide.addText(b.runs.map((r) => ({
        text: r.t,
        options: {
          fontFace: r.f, fontSize: pt(r.s), bold: r.b, italic: r.i, underline: r.u ? { style: "sng" as const } : undefined,
          color: r.c, transparency: r.a < 1 ? Math.round((1 - r.a) * 100) : undefined, charSpacing: r.ls ? pt(r.ls) : undefined, breakLine: r.br || undefined,
        },
      })), {
        x: Math.max(0, x * sx), y: Math.max(0, b.y * sy), w: Math.min(SLIDE_W, (b.w + extra) * sx), h: Math.max(0.1, b.h * sy),
        align: b.al, valign: "top", margin: 0, wrap: false, fit: "none", lineSpacingMultiple: Math.min(3, Math.max(0.7, Math.round(b.lh * 100) / 100)),
      });
    }
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
