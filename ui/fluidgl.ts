// Phần WebGL của FluidDots (fluiddots.tsx): ngữ cảnh dùng chung, dựng / nhả canvas theo lúc chấm hiện trên màn hình.
// Tách riêng và tải khi một chấm cần vẽ lần đầu, để phần tải đầu của trang chat chỉ có chấm CSS.
import { FLUID_FRAG } from "./fluidshader";

const VERT = "attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }";

type Slot = { wake: () => void };
const g = globalThis as unknown as { __synchroFluid?: { holder: Slot | null; waiting: Slot[] } };
const pool = (g.__synchroFluid ??= { holder: null, waiting: [] });
function claim(s: Slot): boolean {
  if (pool.holder === s) return true;
  if (!pool.holder) { pool.holder = s; pool.waiting = pool.waiting.filter((x) => x !== s); return true; }
  if (!pool.waiting.includes(s)) pool.waiting.push(s);
  return false;
}
function release(s: Slot) {
  pool.waiting = pool.waiting.filter((x) => x !== s);
  if (pool.holder !== s) return;
  pool.holder = null;
  // Bản đang chờ (cũng đang hiện) nhận ngữ cảnh ngay, không đợi lần cuộn sau.
  pool.waiting.shift()?.wake();
}

const tintOf = (el: Element): [number, number, number] => {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(el).color);
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : [0.5, 0.5, 0.5];
};

/** Dựng canvas + chương trình WebGL trong box và vẽ liên tục. Trả hàm dừng (nhả ngữ cảnh, gỡ canvas), null khi không
 *  dựng được. */
function start(box: HTMLElement, size: number, onLost: () => void): (() => void) | null {
  const cv = document.createElement("canvas");
  cv.className = "fd-gl";
  cv.setAttribute("aria-hidden", "true");
  const gl = cv.getContext("webgl",
    { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return null;
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!, vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FLUID_FRAG);
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // Máy không dịch được shader (GPU cũ, trình điều khiển lỗi): dùng chấm CSS, ghi lý do để còn biết máy nào gặp.
    console.warn("[fluiddots] shader:", gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "iResolution"), uTime = gl.getUniformLocation(prog, "iTime");
  const uTint = gl.getUniformLocation(prog, "uTint");
  // Canvas rộng gấp 4 lần chấm: quầng sáng tràn ra ngoài mà không đẩy chữ bên cạnh (canvas nằm tuyệt đối, giữa box).
  const px = Math.round(size * 4 * Math.min(window.devicePixelRatio || 1, 2));
  cv.width = px; cv.height = px;
  cv.style.width = cv.style.height = `${size * 4}px`;
  gl.viewport(0, 0, px, px);
  box.appendChild(cv);
  const lost = (e: Event) => { e.preventDefault(); onLost(); };
  cv.addEventListener("webglcontextlost", lost);
  const t0 = performance.now();
  let raf = 0, n = 0, tint = tintOf(box);
  const frame = () => {
    // Đọc lại màu mỗi ~0,5 giây: đổi giao diện sáng / tối giữa lúc đang trả lời vẫn đúng màu.
    if (++n % 30 === 0) tint = tintOf(box);
    gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
    gl.uniform2f(uRes, px, px);
    gl.uniform1f(uTime, (performance.now() - t0) / 1000);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  };
  frame();
  return () => {
    cancelAnimationFrame(raf);
    cv.removeEventListener("webglcontextlost", lost);
    gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
    // Nhả hẳn ngữ cảnh ngay (không chờ bộ dọn rác) để bản khác dựng được ngữ cảnh của nó.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cv.remove();
  };
}

/** Gắn hiệu ứng WebGL vào box của FluidDots: vẽ khi box hiện trên màn hình và tab đang mở. Trả hàm gỡ. */
export function attach(el: HTMLElement, size: number): () => void {
  let seen = false, stop: (() => void) | null = null, broken = false;
  const slot: Slot = { wake: () => sync() };
  const halt = () => { stop?.(); stop = null; el.classList.remove("live"); release(slot); };
  function sync() {
    const want = seen && !document.hidden && !broken;
    if (want && !stop) {
      if (!claim(slot)) return;
      stop = start(el, size, () => { broken = true; halt(); });
      if (stop) el.classList.add("live");
      else { broken = true; release(slot); }
    } else if (!want && stop) halt();
    else if (!want) release(slot);
  }
  const io = new IntersectionObserver((es) => { seen = es.some((e) => e.isIntersecting); sync(); });
  io.observe(el);
  document.addEventListener("visibilitychange", sync);
  return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); halt(); };
}
