// Dải "Synchro đang điều khiển tab này" với nút Tạm dừng / Tiếp tục và Dừng, chèn vào trang khi Synchro điều khiển tab (qua chrome.debugger,
// chạy cả trên trang có CSP chặt). Nằm trong shadow root đóng, gắn aria-hidden nên không lẫn vào nội dung model đọc (browser_read / browser_find
// bỏ qua). Viền quanh trang không nhận chuột; nút gọi window.__synchroStop("pause" | "resume" | "stop") (Runtime.addBinding của tiện ích).
// window.__synOverlay: set(nhãn đang làm) · paused(true/false) trạng thái tạm dừng · pause(true/false) ẩn tạm khi chụp màn hình ·
// guard() bỏ qua chuột ngay trước khi Synchro bấm (để cú bấm của Synchro không trúng nút) · remove().
// Thiết kế như dải "Synchro is using your phone" trong phim giới thiệu: viên bo tròn màu Carbon ở mép trên, chữ Ivory, mark Synchro xoay theo
// nhịp đồng bộ (loader của bộ nhận diện) — cùng một màu trên trang sáng lẫn tối; viền trang hai lớp Carbon 3px + Ivory 1,5px như trong phim.
// Mọi phần tử dựng bằng DOM (không innerHTML), mark là SVG dựng bằng createElementNS từ hình học trong brand.js (không tải ảnh) để chạy được
// cả trên trang bật Trusted Types hay CSP chặt (Gmail, ngân hàng…).
import { MARK_SMALL } from "./brand.js";

