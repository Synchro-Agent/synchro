"use client";
// Chế độ trò chuyện bằng giọng nói: làm mờ toàn màn hình, chỉ còn sóng Siri. Nghe → gửi câu hỏi vào đoạn chat
// → chờ trả lời → đọc to → nghe tiếp. Chạm vào sóng để ngắt lời, Esc hoặc nút X để thoát.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { SiriWave, startMicLevel, useSpeakingLevel } from "./voicefx";

type Phase = "listen" | "think" | "speak" | "paused";
type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; start: () => void; stop: () => void; abort: () => void };

const LABEL: Record<Phase, string> = { listen: "Đang nghe…", think: "Đang suy nghĩ…", speak: "Đang trả lời…", paused: "Đã tắt micro" };

// Bỏ ký hiệu Markdown và khối code trước khi đọc, rồi chia câu để trình duyệt đọc trọn câu dài.
function toSpeech(md: string) {
  const plain = md.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_~|]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = plain.match(/[^.!?。…]+[.!?。…]*\s*/g) ?? [plain];
  const out: string[] = [];
  for (const s of parts) { if (out.length && (out[out.length - 1] + s).length < 180) out[out.length - 1] += s; else out.push(s); }
  return out.filter((x) => x.trim());
}

export function VoiceMode({ onClose, onAsk, busy, reply, lang, rate, say }: {
  onClose: () => void; onAsk: (t: string) => void; busy: boolean; reply: { text: string; time: number } | null;
  lang: string; rate: number; say: (m: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("listen");
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [out, setOut] = useState(false);
  const level = useRef(0);
  const recRef = useRef<Rec | null>(null);
  const askedAt = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useSpeakingLevel(phase === "speak", level);

  const close = () => { setOut(true); window.speechSynthesis?.cancel(); recRef.current?.abort(); setTimeout(onClose, 220); };

  // Nghe một lượt nói; im lặng hoặc lỗi nhẹ thì nghe lại.
  const listen = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
    if (!SR) { say("Trình duyệt này chưa hỗ trợ nhận dạng giọng nói (hãy dùng Chrome, Edge hoặc Safari)"); close(); return; }
    recRef.current?.abort();
    const r = new SR();
    r.lang = lang; r.interimResults = true; r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; }
      setHeard(t);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      say(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Synchro cần quyền dùng micro để trò chuyện bằng giọng nói" : "Trình duyệt chưa nhận dạng được giọng nói, hãy thử lại");
      phaseRef.current = "paused"; setPhase("paused");
    };
    r.onend = () => {
      if (!alive.current || phaseRef.current !== "listen") return;
      const q = finalText.trim();
      if (q) { askedAt.current = Date.now(); setPhase("think"); onAsk(q); }
      else listen();
    };
    recRef.current = r;
    setHeard("");
    try { r.start(); } catch {}
  };

  // Âm lượng micro cho sóng khi đang nghe.
  useEffect(() => {
    if (phase !== "listen") { if (phase === "think") level.current = 0.08; return; }
    let stop: (() => void) | null = null, dead = false;
    startMicLevel(level).then((s) => { if (dead) s(); else stop = s; }).catch(() => {});
    listen();
    return () => { dead = true; stop?.(); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Có câu trả lời mới (đã viết xong) thì đọc to.
  useEffect(() => {
    if (phase !== "think" || busy || !reply || reply.time < askedAt.current - 1000 || !reply.text.trim()) return;
    const s = window.speechSynthesis;
    const chunks = toSpeech(reply.text);
    if (!s || !chunks.length) { setPhase("listen"); return; }
    s.cancel();
    setPhase("speak");
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = lang; u.rate = rate;
      u.onstart = () => setCaption(c);
      if (i === chunks.length - 1) u.onend = () => { if (alive.current && phaseRef.current === "speak") { setCaption(""); setPhase("listen"); } };
      s.speak(u);
    });
  }, [phase, busy, reply, lang, rate]);

  useEffect(() => {
    alive.current = true;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", h, true);
    return () => { alive.current = false; window.removeEventListener("keydown", h, true); recRef.current?.abort(); window.speechSynthesis?.cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const interrupt = () => { if (phase === "speak") { window.speechSynthesis?.cancel(); setCaption(""); setPhase("listen"); } };
  const toggleMic = () => { if (phase === "paused") setPhase("listen"); else { recRef.current?.abort(); window.speechSynthesis?.cancel(); setCaption(""); setPhase("paused"); } };

  return createPortal(
    <div className={`vm ${out ? "out" : ""}`} role="dialog" aria-modal="true" aria-label="Trò chuyện bằng giọng nói">
      <div className="vm-top"><span className={`vm-state ${phase}`}><i />{LABEL[phase]}</span></div>
      <button className="vm-wave" onClick={interrupt} aria-label={phase === "speak" ? "Ngắt lời" : "Sóng giọng nói"} tabIndex={phase === "speak" ? 0 : -1}>
        <SiriWave level={level} />
      </button>
      <div className="vm-cap" aria-live="polite">
        {phase === "listen" && (heard ? <p className="me">{heard}</p> : <p className="hint">Hãy nói điều bạn muốn hỏi</p>)}
        {phase === "think" && <p className="me">{heard}</p>}
        {phase === "speak" && <p>{caption}</p>}
        {phase === "paused" && <p className="hint">Bấm micro để tiếp tục</p>}
      </div>
      <div className="vm-ctl">
        <button className={`vm-btn ${phase === "paused" ? "off" : ""}`} onClick={toggleMic} aria-label={phase === "paused" ? "Bật micro" : "Tắt micro"} aria-pressed={phase === "paused"}><I.Mic size={22} /></button>
        <button className="vm-btn end" onClick={close} aria-label="Kết thúc trò chuyện bằng giọng nói"><I.X size={22} /></button>
      </div>
      {phase === "speak" && <span className="vm-tip">Chạm vào sóng để ngắt lời</span>}
    </div>,
    document.body,
  );
}
