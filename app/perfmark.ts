// Đếm số lần vẽ của các khối lớn (thanh bên, ô soạn tin) cho bài đo tests/ui/render-perf.mjs (blueprint B2).
// Không làm gì trừ khi bài đo đặt window.__renders = {} trước, nên để trong bản chạy thật cũng không tốn gì; khác <Profiler>, chạy được cả ở bản production.
export const countRender = (n: string) => {
  const w = typeof window !== "undefined" ? (window as unknown as { __renders?: Record<string, number> }).__renders : undefined;
  if (w) w[n] = (w[n] ?? 0) + 1;
};
