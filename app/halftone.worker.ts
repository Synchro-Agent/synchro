// Luồng phụ của nền tab Code: tạo ngữ cảnh WebGL (~150ms, chặn luồng chính khi mở Synchro Code) và vẽ shader trên OffscreenCanvas ở đây.
// Tin nhắn: { t: "init", canvas, theme, still, w, h } rồi { t: "size", w, h } / { t: "theme", theme } / { t: "wake", hidden } / { t: "stop" }.
import { startHalftone, type Halftone, type HalftoneTheme } from "./halftonegl";

type Msg = { t: "init"; canvas: OffscreenCanvas; theme: HalftoneTheme; still: boolean; w: number; h: number } | { t: "size"; w: number; h: number } | { t: "theme"; theme: HalftoneTheme } | { t: "wake"; hidden: boolean } | { t: "stop" };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage: (m: unknown) => void; close: () => void };
let hf: Halftone | null = null;
ctx.onmessage = (e) => {
  const m = e.data;
  if (m.t === "init") { hf = startHalftone(m.canvas, m.theme, m.still); ctx.postMessage({ t: hf ? "ok" : "nogl" }); if (hf) hf.size(m.w, m.h); return; }
  if (!hf) return;
  if (m.t === "size") hf.size(m.w, m.h);
  else if (m.t === "theme") hf.theme(m.theme);
  else if (m.t === "wake") hf.wake(m.hidden);
  else if (m.t === "stop") { hf.stop(); hf = null; ctx.close(); }
};
