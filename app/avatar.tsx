"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { initials, usePref, useApp } from "./store";

// `src` truyền vào khi hiển thị người khác (vd. danh sách quản trị). Không truyền thì là ảnh của chính mình:
// ảnh đã tải lên (lưu trên máy chủ, có bản sao trong trình duyệt) hoặc ảnh từ Google/GitHub.
export function Avatar({ name, size = 24, font = 9, src }: { name: string; size?: number; font?: number; src?: string | null }) {
  const [own] = usePref("avatar", "");
  const me = useApp().me;
  const img = src !== undefined ? src : own || me?.avatar || "";
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: font }}>
      {img ? <img src={img} alt="" draggable={false} /> : initials(name)}
    </span>
  );
}

const OK = ["image/png", "image/jpeg"];
const isOk = (f: File) => OK.includes(f.type) || /\.(png|jpe?g)$/i.test(f.name);
const STAGE = 320, D = 260;

export function AvatarButton({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="av-edit" onClick={() => setOpen(true)} aria-label="Đổi ảnh đại diện">
        <Avatar name={name} size={36} font={12} />
        <span className="av-pen"><I.Pencil size={16} /></span>
      </button>
      {open && createPortal(<AvatarFlow onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function AvatarFlow({ onClose }: { onClose: () => void }) {
  const [own, setOwn] = usePref("avatar", "");
  const app = useApp();
  const avatar = own || app.me?.avatar || "";
  // Lưu lên máy chủ để ảnh đi theo tài khoản (đăng nhập máy khác vẫn thấy), giữ bản sao trong trình duyệt.
  const setAvatar = (d: string) => {
    setOwn(d);
    fetch("/api/auth/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatar: d }) })
      .then((r) => r.json()).then((j) => { if (j.user) app.setMe(j.user); else if (j.error) app.say(j.error); }).catch(() => {});
  };
  const [src, setSrc] = useState<{ url: string; w: number; h: number } | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [over, setOver] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  const take = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (files.length > 1 || !isOk(f)) { setErr("Chỉ hỗ trợ một ảnh JPG hoặc PNG."); return; }
    if (f.size > 10 * 1024 * 1024) { setErr("Ảnh quá lớn (tối đa 10MB)."); return; }
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { setErr(""); setSrc({ url, w: im.naturalWidth, h: im.naturalHeight }); };
    im.onerror = () => { URL.revokeObjectURL(url); setErr("Không đọc được ảnh này."); };
    im.src = url;
  }, []);

  useEffect(() => {
    let n = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopImmediatePropagation(); n++; setDrag(true); };
    const leave = (e: DragEvent) => { e.stopImmediatePropagation(); n = Math.max(0, n - 1); if (!n) setDrag(false); };
    const ovr = (e: DragEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const drop = (e: DragEvent) => { e.preventDefault(); e.stopImmediatePropagation(); n = 0; setDrag(false); take(Array.from(e.dataTransfer?.files ?? [])); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("dragenter", enter, true); window.addEventListener("dragleave", leave, true);
    window.addEventListener("dragover", ovr, true); window.addEventListener("drop", drop, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("dragenter", enter, true); window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("dragover", ovr, true); window.removeEventListener("drop", drop, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [take, onClose]);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src.url); }, [src]);

  return (
    <>
      <div className="overlay" data-av style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {!src ? (
          <div className="modal upl">
            <div className="upl-h"><span>Tải ảnh đại diện</span><span className="upl-beta">JPG · PNG</span><button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={16} /></button></div>
            <div className={`upl-zone ${over ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={() => setOver(false)}>
              <b>Kéo ảnh vào đây</b>
              <span>Chỉ hỗ trợ ảnh JPG hoặc PNG, tối đa 10MB</span>
              {err && <em className="upl-err">{err}</em>}
              <input ref={inp} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; take(f); }} />
              <div className="av-actions">
                <button className="btn" onClick={() => inp.current?.click()}>Chọn ảnh</button>
                {avatar && <button className="btn" onClick={() => { setAvatar(""); onClose(); }}>Xóa ảnh hiện tại</button>}
              </div>
            </div>
          </div>
        ) : (
          <Cropper src={src} onBack={() => setSrc(null)} onClose={onClose} onSave={(d) => { setAvatar(d); onClose(); }} />
        )}
      </div>
      {drag && <div className="drop"><div className="drop-in"><div className="drop-ic"><I.Image size={30} /><I.Copy size={30} /><I.Folder size={30} /></div><span>Thả ảnh vào đây</span></div></div>}
    </>
  );
}

function Cropper({ src, onBack, onClose, onSave }: { src: { url: string; w: number; h: number }; onBack: () => void; onClose: () => void; onSave: (d: string) => void }) {
  const base = D / Math.min(src.w, src.h);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const sc = base * zoom;
  const clamp = (p: { x: number; y: number }, s = sc) => {
    const mx = Math.max(0, (src.w * s - D) / 2), my = Math.max(0, (src.h * s - D) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZ = (z: number) => { const nz = Math.min(4, Math.max(1, z)); setZoom(nz); setPos((p) => clamp(p, base * nz)); };

  const save = () => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const ctx = c.getContext("2d")!;
      const sx = (src.w * sc / 2 - pos.x - D / 2) / sc, sy = (src.h * sc / 2 - pos.y - D / 2) / sc, sw = D / sc;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(im, sx, sy, sw, sw, 0, 0, 256, 256);
      onSave(c.toDataURL("image/jpeg", 0.9));
    };
    im.src = src.url;
  };

  return (
    <div className="modal upl crop">
      <div className="upl-h"><span>Căn chỉnh ảnh đại diện</span><button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button></div>
      <div className="crop-stage" style={{ width: STAGE, height: STAGE }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })); }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setZ(zoom - e.deltaY / 400)}>
        <img src={src.url} alt="" draggable={false} style={{ width: src.w * sc, height: src.h * sc, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }} />
        <div className="crop-mask" style={{ width: D, height: D }} />
      </div>
      <div className="crop-zoom"><I.Image size={14} /><input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZ(+e.target.value)} /><I.Image size={20} /></div>
      <div className="crop-foot"><button className="btn" onClick={onBack}>Chọn ảnh khác</button><button className="btn dark" onClick={save}>Lưu</button></div>
    </div>
  );
}
