"use client";
// Giao diện Artifact: thẻ trong tin nhắn, khung xem bên cạnh cuộc trò chuyện (xem trước / mã / phiên bản),
// khung chạy cô lập (iframe sandbox, không cùng nguồn gốc với Synchro, CSP chặn gọi mạng) và trang Artifacts.
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { getLang, tr } from "./i18n";
import { Markdown } from "./md";
import { artifactComplete, type OutFile } from "./llm";
import { parseVbhc, vbhcHtml } from "./vbhc";
import { ArtIcon } from "./artifactcard";
import { Menu } from "./ui";
import { ART_LABEL, artFileName, type ArtBlock, type ArtType } from "./artifacts";
import { TokLine, useHighlight } from "./highlight";
import { instrumentHtml, LOC_ATTR, parseLoc, snippet } from "./srcloc";
import { fixPatch, hashOf, important, type CriticEntry, type Finding } from "./critic";
import { CriticNote, CriticPill } from "./criticui";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "./bulk";
import { useApp } from "./store";
import { PageBar, usePage } from "./pager";
import { buildPptx, PPTX_FRAME_JS, type DeckSlide } from "./deckpptx";
import { fontEmbedCss } from "./artfonts";
import { htmlToBlocks } from "./htmlblocks";

export type ArtVersion = ArtBlock & { at?: number };

// ---------------------------------------------------------------- khung chạy cô lập
import { buildDocCore, deckExport, externalImageUrls, genImageId, H2I, htmlExport, isDeck, libUrls, svgExport, swapUrls } from "./artdoc";
import { kitFontUrl, presetIn, withKitFontLink } from "./artkit";
import { PRESETS, presetOf } from "./designpresets";
export { deckExport, H2I, isDeck, libUrls };

// Cầu nối trong artifact: window.synchro.complete (và window.claude.complete cho artifact viết theo Claude),
// báo lỗi và chiều cao nội dung về cho Synchro. Chỉ trao đổi qua postMessage với đúng khung cha.
const bridge = (ch: string, origin: string) => `<script>(function(){var ch=${JSON.stringify(ch)},seq=0,wait={},h2i=${JSON.stringify(libUrls(origin, H2I))};
function post(m){m.__synchro=ch;try{parent.postMessage(m,"*")}catch(e){}}
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__synchro!==ch||d.t!=="res"||!wait[d.id])return;var w=wait[d.id];delete wait[d.id];d.error?w[1](new Error(d.error)):w[0]("result" in d?d.result:d.text)});
var ask=function(m){return new Promise(function(ok,no){var id=++seq;wait[id]=[ok,no];m.id=id;post(m)})};
// Kho dữ liệu của ứng dụng: window.storage.get/set/delete/list(…, shared). shared=true: dữ liệu chung của mọi người dùng ứng dụng.
var storage={get:function(k,s){return ask({t:"store",op:"get",key:k,shared:!!s})},set:function(k,v,s){return ask({t:"store",op:"set",key:k,value:v,shared:!!s})},
"delete":function(k,s){return ask({t:"store",op:"delete",key:k,shared:!!s})},list:function(p,s){return ask({t:"store",op:"list",prefix:p||"",shared:!!s})}};
// storage.onChange(fn): gọi fn({ key, shared }) khi người khác vừa đổi dữ liệu chung (ứng dụng đã xuất bản, đang mở cùng lúc).
var subs=[];storage.onChange=function(f){subs.push(f);return function(){subs=subs.filter(function(x){return x!==f})}};
var api={complete:function(p){return ask({t:"complete",prompt:p})},storage:storage};
window.synchro=api;window.claude=api;try{window.storage=storage}catch(e){}
// Synchro yêu cầu: in (lưu PDF) hoặc chụp ảnh PNG phần đang xem (slide hiện tại nếu là bản trình bày).
function lib(u,cb){if(window.htmlToImage)return cb(true);var n=0;(function tryLoad(){if(n>1)return cb(false);var s=document.createElement("script");s.src=h2i[n++];s.crossOrigin="anonymous";s.integrity=h2i[2];s.onload=function(){cb(true)};s.onerror=function(){s.remove();tryLoad()};document.head.appendChild(s)})()}
${PPTX_FRAME_JS}
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__synchro!==ch)return;
if(d.t==="pptx")lib(0,function(ok){if(!ok)return post({t:"pptx",id:d.id,error:"Không tải được thư viện chụp ảnh"});sxPptx(d.id,d.fontCss)});
else if(d.t==="print"){if(window.__sxPrint)window.__sxPrint();else setTimeout(function(){print()},30)}
else if(d.t==="capture")lib(0,function(ok){if(!ok)return post({t:"png",id:d.id,error:"Không tải được thư viện chụp ảnh"});sxCapture(d.id,d.fontCss,d.scale)});
else if(d.t==="pick"){pk=!!d.on;document.documentElement.style.cursor=pk?"crosshair":"";if(!pk&&hl)hl.style.display="none"}
else if(d.t==="go"&&window.__sxGo)window.__sxGo(d.i);
else if(d.t==="changed"){var ev={key:d.key,shared:true};subs.slice().forEach(function(f){try{f(ev)}catch(x){}});try{dispatchEvent(new CustomEvent("synchro:storage",{detail:ev}))}catch(x){}}
else if(d.t==="present")window.__sxPresent=!!d.on;
else if(d.t==="preset"){var ps=document.querySelectorAll("[data-sx-preset]");for(var q=0;q<ps.length;q++)ps[q].setAttribute("data-sx-preset",d.id);
if(d.font&&!document.querySelector('link[data-sx-font-p="'+d.id+'"]')){var fl=document.createElement("link");fl.rel="stylesheet";fl.href=d.font;fl.setAttribute("data-sx-font-p",d.id);document.head.appendChild(fl)}
if(window.__sxFit)setTimeout(function(){if(window.__sxReset)window.__sxReset();window.__sxFit()},80)}});
// Chỉ và sửa: Synchro bật chế độ chọn, rê chuột thì viền phần tử, bấm thì gửi vị trí + mã của đúng phần tử đó (Esc để thoát).
var pk=false,hl=null;
function box(){if(hl)return hl;hl=document.createElement("div");hl.setAttribute("data-sx-noprint","");hl.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2f7bf6;border-radius:4px;background:rgba(47,123,246,.08);display:none";document.documentElement.appendChild(hl);return hl}
function where(el){var p=[];while(el&&el.nodeType===1&&el!==document.body&&el!==document.documentElement&&p.length<6){var s=el.tagName.toLowerCase();if(el.id&&/^[A-Za-z][\\w-]*$/.test(el.id)){p.unshift(s+"#"+el.id);break}var i=1,x=el;while((x=x.previousElementSibling))if(x.tagName===el.tagName)i++;p.unshift(s+":nth-of-type("+i+")");el=el.parentElement}return p.join(" > ")}
// Alt+Click (không cần bật chế độ chọn): chỉ ở khung có đánh dấu dòng mã (data-sx-loc), giữ Alt thì viền phần tử dưới chuột.
function at(el){return el&&el.closest?el.closest("[data-sx-loc]"):null}
addEventListener("keyup",function(e){if(e.key==="Alt"&&!pk&&hl)hl.style.display="none"},true);
addEventListener("mouseover",function(e){if(e.target===hl)return;if(!pk&&!(e.altKey&&at(e.target))){if(hl&&!pk)hl.style.display="none";return}var r=e.target.getBoundingClientRect(),b=box();b.style.display="block";b.style.left=r.left+"px";b.style.top=r.top+"px";b.style.width=r.width+"px";b.style.height=r.height+"px"},true);
addEventListener("click",function(e){var el=e.target,L=at(el);if(!pk&&!(e.altKey&&L))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(el===document.body||el===document.documentElement)return;if(hl&&!pk)hl.style.display="none";
post({t:"picked",sel:where(el),tag:el.tagName.toLowerCase(),text:String(el.innerText||el.textContent||"").replace(/\\s+/g," ").trim().slice(0,200),html:el.outerHTML.replace(/\\s+data-sx-loc="[^"]*"/g,"").replace(/(data:[\\w\\/+.-]+;base64,)[A-Za-z0-9+\\/=]{40,}/g,"$1…").slice(0,1500),loc:L?L.getAttribute("data-sx-loc"):""})},true);
addEventListener("keydown",function(e){if(pk&&e.key==="Escape"){e.preventDefault();post({t:"picked",cancel:true})}},true);
addEventListener("error",function(e){post({t:"error",message:String(e.message||(e.error&&e.error.message)||"Lỗi không rõ"),line:e.lineno||0})});
addEventListener("unhandledrejection",function(e){var r=e.reason;post({t:"error",message:String(r&&r.message||r)})});
var last=0;function h(f){var v=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(f||v!==last){last=v;post({t:"height",h:v})}}
addEventListener("load",function(){h(1);post({t:"ready"});setTimeout(function(){h(1)},250);setTimeout(function(){h(1)},1200);try{new ResizeObserver(function(){h()}).observe(document.body||document.documentElement)}catch(e){setInterval(h,500)}});
})();</script>`;

