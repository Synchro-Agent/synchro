"use client";
// Kết nối ElevenLabs Realtime (cùng giao thức sự kiện với OpenAI Realtime) qua WebSocket:
// thu micro → PCM16 24 kHz gửi lên, nhận PCM16 về và phát liền mạch, ngắt lời khi người dùng nói chen.
import type { LevelRef } from "./voicefx";

export type RtPhase = "connecting" | "listen" | "think" | "speak";
export type RtHandlers = {
  onPhase: (p: RtPhase) => void;
  onCaption: (aiText: string) => void;
  onUser: (text: string) => void;
  onTurn: (user: string, ai: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
};

const WORKLET = `class Cap extends AudioWorkletProcessor { process(i) { const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor("cap", Cap);`;

const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export async function startRealtime(opts: { url: string; model: string; secret: string; micLevel: LevelRef; outLevel: LevelRef; muted: () => boolean }, h: RtHandlers) {
  const ctx = new AudioContext({ sampleRate: 24000 });
  if (ctx.state === "suspended") await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const src = ctx.createMediaStreamSource(stream);
  const micAn = ctx.createAnalyser(); micAn.fftSize = 512; src.connect(micAn);
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const cap = new AudioWorkletNode(ctx, "cap");
  src.connect(cap);
  const outGain = ctx.createGain();
  const outAn = ctx.createAnalyser(); outAn.fftSize = 512;
  outGain.connect(outAn); outAn.connect(ctx.destination);

  const ws = new WebSocket(`${opts.url}?model=${encodeURIComponent(opts.model)}`, ["realtime", "openai-insecure-api-key." + opts.secret]);
  let open = false, closed = false;
  let pending = new Int16Array(0);
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let aiText = "", userText = "", phase: RtPhase = "connecting";
  const set = (p: RtPhase) => { if (p !== phase) { phase = p; h.onPhase(p); } };

  // Gửi âm thanh micro theo từng đoạn ~100 ms.
  cap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (!open || opts.muted()) return;
    const f = e.data, add = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) add[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    const merged = new Int16Array(pending.length + add.length); merged.set(pending); merged.set(add, pending.length); pending = merged;
    if (pending.length >= 2400) { ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64(new Uint8Array(pending.buffer)) })); pending = new Int16Array(0); }
  };

  const stopPlayback = () => { for (const s of playing) { try { s.stop(); } catch {} } playing.clear(); playAt = 0; };
  const play = (pcm: Uint8Array) => {
    const n = pcm.length >> 1, view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buf = ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(outGain);
    const at = Math.max(ctx.currentTime + 0.03, playAt);
    node.start(at); playAt = at + buf.duration;
    playing.add(node);
    node.onended = () => { playing.delete(node); if (!playing.size && phase === "speak" && responseDone) set("listen"); };
  };
  let responseDone = false;

  ws.onopen = () => { open = true; set("listen"); };
  ws.onmessage = (ev) => {
    let m: { type: string; delta?: string; transcript?: string; error?: { message?: string } };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    switch (m.type) {
      case "input_audio_buffer.speech_started":
        // Người dùng nói chen: dừng giọng đang phát ngay.
        stopPlayback(); aiText = ""; h.onCaption(""); set("listen"); break;
      case "input_audio_buffer.speech_stopped":
        set("think"); break;
      case "conversation.item.input_audio_transcription.completed":
        userText = m.transcript ?? ""; h.onUser(userText); break;
      case "response.created":
        responseDone = false; aiText = ""; set("think"); break;
      case "response.output_audio.delta": case "response.audio.delta":
        if (m.delta) { play(unb64(m.delta)); set("speak"); } break;
      case "response.output_audio_transcript.delta": case "response.audio_transcript.delta":
        aiText += m.delta ?? ""; h.onCaption(aiText); break;
      case "response.done":
        responseDone = true;
        if (aiText.trim()) h.onTurn(userText, aiText.trim());
        userText = "";
        if (!playing.size) set("listen");
        break;
      case "error":
        h.onError(m.error?.message ?? "Lỗi kết nối giọng nói"); break;
    }
  };
  ws.onerror = () => h.onError("Mất kết nối tới máy chủ giọng nói");
  ws.onclose = () => { if (!closed) h.onClose(); };

  // Mức âm lượng cho hiệu ứng sóng.
  const md = new Uint8Array(new ArrayBuffer(micAn.fftSize)), od = new Uint8Array(new ArrayBuffer(outAn.fftSize));
  let raf = 0;
  const rms = (an: AnalyserNode, d: Uint8Array<ArrayBuffer>) => { an.getByteTimeDomainData(d); let s = 0; for (const b of d) s += ((b - 128) / 128) ** 2; return Math.min(1, Math.sqrt(s / d.length) * 4); };
  const tick = () => { opts.micLevel.current = opts.muted() ? 0 : rms(micAn, md); opts.outLevel.current = rms(outAn, od); raf = requestAnimationFrame(tick); };
  tick();

  return {
    interrupt: () => { stopPlayback(); if (open) ws.send(JSON.stringify({ type: "response.cancel" })); set("listen"); },
    close: () => {
      closed = true; cancelAnimationFrame(raf); stopPlayback();
      try { ws.close(); } catch {}
      cap.port.onmessage = null; src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {});
      opts.micLevel.current = 0; opts.outLevel.current = 0;
    },
  };
}
