"use client";
// Giao diện Artifact: thẻ trong tin nhắn, khung xem bên cạnh cuộc trò chuyện (xem trước / mã / phiên bản),
// khung chạy cô lập (iframe sandbox, không cùng nguồn gốc với Synchro, CSP chặn gọi mạng) và trang Artifacts.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { getLang, tr } from "./i18n";
import { Markdown } from "./md";
import { artifactComplete, type OutFile } from "./llm";
import { fileKind } from "./fileicon";
import { ART_LABEL, artFileName, type ArtBlock, type ArtType } from "./artifacts";

export type ArtVersion = ArtBlock & { at?: number };

// ---------------------------------------------------------------- khung chạy cô lập
const V = "/vendor/";
// Thư viện cho artifact React: tải từ /vendor của Synchro; nếu trình duyệt chặn (khung cô lập không được gọi về máy
// localhost khi chạy thử cục bộ) thì tải bản giống hệt từ jsDelivr. Mã băm toàn vẹn (SRI) bảo đảm đúng từng byte.
const LIBS: [string, string, string][] = [
  ["tailwind-browser-4.3.3.js", "@tailwindcss/browser@4.3.3/dist/index.global.js", "sha384-2ql948lIdLcGEE0/qxNiudyTjgauA3RDJERu5xW75kFCvSl5a9odyQYCb6tEjnmB"],
  ["react-18.3.1.min.js", "react@18.3.1/umd/react.production.min.js", "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"],
  ["react-dom-18.3.1.min.js", "react-dom@18.3.1/umd/react-dom.production.min.js", "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"],
  ["prop-types-15.8.1.min.js", "prop-types@15.8.1/prop-types.min.js", "sha384-/AfDwVDXNopzPvhxMPQ11y1OCpR6mVkWx47qzSwIiquvxkcMkZddEzDNtIOtfCpk"],
  ["recharts-2.15.4.min.js", "recharts@2.15.4/umd/Recharts.js", "sha384-8WLbYxXTeAFm5KD1lWOhUghb4T1QP+Y15d4aEGIFc6zzN2BMObhTK1u7mXiLbp8p"],
  ["lucide-react-0.460.0.min.js", "lucide-react@0.460.0/dist/umd/lucide-react.min.js", "sha384-JEoKym/kMViouWwSkyVNKeAyxFMvD/XeYv4VtG86kNEtGxzuvjSjTqWulOQd6dNY"],
  ["babel-7.29.11.min.js", "@babel/standalone@7.29.11/babel.min.js", "sha384-WLl8kKG54INe3zxB+zrpQr6Z1cgCoBg+ZirrqnCcjzA5sjvtSirQ11bgyU91deI+"],
];
const CDNS = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
const esc = (s: string) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Cầu nối trong artifact: window.synchro.complete (và window.claude.complete cho artifact viết theo Claude),
// báo lỗi và chiều cao nội dung về cho Synchro. Chỉ trao đổi qua postMessage với đúng khung cha.
const bridge = (ch: string) => `<script>(function(){var ch=${JSON.stringify(ch)},seq=0,wait={};
function post(m){m.__synchro=ch;try{parent.postMessage(m,"*")}catch(e){}}
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.__synchro!==ch||d.t!=="res"||!wait[d.id])return;var w=wait[d.id];delete wait[d.id];d.error?w[1](new Error(d.error)):w[0](d.text)});
var api={complete:function(p){return new Promise(function(ok,no){var id=++seq;wait[id]=[ok,no];post({t:"complete",id:id,prompt:p})})}};
window.synchro=api;window.claude=api;
addEventListener("error",function(e){post({t:"error",message:String(e.message||(e.error&&e.error.message)||"Lỗi không rõ"),line:e.lineno||0})});
addEventListener("unhandledrejection",function(e){var r=e.reason;post({t:"error",message:String(r&&r.message||r)})});
var last=0;function h(f){var v=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(f||v!==last){last=v;post({t:"height",h:v})}}
addEventListener("load",function(){h(1);post({t:"ready"});setTimeout(function(){h(1)},250);setTimeout(function(){h(1)},1200);try{new ResizeObserver(function(){h()}).observe(document.body||document.documentElement)}catch(e){setInterval(h,500)}});
})();</script>`;