// Khung xem trước: trang dựng ở artdoc.ts kèm cầu nối với Synchro (postMessage).
export function buildDoc(type: ArtType, content: string, origin: string, ch: string, dark: boolean, deck?: { fixed: number | null }, title = "", loc = false): string {
  return buildDocCore(type, content, origin, ch, dark, bridge(ch, origin), deck, title, loc);
}

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

// Khung chạy artifact (html / react / svg). ai: cho gọi window.synchro.complete.
// deck: chế độ bản trình bày (xem buildDoc). onMsg: tin khác từ khung (slides, png). ctl: nhận hàm gửi lệnh vào khung.
export type FrameMsg = { t: string; [k: string]: unknown };
export type FrameSend = (m: FrameMsg) => void;
// store: nơi lưu dữ liệu cho window.storage ({ app } ứng dụng đã xuất bản, { art } artifact đang thử trong chat); không có thì báo không lưu được.
// client: mã của tab (ứng dụng đã xuất bản), để tab ghi dữ liệu không nhận lại thông báo "vừa đổi" của chính mình.
export type StoreRef = { app: string; client?: string } | { art: { conv: string; ident: string } };
// Ảnh từ URL ngoài (xem artdoc.ts): tải qua /api/artimg rồi nhúng thành data: trước khi dựng khung. Chờ tối đa 6 giây; ảnh nào
// không tải được thì giữ URL (khung báo ảnh hỏng như trước). Nhớ theo URL cho cả phiên (ảnh thu nhỏ, phiên bản khác dùng lại).
const imgCache = new Map<string, Promise<string | null>>();
const dataUrl = (u: string) => {
  let p = imgCache.get(u);
  if (!p) {
    p = fetch(`/api/artimg?u=${encodeURIComponent(u)}`).then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = no; f.readAsDataURL(b); }))
      .catch(() => null);
    imgCache.set(u, p);
    p.then((d) => { if (!d) imgCache.delete(u); });
  }
  return p;
};
// Tệp xuất ra khỏi Synchro: địa chỉ ảnh đã tạo chỉ có nghĩa bên trong tài khoản, phải nhúng ảnh vào tệp. Ảnh ngoài vẫn giữ URL như trước.
const embedGenerated = async (s: string) => {
  const urls = externalImageUrls(s).filter((u) => genImageId(u));
  const got = await Promise.all(urls.map(async (u) => [u, await dataUrl(u)] as const));
  return swapUrls(s, new Map(got.filter((g): g is readonly [string, string] => !!g[1])));
};
function useInlineImages(content: string, on: boolean): string | null {
  const urls = useMemo(() => (on ? externalImageUrls(content) : []), [content, on]);
  const [out, setOut] = useState<{ src: string; v: string } | null>(null);
  useEffect(() => {
    if (!urls.length) return;
    let live = true;
    const t = setTimeout(() => { if (live) setOut((o) => (o?.src === content ? o : { src: content, v: content })); }, 6000);
    Promise.all(urls.map(async (u) => [u, await dataUrl(u)] as const)).then((got) => {
      if (!live) return;
      clearTimeout(t);
      setOut({ src: content, v: swapUrls(content, new Map(got.filter((g): g is readonly [string, string] => !!g[1]))) });
    });
    return () => { live = false; clearTimeout(t); };
  }, [content, urls]);
  if (!urls.length) return content;
  return out?.src === content ? out.v : null;
}

// Trang chia sẻ công khai (shareview.tsx): nội dung do người lạ tạo, hiện trên đúng tên miền của Synchro. Không cho mở cửa sổ mới thoát khung cô lập (trang giả mạo đăng nhập),
// không gọi /api/artimg (người xem chưa đăng nhập; ảnh đã được nhúng lúc tạo liên kết, xem sharesnap.ts).
export const PublicFrames = createContext(false);
const SANDBOX = "allow-scripts allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads", SANDBOX_PUBLIC = "allow-scripts allow-forms allow-downloads";

export function ArtifactFrame({ type, content, ai, onError, onHeight, title, className, style, deck, onMsg, ctl, store, loc }: {
  type: ArtType; content: string; ai: boolean; onError?: (m: string) => void; onHeight?: (h: number) => void; title: string; className?: string; style?: React.CSSProperties;
  deck?: { fixed: number | null }; onMsg?: (d: FrameMsg) => void; ctl?: (send: FrameSend, el: HTMLIFrameElement | null) => void; store?: StoreRef; loc?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ch = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), [content, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const deckKey = deck ? String(deck.fixed) : "";
  const isPublic = useContext(PublicFrames);
  // Khung cô lập vẫn tự chuyển được sang trang khác (location.href, meta refresh): trên trang chia sẻ đó là trang lạ nằm ngay dưới tên miền Synchro, nên cùng một nội dung mà tải lần hai là dừng hiển thị.
  const loaded = useRef<string | null>(null);
  const [strayed, setStrayed] = useState("");
  const shown = useInlineImages(content, !isPublic && (type === "html" || type === "react" || type === "svg"));
  const doc = useMemo(() => (shown === null ? "" : buildDoc(type, shown, location.origin, ch, isDark(), deck, title, loc)), [type, shown, ch, deckKey, title, loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const cb = useRef({ onError, onHeight, ai, onMsg, store });
  cb.current = { onError, onHeight, ai, onMsg, store };
  useEffect(() => { ctl?.((m) => ref.current?.contentWindow?.postMessage({ ...m, __synchro: ch }, "*"), ref.current); });
  // Gắn trước khi khung kịp tải (khung nhỏ có thể tải xong trước cả useEffect).
  useLayoutEffect(() => {
    const h = async (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const d = e.data as { __synchro?: string; t?: string; id?: number; prompt?: unknown; message?: string; h?: number; op?: string; key?: unknown; value?: unknown; shared?: boolean; prefix?: unknown };
      if (!d || d.__synchro !== ch) return;
      if (d.t === "height" && typeof d.h === "number") cb.current.onHeight?.(d.h);
      else if (d.t === "slides" || d.t === "png" || d.t === "pptx" || d.t === "pptx-step" || d.t === "ready" || d.t === "picked") cb.current.onMsg?.(d as FrameMsg);
      else if (d.t === "error") cb.current.onError?.(String(d.message ?? "").slice(0, 500));
      else if (d.t === "complete") {
        const res = (m: Record<string, unknown>) => w.postMessage({ __synchro: ch, t: "res", id: d.id, ...m }, "*");
        if (!cb.current.ai) return res({ error: tr("Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng.") });
        try { res({ text: await artifactComplete(d.prompt) }); } catch (err) { res({ error: (err as Error).message }); }
      } else if (d.t === "store") {
        const res = (m: Record<string, unknown>) => w.postMessage({ __synchro: ch, t: "res", id: d.id, ...m }, "*");
        if (!cb.current.store) return res({ error: tr("Khung này không lưu được dữ liệu. Mở artifact trong khung xem trước hoặc xuất bản thành ứng dụng.") });
        try {
          const r = await fetch("/api/apps/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: cb.current.store, op: d.op, key: d.key, value: d.value, shared: d.shared, prefix: d.prefix, client: "client" in cb.current.store ? cb.current.store.client : undefined }) });
          const j = await r.json().catch(() => ({}));
          res(r.ok ? { result: j.result ?? null } : { error: j.error || `Lỗi ${r.status}` });
        } catch (err) { res({ error: (err as Error).message }); }
      }
    };
    addEventListener("message", h);
    return () => removeEventListener("message", h);
  }, [ch]);
  if (shown === null) return <div className={className} style={{ ...style, display: "grid", placeItems: "center" }} aria-busy="true"><span className="art-spin" /></div>;
  if (strayed === ch) return <p className="sh-warn" role="alert">{tr("Phần này tự chuyển sang một trang khác nên Synchro đã dừng hiển thị.")}</p>;
  return <iframe ref={ref} key={ch} title={title} className={className} style={style} srcDoc={doc}
    onLoad={isPublic ? () => { if (loaded.current === doc) setStrayed(ch); loaded.current = doc; } : undefined}
    sandbox={isPublic ? SANDBOX_PUBLIC : SANDBOX} allow={isPublic ? undefined : "clipboard-write"} referrerPolicy="no-referrer" />;
}

// Sơ đồ Mermaid (vẽ ngay trong Synchro, chế độ an toàn: không chạy script trong sơ đồ).
export function MermaidSvg({ code, onError }: { code: string; onError?: (m: string) => void }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const mm = (await import("mermaid")).default;
        mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "default" });
        const r = await mm.render("mm" + Math.random().toString(36).slice(2), code);
        if (on) { setSvg(r.svg); setErr(""); }
      } catch (e) { const m = String((e as Error).message ?? e).slice(0, 300); if (on) { setErr(m); onError?.(m); } }
    })();
    return () => { on = false; };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="art-err-inline">{tr("Không vẽ được sơ đồ")}: {err}</div>;
  return svg ? <div className="art-mermaid" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="art-loading"><span className="art-spin" /></div>;
}

