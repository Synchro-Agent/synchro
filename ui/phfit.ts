"use client";
// Chữ gợi ý (placeholder) dài hơn ô nhập bị cắt cụt, không có dấu … ("Viết tin nhắn… gõ @ để chọn tệp, hàm hoặc tài" ở ô soạn tin của
// Code trên điện thoại, ô dán link repo trong hộp Cài đặt chỉ còn 153px). Chọn bản dài nhất còn vừa ô: đo bằng canvas theo đúng phông của ô
// và theo ngôn ngữ đang dùng (lớp dịch đổi chữ sau đó), ô đổi kích thước hoặc phông tải xong thì chọn lại. Bản cuối là bản ngắn nhất.
import { useEffect, useState, type RefObject } from "react";
import { getLang, tr } from "../app/i18n";

let cv: CanvasRenderingContext2D | null = null;

export function useFitPlaceholder(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>, options: string[]) {
  const [i, setI] = useState(0);
  const key = options.join("\n"), lang = getLang();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const list = key.split("\n");
    const pick = () => {
      if (!el.isConnected || !el.clientWidth) return;
      cv ??= document.createElement("canvas").getContext("2d");
      if (!cv) return;
      const cs = getComputedStyle(el);
      cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      const n = list.findIndex((o) => cv!.measureText(tr(o)).width <= avail);
      setI(n < 0 ? list.length - 1 : n);
    };
    pick();
    const ro = new ResizeObserver(pick);
    ro.observe(el);
    document.fonts?.ready.then(pick).catch(() => {});
    return () => ro.disconnect();
  }, [ref, key, lang]);
  return options[Math.min(i, options.length - 1)];
}
