"use client";
// "Sợi chỉ logo" — chuyển cảnh giữa đăng nhập, phim giới thiệu và trang chủ (ui/auth.tsx, ui/introfilm.tsx, app/page.tsx).
// Logo không bao giờ bị cắt giữa hai màn: một bản sao của nó bay theo đường cong từ chỗ cũ sang chỗ mới (thu phóng theo tỉ lệ log,
// đổi màu theo nền), màn cũ mở ra thành một lỗ tròn quanh chỗ logo hạ cánh (đúng hình tròn của bộ nhận diện), rồi trang chủ lắp lại
// quanh chỗ đó: khung app lắng xuống (thu phóng nhẹ về chỗ logo đáp), thanh điều hướng và bảng đoạn chat vào lần lượt, lời chào mở ra từ chính logo vừa đáp
// (như chữ "synchro" hiện ra từ mark ở cuối phim), ô soạn tin và lối tắt nổi lên sau cùng.
// Mọi chuyển động của trang chủ chạy bằng WAAPI: xong là tự gỡ, không đụng tới hiệu ứng CSS sẵn có nên không có gì chạy lại.

export type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
type Ease = (x: number) => number;

// Đường cong cubic-bezier giải bằng Newton + chia đôi (như trình duyệt), để lấy mẫu vị trí trên đường bay.
function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t, sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-6) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}
// Cùng các đường cong của bộ nhận diện (globals.css: --ease-glide, --ease-out, --ease-lock).
export const EASE = { glide: bezier(0.65, 0, 0.35, 1), out: bezier(0.33, 1, 0.68, 1), lock: bezier(0.76, 0, 0.24, 1) };
const OUT = "cubic-bezier(.33,1,.68,1)";

export const reducedMotion = () => typeof window !== "undefined" && (document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches);
export const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
/** Chỗ đến có thấy trên màn hình không (thanh bên đóng, không ở trang chủ… thì không bay tới đó). */
/** Chỗ biểu tượng Synchro bay về khi vào app (đăng nhập, hết phim giới thiệu): logo ở đầu thanh điều hướng (máy tính), hoặc nút logo
 *  ở góc trái trên khi thanh bên đóng (điện thoại). Trang chủ không còn logo cạnh lời chào. */
export const markTarget = () => [".app .rm-logo svg", ".app .side-toggle svg"].map((s) => document.querySelector(s)).find((e) => e && onScreen(boxOf(e))) ?? null;
export const onScreen = (b: Box | null): b is Box => !!b && b.w > 0 && b.h > 0 && b.x + b.w > 0 && b.x < innerWidth && b.y + b.h > 0 && b.y < innerHeight;

function rgb(s: string): [number, number, number] | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = /^#([\da-f]{6})$/i.exec(s.trim());
  return h ? [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4), 16)] : null;
}
const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/**
 * Bay theo đường cong: `el` đặt cố định đúng ở `from` (left / top, transform-origin 0 0); tới nơi thì tâm trùng tâm `to` và cao bằng `to`.
 * arc: độ cong (phần của quãng bay, võng lên trên). color: đổi màu trong khoảng colorSpan của thời gian bay.
 */
export function fly(el: Element, from: Box, to: Box, o: { ms: number; delay?: number; ease?: Ease; arc?: number; color?: [string, string]; colorSpan?: [number, number] }) {
  const ease = o.ease ?? EASE.glide;
  const p0 = center(from), p2 = center(to);
  const dx = p2.x - p0.x, dy = p2.y - p0.y, d = Math.hypot(dx, dy) || 1;
  let nx = dy / d, ny = -dx / d;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const a = (o.arc ?? 0) * d;
  const p1 = { x: (p0.x + p2.x) / 2 + nx * a, y: (p0.y + p2.y) / 2 + ny * a };
  const lk = Math.log(to.h / from.h);
  const c0 = o.color && rgb(o.color[0]), c1 = o.color && rgb(o.color[1]);
  const [cs, ce] = o.colorSpan ?? [0, 1];
  const frames: Keyframe[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const u = i / N, e = ease(u), m = 1 - e;
    const x = m * m * p0.x + 2 * m * e * p1.x + e * e * p2.x, y = m * m * p0.y + 2 * m * e * p1.y + e * e * p2.y;
    const k = Math.exp(lk * e);
    const f: Keyframe = { offset: u, transform: `translate(${(x - from.x - (from.w * k) / 2).toFixed(2)}px, ${(y - from.y - (from.h * k) / 2).toFixed(2)}px) scale(${k.toFixed(4)})` };
    if (c0 && c1) {
      const q = smooth((u - cs) / (ce - cs || 1));
      f.color = `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * q)).join(",")})`;
    }
    frames.push(f);
  }
  return el.animate(frames, { duration: o.ms, delay: o.delay ?? 0, easing: "linear", fill: "both" });
}

