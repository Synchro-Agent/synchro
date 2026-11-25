"use client";
// Menu, menu con và bảng nổi luôn nằm trọn trong màn hình. Trước đây menu con "Kho kỹ năng" của menu + (đáy thẳng hàng với menu chính, mở
// lên trên) tràn quá mép trên khi ô soạn tin nằm giữa màn hình (trang chủ, cửa sổ thấp): mất viền, mất góc bo, mục đầu dính sát mép.
// Mỗi khi một khung nổi hiện ra hoặc đổi kích thước (danh sách tải xong thì cao lên), đo lại; tràn mép nào thì dời vào trong bằng thuộc tính
// translate (không đụng transform của animation mở menu). Cao hơn cả màn hình thì giới hạn chiều cao và cho cuộn.
import { watch as domWatch } from "./domwatch";

const SEL = ".menu, .model-menu, .model-sub, .usermenu";
const M = 8;

export function fit(el: HTMLElement) {
  if (!el.isConnected || el.classList.contains("out")) return;
  el.style.translate = "";
  // Cửa sổ cao trở lại: bỏ giới hạn đã đặt ở lần đo trước.
  if (el.classList.contains("fl-flat")) { el.classList.remove("fl-flat"); el.style.maxHeight = ""; el.style.overflowY = ""; }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const W = innerWidth, H = innerHeight;
  // Không giới hạn khung có menu con nằm ngoài nó (menu con sẽ bị cắt theo).
  // Khung có phần cuộn bên trong thì chỉ cần giới hạn chiều cao; khung còn lại tự cuộn nên bỏ lớp kính (fl-flat), không thì nền và viền trôi theo nội dung.
  if (r.height > H - 2 * M && !el.querySelector(SEL)) {
    el.style.maxHeight = `${H - 2 * M}px`;
    if (!el.querySelector(":scope > .menu-scroll")) { el.style.overflowY = "auto"; el.classList.add("fl-flat"); }
  }
  const b = el.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (b.right > W - M) dx = W - M - b.right;
  if (b.left + dx < M) dx = M - b.left;
  if (b.bottom > H - M) dy = H - M - b.bottom;
  if (b.top + dy < M) dy = M - b.top;
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  // Khung vừa mở còn chạy hiệu ứng (thu nhỏ, trượt xuống 6px): số đo lúc này lệch vài px so với lúc đứng yên,
  // tấm phủ đáy của điện thoại từng bị đẩy lên 4px mãi. Đo lại khi hiệu ứng xong.
  const opening = el.getAnimations?.().filter((a) => a.playState === "running"
    && a.effect?.getTiming().iterations !== Infinity) ?? [];
  for (const a of opening) {
    a.finished.then(() => fit(el), () => {
      // Hiệu ứng bị hủy (khung đóng giữa chừng hoặc đổi hiệu ứng): lần đo của ResizeObserver hay lần mở sau
      // lo việc này.
    });
  }
}

/** Gắn một lần cho cả trang (page.tsx). */
export function installFloatFit() {
  const ro = new ResizeObserver((es) => { for (const e of es) { const el = e.target as HTMLElement; if (el.isConnected) fit(el); else ro.unobserve(el); } });
  const watch = (el: Element) => { if (el instanceof HTMLElement) ro.observe(el); };
  // Bộ theo dõi <body> dùng chung (domwatch.ts), chạy ngay (trước khi vẽ) để menu không hiện một khung hình tràn mép.
  const unwatch = domWatch((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(SEL)) watch(n);
      n.querySelectorAll(SEL).forEach(watch);
    }
  }, { types: ["childList"] });
  document.querySelectorAll(SEL).forEach(watch);
  const re = () => document.querySelectorAll<HTMLElement>(SEL).forEach(fit);
  addEventListener("resize", re);
  return () => { unwatch(); ro.disconnect(); removeEventListener("resize", re); };
}
