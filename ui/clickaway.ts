"use client";
// Bấm chuột ra ngoài phần tử (ref) thì gọi close: menu micro, chọn model ở ô soạn tin, menu dự án ở thanh bên.
// Khung nổi gắn vào <body> (danh sách của Dropdown, bảng màu ColorField, chọn giờ TimePick) nằm ngoài DOM của popover mở ra nó nhưng vẫn là
// một phần của popover: cú bấm vào đó không được tính là "bấm ra ngoài" (trước đây bấm mục "12 tin gần nhất" trong danh sách Gửi của bàn
// trộn ngữ cảnh đóng cả bàn trộn trước khi cú bấm tới mục, giá trị không đổi). Mọi khung nổi như vậy mang thuộc tính FLOATING.
import { useEffect, useRef } from "react";

export const FLOATING = "data-floating";
/** Phần tử bị bấm nằm trong một khung nổi gắn vào <body> (danh sách chọn, bảng màu, chọn giờ). */
export const inFloating = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(`[${FLOATING}]`);
/** Cú bấm nằm ngoài el và ngoài mọi khung nổi: popover chứa el nên đóng. el chưa gắn (null) cũng tính là ngoài. */
export const isAway = (el: Element | null | undefined, t: EventTarget | null) => !el?.contains(t as Node) && !inFloating(t);

export function useClickAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && isAway(ref.current, e.target) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}
