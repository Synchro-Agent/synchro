"use client";
// Quả cầu giọng nói dạng chất lỏng có hạt (shader voice-orb của @starc007 trên 21st.dev).
// Mọi quả cầu trên trang dùng chung MỘT ngữ cảnh WebGL: vẽ lần lượt từng quả rồi chép sang canvas 2D của nó,
// nên danh sách hàng chục giọng vẫn mượt và không vượt giới hạn số ngữ cảnh WebGL của trình duyệt.
// Màu là bộ ba hài hòa sinh từ một sắc chủ đạo: màu gốc, màu sáng (lệch nhẹ về phía ấm) và màu tối cùng họ.
import { useEffect, useRef } from "react";

const VERT = `attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform vec2 u_resolution; uniform float u_time; uniform float u_activity; uniform float u_seed;
uniform vec3 u_base; uniform vec3 u_light; uniform vec3 u_dark;
float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * 0.57 + noise(p * 2.03 + 7.2) * 0.28 + noise(p * 4.07 + 3.1) * 0.15; }
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  float t = (u_time + u_seed) * 0.38;
  float angle = atan(p.y, p.x);
  float breath = sin((u_time + u_seed) * 1.4) * 0.008;
  float ripple = sin(angle * 3.0 + t * 2.1) * 0.55 + sin(angle * 5.0 - t * 1.7) * 0.30 + sin(angle * 2.0 + t) * 0.15;
  p /= 0.91 + breath + u_activity * 0.025 + ripple * (0.004 + u_activity * 0.024);
  float r2 = dot(p, p);
  float aa = 3.0 / min(u_resolution.x, u_resolution.y);
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r2);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 normal = vec3(p, sqrt(max(0.0, 1.0 - r2)));
  vec3 flow = vec3(normal.xy * 1.65, normal.z * 1.4);
  flow.xy += vec2(sin(normal.y * 2.6 + t), cos(normal.x * 2.3 - t * 0.8)) * (0.25 + u_activity * 0.22);
  vec3 warp = vec3(noise(flow + vec3(0.0, t, t * 0.3)), noise(flow + vec3(4.7, -t * 0.7, t)), noise(flow + vec3(t * 0.5, 9.2, -t))) - 0.5;
  float pigment = fbm(flow + warp * 1.4 + vec3(t * 0.3, -t * 0.2, t * 0.4));
  float fold = normal.x * 0.50 + normal.y * 0.32 + sin(normal.y * 2.6 - t) * 0.30 + (pigment - 0.5) * 0.65;
  float shadow = smoothstep(-0.30, 0.42, fold);
  vec3 color = mix(u_dark, u_base, shadow);
  color = mix(color, u_light, smoothstep(0.40, 0.82, pigment) * 0.34);
  float diffuse = max(0.0, dot(normal, normalize(vec3(-0.4, 0.65, 1.0))));
  color *= 0.64 + 0.46 * diffuse;
  float shine = exp(-pow((fold + 0.06) * 8.0, 2.0)) * pow(normal.z, 0.65);
  float innerLight = exp(-pow((fold - 0.28) * 4.0, 2.0)) * normal.z;
  color = mix(color, u_light, innerLight * (0.18 + u_activity * 0.16));
  color = mix(color, mix(u_light, vec3(1.0), 0.55), shine * 0.78);
  float gleam = pow(max(0.0, dot(normal, normalize(vec3(-0.45, 0.55, 1.0)))), 24.0);
  color += gleam * 0.16;
  float rim = pow(1.0 - normal.z, 3.0);
  color = mix(color, u_light, rim * (0.36 + 0.25 * max(0.0, -normal.x)));
  float grain = hash(vec3(gl_FragCoord.xy, 1.0)) - 0.5;
  color += grain * 0.032;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}`;

type RGB = [number, number, number];
const hsl = (h: number, s: number, l: number): RGB => {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};
// Bộ ba màu cùng họ: gốc vừa sáng, điểm sáng lệch +18° và nhạt, vùng tối lệch -14° và sâu.
export const orbPalette = (hue: number): [RGB, RGB, RGB] => [hsl(hue, 58, 54), hsl(hue + 18, 88, 86), hsl(hue - 14, 52, 20)];

