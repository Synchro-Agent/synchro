"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Markdown } from "./md";

import { docText, getBlob, getStatus, hasBlob } from "./filestate";
import { locale } from "./i18n";
export { saveBlob, saveDoc, fileContext } from "./filestate";

function NoText({ name }: { name: string }) {
  const b = getBlob(name);
  const [url, setUrl] = useState("");
  useEffect(() => { if (b && b.type.startsWith("image/")) { const u = URL.createObjectURL(b); setUrl(u); return () => URL.revokeObjectURL(u); } }, [b]);
  if (url) return <img src={url} alt={name} style={{ maxWidth: "100%", borderRadius: "var(--r-plate)" }} />;
  return <p className="muted" style={{ margin: 0 }}>Không có bản xem trước cho loại tệp này. Dùng “Tải về” để mở tệp gốc, hoặc “Tải lên và chuyển thành markdown” để đọc nội dung.</p>;
}

type Target = { name: string; text: string; x: number; y: number } | null;

export function useFileMenu(say: (m: string) => void) {
  const [t, setT] = useState<Target>(null);
  const [view, setView] = useState<{ name: string; text: string } | null>(null);
  const [raw, setRaw] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!t) return;
    const close = () => setT(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc); window.addEventListener("blur", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); window.removeEventListener("blur", close); };
  }, [t]);
  useEffect(() => {
    if (!view && !img) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setView(null); setImg(null); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [view, img]);
  const open = (e: React.MouseEvent, name: string, text?: string) => {
    const tx = text ?? docText(name) ?? "";
    if (!tx && !hasBlob(name)) return;
    e.preventDefault(); e.stopPropagation();
    setT({ name, text: tx, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 140) });
  };
  /** Bấm vào thẻ tệp như Claude: ảnh mở khung xem lớn, tệp khác mở bản xem trước nội dung. */
  const show = (name: string, fid?: string, text?: string) => {
    const st = getStatus(name), b = getBlob(name);
    if (st?.thumb && !st.pdf && !st.folder) { setImg(st.thumb); return; }
    if (b && b.type.startsWith("image/")) { setImg(URL.createObjectURL(b)); return; }
    if (fid && /\.(png|jpe?g|gif|webp)$/i.test(name)) { setImg(`/api/files/thumb?id=${fid}`); return; }
    setView({ name, text: docText(name) ?? text ?? "" }); setRaw(false);
  };
  const download = (n: string, tx: string) => { const u = URL.createObjectURL(getBlob(n) ?? new Blob([tx], { type: "text/plain" })); const a = document.createElement("a"); a.href = u; a.download = n; a.click(); URL.revokeObjectURL(u); };
  const node = typeof document === "undefined" ? null : createPortal(
    <>
      {t && (
        <div className="menu fm-menu" style={{ position: "fixed", left: t.x, top: t.y, width: 200, zIndex: 400 }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button className="menu-item" onClick={() => { setView({ name: t.name, text: t.text }); setRaw(false); setT(null); }}><I.Eye />Xem trước</button>
          <button className="menu-item" onClick={() => { download(t.name, t.text); setT(null); }}><I.Download />Tải về</button>
          <button className="menu-item" onClick={() => { if (!t.text) { say("Tệp này không có nội dung văn bản để sao chép"); setT(null); return; } navigator.clipboard?.writeText(t.text); say("Đã sao chép nội dung"); setT(null); }}><I.Copy />Sao chép nội dung</button>
        </div>
      )}
      {img && (
        <div className="overlay ft-lightbox" onMouseDown={(e) => e.target === e.currentTarget && setImg(null)}>
          {/* Cơ chế hộp thoại chung (a11y.ts) cần một phần tử mang vai trò dialog; display:contents để không đổi bố cục ảnh. */}
          <div role="dialog" aria-modal="true" aria-label="Xem ảnh" style={{ display: "contents" }}>
            <img src={img} alt="Ảnh đang xem" />
            <button className="icon-btn" onClick={() => setImg(null)} aria-label="Đóng"><I.X size={16} /></button>
          </div>
        </div>
      )}
      {view && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setView(null)}>
          <div className="modal upl wide">
            <div className="upl-h"><span>{view.name}</span><span className="upl-beta">Xem trước</span><button className="icon-btn" onClick={() => setView(null)} aria-label="Đóng"><I.X size={16} /></button></div>
            <div className="upl-res">
              <div className="upl-bar">
                <div className="seg"><button className={!raw ? "on" : ""} onClick={() => setRaw(false)}>Xem</button><button className={raw ? "on" : ""} onClick={() => setRaw(true)}>Mã nguồn</button></div>
                <span className="upl-meta">{view.text.length.toLocaleString(locale())} ký tự</span>
              </div>
              <div className="upl-doc">{!view.text ? <NoText name={view.name} /> : raw || !/\.(md|markdown)$/i.test(view.name) ? <pre>{view.text}</pre> : <Markdown text={view.text} say={say} />}</div>
            </div>
          </div>
        </div>
      )}
    </>, document.body);
  return { open, show, node };
}
