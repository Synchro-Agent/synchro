// Trình xem tệp Office (Word, Excel / CSV, PowerPoint) chạy trong khung cô lập (iframe sandbox, không cùng nguồn gốc
// với Synchro, CSP chặn gọi mạng). Synchro gửi nội dung tệp vào bằng postMessage; khung tự dựng phần xem trước:
//   docx → mammoth chuyển sang HTML; xlsx / csv → SheetJS dựng bảng từng trang tính;
//   pptx → tự đọc XML của từng slide (vị trí, chữ, màu, ảnh, bảng) và vẽ lại theo tỉ lệ slide.
// Thư viện tải từ /vendor của Synchro, dự phòng bản giống hệt trên jsDelivr (mã băm SRI).

export type OfficeKind = "docx" | "xlsx" | "csv" | "pptx" | "pdf";
type Lib = [string, string, string];
const JSZIP: Lib = ["jszip-3.10.1.min.js", "jszip@3.10.1/dist/jszip.min.js", "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG"];
const MAMMOTH: Lib = ["mammoth-1.8.0.min.js", "mammoth@1.8.0/mammoth.browser.min.js", "sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y"];
const XLSX: Lib = ["xlsx-0.18.5.min.js", "xlsx@0.18.5/dist/xlsx.full.min.js", "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw"];
// pdf.js: nạp sẵn worker như script thường (khung cô lập không tạo được Web Worker), pdf.js tự chạy worker trên luồng chính.
const PDFW: Lib = ["pdf.worker-3.11.174.min.js", "pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js", "sha384-sS8B4COeBqzQV9DaPpp5cbpF+xz2jPcFbN3L8FL3/dx0RMC6WLUwTUOFm0iFb1lw"];
const PDFJS: Lib = ["pdf-3.11.174.min.js", "pdfjs-dist@3.11.174/legacy/build/pdf.min.js", "sha384-OemFRmhjDZwhIKuUld0HJozkF2YErsgDaCL41trxGQZt4/WgnopJQqQl2DvDZ07Z"];
const LIBS: Record<OfficeKind, Lib[]> = { docx: [MAMMOTH], xlsx: [XLSX], csv: [XLSX], pptx: [JSZIP], pdf: [PDFW, PDFJS] };
export const officeKind = (name: string): OfficeKind | null => {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return e === "docx" ? "docx" : e === "xlsx" || e === "xlsm" ? "xlsx" : e === "csv" || e === "tsv" ? "csv" : e === "pptx" ? "pptx" : e === "pdf" ? "pdf" : null;
};

const CDNS = "https://cdn.jsdelivr.net";
const CSS = `:root{color-scheme:light}html,body{margin:0;background:#ecebe8;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f1f1f}
.ld{position:fixed;inset:0;display:grid;place-items:center}.ld i{width:22px;height:22px;border-radius:50%;border:2px solid #d6d6d0;border-top-color:#545452;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.err{margin:24px;padding:14px 16px;border-radius:10px;background:#fff3f0;color:#9a2b16;font-size:14px}
.page{background:#fff;max-width:780px;margin:20px auto;padding:56px 64px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06);line-height:1.55;font-size:15px}
.page h1{font-size:26px}.page h1.title{font-size:30px;margin-top:0}.page .subtitle{color:#666;font-size:17px}.page blockquote{border-left:3px solid #ccc;margin:10px 0;padding-left:14px;color:#555}.page h2{font-size:20px}.page h3{font-size:17px}.page table{border-collapse:collapse;margin:10px 0}.page td,.page th{border:1px solid #c9c9c9;padding:5px 8px;vertical-align:top}.page img{max-width:100%}
.tabs{position:sticky;top:0;display:flex;gap:4px;padding:8px 10px;background:#f7f7f5;border-bottom:1px solid #ddd;overflow-x:auto;z-index:2}
.tabs button{border:0;background:none;padding:6px 12px;border-radius:7px;font:inherit;font-size:13px;color:#555;cursor:pointer;white-space:nowrap}.tabs button.on{background:#fff;color:#111;box-shadow:0 0 0 1px #ddd}
.sheet{padding:12px;overflow:auto}.sheet table{border-collapse:collapse;background:#fff;font-size:13px}.sheet td{border:1px solid #e0e0dc;padding:4px 8px;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
.sheet tr:first-child td{background:#f3f3f0;font-weight:600}.sheet td[data-t="s"][data-v^="="]{color:#2f6f4f;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.deck{padding:16px;display:flex;flex-direction:column;gap:18px;align-items:center}.sw{width:100%;max-width:1100px}.sw>em{display:block;font-style:normal;font-size:12px;color:#777;margin:0 0 6px}
.sl{position:relative;width:100%;overflow:hidden;background:#fff;container-type:inline-size;box-shadow:0 1px 3px rgba(0,0,0,.1),0 8px 24px rgba(0,0,0,.08);border-radius:4px}
.sh{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}.sh p{margin:0;line-height:1.2;white-space:pre-wrap;word-wrap:break-word}.sh img{width:100%;height:100%;object-fit:fill;display:block}
.pdfs{padding:16px;display:flex;flex-direction:column;align-items:center;gap:14px}.pdfs canvas{background:#fff;max-width:100%;box-shadow:0 1px 3px rgba(0,0,0,.1),0 8px 24px rgba(0,0,0,.08)}
.sh table{width:100%;height:100%;border-collapse:collapse}.sh td{border:1px solid #bbb;padding:.4cqw .6cqw;vertical-align:top}.ph{display:grid;place-items:center;background:#f0f0ee;color:#999;font-size:1.2cqw}`;

