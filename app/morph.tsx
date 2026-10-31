"use client";
// Chuyển động biến hình của icon (morphicons, MIT): icon này biến dần thành icon kia theo lò xo vật lý — không cắt cảnh, không mờ chồng.
// Lúc đứng yên luôn vẽ icon Phosphor gốc (app/phicon.tsx, sắc nét); chỉ trong lúc đổi (~0,5 giây) mới dùng morphicons — nó đọc icon qua
// svgToIcon (Phosphor vẽ nét bằng hình khép kín nên biến hình dạng hình tô, đúng khi đang chuyển động nhưng kém sắc khi đứng yên).
// Morph: đổi tên là biến hình. HoverMorph: biến sang icon b khi rê chuột vào mục chứa nó (.nav-item, nút, liên kết), rời chuột thì về a.
// Giảm chuyển động: đổi ngay, không biến hình.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MorphIcon, type MorphHandle } from "morphicons/react";
import { svgToIcon } from "morphicons/adapters";
import { PH } from "./phosphor-data";
import { PhIcon } from "./phicon";

type Data = ReturnType<typeof svgToIcon>;
const cache = new Map<string, Data>();
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Icon Phosphor (tên Phosphor) ở dạng dữ liệu của morphicons, đọc một lần. */
export function iconData(ph: string): Data {
  let d = cache.get(ph);
  if (!d) {
    const body = (PH[ph] ?? []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} />`).join("");
    d = svgToIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">${body}</svg>`);
    cache.set(ph, d);
  }
  return d;
}
const reduced = () => typeof document !== "undefined" && (document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches);
const SETTLE_MS = 520; // lò xo "snappy" lặng sau ~0,35 giây; chừa thêm rồi trả về icon gốc

// Một lần biến hình from → to: gắn với from rồi morphTo(to) ngay sau khi vẽ.
function Flight({ from, to, size }: { from: string; to: string; size: number }) {
  const ref = useRef<MorphHandle>(null);
  useLayoutEffect(() => { ref.current?.morphTo(iconData(to), "snappy"); }, [to]);
  return <MorphIcon ref={ref} icon={iconData(from)} size={size} reducedMotion="user" className="ph mph" />;
}

export function Morph({ name, size = 18 }: { name: string; size?: number }) {
  const prev = useRef(name);
  const [fly, setFly] = useState<{ from: string; to: string; k: number } | null>(null);
  useEffect(() => {
    if (prev.current === name) return;
    const from = prev.current;
    prev.current = name;
    if (reduced()) { setFly(null); return; }
    setFly({ from, to: name, k: Date.now() });
    const t = setTimeout(() => setFly(null), SETTLE_MS);
    return () => clearTimeout(t);
  }, [name]);
  return fly ? <Flight key={fly.k} from={fly.from} to={fly.to} size={size} /> : <PhIcon ph={name} size={size} />;
}

export function HoverMorph({ a, b, size = 18 }: { a: string; b: string; size?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const host = box.current?.closest(".nav-item, button, a, [role=button]") ?? box.current;
    if (!host) return;
    const enter = () => setOn(true), leave = () => setOn(false);
    host.addEventListener("mouseenter", enter);
    host.addEventListener("mouseleave", leave);
    return () => { host.removeEventListener("mouseenter", enter); host.removeEventListener("mouseleave", leave); };
  }, []);
  return <span ref={box} className="ph-hover"><Morph name={on ? b : a} size={size} /></span>;
}