// Sơ đồ D2: máy chủ dựng SVG trong sandbox (d2render.ts), hiện bằng <img> nên SVG không chạy được mã nào. svg(): SVG đã vẽ (tải về, chuyển PNG).
// Tối đa 40 sơ đồ trong thẻ trình duyệt (mỗi SVG tới 3 MB); vẽ lại sơ đồ đã bị bỏ thì máy chủ trả ngay từ bộ đệm của nó.
const d2Cache = new Map<string, string>();
const d2Keep = (key: string, svg: string) => { d2Cache.delete(key); d2Cache.set(key, svg); while (d2Cache.size > 40) d2Cache.delete(d2Cache.keys().next().value!); };
// Trang chia sẻ đặt mã liên kết: người xem chưa đăng nhập vẫn vẽ được sơ đồ có trong liên kết đó (api/d2 kiểm đoạn mã thuộc liên kết).
let d2Share = "";
export const setD2Share = (token: string) => { d2Share = token; };
export function D2Svg({ code, onError, onSvg }: { code: string; onError?: (m: string) => void; onSvg?: (svg: string) => void }) {
  const dark = isDark(), key = `${dark ? 1 : 0}:${code}`;
  const [svg, setSvg] = useState(d2Cache.get(key) ?? "");
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const hit = d2Cache.get(key);
    if (hit) { setSvg(hit); onSvg?.(hit); return; }
    setSvg(""); setErr("");
    fetch("/api/d2", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, dark, ...(d2Share ? { share: d2Share } : {}) }) })
      .then((r) => r.json()).then((j: { svg?: string; error?: string }) => {
        if (!on) return;
        if (j.svg) { d2Keep(key, j.svg); setSvg(j.svg); onSvg?.(j.svg); } else { const m = j.error ? tr(j.error) : tr("Không vẽ được sơ đồ"); setErr(m); onError?.(m); }
      }).catch(() => { if (on) { const m = tr("Mất kết nối khi vẽ sơ đồ"); setErr(m); onError?.(m); } });
    return () => { on = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="art-err-inline">{tr("Không vẽ được sơ đồ")}: {err}</div>;
  // SVG của D2 chỉ có viewBox: không đặt cỡ thì ảnh giãn hết bề ngang, sơ đồ bốn khối thành chữ 30px. Hiện đúng cỡ thật, chỉ co lại khi khung hẹp hơn.
  const vb = /viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  return svg ? <div className="art-d2"><img alt={tr("Sơ đồ D2")} width={vb ? Math.round(Number(vb[1])) : undefined} height={vb ? Math.round(Number(vb[2])) : undefined} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /></div> : <div className="art-loading"><span className="art-spin" /></div>;
}
export const d2Drawn = (code: string) => d2Cache.get(`${isDark() ? 1 : 0}:${code}`) ?? "";

// ---------------------------------------------------------------- tải về nhiều định dạng
export function saveBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const htmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const baseName = (a: { title: string; type: ArtType; lang: string | null }) => artFileName(a).replace(/\.[^.]+$/, "");
// Nội dung đã hiện (tài liệu, sơ đồ) bỏ các nút giao diện như "Sao chép" trước khi xuất.
// Khung chat hiện mọi tiêu đề bằng h3 và bọc từng chữ trong <span> (hiệu ứng chữ chạy): xuất thì gỡ các span đó
// và trả tiêu đề về đúng cấp theo bản Markdown gốc, để Word nhận ra Tiêu đề 1 / 2 / 3.
const cleanHtml = (el: Element, md = "") => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll("button,[data-noexport]").forEach((x) => x.remove());
  [...c.querySelectorAll("span")].reverse().forEach((x) => { if (!x.attributes.length || (x.attributes.length === 1 && x.className === "w")) x.replaceWith(...x.childNodes); });
  const lv = md.replace(/```[\s\S]*?```/g, "").split("\n").map((l) => /^(#{1,3})\s+\S/.exec(l)?.[1].length).filter((n): n is number => !!n);
  const hs = [...c.querySelectorAll("h3")];
  if (hs.length === lv.length) hs.forEach((h, i) => { if (lv[i] === 3) return; const n = document.createElement(`h${lv[i]}`); n.append(...h.childNodes); h.replaceWith(n); });
  c.normalize();
  return c.innerHTML;
};
const DOC_CSS = `body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.55;color:#1f1f1f;max-width:720px;margin:0 auto;padding:24px}
h1{font-size:22pt;margin:0 0 12pt}h2{font-size:16pt;margin:18pt 0 8pt}h3{font-size:13pt;margin:14pt 0 6pt}table{border-collapse:collapse;margin:8pt 0}td,th{border:1px solid #bbb;padding:5pt 8pt;text-align:left}th{background:#f2f2f2}
code{font-family:Consolas,Menlo,monospace;font-size:10pt}pre{background:#f6f6f6;padding:10pt;border-radius:6px;white-space:pre-wrap}blockquote{border-left:3px solid #ccc;margin:8pt 0;padding-left:12pt;color:#555}img,svg{max-width:100%}`;
// In qua khung ẩn cùng nguồn gốc: hộp thoại in của trình duyệt có "Lưu thành PDF".
export function printHtml(title: string, html: string) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><style>${DOC_CSS}@page{margin:18mm}</style></head><body>${html}</body></html>`); d.close();
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 1000); }, 250);
}
// SVG → PNG (gấp đôi độ phân giải), vẽ qua canvas ngay trong Synchro.
export async function svgToPng(svg: string): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const vb = (doc.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  let w = parseFloat(doc.getAttribute("width") ?? "") || vb[2] || 1024, h = parseFloat(doc.getAttribute("height") ?? "") || vb[3] || 1024;
  if (w < 512) { h = h * 1024 / w; w = 1024; }
  doc.setAttribute("width", String(w)); doc.setAttribute("height", String(h));
  if (!doc.getAttribute("xmlns")) doc.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error(tr("Không vẽ được hình SVG"))); img.src = url; });
    const c = document.createElement("canvas"); c.width = Math.round(w * 2); c.height = Math.round(h * 2);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("PNG"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}
const blobData = (b: Blob) => new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => no(f.error); f.readAsDataURL(b); });
// Tài liệu đã hiện → tệp Word thật (máy chủ dựng, app/mddocx.ts). Ảnh, sơ đồ đổi thành ảnh nhúng trước khi gửi; ảnh không lấy được thì giữ chú thích của ảnh.
async function docxFile(el: Element, title: string, md: string): Promise<Blob> {
  const blocks = htmlToBlocks(new DOMParser().parseFromString(cleanHtml(el, md), "text/html").body);
  await Promise.all(blocks.map(async (b) => {
    if (b.k !== "img") return;
    try {
      if (b.svg) { b.src = await blobData(await svgToPng(b.svg)); delete b.svg; }
      else if (b.src && /^https?:/i.test(b.src)) { const r = await fetch(`/api/artimg?u=${encodeURIComponent(b.src)}`); b.src = r.ok ? await blobData(await r.blob()) : undefined; }
      else if (b.src?.startsWith("blob:")) b.src = await blobData(await (await fetch(b.src)).blob());
    } catch { b.src = undefined; delete b.svg; }
  }));
  const r = await fetch("/api/mddocx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blocks, title }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Lỗi ${r.status}`);
  return r.blob();
}
const dataUrlBlob = (u: string) => { const [h, b] = u.split(","); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: /data:([^;]+)/.exec(h)?.[1] ?? "image/png" }); };

