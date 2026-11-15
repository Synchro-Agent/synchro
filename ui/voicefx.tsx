"use client";
// Hiệu ứng giọng nói dùng chung: Siri Wave (chế độ trò chuyện bằng giọng nói) và Voice Orb (mục Speech).
// Shader lấy từ 21st.dev (siri-wave của @40973894, voice-powered-orb của @isaiahbjork), chạy WebGL thuần,
// nền trong suốt, tự dừng vẽ khi khuất màn hình, mức âm lượng truyền qua ref để không render lại React.
import { useEffect, useRef } from "react";

export type LevelRef = { current: number };

const VERT = `attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const WAVE = `precision highp float;
uniform vec2 iResolution; uniform float iTime; uniform float uLevel;
const float PI = 3.14159265359;
const float AMPLITUDE   = 0.32;
const float FREQ        = 1.1;
const float ABER_FREQ   = 1.0;
const float SPEED       = 2.4;
const float WAVE_SCALE  = 0.6;
const float ABERRATION  = 2.6;
const float THICKNESS   = 3.0;
const float INTENSITY   = 2.;
const float FALLOFF     = 1.7;
const float EDGE_MASK   = 0.4;
const float EDGE_INSET  = 0.0;
const float BAND_FILL   = 30000.0;
const float BAND_THICK  = 0.08;
const float SOFTNESS    = 2.5;
const float LOW_AMP     = 6.0;
const float LOW_INT     = 1.5;
const float MID_ABER    = 0.8;
const float MID_ABAMP   = 0.05;
const float MID_BAND    = 20.0;
const float MID_SOFT    = 0.4;
const float HIGH_ABER   = 0.5;
const float HIGH_ABAMP  = 0.06;
const float RESOLVED    = 1.0;
const float UNRES_SCALE = 0.14;
vec3 spectral4(int s){ float x = float(s); return clamp(vec3(abs(x-3.0)-1.0, 2.0-abs(x-2.0), 2.0-abs(x-4.0)), 0.0, 1.0); }
void main(){
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 R = iResolution.xy;
    float aspect = R.x / R.y;
    vec2 p = (fragCoord + 0.5) * 2.0 / R - 1.0;
    p.x *= aspect;
    float yScreen = p.y;
    p /= max(WAVE_SCALE, 0.1);
    float t   = iTime;
    float lv  = clamp(uLevel, 0.0, 1.0);
    float low  = clamp(0.45 + 0.45*sin(t*0.8)*sin(t*0.37+1.0) + lv*0.6, 0.0, 1.0);
    float mid  = clamp(0.40 + 0.40*sin(t*1.7+2.0)*sin(t*0.53) + lv*0.5, 0.0, 1.0);
    float high = clamp(0.30 + 0.30*sin(t*2.9+4.0)*sin(t*0.71+2.0) + lv*0.4, 0.0, 1.0);
    float res   = clamp(RESOLVED, 0.0, 1.0);
    float drift = mod(t, 20.0*PI) * SPEED;
    float xN  = p.x / max(aspect, 1.0);
    float env = cos(PI*0.5 * min(abs(0.9*xN), 1.0));
    env *= env;
    float A1    = (AMPLITUDE + 0.01*low*LOW_AMP) * (0.55 + 1.1*lv);
    float A2    = A1 + mid*MID_ABAMP + high*HIGH_ABAMP;
    float AB    = (ABERRATION + mid*MID_ABER + high*HIGH_ABER)*res;
    float th    = mix(0.1, 0.01*THICKNESS, res);
    float inten = mix(0.1, 0.01*(INTENSITY + low*LOW_INT), res);
    float soft  = 0.01*res*max(0.0, SOFTNESS + mid*MID_SOFT);
    float dUnres = max(length(p) - mix(0.14, UNRES_SCALE, res), 0.0);
    float yMain = A1 * env * res * sin(p.x*FREQ + drift);
    float bandFillTh = max(BAND_THICK, 1e-4);
    float bandAmt    = 1e-4 * BAND_FILL * inten;
    vec3 num = vec3(0.0), den = vec3(0.0);
    for(int s = 0; s < 4; s++){
        vec3 hue = mix(vec3(1.0), spectral4(s), res);
        den += hue;
        float ab = mix(-AB, AB, float(s)/3.0);
        float yL = A2 * env * res * sin(p.x*ABER_FREQ + drift + ab);
        float d   = mix(dUnres, abs(p.y - yL), res);
        float lor = mix(1.0/(1.0 + (0.02*d)*(0.02*d)), 1.0, res);
        float line = inten / (sqrt(d*d + soft*soft) + th);
        float lo = min(yMain, yL), hi = max(yMain, yL);
        float dBand = max(0.0, max(p.y - hi, lo - p.y));
        float band  = bandAmt / (dBand + bandFillTh);
        num += hue * lor * (line + band);
    }
    vec3 col = num / den;
    float dM    = mix(dUnres, abs(p.y - yMain), res);
    float lorM  = mix(1.0/(1.0 + (0.02*dM)*(0.02*dM)), 1.0, res);
    float boost = (1.0 - res) * (14.0*low + 4.0);
    col += 0.5 * inten * (lorM + boost) / (sqrt(dM*dM + soft*soft) + th);
    col = pow(max(col, 0.0), vec3(1.5));
    float emT = clamp((abs(yScreen) - 1.0 + EDGE_INSET) / (-max(EDGE_MASK, 1e-4)), 0.0, 1.0);
    float em  = emT*emT*(3.0 - 2.0*emT);
    float gauss = exp(-pow(xN*FALLOFF, 2.0));
    col *= mix(1.0, em*gauss, res);
    col = min(col * res, 1.0);
    float a = max(max(col.r, col.g), col.b);
    gl_FragColor = vec4(col, a);
}`;

const ORB = `precision highp float;
uniform float iTime; uniform vec3 iResolution; uniform float hue; uniform float hover; uniform float rot; uniform float hoverIntensity;
varying vec2 vUv;
vec3 rgb2yiq(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
vec3 yiq2rgb(vec3 c){ return vec3(c.x + 0.956*c.y + 0.621*c.z, c.x - 0.272*c.y - 0.647*c.z, c.x - 1.106*c.y + 1.703*c.z); }
vec3 adjustHue(vec3 color, float hueDeg){ float h = hueDeg*3.14159265/180.0; vec3 yiq = rgb2yiq(color); float ca = cos(h), sa = sin(h); return yiq2rgb(vec3(yiq.x, yiq.y*ca - yiq.z*sa, yiq.y*sa + yiq.z*ca)); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787)); p3 += dot(p3, p3.yxz + 19.19); return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx); }
float snoise3(vec3 p){
  const float K1 = 0.333333333; const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy); vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2); vec3 d2 = d0 - (i2 - K1); vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h*h*h*h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}
