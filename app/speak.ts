"use client";
// Đọc to bằng giọng ElevenLabs thật (máy chủ gọi API, trình duyệt phát dần khi âm thanh còn đang tạo).
// Không dùng được (chưa gắn khóa, tài khoản chưa được bật Speech, khóa thiếu quyền) thì trả null để nơi gọi dùng giọng của trình duyệt.
// Câu trả lời dài được chia phần (voiceflow.ts) và đọc nối tiếp bằng một phần tử âm thanh duy nhất. Giữa chừng hết hạn mức, hết credit, lỗi mạng: done báo false,
// rest() trả về phần chưa đọc để nơi gọi đọc nốt bằng giọng của trình duyệt, không dừng giữa câu như đã xong.
import type { LevelRef } from "./voicefx";
import { splitSpeech } from "./voiceflow";

export type Speaking = { stop: () => void; done: Promise<boolean>; rest: () => string };
let off = false, offWhy = "", note = "";
/** Câu báo một lần khi tài khoản đã hết hạn mức giọng AI trong ngày (đọc xong thì xóa). */
export const aiVoiceNote = () => { const m = note; note = ""; return m; };
/** Lý do lần gần nhất không đọc được bằng giọng AI (để báo một lần). */
export const aiVoiceIssue = () => offWhy;
export const aiVoiceOff = () => off;

/** speed theo cài đặt Tốc độ (Chậm / Bình thường / Nhanh) → phạm vi 0,7–1,2 của ElevenLabs. */
export const elSpeed = (rate: number) => Math.min(1.2, Math.max(0.7, 1 + (rate - 1) * 0.5));

type Opts = { voice?: string; speed?: number; level?: LevelRef; onStart?: () => void };

async function openPart(text: string, o: Opts, signal: AbortSignal): Promise<Response | null> {
  const r = await fetch("/api/speech/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: o.voice || undefined, speed: o.speed }), signal }).catch(() => null);
  if (r?.ok && r.body) return r;
  const j = (await r?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
  offWhy = j?.error ?? "";
  // Hết hạn mức trong ngày: cả phiên dùng giọng trình duyệt, báo một lần.
  if (j?.code === "budget") { off = true; note = offWhy; return null; }
  // Chưa gắn khóa / không có quyền: cả phiên dùng giọng trình duyệt. Hết credit, bận: lần sau thử lại.
  if (!signal.aborted && (!r || r.status === 503 || r.status === 401 || (r.status === 403 && j?.code !== "plan" && j?.code !== "quota"))) off = true;
  return null;
}

export async function speakAI(text: string, o: Opts = {}): Promise<Speaking | null> {
  if (off || !text.trim()) return null;
  const parts = splitSpeech(text);
  const ac = new AbortController();
  const r0 = await openPart(parts[0], o, ac.signal);
  if (!r0) return null;
  // Một phần tử âm thanh cho mọi phần: trình duyệt đã cho phát sau lần bấm đầu, phần tử mới có thể bị chặn tự phát (Safari).
  const audio = new Audio();
  let stopped = false, url = "", idx = 0, started = false;
  const release = () => { if (url) { const u = url; url = ""; setTimeout(() => URL.revokeObjectURL(u), 1000); } };
  // Phát một phần; loaded: đã tải xong âm thanh của phần này, lúc đó mới xin phần sau (không tốn credit cho phần chưa chắc đọc tới).
  const play = async (r: Response) => {
    const ct = (r.headers.get("content-type") ?? "").split(";")[0];
    let loadedFn: () => void = () => {};
    const loaded = new Promise<void>((res) => { loadedFn = res; });
    release();
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
        loadedFn();
      }, { once: true });
    } else {
      url = URL.createObjectURL(await r.blob());
      audio.src = url;
      loadedFn();
    }
    const done = new Promise<boolean>((res) => {
      audio.onended = () => res(true);
      audio.onerror = () => res(false);
    });
    audio.onplaying = () => { if (!started) { started = true; o.onStart?.(); } };
    await audio.play();
    return { done, loaded };
  };
  let first: Awaited<ReturnType<typeof play>>;
  try { first = await play(r0); } catch { ac.abort(); release(); return null; }
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
  let wake: (ok: boolean) => void = () => {};
  const halted = new Promise<boolean>((res) => { wake = res; });
  const finish = (ok: boolean) => {
    cancelAnimationFrame(raf);
    if (o.level) o.level.current = 0;
    ctx?.close().catch(() => {});
    release();
    return ok;
  };
  const done = (async () => {
    let cur = first;
    for (;;) {
      // Xin phần sau khi phần này đã tải xong, để nối liền không có khoảng lặng dài.
      const at = idx + 1;
      const next = at < parts.length ? cur.loaded.then(() => (stopped ? null : openPart(parts[at], o, ac.signal))) : null;
      const ok = await Promise.race([cur.done, halted]);
      if (!ok || stopped) return finish(false);
      if (!next) return finish(true);
      const r = await Promise.race([next, halted.then(() => null)]);
      if (stopped) return finish(false);
      idx = at;
      if (!r) return finish(false);
      try { cur = await play(r); } catch { return finish(false); }
    }
  })();
  return { stop: () => { stopped = true; ac.abort(); audio.pause(); wake(false); }, done, rest: () => (stopped ? "" : parts.slice(idx).join(" ")) };
}
