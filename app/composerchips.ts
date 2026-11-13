// Dải thẻ đính kèm của ô soạn tin (tệp + chip skill đã chọn).
// Trước đây dải chỉ cuộn ngang: thẻ thứ 6 bị cắt, thứ 7 trở đi khuất hẳn mà không có dấu hiệu nào.
// Giờ dải một hàng chỉ hiện tối đa CHIP_LIMIT thẻ rồi một nút "+N"; bấm vào thì trải ra lưới nhiều hàng.
import { useLayoutEffect, useRef, useState } from "react";

export const CHIP_LIMIT = 5;

/**
 * Số thẻ bị ẩn sau nút "+N" khi dải thẻ ở chế độ một hàng.
 * total = số tệp + số chip skill đã chọn (gọi chung là "mục").
 * expanded = true khi đã trải lưới (hiện hết, không còn "+N").
 * Trả về 0 khi vừa đủ chỗ (total ≤ limit) hoặc đã trải lưới.
 */
export function hiddenCards(total: number, expanded = false, limit: number = CHIP_LIMIT): number {
  if (expanded || total <= limit) return 0;
  return total - limit;
}

/** Kích thước cuộn của một khung (đủ để tính mép nào còn nội dung bị khuất). */
export type ScrollBox = { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number };

/**
 * Lớp làm mờ mép theo chỗ thật sự còn nội dung bị khuất: chỉ mờ mép trái khi đã cuộn sang phải, chỉ mờ mép phải khi còn thẻ phía sau.
 * Không tràn thì không mờ gì (thẻ đầu không bị mờ, nút xóa của thẻ cuối không chìm vào mép). axis "y" cho lưới đã trải (mép trên / dưới).
 */
export function edgeFade(b: ScrollBox, axis: "x" | "y" = "x"): string {
  const [pos, view, full, a, z] = axis === "x" ? [b.scrollLeft, b.clientWidth, b.scrollWidth, "fade-l", "fade-r"] : [b.scrollTop, b.clientHeight, b.scrollHeight, "fade-t", "fade-b"];
  return [pos > 1 ? a : "", pos + view < full - 1 ? z : ""].filter(Boolean).join(" ");
}

/** Theo dõi khung cuộn (cuộn, đổi cỡ) và trả lớp làm mờ mép hiện tại. key: đổi khi nội dung đổi (số thẻ, trải lưới) để tính lại. */
export function useEdgeFade<T extends HTMLElement>(axis: "x" | "y", key: string | number) {
  const ref = useRef<T>(null);
  const [cls, setCls] = useState("");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { setCls(""); return; }
    const upd = () => setCls(edgeFade(el, axis));
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(upd);
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", upd); ro?.disconnect(); };
  }, [axis, key]);
  return [ref, cls] as const;
}
