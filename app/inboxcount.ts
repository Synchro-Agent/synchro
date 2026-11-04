"use client";
// Số mục cần xem của Hộp thư trên thanh bên: tách khỏi tasksui.tsx (nặng, tải chậm khi mở Hộp thư) vì thanh điều hướng luôn cần số này.
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "./i18n";

type Item = { run: string; title: string; read: boolean; status: string; proposals?: unknown };
export const INBOX_CHANGED = "synchro:inbox";

/** Số mục cần xem (kết quả chưa đọc + đề xuất chờ duyệt) trên thanh bên, kiểm tra mỗi phút và khi quay lại tab;
 *  có kết quả hay đề xuất mới khi tab đang ẩn thì báo bằng thông báo trình duyệt nếu được phép. */
export function useInboxCount(on: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => {
    if (!on) return;
    fetch("/api/inbox").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: { items: Item[]; unread: number; pending?: number }) => {
      setN(j.unread + (j.pending ?? 0));
      const done = j.items.filter((x) => x.status !== "running" && x.status !== "waiting" && !x.read);
      if (seen.current) for (const x of done) if (!seen.current.has(x.run) && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) new Notification(`Synchro · ${x.title}`, { body: x.proposals ? tr("Việc tự động đã chạy xong và có đề xuất chờ bạn duyệt.") : tr("Việc tự động đã chạy xong. Mở Hộp thư để xem kết quả.") });
      seen.current = new Set(done.map((x) => x.run));
    }).catch(() => {});
  }, [on]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f); window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); window.removeEventListener(INBOX_CHANGED, load); };
  }, [load]);
  return n;
}
