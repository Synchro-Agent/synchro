"use client";
// Phim giới thiệu Synchro (42 giây, dự án synchro-launch-film) cho tài khoản mới: phát một lần ngay sau lời chào "Welcome to Synchro, …".
// - Vào: vòng tròn của logo ở lời chào nở ra phủ kín màn hình bằng đúng màu nền của phim (#0e0e0b), phim hiện dần trên nền đó, tiếng to dần.
// - Ra (hết phim, Bỏ qua, Esc): tiếng nhỏ dần; khung hình đang hiện tách đôi như logo — hai nửa lệch pha (trái lên, phải xuống) rồi trượt
//   khỏi màn hình — mở ra giao diện chính đang lắng xuống bên dưới.
// - Phụ đề tiếng Việt cho các dòng chữ tiếng Anh trong phim (giao diện tiếng Việt), nằm trong dải đen dưới phim nếu có chỗ.
// - Trình duyệt chặn tự phát có tiếng: phát không tiếng, hiện nút Bật tiếng. Giảm chuyển động: không tự phát, không nở / tách, chỉ mờ dần.
// - Bản 720p (4 MB) cho màn hẹp / tiết kiệm dữ liệu, 1080p (18 MB) cho màn lớn; tải trước từ lúc hiện lời chào (preloadIntro).
import { useEffect, useRef, useState } from "react";
import { Loader } from "./brand";
import { getLang } from "./i18n";

const BG = "#0e0e0b"; // nền phim sau khi nén (Carbon #111210 + grain)
const VOLUME = 0.9;
const SEEN = (uid: string) => `synchro:intro-seen:${uid}`;
const L = (vi: string, en: string) => (getLang() === "vi" ? vi : en);
const reducedMotion = () => typeof window !== "undefined" && (document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches);

/** Tài khoản vừa tạo (đăng ký bằng email, hoặc vừa điền hồ sơ lần đầu sau khi đăng nhập Google / GitHub / Apple) và chưa xem phim trên máy này. */
export function wantsIntro(u: { id: string; createdAt: number }, kind: string) {
  const fresh = kind === "signup" || (kind === "profile" && Date.now() - u.createdAt < 2 * 3600_000);
  try { return fresh && !localStorage.getItem(SEEN(u.id)); } catch { return fresh; }
}

// Một thẻ video dùng chung: tải từ lúc hiện lời chào, màn phim gắn chính thẻ này vào nên phần đã tải không mất.
let shared: HTMLVideoElement | null = null;
export function preloadIntro() {
  if (shared || typeof document === "undefined") return shared;
  const v = document.createElement("video");
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const small = innerWidth < 900 || innerHeight < 560 || !!conn?.saveData;
  v.src = small ? "/intro/synchro-intro-720.mp4" : "/intro/synchro-intro.mp4";
  v.preload = "auto";
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.className = "intro-v";
  v.load();
  shared = v;
  return v;
}