// Toàn bộ mã của khung xem (chuỗi), chạy trong sandbox. Không dùng innerHTML với dữ liệu của tệp trừ kết quả của
// mammoth / SheetJS (đã thoát ký tự); phần PowerPoint dựng bằng textContent.
const VIEWER = String.raw`
var NS={p:"http://schemas.openxmlformats.org/presentationml/2006/main",a:"http://schemas.openxmlformats.org/drawingml/2006/main",r:"http://schemas.openxmlformats.org/officeDocument/2006/relationships"};
function post(m){m.__synchro=CH;try{parent.postMessage(m,"*")}catch(e){}}
function fail(m){document.getElementById("v").innerHTML="";var d=document.createElement("div");d.className="err";d.textContent=m;document.getElementById("v").appendChild(d);post({t:"error",message:m})}
function load(l,cb){var n=0;(function t(){if(n>1)return cb(false);var s=document.createElement("script");s.src=l[n++];s.crossOrigin="anonymous";s.integrity=l[2];s.onload=function(){cb(true)};s.onerror=function(){s.remove();t()};document.head.appendChild(s)})()}
function loadAll(i,cb){if(i>=LIBS.length)return cb(true);load(LIBS[i],function(ok){ok?loadAll(i+1,cb):cb(false)})}
var buf=null,ready=false;
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__synchro!==CH||d.t!=="file")return;buf=d.buf;go()});
loadAll(0,function(ok){if(!ok)return fail("Không tải được thư viện xem tệp. Kiểm tra kết nối mạng.");ready=true;post({t:"ready"});go()});
function go(){if(!ready||!buf)return;var b=buf;buf=null;try{R[KIND](b)}catch(e){fail("Không đọc được tệp: "+(e&&e.message||e))}}
function el(tag,cls,txt){var x=document.createElement(tag);if(cls)x.className=cls;if(txt!=null)x.textContent=txt;return x}
var R={
docx:function(b){mammoth.convertToHtml({arrayBuffer:b},{styleMap:["p[style-name='Title'] => h1.title:fresh","p[style-name='Subtitle'] => p.subtitle:fresh","p[style-name='Quote'] => blockquote:fresh"]}).then(function(r){var v=document.getElementById("v");v.innerHTML="";var pg=el("article","page");pg.innerHTML=r.value;[].forEach.call(pg.querySelectorAll("a[href]"),function(a){if(!/^(https?:|mailto:|#)/i.test(a.getAttribute("href")))a.removeAttribute("href")});v.appendChild(pg);post({t:"done"})},function(e){fail("Không đọc được tệp Word: "+e.message)})},
csv:function(b){var t=new TextDecoder("utf-8").decode(b);sheets(XLSX.read(t,{type:"string",raw:true,FS:NAME.toLowerCase().endsWith(".tsv")?"\t":undefined}))},
xlsx:function(b){sheets(XLSX.read(new Uint8Array(b),{type:"array",cellDates:true}))},
pdf:function(b){pdfjsLib.GlobalWorkerOptions.workerSrc=LIBS[0][0];pdfjsLib.getDocument({data:new Uint8Array(b),isEvalSupported:false,useSystemFonts:true}).promise.then(function(doc){
var v=document.getElementById("v");v.innerHTML="";var box=el("div","pdfs");v.appendChild(box);var n=doc.numPages,w=Math.min((box.clientWidth||800)-32,980),chain=Promise.resolve();
for(var i=1;i<=Math.min(n,200);i++)(function(i){chain=chain.then(function(){return doc.getPage(i)}).then(function(pg){var vp1=pg.getViewport({scale:1}),dpr=window.devicePixelRatio||1,vp=pg.getViewport({scale:w/vp1.width*dpr});
var c=el("canvas");c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);c.style.width=w+"px";box.appendChild(c);return pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise})})(i);
chain.then(function(){post({t:"done",pages:n})},function(e){fail("Không đọc được tệp PDF: "+(e&&e.message||e))})},function(e){fail("Không đọc được tệp PDF: "+(e&&e.message||e))})},
pptx:function(b){JSZip.loadAsync(b).then(pptx).catch(function(e){fail("Không đọc được tệp PowerPoint: "+(e&&e.message||e))})}};
function sheets(wb){var v=document.getElementById("v");v.innerHTML="";var names=wb.SheetNames,tabs=el("div","tabs"),box=el("div","sheet");
function show(i){[].forEach.call(tabs.children,function(c,k){c.classList.toggle("on",k===i)});var ws=wb.Sheets[names[i]];for(var k in ws){var c=ws[k];if(k.charAt(0)!=="!"&&c&&c.f&&(c.v===undefined||c.v===""||c.v===null)){c.t="s";c.v="="+c.f;c.w="="+c.f}}box.innerHTML=XLSX.utils.sheet_to_html(ws,{header:"",footer:""})}
if(names.length>1){names.forEach(function(n,i){var bt=el("button",null,n);bt.onclick=function(){show(i)};tabs.appendChild(bt)});v.appendChild(tabs)}
v.appendChild(box);show(0);post({t:"done",pages:names.length})}

// ---------- PowerPoint
function pptx(zip){
var txt=function(p){var f=zip.file(p);return f?f.async("string"):Promise.resolve(null)};
var X=function(s){return s?new DOMParser().parseFromString(s,"application/xml"):null};
function kids(e,ns,n){return e?[].filter.call(e.children,function(c){return c.localName===n&&c.namespaceURI===NS[ns]}):[]}
function one(e,ns,n){return kids(e,ns,n)[0]||null}
function path(e,steps){for(var i=0;i<steps.length&&e;i++){var s=steps[i].split(":");e=one(e,s[0],s[1])}return e}
function res(dir,t){if(t.charAt(0)==="/")return t.slice(1);var o=[];(dir+"/"+t).split("/").forEach(function(p){if(p==="..")o.pop();else if(p&&p!==".")o.push(p)});return o.join("/")}
function rels(p){var i=p.lastIndexOf("/"),dir=p.slice(0,i);return txt(dir+"/_rels/"+p.slice(i+1)+".rels").then(function(s){var m={},d=X(s);if(d)[].forEach.call(d.getElementsByTagName("Relationship"),function(r){m[r.getAttribute("Id")]={t:r.getAttribute("TargetMode")==="External"?null:res(dir,r.getAttribute("Target")),type:r.getAttribute("Type")||""}});return m})}
function byType(m,k){for(var id in m)if(m[id].type.slice(-k.length)===k)return m[id].t;return null}
var theme={},major="",minor="",clrMap={bg1:"lt1",tx1:"dk1",bg2:"lt2",tx2:"dk2"},W=9144000,H=5143500,imgs={};
function hex(c){return /^[0-9a-f]{6}$/i.test(c)?"#"+c:null}
function lum(h,mod,off){var r=parseInt(h.slice(1,3),16)/255,g=parseInt(h.slice(3,5),16)/255,b=parseInt(h.slice(5,7),16)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,s=0,hh=0,d=mx-mn;
if(d){s=l>.5?d/(2-mx-mn):d/(mx+mn);hh=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;hh/=6}l=Math.max(0,Math.min(1,l*mod+off));
function f(n){var k=(n+hh*12)%12,a=s*Math.min(l,1-l);return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))))}return "#"+[f(0),f(8),f(4)].map(function(x){return ("0"+x.toString(16)).slice(-2)}).join("")}
function color(e){if(!e)return null;var c=one(e,"a","srgbClr")||one(e,"a","schemeClr")||one(e,"a","sysClr")||one(e,"a","prstClr");if(!c)return null;var v=null;
if(c.localName==="srgbClr")v=hex(c.getAttribute("val"));else if(c.localName==="sysClr")v=hex(c.getAttribute("lastClr")||"");else if(c.localName==="prstClr")v=c.getAttribute("val");else{var k=c.getAttribute("val");k=clrMap[k]||k;v=theme[k]||null}
if(v&&v.charAt(0)==="#"){var m=one(c,"a","lumMod"),o=one(c,"a","lumOff");if(m||o)v=lum(v,m?+m.getAttribute("val")/1e5:1,o?+o.getAttribute("val")/1e5:0)}return v}
function fill(spPr){if(!spPr)return undefined;if(one(spPr,"a","noFill"))return null;var s=one(spPr,"a","solidFill");if(s)return color(s);var g=one(spPr,"a","gradFill");if(g){var gs=g.getElementsByTagNameNS(NS.a,"gs");var cs=[].map.call(gs,function(x){return color(x)}).filter(Boolean);if(cs.length)return "linear-gradient(180deg,"+cs.join(",")+")"}return undefined}
function xfrm(e){var x=e&&(one(e,"a","xfrm")||one(e,"p","xfrm"));if(!x)return null;var o=one(x,"a","off"),s=one(x,"a","ext");if(!o||!s)return null;
var r={x:+o.getAttribute("x"),y:+o.getAttribute("y"),w:+s.getAttribute("cx"),h:+s.getAttribute("cy"),rot:+(x.getAttribute("rot")||0)/6e4};var co=one(x,"a","chOff"),ce=one(x,"a","chExt");if(co&&ce){r.cx=+co.getAttribute("x");r.cy=+co.getAttribute("y");r.cw=+ce.getAttribute("cx")||1;r.ch=+ce.getAttribute("cy")||1}return r}
function phOf(sp){var nv=one(sp,"p","nvSpPr")||one(sp,"p","nvPicPr")||one(sp,"p","nvGraphicFramePr");var ph=nv&&path(nv,["p:nvPr","p:ph"]);return ph?{type:ph.getAttribute("type")||"body",idx:ph.getAttribute("idx")}:null}
function phMap(doc){var m={byIdx:{},byType:{}};if(!doc)return m;[].forEach.call(doc.getElementsByTagNameNS(NS.p,"sp"),function(sp){var ph=phOf(sp);if(!ph)return;var x=xfrm(one(sp,"p","spPr"));var it={x:x,sp:sp};if(ph.idx!=null)m.byIdx[ph.idx]=m.byIdx[ph.idx]||it;m.byType[ph.type]=m.byType[ph.type]||it});return m}
function findPh(maps,ph){var t=ph.type==="ctrTitle"?"title":ph.type==="subTitle"?"body":ph.type;for(var i=0;i<maps.length;i++){var m=maps[i];var it=(ph.idx!=null&&m.byIdx[ph.idx])||m.byType[ph.type]||m.byType[t];if(it&&it.x)return it}return null}
function defSize(ph,lvl,masterDoc){var st=masterDoc&&path(masterDoc.documentElement,["p:txStyles"]);var key=!ph?"p:otherStyle":ph.type==="title"||ph.type==="ctrTitle"?"p:titleStyle":"p:bodyStyle";var s=st&&one(st,key.split(":")[0],key.split(":")[1]);
var lp=s&&one(s,"a","lvl"+(lvl+1)+"pPr"),d=lp&&one(lp,"a","defRPr");if(d&&d.getAttribute("sz"))return +d.getAttribute("sz")/100;return !ph?18:ph.type==="title"||ph.type==="ctrTitle"?44:ph.type==="subTitle"?24:[28,24,20,18,18][lvl]||18}
function face(t){if(!t)return null;if(t==="+mj-lt")t=major;else if(t==="+mn-lt")t=minor;return t?'"'+t.replace(/"/g,"")+'",system-ui,sans-serif':null}
var cq=function(emu){return (emu/W*100).toFixed(3)+"cqw"};
function box(x,parent){var d=el("div","sh");d.style.left=(x.x/W*100)+"%";d.style.top=(x.y/H*100)+"%";d.style.width=(x.w/W*100)+"%";d.style.height=(x.h/H*100)+"%";if(x.rot)d.style.transform="rotate("+x.rot+"deg)";parent.appendChild(d);return d}
function map(x,g){if(!g||g.cw==null)return x;var sx=g.w/g.cw,sy=g.h/g.ch;return {x:g.x+(x.x-g.cx)*sx,y:g.y+(x.y-g.cy)*sy,w:x.w*sx,h:x.h*sy,rot:x.rot}}
function text(d,tx,ph,master,inh){var bp=one(tx,"a","bodyPr"),anchor=bp&&bp.getAttribute("anchor")||(ph&&(ph.type==="title"||ph.type==="ctrTitle")?"ctr":"t");
d.style.justifyContent=anchor==="ctr"?"center":anchor==="b"?"flex-end":"flex-start";var ins=function(a,def){var v=bp&&bp.getAttribute(a);return cq(v!=null?+v:def)};
d.style.padding=ins("tIns",45720)+" "+ins("rIns",91440)+" "+ins("bIns",45720)+" "+ins("lIns",91440);var fs=bp&&path(bp,["a:normAutofit"]),scale=fs&&fs.getAttribute("fontScale")?+fs.getAttribute("fontScale")/1e5:1;
kids(tx,"a","p").forEach(function(p){var pPr=one(p,"a","pPr"),lvl=pPr&&+pPr.getAttribute("lvl")||0,algn=pPr&&pPr.getAttribute("algn")||(ph&&ph.type==="ctrTitle"?"ctr":null);var P=el("p");
P.style.textAlign=algn==="ctr"?"center":algn==="r"?"right":algn==="just"?"justify":"left";var base=defSize(ph,lvl,master)*scale,runs=[].filter.call(p.children,function(c){return c.localName==="r"||c.localName==="br"||c.localName==="fld"});
var bullet=ph&&ph.type!=="title"&&ph.type!=="ctrTitle"&&ph.type!=="subTitle"&&!(pPr&&one(pPr,"a","buNone"))&&runs.length;var bc=pPr&&one(pPr,"a","buChar");if(pPr&&one(pPr,"a","buChar"))bullet=true;
if(bullet){P.style.paddingLeft=cq(342900*(lvl+1));P.style.textIndent=cq(-342900);P.appendChild(el("span",null,(bc&&bc.getAttribute("char")||"•")+" "))}else if(lvl)P.style.paddingLeft=cq(457200*lvl);
var maxSz=base;runs.forEach(function(r){if(r.localName==="br"){P.appendChild(el("br"));return}var t=one(r,"a","t"),rp=one(r,"a","rPr"),S=el("span",null,t?t.textContent:"");var sz=rp&&rp.getAttribute("sz")?+rp.getAttribute("sz")/100*scale:base;maxSz=Math.max(maxSz,sz);
S.style.fontSize=cq(sz*12700);if(rp){if(rp.getAttribute("b")==="1")S.style.fontWeight="700";if(rp.getAttribute("i")==="1")S.style.fontStyle="italic";if(rp.getAttribute("u")&&rp.getAttribute("u")!=="none")S.style.textDecoration="underline";var c=color(one(rp,"a","solidFill"));if(c)S.style.color=c;var f=face(path(rp,["a:latin"])&&path(rp,["a:latin"]).getAttribute("typeface"));if(f)S.style.fontFamily=f}P.appendChild(S)});
if(!runs.length)P.appendChild(el("span",null," "));P.style.fontSize=cq(maxSz*12700);var sb=pPr&&path(pPr,["a:spcBef","a:spcPts"]);P.style.marginTop=sb?cq(+sb.getAttribute("val")/100*12700):(bullet?cq(base*12700*.25):"0");d.appendChild(P)});
if(inh&&!d.style.color)d.style.color=inh}
function shape(sp,parent,ctx,g){var ln=sp.localName;
if(ln==="grpSp"){var gx=xfrm(one(sp,"p","grpSpPr"));var gg=gx?map(gx,g):null;if(gg){gg.cx=gx.cx;gg.cy=gx.cy;gg.cw=gx.cw;gg.ch=gx.ch}[].forEach.call(sp.children,function(c){shape(c,parent,ctx,gg||g)});return}
var ph=phOf(sp);if(ctx.skipPh&&ph)return;var spPr=one(sp,"p","spPr")||one(sp,"p","grpSpPr");var x=xfrm(ln==="graphicFrame"?sp:spPr);var inh=null;
if(!x&&ph){var it=findPh(ctx.maps,ph);if(it){x=it.x;inh=color(path(it.sp,["p:spPr","a:solidFill"]))}}if(!x)return;x=map(x,g);var d=box(x,parent);
if(ln==="sp"||ln==="cxnSp"){var f=fill(spPr);if(f)d.style.background=f;var l=spPr&&one(spPr,"a","ln");if(l&&!one(l,"a","noFill")){var lc=color(one(l,"a","solidFill"));if(lc)d.style.border=cq(Math.max(+(l.getAttribute("w")||12700),9525))+" solid "+lc}
var geo=spPr&&one(spPr,"a","prstGeom"),pr=geo&&geo.getAttribute("prst");if(pr==="ellipse")d.style.borderRadius="50%";else if(pr==="roundRect")d.style.borderRadius=cq(Math.min(x.w,x.h)*.16);
if(ln==="cxnSp"){d.style.background="none";d.style.border="none";d.style.borderTop=cq(+(l&&l.getAttribute("w")||12700))+" solid "+(l&&color(one(l,"a","solidFill"))||"#888");d.style.height="0"}
var tx=one(sp,"p","txBody");if(tx)text(d,tx,ph,ctx.master,null)}
else if(ln==="pic"){var bl=path(sp,["p:blipFill","a:blip"]),id=bl&&bl.getAttributeNS(NS.r,"embed"),src=id&&ctx.rels[id]&&ctx.rels[id].t;if(src&&imgs[src]){var im=el("img");im.src=imgs[src];im.alt="";d.appendChild(im)}else{d.classList.add("ph");d.textContent="Ảnh"}}
else if(ln==="graphicFrame"){var tbl=sp.getElementsByTagNameNS(NS.a,"tbl")[0];if(!tbl){d.classList.add("ph");d.textContent="Biểu đồ / đối tượng";return}var T=el("table");
[].forEach.call(tbl.getElementsByTagNameNS(NS.a,"tr"),function(tr){var R=el("tr");kids(tr,"a","tc").forEach(function(tc){var C=el("td"),tcPr=one(tc,"a","tcPr"),bg=tcPr&&color(one(tcPr,"a","solidFill"));if(bg)C.style.background=bg;var tb=one(tc,"a","txBody");if(tb){var tmp=el("div");text(tmp,tb,null,ctx.master,null);tmp.style.padding="0";C.appendChild(tmp)}R.appendChild(C)});T.appendChild(R)});d.appendChild(T)}}
function bg(doc){var b=doc&&path(doc.documentElement,["p:cSld","p:bg"]);if(!b)return undefined;var pr=one(b,"p","bgPr");if(pr){var f=fill(pr);if(f)return f}var ref=one(b,"p","bgRef");if(ref){var c=color(ref);if(c)return c}return undefined}
return txt("ppt/presentation.xml").then(function(ps){var pd=X(ps);if(!pd)throw new Error("thiếu presentation.xml");var sz=pd.getElementsByTagNameNS(NS.p,"sldSz")[0];if(sz){W=+sz.getAttribute("cx");H=+sz.getAttribute("cy")}
return rels("ppt/presentation.xml").then(function(pr){var ids=[].map.call(pd.getElementsByTagNameNS(NS.p,"sldId"),function(s){return pr[s.getAttributeNS(NS.r,"id")]&&pr[s.getAttributeNS(NS.r,"id")].t}).filter(Boolean);var th=byType(pr,"/theme");
return txt(th||"ppt/theme/theme1.xml").then(function(ts){var td=X(ts);if(td){var cs=td.getElementsByTagNameNS(NS.a,"clrScheme")[0];if(cs)[].forEach.call(cs.children,function(c){var v=one(c,"a","srgbClr"),s=one(c,"a","sysClr");theme[c.localName]=v?hex(v.getAttribute("val")):s?hex(s.getAttribute("lastClr")||""):null});
var mj=td.getElementsByTagNameNS(NS.a,"majorFont")[0],mn=td.getElementsByTagNameNS(NS.a,"minorFont")[0];major=mj&&one(mj,"a","latin")?one(mj,"a","latin").getAttribute("typeface"):"";minor=mn&&one(mn,"a","latin")?one(mn,"a","latin").getAttribute("typeface"):""}
var media=Object.keys(zip.files).filter(function(n){return /^ppt\/media\//.test(n)&&/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(n)});
return Promise.all(media.map(function(n){return zip.file(n).async("blob").then(function(b){var e=n.split(".").pop().toLowerCase();imgs[n]=URL.createObjectURL(e==="svg"?new Blob([b],{type:"image/svg+xml"}):b)})})).then(function(){return ids})})})}).then(function(ids){
var v=document.getElementById("v");v.innerHTML="";var deck=el("div","deck");v.appendChild(deck);var cache={};
function part(p){if(!p)return Promise.resolve({doc:null,rels:{}});if(cache[p])return cache[p];return cache[p]=Promise.all([txt(p),rels(p)]).then(function(a){return {doc:X(a[0]),rels:a[1],path:p}})}
var chain=Promise.resolve();ids.forEach(function(sp,n){chain=chain.then(function(){return part(sp)}).then(function(S){var lp=byType(S.rels,"/slideLayout");return part(lp).then(function(L){return part(byType(L.rels,"/slideMaster")).then(function(M){
if(M.doc){var cm=path(M.doc.documentElement,["p:clrMap"]);if(cm)[].forEach.call(cm.attributes,function(a){clrMap[a.name]=a.value})}
var wrap=el("div","sw");wrap.appendChild(el("em",null,"Slide "+(n+1)));var sl=el("div","sl");sl.style.aspectRatio=W+"/"+H;wrap.appendChild(sl);deck.appendChild(wrap);
var b=bg(S.doc);if(b===undefined)b=bg(L.doc);if(b===undefined)b=bg(M.doc);if(b)sl.style.background=b;sl.style.color=theme[clrMap.tx1||"dk1"]||"#000";
var maps=[phMap(L.doc),phMap(M.doc)];var show=!S.doc||S.doc.documentElement.getAttribute("showMasterSp")!=="0";
function tree(D,ctx){var t=D&&path(D.documentElement,["p:cSld","p:spTree"]);if(t)[].forEach.call(t.children,function(c){if(/^(sp|pic|grpSp|graphicFrame|cxnSp)$/.test(c.localName))shape(c,sl,ctx,null)})}
if(show){tree(M.doc,{maps:[],master:M.doc,rels:M.rels,skipPh:true});tree(L.doc,{maps:[],master:M.doc,rels:L.rels,skipPh:true})}
tree(S.doc,{maps:maps,master:M.doc,rels:S.rels,skipPh:false})})})})});
return chain.then(function(){post({t:"done",pages:ids.length})})})}
`;

export function officeDoc(kind: OfficeKind, name: string, origin: string, ch: string): string {
  const libs = LIBS[kind].map(([f, cdn, sri]) => [`${origin}/vendor/${f}`, `${CDNS}/npm/${cdn}`, sri]);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}/vendor/ ${CDNS}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  const vars = `var CH=${JSON.stringify(ch)},KIND=${JSON.stringify(kind)},NAME=${JSON.stringify(name).replace(/</g, "\\u003c")},LIBS=${JSON.stringify(libs)};`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${cspMeta}<style>${CSS}</style></head><body><div id="v"><div class="ld"><i></i></div></div><script>${vars}${VIEWER}</script></body></html>`;
}
