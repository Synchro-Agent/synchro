// Gói 3D cho artifact của Synchro (public/vendor/synchro-3d-1.0.0.js, dựng bằng scripts/build-vendor-3d.mjs): window.Synchro3D.
// React và ReactDOM lấy từ khung (bản 18.3.1 đã nạp sẵn), không đóng gói lần hai. Không tải gì qua mạng: nền shader dùng lightType "3d" (chỉ ánh sáng môi trường,
// không tệp HDR), kính khúc xạ dùng Environment dựng từ Lightformer (không tệp ảnh môi trường).
// Xuất ảnh / PowerPoint / PDF không trắng: canvas giữ bộ đệm vẽ (preserveDrawingBuffer) để đọc được thành ảnh, và luôn có lớp CSS cực quang cùng màu nằm dưới
// (hiện ra khi máy không có WebGL, mất ngữ cảnh WebGL, hay lúc chưa vẽ xong). Giảm chuyển động (prefers-reduced-motion) và lúc chụp (window.__sxStatic) thì đứng yên.
import * as THREE from "three";
import * as Fiber from "@react-three/fiber";
import { Canvas, useThree } from "@react-three/fiber";
import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";
import { Environment, Float, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import React, { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Bộ thông số "sóng lụa Indigo - Emerald" của chủ dự án (mục 6.3), giữ nguyên từng giá trị.
export const MASTER_SHADER = {
  animate: "on", axesHelper: "off", bgColor1: "#08090E", bgColor2: "#0F172A", brightness: 1.15, cAzimuthAngle: 180, cDistance: 3.6, cPolarAngle: 90, cameraZoom: 1,
  color1: "#4F46E5", color2: "#0EA5E9", color3: "#10B981", envPreset: "city", grain: "on", lightType: "3d", positionX: -0.5, positionY: 0, positionZ: 0, reflection: 0.1,
  rotationX: 0, rotationY: 10, rotationZ: 50, shader: "defaults", type: "waterPlane", uAmplitude: 1.4, uDensity: 1.2, uFrequency: 5.5, uSpeed: 0.18, uStrength: 3.2,
} as const;

/** Lớp CSS cực quang cùng màu với nền shader: hiện khi không có WebGL, và nằm dưới canvas để ảnh xuất không bao giờ trắng. */
export const fallbackCss = (c: { color1: string; color2: string; color3: string; bgColor1: string; bgColor2: string } = MASTER_SHADER) =>
  `radial-gradient(ellipse 70% 60% at 22% 30%, ${c.color1}cc 0%, transparent 62%), radial-gradient(ellipse 60% 55% at 78% 26%, ${c.color2}99 0%, transparent 60%), radial-gradient(ellipse 75% 65% at 62% 88%, ${c.color3}88 0%, transparent 64%), linear-gradient(160deg, ${c.bgColor1} 0%, ${c.bgColor2} 100%)`;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const isStatic = () => !!(window as unknown as { __sxStatic?: number }).__sxStatic || reduced();
function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}
/** Đứng yên khi giảm chuyển động hoặc đang chụp; theo dõi thay đổi để chụp xong thì chạy lại. */
function useStill() {
  const [still, setStill] = useState(isStatic);
  useEffect(() => {
    const t = setInterval(() => setStill(isStatic()), 400);
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const on = () => setStill(isStatic());
    mq?.addEventListener?.("change", on);
    return () => { clearInterval(t); mq?.removeEventListener?.("change", on); };
  }, []);
  return still;
}
/** Canvas mất ngữ cảnh WebGL (trình duyệt giới hạn số ngữ cảnh, thẻ nền) thì bỏ canvas, lớp CSS hiện ra. */
function useContextLoss(box: React.RefObject<HTMLElement | null>, onLost: () => void) {
  useEffect(() => {
    const el = box.current; if (!el) return;
    const seen = new WeakSet<HTMLCanvasElement>();
    const hook = () => el.querySelectorAll("canvas").forEach((c) => { if (seen.has(c)) return; seen.add(c); c.setAttribute("data-sx-gl", ""); c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onLost(); }); });
    hook();
    const mo = new MutationObserver(hook); mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

type ShaderProps = Partial<Record<keyof typeof MASTER_SHADER, string | number>> & { style?: React.CSSProperties; className?: string };
/** Nền 3D shader sóng lụa: đặt trong khối position:relative, nội dung nằm trên (z-index 1). */
export function Master3DBackground({ style, className, ...over }: ShaderProps) {
  const p = { ...MASTER_SHADER, ...over } as typeof MASTER_SHADER;
  const [gl, setGl] = useState(hasWebGL);
  const still = useStill(), box = useRef<HTMLDivElement>(null);
  useContextLoss(box, () => setGl(false));
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 1.5);
  return (
    <div ref={box} className={className} data-sx-3d="shader" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden", background: fallbackCss(p), ...style }}>
      {gl && (
        <ShaderGradientCanvas style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }} pixelDensity={dpr} preserveDrawingBuffer lazyLoad={false}>
          {/* @ts-expect-error: kiểu của gói khai báo hẹp hơn các giá trị gói nhận */}
          <ShaderGradient control="props" {...p} animate={still ? "off" : p.animate} />
        </ShaderGradientCanvas>
      )}
    </div>
  );
}

