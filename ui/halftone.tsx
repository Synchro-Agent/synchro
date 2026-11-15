"use client";
// Nền toàn màn hình của tab Code: shader "Halftone Vibe" (21st.dev Shader Builder), bộ vẽ ở ui/halftonegl.ts.
// Vẽ ở luồng phụ (OffscreenCanvas, ui/halftone.worker.ts): tạo ngữ cảnh WebGL chặn luồng chính ~150ms (máy không có GPU còn lâu hơn), trước
// đây làm ngay lúc mở Synchro Code nên bấm vào mục Code bị khựng. Trình duyệt không chuyển được canvas sang luồng phụ (hoặc luồng phụ lỗi)
// thì vẽ ở luồng chính như trước.
import { useEffect, useRef } from "react";
import { startHalftone, type Halftone, type HalftoneTheme } from "./halftonegl";

const themeNow = (): HalftoneTheme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function HalftoneBg() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Mỗi lần gắn tạo canvas mới, không dùng lại canvas đã huỷ ngữ cảnh (hay đã chuyển sang luồng phụ).
    let canvas: HTMLCanvasElement | null = null, worker: Worker | null = null, local: Halftone | null = null, dead = false;
    const mkCanvas = () => {
      canvas?.remove();
      const c = document.createElement("canvas");
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
      box.appendChild(c);
      return (canvas = c);
    };
    const dims = () => { const dpr = Math.min(window.devicePixelRatio || 1, 2); return { w: Math.round((canvas?.clientWidth ?? 0) * dpr), h: Math.round((canvas?.clientHeight ?? 0) * dpr) }; };
    const onMain = () => {
      if (dead) return;
      worker?.terminate(); worker = null;
      local = startHalftone(mkCanvas(), themeNow(), still);
      if (!local) { canvas?.remove(); canvas = null; return; }
      const { w, h } = dims(); local.size(w, h);
    };
    const c0 = mkCanvas();
    if (typeof c0.transferControlToOffscreen === "function" && typeof Worker !== "undefined") {
      try {
        worker = new Worker(new URL("./halftone.worker.ts", import.meta.url));
        const off = c0.transferControlToOffscreen();
        worker.onmessage = (e: MessageEvent<{ t: string }>) => { if (e.data.t === "nogl" && !dead) { worker?.terminate(); worker = null; canvas?.remove(); canvas = null; } };
        worker.onerror = onMain;
        const { w, h } = dims();
        worker.postMessage({ t: "init", canvas: off, theme: themeNow(), still, w, h }, [off]);
      } catch { onMain(); }
    } else onMain();
    const send = (m: object) => worker?.postMessage(m);
    const size = () => { const { w, h } = dims(); if (local) local.size(w, h); else send({ t: "size", w, h }); };
    const theme = () => { if (local) local.theme(themeNow()); else send({ t: "theme", theme: themeNow() }); };
    const wake = () => { if (local) local.wake(document.hidden); else send({ t: "wake", hidden: document.hidden }); };
    const ro = new ResizeObserver(size); ro.observe(box);
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", wake);
    const input = ["pointermove", "keydown", "pointerdown", "wheel"] as const;
    for (const e of input) window.addEventListener(e, wake, { passive: true });
    return () => {
      dead = true;
      ro.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", wake); for (const e of input) window.removeEventListener(e, wake);
      local?.stop(); send({ t: "stop" }); worker = null; canvas?.remove();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0 }} />;
}
