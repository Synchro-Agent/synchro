"use client";
// Tải chậm các phần không phải chat (Code, Speech, Bộ não, Kho kỹ năng, Cài đặt…): trang đầu chỉ tải phần chat, mở mục nào mới tải mục đó.
import { lazy, Suspense, type ComponentType } from "react";

export const ViewLoading = () => <div className="view-load" role="status" aria-label="Đang tải"><span className="art-spin" /></div>;

// Sau một lần phát hành, tab đang mở có thể đòi tệp cũ đã bị xóa: tải lại trang một lần là có bản mới (bản nháp, lượt đang chạy đều được giữ).
function reloadOnce(e: unknown): never {
  let again = false;
  try { again = Date.now() - Number(sessionStorage.getItem("chunk-reload") ?? 0) < 60_000; if (!again) sessionStorage.setItem("chunk-reload", String(Date.now())); } catch {}
  if (!again) location.reload();
  throw e;
}

/** Thành phần tải chậm. fallback: hiện trong lúc tải (null: không hiện gì, dùng cho hộp thoại và phần phụ). preload: tải trước khi rê chuột vào nút mở. */
export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>, fallback: React.ReactNode = <ViewLoading />) {
  let p: Promise<{ default: ComponentType<P> }> | null = null;
  const get = () => (p ??= load().then((c) => ({ default: c })).catch((e) => { p = null; return reloadOnce(e); }));
  const L = lazy(get) as unknown as ComponentType<P>;
  const C = (props: P) => <Suspense fallback={fallback}><L {...props} /></Suspense>;
  C.preload = () => { void get().catch(() => {}); };
  return C;
}