/**
 * Mở một lỗ tròn trong `el` (mask) tới khi lộ hết màn hình. at: tâm cố định, hoặc hàm trả tâm theo từng khung hình (lỗ đi theo logo đang bay:
 * logo mang ánh sáng của màn mới theo nó về chỗ). feather: viền (px), 1,5 = sắc như hình tròn của logo.
 */
export function openHole(el: HTMLElement, at: Pt | (() => Pt), o: { ms: number; delay?: number; ease?: Ease; feather?: number }) {
  const f = o.feather ?? 1.5, ease = o.ease ?? EASE.glide;
  const far = (c: Pt) => Math.max(...[[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]].map(([x, y]) => Math.hypot(x - c.x, y - c.y))) + f + 2;
  const set = (r: number, c: Pt) => {
    const m = `radial-gradient(circle at ${c.x.toFixed(1)}px ${c.y.toFixed(1)}px, transparent ${r.toFixed(1)}px, #000 ${(r + f).toFixed(1)}px)`;
    el.style.setProperty("-webkit-mask-image", m);
    el.style.setProperty("mask-image", m);
  };
  const pos = typeof at === "function" ? at : () => at;
  set(-f, pos());
  return new Promise<void>((done) => {
    const t0 = performance.now() + (o.delay ?? 0);
    const step = (t: number) => {
      const u = Math.min(1, Math.max(0, (t - t0) / o.ms)), c = pos();
      set(-f + (far(c) + f) * ease(u), c);
      if (u < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

/** Dừng các hiệu ứng hiện ra lúc gắn của trang chủ (vd. lời chào trượt lên) để đo đúng chỗ đến; phần lắp lại do assemble() làm. */
export function settleApp() {
  for (const a of document.querySelector(".app")?.getAnimations({ subtree: true }) ?? []) {
    try { if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish(); } catch {}
  }
}

/**
 * Trang chủ lắp lại quanh chỗ logo hạ cánh. Mốc (ms) tính từ lúc logo bắt đầu bay; logo tới nơi ở ~950 ms.
 * Gần chỗ đáp vào trước, xa vào sau: khung app lắng xuống → thanh điều hướng, bảng đoạn chat → lời chào mở ra từ logo → ô soạn tin → lối tắt.
 */
export function assemble(at: Pt | null) {
  const app = document.querySelector<HTMLElement>(".app");
  if (!app) return Promise.resolve();
  const anims: Animation[] = [];
  const go = (el: Element | null | undefined, kf: Keyframe[], delay: number, ms: number) => { if (el) anims.push(el.animate(kf, { duration: ms, delay, easing: OUT, fill: "backwards" })); };
  const r = app.getBoundingClientRect();
  const origin = at ? `${(at.x - r.left).toFixed(1)}px ${(at.y - r.top).toFixed(1)}px` : "50% 45%";
  // Chỉ thu phóng, không làm mờ: filter trên .app làm kính (backdrop-filter) của ô soạn tin và bảng đoạn chat tắt tới cuối rồi bật lại.
  go(app, [{ transform: "scale(1.025)", transformOrigin: origin }, { transform: "none", transformOrigin: origin }], 60, 1150);
  const slide: Keyframe[] = [{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }];
  const rise: Keyframe[] = [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }];
  app.querySelectorAll(".rail > .rail-mark, .rail > .rail-new, .rail-nav > *, .rail-foot > *").forEach((e, i) => go(e, slide, 380 + i * 28, 520));
  [...app.querySelectorAll(".sidebar > *")].slice(0, 8).forEach((e, i) => go(e, slide, 450 + i * 40, 560));
  go(app.querySelector(".hero-date"), rise, 900, 560);
  go(app.querySelector(".greeting .greet-t"), [
    { clipPath: "inset(-30% 100% -30% 0)", transform: "translateX(-14px)", opacity: 0.35 },
    { clipPath: "inset(-30% 0% -30% 0)", transform: "none", opacity: 1 },
  ], 880, 720);
  go(app.querySelector(".hero .composer"), rise, 960, 700);
  app.querySelectorAll(".hero-quick > *").forEach((e, i) => go(e, rise, 1050 + i * 45, 560));
  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {});
}
