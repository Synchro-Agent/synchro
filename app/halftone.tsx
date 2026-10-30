"use client";
// Nền toàn màn hình của tab Code: shader "Halftone Vibe" (21st.dev Shader Builder), WebGL1 thuần.
// Màu theo bộ nhận diện v4 (trung tính, không màu nhấn): nền Carbon với chấm Ash → Graphite → Ivory ở theme tối, nền Ivory với chấm
// Stone → Graphite ở theme sáng.
import { useEffect, useRef } from "react";

const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 u_colors[8];
uniform vec4 u_scene; uniform vec4 u_shape; uniform vec4 u_surface; uniform vec4 u_finish; uniform vec4 u_transform; uniform vec4 u_space; uniform vec4 u_cursor;
#define u_resolution u_scene.xy
#define u_time u_scene.z
#define u_colorCount u_scene.w
#define u_scale u_shape.x
#define u_intensity u_shape.y
#define u_paramA u_shape.z
#define u_warp u_shape.w
#define u_detail u_surface.x
#define u_contrast u_surface.y
#define u_brightness u_surface.z
#define u_saturation u_surface.w
#define u_hue u_finish.x
#define u_vignette u_finish.y
#define u_grain u_finish.w
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define u_seed u_transform.x
#else
#define u_seed mod(u_transform.x, 31.0)
#endif
float grainHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 palette(float x) {
  float n = max(u_colorCount - 1.0, 1.0);
  float f = clamp(x, 0.0, 1.0) * n;
  vec3 col = u_colors[0];
  for (int i = 0; i < 7; i++) { if (float(i) < n) col = mix(col, u_colors[i + 1], smoothstep(0.0, 1.0, clamp(f - float(i), 0.0, 1.0))); }
  return col;
}
vec3 shade(vec2 p, float t) {
  float cells = 18.0 + u_intensity * 30.0;
  vec2 f = fract(p * cells) - 0.5;
  float field = 0.5 + 0.5 * sin(p.x * 3.0 + t + u_seed) * sin(p.y * 2.4 - t * 0.7);
  float r = (0.06 + u_paramA * 0.34) + field * 0.2;
  float dotMask = 1.0 - smoothstep(r - 0.08, r, length(f));
  return mix(u_colors[0], palette(field), dotMask);
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  p *= u_scale;
  vec3 col = shade(p, u_time);
  col = (col - 0.5) * u_contrast + 0.5;
  if (abs(u_saturation - 1.0) > 0.0001) { float luma = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(luma), col, u_saturation); }
  col += u_brightness;
  if (u_grain > 0.0001) col += (grainHash(gl_FragCoord.xy + vec2(u_seed * 17.0, u_seed * 31.0)) - 0.5) * u_grain;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Hai bảng màu: theme tối và theme sáng.
const THEMES = {
  dark: { colors: ["#111210", "#2A2B26", "#5C5D56", "#B9B8AF"], contrast: 0.9, grain: 0.05, brightness: 0 },
  light: { colors: ["#EEECE5", "#DCD9CF", "#B5B3AA", "#85867E"], contrast: 0.95, grain: 0.03, brightness: 0.01 },
};

export function HalftoneBg() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Mỗi lần gắn tạo canvas mới, không dùng lại canvas đã huỷ ngữ cảnh.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    box.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) { canvas.remove(); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uColors = U("u_colors"), uScene = U("u_scene");
    gl.uniform4f(U("u_shape"), 1.48, 0.88, 0.5, 0);
    gl.uniform4f(U("u_transform"), 2926, 0, 0, 0);
    gl.uniform4f(U("u_space"), 0, 0, 0, 0);
    gl.uniform4f(U("u_cursor"), 0, 2, 0.65, 0.46);
    const uSurface = U("u_surface"), uFinish = U("u_finish");
    const applyTheme = () => {
      const t = THEMES[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
      const arr = new Float32Array(24); t.colors.forEach((c, i) => arr.set(hex(c), i * 3));
      gl.uniform3fv(uColors, arr);
      gl.uniform4f(uSurface, 2.4, t.contrast, t.brightness, 1);
      gl.uniform4f(uFinish, 0, 0, 0, t.grain);
    };
    applyTheme();
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let w = 0, h = 0;
    const size = () => { const dpr = Math.min(window.devicePixelRatio || 1, 2); w = Math.round(canvas.clientWidth * dpr); h = Math.round(canvas.clientHeight * dpr); canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); };
    const ro = new ResizeObserver(size); ro.observe(canvas); size();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      raf = 0;
      gl.uniform4f(uScene, w, h, ((now - t0) / 1000) * 1.43, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const vis = () => { if (!document.hidden && !raf) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", vis);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", vis); gl.getExtension("WEBGL_lose_context")?.loseContext(); canvas.remove(); };
  }, []);
  return <div ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0 }} />;
}
