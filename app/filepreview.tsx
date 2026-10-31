"use client";
// Khung xem trước tệp do code tạo ra (run_code → outputs/), hiện cạnh cuộc trò chuyện như artifact:
// ảnh, âm thanh / video xem trực tiếp; PDF, Word, Excel / CSV, PowerPoint dựng trong khung cô lập (officeview.ts);
// văn bản, Markdown, JSON, mã nguồn đọc thẳng; trang HTML và SVG chạy trong khung artifact. Luôn có nút tải về.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { Markdown } from "./md";
import type { OutFile } from "./llm";
import { FILE_KIND as KIND, fileKind, fmtSize } from "./fileicon";
import { ArtifactFrame, isDeck } from "./artifactui";
import { Menu } from "./ui";
import { ART_LABEL, type ArtType } from "./artifacts";
import { officeDoc, officeKind, type OfficeKind } from "./officeview";

export const fileLabel = (f: OutFile) => `${tr(KIND[fileKind(f.name).ext] ?? "Tệp")} · ${fmtSize(f.size)}`;
const url = (f: OutFile, inline = false) => `/api/outputs/${f.id}${inline ? "?inline=1" : ""}`;
const TEXT = /\.(txt|log|md|markdown|json|jsonl|py|js|mjs|ts|tsx|jsx|css|sql|sh|yml|yaml|xml|ini|toml|html?|svg)$/i;
type Mode = "image" | "audio" | "video" | "office" | "text" | "none";
const modeOf = (f: OutFile): Mode =>
  /^image\/(png|jpeg|gif|webp)$/.test(f.mime) ? "image" : f.mime.startsWith("audio/") ? "audio" : f.mime.startsWith("video/") ? "video"
    : officeKind(f.name) ? "office" : TEXT.test(f.name) && f.size <= 2_000_000 ? "text" : "none";
export const canPreview = (f: OutFile) => modeOf(f) !== "none";

