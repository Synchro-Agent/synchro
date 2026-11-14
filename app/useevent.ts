"use client";
// Hàm xử lý ổn định (blueprint B2): cùng một hàm suốt đời component nhưng luôn chạy bản mới nhất của fn (đọc state của lần vẽ gần nhất).
// Dùng cho các hàm truyền xuống component đã memo hay đặt trong context, để chúng không phải vẽ lại chỉ vì hàm được tạo lại mỗi lần vẽ.
// Không gọi hàm này lúc đang vẽ: bản mới nhất chỉ được gắn sau khi lần vẽ đã áp lên trang.
import { useCallback, useLayoutEffect, useRef } from "react";

export function useEvent<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...a: A) => ref.current(...a), []);
}
