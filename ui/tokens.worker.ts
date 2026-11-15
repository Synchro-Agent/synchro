// Luồng phụ đếm token (js-tiktoken, bảng cl100k): đọc bảng ~1MB và dựng bộ mã hóa mất ~200ms, chạy ở luồng chính thì mở Synchro Code bị khựng.
// Nhận [[khóa, chữ], …], trả [[khóa, số token], …]. ui/heavy.ts mở luồng này khi vào Synchro Code.
import { Tiktoken } from "js-tiktoken/lite";
import ranks from "js-tiktoken/ranks/cl100k_base";

const enc = new Tiktoken(ranks);
const ctx = self as unknown as { onmessage: ((e: MessageEvent<[string, string][]>) => void) | null; postMessage: (m: unknown) => void };
ctx.onmessage = (e) => {
  ctx.postMessage(e.data.map(([k, s]) => { let n: number; try { n = enc.encode(s).length; } catch { n = Math.ceil(s.length / 4); } return [k, n]; }));
};
