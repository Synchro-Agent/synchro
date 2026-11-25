"use client";
// Số mục cần xem của Autopilot trên thanh bên và thông báo khi một việc xong: tách khỏi tasksui.tsx (nặng, tải chậm khi
// mở Autopilot) vì thanh điều hướng luôn cần số này.
import { useCallback, useEffect, useRef, useState } from "react";
import { useEvent } from "./useevent";
import { tr } from "./i18n";

export const INBOX_CHANGED = "synchro:inbox";

export type Fresh = { run: string; title: string; proposals: number };
type Count = { unread: number; pending: number; fresh: Fresh[] };
// Số đếm dựng sẵn ở máy chủ (gói khởi động, server/bootdata.ts): lần mở trang không hỏi /api/autopilot?count=1, dùng
// một lần.
let seeded: Count | null = null;
export function seedInboxCount(c: Count | null | undefined) { seeded = c ?? null; }

/** Số mục cần xem (kết quả chưa đọc + đề xuất chờ duyệt) trên thanh bên: hỏi mỗi phút và khi quay lại tab, chỉ lấy số đếm, không lấy nội dung.
 *  Tab đang ẩn thì không hỏi; riêng người đã cho phép thông báo trình duyệt thì hỏi thưa (5 phút) để vẫn báo được
 *  khi có kết quả mới. Kết quả mới (chưa thấy ở lần hỏi trước): tab đang ẩn thì thông báo của trình duyệt / ứng dụng
 *  máy tính, tab đang mở thì onFresh (dòng thông báo trong app). Lần hỏi đầu chỉ ghi nhớ, không báo lại những gì đã
 *  có từ trước khi mở trang. */
export function useInboxCount(on: boolean, onFresh?: (x: Fresh) => void) {
  const fresh = useEvent((x: Fresh) => onFresh?.(x));
  const [n, setN] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(() => {
    if (!on) return;
    fetch("/api/autopilot?count=1").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: Count) => {
      setN(j.unread + j.pending);
      if (seen.current) for (const x of j.fresh) {
        if (seen.current.has(x.run)) continue;
        if (!document.hidden) fresh(x);
        else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const body = x.proposals ? tr("Autopilot có đề xuất cần bạn duyệt.")
            : tr("Autopilot đã xong, mở để xem kết quả và hỏi tiếp.");
          new Notification(`Synchro · ${x.title}`, { body });
        }
      }
      seen.current = new Set(j.fresh.map((x) => x.run));
      // Mất mạng / máy chủ đang deploy: giữ số cũ, lần hỏi sau (mỗi phút) tự thử lại; không ghi nhật ký để khỏi mỗi
      // phút một dòng khi mất mạng.
    }).catch(() => undefined);
  }, [on, fresh]);
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
