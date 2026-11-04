"use client";
// Số mục cần xem của Hộp thư trên thanh bên: tách khỏi tasksui.tsx (nặng, tải chậm khi mở Hộp thư) vì thanh điều hướng luôn cần số này.
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "./i18n";

export const INBOX_CHANGED = "synchro:inbox";

/** Số mục cần xem (kết quả chưa đọc + đề xuất chờ duyệt) trên thanh bên: hỏi mỗi phút và khi quay lại tab, chỉ lấy số đếm, không lấy nội dung.
 *  Tab đang ẩn thì không hỏi; riêng người đã cho phép thông báo trình duyệt thì hỏi thưa (5 phút) để vẫn báo được khi có kết quả mới. */
export function useInboxCount(on: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => {
    if (!on) return;
    fetch("/api/inbox?count=1").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: { unread: number; pending: number; fresh: { run: string; title: string; proposals: number }[] }) => {
      setN(j.unread + j.pending);
      if (seen.current) for (const x of j.fresh) if (!seen.current.has(x.run) && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) new Notification(`Synchro · ${x.title}`, { body: x.proposals ? tr("Việc tự động có đề xuất cần bạn duyệt.") : tr("Đã có kết quả trong Hộp thư.") });
      seen.current = new Set(j.fresh.map((x) => x.run));
    }).catch(() => {});
  }, [on]);
  useEffect(() => {
    load();
    let ticks = 0;
    const t = setInterval(() => { ticks++; if (!document.hidden || (ticks % 5 === 0 && typeof Notification !== "undefined" && Notification.permission === "granted")) load(); }, 60_000);
    const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f); window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); window.removeEventListener(INBOX_CHANGED, load); };
  }, [load]);
  return n;
}