vec4 extractAlpha(vec3 c){ float a = max(max(c.r, c.g), c.b); return vec4(c.rgb / (a + 1e-5), a); }
const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
const float innerRadius = 0.6; const float noiseScale = 0.65;
float light1(float i, float a, float d){ return i / (1.0 + d*a); }
float light2(float i, float a, float d){ return i / (1.0 + d*d*a); }
vec4 draw(vec2 uv){
  vec3 color1 = adjustHue(baseColor1, hue); vec3 color2 = adjustHue(baseColor2, hue); vec3 color3 = adjustHue(baseColor3, hue);
  float ang = atan(uv.y, uv.x); float len = length(uv); float invLen = len > 0.0 ? 1.0/len : 0.0;
  float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0); v0 *= smoothstep(r0 * 1.05, r0, len);
  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
  float a = iTime * -1.0; vec2 pos = vec2(cos(a), sin(a)) * r0; float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d); v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
  vec3 col = mix(color1, color2, cl); col = mix(color3, col, v0); col = (col + v1) * v2 * v3;
  return extractAlpha(clamp(col, 0.0, 1.0));
}
void main(){
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 center = iResolution.xy * 0.5; float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;
  float s = sin(rot), c = cos(rot);
  uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y);
  uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
  vec4 col = draw(uv);
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;
type Frame = (gl: WebGLRenderingContext, u: Uniforms, t: number, dt: number, w: number, h: number) => void;