type Orb = { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D; hue: number; seed: number; target: () => number; act: number; vel: number; visible: boolean; t: number };

// Bộ vẽ dùng chung, tạo khi có quả cầu đầu tiên và huỷ khi không còn quả nào.
const pool = (() => {
  const orbs = new Set<Orb>();
  let gl: WebGLRenderingContext | null = null, canvas: HTMLCanvasElement | null = null;
  let u: Record<string, WebGLUniformLocation | null> = {};
  let raf = 0, last = 0, io: IntersectionObserver | null = null;
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const init = () => {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a_position"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["u_resolution", "u_time", "u_activity", "u_seed", "u_base", "u_light", "u_dark"]) u[n] = gl.getUniformLocation(prog, n);
    gl.clearColor(0, 0, 0, 0);
    io = new IntersectionObserver((es) => { for (const e of es) for (const o of orbs) if (o.el === e.target) o.visible = e.isIntersecting; wake(); });
    for (const o of orbs) io.observe(o.el);
  };
  const frame = (now: number) => {
    raf = 0;
    if (!gl || !canvas || document.hidden) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let any = false;
    for (const o of orbs) {
      if (!o.visible) continue;
      any = true;
      // Lò xo giảm chấn tới mức hoạt động mục tiêu, cho chuyển động mềm như bản gốc.
      const goal = Math.max(0, Math.min(1, o.target()));
      o.vel += ((goal - o.act) * 260 - o.vel * 30) * dt; o.act += o.vel * dt;
      if (!still) o.t += dt * (1 + o.act * 0.6);
      const w = Math.max(8, Math.min(512, Math.round(o.el.clientWidth * dpr)));
      if (o.el.width !== w) { o.el.width = w; o.el.height = w; }
      gl.viewport(0, 0, w, w);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const [b, l, d] = orbPalette(o.hue);
      gl.uniform2f(u.u_resolution, w, w); gl.uniform1f(u.u_time, o.t); gl.uniform1f(u.u_activity, o.act); gl.uniform1f(u.u_seed, o.seed);
      gl.uniform3f(u.u_base, ...b); gl.uniform3f(u.u_light, ...l); gl.uniform3f(u.u_dark, ...d);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      o.ctx.clearRect(0, 0, w, w);
      o.ctx.drawImage(canvas, 0, canvas.height - w, w, w, 0, 0, w, w);
    }
    if (any && !still) raf = requestAnimationFrame(frame); else last = 0;
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
  return {
    add(o: Orb) { if (!gl) init(); orbs.add(o); io?.observe(o.el); wake(); },
    remove(o: Orb) {
      orbs.delete(o); io?.unobserve(o.el);
      if (!orbs.size && gl) { cancelAnimationFrame(raf); raf = 0; io?.disconnect(); io = null; gl.getExtension("WEBGL_lose_context")?.loseContext(); gl = null; canvas = null; u = {}; }
    },
    wake,
  };
})();

// Một quả cầu. hue: sắc chủ đạo (độ). activity: 0..1 (số hoặc hàm đọc liên tục, ví dụ mức âm lượng).
export function LiquidOrb({ hue, activity = 0, className, style }: { hue: number; activity?: number | (() => number); className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const act = useRef(activity);
  act.current = activity;
  const hueRef = useRef<Orb | null>(null);
  useEffect(() => {
    const el = ref.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const o: Orb = { el, ctx, hue, seed: (hue * 7.31) % 40, target: () => { const a = act.current; return typeof a === "function" ? a() : a; }, act: 0, vel: 0, visible: true, t: 0 };
    hueRef.current = o;
    pool.add(o);
    return () => pool.remove(o);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hueRef.current) { hueRef.current.hue = hue; pool.wake(); } }, [hue]);
  useEffect(() => { pool.wake(); }, [activity]);
  return <canvas ref={ref} className={className} style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%", ...style }} aria-hidden="true" />;
}