// Word / Excel / PowerPoint: khung cô lập nhận nội dung tệp qua postMessage.
function OfficeFrame({ f, kind, onPages }: { f: OutFile; kind: OfficeKind; onPages: (n: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ch = useMemo(() => Math.random().toString(36).slice(2), [f.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = useMemo(() => officeDoc(kind, f.name, location.origin, ch), [kind, f.name, ch]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const buf = useRef<Promise<ArrayBuffer> | null>(null);
  useEffect(() => { buf.current = fetch(url(f)).then((r) => { if (!r.ok) throw new Error(tr("Tệp không còn nữa (tệp được giữ 30 ngày).")); return r.arrayBuffer(); }); buf.current.catch((e) => setErr(e.message)); }, [f.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const h = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w || e.data?.__synchro !== ch) return;
      if (e.data.t === "ready") buf.current?.then((b) => { const c = b.slice(0); w.postMessage({ __synchro: ch, t: "file", buf: c }, "*", [c]); }).catch(() => {});
      else if (e.data.t === "done") { setLoading(false); if (typeof e.data.pages === "number") onPages(e.data.pages); }
      else if (e.data.t === "error") setLoading(false);
    };
    addEventListener("message", h); return () => removeEventListener("message", h);
  }, [ch]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="fp-none"><b>{err}</b></div>;
  return <>
    <iframe ref={ref} className="fp-frame" title={f.name} srcDoc={doc} sandbox="allow-scripts" referrerPolicy="no-referrer" />
    {loading && <div className="fp-loading"><span className="art-spin" /><em>{tr("Đang mở tệp…")}</em></div>}
  </>;
}

function TextView({ f, say }: { f: OutFile; say: (m: string) => void }) {
  const [t, setT] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch(url(f)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(tr("Tệp không còn nữa (tệp được giữ 30 ngày)."))))).then(setT, (e) => setErr(e.message)); }, [f.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="fp-none"><b>{err}</b></div>;
  if (t === null) return <div className="art-loading"><span className="art-spin" /></div>;
  const ext = fileKind(f.name).ext;
  if (ext === "md" || ext === "markdown") return <div className="art-md mdx"><Markdown text={t} say={say} /></div>;
  if (ext === "html" || ext === "htm") return <ArtifactFrame type="html" content={t} ai={false} title={f.name} className="art-frame" />;
  if (ext === "svg") return <ArtifactFrame type="svg" content={t} ai={false} title={f.name} className="art-frame" />;
  let shown = t;
  if (ext === "json") try { shown = JSON.stringify(JSON.parse(t), null, 2); } catch { /* giữ nguyên */ }
  return <pre className="art-code">{shown.split("\n").map((l, i) => <div key={i}><span>{i + 1}</span>{l || " "}</div>)}</pre>;
}

export function FilePanel({ file, onClose, expanded, setExpanded, say, switcher }: {
  file: OutFile; onClose: () => void; expanded: boolean; setExpanded: (v: boolean) => void; say: (m: string) => void; switcher?: React.ReactNode;
}) {
  const k = fileKind(file.name);
  const mode = modeOf(file);
  const office = officeKind(file.name);
  const [pages, setPages] = useState(0);
  useEffect(() => { setPages(0); }, [file.id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && expanded) setExpanded(false); };
    addEventListener("keydown", h); return () => removeEventListener("keydown", h);
  }, [expanded, setExpanded]);
  const unit = office === "pptx" ? "slide" : office === "pdf" ? "trang" : office === "xlsx" || office === "csv" ? "trang tính" : "";
  return (
    <aside className={`art-panel fp ${expanded ? "full" : ""}`} aria-label={file.name}>
      <header className="art-head">
        <span className="out-badge" style={{ background: k.color }}>{k.label}</span>
        <div className="art-head-t"><b title={file.name} data-notr>{file.name}</b><span>{fileLabel(file)}{pages > 1 && unit ? ` · ${pages} ${tr(unit)}` : ""}</span></div>
        {switcher}
        <div className="art-acts">
          <a className="btn fp-dl" href={url(file)} download={file.name} onClick={() => say(`${tr("Đã tải")} ${file.name}`)}><I.Download size={15} />{tr("Tải về")}</a>
          <button className="icon-btn" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Thu nhỏ" : "Toàn màn hình"} data-tip={expanded ? "Thu nhỏ" : "Toàn màn hình"}>
            <I.M icon={expanded ? "Collapse" : "Expand"} size={15} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng" data-tip="Đóng"><I.X size={16} /></button>
        </div>
      </header>
      <div className={`art-body fp-body fp-${mode}`}>
        {mode === "image" ? <div className="fp-img"><img src={url(file, true)} alt={file.name} /></div>
          : mode === "audio" ? <div className="fp-media"><audio controls src={url(file, true)} /></div>
          : mode === "video" ? <div className="fp-media"><video controls src={url(file, true)} /></div>
          : mode === "office" && office ? <OfficeFrame key={file.id} f={file} kind={office} onPages={setPages} />
          : mode === "text" ? <TextView key={file.id} f={file} say={say} />
          : <div className="fp-none"><span className="out-badge" style={{ background: k.color }}>{k.label}</span><b>{tr("Chưa xem trước được loại tệp này")}</b><span>{tr("Tải về để mở bằng ứng dụng trên máy.")}</span>
            <a className="btn" href={url(file)} download={file.name}><I.Download size={15} />{tr("Tải về")}</a></div>}
      </div>
    </aside>
  );
}

// Danh sách sản phẩm của đoạn chat (artifact và tệp), mở từ đầu khung xem trước để chuyển nhanh.
export type Product = { key: string; title: string; open: () => void; type?: ArtType; content?: string; file?: OutFile };
export function ProductSwitcher({ items, active }: { items: Product[]; active: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (items.length < 2) return null;
  return (
    <div className="prod-sw" ref={ref}>
      <button className="icon-btn prod-sw-b" onClick={() => setOpen(!open)} aria-label="Sản phẩm của đoạn chat" data-tip="Sản phẩm của đoạn chat" aria-expanded={open}>
        <I.SquaresFour size={15} />
        <span>{items.length}</span>
      </button>
      <Menu open={open} className="prod-menu">
        <div className="art-dl-h">{tr("Sản phẩm trong đoạn chat")}</div>
        {[...items].reverse().map((p) => {
          const k = p.file ? fileKind(p.file.name) : null;
          return (
            <button key={p.key} className={`menu-item prod-it ${p.key === active ? "on" : ""}`} onClick={() => { setOpen(false); p.open(); }}>
              {k ? <span className="out-badge sm" style={{ background: k.color }}>{k.label}</span> : <span className="prod-ic">{p.type && p.content !== undefined && isDeck({ type: p.type, content: p.content }) ? "▶" : "◆"}</span>}
              <span className="art-dl-t"><b data-notr>{p.title}</b><em>{p.file ? fileLabel(p.file) : p.type && p.content !== undefined && isDeck({ type: p.type, content: p.content }) ? tr("Bản trình bày") : tr(ART_LABEL[p.type!])}</em></span>
            </button>
          );
        })}
      </Menu>
    </div>
  );
}
