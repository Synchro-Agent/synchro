"use client";
// Chế độ trò chuyện bằng giọng nói: làm mờ toàn màn hình, chỉ còn sóng Siri.
// Không có nút chọn ngôn ngữ: nói tiếng nào thì Synchro nhận ra tiếng đó (ElevenLabs tự nhận từng câu) và trả lời, đọc bằng đúng tiếng đó.
// Mặc định dùng Eleven Realtime v1 Max (máy chủ cấp khoá tạm): tự nhận ngôn ngữ, trả lời bằng giọng ElevenLabs, nói chen được.
// Không mở được Realtime (hết phút của gói, khóa thiếu quyền) nhưng có ElevenLabs: chế độ nối tiếp, Scribe nghe → model chat → giọng ElevenLabs đọc.
// Khi máy chủ chưa có khoá ElevenLabs: dự phòng bằng nhận dạng giọng nói + đọc to của trình duyệt, câu hỏi đi qua model chat.
// Hai luồng: nói ngay một câu xác nhận, việc chính chạy trong khung chat; xong thì đọc bản tóm tắt vài câu (bản đầy đủ ở khung chat).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { getLang } from "./i18n";
import { usePref } from "./store";
import { SiriWave, startMicLevel, useSpeakingLevel } from "./voicefx";
import { startRealtime, type RtPhase } from "./realtime";
import { startScribe, type Scribe } from "./scribe";
import { elSpeed, speakAI, type Speaking } from "./speak";
import { createVad } from "./vad";
import { ACK_DELAY, ackPlan, localBrief, spokenPlan, toSpeech, VI, type Lang } from "./voiceflow";

type Phase = "connecting" | "listen" | "think" | "work" | "speak" | "paused";
type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; start: () => void; stop: () => void; abort: () => void };
// Việc đang làm: câu hỏi, lúc gửi, ngôn ngữ; done (chế độ realtime) nhận lời tóm tắt để model giọng nói đọc.
type Job = { id: number; q: string; at: number; lang: Lang; done?: (brief: string) => void; ackT?: number };
// Mã ngôn ngữ ElevenLabs nhận ra ("vi", "en", "ja"…) → ngôn ngữ của câu xác nhận / câu nhắc (tiếng khác: đoán theo chữ).
const known = (l: string | null | undefined, q: string): Lang => (l === "vi" || l === "en" ? l : VI.test(q) ? "vi" : "en");

const LABEL: Record<Phase, string> = { connecting: "Đang kết nối…", listen: "Đang nghe…", think: "Đang suy nghĩ…", work: "Đang làm việc…", speak: "Đang trả lời…", paused: "Đã tắt micro" };
const JOB_MAX = 180_000;