type DlItem = { label: string; sub: string; run: () => void | Promise<void> };
function DownloadMenu({ items, say, note }: { items: DlItem[]; say: (m: string) => void; note?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const run = async (it: DlItem) => {
    setOpen(false); setBusy(it.label);
    try { await it.run(); } catch (e) { say(`${tr("Không xuất được")} ${it.label}: ${(e as Error).message}`); } finally { setBusy(""); }
  };
  return (
    <div className="art-dl" ref={ref}>
      {note && <span className="art-dl-note" role="status">{note}</span>}
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Tải về" data-tip="Tải về" aria-expanded={open}>{busy ? <span className="art-spin sm" /> : <I.Download size={16} />}</button>
      <Menu open={open} className="art-dl-menu">
        <div className="art-dl-h">{tr("Tải về")}</div>
        {items.map((it) => <button key={it.label} className="menu-item" onClick={() => run(it)}><span className="art-dl-t"><b>{it.label}</b><em>{tr(it.sub)}</em></span></button>)}
      </Menu>
    </div>
  );
}

// Đổi phong cách không tốn lượt model: bấm một phong cách thì khung đổi ngay (chỉ thay data-sx-preset, bộ CSS có sẵn 8 bộ biến);
// "Giữ" thành phiên bản mới của artifact (onKeep, cùng đường với áp dụng bản sửa của hội đồng phản biện), "Bỏ" về phong cách cũ.
function StyleSwitch({ current, send, onKeep, say }: { current: string; send: () => FrameSend | null; onKeep?: (id: string) => void; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [trial, setTrial] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setTrial(""); }, [current]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const apply = (id: string) => { send()?.({ t: "preset", id, font: kitFontUrl(`data-sx-preset="${id}"`) }); setTrial(id === current ? "" : id); };
  const name = (id: string) => tr(presetOf(id)?.name ?? id);
  return (
    <div className="art-dl art-style" ref={ref}>
      <button className={`icon-btn ${trial ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label="Đổi phong cách" data-tip="Đổi phong cách" aria-expanded={open}><I.Palette size={16} /></button>
      <Menu open={open} className="art-dl-menu art-style-menu">
        <div className="art-dl-h">{tr("Phong cách")}</div>
        {PRESETS.map((p) => (
          <button key={p.id} className={`menu-item${(trial || current) === p.id ? " on" : ""}`} aria-current={(trial || current) === p.id ? "true" : undefined} onClick={() => apply(p.id)}>
            <span className="art-style-sw" aria-hidden="true" style={{ background: p.bg, borderColor: p.line }}><i style={{ background: p.surface }} /><i style={{ background: p.vivid ?? p.accent }} /></span>
            <span className="art-dl-t"><b>{name(p.id)}</b></span>
            {current === p.id && <em className="art-style-now">{tr("Đang dùng")}</em>}
          </button>
        ))}
        {trial && (
          <div className="art-style-acts">
            {onKeep && <button className="btn dark" onClick={() => { onKeep(trial); setOpen(false); say(`${tr("Đã đổi phong cách sang")} ${name(trial)}`); }}>{tr("Giữ phong cách này")}</button>}
            <button className="btn" onClick={() => apply(current)}>{tr("Bỏ")}</button>
          </div>
        )}
      </Menu>
    </div>
  );
}

// Bản trình bày: khung 16:9, chuyển slide, ảnh thu nhỏ từng slide, trình chiếu toàn màn hình.
function DeckView({ art, ai, onError, onMsg, ctl, store, loc }: { art: ArtVersion; ai: boolean; onError: (m: string) => void; onMsg: (d: FrameMsg) => void; ctl: (s: FrameSend) => void; store?: StoreRef; loc?: boolean }) {
  const [st, setSt] = useState({ n: 0, cur: 0 });
  const [full, setFull] = useState(false);
  const send = useRef<FrameSend | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const go = (i: number) => send.current?.({ t: "go", i: Math.max(0, Math.min(i, st.n - 1)) });
  useEffect(() => {
    const f = () => { const on = document.fullscreenElement === stage.current; setFull(on); send.current?.({ t: "present", on }); if (on) setTimeout(() => frame.current?.focus(), 50); };
    document.addEventListener("fullscreenchange", f); return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(st.cur + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(st.cur - 1); }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [full, st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { thumbs.current?.querySelector(".deck-th.on")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, [st.cur]);
  return (
    <div className="deck">
      <div className="deck-stage" ref={stage}>
        <ArtifactFrame type="html" content={art.content} ai={ai} title={art.title} className="deck-frame" deck={{ fixed: null }} onError={onError} store={store} loc={loc}
          onMsg={(d) => { if (d.t === "slides") setSt({ n: Number(d.n) || 0, cur: Number(d.cur) || 0 }); else onMsg(d); }}
          ctl={(s, el) => { send.current = s; frame.current = el; ctl(s); }} />
        {full && st.n > 1 && <div className="deck-hud">{st.cur + 1} / {st.n}</div>}
      </div>
      {st.n > 1 && <>
        <div className="deck-bar">
          <button className="icon-btn" disabled={st.cur <= 0} onClick={() => go(st.cur - 1)} aria-label="Slide trước"><span className="flip"><I.ChevronR size={16} /></span></button>
          <span className="deck-count">{tr("Slide")} {st.cur + 1} / {st.n}</span>
          <button className="icon-btn" disabled={st.cur >= st.n - 1} onClick={() => go(st.cur + 1)} aria-label="Slide sau"><I.ChevronR size={16} /></button>
          <span style={{ flex: 1 }} />
          <button className="btn deck-play" onClick={() => stage.current?.requestFullscreen?.().catch(() => {})}><I.Play size={13} />{tr("Trình chiếu")}</button>
        </div>
        <div className="deck-thumbs" ref={thumbs}>
          {Array.from({ length: Math.min(st.n, 40) }, (_, k) => (
            <button key={k} className={`deck-th ${k === st.cur ? "on" : ""}`} onClick={() => go(k)} aria-label={`Slide ${k + 1}`}>
              <span className="deck-th-in"><ArtifactFrame type="html" content={art.content} ai={false} title="" deck={{ fixed: k }} className="deck-th-frame" /></span>
              <em>{k + 1}</em>
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

// ---------------------------------------------------------------- văn bản hành chính (NĐ 30/2020)
// Bản xem trước khổ A4 đúng thể thức; khung không chạy script. Nội dung lỗi (JSON sai, thiếu trường) thì báo để model sửa.
export function VbhcView({ content, title, onError }: { content: string; title: string; onError?: (m: string) => void }) {
  const r = useMemo(() => parseVbhc(content), [content]);
  const box = useRef<HTMLDivElement>(null);
  // Trang A4 rộng 210 mm (~794 px): khung xem hẹp hơn thì thu nhỏ trang cho vừa (bản in vẫn đúng khổ).
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => setZoom(Math.min(1, Math.round(((el.clientWidth - 24) / 794) * 100) / 100));
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { if (r.error) onError?.(r.error); }, [r.error]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r.spec) return <div className="art-err-inline">{tr("Văn bản chưa đúng định dạng")}: {r.error}</div>;
  return <div ref={box} className="vbhc-box"><iframe className="art-frame vbhc-frame" title={title} srcDoc={vbhcHtml(r.spec, title, zoom)} sandbox="" /></div>;
}
// In một trang HTML hoàn chỉnh qua khung ẩn (hộp thoại in của trình duyệt có "Lưu thành PDF").
function printDoc(html: string) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 1000); }, 300);
}

// ---------------------------------------------------------------- so sánh hai phiên bản
// Khác biệt theo dòng (dãy con chung dài nhất). Mã dài quá thì so theo khối đầu / cuối giống nhau rồi coi phần giữa là thay hết.
type DiffLine = { k: " " | "+" | "-"; t: string };
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split("\n"), B = b.split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const head: DiffLine[] = A.slice(0, s).map((t) => ({ k: " ", t })), tail: DiffLine[] = A.slice(A.length - e).map((t) => ({ k: " ", t }));
  if (a2.length * b2.length > 4_000_000) return [...head, ...a2.map((t) => ({ k: "-" as const, t })), ...b2.map((t) => ({ k: "+" as const, t })), ...tail];
  const n = a2.length, m = b2.length, L = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * (m + 1) + j] = a2[i] === b2[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  const mid: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) { mid.push({ k: " ", t: a2[i] }); i++; j++; }
    else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) mid.push({ k: "-", t: a2[i++] });
    else mid.push({ k: "+", t: b2[j++] });
  }
  while (i < n) mid.push({ k: "-", t: a2[i++] });
  while (j < m) mid.push({ k: "+", t: b2[j++] });
  return [...head, ...mid, ...tail];
}

function CompareView({ a, b, ai, na, nb }: { a: ArtVersion; b: ArtVersion; ai: boolean; na: number; nb: number }) {
  const live = a.type !== "code" && a.type !== "markdown" && a.type !== "mermaid" && a.type !== "d2" && a.type !== "vbhc";
  const [mode, setMode] = useState<"side" | "diff">(live ? "side" : "diff");
  const d = useMemo(() => (mode === "diff" ? lineDiff(a.content, b.content) : []), [mode, a.content, b.content]);
  const add = d.filter((x) => x.k === "+").length, del = d.filter((x) => x.k === "-").length;
  // Mã dài: chỉ hiện các dòng đổi kèm 3 dòng xung quanh.
  const keep = new Set<number>();
  d.forEach((x, i) => { if (x.k !== " ") for (let k = Math.max(0, i - 3); k <= Math.min(d.length - 1, i + 3); k++) keep.add(k); });
  return (
    <div className="cmp">
      <div className="cmp-bar">
        <div className="art-tabs">{live && <button className={mode === "side" ? "on" : ""} onClick={() => setMode("side")}>{tr("Song song")}</button>}<button className={mode === "diff" ? "on" : ""} onClick={() => setMode("diff")}>{tr("Mã thay đổi")}</button></div>
        {mode === "diff" && <span className="cmp-n"><b className="add">+{add}</b> <b className="del">−{del}</b></span>}
      </div>
      {mode === "side" ? (
        <div className="cmp-side">
          {[[a, na], [b, nb]].map(([v, n]) => (
            <div key={n as number} className="cmp-col">
              <div className="cmp-h">{tr("Phiên bản")} {n as number}{n === nb ? ` · ${tr("đang xem")}` : ""}</div>
              <ArtifactFrame type={(v as ArtVersion).type} content={(v as ArtVersion).content} ai={ai} title={(v as ArtVersion).title} className="art-frame" deck={isDeck(v as ArtVersion) ? { fixed: 0 } : undefined} />
            </div>
          ))}
        </div>
      ) : (
        <pre className="art-code cmp-diff">{d.map((x, i) => keep.has(i) ? <div key={i} className={x.k === "+" ? "add" : x.k === "-" ? "del" : ""}><span>{x.k === " " ? "" : x.k}</span>{x.t || " "}</div>
          : keep.has(i - 1) ? <div key={i} className="gap"><span>⋯</span></div> : null)}{!add && !del && <div className="gap"><span />{tr("Hai phiên bản giống hệt nhau")}</div>}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- khung xem bên cạnh
// conv: đoạn chat chứa artifact (để artifact lưu được dữ liệu thử bằng window.storage); extra: nút thêm trên đầu khung theo phiên bản đang xem.
// criticOf / onCritic / onApplyFix: hội đồng phản biện (kết quả theo phiên bản, chạy lại, áp dụng bản sửa thành phiên bản mới).
// onRestyle: giữ phong cách vừa xem thử thành phiên bản mới (không gọi model); không có thì chỉ xem thử được.
export function ArtifactPanel({ versions, index, setIndex, ai, onClose, onFix, onAsk, expanded, setExpanded, say, footer, switcher, conv, extra, criticOf, onCritic, onApplyFix, onRestyle }: {
  versions: ArtVersion[]; index: number; setIndex: (i: number) => void; ai: boolean; onClose: () => void; onFix?: (a: ArtVersion, err: string) => void; onAsk?: (text: string) => void;
  expanded: boolean; setExpanded: (v: boolean) => void; say: (m: string) => void; footer?: React.ReactNode; switcher?: React.ReactNode; conv?: string; extra?: (a: ArtVersion) => React.ReactNode;
  criticOf?: (a: ArtVersion) => CriticEntry | undefined; onCritic?: (a: ArtVersion) => void; onApplyFix?: (a: ArtVersion, f: Finding) => void; onRestyle?: (a: ArtVersion, preset: string) => void;
}) {
  const art = versions[Math.min(index, versions.length - 1)];
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  // Tiến độ xuất PowerPoint ("3/18"), hiện cạnh nút Tải về.
  const [pptxStep, setPptxStep] = useState("");
  const send = useRef<FrameSend | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const pending = useRef<Map<number, (d: FrameMsg) => void>>(new Map());
  const steps = useRef<Map<number, (d: FrameMsg) => void>>(new Map());
  // Chỉ và sửa: đang chọn phần tử / phần tử đã chọn và yêu cầu sửa. So sánh: bản trước và bản đang xem.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ sel: string; tag: string; text: string; html: string; loc: { start: number; end: number } | null } | null>(null);
  const [req, setReq] = useState("");
  const [compare, setCompare] = useState(false);
  // Hội đồng phản biện: kết quả của phiên bản đang xem; ý kiến đã bỏ qua (theo phiên bản) không hiện nữa.
  const crit = criticOf?.(art);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const ver = hashOf(art.content);
  const findings = (crit?.status === "done" ? crit.findings : []).filter((f) => !skip.has(`${ver}:${f.line_start}:${f.title}`));
  const runnable = art.type !== "code";
  const showCode = tab === "code" || !runnable || !art.complete;
  const deck = art.complete && isDeck(art);
  // Tab Mã: tô màu cú pháp (Shiki, tải chậm) khi artifact đã viết xong; đang viết thì chữ đơn sắc như cũ.
  const toks = useHighlight(art.content, art.type === "code" ? art.lang ?? "" : art.type === "react" ? "tsx" : art.type === "svg" ? "xml" : art.type === "html" ? "html" : "", art.complete && showCode && !compare);
  useEffect(() => { setErr(""); }, [art.content, reload]);
  useEffect(() => { setPicking(false); setPicked(null); setReq(""); }, [art.content]);
  useEffect(() => { if (index <= 0) setCompare(false); }, [index]);
  useEffect(() => { if (!runnable) setTab("code"); }, [runnable]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && expanded) setExpanded(false); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [expanded, setExpanded]);
  const copy = () => { navigator.clipboard?.writeText(art.content); setCopied(true); say(tr("Đã sao chép nội dung artifact")); setTimeout(() => setCopied(false), 1500); };
  const name = baseName(art);
  const done = (n: string) => say(`${tr("Đã tải")} ${n}`);
  const source = async () => {
    const n = artFileName(art), content = await embedGenerated(art.content);
    saveBlob(new Blob([art.type === "html" ? htmlExport(content, location.origin) : art.type === "svg" ? svgExport(content) : content], { type: art.type === "html" ? "text/html" : art.type === "svg" ? "image/svg+xml" : "text/plain" }), n); done(n);
  };
  // Xuất cần phần xem trước đang hiện (tài liệu đã dựng, khung đã chạy): chuyển sang Xem trước rồi chờ một chút.
  const withPreview = (fn: () => void | Promise<void>, wait = 400) => new Promise<void>((ok, no) => {
    if (!showCode) { Promise.resolve(fn()).then(ok, no); return; }
    setTab("preview"); setTimeout(() => Promise.resolve(fn()).then(ok, no), wait);
  });
  // o.onStep: tin tiến độ của lệnh chạy lâu (xuất PowerPoint báo từng slide); o.ms: thời gian chờ tối đa.
  const frameCall = (m: FrameMsg, o: { ms?: number; onStep?: (d: FrameMsg) => void } = {}) => new Promise<FrameMsg>((ok, no) => {
    if (!send.current) return no(new Error(tr("Khung xem chưa sẵn sàng")));
    const id = Date.now() + Math.random();
    const t = setTimeout(() => { pending.current.delete(id); steps.current.delete(id); no(new Error(tr("Quá thời gian chờ"))); }, o.ms ?? 20000);
    if (o.onStep) steps.current.set(id, o.onStep);
    pending.current.set(id, (d) => { clearTimeout(t); steps.current.delete(id); d.error ? no(new Error(String(d.error))) : ok(d); });
    send.current({ ...m, id });
  });
  const onMsg = (d: FrameMsg) => {
    if (d.t === "picked") {
      send.current?.({ t: "pick", on: false }); setPicking(false);
      if (!d.cancel) { setPicked({ sel: String(d.sel ?? ""), tag: String(d.tag ?? ""), text: String(d.text ?? ""), html: String(d.html ?? ""), loc: parseLoc(d.loc, art.content.split("\n").length) }); setReq(""); }
      return;
    }
    if (d.t === "pptx-step") { steps.current.get(d.id as number)?.(d); return; }
    const f = pending.current.get(d.id as number); if (f) { pending.current.delete(d.id as number); f(d); }
  };
  const canPick = !!onAsk && art.complete && !showCode && !compare && ["html", "react", "svg"].includes(art.type);
  // Trang dùng một trong 8 phong cách của bộ thiết kế: đổi phong cách ngay trong khung.
  const stylable = art.complete && !showCode && !compare && ["html", "react", "svg"].includes(art.type) ? presetIn(art.content) : "";
  // Phần tử đã chọn có dòng mã: ở chế độ xem Mã thì tô các dòng đó và cuộn tới.
  const hlLoc = showCode && picked?.loc ? picked.loc : null;
  useEffect(() => { if (hlLoc) body.current?.querySelector(".art-code .hl")?.scrollIntoView({ block: "center" }); }, [hlLoc?.start, hlLoc?.end, showCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePick = () => { const on = !picking; setPicking(on); setPicked(null); send.current?.({ t: "pick", on }); };
  // Yêu cầu sửa đúng phần tử: gửi vị trí, nội dung và mã của phần tử để model chỉ đổi đúng chỗ đó (phiên bản mới cùng identifier).
  // Biết dòng mã (Alt+Click / chế độ chọn trên khung có đánh dấu dòng) thì gửi đúng các dòng quanh đó thay vì đoán từ mã đang hiện.
  const askEdit = () => {
    if (!picked || !req.trim() || !onAsk) return;
    const at = picked.loc ? `\ndòng: ${picked.loc.start}-${picked.loc.end}\nmã nguồn quanh đó (số dòng | mã):\n${snippet(art.content, picked.loc)}` : "";
    onAsk(`${tr("Sửa artifact")} “${art.title}” (identifier="${art.ident}"): ${tr("chỉ thay đổi đúng phần tử tôi chỉ vào, giữ nguyên mọi phần khác.")}
<point_edit>
vị trí: ${picked.sel}
nội dung đang hiện: ${picked.text.slice(0, 200)}${at}
mã của phần tử: ${picked.html.slice(0, picked.loc ? 600 : 1200)}
</point_edit>
Yêu cầu: ${req.trim()}`);
    setPicked(null); setReq("");
  };
  const pdfFrame = () => withPreview(() => { if (!send.current) throw new Error(tr("Khung xem chưa sẵn sàng")); send.current({ t: "print" }); }, 1500);
  const pngFrame = (scale?: number) => withPreview(async () => { const n = `${name}${scale ? `@${scale}x` : ""}.png`; const d = await frameCall({ t: "capture", scale, fontCss: await fontEmbedCss(withKitFontLink(art.content)) }); saveBlob(dataUrlBlob(String(d.data)), n); done(n); }, 1500);
  // Poster 3:4 và ảnh chia sẻ 1200×630 của bộ thiết kế: thêm bản 3x đúng cỡ in / mạng xã hội (3240×4320, 3600×1890).
  const frame = deck ? null : /class=["'][^"']*\bsx-og\b/.test(art.content) ? "og" : /class=["'][^"']*\bsx-poster\b/.test(art.content) ? "poster" : null;
  const png3x: DlItem[] = frame ? [{ label: "PNG 3x", sub: frame === "og" ? "3600×1890, chữ nét" : "3240×4320, chữ nét", run: () => pngFrame(3) }] : [];
  // PowerPoint: Synchro tự dựng ngay trong khung xem (deckpptx.ts), không nhờ model; chữ sửa được, hình giữ nguyên.
  const pptxFrame = () => withPreview(async () => {
    say(tr("Đang dựng tệp PowerPoint…"));
    // Phông web cho ảnh nền của slide (chữ trong hình, SVG): khung không tự tải được, như khi xuất PNG.
    const d = await frameCall({ t: "pptx", fontCss: await fontEmbedCss(withKitFontLink(art.content)) }, { ms: 10 * 60_000, onStep: (s) => setPptxStep(`${s.i}/${s.n}`) });
    setPptxStep("");
    const n = `${name}.pptx`;
    saveBlob(await buildPptx(d.slides as DeckSlide[], Number(d.w), Number(d.h), art.title), n); done(n);
  }, 1500).finally(() => setPptxStep(""));
  const shown = (sel: string) => { const el = body.current?.querySelector(sel); if (!el) throw new Error(tr("Chưa hiện xong nội dung")); return el; };
  const items: DlItem[] = [];
  if (deck) {
    items.push({ label: "PDF", sub: "Mỗi slide một trang (chọn Lưu thành PDF)", run: pdfFrame });
    items.push({ label: "PowerPoint (.pptx)", sub: "Chữ sửa được, hình giữ nguyên", run: pptxFrame });
    items.push({ label: "HTML", sub: "Trình chiếu bằng trình duyệt", run: async () => { const n = artFileName(art); saveBlob(new Blob([deckExport(await embedGenerated(art.content), location.origin)], { type: "text/html" }), n); done(n); } }, { label: "PNG", sub: "Ảnh slide đang xem", run: () => pngFrame() });
  } else if (art.type === "html") items.push({ label: "HTML", sub: "Trang web chạy được", run: source }, { label: "PDF", sub: "Chọn Lưu thành PDF khi in", run: pdfFrame }, { label: "PNG", sub: frame ? "Ảnh đúng khung" : "Ảnh toàn trang", run: () => pngFrame() }, ...png3x);
  else if (art.type === "react") items.push({ label: "HTML", sub: "Mở bằng trình duyệt, không cần cài gì", run: async () => { const n = `${name}.html`; saveBlob(new Blob([buildDoc("react", await embedGenerated(art.content), location.origin, "export", false, undefined, art.title)], { type: "text/html" }), n); done(n); } },
    { label: "JSX", sub: "Mã nguồn React", run: source }, { label: "PNG", sub: "Ảnh giao diện", run: () => pngFrame() }, ...png3x, { label: "PDF", sub: "Chọn Lưu thành PDF khi in", run: pdfFrame });
  else if (art.type === "svg") items.push({ label: "SVG", sub: "Hình vector", run: source }, { label: "PNG", sub: "Ảnh độ phân giải cao", run: async () => { saveBlob(await svgToPng(await embedGenerated(art.content)), `${name}.png`); done(`${name}.png`); } });
  else if (art.type === "markdown") items.push({ label: "Word (.docx)", sub: "Mở bằng Word, Google Docs", run: () => withPreview(async () => { const n = `${name}.docx`; saveBlob(await docxFile(shown(".art-md"), art.title, art.content), n); done(n); }) },
    { label: "PDF", sub: "Chọn Lưu thành PDF khi in", run: () => withPreview(() => printHtml(art.title, cleanHtml(shown(".art-md"), art.content))) }, { label: "Markdown (.md)", sub: "Văn bản thuần", run: source });
  else if (art.type === "vbhc") items.push({ label: "Word (.docx)", sub: "Đúng thể thức Nghị định 30/2020", run: async () => {
    const n = `${name}.docx`;
    const r = await fetch("/api/vbhc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: art.content, name: n }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Lỗi ${r.status}`);
    saveBlob(await r.blob(), n); done(n);
  } }, { label: "PDF", sub: "Chọn Lưu thành PDF khi in", run: () => { const p = parseVbhc(art.content); if (!p.spec) throw new Error(p.error); printDoc(vbhcHtml(p.spec, art.title)); } },
    { label: "JSON", sub: "Nội dung có cấu trúc", run: source });
  else if (art.type === "d2") {
    const drawn = () => { const s = d2Drawn(art.content); if (!s) throw new Error(tr("Chưa hiện xong nội dung")); return s; };
    items.push({ label: "SVG", sub: "Sơ đồ dạng vector", run: () => withPreview(() => { const n = `${name}.svg`; saveBlob(new Blob([drawn()], { type: "image/svg+xml" }), n); done(n); }, 4000) },
      { label: "PNG", sub: "Ảnh sơ đồ", run: () => withPreview(async () => { saveBlob(await svgToPng(drawn()), `${name}.png`); done(`${name}.png`); }, 4000) }, { label: "D2", sub: "Mã nguồn sơ đồ", run: source });
  } else if (art.type === "mermaid") items.push({ label: "SVG", sub: "Sơ đồ dạng vector", run: () => withPreview(() => { const n = `${name}.svg`; saveBlob(new Blob([shown(".art-mermaid svg").outerHTML], { type: "image/svg+xml" }), n); done(n); }, 1200) },
    { label: "PNG", sub: "Ảnh sơ đồ", run: () => withPreview(async () => { saveBlob(await svgToPng(shown(".art-mermaid svg").outerHTML), `${name}.png`); done(`${name}.png`); }, 1200) }, { label: "Mermaid", sub: "Mã nguồn sơ đồ", run: source });
  else items.push({ label: tr("Tệp mã nguồn"), sub: artFileName(art), run: source });
  const lines = art.content.split("\n");
  return (
    <aside className={`art-panel ${expanded ? "full" : ""}`} aria-label={art.title}>
      <header className="art-head">
        <span className="art-head-ic"><ArtIcon type={art.type} /></span>
        <div className="art-head-t"><b title={art.title} data-notr>{art.title}</b><span>{deck ? tr("Bản trình bày") : tr(ART_LABEL[art.type])}{art.type === "code" && art.lang ? ` · ${art.lang}` : ""}</span></div>
        {switcher}
        {versions.length > 1 && (
          <div className="art-ver">
            <button className="icon-btn" disabled={index <= 0} onClick={() => setIndex(index - 1)} aria-label="Phiên bản trước"><span className="flip"><I.ChevronR size={14} /></span></button>
            <span title={`${tr("Phiên bản")} ${index + 1}/${versions.length}`}>{index + 1}/{versions.length}</span>
            <button className="icon-btn" disabled={index >= versions.length - 1} onClick={() => setIndex(index + 1)} aria-label="Phiên bản sau"><I.ChevronR size={14} /></button>
            {art.complete && index > 0 && <button className={`icon-btn ${compare ? "on" : ""}`} onClick={() => setCompare(!compare)} aria-label="So sánh với bản trước" data-tip="So sánh với bản trước" aria-pressed={compare}><I.Compare size={15} /></button>}
          </div>
        )}
        {runnable && <div className="art-tabs"><button className={!showCode ? "on" : ""} disabled={!art.complete} onClick={() => setTab("preview")}>{tr("Xem trước")}</button><button className={showCode ? "on" : ""} onClick={() => setTab("code")}>{tr("Mã")}</button></div>}
        <div className="art-acts">
          {/* Viên phản biện đổi rộng / hẹp khi chạy xong: đặt đầu nhóm (nhóm canh phải) để nó co giãn không đẩy các nút khác nhảy chỗ
              (trước đây nút Chỉ và sửa nhảy ngang 61px ngay dưới con trỏ). */}
          {criticOf && art.complete && !compare && <CriticPill entry={crit} findings={findings} can={important(art) && !!onCritic}
            onRun={() => onCritic?.(art)} onShow={() => { setTab("code"); setTimeout(() => body.current?.querySelector(".cr-note")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); }} />}
          {stylable && <StyleSwitch key={`${art.ident}-${ver}-${reload}`} current={stylable} send={() => send.current} onKeep={onRestyle && index === versions.length - 1 ? (id) => onRestyle(art, id) : undefined} say={say} />}
          {canPick && <button className={`icon-btn ${picking ? "on" : ""}`} onClick={togglePick} aria-label="Chỉ và sửa" data-tip="Chỉ vào phần muốn sửa (hoặc giữ Alt rồi bấm)" aria-pressed={picking}><I.Pointer size={15} /></button>}
          {runnable && art.type !== "markdown" && art.type !== "mermaid" && art.type !== "d2" && !showCode && <button className="icon-btn" onClick={() => setReload((x) => x + 1)} aria-label="Chạy lại" data-tip="Chạy lại"><I.Retry size={15} /></button>}
          <button className="icon-btn" onClick={copy} aria-label="Sao chép" data-tip="Sao chép">{copied ? <I.M icon="Check" size={15} /> : <I.M icon="Copy" size={15} />}</button>
          {art.complete && extra?.(art)}
          {art.complete && <DownloadMenu items={items} say={say} note={pptxStep ? `PowerPoint ${pptxStep}` : ""} />}
          <button className="icon-btn" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Thu nhỏ" : "Toàn màn hình"} data-tip={expanded ? "Thu nhỏ" : "Toàn màn hình"}>
            <I.M icon={expanded ? "Collapse" : "Expand"} size={15} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng" data-tip="Đóng"><I.X size={16} /></button>
        </div>
      </header>
      {err && !showCode && (
        <div className="art-err"><span><b>{tr("Artifact gặp lỗi")}</b>{err}</span>{onFix && <button className="btn" onClick={() => onFix(art, err)}>{tr("Nhờ Synchro sửa")}</button>}</div>
      )}
      <div className={`art-body ${deck && !showCode && !compare ? "is-deck" : ""}`} ref={body}>
        {compare && index > 0 ? (
          <CompareView a={versions[index - 1]} b={art} ai={ai} na={index} nb={index + 1} />
        ) : showCode ? (
          <pre className="art-code">{lines.map((l, i) => {
            const n = i + 1, on = findings.filter((f) => n >= f.line_start && n <= f.line_end), end = findings.filter((f) => f.line_end === n);
            const cls = [hlLoc && n >= hlLoc.start && n <= hlLoc.end ? "hl" : "", on.length ? `cr cr-${on[0].severity}` : ""].filter(Boolean).join(" ");
            return <Fragment key={i}><div className={cls || undefined}><span>{n}</span>{toks?.[i] ? (toks[i].length ? <code className="art-tl"><TokLine toks={toks[i]} /></code> : " ") : l || " "}</div>{end.map((f) => <CriticNote key={f.title} f={f} canFix={!!onApplyFix && !!fixPatch(art.content, f)}
              onFix={() => onApplyFix?.(art, f)} onSkip={() => setSkip((x) => new Set(x).add(`${ver}:${f.line_start}:${f.title}`))} />)}</Fragment>;
          })}{!art.complete && <div className="art-caret"><span />▍</div>}</pre>
        ) : deck ? (
          <DeckView key={reload} art={art} ai={ai} onError={setErr} onMsg={onMsg} ctl={(s) => { send.current = s; }} store={conv ? { art: { conv, ident: art.ident } } : undefined} loc={!!onAsk} />
        ) : art.type === "markdown" ? (
          <div className={`art-md mdx${art.complete ? "" : " ai-streaming"}`}><Markdown text={art.content} say={say} streaming={!art.complete} /></div>
        ) : art.type === "mermaid" ? (
          <div className="art-md"><MermaidSvg code={art.content} onError={setErr} /></div>
        ) : art.type === "d2" ? (
          <div className="art-md"><D2Svg code={art.content} onError={setErr} /></div>
        ) : art.type === "vbhc" ? (
          <VbhcView content={art.content} title={art.title} onError={setErr} />
        ) : (
          <ArtifactFrame key={reload} type={art.type} content={art.content} ai={ai} onError={setErr} title={art.title} className="art-frame" onMsg={onMsg} ctl={(s) => { send.current = s; }} store={conv ? { art: { conv, ident: art.ident } } : undefined} loc={!!onAsk} />
        )}
      </div>
      {picking && <div className="pe-bar pe-hint"><I.Pointer size={15} /><span>{tr("Bấm vào phần muốn sửa trong khung xem trước. Lần sau chỉ cần giữ Alt (⌥) rồi bấm.")}</span><button className="btn" onClick={togglePick}>{tr("Thoát")}</button></div>}
      {picked && (
        <form className="pe-bar" onSubmit={(e) => { e.preventDefault(); askEdit(); }}>
          <div className="pe-what"><code data-notr>{`<${picked.tag}>`}</code><span data-notr>{picked.text || picked.sel}</span>
            {picked.loc && <button type="button" className={`pe-loc ${showCode ? "on" : ""}`} onClick={() => setTab(showCode ? "preview" : "code")} data-tip={showCode ? tr("Quay lại xem trước") : tr("Xem trong mã")}><I.Code size={12} />{tr("Dòng")} <span data-notr>{picked.loc.start === picked.loc.end ? picked.loc.start : `${picked.loc.start}–${picked.loc.end}`}</span></button>}
          </div>
          <div className="pe-in">
            <input autoFocus value={req} onChange={(e) => setReq(e.target.value)} placeholder={tr("Muốn sửa gì ở phần này?")} onKeyDown={(e) => { if (e.key === "Escape") setPicked(null); }} />
            <button type="button" className="btn" onClick={() => setPicked(null)}>{tr("Hủy")}</button>
            <button className="btn dark" disabled={!req.trim()}>{tr("Sửa phần này")}</button>
          </div>
        </form>
      )}
      {footer}
    </aside>
  );
}

