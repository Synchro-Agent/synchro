"use client";
// Cuộc gọi giọng nói nối tiếp (khi không mở được Eleven Realtime, ví dụ khóa chưa có quyền convai_write):
// ElevenLabs Scribe nghe và tự nhận ngôn ngữ từng câu → model chat của Synchro (gói hoặc khóa API, chọn tự động) trả lời
// đúng ngôn ngữ đó → giọng ElevenLabs đọc. Cùng cách gọi với startRealtime (RtHandlers) để nơi dùng chỉ đổi hàm khởi động.
import type { LevelRef } from "./voicefx";
import type { RtHandlers } from "./realtime";
import { startMicLevel } from "./voicefx";
import { startScribe, type Scribe } from "./scribe";
import { speakAI, type Speaking } from "./speak";
import { createVad } from "./vad";
import { toSpeech } from "./voiceflow";

type Opts = {
  /** Hướng dẫn của agent (tính cách, nhiệm vụ). */
  system: string; greet?: string; voice?: string; speed?: number;
  micLevel: LevelRef; outLevel: LevelRef; muted: () => boolean; barge?: () => boolean; maxSeconds?: number;
};
const VOICE_RULES = `Đây là cuộc trò chuyện bằng giọng nói. Luôn trả lời bằng đúng ngôn ngữ người dùng vừa nói (họ đổi tiếng thì đổi theo).
Nói tự nhiên như người thật, câu ngắn, thường 1 đến 3 câu; không dùng Markdown, danh sách, bảng, code hay đường dẫn; đọc số và ký hiệu theo cách người ta nói.`;

export async function startCascade(o: Opts, h: RtHandlers) {
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let closed = false, busy = false, gen = 0;
  let out: Speaking | null = null;
  let scribe: Scribe | null = null;
  let stopBarge: (() => void) | null = null;
  const t0 = Date.now();

  const stopVoice = () => { out?.stop(); out = null; stopBarge?.(); stopBarge = null; };
  const listen = () => { if (closed) return; busy = false; scribe?.pause(o.muted()); h.onPhase("listen"); };
  // Nói chen để ngắt: đo micro trong lúc đọc, người dùng nói thì dừng đọc và nghe tiếp.
  const watchBarge = async (my: number) => {
    if (!o.barge?.()) return;
    const vad = createVad({ floor: 0.18, calibMs: 500 });
    const mic = { current: 0 };
    let raf = 0, dead = false;
    const stop = await startMicLevel(mic).catch(() => null);
    if (!stop) return;
    const tick = (t: number) => {
      if (dead) return;
      if (vad.feed(mic.current, t, o.outLevel.current) && gen === my) { stopVoice(); h.onCaption(""); listen(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stopBarge = () => { dead = true; cancelAnimationFrame(raf); stop(); };
  };
  const say = async (text: string) => {
    const my = ++gen;
    h.onPhase("speak");
    h.onCaption(text);
    scribe?.pause(true);
    const v = await speakAI(toSpeech(text).join(" "), { voice: o.voice, speed: o.speed, level: o.outLevel });
    if (closed || gen !== my) { v?.stop(); return; }
    if (!v) { h.onError("Không đọc được bằng giọng ElevenLabs lúc này."); h.onCaption(""); listen(); return; }
    out = v;
    void watchBarge(my);
    await v.done;
    if (out === v) { out = null; stopBarge?.(); stopBarge = null; }
    if (!closed && gen === my) { h.onCaption(""); listen(); }
  };
  const reply = async (text: string) => {
    if (closed) return;
    if (o.maxSeconds && Date.now() - t0 > o.maxSeconds * 1000) { close(true); return; }
    busy = true;
    scribe?.pause(true);
    h.onUser(text);
    h.onPhase("think");
    history.push({ role: "user", content: text });
    const r = await fetch("/api/llm", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", effort: "low", system: `${o.system}\n\n${VOICE_RULES}`, messages: history.slice(-20), max_tokens: 400 }),
    }).then(async (x) => ({ ok: x.ok, j: await x.json().catch(() => ({})) as { text?: string; error?: string } })).catch(() => ({ ok: false, j: {} as { text?: string; error?: string } }));
    if (closed) return;
    const answer = (r.j.text ?? "").trim();
    if (!r.ok || !answer) { history.pop(); h.onError(r.j.error ?? "Model chưa trả lời được, hãy nói lại."); listen(); return; }
    history.push({ role: "assistant", content: answer });
    // Như Realtime: đọc xong (hoặc bị ngắt) mới đưa cả lượt vào lời thoại, trong lúc đọc chỉ hiện phụ đề.
    await say(answer);
    if (!closed) h.onTurn(text, answer);
  };

  scribe = await startScribe({ level: o.micLevel }, {
    onPartial: (t) => { if (!busy && t) h.onUser(t); },
    onCommit: (t) => { if (!busy && !closed && t.trim()) void reply(t.trim()); },
    onError: (m) => h.onError(m),
  });
  if (!scribe) throw new Error("Không mở được nghe bằng ElevenLabs Scribe.");

  // self: cuộc gọi tự kết thúc (hết thời lượng) thì báo onClose; nơi dùng tự đóng thì không báo lại.
  const close = (self = false) => {
    if (closed) return;
    closed = true; gen++;
    stopVoice(); scribe?.stop(); scribe = null;
    if (self) h.onClose();
  };
  if (o.greet?.trim()) { history.push({ role: "assistant", content: o.greet.trim() }); void say(o.greet.trim()); }
  else listen();

  return {
    close: () => close(),
    interrupt: () => { if (out) { gen++; stopVoice(); h.onCaption(""); listen(); } },
    /** Bật / tắt micro (đồng bộ với nút micro của nơi dùng). */
    sync: () => { if (!busy && !out) scribe?.pause(o.muted()); },
  };
}
