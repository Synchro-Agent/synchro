// Dải "Synchro đang điều khiển tab này" + nút Dừng, chèn vào trang khi Synchro điều khiển tab (qua chrome.debugger, chạy cả trên trang có CSP chặt).
// Nằm trong shadow root đóng, gắn aria-hidden nên không lẫn vào nội dung model đọc (browser_read / browser_find bỏ qua).
// Viền sáng quanh trang không nhận chuột; nút Dừng gọi window.__synchroStop (Runtime.addBinding của tiện ích).
// window.__synOverlay: set(nhãn đang làm) · pause(true/false) ẩn tạm khi chụp màn hình · guard() bỏ qua chuột ngay trước khi Synchro bấm
// (để cú bấm của Synchro không trúng nút Dừng) · remove().
// Dải có logo Synchro và theo giao diện sáng / tối của trình duyệt. Mọi phần tử dựng bằng DOM (không innerHTML), logo vẽ bằng canvas từ
// dữ liệu độ phủ trong logo-mask.js (không tải ảnh) để chạy được cả trên trang bật Trusted Types hay CSP chặt (Gmail, ngân hàng…).
import { LOGO } from "./logo-mask.js";

export function overlayScript(s) {
  const T = JSON.stringify({ title: s.barTitle, stop: s.barStop, logo: LOGO });
  return `(() => {
  if (window.top !== window) return;
  if (window.__synOverlay) { window.__synOverlay.show(); return; }
  const T = ${T};
  const CSS = \`
    :host { all: initial; }
    :host { --pill: rgba(255,255,255,.97); --ink: #141413; --ink2: #545452; --line: rgba(20,20,19,.1); --btn: #141413; --btn-fg: #faf9f5; --btn-hover: #2f2f2d; }
    @media (prefers-color-scheme: dark) {
      :host { --pill: rgba(27,27,27,.96); --ink: #faf9f5; --ink2: #b0aea5; --line: rgba(255,255,255,.1); --btn: #faf9f5; --btn-fg: #141413; --btn-hover: #e8e6dc; }
    }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(217,119,87,.92), inset 0 0 30px rgba(217,119,87,.32); transition: opacity .2s; }
    .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: min(580px, calc(100vw - 32px));
      padding: 6px 6px 6px 10px; border-radius: 999px; background: var(--pill); color: var(--ink); font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.22), 0 0 0 1px var(--line); pointer-events: auto; transition: opacity .2s; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
    .mark { position: relative; flex: none; display: block; padding: 0 4px 0 2px; }
    .mark canvas { width: 32px; height: 18px; display: block; }
    .dot { position: absolute; right: -1px; bottom: -3px; width: 8px; height: 8px; border-radius: 50%; background: #d97757; box-shadow: 0 0 0 2px var(--pill); animation: p 1.4s ease-in-out infinite; }
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
  // Logo Synchro (mực đen ở giao diện sáng, mực sáng ở giao diện tối như trong app) kèm chấm cam nhấp nháy: Synchro đang điều khiển.
  const mark = document.createElement("span"); mark.className = "mark";
  const cv = document.createElement("canvas"); cv.width = T.logo.w; cv.height = T.logo.h;
  const cover = atob(T.logo.a), mq = matchMedia("(prefers-color-scheme: dark)");
  const paint = () => {
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(T.logo.w, T.logo.h), ink = mq.matches ? [245, 244, 239] : [20, 20, 19];
    for (let i = 0; i < cover.length; i++) { img.data[i * 4] = ink[0]; img.data[i * 4 + 1] = ink[1]; img.data[i * 4 + 2] = ink[2]; img.data[i * 4 + 3] = cover.charCodeAt(i); }
    ctx.putImageData(img, 0, 0);
  };
  paint();
  mq.addEventListener("change", paint);
  const dot = document.createElement("span"); dot.className = "dot";
  mark.append(cv, dot);
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
