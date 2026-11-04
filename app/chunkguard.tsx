"use client";
// Tab mở từ bản cũ quá lâu (chunk cũ chỉ được giữ khoảng một ngày sau khi bản đó bị thay): mở Monaco, Mermaid… thì tải chunk lỗi 404.
// Tải lại trang một lần để lấy bản mới, thay vì để trang vỡ. Lượt trả lời đang chạy vẫn chạy tiếp ở máy chủ. Một phút tối đa một lần: lỗi thật không thành vòng lặp.
import { useEffect } from "react";

const CHUNK = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i;
export function ChunkGuard() {
  useEffect(() => {
    const on = (e: ErrorEvent | PromiseRejectionEvent) => {
      const r = "reason" in e ? e.reason : e.error ?? e.message;
      if (!CHUNK.test(`${r?.name ?? ""} ${r?.message ?? r ?? ""}`)) return;
      try {
        const k = "synchro:chunk-reload", last = Number(sessionStorage.getItem(k) ?? 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(k, String(Date.now()));
      } catch { return; }
      location.reload();
    };
    window.addEventListener("error", on);
    window.addEventListener("unhandledrejection", on);
    return () => { window.removeEventListener("error", on); window.removeEventListener("unhandledrejection", on); };
  }, []);
  return null;
}