type Summary = { id: string; conv: string; ident: string; title: string; type: ArtType; lang: string | null; updated_at: number; count: number; preview: string; full?: boolean };

// Ảnh thu nhỏ: chạy thật artifact ở kích thước nhỏ (html/svg/react), tài liệu và mã hiện vài dòng đầu.
// Danh sách chỉ kèm phần đầu của artifact: trang web dài bị cắt mất thân trang và script (ảnh thu nhỏ trống / đen), nên khi thẻ hiện ra
// thì tải bản đầy đủ rồi mới chạy. Trong lúc tải, ô hiện vệt chờ thay vì nền trắng (trang tối nháy trắng trên giao diện tối), khung chạy xong
// (sự kiện load của iframe, bắt ở pha capture vì load không nổi bọt) mới hiện dần; quá 5 giây thì hiện luôn.
function Thumb({ a }: { a: Summary }) {
  const [vis, setVis] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setVis(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  const live = a.type === "html" || a.type === "svg" || a.type === "react";
  useEffect(() => {
    if (!vis || !live || a.full !== false) return;
    let on = true;
    fetch(`/api/artifacts/${encodeURIComponent(a.id)}?latest=1`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) setDoc(typeof j?.content === "string" ? j.content : a.preview); }).catch(() => { if (on) setDoc(a.preview); });
    return () => { on = false; };
  }, [vis, live, a.full, a.id, a.preview]);
  const content = a.full === false ? doc : a.preview;
  const vb = a.type === "vbhc" ? parseVbhc(a.preview).spec : null;
  const framed = vis && (!!vb || (live && content !== null));
  useEffect(() => {
    const el = ref.current; if (!el || !framed) return;
    const done = () => setOk(true), t = setTimeout(done, 5000);
    el.addEventListener("load", done, true);
    return () => { clearTimeout(t); el.removeEventListener("load", done, true); };
  }, [framed]);
  // inert: ảnh thu nhỏ chỉ để nhìn. Từng là các điểm dừng Tab vô hình (nút sắp xếp bảng, nút trong khung HTML) nằm giữa thẻ và nút Xóa.
  return (
    <div className={`art-thumb t-${a.type}${(vb || live) && !ok ? " wait" : ""}`} ref={ref} inert aria-hidden="true">
      {vb ? (vis && <div className="art-thumb-scale"><iframe className="art-thumb-frame" title={a.title} srcDoc={vbhcHtml(vb, a.title)} sandbox="" /></div>)
        : live ? (vis && content !== null && <div className="art-thumb-scale"><ArtifactFrame type={a.type} content={content} ai={false} title={a.title} className="art-thumb-frame" /></div>)
        : a.type === "markdown" ? <div className="art-thumb-doc mdx"><Markdown text={a.preview.split("\n").slice(0, 24).join("\n")} say={() => {}} /></div>
        : <pre>{a.preview.split("\n").slice(0, 14).join("\n")}</pre>}
      <span className="art-thumb-shade" />
    </div>
  );
}