/** Vẽ lại một khung khi đứng yên (frameloop "demand"): đổi cỡ, đổi chế độ. */
function Invalidate({ still }: { still: boolean }) {
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [still, invalidate]);
  return null;
}
// Thứ kính nhìn xuyên qua: canvas trong suốt (để thấy nền trang) thì bộ đệm khúc xạ chỉ có màu đen, kính thành khối đen. Cho kính một nền khúc xạ riêng
// (dải màu nhấn vẽ trên canvas 2D, không tải ảnh nào), trang phía sau vẫn nhìn thấy quanh vật thể.
function backdrop(accent: string, accent2: string) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#e8ecf8"; x.fillRect(0, 0, 256, 256);
  for (const [cx, cy, r, col] of [[70, 80, 150, accent], [190, 170, 150, accent2], [200, 50, 90, "#ffffff"]] as const) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
type GlassProps = { shape?: "torusKnot" | "sphere" | "icosahedron" | "torus"; color?: string; accent?: string; accent2?: string; style?: React.CSSProperties; className?: string };
/** Khối kính khúc xạ (drei MeshTransmissionMaterial) lơ lửng, ánh sáng từ các tấm Lightformer: vật thể hero cho bìa slide, trang đích. */
export function GlassHero({ shape = "torusKnot", color = "#ffffff", accent = "#4F46E5", accent2 = "#10B981", style, className }: GlassProps) {
  const [gl, setGl] = useState(hasWebGL);
  const still = useStill(), box = useRef<HTMLDivElement>(null);
  useContextLoss(box, () => setGl(false));
  const mobile = typeof innerWidth === "number" && innerWidth < 768;
  const geo = shape === "sphere" ? <sphereGeometry args={[1.25, 96, 96]} /> : shape === "icosahedron" ? <icosahedronGeometry args={[1.3, 1]} /> : shape === "torus" ? <torusGeometry args={[1, 0.42, 96, 192]} /> : <torusKnotGeometry args={[0.95, 0.32, 260, 36]} />;
  const fb = `radial-gradient(circle at 50% 45%, ${accent}55 0%, transparent 55%), radial-gradient(circle at 62% 60%, ${accent2}44 0%, transparent 50%)`;
  const bgTex = React.useMemo(() => (gl ? backdrop(accent, accent2) : null), [gl, accent, accent2]);
  return (
    <div ref={box} className={className} data-sx-3d="glass" style={{ position: "relative", width: "100%", height: "100%", minHeight: 160, background: fb, ...style }}>
      {gl && (
        <Canvas dpr={[1, 1.5]} frameloop={still ? "demand" : "always"} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} camera={{ position: [0, 0, 5], fov: 40 }} style={{ position: "absolute", inset: 0 }}>
          <Invalidate still={still} />
          <Float speed={still ? 0 : 1.4} rotationIntensity={still ? 0 : 0.7} floatIntensity={still ? 0 : 0.9}>
            <mesh rotation={[0.35, 0.5, 0]}>
              {geo}
              <MeshTransmissionMaterial samples={mobile ? 3 : 6} resolution={512} thickness={0.7} roughness={0.06} transmission={1} ior={1.32} chromaticAberration={0.06}
                anisotropy={0.25} distortion={0.25} distortionScale={0.35} temporalDistortion={still ? 0 : 0.12} backside color={color} background={bgTex ?? undefined} />
            </mesh>
          </Float>
          <Environment resolution={256} frames={still ? 1 : Infinity}>
            <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 4, -4]} scale={[10, 2, 1]} />
            <Lightformer form="ring" intensity={4} color={accent} position={[-4, 1, 2]} scale={2.5} />
            <Lightformer form="ring" intensity={4} color={accent2} position={[4, -1, 2]} scale={2.5} />
            <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[0, -4, 3]} scale={[8, 1, 1]} />
          </Environment>
        </Canvas>
      )}
    </div>
  );
}

// Gắn vào trang HTML (bộ CSS: <div class="sx-shader" data-sx-shader="silk|glass">): mỗi phần tử một gốc React; gỡ khi phần tử bị xóa.
const roots = new WeakMap<Element, Root>();
export function mount(el: Element, kind: string, opts: Record<string, unknown> = {}) {
  if (roots.has(el)) return;
  const root = createRoot(el);
  roots.set(el, root);
  root.render(kind === "glass" ? <GlassHero {...(opts as GlassProps)} /> : <Master3DBackground {...(opts as ShaderProps)} />);
}

const drei = { Environment, Float, Lightformer, MeshTransmissionMaterial };
const api = { version: "1.0.0", THREE, Fiber, drei, ShaderGradient, ShaderGradientCanvas, Master3DBackground, GlassHero, MASTER_SHADER, fallbackCss, mount };
(window as unknown as { Synchro3D: typeof api }).Synchro3D = api;
