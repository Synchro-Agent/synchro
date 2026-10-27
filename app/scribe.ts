"use client";
// Nghe và chép lời trực tiếp bằng ElevenLabs Scribe v2 Realtime: máy chủ cấp khóa dùng một lần, trình duyệt gửi PCM 16 kHz
// qua WebSocket và nhận câu tạm (partial) rồi câu chốt (committed) ngay khi người nói ngừng. Dùng cho Chép lời trực tiếp,
// nhập bằng giọng nói trong khung chat và chế độ trò chuyện khi không mở được Eleven Realtime.
import type { LevelRef } from "./voicefx";

export type ScribeHandlers = { onPartial?: (t: string) => void; onCommit: (t: string) => void; onError?: (msg: string) => void; onOpen?: () => void; onClose?: () => void };
export type Scribe = { stop: () => void; pause: (on: boolean) => void };

const WORKLET = `class Cap extends AudioWorkletProcessor { process(i) { const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor("cap16", Cap);`;
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const ERR: Record<string, string> = {
  quota_exceeded: "Đã hết giờ chép lời của gói ElevenLabs.", auth_error: "Phiên chép lời hết hạn, hãy bật lại micro.", rate_limited: "ElevenLabs đang giới hạn tốc độ, thử lại sau ít giây.",
  session_time_limit_exceeded: "Phiên chép lời đã đạt giới hạn thời gian.", resource_exhausted: "ElevenLabs đang quá tải, thử lại sau.", unaccepted_terms: "Tài khoản ElevenLabs cần đồng ý điều khoản trước khi chép lời trực tiếp.",
};

/** Có khóa ElevenLabs và quyền Speech thì trả về phiên chép lời; không thì null (nơi gọi tự dùng cách khác). */
export async function startScribe(o: { lang?: string; level?: LevelRef; keyterms?: string[] }, h: ScribeHandlers): Promise<Scribe | null> {
  const r = await fetch("/api/speech/live/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  if (!r?.ok) {
    const j = (await r?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
    if (r && r.status !== 503 && r.status !== 403) h.onError?.(j?.error ?? "Không mở được chép lời trực tiếp.");
    return null;
  }
  const { token, url } = (await r.json()) as { token: string; url: string };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const wurl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(wurl);
  URL.revokeObjectURL(wurl);
  const cap = new AudioWorkletNode(ctx, "cap16");
  src.connect(cap);
  const rate = ctx.sampleRate;
  const q = new URLSearchParams({ model_id: "scribe_v2_realtime", token, audio_format: `pcm_${rate}`, commit_strategy: "vad", vad_silence_threshold_secs: "0.8" });
  if (o.lang) q.set("language_code", o.lang);
  for (const k of (o.keyterms ?? []).slice(0, 50)) q.append("keyterms", k);
  const ws = new WebSocket(`${url}?${q}`);
  let open = false, closed = false, paused = false, pending = new Int16Array(0);
  const send = (pcm: Int16Array, commit = false) => { if (open) ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64(new Uint8Array(pcm.buffer)), commit, sample_rate: rate })); };
  cap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const f = e.data;
    if (o.level) { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; o.level.current = Math.min(1, Math.sqrt(s / f.length) * 6); }
    if (!open || paused) return;
    const add = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) add[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    const merged = new Int16Array(pending.length + add.length); merged.set(pending); merged.set(add, pending.length); pending = merged;
    if (pending.length >= rate / 10) { send(pending); pending = new Int16Array(0); }
  };
  ws.onopen = () => { open = true; h.onOpen?.(); };
  ws.onmessage = (ev) => {
    let m: { message_type?: string; text?: string; error?: string };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.message_type === "partial_transcript") h.onPartial?.(m.text ?? "");
    else if (m.message_type === "committed_transcript" || m.message_type === "committed_transcript_with_timestamps") { if (m.text?.trim()) h.onCommit(m.text.trim()); h.onPartial?.(""); }
    else if (m.message_type && m.message_type !== "session_started" && m.message_type !== "warning" && m.error) h.onError?.(ERR[m.message_type] ?? `Chép lời: ${m.error}`);
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    cap.port.onmessage = null;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    if (o.level) o.level.current = 0;
    h.onClose?.();
  };
  ws.onclose = cleanup;
  ws.onerror = () => { if (!open) h.onError?.("Không nối được tới ElevenLabs để chép lời."); };
  return {
    // Dừng: gửi phần âm thanh còn lại kèm commit để có câu chốt cuối, rồi mới đóng.
    stop: () => { if (open) { send(pending.length ? pending : new Int16Array(rate / 20), true); pending = new Int16Array(0); } setTimeout(() => { try { ws.close(); } catch {} cleanup(); }, 900); },
    pause: (v) => { paused = v; },
  };
}
