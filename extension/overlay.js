// Dải "Synchro đang điều khiển tab này" + nút Dừng, chèn vào trang khi Synchro điều khiển tab (qua chrome.debugger, chạy cả trên trang có CSP chặt).
// Nằm trong shadow root đóng, gắn aria-hidden nên không lẫn vào nội dung model đọc (browser_read / browser_find bỏ qua).
// Viền sáng quanh trang không nhận chuột; nút Dừng gọi window.__synchroStop (Runtime.addBinding của tiện ích).
// window.__synOverlay: set(nhãn đang làm) · pause(true/false) ẩn tạm khi chụp màn hình · guard() bỏ qua chuột ngay trước khi Synchro bấm
// (để cú bấm của Synchro không trúng nút Dừng) · remove().
export function overlayScript(s) {
  const T = JSON.stringify({ title: s.barTitle, stop: s.barStop });
  return `(() => {
  if (window.top !== window) return;
  if (window.__synOverlay) { window.__synOverlay.show(); return; }
  const T = ${T};
  const CSS = \`
    :host { all: initial; }
    .edge { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(217,119,6,.9), inset 0 0 28px rgba(217,119,6,.35); border-radius: 2px; transition: opacity .2s; }
    .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px));
      padding: 7px 7px 7px 14px; border-radius: 999px; background: rgba(28,25,23,.94); color: #fafaf9; font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.08); pointer-events: auto; transition: opacity .2s; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; flex: none; animation: p 1.4s ease-in-out infinite; }
    @keyframes p { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.6); } 50% { box-shadow: 0 0 0 5px rgba(245,158,11,0); } }
    .txt { display: flex; flex-direction: column; min-width: 0; }
    .lab { color: #d6d3d1; font-weight: 400; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lab:empty { display: none; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #fafaf9; color: #1c1917; font: 600 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; flex: none; }
    button:hover { background: #fde68a; }
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
  const dot = document.createElement("span"); dot.className = "dot";
  const txt = document.createElement("span"); txt.className = "txt";
  const title = document.createElement("span"); title.textContent = T.title;
  const lab = document.createElement("span"); lab.className = "lab";
  txt.append(title, lab);
  const btn = document.createElement("button"); btn.type = "button";
  const sq = document.createElement("i"); btn.append(sq, document.createTextNode(T.stop));
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { window.__synchroStop && window.__synchroStop("stop"); } catch {} });
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) pill.addEventListener(ev, (e) => e.stopPropagation());
  pill.append(dot, txt, btn);
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
