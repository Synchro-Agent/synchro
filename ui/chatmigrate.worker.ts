// Luồng phụ đọc khóa localStorage cũ u:<uid>:chats (blueprint B4.3): JSON.parse cả danh sách (vài MB với 500 đoạn chat) ở luồng chính là một
// tác vụ dài làm trang khựng lúc mở. Nhận chuỗi thô, trả { ok, rows } với rows = [{ id, s: chuỗi serialChat | null, idx }] (legacyRows);
// JSON hỏng thì { ok: false }. Luồng chính chỉ nhận lại chuỗi và chỉ mục nhỏ rồi ghi vào IndexedDB (ui/chatidb.ts parseLegacy).
// Chỉ dùng hàm thuần (chatidbcore / chatsynccore), không đụng DOM.
import { legacyRows } from "./chatidbcore";

const ctx = self as unknown as { onmessage: ((e: MessageEvent<string>) => void) | null; postMessage: (m: unknown) => void };
ctx.onmessage = (e) => {
  let list: unknown;
  try { list = JSON.parse(e.data); } catch { ctx.postMessage({ ok: false }); return; }
  ctx.postMessage({ ok: true, rows: legacyRows(list) });
};
