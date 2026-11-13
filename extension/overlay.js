// Dải "Synchro đang điều khiển tab này" với nút Tạm dừng / Tiếp tục và Dừng, chèn vào trang khi Synchro điều khiển tab (qua chrome.debugger,
// chạy cả trên trang có CSP chặt). Nằm trong shadow root đóng, gắn aria-hidden nên không lẫn vào nội dung model đọc (browser_read / browser_find
// bỏ qua). Viền quanh trang không nhận chuột; nút gọi window.__synchroStop("pause" | "resume" | "stop") (Runtime.addBinding của tiện ích).
// window.__synOverlay: set(nhãn đang làm) · paused(true/false) trạng thái tạm dừng · pause(true/false) ẩn tạm khi chụp màn hình ·
// guard() bỏ qua chuột ngay trước khi Synchro bấm (để cú bấm của Synchro không trúng nút) · remove().
// Synchro thao tác như một người vô hình: không vẽ con trỏ, vòng gợn hay dấu nào ở chỗ bấm / gõ.
// Thiết kế: viên nổi ở mép trên bằng kính màu Carbon (mờ nền trang phía sau), chữ Ivory, đĩa chứa mark Synchro xoay theo nhịp đồng bộ (loader của
// bộ nhận diện), hai dòng: "Synchro đang điều khiển tab này" và việc đang làm (đổi nhẹ khi việc đổi); nút Tạm dừng (viền mảnh) và Dừng (Ivory đặc).
// Cùng một màu trên trang sáng lẫn tối; viền trang hai lớp Carbon + Ivory mảnh, quầng tối bên trong thở chậm. Chữ Be Vietnam Pro của app (tiện ích
// gửi kèm phông dạng dữ liệu, nạp bằng FontFace nên không bị CSP của trang chặn; không nạp được thì dùng phông hệ thống).
// Mọi phần tử dựng bằng DOM (không innerHTML), mark và icon là SVG dựng bằng createElementNS (không tải ảnh) để chạy được cả trên trang bật
// Trusted Types hay CSP chặt (Gmail, ngân hàng…).
import { MARK_SMALL } from "./brand.js";
import { PH } from "./phosphor.js";

