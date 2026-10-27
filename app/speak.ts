"use client";
// Đọc to bằng giọng ElevenLabs thật (máy chủ gọi API, trình duyệt phát dần khi âm thanh còn đang tạo).
// Không dùng được (chưa gắn khóa, tài khoản chưa được bật Speech, khóa thiếu quyền) thì trả null để nơi gọi dùng giọng của trình duyệt.
import type { LevelRef } from "./voicefx";

export type Speaking = { stop: () => void; done: Promise<boolean> };
let off = false, offWhy = "";
/** Lý do lần gần nhất không đọc được bằng giọng AI (để báo một lần). */
export const aiVoiceIssue = () => offWhy;
export const aiVoiceOff = () => off;

/** speed theo cài đặt Tốc độ (Chậm / Bình thường / Nhanh) → phạm vi 0,7–1,2 của ElevenLabs. */
export const elSpeed = (rate: number) => Math.min(1.2, Math.max(0.7, 1 + (rate - 1) * 0.5));

export async function speakAI(text: string, o: { voice?: string; speed?: number; level?: LevelRef; onStart?: () => void } = {}): Promise<Speaking | null> {
  if (off || !text.trim()) return null;
  const ac = new AbortController();
  const r = await fetch("/api/speech/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: o.voice || undefined, speed: o.speed }), signal: ac.signal }).catch(() => null);
  if (!r?.ok || !r.body) {
    const j = (await r?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
    offWhy = j?.error ?? "";
    // Chưa gắn khóa / không có quyền: cả phiên dùng giọng trình duyệt. Hết credit, bận: lần sau thử lại.
    if (!r || r.status === 503 || r.status === 401 || (r.status === 403 && j?.code !== "plan" && j?.code !== "quota")) off = true;
    return null;
  }
  const audio = new Audio();
  const ct = (r.headers.get("content-type") ?? "").split(";")[0];
  let url = "", stopped = false;
  // Phát dần qua MediaSource khi trình duyệt hỗ trợ MP3; không thì tải hết rồi phát (vẫn nhanh với câu ngắn).
  if (ct === "audio/mpeg" && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) {
    const ms = new MediaSource();
    url = URL.createObjectURL(ms);
    audio.src = url;
    ms.addEventListener("sourceopen", async () => {
      const sb = ms.addSourceBuffer("audio/mpeg");
      const reader = r.body!.getReader();
      const wait = () => new Promise<void>((ok) => (sb.updating ? sb.addEventListener("updateend", () => ok(), { once: true }) : ok()));
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          await wait();
          sb.appendBuffer(value);
        }
        await wait();
        if (ms.readyState === "open") ms.endOfStream();
      } catch { if (ms.readyState === "open") try { ms.endOfStream(); } catch {} }
    }, { once: true });
  } else {
    url = URL.createObjectURL(await r.blob());
    audio.src = url;
  }
  // Mức âm lượng thật của giọng đang phát cho sóng / quả cầu.
  let raf = 0, ctx: AudioContext | null = null;
  if (o.level) {
    try {
      ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaElementSource(audio).connect(an); an.connect(ctx.destination);
      const d = new Uint8Array(new ArrayBuffer(an.fftSize));
      const tick = () => { an.getByteTimeDomainData(d); let s = 0; for (const b of d) s += ((b - 128) / 128) ** 2; o.level!.current = Math.min(1, Math.sqrt(s / d.length) * 4); raf = requestAnimationFrame(tick); };
      tick();
    } catch { ctx = null; }
  }
  let finish: (ok: boolean) => void = () => {};
  const done = new Promise<boolean>((res) => { finish = res; });
  const cleanup = (ok: boolean) => {
    cancelAnimationFrame(raf);
    if (o.level) o.level.current = 0;
    ctx?.close().catch(() => {});
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    finish(ok);
  };
  audio.onended = () => cleanup(true);
  audio.onerror = () => cleanup(false);
  audio.onplaying = () => o.onStart?.();
  try { await audio.play(); } catch { ac.abort(); cleanup(false); return null; }
  return { stop: () => { stopped = true; ac.abort(); audio.pause(); cleanup(false); }, done };
}