async function briefOf(q: string, answer: string, lang: Lang): Promise<string> {
  try {
    const r = await fetch("/api/voice/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, answer }) });
    const j = await r.json();
    if (r.ok && typeof j.brief === "string" && j.brief.trim()) return j.brief.trim();
  } catch {}
  return localBrief(answer, lang);
}

export function VoiceMode({ onClose, onAsk, onTurn, busy, reply, rate, voice, say }: {
  onClose: () => void; onAsk: (t: string) => void; onTurn: (user: string, ai: string) => void; busy: boolean; reply: { text: string; time: number } | null;
  rate: number; voice?: string; say: (m: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("connecting");
  // rt: Eleven Realtime; ai: Scribe + giọng ElevenLabs (nối tiếp); browser: giọng của trình duyệt.
  const [mode, setMode] = useState<"rt" | "ai" | "browser" | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [working, setWorking] = useState(false);
  const [out, setOut] = useState(false);
  // Ngôn ngữ của câu người dùng nói gần nhất (chỉ dùng cho nhận dạng của trình duyệt khi không có ElevenLabs).
  const lastLang = useRef<Lang>(getLang() === "en" ? "en" : "vi");
  const [barge, setBarge] = usePref("vmBarge", true);
  const micLv = useRef(0), aiLv = useRef(0);
  const level = useMemo(() => ({ get current() { return Math.max(micLv.current, aiLv.current); }, set current(_v: number) {} }), []);
  const rt = useRef<Awaited<ReturnType<typeof startRealtime>> | null>(null);
  const turnRef = useRef(onTurn);
  turnRef.current = onTurn;
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  const mutedRef = useRef(false);
  const bargeRef = useRef(barge);
  bargeRef.current = barge;
  const recRef = useRef<Rec | null>(null);
  const job = useRef<Job | null>(null);
  const gen = useRef(0);
  const alive = useRef(true);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  useSpeakingLevel(mode === "browser" && phase === "speak", aiLv);
  const scribe = useRef<Scribe | null>(null);
  const voiceOut = useRef<Speaking | null>(null);
  const stopVoice = () => { voiceOut.current?.stop(); voiceOut.current = null; window.speechSynthesis?.cancel(); };

  const close = () => { setOut(true); job.current?.done?.(""); job.current = null; stopVoice(); recRef.current?.abort(); scribe.current?.stop(); scribe.current = null; rt.current?.close(); rt.current = null; setTimeout(onClose, 220); };

  // ---- Việc chính (luồng thứ hai) ----
  // Gửi câu hỏi vào khung chat; chế độ trình duyệt thì nói câu xác nhận (ngay nếu là việc cần làm, hoặc khi trả lời lâu hơn 1,2 giây).
  const startJob = (q: string, done?: (brief: string) => void, heardLang?: string | null) => {
    const l = known(heardLang, q);
    lastLang.current = l;
    // Ngôn ngữ khác tiếng Việt / tiếng Anh: không đọc câu xác nhận có sẵn (model sẽ trả lời bằng đúng tiếng đó).
    const other = !!heardLang && heardLang !== "vi" && heardLang !== "en";
    const plan = ackPlan(q, l);
    const j: Job = { id: ++gen.current, q, at: Date.now(), lang: plan.lang, done };
    job.current = j;
    setHeard(q); setCaption("");
    if (done) setWorking(true); else go("think");
    askRef.current(q);
    if (!done && !other) {
      const ack = () => { if (job.current === j && phaseRef.current === "think") speak([plan.text], plan.lang, () => { if (job.current === j && phaseRef.current === "speak") go("work"); }); };
      if (plan.now) ack(); else j.ackT = window.setTimeout(ack, ACK_DELAY);
    }
  };
  // Câu trả lời đầy đủ đã xong: ngắn thì đọc nguyên văn, dài hoặc có sản phẩm thì đọc bản tóm tắt.
  useEffect(() => {
    const j = job.current;
    if (!j || busy || !reply || reply.time < j.at || !reply.text.trim()) return;
    job.current = null;
    clearTimeout(j.ackT);
    (async () => {
      const direct = spokenPlan(reply.text) === "direct";
      const text = direct ? toSpeech(reply.text).join(" ") : await briefOf(j.q, reply.text, j.lang);
      if (!alive.current || gen.current !== j.id) return;
      if (j.done) { setWorking(false); j.done(text); return; }
      speak(toSpeech(text), VI.test(text) ? "vi" : j.lang, () => { if (alive.current && phaseRef.current === "speak") { setCaption(""); go("listen"); } });
    })();
  }, [busy, reply]); // eslint-disable-line react-hooks/exhaustive-deps
  // Việc chạy quá lâu (lỗi mạng…): thôi chờ để không kẹt, kết quả vẫn hiện trong khung chat khi xong.
  useEffect(() => {
    if (phase !== "work" && phase !== "think" && !working) return;
    const t = setTimeout(() => {
      const j = job.current;
      if (!j || Date.now() - j.at < JOB_MAX) return;
      job.current = null;
      const m = j.lang === "en" ? "This is taking longer than expected. The answer will appear in the chat." : "Việc này lâu hơn dự kiến, kết quả sẽ hiện trong khung chat.";
      if (j.done) { setWorking(false); j.done(m); } else speak([m], j.lang, () => { if (alive.current) go("listen"); });
    }, JOB_MAX + 500);
    return () => clearTimeout(t);
  }, [phase, working]);

  // Đọc to: chế độ nối tiếp dùng giọng ElevenLabs (xếp hàng sau câu đang đọc); không được thì giọng của trình duyệt.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const speak = (chunks: string[], l: Lang, onEnd: () => void) => {
    if (modeRef.current === "ai" && chunks.length) {
      go("speak");
      const my = gen.current;
      queue.current = queue.current.then(async () => {
        if (!alive.current || gen.current !== my) return;
        const text = chunks.join(" ");
        setCaption(text);
        const v = await speakAI(text, { voice, speed: elSpeed(rate), level: aiLv });
        if (!v) { browserSpeak(chunks, l, onEnd); return; }
        voiceOut.current = v;
        const ok = await v.done;
        if (voiceOut.current === v) voiceOut.current = null;
        if (ok && alive.current && gen.current === my) onEnd();
      });
      return;
    }
    browserSpeak(chunks, l, onEnd);
  };
  const browserSpeak = (chunks: string[], l: Lang, onEnd: () => void) => {
    const s = window.speechSynthesis;
    if (!s || !chunks.length) { onEnd(); return; }
    const voice = s.getVoices().find((v) => v.lang.toLowerCase().startsWith(l));
    go("speak");
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = l === "vi" ? "vi-VN" : "en-US"; u.rate = rate; if (voice) u.voice = voice;
      u.onstart = () => setCaption(c);
      if (i === chunks.length - 1) u.onend = onEnd;
      s.speak(u);
    });
  };

  // Chọn chế độ: xin khoá tạm từ máy chủ; có khoá thì nối Eleven Realtime, không thì dùng trình duyệt.
  // dead: cờ riêng của từng lần gắn (React có thể gắn lại khung này), để kết nối mở dở của lần trước không sống song song.
  useEffect(() => {
    alive.current = true;
    let dead = false;
    (async () => {
      const s = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice }) }).then((r) => r.json()).catch(() => ({ fallback: true }));
      if (dead) return;
      if (s.value) {
        try {
          const conn = await startRealtime({ url: s.url, model: s.model, secret: s.value, micLevel: micLv, outLevel: aiLv, muted: () => mutedRef.current, barge: () => bargeRef.current }, {
            onPhase: (p: RtPhase) => !dead && setPhase((cur) => (cur === "paused" ? cur : p)),
            onCaption: (t) => !dead && setCaption(t),
            onUser: (t) => !dead && setHeard(t),
            onTurn: (u, a) => !dead && turnRef.current(u, a),
            // Đang làm việc trước thì báo lại để model giọng nói nói với người dùng, không chồng hai việc.
            onTask: (q) => new Promise<string>((done) => {
              if (dead) return done("");
              if (job.current) return done("Synchro còn đang làm việc trước đó; hãy nhờ lại sau khi xong.");
              startJob(q, done);
            }),
            onError: (m) => !dead && say(m),
            onClose: () => !dead && close(),
          });
          if (dead) { conn.close(); return; }
          rt.current = conn;
          setMode("rt");
          return;
        } catch { if (!dead) { say("Synchro cần quyền dùng micro để trò chuyện bằng giọng nói"); setMode("rt"); setPhase("paused"); } return; }
      }
      if (s.error) say(s.error);
      setMode(s.cascade ? "ai" : "browser"); setPhase("listen");
    })();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", h, true);
    return () => { dead = true; alive.current = false; window.removeEventListener("keydown", h, true); recRef.current?.abort(); scribe.current?.stop(); scribe.current = null; stopVoice(); rt.current?.close(); rt.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Chế độ nối tiếp (Scribe + giọng ElevenLabs) ----
  useEffect(() => {
    if (mode !== "ai") return;
    let dead = false;
    startScribe({ level: micLv }, {
      onPartial: (t) => { if (phaseRef.current === "listen") setHeard(t); },
      onCommit: (t, l) => { if (phaseRef.current === "listen" && t.trim()) startJob(t.trim(), undefined, l); },
      onError: (m) => say(m),
    }).then((x) => {
      if (dead) { x?.stop(); return; }
      if (!x) { setMode("browser"); return; }
      scribe.current = x;
    }).catch(() => { if (!dead) { say("Synchro cần quyền dùng micro để trò chuyện bằng giọng nói"); go("paused"); } });
    return () => { dead = true; scribe.current?.stop(); scribe.current = null; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Chỉ gửi âm thanh lên khi đang nghe (tránh chép lại chính giọng Synchro đang đọc).
  useEffect(() => { scribe.current?.pause(mode === "ai" && phase !== "listen"); }, [phase, mode]);

  // ---- Chế độ trình duyệt ----
  const listen = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
    if (!SR) { say("Trình duyệt này chưa hỗ trợ nhận dạng giọng nói (hãy dùng Chrome, Edge hoặc Safari)"); close(); return; }
    recRef.current?.abort();
    const r = new SR();
    r.lang = lastLang.current === "en" ? "en-US" : "vi-VN"; r.interimResults = true; r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; }
      setHeard(t);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      say(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Synchro cần quyền dùng micro để trò chuyện bằng giọng nói" : "Trình duyệt chưa nhận dạng được giọng nói, hãy thử lại");
      go("paused");
    };
    r.onend = () => {
      if (!alive.current || phaseRef.current !== "listen") return;
      const q = finalText.trim();
      if (q) startJob(q);
      else listen();
    };
    recRef.current = r;
    setHeard("");
    try { r.start(); } catch {}
  };

  useEffect(() => {
    if (mode !== "browser") return;
    if (phase !== "listen") { if (phase === "think" || phase === "work") aiLv.current = 0.08; return; }
    let stop: (() => void) | null = null, dead = false;
    startMicLevel(micLv).then((s) => { if (dead) s(); else stop = s; }).catch(() => {});
    listen();
    return () => { dead = true; stop?.(); };
  }, [phase, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nói chen để ngắt (chế độ trình duyệt): đo micro trong lúc đọc, VAD tại chỗ phát hiện người dùng nói trong ~150 ms.
  // Giọng đọc của trình duyệt không đo được nên ngưỡng học theo tiếng vọng nghe thấy lúc mới đọc.
  useEffect(() => {
    if ((mode !== "browser" && mode !== "ai") || phase !== "speak" || !barge) return;
    let stop: (() => void) | null = null, dead = false, raf = 0;
    const vad = createVad({ floor: 0.18, calibMs: 500 });
    const mic = { current: 0 };
    startMicLevel(mic).then((s) => {
      if (dead) { s(); return; }
      stop = s;
      const tick = (t: number) => { if (vad.feed(mic.current, t)) { interrupt(); return; } micLv.current = mic.current; raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }).catch(() => {});
    return () => { dead = true; cancelAnimationFrame(raf); stop?.(); micLv.current = 0; };
  }, [phase, mode, barge]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ngắt lời: dừng đọc và nghe tiếp. Kết quả của việc đang chờ không đọc nữa (vẫn có trong khung chat).
  const interrupt = () => {
    if (phaseRef.current !== "speak") return;
    if (modeRef.current === "rt") rt.current?.interrupt();
    else {
      const j = job.current;
      if (j) { clearTimeout(j.ackT); job.current = null; }
      gen.current++;
      stopVoice(); go("listen");
    }
    setCaption("");
  };
  const toggleMic = () => {
    if (mode === "rt") { mutedRef.current = !mutedRef.current; setPhase(mutedRef.current ? "paused" : "listen"); return; }
    if (phase === "paused") go("listen"); else { recRef.current?.abort(); stopVoice(); setCaption(""); go("paused"); }
  };

  // Chế độ realtime: model giọng nói đã xác nhận, Synchro đang làm việc chính trong lúc chờ.
  const shown: Phase = working && (phase === "listen" || phase === "think") ? "work" : phase;
  return createPortal(
    <div className={`vm ${out ? "out" : ""}`} role="dialog" aria-modal="true" aria-label="Trò chuyện bằng giọng nói">
      <div className="vm-top">
        <span className={`vm-state ${shown}`}><i />{LABEL[shown]}</span>
        {mode && <button className={`vm-opt ${barge ? "on" : ""}`} aria-pressed={barge} onClick={() => setBarge(!barge)} title="Đang trả lời mà bạn nói thì Synchro dừng lại để nghe">Nói chen để ngắt</button>}
      </div>
      <button className="vm-wave" onClick={interrupt} aria-label={phase === "speak" ? "Ngắt lời" : "Sóng giọng nói"} tabIndex={phase === "speak" ? 0 : -1}>
        <SiriWave level={level} />
      </button>
      <div className="vm-cap" aria-live="polite">
        {shown === "connecting" && <p className="hint">Đang mở kết nối giọng nói…</p>}
        {shown === "listen" && (heard ? <p className="me">{heard}</p> : <p className="hint">Hãy nói điều bạn muốn hỏi</p>)}
        {shown === "think" && <p className="me">{heard}</p>}
        {shown === "work" && <><p className="me">{heard}</p><p className="hint">Kết quả đầy đủ sẽ có trong khung chat</p></>}
        {shown === "speak" && <p>{caption}</p>}
        {shown === "paused" && <p className="hint">Bấm micro để tiếp tục</p>}
      </div>
      <div className="vm-ctl">
        <button className={`vm-btn ${phase === "paused" ? "off" : ""}`} onClick={toggleMic} aria-label={phase === "paused" ? "Bật micro" : "Tắt micro"} aria-pressed={phase === "paused"}><I.Mic size={22} /></button>
        <button className="vm-btn end" onClick={close} aria-label="Kết thúc trò chuyện bằng giọng nói"><I.X size={22} /></button>
      </div>
      {phase === "speak" && <span className="vm-tip">{barge ? "Nói chen hoặc chạm vào sóng để ngắt lời" : "Chạm vào sóng để ngắt lời"}</span>}
    </div>,
    document.body,
  );
}