export function overlayScript(s, font = "") {
  const T = JSON.stringify({ title: s.barTitle, paused: s.barPaused, pausedHelp: s.pausedHelp, stop: s.barStop, pause: s.barPause, resume: s.barResume, mark: MARK_SMALL,
    ic: { pause: PH.pause, play: PH.play, stop: PH.stop }, font });
  return `(() => {
  if (window.top !== window) return;
  if (window.__synOverlay) { window.__synOverlay.show(); return; }
  const T = ${T};
  // Phông chữ của app (Be Vietnam Pro Medium): nạp từ dữ liệu (không tải URL) một lần cho mỗi trang, tên riêng để không đụng phông của trang.
  if (T.font && !window.__synFont) {
    window.__synFont = 1;
    try { const b = atob(T.font), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); document.fonts.add(new FontFace("Synchro Overlay Sans", u.buffer, { weight: "300 800" })); } catch {}
  }
  const CSS = \`
    :host { all: initial; --carbon: #111210; --ivory: #EEECE5; --glide: cubic-bezier(.65,0,.35,1); --out: cubic-bezier(.22,.8,.24,1);
      --sans: "Synchro Overlay Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(17,18,16,.92), inset 0 0 0 3px rgba(238,236,229,.9); transition: opacity .35s; }
    .glow { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 56px 4px rgba(17,18,16,.17); animation: breathe 4s ease-in-out infinite; transition: opacity .35s; }
    @keyframes breathe { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
    /* Canh giữa bằng margin tự động (không dùng left: 50%, vốn chỉ cho viên rộng tối đa nửa màn hình nên chữ bị cắt trên cửa sổ hẹp). */
    .pill { position: fixed; left: 0; right: 0; top: 12px; margin: 0 auto; width: max-content; display: flex; align-items: center; gap: 10px; height: 46px; box-sizing: border-box;
      max-width: min(720px, calc(100vw - 24px)); padding: 0 6px; border-radius: 23px; color: var(--ivory);
      background: rgba(17,18,16,.92); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
      font: 500 13px/1.25 var(--sans); letter-spacing: -.005em; -webkit-font-smoothing: antialiased;
      box-shadow: inset 0 0 0 1px rgba(238,236,229,.13), inset 0 1px 0 rgba(255,255,255,.07), 0 16px 40px -14px rgba(0,0,0,.55), 0 3px 10px rgba(0,0,0,.2);
      pointer-events: auto; transition: opacity .2s; animation: drop .55s var(--out) both; }
    @keyframes drop { from { opacity: 0; transform: translateY(-12px) scale(.96); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
    .disc { position: relative; flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: rgba(238,236,229,.09);
      box-shadow: inset 0 0 0 1px rgba(238,236,229,.14); }
    .mk { display: block; width: 12px; height: 16px; fill: var(--ivory); overflow: visible; }
    .mk-r { transform-box: fill-box; transform-origin: center; animation: mkSpin 1.6s var(--glide) infinite; }
    .mk-a { animation: mkLa 1.6s infinite; }
    .mk-b { animation: mkLb 1.6s infinite; }
    @keyframes mkSpin { 0% { transform: rotate(0); } 75%, 100% { transform: rotate(180deg); } }
    @keyframes mkLa { 0% { transform: none; animation-timing-function: cubic-bezier(.37,0,.63,1); } 37.5% { transform: translateY(175px); animation-timing-function: cubic-bezier(.37,0,.63,1); } 75%, 100% { transform: none; } }
    @keyframes mkLb { 0% { transform: none; animation-timing-function: cubic-bezier(.37,0,.63,1); } 37.5% { transform: translateY(-175px); animation-timing-function: cubic-bezier(.37,0,.63,1); } 75%, 100% { transform: none; } }
    .txt { display: grid; min-width: 0; padding-right: 2px; }
    .head, .lab { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .head { font-weight: 600; font-size: 13px; line-height: 17px; }
    .lab { font-size: 12px; line-height: 16px; color: rgba(238,236,229,.62); font-weight: 450; }
    .lab:empty { display: none; }
    .lab.swap { animation: swap .38s var(--out); }
    @keyframes swap { from { opacity: 0; transform: translateY(4px); } }
    .sep { flex: none; width: 1px; height: 22px; background: rgba(238,236,229,.14); }
    .acts { display: flex; gap: 6px; flex: none; }
    button { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 14px 0 12px;
      border-radius: 17px; flex: none; color: var(--ivory); font: 600 12.5px/1 var(--sans); background: rgba(238,236,229,.08);
      box-shadow: inset 0 0 0 1px rgba(238,236,229,.18); transition: background-color .16s, color .16s, box-shadow .16s; }
    button:hover { background: rgba(238,236,229,.16); }
    button:focus-visible { outline: 2px solid rgba(238,236,229,.75); outline-offset: 2px; }
    button.solid { background: var(--ivory); color: var(--carbon); box-shadow: none; }
    button.solid:hover { background: #fff; }
    svg.ic { display: block; flex: none; width: 14px; height: 14px; fill: currentColor; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    /* Tạm dừng: mark đứng yên (chữ S), viền và quầng nhạt đi — Synchro không thao tác cho tới khi bấm Tiếp tục. */
    .paused .mk-r, .paused .mk-a, .paused .mk-b, .paused .glow { animation: none; }
    .paused .edge { opacity: .4; }
    .paused .glow { opacity: .25; }
    @media (prefers-reduced-motion: reduce) { .mk-r, .mk-a, .mk-b, .pill, .glow, .lab.swap { animation: none; } }
    @media (max-width: 560px) { .lab, .sep { display: none; } .pill { gap: 8px; } button { width: 34px; padding: 0; } button .t { display: none; } }
    .off .pill, .off .edge, .off .glow { opacity: 0 !important; pointer-events: none; }
    .guard .pill { pointer-events: none; }
  \`;
  const host = document.createElement("synchro-control");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  const root = host.attachShadow({ mode: "closed" });
  try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; } catch { const st = document.createElement("style"); st.textContent = CSS; root.append(st); }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const wrap = el("div"), edge = el("div", "edge"), glow = el("div", "glow"), pill = el("div", "pill");
  // Mark Synchro (Ivory trên nền Carbon), xoay theo nhịp đồng bộ: Synchro đang điều khiển. Icon Phosphor Regular như app.
  const NS = "http://www.w3.org/2000/svg", svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const icon = (n) => { const s = svg("svg", { class: "ic", viewBox: "0 0 256 256" }); for (const [tag, attrs] of T.ic[n] || []) s.append(svg(tag, attrs)); return s; };
  const mark = svg("svg", { class: "mk", viewBox: "-393.75 -525 787.5 1050" }), spin = svg("g", { class: "mk-r" });
  spin.append(svg("path", { class: "mk-a", d: T.mark[0] }), svg("path", { class: "mk-b", d: T.mark[1] }));
  mark.append(spin);
  const disc = el("span", "disc"); disc.append(mark);
  const txt = el("span", "txt"), head = el("span", "head", T.title), lab = el("span", "lab");
  txt.append(head, lab);
  const send = (what) => { try { window.__synchroStop && window.__synchroStop(what); } catch {} };
  const btn = (ic, text, cls) => { const b = el("button", cls); b.type = "button"; const t = el("span", "t", text); b.append(icon(ic), t); b.title = text; return [b, t]; };
  const [pz, pzT] = btn("pause", T.pause);
  pz.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const on = !wrap.classList.contains("paused"); api.paused(on); send(on ? "pause" : "resume"); });
  const [stop] = btn("stop", T.stop, "solid");
  stop.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); send("stop"); });
  const acts = el("span", "acts"); acts.append(pz, stop);
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) pill.addEventListener(ev, (e) => e.stopPropagation());
  pill.append(disc, txt, el("span", "sep"), acts);
  wrap.append(glow, edge, pill);
  root.append(wrap);
  let guardT = 0, gone = false, iv = 0, label = "";
  const mount = () => { if (!gone && !host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  const showLab = (text) => { if (lab.textContent === text) return; lab.textContent = text; lab.classList.remove("swap"); void lab.offsetWidth; if (text) lab.classList.add("swap"); };
  const api = {
    show() { wrap.classList.remove("off"); mount(); },
    set(text) { label = String(text || ""); if (!wrap.classList.contains("paused")) showLab(label); mount(); },
    paused(on) {
      wrap.classList.toggle("paused", !!on);
      head.textContent = on ? T.paused : T.title;
      showLab(on ? T.pausedHelp : label);
      pz.firstChild.replaceWith(icon(on ? "play" : "pause")); pzT.textContent = pz.title = on ? T.resume : T.pause;
      pz.classList.toggle("solid", !!on); stop.classList.toggle("solid", !on);
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
