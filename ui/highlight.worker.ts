// Luồng phụ tô màu cú pháp: Shiki dựng bộ regex của ngữ pháp và dò từng dòng ở đây, luồng chính (bấm, cuộn, mở menu) không bị chặn.
// Nhận { id, code, name }, trả { id, toks } hoặc { id, err }. ui/highlight.tsx mở luồng này lần đầu cần tô; không mở được thì tô ở luồng chính.
import { tokensOf } from "./shikicore";

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; code: string; name: string }>) => void) | null; postMessage: (m: unknown) => void };
ctx.onmessage = (e) => {
  const { id, code, name } = e.data;
  tokensOf(code, name).then((toks) => ctx.postMessage({ id, toks }), (err) => ctx.postMessage({ id, err: String((err as Error)?.message ?? err) }));
};