export function overlayScript(s) {
  const T = JSON.stringify({ title: s.barTitle, paused: s.barPaused, stop: s.barStop, pause: s.barPause, resume: s.barResume, mark: MARK_SMALL });
  return `(() => {
  if (window.top !== window) return;
  if (window.__synOverlay) { window.__synOverlay.show(); return; }
  const T = ${T};
  const CSS = \`
    :host { all: initial; --carbon: #111210; --ivory: #EEECE5; --glide: cubic-bezier(.65,0,.35,1); --out: cubic-bezier(.33,1,.68,1); }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 3px var(--carbon), inset 0 0 0 4.5px var(--ivory), inset 0 0 40px rgba(17,18,16,.14); transition: opacity .3s; }
    .pill { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; height: 38px; box-sizing: border-box;
      max-width: min(680px, calc(100vw - 24px)); padding: 0 5px 0 14px; border-radius: 19px; background: var(--carbon); color: var(--ivory);
      font: 500 13.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: -.005em; -webkit-font-smoothing: antialiased;
      box-shadow: 0 10px 30px -8px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.18), 0 0 0 .5px rgba(238,236,229,.14); pointer-events: auto;
      transition: opacity .2s; animation: drop .45s var(--out) both; }
    @keyframes drop { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .mk { flex: none; display: block; width: 12px; height: 16px; fill: var(--ivory); overflow: visible; }
    .mk-r { transform-box: fill-box; transform-origin: center; animation: mkSpin 1.6s var(--glide) infinite; }
    .mk-a { animation: mkLa 1.6s infinite; }
    .mk-b { animation: mkLb 1.6s infinite; }
    @keyframes mkSpin { 0% { transform: rotate(0); } 75%, 100% { transform: rotate(180deg); } }
    @keyframes mkLa { 0% { transform: none; animation-timing-function: cubic-bezier(.37,0,.63,1); } 37.5% { transform: translateY(175px); animation-timing-function: cubic-bezier(.37,0,.63,1); } 75%, 100% { transform: none; } }
    @keyframes mkLb { 0% { transform: none; animation-timing-function: cubic-bezier(.37,0,.63,1); } 37.5% { transform: translateY(-175px); animation-timing-function: cubic-bezier(.37,0,.63,1); } 75%, 100% { transform: none; } }
    .txt { display: flex; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; }
    .head { flex: none; }
    .lab { color: rgba(238,236,229,.55); font-weight: 450; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .lab::before { content: "·"; margin-right: 6px; }
    .lab:empty { display: none; }
    .acts { display: flex; gap: 4px; margin-left: 6px; flex: none; }
    button { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 14px; flex: none;
      color: var(--ivory); font: 500 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: rgba(238,236,229,.12);
      box-shadow: inset 0 0 0 .5px rgba(238,236,229,.28); transition: background .15s, color .15s; }
    button:hover { background: rgba(238,236,229,.2); }
    button:focus-visible { outline: 2px solid rgba(238,236,229,.7); outline-offset: 2px; }
    button.go { background: var(--ivory); color: var(--carbon); box-shadow: none; }
    button.go:hover { background: #fff; }
    i { display: block; flex: none; }
    i.sq { width: 8px; height: 8px; border-radius: 2px; background: currentColor; }
    i.bars { width: 8px; height: 9px; box-sizing: border-box; border-left: 2.6px solid currentColor; border-right: 2.6px solid currentColor; }
    i.play { width: 0; height: 0; border-left: 8px solid currentColor; border-top: 5px solid transparent; border-bottom: 5px solid transparent; margin-left: 1px; }
    /* Tạm dừng: mark đứng yên (chữ S), viền trang nhạt đi — Synchro không thao tác cho tới khi bấm Tiếp tục. */
    .paused .mk-r, .paused .mk-a, .paused .mk-b { animation: none; }
    .paused .edge { opacity: .35; }
    .paused .lab { display: none; }
    @media (prefers-reduced-motion: reduce) { .mk-r, .mk-a, .mk-b, .pill { animation: none; } }
    @media (max-width: 520px) { .lab { display: none; } .pill { padding-left: 12px; } button { padding: 0 9px; } }
    .off .pill, .off .edge { opacity: 0; pointer-events: none; }
    .guard .pill { pointer-events: none; }
  \`;
  const host = document.createElement("synchro-control");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  const root = host.attachShadow({ mode: "closed" });
  try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; } catch { const st = document.createElement("style"); st.textContent = CSS; root.append(st); }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const wrap = el("div"), edge = el("div", "edge"), pill = el("div", "pill");
  // Mark Synchro (Ivory trên nền Carbon), xoay theo nhịp đồng bộ: Synchro đang điều khiển.
  const NS = "http://www.w3.org/2000/svg", svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const mark = svg("svg", { class: "mk", viewBox: "-393.75 -525 787.5 1050" }), spin = svg("g", { class: "mk-r" });
  spin.append(svg("path", { class: "mk-a", d: T.mark[0] }), svg("path", { class: "mk-b", d: T.mark[1] }));
  mark.append(spin);
  const txt = el("span", "txt"), head = el("span", "head", T.title), lab = el("span", "lab");
  txt.append(head, lab);
  const send = (what) => { try { window.__synchroStop && window.__synchroStop(what); } catch {} };
  const pz = el("button"), pzI = el("i", "bars"), pzT = document.createTextNode(T.pause);
  pz.type = "button"; pz.append(pzI, pzT);
  pz.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const on = !wrap.classList.contains("paused"); api.paused(on); send(on ? "pause" : "resume"); });
  const stop = el("button"); stop.type = "button"; stop.append(el("i", "sq"), document.createTextNode(T.stop));
  stop.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); send("stop"); });
  const acts = el("span", "acts"); acts.append(pz, stop);
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) pill.addEventListener(ev, (e) => e.stopPropagation());
  pill.append(mark, txt, acts);
  wrap.append(edge, pill);
  root.append(wrap);
  let guardT = 0, gone = false, iv = 0;
  const mount = () => { if (!gone && !host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  const api = {
    show() { wrap.classList.remove("off"); mount(); },
    set(label) { lab.textContent = String(label || ""); mount(); },
    paused(on) {
      wrap.classList.toggle("paused", !!on);
      head.textContent = on ? T.paused : T.title;
      pzI.className = on ? "play" : "bars"; pzT.textContent = on ? T.resume : T.pause; pz.classList.toggle("go", !!on);
    },
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
