"use client";
// Hiệu ứng "đang trả lời / đang suy nghĩ" của đoạn chat: sáu chấm metaball vẽ bằng WebGL (fluidgl.ts, fluidshader.ts).
// Chỉ dòng trạng thái của câu trả lời đang chạy dùng nó; mọi chỗ chờ khác dùng Spinner (spinner.tsx).
// - Cả trang chỉ có MỘT ngữ cảnh WebGL cho hiệu ứng này: trình duyệt giới hạn số ngữ cảnh, mỗi chỗ một ngữ cảnh
//   từng là lý do hiệu ứng bị bỏ. Bản đang hiện trên màn hình giữ ngữ cảnh; bản khác vẽ chấm bằng CSS tới khi ngữ
//   cảnh được nhả.
// - Ra khỏi màn hình hoặc tab bị ẩn: nhả ngữ cảnh và thôi vẽ (không tốn GPU); hiện lại thì dựng lại (vài mili giây).
// - Không có WebGL, ngữ cảnh bị mất, hoặc bật giảm chuyển động (hệ điều hành hay Cài đặt): chấm tĩnh bằng CSS.
// - Màu là màu chữ của chỗ đặt (.fd dùng var(--text)): mực trên nền sáng, ngà trên nền tối, đổi giao diện là đổi theo.
import { useEffect, useRef } from "react";

const reduced = () => document.documentElement.dataset.motion === "reduced"
  || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** size: cỡ chấm (px) trong dòng chữ; quầng sáng vẽ tràn ra ngoài. */
export function FluidDots({ size = 14 }: { size?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || reduced()) return;
    // Phần WebGL tải chậm: trong lúc tải (và khi tải hỏng) chấm CSS vẫn hiện.
    let dead = false, detach: (() => void) | null = null;
    import("./fluidgl").then((m) => { if (!dead) detach = m.attach(el, size); },
      (e) => console.warn("[fluiddots] không tải được phần WebGL, dùng chấm CSS:", e));
    return () => { dead = true; detach?.(); };
  }, [size]);
  return (
    <span ref={box} className="fd" style={{ width: size, height: size }} aria-hidden="true">
      <span className="fd-css"><i /><i /><i /></span>
    </span>
  );
}