function csp(origin: string) {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}${V} ${CDNS}; style-src 'unsafe-inline' https://fonts.googleapis.com ${CDNS}; font-src https://fonts.gstatic.com ${CDNS} data:; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}
const BASE_CSS = `<style>:root{color-scheme:light dark}html,body{margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style>`;

export function buildDoc(type: ArtType, content: string, origin: string, ch: string, dark: boolean): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp(origin)}${bridge(ch)}`;
  if (type === "html") {
    // Chèn CSP + cầu nối vào <head> của trang (hoặc bọc trang nếu model chỉ viết phần thân).
    if (/<head[^>]*>/i.test(content)) return content.replace(/<head[^>]*>/i, (m) => m + head);
    if (/<html[^>]*>/i.test(content)) return content.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
    return `<!doctype html><html><head>${head}${BASE_CSS}</head><body>${content}</body></html>`;
  }
  if (type === "svg") {
    return `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:${dark ? "#1b1b1b" : "#fff"}}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${content}</body></html>`;
  }
  // React: tải thư viện theo thứ tự, dịch JSX/TSX bằng Babel trong khung, import được react, recharts, lucide-react; có Tailwind.
  const libs = LIBS.map(([f, cdn, sri]) => [`${origin}${V}${f}`, `https://cdn.jsdelivr.net/npm/${cdn}`, sri]);
  const loading = `<style>.__ld{position:fixed;inset:0;display:grid;place-items:center}.__ld i{width:22px;height:22px;border-radius:50%;border:2px solid #d6d6d0;border-top-color:#545452;animation:__s .8s linear infinite}@keyframes __s{to{transform:rotate(360deg)}}</style><div class="__ld"><i></i></div>`;
  return `<!doctype html><html><head>${head}${BASE_CSS}</head><body><div id="root">${loading}</div>
<script>(function(){var src=${esc(JSON.stringify(content))},libs=${JSON.stringify(libs)},i=0;
function load(u,sri,cb){var s=document.createElement("script");s.src=u;s.crossOrigin="anonymous";s.integrity=sri;s.onload=function(){cb(true)};s.onerror=function(){s.remove();cb(false)};document.head.appendChild(s)}
function next(){if(i>=libs.length)return run();var l=libs[i++];load(l[0],l[2],function(ok){if(ok)return step();load(l[1],l[2],function(ok2){if(!ok2)throw new Error("Không tải được thư viện cho artifact. Kiểm tra kết nối mạng rồi bấm Chạy lại.");step()})})}
function step(){if(window.React&&!window.react)window.react=window.React;next()}
function run(){var mods={"react":React,"react-dom":ReactDOM,"react-dom/client":ReactDOM,"recharts":Recharts,"lucide-react":LucideReact,"prop-types":PropTypes};
function req(n){if(mods[n])return mods[n];throw new Error('Thư viện "'+n+'" không có sẵn trong artifact (chỉ có react, recharts, lucide-react).')}
var out=Babel.transform(src,{filename:"App.tsx",presets:[["typescript",{isTSX:true,allExtensions:true}],["react",{runtime:"classic"}]],plugins:["transform-modules-commonjs"]}).code;
var module={exports:{}};new Function("module","exports","require","React",out)(module,module.exports,req,React);
var C=module.exports.default||module.exports.App||Object.values(module.exports).find(function(v){return typeof v==="function"});
if(!C)throw new Error("Không tìm thấy component (cần export default).");
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(C))}
next()})();</script></body></html>`;
}

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

