"use client";
// Menu, menu con và bảng nổi luôn nằm trọn trong màn hình. Trước đây menu con "Kho kỹ năng" của menu + (đáy thẳng hàng với menu chính, mở
// lên trên) tràn quá mép trên khi ô soạn tin nằm giữa màn hình (trang chủ, cửa sổ thấp): mất viền, mất góc bo, mục đầu dính sát mép.
// Mỗi khi một khung nổi hiện ra hoặc đổi kích thước (danh sách tải xong thì cao lên), đo lại; tràn mép nào thì dời vào trong bằng thuộc tính
// translate (không đụng transform của animation mở menu). Cao hơn cả màn hình thì giới hạn chiều cao và cho cuộn.
const SEL = ".menu, .model-menu, .model-sub, .usermenu";
const M = 8;

export function fit(el: HTMLElement) {
  if (!el.isConnected || el.classList.contains("out")) return;
  el.style.translate = "";
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const W = innerWidth, H = innerHeight;
  // Không giới hạn khung có menu con nằm ngoài nó (menu con sẽ bị cắt theo).
  if (r.height > H - 2 * M && !el.querySelector(SEL)) { el.style.maxHeight = `${H - 2 * M}px`; el.style.overflowY = "auto"; }
  const b = el.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (b.right > W - M) dx = W - M - b.right;
  if (b.left + dx < M) dx = M - b.left;
  if (b.bottom > H - M) dy = H - M - b.bottom;
  if (b.top + dy < M) dy = M - b.top;
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

/** Gắn một lần cho cả trang (page.tsx). */
export function installFloatFit() {
  const ro = new ResizeObserver((es) => { for (const e of es) { const el = e.target as HTMLElement; if (el.isConnected) fit(el); else ro.unobserve(el); } });
  const watch = (el: Element) => { if (el instanceof HTMLElement) ro.observe(el); };
  const mo = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(SEL)) watch(n);
      n.querySelectorAll(SEL).forEach(watch);
    }
  });
  document.querySelectorAll(SEL).forEach(watch);
  mo.observe(document.body, { childList: true, subtree: true });
  const re = () => document.querySelectorAll<HTMLElement>(SEL).forEach(fit);
  addEventListener("resize", re);
  return () => { mo.disconnect(); ro.disconnect(); removeEventListener("resize", re); };
}
