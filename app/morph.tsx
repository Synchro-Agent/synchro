"use client";
// Chuyển động khi icon đổi — nhẹ nhàng, không chói mắt. Lúc đứng yên luôn vẽ icon Phosphor gốc (app/phicon.tsx, sắc nét).
// - Cặp icon cùng dáng (CLEAN: khay → khay có thư rơi vào, phát ↔ tạm dừng, sáng ↔ tối, ghim ↔ bỏ ghim…): biến hình bằng morphicons (MIT),
//   lò xo tắt dần không vọt quá (SPRING). morphicons đọc icon qua svgToIcon và biến hình dạng hình tô.
// - Cặp khác dáng: nếu biến hình, phần lòng hình bị tô kín thành mảng đen giữa chừng (đã soi từng khung — chói mắt), nên đổi kiểu mềm trên
//   chính thẻ <svg>: icon cũ thu nhỏ một chút, nhoè và mờ đi (OUT), rồi icon mới nở ra rõ dần (IN). Không thêm phần tử nào nên bố cục không đổi.
// Morph: đổi tên là chuyển. HoverMorph: chuyển sang icon b khi rê chuột vào mục chứa nó (.nav-item, nút, liên kết) và dừng ở đó một chút
// (rê lướt qua thanh bên thì không chạy hàng loạt), rời chuột thì về a. Giảm chuyển động: đổi ngay.
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

// Cặp biến hình sạch (tên Phosphor, hai chiều) — giữ nét viền suốt quá trình.
const CLEAN = new Set([
  "tray|tray-arrow-down", "play|pause", "sun|moon", "push-pin|push-pin-slash", "arrows-out-simple|arrows-in-simple", "caret-right|caret-down",
  "arrow-clockwise|check", "file|folder-simple", "terminal-window|pencil-simple", "rocket-launch|pencil-simple", "arrow-up|arrow-elbow-down-left",
  "text-aa|speaker-high", "user-sound|users", "users-three|user-sound", "squares-four|house-simple", "speaker-simple-high|sparkle",
]);
const clean = (a: string, b: string) => CLEAN.has(`${a}|${b}`) || CLEAN.has(`${b}|${a}`);
const SPRING = { stiffness: 240, damping: 31 }; // ζ ≈ 1: tắt dần, không vọt quá; lặng sau ~0,55 giây
const SETTLE_MS = 600;
// Đổi kiểu mềm: icon cũ ra nhanh (120ms), icon mới vào chậm và êm (260ms).
const SOFT: Keyframe = { opacity: 0, transform: "scale(.78)", filter: "blur(1px)" };
const OUT_MS = 120, IN_MS = 260;

// Một lần biến hình from → to: gắn với from rồi morphTo(to) ngay sau khi vẽ.
function Flight({ from, to, size }: { from: string; to: string; size: number }) {
  const ref = useRef<MorphHandle>(null);
  useLayoutEffect(() => { ref.current?.morphTo(iconData(to), SPRING); }, [to]);
  return <MorphIcon ref={ref} icon={iconData(from)} size={size} reducedMotion="user" className="ph mph" />;
}

export function Morph({ name, size = 18 }: { name: string; size?: number }) {
  const prev = useRef(name);
  const want = useRef(name);
  want.current = name;
  const [shown, setShown] = useState(name); // icon đang vẽ; ở kiểu mềm đổi sau khi icon cũ đã mờ đi
  const shownRef = useRef(name);
  shownRef.current = shown;
  const [fly, setFly] = useState<{ from: string; to: string; k: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const phase = useRef<"" | "out" | "in">("");

  // Gỡ chuyển động đang chạy, giữ nguyên dáng hiện tại (để chuyển tiếp không giật khi đổi giữa chừng).
  const settle = (el: SVGSVGElement, keep: boolean) => {
    for (const a of el.getAnimations()) { if (keep) try { a.commitStyles(); } catch {} a.cancel(); }
    if (!keep) el.style.opacity = el.style.transform = el.style.filter = "";
  };
  const fadeIn = () => {
    const el = svg.current;
    phase.current = "in";
    if (!el) { phase.current = ""; return; }
    settle(el, false);
    const a = el.animate([SOFT, { opacity: 1, transform: "none", filter: "none" }], { duration: IN_MS, easing: "cubic-bezier(.22,1,.36,1)" });
    a.onfinish = () => { if (phase.current === "in") phase.current = ""; };
  };
  const fadeOut = () => {
    const el = svg.current;
    if (!el) { setShown(want.current); return; }
    settle(el, true);
    phase.current = "out";
    const a = el.animate([SOFT], { duration: OUT_MS, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    a.onfinish = () => {
      if (phase.current !== "out") return;
      if (want.current === shownRef.current) fadeIn(); // đổi rồi lại đổi về: chỉ hiện lại icon cũ
      else setShown(want.current); // vẽ icon mới, useLayoutEffect bên dưới cho nó nở ra
    };
  };
  useLayoutEffect(() => { if (phase.current === "out") fadeIn(); }, [shown]);

  useEffect(() => {
    if (prev.current === name) return;
    const from = prev.current;
    prev.current = name;
    if (reduced()) { phase.current = ""; if (svg.current) settle(svg.current, false); setFly(null); setShown(name); return; }
    if (!phase.current && clean(from, name)) {
      setShown(name);
      setFly({ from, to: name, k: Date.now() });
      const t = setTimeout(() => setFly(null), SETTLE_MS);
      return () => clearTimeout(t);
    }
    setFly(null);
    if (phase.current !== "out") fadeOut(); // đang mờ đi thì cứ để xong, lúc đó sẽ vẽ tên mới nhất
  }, [name]);

  return fly ? <Flight key={fly.k} from={fly.from} to={fly.to} size={size} /> : <PhIcon ph={shown} size={size} svgRef={svg} />;
}

const HOVER_DELAY = 90; // rê lướt qua nhanh hơn thế thì icon đứng yên

export function HoverMorph({ a, b, size = 18 }: { a: string; b: string; size?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const host = box.current?.closest(".nav-item, button, a, [role=button]") ?? box.current;
    if (!host) return;
    let t = 0;
    const enter = () => { clearTimeout(t); t = window.setTimeout(() => setOn(true), HOVER_DELAY); };
    const leave = () => { clearTimeout(t); setOn(false); };
    host.addEventListener("mouseenter", enter);
    host.addEventListener("mouseleave", leave);
    return () => { clearTimeout(t); host.removeEventListener("mouseenter", enter); host.removeEventListener("mouseleave", leave); };
  }, []);
  return <span ref={box} className="ph-hover"><Morph name={on ? b : a} size={size} /></span>;
}
