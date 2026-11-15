// Dải thẻ đính kèm của ô soạn tin (tệp + chip skill đã chọn).
// Trước đây dải chỉ cuộn ngang: thẻ thứ 6 bị cắt, thứ 7 trở đi khuất hẳn mà không có dấu hiệu nào.
// Giờ dải một hàng chỉ hiện tối đa CHIP_LIMIT thẻ rồi một nút "+N"; bấm vào thì trải ra lưới nhiều hàng.
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

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

/** Theo dõi khung cuộn (cuộn, đổi cỡ) và trả lớp làm mờ mép hiện tại. key: đổi khi nội dung đổi (số thẻ, trải lưới) để tính lại.
 *  given: dùng ref có sẵn (khi một hook khác cũng đo cùng khung). */
export function useEdgeFade<T extends HTMLElement>(axis: "x" | "y", key: string | number, given?: RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = given ?? own;
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
  }, [axis, key, ref]);
  return [ref, cls] as const;
}

/**
 * Số thẻ đầu tiên hiện trọn được trên dải một hàng, chừa chỗ cho nút "+N" ở cuối dải (U2: không thẻ nào bị mép dải cắt ngang).
 * avail = bề rộng trong của dải, widths = bề rộng từng thẻ theo thứ tự, gap = khe giữa các phần tử, moreW = bề rộng nút "+N", max = trần (CHIP_LIMIT).
 */
export function fitCount(avail: number, widths: number[], gap: number, moreW: number, max: number = CHIP_LIMIT): number {
  let used = moreW, k = 0;
  for (let i = 0; i < Math.min(widths.length, max); i++) {
    if (used + widths[i] + gap > avail + 0.5) break;
    used += widths[i] + gap;
    k++;
  }
  return k;
}

/**
 * Dải một hàng có "+N": đo bề rộng thật của dải, của từng thẻ đang dựng và của nút "+N", trả số thẻ hiện trọn được (tối đa CHIP_LIMIT).
 * Thẻ chưa dựng (đang gộp vào "+N") lấy bề rộng đã đo lần trước, chưa đo thì bằng thẻ rộng nhất đang thấy. Đổi cỡ màn hình thì tính lại.
 * keys = khóa từng thẻ theo thứ tự; active = false khi không cần (≤ CHIP_LIMIT thẻ, hoặc đã trải lưới) thì giữ CHIP_LIMIT.
 */
export function useFitCount<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean, keys: string[]) {
  const [fit, setFit] = useState(CHIP_LIMIT);
  const seen = useRef(new Map<string, number>());
  // Bề rộng lớn nhất của "+N" đã đo với bộ thẻ này. "+N" đổi bề rộng theo N ("+10" 45px, "+11" 44px): lấy số đo hiện tại thì hai trạng thái có thể
  // đẩy nhau mãi (2 thẻ + "+10" không vừa → 1 thẻ + "+11" vừa → lại 2 thẻ…, React báo "Maximum update depth" và cả ô soạn sập). Lấy số lớn nhất.
  const moreMax = useRef({ sig: "", w: 0 });
  const sig = keys.join("\u0001");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) { setFit(CHIP_LIMIT); return; }
    // Thẻ đổi bề rộng sau khi dựng (đang tải → xong) cũng phải tính lại: theo dõi cả từng thẻ, không chỉ khung.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => calc());
    const calc = () => {
      const cs = getComputedStyle(el), gap = parseFloat(cs.columnGap) || 0;
      const avail = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const kids = [...el.children].filter((k) => k.matches(".ft,.pick-chip")) as HTMLElement[];
      kids.forEach((k) => ro?.observe(k));
      // Bề rộng bố cục (offsetWidth), không theo getBoundingClientRect: thẻ mới thêm đang chạy hiệu ứng thu phóng nên hộp nhìn thấy hẹp hơn chỗ nó chiếm.
      kids.forEach((k, i) => { const w = k.offsetWidth; if (w > 0 && keys[i]) seen.current.set(keys[i], w); });
      const typical = Math.max(0, ...kids.map((k) => k.offsetWidth)) || 120;
      const widths = keys.map((k) => seen.current.get(k) ?? typical);
      const more = el.querySelector<HTMLElement>(":scope>.attach-more");
      // Nút "+N" rộng theo số chữ số: đo nút đang có, chưa có thì lấy bề rộng tối thiểu của nó + khe.
      if (moreMax.current.sig !== sig) moreMax.current = { sig, w: 0 };
      if (more) moreMax.current.w = Math.max(moreMax.current.w, more.offsetWidth);
      const moreW = moreMax.current.w || 48;
      // Trừ 1px: offsetWidth làm tròn, thẻ rộng lẻ (chip skill) có thể nhỉnh hơn số đo nửa px.
      setFit(fitCount(avail - 1, widths, gap, moreW));
    };
    ro?.observe(el);
    calc();
    return () => ro?.disconnect();
  }, [ref, active, sig, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  return fit;
}
