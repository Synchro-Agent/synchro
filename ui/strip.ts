"use client";
// Dải cuộn ngang (tab, bộ chọn đoạn, hàng thẻ lọc; CSS ở synchro-ds.css): mục đang chọn luôn nằm trọn trong dải, cách mép một khoảng bằng
// vùng mờ dần (28px), không bị mép cắt như thẻ "Crowds" ở Hiệu ứng âm thanh. Chỉ cuộn dải, không cuộn trang (không dùng scrollIntoView).
import { useLayoutEffect, useRef, type RefObject } from "react";

const PAD = 28;
export function revealActive(strip: HTMLElement, smooth = true) {
  const a = strip.querySelector<HTMLElement>(':scope > [aria-selected="true"], :scope > [aria-pressed="true"], :scope > .on');
  if (!a || strip.scrollWidth <= strip.clientWidth + 1) return;
  const r = a.getBoundingClientRect(), b = strip.getBoundingClientRect();
  let dx = 0;
  if (r.left < b.left + PAD) dx = r.left - b.left - PAD;
  else if (r.right > b.right - PAD) dx = r.right - b.right + PAD;
  if (Math.abs(dx) < 1) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  strip.scrollTo({ left: strip.scrollLeft + dx, behavior: smooth && !reduced ? "smooth" : "auto" });
}

/** Gắn vào dải: lần đầu đặt ngay mục đang chọn vào tầm nhìn, đổi mục chọn thì cuộn mượt tới nó. */
export function useStripActive<T extends HTMLElement>(key: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    revealActive(el, !first.current);
    first.current = false;
  }, [key]);
  return ref;
}
