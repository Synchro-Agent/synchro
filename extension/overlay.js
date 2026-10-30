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
    :host { --pill: rgba(238,236,229,.9); --ink: #111210; --ink2: #64655E; --line: rgba(17,18,16,.12); --sep: rgba(17,18,16,.1);
      --g-top: rgba(70,71,66,.94); --g-mid: rgba(17,18,16,.97); --g-bot: #000; --g-fg: #EEECE5; --g-hi: rgba(255,255,255,.5); --g-rim: rgba(255,255,255,.14); --g-sheen: rgba(255,255,255,.2); --g-hover: brightness(1.2); }
    @media (prefers-color-scheme: dark) {
      :host { --pill: rgba(17,18,16,.86); --ink: #EEECE5; --ink2: #8F9088; --line: rgba(238,236,229,.12); --sep: rgba(238,236,229,.1);
        --g-top: #fff; --g-mid: rgba(238,236,229,.97); --g-bot: rgba(217,214,204,.97); --g-fg: #111210; --g-hi: #fff; --g-rim: rgba(0,0,0,.16); --g-sheen: rgba(255,255,255,.7); --g-hover: brightness(.93); }
    }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(217,119,87,.9), inset 0 0 34px rgba(217,119,87,.28); transition: opacity .2s; }
    .pill { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; max-width: min(600px, calc(100vw - 32px));
      padding: 7px 7px 7px 14px; border-radius: 999px; background: var(--pill); color: var(--ink); font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased; box-shadow: 0 14px 36px -10px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.08), 0 0 0 .5px var(--line), inset 0 1px 0 rgba(255,255,255,.08);
      pointer-events: auto; transition: opacity .2s; -webkit-backdrop-filter: blur(20px) saturate(1.7); backdrop-filter: blur(20px) saturate(1.7); }
    .mark { flex: none; display: block; }
    .mark canvas { width: 14.5px; height: 19px; display: block; }
    .sep { flex: none; width: 1px; height: 22px; background: var(--sep); }
    .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .head { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
    .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #d97757; animation: p 1.4s ease-out infinite; }
    @keyframes p { 0% { box-shadow: 0 0 0 0 rgba(217,119,87,.55); } 100% { box-shadow: 0 0 0 6px rgba(217,119,87,0); } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .lab { color: var(--ink2); font-weight: 450; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 14px; }
    .lab:empty { display: none; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 14px; border-radius: 999px; flex: none;
      color: var(--g-fg); font: 600 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(180deg, var(--g-top), var(--g-mid) 52%, var(--g-bot));
      box-shadow: 0 4px 12px -4px rgba(0,0,0,.35), inset 0 1px .5px var(--g-hi), inset 0 0 0 .75px var(--g-rim), inset 0 10px 10px -8px var(--g-sheen); transition: filter .15s; }
    button:hover { filter: var(--g-hover); }
    button:focus-visible { outline: 2px solid #d97757; outline-offset: 2px; }
    button i { width: 8px; height: 8px; border-radius: 2px; background: currentColor; display: block; }
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
  // Logo Synchro (mực đen ở giao diện sáng, mực sáng ở giao diện tối như trong app); chấm cam nhấp nháy cạnh tiêu đề: Synchro đang điều khiển.
  const mark = document.createElement("span"); mark.className = "mark";
  const cv = document.createElement("canvas"); cv.width = T.logo.w; cv.height = T.logo.h;
  const cover = atob(T.logo.a), mq = matchMedia("(prefers-color-scheme: dark)");
  const paint = () => {
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(T.logo.w, T.logo.h), ink = mq.matches ? [238, 236, 229] : [17, 18, 16];
    for (let i = 0; i < cover.length; i++) { img.data[i * 4] = ink[0]; img.data[i * 4 + 1] = ink[1]; img.data[i * 4 + 2] = ink[2]; img.data[i * 4 + 3] = cover.charCodeAt(i); }
    ctx.putImageData(img, 0, 0);
  };
  paint();
  mq.addEventListener("change", paint);
  mark.append(cv);
  const sep = document.createElement("span"); sep.className = "sep";
  const txt = document.createElement("span"); txt.className = "txt";
  const head = document.createElement("span"); head.className = "head";
  const dot = document.createElement("span"); dot.className = "dot";
  const title = document.createElement("span"); title.textContent = T.title;
  head.append(dot, title);
  const lab = document.createElement("span"); lab.className = "lab";
  txt.append(head, lab);
  const btn = document.createElement("button"); btn.type = "button";
  const sq = document.createElement("i"); btn.append(sq, document.createTextNode(T.stop));
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { window.__synchroStop && window.__synchroStop("stop"); } catch {} });
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) pill.addEventListener(ev, (e) => e.stopPropagation());
  pill.append(mark, sep, txt, btn);
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
