// Bộ vẽ shader "Halftone Vibe" (nền tab Code), WebGL1 thuần, dùng chung cho luồng chính và luồng phụ (app/halftone.worker.ts): chỉ cần một
// canvas (HTMLCanvasElement hoặc OffscreenCanvas), không đụng DOM. Màu theo bộ nhận diện v4 (trung tính, không màu nhấn): nền Carbon với chấm
// Ash → Graphite → Ivory ở theme tối, nền Ivory với chấm Stone → Graphite ở theme sáng.
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
  // Chấm chỉ là nền: mép màn hình từng gần trắng, chói hơn mọi trang khác và át cả thanh bên, ô soạn. Giữ chấm sáng nhất ở tông xám vừa đủ thấy.
  dark: { colors: ["#111210", "#1B1C19", "#2B2C27", "#47483F"], contrast: 0.9, grain: 0.05, brightness: 0 },
  light: { colors: ["#EEECE5", "#E7E5DD", "#DAD8CE", "#C4C2B8"], contrast: 0.95, grain: 0.03, brightness: 0.01 },
};

export type HalftoneTheme = keyof typeof THEMES;
export type Halftone = { size: (w: number, h: number) => void; theme: (t: HalftoneTheme) => void; wake: (hidden: boolean) => void; stop: () => void };

type Raf = (cb: (now: number) => void) => number;
/** Bắt đầu vẽ lên canvas; null nếu không có WebGL. still: không chuyển động (prefers-reduced-motion). Nền trang trí, toàn cửa sổ ở DPR tới 2:
 *  24 hình mỗi giây là đủ mượt, và không ai thao tác vài giây (wake) thì dừng hẳn. Vẽ 60 hình mỗi giây mãi mãi giữ GPU của laptop luôn bận. */
export function startHalftone(canvas: HTMLCanvasElement | OffscreenCanvas, theme: HalftoneTheme, still: boolean): Halftone | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const g = globalThis as unknown as { requestAnimationFrame?: Raf; cancelAnimationFrame?: (n: number) => void };
  const raf: Raf = g.requestAnimationFrame ? g.requestAnimationFrame.bind(globalThis) : (cb) => setTimeout(() => cb(performance.now()), 40) as unknown as number;
  const caf = (n: number) => (g.cancelAnimationFrame ? g.cancelAnimationFrame(n) : clearTimeout(n));
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
  let w = 0, h = 0, rid = 0, drew = 0, seen = performance.now(), hidden = false, stopped = false;
  const t0 = performance.now();
  const draw = (now: number) => {
    rid = 0;
    if (stopped) return;
    if (now - drew >= 40 || still) {
      drew = now;
      gl.uniform4f(uScene, w, h, ((now - t0) / 1000) * 1.43, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!still && !hidden && now - seen < 8000) rid = raf(draw);
  };
  const kick = () => { if (!rid && !stopped) rid = raf(draw); };
  const api: Halftone = {
    size: (nw, nh) => { w = nw; h = nh; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); drew = 0; kick(); },
    theme: (name) => {
      const t = THEMES[name];
      const arr = new Float32Array(24); t.colors.forEach((c, i) => arr.set(hex(c), i * 3));
      gl.uniform3fv(uColors, arr);
      gl.uniform4f(uSurface, 2.4, t.contrast, t.brightness, 1);
      gl.uniform4f(uFinish, 0, 0, 0, t.grain);
      drew = 0; kick();
    },
    wake: (hid) => { seen = performance.now(); hidden = hid; if (!hidden && !still) kick(); },
    stop: () => { stopped = true; if (rid) caf(rid); rid = 0; gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
  api.theme(theme);
  return api;
}
