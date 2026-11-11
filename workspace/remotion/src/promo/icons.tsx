// Biểu tượng nét đơn giản (24×24, viết riêng cho Synchro) cho cảnh lưới tính năng: không dùng biểu tượng cảm xúc thay hình.
import React from "react";

const P: Record<string, React.ReactNode> = {
  spark: <path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" />,
  bolt: <path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z" />,
  shield: <path d="M12 2.8l7.5 3v5.6c0 4.6-3.2 8.3-7.5 9.8-4.3-1.5-7.5-5.2-7.5-9.8V5.8z" />,
  chart: <><path d="M4 20.5h16" /><path d="M7 17v-5" /><path d="M12 17V7" /><path d="M17 17v-8" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.6 2.6 3.8 5.4 3.8 8.5s-1.2 5.9-3.8 8.5c-2.6-2.6-3.8-5.4-3.8-8.5s1.2-5.9 3.8-8.5z" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" /><path d="M15.5 5.6a3.2 3.2 0 010 5.8" /><path d="M17.5 14.6c1.8.7 3 2.4 3.5 4.9" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="M8 12.3l2.7 2.7L16.2 9.4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.8a4 4 0 018 0v2.7" /></>,
  rocket: <><path d="M12 3c3.3 2 5 5.4 5 9.5l-2.5 3.5h-5L7 12.5C7 8.4 8.7 5 12 3z" /><circle cx="12" cy="10" r="1.8" /><path d="M9.5 16l-2 4.5 3-1.5M14.5 16l2 4.5-3-1.5" /></>,
  star: <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />,
  code: <><path d="M8.5 7.5L4 12l4.5 4.5" /><path d="M15.5 7.5L20 12l-4.5 4.5" /><path d="M13.3 5l-2.6 14" /></>,
  cloud: <path d="M7 18.5h10a4 4 0 00.6-8 5.5 5.5 0 00-10.6-1.2A4.6 4.6 0 007 18.5z" />,
  chat: <path d="M4 5.5h16v10H10l-4.5 3.8V15.5H4z" />,
  layers: <><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" /><path d="M3.5 12l8.5 4.5 8.5-4.5" /><path d="M3.5 16l8.5 4.5 8.5-4.5" /></>,
};

export const Icon: React.FC<{ name: string; size: number; color: string; stroke?: number }> = ({ name, size, color, stroke = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{P[name] ?? P.spark}</svg>
);
