"use client";
// Bấm chuột ra ngoài phần tử (ref) thì gọi close: menu micro, chọn model ở ô soạn tin, menu dự án ở thanh bên.
import { useEffect, useRef } from "react";

export function useClickAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}
