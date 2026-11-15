"use client";

import { Loader } from "./brand";
import { Component, useEffect, useRef, useState } from "react";
import { armDraft } from "./draft";
import { labelMenu, registerMenu } from "./a11y";
import { tr } from "../app/i18n";
import { reportError } from "./errorreport";

// role: menu thật (mặc định); bảng thông tin dùng chung khung này thì đặt "dialog".
export function Menu({ open, className = "", style, children, role = "menu" }: { open: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode; role?: string }) {
  const [mounted, setMounted] = useState(open);
  const [out, setOut] = useState(false);
  const last = useRef(children);
  if (open) last.current = children;
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && el.current) return registerMenu(el.current); }, [open]);
  useEffect(() => { if (open && el.current && role === "menu") labelMenu(el.current); });
  useEffect(() => {
    if (open) { setMounted(true); setOut(false); return; }
    if (!mounted) return;
    setOut(true);
    const t = setTimeout(() => { setMounted(false); setOut(false); }, 120);
    return () => clearTimeout(t);
  }, [open, mounted]);
  if (!mounted && !open) return null;
  return <div ref={el} role={role} className={`menu ${className} ${out && !open ? "out" : ""}`} style={style}>{open ? children : last.current}</div>;
}

// text: bước đang làm của lượt chạy nền ("Đang đọc skill …"), hiện cạnh chấm động.
export function Thinking({ label, text }: { label: string; text?: string }) {
  return (
    <div className="thinking" role="status" aria-label={text || label}><Loader size={15} />{text && <span className="thinking-t" key={text}>{text}</span>}</div>
  );
}

export function vt(fn: () => void, flush: (f: () => void) => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (d.startViewTransition && !reduced) d.startViewTransition(() => flush(fn));
  else fn();
}

export function Fade({ show, children, ms = 170 }: { show: boolean; children: React.ReactNode; ms?: number }) {
  const [mounted, setMounted] = useState(show);
  const last = useRef(children);
  if (show) last.current = children;
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  if (!show && !mounted) return null;
  return <div className={`lw ${show ? "" : "closing"}`}>{show ? children : last.current}</div>;
}

// Khung bắt lỗi cho một phần của trang: một tin nhắn hay một tab Cài đặt lỗi không kéo sập cả app (và không mất phần đang gõ).
// resetKey đổi (đổi mục, tin nhắn có thêm chữ) thì tự thử dựng lại.
export class Boundary extends Component<{ children: React.ReactNode; resetKey?: unknown; compact?: boolean }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: unknown) { console.error(e); reportError(e, "boundary"); }
  componentDidUpdate(p: { resetKey?: unknown }) { if (this.state.err && p.resetKey !== this.props.resetKey) this.setState({ err: false }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className={`err-box${this.props.compact ? " sm" : ""}`} role="alert">
        <b>{tr("Phần này gặp lỗi khi hiển thị")}</b>
        <span>{tr("Các phần khác của Synchro vẫn dùng được bình thường.")}</span>
        <button className="btn" onClick={() => { armDraft(); this.setState({ err: false }); }}>{tr("Thử lại")}</button>
      </div>
    );
  }
}