// Khung chạy artifact (html / react / svg). ai: cho gọi window.synchro.complete.
export function ArtifactFrame({ type, content, ai, onError, onHeight, title, className, style }: { type: ArtType; content: string; ai: boolean; onError?: (m: string) => void; onHeight?: (h: number) => void; title: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ch = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), [content, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = useMemo(() => buildDoc(type, content, location.origin, ch, isDark()), [type, content, ch]);
  const cb = useRef({ onError, onHeight, ai });
  cb.current = { onError, onHeight, ai };
  // Gắn trước khi khung kịp tải (khung nhỏ có thể tải xong trước cả useEffect).
  useLayoutEffect(() => {
    const h = async (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const d = e.data as { __synchro?: string; t?: string; id?: number; prompt?: unknown; message?: string; h?: number };
      if (!d || d.__synchro !== ch) return;
      if (d.t === "height" && typeof d.h === "number") cb.current.onHeight?.(d.h);
      else if (d.t === "error") cb.current.onError?.(String(d.message ?? "").slice(0, 500));
      else if (d.t === "complete") {
        const res = (m: Record<string, unknown>) => w.postMessage({ __synchro: ch, t: "res", id: d.id, ...m }, "*");
        if (!cb.current.ai) return res({ error: tr("Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng.") });
        try { res({ text: await artifactComplete(d.prompt) }); } catch (err) { res({ error: (err as Error).message }); }
      }
    };
    addEventListener("message", h);
    return () => removeEventListener("message", h);
  }, [ch]);
  return <iframe ref={ref} key={ch} title={title} className={className} style={style} srcDoc={doc}
    sandbox="allow-scripts allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" allow="clipboard-write" referrerPolicy="no-referrer" />;
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

// ---------------------------------------------------------------- biểu tượng theo loại
function ArtIcon({ type, size = 18 }: { type: ArtType; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "react") return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>;
  if (type === "html") return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" /></svg>;
  if (type === "svg") return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>;
  if (type === "markdown") return <svg {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
  if (type === "mermaid") return <svg {...p}><rect x="3" y="3" width="7" height="6" rx="1.5" /><rect x="14" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 9v3.5a2 2 0 002 2H14" /></svg>;
  return <svg {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>;
}

// ---------------------------------------------------------------- thẻ trong tin nhắn
export function ArtifactCard({ art, version, total, active, onOpen }: { art: ArtBlock; version: number; total: number; active: boolean; onOpen: () => void }) {
  return (
    <button className={`art-card ${active ? "on" : ""} ${art.complete ? "" : "busy"}`} onClick={onOpen}>
      <span className="art-card-ic"><ArtIcon type={art.type} size={20} />{!art.complete && <span className="art-spin sm" />}</span>
      <span className="art-card-txt">
        <b>{art.title}</b>
        <span>{tr(art.complete ? ART_LABEL[art.type] : "Đang tạo…")}{total > 1 && <> · {tr("Phiên bản")} {version}</>}{art.complete && <> · <em>{tr(active ? "Đang mở" : "Nhấn để mở")}</em></>}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- khung xem bên cạnh
export function ArtifactPanel({ versions, index, setIndex, ai, onClose, onFix, expanded, setExpanded, say, footer }: {
  versions: ArtVersion[]; index: number; setIndex: (i: number) => void; ai: boolean; onClose: () => void; onFix?: (a: ArtVersion, err: string) => void;
  expanded: boolean; setExpanded: (v: boolean) => void; say: (m: string) => void; footer?: React.ReactNode;
}) {
  const art = versions[Math.min(index, versions.length - 1)];
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const runnable = art.type !== "code";
  const showCode = tab === "code" || !runnable || !art.complete;
  useEffect(() => { setErr(""); }, [art.content, reload]);
  useEffect(() => { if (!runnable) setTab("code"); }, [runnable]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && expanded) setExpanded(false); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [expanded, setExpanded]);
  const copy = () => { navigator.clipboard?.writeText(art.content); setCopied(true); say(tr("Đã sao chép nội dung artifact")); setTimeout(() => setCopied(false), 1500); };
  const download = () => {
    const name = artFileName(art);
    const url = URL.createObjectURL(new Blob([art.content], { type: art.type === "html" ? "text/html" : art.type === "svg" ? "image/svg+xml" : "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`${tr("Đã tải")} ${name}`);
  };
  const lines = art.content.split("\n");
  return (
    <aside className={`art-panel ${expanded ? "full" : ""}`} aria-label={art.title}>
      <header className="art-head">
        <span className="art-head-ic"><ArtIcon type={art.type} /></span>
        <div className="art-head-t"><b title={art.title}>{art.title}</b><span>{tr(ART_LABEL[art.type])}{art.type === "code" && art.lang ? ` · ${art.lang}` : ""}</span></div>
        {versions.length > 1 && (
          <div className="art-ver">
            <button className="icon-btn" disabled={index <= 0} onClick={() => setIndex(index - 1)} aria-label="Phiên bản trước"><span className="flip"><I.ChevronR size={14} /></span></button>
            <span title={`${tr("Phiên bản")} ${index + 1}/${versions.length}`}>{index + 1}/{versions.length}</span>
            <button className="icon-btn" disabled={index >= versions.length - 1} onClick={() => setIndex(index + 1)} aria-label="Phiên bản sau"><I.ChevronR size={14} /></button>
          </div>
        )}
        {runnable && <div className="art-tabs"><button className={!showCode ? "on" : ""} disabled={!art.complete} onClick={() => setTab("preview")}>{tr("Xem trước")}</button><button className={showCode ? "on" : ""} onClick={() => setTab("code")}>{tr("Mã")}</button></div>}
        <div className="art-acts">
          {runnable && art.type !== "markdown" && art.type !== "mermaid" && !showCode && <button className="icon-btn" onClick={() => setReload((x) => x + 1)} aria-label="Chạy lại" data-tip="Chạy lại"><I.Retry size={15} /></button>}
          <button className="icon-btn" onClick={copy} aria-label="Sao chép" data-tip="Sao chép">{copied ? <I.Check size={15} /> : <I.Copy size={15} />}</button>
          <button className="icon-btn" onClick={download} aria-label="Tải về" data-tip="Tải về"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" /></svg></button>
          <button className="icon-btn" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Thu nhỏ" : "Toàn màn hình"} data-tip={expanded ? "Thu nhỏ" : "Toàn màn hình"}>
            {expanded ? <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /></svg>
              : <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></svg>}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng" data-tip="Đóng"><I.X size={16} /></button>
        </div>
      </header>
      {err && !showCode && (
        <div className="art-err"><span><b>{tr("Artifact gặp lỗi")}</b>{err}</span>{onFix && <button className="btn" onClick={() => onFix(art, err)}>{tr("Nhờ Synchro sửa")}</button>}</div>
      )}
      <div className="art-body">
        {showCode ? (
          <pre className="art-code">{lines.map((l, i) => <div key={i}><span>{i + 1}</span>{l || " "}</div>)}{!art.complete && <div className="art-caret"><span />▍</div>}</pre>
        ) : art.type === "markdown" ? (
          <div className="art-md mdx"><Markdown text={art.content} say={say} /></div>
        ) : art.type === "mermaid" ? (
          <div className="art-md"><MermaidSvg code={art.content} onError={setErr} /></div>
        ) : (
          <ArtifactFrame key={reload} type={art.type} content={art.content} ai={ai} onError={setErr} title={art.title} className="art-frame" />
        )}
      </div>
      {footer}
    </aside>
  );
}

// ---------------------------------------------------------------- lưu artifact lên máy chủ (trang Artifacts)
export async function saveArtifacts(conv: string, items: ArtBlock[]) {
  const list = items.filter((a) => a.complete).map((a) => ({ ident: a.ident, title: a.title, type: a.type, lang: a.lang, content: a.content }));
  if (!list.length) return;
  await fetch("/api/artifacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conv, items: list }) }).catch(() => {});
}

type Summary = { id: string; conv: string; ident: string; title: string; type: ArtType; lang: string | null; updated_at: number; count: number; preview: string };

// Ảnh thu nhỏ: chạy thật artifact ở kích thước nhỏ (html/svg/react), tài liệu và mã hiện vài dòng đầu.
function Thumb({ a }: { a: Summary }) {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setVis(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  const live = a.type === "html" || a.type === "svg" || a.type === "react";
  return (
    <div className={`art-thumb t-${a.type}`} ref={ref}>
      {live ? (vis && <div className="art-thumb-scale"><ArtifactFrame type={a.type} content={a.preview} ai={false} title={a.title} className="art-thumb-frame" /></div>)
        : <pre>{a.preview.split("\n").slice(0, 14).join("\n")}</pre>}
      <span className="art-thumb-shade" />
    </div>
  );
}

export function ArtifactsGallery({ tab, q, ai, say, onOpenChat, refreshKey }: { tab: number; q: string; ai: boolean; say: (m: string) => void; onOpenChat: (conv: string) => boolean; refreshKey?: number }) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<{ id: string; versions: ArtVersion[]; index: number; conv: string } | null>(null);
  const load = useCallback(() => { fetch("/api/artifacts").then((r) => r.json()).then((j) => setList(j.artifacts ?? [])).catch(() => setList([])); }, []);
  useEffect(load, [load, refreshKey]);
  const show = async (id: string) => {
    const j = await fetch(`/api/artifacts/${id}`).then((r) => r.json()).catch(() => null);
    const a = j?.artifact;
    if (!a) { say(tr("Không mở được artifact")); return; }
    const versions = (a.versions as { content: string; at: number }[]).map((v) => ({ ident: a.ident, title: a.title, type: a.type, lang: a.lang, content: v.content, complete: true, at: v.at }));
    setOpen({ id, versions, index: versions.length - 1, conv: a.conv });
  };
  const del = async (id: string) => {
    const r = await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
    if (r.ok) { setList((l) => l?.filter((x) => x.id !== id) ?? null); if (open?.id === id) setOpen(null); say(tr("Đã xóa artifact")); }
  };
  const shown = (tab === 2 ? [] : list ?? []).filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()));
  const when = (t: number) => new Date(t).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      {list === null ? <div className="art-grid">{[0, 1, 2].map((i) => <div key={i} className="art-tile sk" />)}</div>
        : shown.length === 0 ? (
          <div className="empty"><I.Shapes size={64} /><b>{tab === 2 ? tr("Chưa có artifact nào được chia sẻ với bạn") : q ? tr("Không tìm thấy artifact nào") : tr("Các artifact của bạn nằm ở đây")}</b><span>{tab === 2 ? tr("Khi ai đó chia sẻ artifact với bạn, nó sẽ hiện ở đây.") : tr("Bắt đầu từ một mẫu ở trên, hoặc yêu cầu Synchro tạo thứ gì đó trong bất kỳ đoạn chat nào.")}</span></div>
        ) : (
          <div className="art-grid">
            {shown.map((a) => (
              <div key={a.id} className="art-tile" role="button" tabIndex={0} onClick={() => show(a.id)} onKeyDown={(e) => e.key === "Enter" && show(a.id)}>
                <Thumb a={a} />
                <div className="art-tile-meta">
                  <span className="art-tile-ic"><ArtIcon type={a.type} size={15} /></span>
                  <div><b>{a.title}</b><span>{tr(ART_LABEL[a.type])} · {when(a.updated_at)}{a.count > 1 ? ` · ${a.count} ${tr("phiên bản")}` : ""}</span></div>
                  <button className="icon-btn" aria-label="Xóa artifact" onClick={(e) => { e.stopPropagation(); del(a.id); }}><I.Trash size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      {open && (
        <div className="art-modal" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <ArtifactPanel versions={open.versions} index={open.index} setIndex={(i) => setOpen({ ...open, index: i })} ai={ai} onClose={() => setOpen(null)} expanded={false} setExpanded={() => {}} say={say}
            footer={<div className="art-foot"><button className="btn" onClick={() => { if (!onOpenChat(open.conv)) say(tr("Cuộc trò chuyện gốc không còn trên thiết bị này")); }}>{tr("Mở cuộc trò chuyện")}</button><button className="btn danger" onClick={() => del(open.id)}>{tr("Xóa")}</button></div>} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- tệp code đã tạo (run_code → outputs/)
const KIND: Record<string, string> = { docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel", csv: "CSV", pptx: "PowerPoint", pdf: "PDF", png: "Ảnh", jpg: "Ảnh", jpeg: "Ảnh", gif: "Ảnh", webp: "Ảnh", svg: "SVG", json: "JSON", md: "Markdown", txt: "Văn bản", html: "HTML", zip: "ZIP" };
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export function OutputFiles({ files }: { files: OutFile[] }) {
  const imgs = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.mime));
  return (
    <div className="outs">
      {imgs.length > 0 && <div className="outs-imgs">{imgs.map((f) => <a key={f.id} href={`/api/outputs/${f.id}?inline=1`} target="_blank" rel="noreferrer"><img src={`/api/outputs/${f.id}?inline=1`} alt={f.name} loading="lazy" /></a>)}</div>}
      {files.map((f) => {
        const k = fileKind(f.name);
        return (
          <a key={f.id} className="out-card" href={`/api/outputs/${f.id}`} download={f.name} title={tr("Tải về")}>
            <span className="out-badge" style={{ background: k.color }}>{k.label}</span>
            <span className="out-txt"><b data-notr>{f.name}</b><span>{tr(KIND[k.ext] ?? "Tệp")} · {fmtSize(f.size)}</span></span>
            <span className="out-dl"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" /></svg></span>
          </a>
        );
      })}
    </div>
  );
}