// Phụ đề tiếng Việt [bắt đầu, kết thúc (giây), [phụ đề, dòng tiếng Anh gốc trong phim], đặt trên cùng]: theo nhịp của phim
// (150 BPM, 1 phách = 0,4 s; src/timeline.ts). Chỉ hiện khi giao diện tiếng Việt (phim vốn bằng tiếng Anh).
const CAPS: [number, number, [string, string], boolean?][] = [
  [2.0, 4.5, ["ChatGPT, Gemini và Claude của bạn: đăng nhập bằng chính tài khoản của bạn, một Synchro cho cả ba.", "Your ChatGPT, Gemini and Claude. Sign in with your own accounts. One Synchro for all three."]],
  [4.6, 5.9, ["Mọi công cụ, mọi gói: trình duyệt, tiện ích Chrome, Skills và Connectors chạy cả trên gói miễn phí.", "Every tool. Every plan. Browser, Extension, Skills and Connectors work even on free plans."]],
  [6.2, 8.4, ["“Lên kế hoạch cuối tuần ở Kyoto dưới 900 đô và báo cho Mai.”", "“Plan my Kyoto weekend under $900 and tell Mai.”"]],
  [9.3, 14.1, ["Chrome của bạn, tự lái: tiện ích Synchro tự bấm, tự gõ, tự đặt chỗ.", "Your Chrome, on autopilot. The Synchro extension clicks, types and books by itself."], true],
  [14.3, 18.2, ["Rồi thêm vào lịch và nhắn cho Mai.", "Then it adds the trip to your calendar and texts Mai."]],
  [18.6, 19.6, ["Xong: vé máy bay, khách sạn, lịch và tin nhắn.", "Done: flight, hotel, calendar and message."]],
  [20.0, 23.9, ["Chạy cả khi bạn ngủ: giao việc một lần, Hộp thư chạy theo lịch trên máy chủ Synchro, kể cả khi bạn gập máy.", "Runs while you sleep. Hand off a job once. Inbox runs it on schedule on Synchro's server, even with your laptop closed."]],
  [24.0, 25.9, ["Synchro Code: không gian làm việc thật với terminal, trình duyệt, git và pull request.", "Synchro Code. A real workspace: terminal, browser, git and pull requests."]],
  [26.0, 27.9, ["Skills & Connectors: kết nối ứng dụng của bạn, Synchro tự chọn skill hợp với việc.", "Skills & Connectors. Plug in your apps. Synchro picks the right skill for the job."]],
  [28.0, 30.4, ["Speech: giọng đọc, đổi giọng và trợ lý giọng nói, chạy bằng ElevenLabs.", "Speech. Voices, voice changer and voice agents, powered by ElevenLabs."]],
  [30.5, 31.8, ["Bộ não: một trí nhớ dùng chung cho Claude, ChatGPT và Gemini.", "The Brain. One memory, shared by Claude, ChatGPT and Gemini."]],
  [31.8, 33.0, ["1 · Học từ mọi đoạn chat.", "1 · Learns from every chat."]],
  [33.0, 34.2, ["2 · Tự chăm sóc chính nó.", "2 · Tends itself."]],
  [34.2, 35.8, ["3 · Đổi model, Synchro vẫn nhớ bạn.", "3 · Switch models. It still knows you."]],
  [39.6, 42.5, ["Trợ lý AI của bạn. Mọi nơi, mọi lúc.", "Your AI agent. Anywhere, anytime."]],
];