// Khung WebGL chung: một tam giác phủ màn hình, tự đổi kích thước theo khung chứa, dừng khi khuất màn hình.
// Mỗi lần gắn tạo một canvas mới (không dùng lại canvas đã bị huỷ ngữ cảnh WebGL).
function useShader(ref: React.RefObject<HTMLDivElement | null>, frag: string, names: string[], frame: Frame, maxDpr = 2) {
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    box.appendChild(canvas);
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { canvas.remove(); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram()!;
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, frag);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u: Uniforms = {};
    for (const n of names) u[n] = gl.getUniformLocation(prog, n);
    gl.clearColor(0, 0, 0, 0);
    let w = 0, h = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      w = Math.max(1, Math.round(canvas.clientWidth * dpr)); h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    };
    const ro = new ResizeObserver(size); ro.observe(canvas); size();
    let visible = true, raf = 0, last = performance.now();
    const start = last;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      gl.clear(gl.COLOR_BUFFER_BIT);
      frameRef.current(gl, u, (now - start) / 1000, dt, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => { draw(now); if (visible && !still && !document.hidden) raf = requestAnimationFrame(loop); else raf = 0; };
    const wake = () => { if (!raf && visible && !still && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); });
    io.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", wake);
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [ref, frag, maxDpr]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Sóng kiểu Siri. level: 0 (im lặng) → 1 (nói to); sóng phồng và sáng lên theo giọng.
export function SiriWave({ level, className, style }: { level?: LevelRef; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const smooth = useRef(0);
  useShader(ref, WAVE, ["iResolution", "iTime", "uLevel"], (gl, u, t, dt, w, h) => {
    const target = level?.current ?? 0.25;
    smooth.current += (target - smooth.current) * Math.min(1, dt * 8);
    gl.uniform2f(u.iResolution, w, h); gl.uniform1f(u.iTime, t); gl.uniform1f(u.uLevel, smooth.current);
  }, 1.5);
  return <div ref={ref} className={className} style={{ width: "100%", height: "100%", ...style }} aria-hidden="true" />;
}

// Quả cầu giọng nói. hue xoay màu (độ); level điều khiển tốc độ xoay và độ gợn như bản gốc phản ứng với micro.
export function VoiceOrb({ hue = 0, level, idle = 0.06, className, style }: { hue?: number; level?: LevelRef; idle?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef({ rot: 0, lv: 0 });
  useShader(ref, ORB, ["iTime", "iResolution", "hue", "hover", "rot", "hoverIntensity"], (gl, u, t, dt, w, h) => {
    const s = st.current;
    const target = Math.max(idle, level?.current ?? 0);
    s.lv += (target - s.lv) * Math.min(1, dt * 10);
    if (s.lv > 0.05) s.rot += dt * (0.3 + s.lv * 1.2 * 2);
    gl.uniform1f(u.iTime, t); gl.uniform3f(u.iResolution, w, h, w / h); gl.uniform1f(u.hue, hue);
    gl.uniform1f(u.hover, Math.min(s.lv * 2, 1)); gl.uniform1f(u.hoverIntensity, Math.min(s.lv * 0.8 * 0.8, 0.8)); gl.uniform1f(u.rot, s.rot);
  });
  return <div ref={ref} className={className} style={{ width: "100%", height: "100%", ...style }} aria-hidden="true" />;
}

// Mức âm lượng micro (0..1) cập nhật liên tục vào ref. Trả về hàm dừng.
export async function startMicLevel(out: LevelRef, sensitivity = 1.5): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === "suspended") await ctx.resume();
  const an = ctx.createAnalyser();
  an.fftSize = 512; an.smoothingTimeConstant = 0.3; an.minDecibels = -90; an.maxDecibels = -10;
  const src = ctx.createMediaStreamSource(stream);
  src.connect(an);
  const data = new Uint8Array(an.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    an.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = data[i] / 255; sum += v * v; }
    out.current = Math.min(Math.sqrt(sum / data.length) * sensitivity * 3, 1);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); out.current = 0; src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
}

// Mức âm giả lập khi đang phát giọng (chưa có luồng âm thanh thật để đo), nhấp nhô như người nói.
export function useSpeakingLevel(active: boolean, out: LevelRef) {
  useEffect(() => {
    if (!active) { out.current = 0; return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const syl = Math.max(0, Math.sin(t * 9.5) * Math.sin(t * 3.1 + 1) + Math.sin(t * 17) * 0.25);
      out.current = 0.25 + 0.6 * Math.min(1, syl) * (0.6 + 0.4 * Math.sin(t * 0.7));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); out.current = 0; };
  }, [active, out]);
}
