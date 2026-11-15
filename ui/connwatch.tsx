"use client";
// Luôn gắn ở trang chính: cửa sổ đăng nhập connector xong mà không có màn hình nào đang chờ (đã đóng Cài đặt, thẻ kết nối lại đã cuộn đi nơi khác) vẫn có người xác nhận để cửa sổ tự đóng,
// và người dùng nhận được thông báo. Tách khỏi connectorsui.tsx (nặng, tải chậm) vì trang chính luôn cần.
import { useEffect } from "react";

const CHANNEL = "synchro-connector";
/** Màn hình đang chờ kết quả đăng nhập (useLoginFlow): trả true nếu nó tự báo kết quả này cho người dùng. */
export const loginClaims = new Set<(id: string | null) => boolean>();
export const CONN_CHANGED = "synchro:connectors-changed";

export function ConnLoginWatcher({ say }: { say: (m: string) => void }) {
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    const seen = new Set<string>();
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => {
        const d = e.data as { type?: string; nonce?: string; id?: string | null; message?: string };
        if (d?.type !== CHANNEL) return;
        bc?.postMessage({ type: `${CHANNEL}-ack`, nonce: d.nonce });
        // Cửa sổ đăng nhập gửi tin hai lần phòng khi lỡ: chỉ xử lý một lần.
        if (!d.nonce || seen.has(d.nonce)) return;
        seen.add(d.nonce);
        window.dispatchEvent(new Event(CONN_CHANGED));
        if (d.message && ![...loginClaims].some((f) => f(d.id ?? null))) say(d.message);
      };
    } catch {}
    return () => bc?.close();
  }, [say]);
  return null;
}
