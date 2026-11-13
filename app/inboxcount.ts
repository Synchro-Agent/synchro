"use client";
// Số mục cần xem của Hộp thư trên thanh bên: tách khỏi tasksui.tsx (nặng, tải chậm khi mở Hộp thư) vì thanh điều hướng luôn cần số này.
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "./i18n";

export const INBOX_CHANGED = "synchro:inbox";

type Count = { unread: number; pending: number; fresh: { run: string; title: string; proposals: number }[] };
// Số đếm dựng sẵn ở máy chủ (gói khởi động, app/bootdata.ts): lần mở trang không hỏi /api/inbox?count=1, dùng một lần.
let seeded: Count | null = null;
export function seedInboxCount(c: Count | null | undefined) { seeded = c ?? null; }

/** Số mục cần xem (kết quả chưa đọc + đề xuất chờ duyệt) trên thanh bên: hỏi mỗi phút và khi quay lại tab, chỉ lấy số đếm, không lấy nội dung.
 *  Tab đang ẩn thì không hỏi; riêng người đã cho phép thông báo trình duyệt thì hỏi thưa (5 phút) để vẫn báo được khi có kết quả mới. */
export function useInboxCount(on: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => {
    if (!on) return;
    fetch("/api/inbox?count=1").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: Count) => {
      setN(j.unread + j.pending);
      if (seen.current) for (const x of j.fresh) if (!seen.current.has(x.run) && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) new Notification(`Synchro · ${x.title}`, { body: x.proposals ? tr("Việc tự động có đề xuất cần bạn duyệt.") : tr("Đã có kết quả trong Hộp thư.") });
      seen.current = new Set(j.fresh.map((x) => x.run));
    }).catch(() => {});
  }, [on]);
  useEffect(() => {
    // Đã có số đếm dựng sẵn: dùng nó cho lần đầu (một lần), từ lần hỏi sau mới gọi máy chủ.
    if (on && seeded) { const c = seeded; seeded = null; setN(c.unread + c.pending); seen.current = new Set(c.fresh.map((x) => x.run)); } else load();
    let ticks = 0;
    const t = setInterval(() => { ticks++; if (!document.hidden || (ticks % 5 === 0 && typeof Notification !== "undefined" && Notification.permission === "granted")) load(); }, 60_000);
    const f = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", f); window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); window.removeEventListener(INBOX_CHANGED, load); };
  }, [load]);
  return n;
}
