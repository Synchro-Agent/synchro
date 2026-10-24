"use client";
// Quả cầu ngọc trai của mục Speech: nền trắng ngà có ánh sáng ở góc trên, các mảng màu pastel (đào, xanh dừa cạn, tím nhạt)
// trôi chậm bên trong. Khi đang gọi các mảng trôi nhanh hơn, và phồng lên theo âm lượng (level 0..1).
import { useEffect, useRef } from "react";
import type { LevelRef } from "./voicefx";

export function PearlOrb({ level, active }: { level?: LevelRef; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0, v = 0;
    const tick = () => {
      const target = Math.min(1, Math.max(0, level?.current ?? 0));
      v += (target - v) * 0.14;
      ref.current?.style.setProperty("--lv", v.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div ref={ref} className={`pearl ${active ? "on" : ""}`} aria-hidden>
      <div className="pearl-core"><i className="p1" /><i className="p2" /><i className="p3" /><i className="p4" /></div>
      <span className="pearl-shine" />
    </div>
  );
}
