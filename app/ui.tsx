"use client";

import { FluidDots } from "./fluid-dots";
import { useEffect, useRef, useState } from "react";

export function Menu({ open, className = "", style, children }: { open: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [out, setOut] = useState(false);
  const last = useRef(children);
  if (open) last.current = children;
  useEffect(() => {
    if (open) { setMounted(true); setOut(false); return; }
    if (!mounted) return;
    setOut(true);
    const t = setTimeout(() => { setMounted(false); setOut(false); }, 120);
    return () => clearTimeout(t);
  }, [open, mounted]);
  if (!mounted && !open) return null;
  return <div className={`menu ${className} ${out && !open ? "out" : ""}`} style={style}>{open ? children : last.current}</div>;
}

export function Spark({ size = 18 }: { size?: number }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="currentColor" aria-hidden>
      {rays.map((a) => <rect key={a} x="18.2" y="2" width="3.6" height="13" rx="1.8" transform={`rotate(${a} 20 20)`} />)}
    </svg>
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="thinking" role="status" aria-label={label}><FluidDots size={14} /></div>
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
