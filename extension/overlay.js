// Dải "Synchro đang điều khiển tab này" + nút Dừng, chèn vào trang khi Synchro điều khiển tab (qua chrome.debugger, chạy cả trên trang có CSP chặt).
// Nằm trong shadow root đóng, gắn aria-hidden nên không lẫn vào nội dung model đọc (browser_read / browser_find bỏ qua).
// Viền sáng quanh trang không nhận chuột; nút Dừng gọi window.__synchroStop (Runtime.addBinding của tiện ích).
// window.__synOverlay: set(nhãn đang làm) · pause(true/false) ẩn tạm khi chụp màn hình · guard() bỏ qua chuột ngay trước khi Synchro bấm
// (để cú bấm của Synchro không trúng nút Dừng) · remove().
// Dải có logo Synchro và theo giao diện sáng / tối của trình duyệt. Mọi phần tử dựng bằng DOM (không innerHTML, không ảnh data:) để chạy được
// cả trên trang bật Trusted Types hay CSP chặt (Gmail, ngân hàng…).
const SHAPE = "M99.9 17.3 63.4 29.8 60.7 30.0 58.8 29.1 58.2 28.5 57.1 26.7 56.0 22.1 54.9 12.6 54.5 11.2 54.2 10.9 53.4 10.9 52.7 11.4 51.5 12.9 48.4 17.6 38.1 31.8 36.8 33.3 35.6 34.0 34.1 34.3 32.6 34.2 22.8 32.2 10.4 30.3 7.9 29.7 6.4 29.7 6.1 30.0 6.1 30.7 19.8 50.2 21.0 49.9 32.4 45.0 40.8 41.7 43.2 41.4 44.2 42.2 44.2 43.5 43.8 44.6 42.6 46.2 39.4 49.3 35.6 52.3 32.1 54.5 3.6 71.5 0.0 73.9 1.8 73.6 20.7 67.2 23.4 67.0 24.1 67.3 25.0 68.2 25.7 70.3 28.4 87.7 29.2 88.8 29.8 88.9 30.2 88.8 31.2 87.7 37.8 78.9 45.4 68.1 47.3 66.4 48.4 66.1 50.0 66.1 53.1 66.9 74.3 70.5 76.5 70.3 76.6 69.3 75.1 66.7 63.2 50.1 53.7 54.1 50.7 55.1 46.9 56.9 42.4 58.6 40.9 58.9 39.4 58.6 38.8 57.7 39.0 56.5 40.3 54.1 42.4 51.7 47.8 47.7 54.3 44.0 69.2 34.9Z";
const SPARK = "M97.5 11.6 L98.6 16.5 L103.5 17.6 L98.6 18.7 L97.5 23.6 L96.4 18.7 L91.5 17.6 L96.4 16.5Z";
export function overlayScript(s) {
  const T = JSON.stringify({ title: s.barTitle, stop: s.barStop, shape: SHAPE, spark: SPARK });
  return `(() => {
  if (window.top !== window) return;
  if (window.__synOverlay) { window.__synOverlay.show(); return; }
  const T = ${T};
  const CSS = \`
    :host { all: initial; }
    :host { --s0: #62BEFF; --s1: #3D8EFF; --s2: #2C55FF; --s3: #3A2BE0; --s4: #5A1FC8; --spark: #2C55FF; --spark-line: #fff;
      --pill: rgba(255,255,255,.97); --ink: #141413; --ink2: #545452; --line: rgba(20,20,19,.1); --btn: #141413; --btn-fg: #faf9f5; --btn-hover: #2f2f2d; }
    @media (prefers-color-scheme: dark) {
      :host { --s0: #C8F2FF; --s1: #80BBFF; --s2: #5F82FF; --s3: #7D6CFF; --s4: #A57CFF; --spark: #fff; --spark-line: #9DB8FF;
        --pill: rgba(27,27,27,.96); --ink: #faf9f5; --ink2: #b0aea5; --line: rgba(255,255,255,.1); --btn: #faf9f5; --btn-fg: #141413; --btn-hover: #e8e6dc; }
    }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(217,119,87,.92), inset 0 0 30px rgba(217,119,87,.32); transition: opacity .2s; }
    .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: min(580px, calc(100vw - 32px));
      padding: 6px 6px 6px 10px; border-radius: 999px; background: var(--pill); color: var(--ink); font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.22), 0 0 0 1px var(--line); pointer-events: auto; transition: opacity .2s; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
    .mark { position: relative; width: 22px; height: 22px; flex: none; display: block; }
    .mark svg { width: 22px; height: 22px; display: block; overflow: visible; }
    .dot { position: absolute; right: -2px; bottom: -1px; width: 8px; height: 8px; border-radius: 50%; background: #d97757; box-shadow: 0 0 0 2px var(--pill); animation: p 1.4s ease-in-out infinite; }
    @keyframes p { 0%,100% { box-shadow: 0 0 0 2px var(--pill), 0 0 0 2px rgba(217,119,87,.55); } 50% { box-shadow: 0 0 0 2px var(--pill), 0 0 0 6px rgba(217,119,87,0); } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .txt { display: flex; flex-direction: column; min-width: 0; }
    .lab { color: var(--ink2); font-weight: 400; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lab:empty { display: none; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: var(--btn); color: var(--btn-fg); font: 600 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; flex: none; }
    button:hover { background: var(--btn-hover); }
    button:focus-visible { outline: 2px solid #d97757; outline-offset: 2px; }
    button i { width: 9px; height: 9px; border-radius: 2px; background: currentColor; display: block; }
    .off .pill, .off .edge { opacity: 0; pointer-events: none; }
    .guard .pill { pointer-events: none; }
  \`;
  const host = document.createElement("synchro-control");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  const root = host.attachShadow({ mode: "closed" });
  try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; } catch { const st = document.createElement("style"); st.textContent = CSS; root.append(st); }
  const wrap = document.createElement("div");
  const edge = document.createElement("div"); edge.className = "edge";
  const pill = document.createElement("div"); pill.className = "pill";
  // Logo Synchro (màu theo theme qua biến CSS) kèm chấm cam nhấp nháy: Synchro đang điều khiển.
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const mark = document.createElement("span"); mark.className = "mark";
  const logo = svg("svg", { viewBox: "-2 -4 108 108", "aria-hidden": "true" });
  const grad = svg("linearGradient", { id: "syn-g", x1: "0.08", y1: "0.12", x2: "0.92", y2: "0.9" });
  [0, 0.22, 0.52, 0.8, 1].forEach((o, i) => { const st = svg("stop", { offset: String(o) }); st.style.stopColor = "var(--s" + i + ")"; grad.append(st); });
  const defs = svg("defs", {}); defs.append(grad);
  logo.append(defs, svg("path", { d: T.shape, fill: "none", stroke: "url(#syn-g)", "stroke-width": "3", "stroke-linejoin": "round" }), svg("path", { d: T.shape, fill: "url(#syn-g)" }));
  const sp = svg("path", { d: T.spark, transform: "translate(97.5 17.6) scale(1.3) translate(-97.5 -17.6)", "stroke-width": "1.2", "stroke-linejoin": "round", "paint-order": "stroke" });
  sp.style.fill = "var(--spark)"; sp.style.stroke = "var(--spark-line)";
  logo.append(sp);
  const dot = document.createElement("span"); dot.className = "dot";
  mark.append(logo, dot);
  const txt = document.createElement("span"); txt.className = "txt";
  const title = document.createElement("span"); title.textContent = T.title;
  const lab = document.createElement("span"); lab.className = "lab";
  txt.append(title, lab);
  const btn = document.createElement("button"); btn.type = "button";
  const sq = document.createElement("i"); btn.append(sq, document.createTextNode(T.stop));
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { window.__synchroStop && window.__synchroStop("stop"); } catch {} });
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) pill.addEventListener(ev, (e) => e.stopPropagation());
  pill.append(mark, txt, btn);
  wrap.append(edge, pill);
  root.append(wrap);
  let guardT = 0, gone = false, iv = 0;
  const mount = () => { if (!gone && !host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  const api = {
    show() { wrap.classList.remove("off"); mount(); },
    set(label) { lab.textContent = String(label || ""); mount(); },
    pause(on) { wrap.classList.toggle("off", !!on); },
    guard() { wrap.classList.add("guard"); clearTimeout(guardT); guardT = setTimeout(() => wrap.classList.remove("guard"), 800); },
    remove() { gone = true; clearInterval(iv); host.remove(); delete window.__synOverlay; },
  };
  window.__synOverlay = api;
  if (document.documentElement) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
  // Trang thay cả <html> / xóa phần tử lạ: gắn lại.
  iv = setInterval(mount, 1500);
})()`;
}