// Tiếng to / nhỏ dần (iOS không cho đổi âm lượng: bỏ qua, vẫn chạy đúng thời gian).
function fade(v: HTMLVideoElement, to: number, ms: number) {
  return new Promise<void>((done) => {
    const from = v.volume, t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      try { v.volume = from + (to - from) * k; } catch {}
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

type Phase = "iris" | "ask" | "wait" | "play" | "out";

/**
 * Màn phim phủ toàn màn hình (trên cả màn đăng nhập). onCovered: màn hình đã phủ kín màu nền phim (gỡ màn đăng nhập phía dưới);
 * onReveal: khung hình bắt đầu tách đôi (app bên dưới lắng xuống); onDone: xong hẳn.
 */
export function IntroFilm({ uid, onCovered, onReveal, onDone }: { uid: string; onCovered: () => void; onReveal: () => void; onDone: () => void }) {
  const reduced = useRef(reducedMotion()).current;
  const [phase, setPhase] = useState<Phase>(reduced ? "ask" : "iris");
  const [shown, setShown] = useState(false); // phim đã hiện (mờ dần lên)
  const [muted, setMuted] = useState(false);
  const [needSound, setNeedSound] = useState(false); // trình duyệt chặn tiếng: hiện nút Bật tiếng
  const [paused, setPaused] = useState(false);
  const [skip, setSkip] = useState(false); // nút Bỏ qua hiện sau 1,2 giây
  const [cap, setCap] = useState<(typeof CAPS)[number] | null>(null);
  const [capBottom, setCapBottom] = useState<number | null>(null); // dải đen dưới phim đủ chỗ cho phụ đề: khoảng cách tới đáy
  const [shot, setShot] = useState(""); // khung hình lúc tách đôi
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), iris = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null), skipBtn = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const leaving = useRef(false);
  const cb = useRef({ onCovered, onReveal, onDone });
  cb.current = { onCovered, onReveal, onDone };
  const vi = getLang() === "vi";

  // Gắn thẻ video đã tải trước; theo dõi tiến độ (thanh mảnh dưới đáy + phụ đề) không qua state cho mượt.
  useEffect(() => {
    const v = preloadIntro()!;
    video.current = v;
    host.current?.appendChild(v);
    v.muted = false; v.volume = 0;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime, d = v.duration || 42.4;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, t / d)})`;
      if (vi) { const c = CAPS.find(([a, b]) => t >= a && t < b) ?? null; setCap((p) => (p === c ? p : c)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ended = () => leave();
    const failed = () => leave();
    v.addEventListener("ended", ended); v.addEventListener("error", failed);
    const vis = () => { if (leaving.current) return; if (document.hidden) v.pause(); else if (!pausedRef.current && phaseRef.current === "play") v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); v.removeEventListener("ended", ended); v.removeEventListener("error", failed); document.removeEventListener("visibilitychange", vis); v.pause(); v.remove(); shared = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const pausedRef = useRef(paused); pausedRef.current = paused;

  // Phụ đề: trong dải đen dưới phim nếu cao ≥ 60px, không thì nổi trên phim.
  useEffect(() => {
    const fit = () => { const h = innerWidth * 9 / 16, band = (innerHeight - h) / 2; setCapBottom(band >= 60 ? band / 2 : null); };
    fit(); addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  // Vào: vòng tròn của logo ở lời chào nở ra phủ kín màn hình.
  useEffect(() => {
    if (phase !== "iris") return;
    const mark = document.querySelector(".auth-root .auth-mark")?.getBoundingClientRect();
    const x = mark ? mark.left + mark.width / 2 : innerWidth / 2, y = mark ? mark.top + mark.height / 2 : innerHeight / 2;
    const r0 = mark ? Math.max(8, Math.min(mark.width, mark.height) / 2) : 0, r1 = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
    const a = iris.current?.animate([{ clipPath: `circle(${r0}px at ${x}px ${y}px)` }, { clipPath: `circle(${r1}px at ${x}px ${y}px)` }],
      { duration: 1000, easing: "cubic-bezier(.65,0,.35,1)", fill: "forwards" });
    const go = () => { try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} cb.current.onCovered(); setPhase("wait"); };
    if (a) a.onfinish = go; else go();
    return () => { if (a) a.onfinish = null; };
  }, [phase, uid]);

  // Chờ đủ dữ liệu rồi phát: phim hiện dần, tiếng to dần. Bị chặn tiếng thì phát không tiếng.
  useEffect(() => {
    if (phase !== "wait") return;
    const v = video.current!;
    let off = false;
    const start = async () => {
      if (off) return;
      v.muted = false; v.volume = 0;
      try { await v.play(); }
      catch { v.muted = true; setMuted(true); setNeedSound(true); try { await v.play(); } catch { return leave(); } }
      if (off) return;
      setPhase("play"); setShown(true);
      if (!v.muted) fade(v, VOLUME, 700);
    };
    if (v.readyState >= 3) start(); else v.addEventListener("canplay", start, { once: true });
    return () => { off = true; v.removeEventListener("canplay", start); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "play") return;
    const t = setTimeout(() => setSkip(true), 1200);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => { if (skip) skipBtn.current?.focus({ preventScroll: true }); }, [skip]);

  // Ra: tiếng nhỏ dần, chụp khung hình đang hiện rồi tách đôi; app bên dưới lắng xuống cùng lúc.
  async function leave() {
    if (leaving.current) return;
    leaving.current = true;
    const v = video.current!;
    let img = "";
    try {
      if (v.videoWidth && v.readyState >= 2) {
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d")!.drawImage(v, 0, 0);
        img = c.toDataURL("image/jpeg", 0.9);
      }
    } catch {}
    setShot(img);
    setPhase("out");
    cb.current.onReveal();
    if (!v.paused && !v.muted) fade(v, 0, 450).then(() => v.pause()); else v.pause();
    setTimeout(() => cb.current.onDone(), reduced ? 600 : 1250);
  }

  // Bàn phím: Esc / Enter bỏ qua, Space tạm dừng.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (phase === "out") return;
      if (e.key === "Escape") { e.preventDefault(); if (phase === "play" || phase === "wait") leave(); }
      else if (e.key === " " && phase === "play" && !(e.target as HTMLElement)?.closest?.("button")) { e.preventDefault(); toggle(); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  const toggle = () => {
    const v = video.current!;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };
  const sound = () => {
    const v = video.current!;
    if (v.muted) { v.muted = false; v.volume = 0; fade(v, VOLUME, 300); setMuted(false); setNeedSound(false); }
    else { v.muted = true; setMuted(true); }
  };
  const watch = () => { onCovered(); try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} setPhase("wait"); };

  const half = (side: "l" | "r") => (
    <div className={`intro-h ${side}`}>
      <div className="intro-hi" style={{ backgroundImage: shot ? `url(${shot})` : undefined }} />
    </div>
  );
  return (
    <div ref={root} className={`intro ${reduced ? "reduced" : ""}`} data-phase={phase} role="dialog" aria-modal="true" aria-label={L("Phim giới thiệu Synchro", "Synchro intro film")} style={{ ["--intro-bg" as string]: BG }}>
      {!reduced && phase === "iris" && <div ref={iris} className="intro-iris" style={{ clipPath: "circle(0px at 50% 50%)" }} />}
      <div className={`intro-stage ${phase === "out" ? "gone" : ""}`} onClick={() => { if (phase === "play") toggle(); }}>
        <div ref={host} className={`intro-host ${shown ? "on" : ""}`} />
        {phase === "wait" && <div className="intro-load"><Loader size={34} label={L("Đang tải phim", "Loading the film")} /></div>}
        {phase === "ask" && (
          <div className="intro-ask" onClick={(e) => e.stopPropagation()}>
            <img src="/intro/synchro-intro-poster.jpg" alt="" />
            <div className="intro-ask-a">
              <button type="button" className="intro-btn pri" onClick={watch}>{L("Xem phim giới thiệu (42 giây)", "Watch the intro (42 seconds)")}</button>
              <button type="button" className="intro-btn" onClick={() => { onCovered(); try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} leave(); }}>{L("Vào Synchro", "Go to Synchro")}</button>
            </div>
          </div>
        )}
        {paused && phase === "play" && <div className="intro-paused" aria-hidden><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg></div>}
      </div>
      {cap && (phase === "play" || phase === "out") && (
        <p key={cap[0]} className={`intro-cap ${cap[3] ? "top" : capBottom === null ? "over" : "band"} ${phase === "out" ? "fade" : ""}`} style={!cap[3] && capBottom !== null ? { bottom: capBottom } : undefined} data-notr>{cap[2][0]}</p>
      )}
      {(phase === "play" || phase === "wait" || (phase === "out" && !reduced)) && (
        <div className={`intro-ui ${phase === "out" ? "fade" : ""}`}>
          <button ref={skipBtn} type="button" className={`intro-btn skip ${skip || phase === "wait" ? "on" : ""}`} disabled={phase === "out"} onClick={() => leave()}>
            {L("Bỏ qua", "Skip")}<svg viewBox="0 0 20 20" aria-hidden><path d="M8 5l5 5-5 5" /></svg>
          </button>
          {needSound
            ? <button type="button" className="intro-btn sound-need" onClick={sound}>{L("Bật tiếng", "Turn on sound")}</button>
            : phase === "play" && <button type="button" className="intro-btn snd" aria-label={muted ? L("Bật tiếng", "Turn on sound") : L("Tắt tiếng", "Mute")} onClick={sound}>
                <svg viewBox="0 0 20 20" aria-hidden><path d="M3.5 8h2.6L10 4.8v10.4L6.1 12H3.5z" />{muted ? <path d="M13 8l4 4M17 8l-4 4" /> : <path d="M13.2 7.2a4 4 0 010 5.6M15.4 5a7 7 0 010 10" />}</svg>
              </button>}
          <div className="intro-bar"><div ref={bar} /></div>
        </div>
      )}
      {phase === "out" && !reduced && <div className="intro-split">{half("l")}{half("r")}</div>}
    </div>
  );
}