export function ArtifactsGallery({ tab, q, ai, say, onOpenChat, refreshKey }: { tab: number; q: string; ai: boolean; say: (m: string) => void; onOpenChat: (conv: string) => boolean; refreshKey?: number }) {
  const app = useApp();
  const [list, setList] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<{ id: string; versions: ArtVersion[]; index: number; conv: string } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  // Lỗi tải khác với "chưa có artifact nào": báo rõ kèm nút thử lại.
  const load = useCallback(() => { setLoadErr(false); fetch("/api/artifacts").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j) => setList(j.artifacts ?? [])).catch(() => setLoadErr(true)); }, []);
  useEffect(load, [load, refreshKey]);
  const show = async (id: string) => {
    const j = await fetch(`/api/artifacts/${id}`).then((r) => r.json()).catch(() => null);
    const a = j?.artifact;
    if (!a) { say(tr("Không mở được artifact")); return; }
    const versions = (a.versions as { content: string; at: number }[]).map((v) => ({ ident: a.ident, title: a.title, type: a.type, lang: a.lang, content: v.content, complete: true, at: v.at }));
    setOpen({ id, versions, index: versions.length - 1, conv: a.conv });
  };
  // Xóa là xóa hẳn mọi phiên bản (artifactstore.ts): hỏi lại như khi xóa hàng loạt.
  const del = (id: string, title: string) => app.confirm(`${tr("Xóa")} “${title}”?`, tr("Mọi phiên bản của artifact này sẽ bị xóa, không hoàn tác được."), tr("Xóa"), async () => {
    const r = await fetch(`/api/artifacts/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setList((l) => l?.filter((x) => x.id !== id) ?? null); setOpen((o) => (o?.id === id ? null : o)); say(tr("Đã xóa artifact")); }
    else say(tr("Chưa xóa được artifact. Hãy thử lại."));
  });
  const shown = (tab === 2 ? [] : list ?? []).filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()));
  // Chọn hàng loạt: xóa nhiều artifact cùng lúc.
  const bk = useBulk(shown, (a) => a.id);
  const pg = usePage(shown, 24, `${tab}|${q}`);
  const acts: BulkAct<Summary>[] = [
    { id: "del", label: tr("Xóa"), icon: <I.Trash size={14} />, danger: true,
      confirm: (l) => ({ title: `${tr("Xóa")} ${l.length} artifact?`, text: tr("Mọi phiên bản của các artifact này sẽ bị xóa, không hoàn tác được."), ok: tr("Xóa") }),
      run: async (l) => { const gone = new Set<string>(); await each(l, async (a) => { const r = await fetch(`/api/artifacts/${a.id}`, { method: "DELETE" }); if (r.ok) gone.add(a.id); }); setList((x) => x?.filter((a) => !gone.has(a.id)) ?? null); say(`${tr("Đã xóa")} ${gone.size} artifact`); } },
  ];
  const when = (t: number) => new Date(t).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", getLang() === "en" ? { day: "numeric", month: "short", year: "numeric" } : { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <>
      {loadErr && list === null ? <div className="err-box" role="alert"><b>{tr("Chưa tải được danh sách artifact")}</b><button className="btn" onClick={load}>{tr("Thử lại")}</button></div>
        : list === null ? <div className="art-grid">{[0, 1, 2].map((i) => <div key={i} className="art-tile sk" />)}</div>
        : shown.length === 0 ? (
          <div className="empty"><I.Shapes size={64} /><b>{tab === 2 ? tr("Chưa có artifact nào được chia sẻ với bạn") : q ? tr("Không tìm thấy artifact nào") : tr("Các artifact của bạn nằm ở đây")}</b><span>{tab === 2 ? tr("Khi ai đó chia sẻ artifact với bạn, nó sẽ hiện ở đây.") : tr("Bắt đầu từ một mẫu ở trên, hoặc yêu cầu Synchro tạo thứ gì đó trong bất kỳ đoạn chat nào.")}</span></div>
        ) : (
          <>
          <div className="bk-head"><span className="bk-head-n">{shown.length} artifact</span><BulkButton b={bk} /></div>
          <div className="art-grid">
            {pg.items.map((a) => (
              <div key={a.id} className="art-tile" onClick={() => show(a.id)} {...bulkRow(bk, a)}>
                {bk.on && <BulkCheck on={bk.has(a)} />}
                <Thumb a={a} />
                <div className="art-tile-meta">
                  <span className="art-tile-ic"><ArtIcon type={a.type} size={15} /></span>
                  <div><b data-notr><button type="button" className="art-tile-open">{a.title}</button></b><span>{tr(ART_LABEL[a.type])} · {when(a.updated_at)}{a.count > 1 ? ` · ${a.count} ${tr("phiên bản")}` : ""}</span></div>
                  {!bk.on && <button className="icon-btn" aria-label={tr("Xóa artifact")} onClick={(e) => { e.stopPropagation(); del(a.id, a.title); }}><I.Trash size={14} /></button>}
                </div>
              </div>
            ))}
          </div>
          <PageBar pg={pg} />
          <BulkBar b={bk} acts={acts} noun="artifact" />
          </>
        )}
      {open && (
        <div className="overlay art-modal" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <ArtifactPanel versions={open.versions} index={open.index} setIndex={(i) => setOpen({ ...open, index: i })} ai={ai} onClose={() => setOpen(null)} expanded={false} setExpanded={() => {}} say={say}
            footer={<div className="art-foot"><button className="btn" onClick={() => { if (!onOpenChat(open.conv)) say(tr("Cuộc trò chuyện gốc không còn trên thiết bị này")); }}>{tr("Mở cuộc trò chuyện")}</button><button className="btn danger" onClick={() => del(open.id, open.versions[open.index]?.title ?? "artifact")}>{tr("Xóa")}</button></div>} />
        </div>
      )}
    </>
  );
}
