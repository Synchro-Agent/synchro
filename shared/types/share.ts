// Bản chụp đoạn chat chia sẻ công khai (server/sharesnap.ts dựng, ui/shareview.tsx hiện).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.
import type { ArtType } from "../artifacts";

// Từ server/sharesnap.ts.
export type ShareSeg = { k: "text"; t: string } | { k: "art"; title: string; type: ArtType; lang: string | null; content: string } | { k: "old"; title: string };
export type ShareMsg = { r: "u" | "a"; segs: ShareSeg[]; files?: number; outs?: number };
// imgs: ảnh ngoài trong artifact đã được nhúng vào bản chụp (sharestore.ts); missing: số ảnh không nhúng được. Bản chụp cũ chưa có trường này được nhúng khi có người mở lần đầu.
export type ShareSnap = { title: string; msgs: ShareMsg[]; imgs?: { missing: number } };
