"use client";
// Kết nối ElevenLabs Realtime (cùng giao thức sự kiện với OpenAI Realtime) qua WebSocket:
// thu micro → PCM16 24 kHz gửi lên, nhận PCM16 về và phát liền mạch, ngắt lời khi người dùng nói chen.
// Hai luồng: model giọng nói xác nhận ngay rồi gọi giao_viec; Synchro làm việc chính trong khung chat,
// xong thì gửi bản tóm tắt về (function_call_output) để model giọng nói đọc.
import type { LevelRef } from "./voicefx";
import { createVad } from "./vad";

export type RtPhase = "connecting" | "listen" | "think" | "speak";
export type RtHandlers = {
  onPhase: (p: RtPhase) => void;
  onCaption: (aiText: string) => void;
  onUser: (text: string) => void;
  onTurn: (user: string, ai: string) => void;
  /** Model giọng nói giao việc (giao_viec): trả về lời tóm tắt để đọc. */
  onTask?: (request: string) => Promise<string>;
  onError: (msg: string) => void;
  onClose: () => void;
};

const WORKLET = `class Cap extends AudioWorkletProcessor { process(i) { const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor("cap", Cap);`;
const DUCK = 0.12, DUCK_WAIT = 900;

const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export async function startRealtime(opts: { url: string; model: string; secret: string; micLevel: LevelRef; outLevel: LevelRef; muted: () => boolean; barge?: () => boolean }, h: RtHandlers) {
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
  const send = (m: object) => { if (open) ws.send(JSON.stringify(m)); };

  // Gửi âm thanh micro theo từng đoạn ~100 ms.
  cap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (!open || opts.muted()) return;
    const f = e.data, add = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) add[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    const merged = new Int16Array(pending.length + add.length); merged.set(pending); merged.set(add, pending.length); pending = merged;
    if (pending.length >= 2400) { send({ type: "input_audio_buffer.append", audio: b64(new Uint8Array(pending.buffer)) }); pending = new Int16Array(0); }
  };

  // Ngắt lời: VAD trên trình duyệt nghe thấy người dùng nói chen thì hạ nhỏ giọng ngay (~150 ms);
  // máy chủ xác nhận (speech_started) thì dừng hẳn, không xác nhận trong 0,9 giây (tiếng động, tiếng vọng) thì phát tiếp bình thường.
  let ducked = 0;
  const gainTo = (v: number) => { outGain.gain.cancelScheduledValues(ctx.currentTime); outGain.gain.setTargetAtTime(v, ctx.currentTime, 0.015); };
  const unduck = () => { if (ducked) { ducked = 0; gainTo(1); } };
  const stopPlayback = () => { for (const s of playing) { try { s.stop(); } catch {} } playing.clear(); playAt = 0; unduck(); };
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

  // Lượt đã giao việc: câu hỏi và câu trả lời đầy đủ đã vào khung chat qua onTask, không ghi thêm lượt nói (xác nhận, tóm tắt).
  let delegated = false, followUps = 0;
  const calls = new Set<string>();
  const onCall = (callId: string | undefined, name: string | undefined, args: string | undefined) => {
    if (!callId || calls.has(callId)) return;
    calls.add(callId);
    delegated = true;
    let req = "";
    try { req = String((JSON.parse(args || "{}") as { yeu_cau?: unknown }).yeu_cau ?? ""); } catch {}
    const reply = (output: string) => {
      if (closed) return;
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } });
      followUps++;
      send({ type: "response.create" });
    };
    if (name !== "giao_viec" || !req.trim() || !h.onTask) { reply(JSON.stringify({ loi: "Không giao được việc này." })); return; }
    h.onTask(req.trim()).then((tom_tat) => reply(JSON.stringify({ tom_tat })), (e) => reply(JSON.stringify({ loi: String((e as Error)?.message ?? e) })));
  };

  ws.onopen = () => { open = true; set("listen"); };
  ws.onmessage = (ev) => {
    let m: { type: string; delta?: string; transcript?: string; error?: { message?: string }; call_id?: string; name?: string; arguments?: string; item?: { type?: string; call_id?: string; name?: string; arguments?: string } };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    switch (m.type) {
      case "input_audio_buffer.speech_started":
        // Người dùng nói chen (máy chủ xác nhận): dừng giọng đang phát.
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
      case "response.function_call_arguments.done":
        onCall(m.call_id, m.name, m.arguments); break;
      case "response.output_item.done":
        if (m.item?.type === "function_call") onCall(m.item.call_id, m.item.name, m.item.arguments);
        break;
      case "response.done":
        responseDone = true;
        if (delegated) delegated = false;
        else if (followUps > 0) followUps--;
        else if (aiText.trim()) h.onTurn(userText, aiText.trim());
        userText = "";
        if (!playing.size) set("listen");
        break;
      case "error":
        h.onError(m.error?.message ?? "Lỗi kết nối giọng nói"); break;
    }
  };
  ws.onerror = () => h.onError("Mất kết nối tới máy chủ giọng nói");
  ws.onclose = () => { if (!closed) h.onClose(); };

  // Mức âm lượng cho hiệu ứng sóng, kèm VAD nói chen khi đang phát.
  const md = new Uint8Array(new ArrayBuffer(micAn.fftSize)), od = new Uint8Array(new ArrayBuffer(outAn.fftSize));
  const vad = createVad({ floor: 0.14 });
  let raf = 0, wasPlaying = false;
  const rms = (an: AnalyserNode, d: Uint8Array<ArrayBuffer>) => { an.getByteTimeDomainData(d); let s = 0; for (const b of d) s += ((b - 128) / 128) ** 2; return Math.min(1, Math.sqrt(s / d.length) * 4); };
  const tick = () => {
    const now = performance.now();
    const mic = opts.muted() ? 0 : rms(micAn, md), out = rms(outAn, od);
    opts.micLevel.current = mic; opts.outLevel.current = out;
    const isPlaying = playing.size > 0;
    if (isPlaying && !wasPlaying) vad.reset(now);
    wasPlaying = isPlaying;
    if (isPlaying && !ducked && opts.barge?.() !== false && vad.feed(mic, now, out)) { ducked = now; gainTo(DUCK); }
    if (ducked && now - ducked > DUCK_WAIT) { unduck(); vad.reset(now); }
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    interrupt: () => { stopPlayback(); send({ type: "response.cancel" }); set("listen"); },
    close: () => {
      closed = true; cancelAnimationFrame(raf); stopPlayback();
      try { ws.close(); } catch {}
      cap.port.onmessage = null; src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {});
      opts.micLevel.current = 0; opts.outLevel.current = 0;
    },
  };
}
