"use client";
// Chế độ trò chuyện bằng giọng nói: làm mờ toàn màn hình, chỉ còn sóng Siri.
// Mặc định dùng Eleven Realtime v1 Max (máy chủ cấp khoá tạm): tự nhận ngôn ngữ, trả lời bằng giọng ElevenLabs, nói chen được.
// Khi máy chủ chưa có khoá ElevenLabs: dự phòng bằng nhận dạng giọng nói + đọc to của trình duyệt, câu hỏi đi qua model chat.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { getLang } from "./i18n";
import { usePref } from "./store";
import { SiriWave, startMicLevel, useSpeakingLevel } from "./voicefx";
import { startRealtime, type RtPhase } from "./realtime";

type Phase = "connecting" | "listen" | "think" | "speak" | "paused";
type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; start: () => void; stop: () => void; abort: () => void };

const LABEL: Record<Phase, string> = { connecting: "Đang kết nối…", listen: "Đang nghe…", think: "Đang suy nghĩ…", speak: "Đang trả lời…", paused: "Đã tắt micro" };
const VI = /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i;

// Bỏ Markdown và khối code trước khi đọc, rồi chia câu để trình duyệt đọc trọn câu dài.
function toSpeech(md: string) {
  const plain = md.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_~|]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = plain.match(/[^.!?。…]+[.!?。…]*\s*/g) ?? [plain];
  const out: string[] = [];
  for (const s of parts) { if (out.length && (out[out.length - 1] + s).length < 180) out[out.length - 1] += s; else out.push(s); }
  return out.filter((x) => x.trim());
}

export function VoiceMode({ onClose, onAsk, onTurn, busy, reply, rate, say }: {
  onClose: () => void; onAsk: (t: string) => void; onTurn: (user: string, ai: string) => void; busy: boolean; reply: { text: string; time: number } | null;
  rate: number; say: (m: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [mode, setMode] = useState<"rt" | "browser" | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [out, setOut] = useState(false);
  const [lang, setLang] = usePref<"vi-VN" | "en-US">("vmLang", getLang() === "en" ? "en-US" : "vi-VN");
  const micLv = useRef(0), aiLv = useRef(0);
  const level = useMemo(() => ({ get current() { return Math.max(micLv.current, aiLv.current); }, set current(_v: number) {} }), []);
  const rt = useRef<Awaited<ReturnType<typeof startRealtime>> | null>(null);
  const turnRef = useRef(onTurn);
  turnRef.current = onTurn;
  const mutedRef = useRef(false);
  const recRef = useRef<Rec | null>(null);
  const askedAt = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useSpeakingLevel(mode === "browser" && phase === "speak", aiLv);

  const close = () => { setOut(true); window.speechSynthesis?.cancel(); recRef.current?.abort(); rt.current?.close(); rt.current = null; setTimeout(onClose, 220); };

  // Chọn chế độ: xin khoá tạm từ máy chủ; có khoá thì nối Eleven Realtime, không thì dùng trình duyệt.
  useEffect(() => {
    alive.current = true;
    (async () => {
      const s = await fetch("/api/voice/session", { method: "POST" }).then((r) => r.json()).catch(() => ({ fallback: true }));
      if (!alive.current) return;
      if (s.value) {
        try {
          rt.current = await startRealtime({ url: s.url, model: s.model, secret: s.value, micLevel: micLv, outLevel: aiLv, muted: () => mutedRef.current }, {
            onPhase: (p: RtPhase) => alive.current && setPhase((cur) => (cur === "paused" ? cur : p)),
            onCaption: (t) => alive.current && setCaption(t),
            onUser: (t) => alive.current && setHeard(t),
            onTurn: (u, a) => turnRef.current(u, a),
            onError: (m) => say(m),
            onClose: () => alive.current && close(),
          });
          if (!alive.current) { rt.current?.close(); return; }
          setMode("rt");
          return;
        } catch { say("Synchro cần quyền dùng micro để trò chuyện bằng giọng nói"); setMode("rt"); setPhase("paused"); return; }
      }
      setMode("browser"); setPhase("listen");
    })();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", h, true);
    return () => { alive.current = false; window.removeEventListener("keydown", h, true); recRef.current?.abort(); window.speechSynthesis?.cancel(); rt.current?.close(); rt.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Chế độ trình duyệt ----
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

  useEffect(() => {
    if (mode !== "browser") return;
    if (phase !== "listen") { if (phase === "think") aiLv.current = 0.08; return; }
    let stop: (() => void) | null = null, dead = false;
    startMicLevel(micLv).then((s) => { if (dead) s(); else stop = s; }).catch(() => {});
    listen();
    return () => { dead = true; stop?.(); };
  }, [phase, mode, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Có câu trả lời mới (đã viết xong) thì đọc to, giọng đọc theo đúng ngôn ngữ của câu trả lời.
  useEffect(() => {
    if (mode !== "browser" || phase !== "think" || busy || !reply || reply.time < askedAt.current - 1000 || !reply.text.trim()) return;
    const s = window.speechSynthesis;
    const chunks = toSpeech(reply.text);
    if (!s || !chunks.length) { setPhase("listen"); return; }
    const vi = VI.test(reply.text);
    const voice = s.getVoices().find((v) => v.lang.toLowerCase().startsWith(vi ? "vi" : "en"));
    s.cancel();
    setPhase("speak");
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = vi ? "vi-VN" : "en-US"; u.rate = rate; if (voice) u.voice = voice;
      u.onstart = () => setCaption(c);
      if (i === chunks.length - 1) u.onend = () => { if (alive.current && phaseRef.current === "speak") { setCaption(""); setPhase("listen"); } };
      s.speak(u);
    });
  }, [phase, busy, reply, rate, mode]);

  const interrupt = () => {
    if (phase !== "speak") return;
    if (mode === "rt") rt.current?.interrupt();
    else { window.speechSynthesis?.cancel(); setPhase("listen"); }
    setCaption("");
  };
  const toggleMic = () => {
    if (mode === "rt") { mutedRef.current = !mutedRef.current; setPhase(mutedRef.current ? "paused" : "listen"); return; }
    if (phase === "paused") setPhase("listen"); else { recRef.current?.abort(); window.speechSynthesis?.cancel(); setCaption(""); setPhase("paused"); }
  };

  return createPortal(
    <div className={`vm ${out ? "out" : ""}`} role="dialog" aria-modal="true" aria-label="Trò chuyện bằng giọng nói">
      <div className="vm-top">
        <span className={`vm-state ${phase}`}><i />{LABEL[phase]}</span>
        {mode === "browser" && (
          <span className="vm-lang" role="group" aria-label="Ngôn ngữ nhận dạng">
            {(["vi-VN", "en-US"] as const).map((l) => <button key={l} className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => { setLang(l); recRef.current?.abort(); }}>{l === "vi-VN" ? "VI" : "EN"}</button>)}
          </span>
        )}
      </div>
      <button className="vm-wave" onClick={interrupt} aria-label={phase === "speak" ? "Ngắt lời" : "Sóng giọng nói"} tabIndex={phase === "speak" ? 0 : -1}>
        <SiriWave level={level} />
      </button>
      <div className="vm-cap" aria-live="polite">
        {phase === "connecting" && <p className="hint">Đang mở kết nối giọng nói…</p>}
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
