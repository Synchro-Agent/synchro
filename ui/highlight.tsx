"use client";
// Tô màu cú pháp (Shiki) cho khối code trong chat và tab Mã của artifact.
// - Tô ở luồng phụ (ui/highlight.worker.ts, lõi chung ui/shikicore.ts); không mở được luồng phụ thì tô ở luồng chính, chia đoạn nhỏ.
// - Tải chậm: lõi Shiki, bộ regex JavaScript (không WASM) và hai giao diện màu chỉ tải khi trang có khối code đầu tiên; mỗi ngôn ngữ là một
//   phần tải riêng, chỉ tải khi gặp ngôn ngữ đó. Phần tải đầu của trang chat không đổi.
// - Không chặn chữ đang chảy: chỉ tô khối đã đóng (```), chờ chữ đứng yên một nhịp, làm lúc trình duyệt rảnh.
// - Đang tải, ngôn ngữ lạ, khối quá dài: hiện như cũ (chữ đơn sắc). Màu sáng / tối theo biến CSS --shiki-light / --shiki-dark (globals.css).
import { useEffect, useState } from "react";
import { shikiLang, tokensOf, type Tok } from "./shikicore";

// Khối quá dài: tô màu tốn thời gian và hàng chục nghìn thẻ <span>; để chữ đơn sắc.
const MAX_CHARS = 60_000, MAX_LINES = 2_500;

// Tô ở luồng phụ (ui/highlight.worker.ts): lần đầu gặp HTML (kèm CSS, JS) Shiki dựng bộ regex mất ~250ms, trước đây chạy ở luồng chính nên mở
// tab Mã rồi bấm Xem trước hay mở menu Tải về bị khựng. Trình duyệt không mở được luồng phụ (hoặc luồng phụ lỗi): tô ở luồng chính, chia đoạn.
type Job = { ok: (t: Tok[][]) => void; no: (e: Error) => void; code: string; name: string };
let worker: Worker | null | undefined, seq = 0;
const jobs = new Map<number, Job>();
function hlWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./highlight.worker.ts", import.meta.url));
    // Luồng phụ hỏng (tệp không tải được, không tải được phần ngôn ngữ trong đó): việc đang chờ chuyển sang luồng chính, lần sau không thử lại.
    const broken = () => {
      worker?.terminate(); worker = null;
      const left = [...jobs.values()]; jobs.clear();
      for (const j of left) tokensOf(j.code, j.name, yieldToBrowser).then(j.ok, j.no);
    };
    worker.onmessage = (e: MessageEvent<{ id: number; toks?: Tok[][]; err?: string }>) => {
      const j = jobs.get(e.data.id); if (!j) return;
      if (!e.data.toks) return broken();
      jobs.delete(e.data.id);
      j.ok(e.data.toks);
    };
    worker.onerror = broken;
  } catch { worker = null; }
  return worker;
}
// Nhường luồng chính cho trình duyệt (bấm, vẽ khung hình) giữa hai đoạn tô màu.
const yieldToBrowser = () => new Promise<void>((ok) => {
  const sch = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sch?.yield) void sch.yield().then(ok, ok); else { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); }
});
const run = (code: string, name: string): Promise<Tok[][]> => {
  const w = hlWorker();
  if (!w) return tokensOf(code, name, yieldToBrowser);
  return new Promise((ok, no) => { const id = ++seq; jobs.set(id, { ok, no, code, name }); w.postMessage({ id, code, name }); });
};
// Kết quả theo (ngôn ngữ, code): mở lại đoạn chat hay vẽ lại tin không phải tô lại.
const memo = new Map<string, Tok[][]>();
export async function tokenize(code: string, lang: string): Promise<Tok[][] | null> {
  const name = shikiLang(lang);
  if (!name || !code || code.length > MAX_CHARS || code.split("\n", MAX_LINES + 1).length > MAX_LINES) return null;
  const key = `${name}\u0000${code}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const out = await run(code, name);
  if (memo.size > 200) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}

const idle = (f: () => void) => {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
  if (w.requestIdleCallback) { const n = w.requestIdleCallback(f, { timeout: 800 }); return () => w.cancelIdleCallback?.(n); }
  const n = setTimeout(f, 30); return () => clearTimeout(n);
};
/** Dòng đã tô màu của khối code, hoặc null (chưa xong / không tô): khi null hiện chữ đơn sắc như trước. ready: khối đã đóng, chữ không còn chảy. */
export function useHighlight(code: string, lang: string, ready = true): Tok[][] | null {
  const name = ready ? shikiLang(lang) : null;
  const [res, setRes] = useState<{ key: string; toks: Tok[][] } | null>(null);
  const key = name ? `${name}\u0000${code}` : "";
  useEffect(() => {
    if (!name) return;
    const cached = memo.get(key);
    if (cached) { setRes({ key, toks: cached }); return; }
    let live = true, stop = () => {};
    // Chờ một nhịp cho chữ đứng yên (bản sửa artifact, khối vừa đóng), rồi tô lúc trình duyệt rảnh.
    const t = setTimeout(() => { stop = idle(() => { tokenize(code, name).then((toks) => { if (live && toks) setRes({ key, toks }); }, () => {}); }); }, 150);
    return () => { live = false; clearTimeout(t); stop(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return res && res.key === key ? res.toks : null;
}

/** Một dòng đã tô màu. */
export function TokLine({ toks }: { toks: Tok[] }) {
  return <>{toks.map((k, i) => (k.l || k.d ? <span key={i} style={{ "--shiki-light": k.l, "--shiki-dark": k.d } as React.CSSProperties}>{k.t}</span> : k.t))}</>;
}
