"use client";
// Phim giới thiệu Synchro (43 giây, dự án synchro-intro-film, giao diện Instrument) cho tài khoản mới: phát một lần ngay sau lời chào "Welcome to Synchro, …".
// Chuyển cảnh theo "sợi chỉ logo" (ui/handoff.ts): logo không bao giờ bị cắt giữa ba màn đăng nhập → phim → trang chủ.
// - Vào: lời chào mờ lên; vòng tròn kính quanh logo hoá mực, logo đổi sang Ivory; vòng mực nở ra phủ kín màn hình (nền mang đúng vignette
//   của khung đầu phim) trong lúc logo lướt về giữa và thu đúng cỡ chấm mở đầu của phim. Phim bắt đầu ngay dưới chấm đó và chấm của phim
//   lớn lên thành vòng tròn rồi tách thành S: logo của lời chào trở thành cảnh đầu phim, không có khoảng đen nào. Mạng chậm: chấm xoay theo
//   nhịp đồng bộ tới khi có dữ liệu.
// - Ra (hết phim, Bỏ qua, Esc): tiếng nhỏ dần; logo ở khung cuối của phim (vẽ lại đè khít lên phim) ở lại khi phim mờ đi, rồi tách thành
//   hai phần bay theo đường cong về đúng chỗ của chúng trong app — biểu tượng về cạnh lời chào ở trang chủ, chữ "synchro" về đầu thanh bên —
//   đổi dần từ Ivory sang màu chữ của app. Nền phim mở ra thành lỗ tròn từ chỗ biểu tượng hạ cánh; trang chủ lắp lại quanh đó (lời chào mở
//   ra từ chính biểu tượng, như chữ "synchro" mở ra từ mark ở cuối phim). Bỏ qua giữa phim: phim mờ đi, logo hiện lên đúng chỗ đó rồi bay.
// - Phụ đề tiếng Việt cho các dòng chữ tiếng Anh trong phim (giao diện tiếng Việt), nằm trong dải đen dưới phim nếu có chỗ.
// - Trình duyệt chặn tự phát có tiếng: phát không tiếng, hiện nút Bật tiếng. Giảm chuyển động: không tự phát, không nở / tách, chỉ mờ dần.
// - Luôn mở bằng bản 720p (4 MB); lúc hiện lời chào chỉ tải phần đầu tệp (preload="metadata", preloadIntro), phim gắn vào thì mới tải hết.
//   Chỉ khi phim vào chế độ toàn màn hình trên màn lớn (nút Toàn màn hình của phim, màn ≥ 1280px) mới đổi sang bản
//   1080p (19 MB), giữ nguyên vị trí đang phát (blueprint B3.5); bản 1080p tải lỗi thì quay về 720p, phim không dừng.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader, Mark, Wordmark } from "./brand";
import { assemble, boxOf, center, fly as flyTo, markTarget, onScreen, openHole, reducedMotion, settleApp, type Box } from "./handoff";
import { getLang, tr, trc } from "./i18n";
import { SEEN, wantsIntro } from "./introflag";
export { wantsIntro };

const BG = "#10100d"; // nền phim sau khi nén (Carbon #111210 + grain + vignette), đo ở mép khung đầu và khung cuối
const IVORY = "#EEECE5";
const OUT = "cubic-bezier(.33,1,.68,1)";
const VOLUME = 0.9;
// Chấm mở đầu của phim (synchro-intro-film/src/scenes/Product.tsx): mark khoá cao 42px (cả khung S, 3R) ở giữa khung 1920×1080, đủ cỡ từ 0,3 s.
const DOT = 42, DOT_AT = 0.3;
// Vignette của khung đầu phim, đo trên bản 1080p (tâm rgb 25 → mép 16), trải theo khung phim đang hiện (object-fit: contain).
const vignette = () => {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  return `radial-gradient(ellipse ${(960 * k).toFixed(0)}px ${(540 * k).toFixed(0)}px at 50% 50%, rgb(25,25,23) 0%, rgb(24,24,22) 40%, rgb(20,20,18) 62%, rgb(18,18,16) 82%, rgb(16,16,14) 100%, rgb(15,15,13) 140%)`;
};


// Một thẻ video dùng chung: tải từ lúc hiện lời chào, màn phim gắn chính thẻ này vào nên phần đã tải không mất.
let shared: HTMLVideoElement | null = null;
const SRC_720 = "/intro/synchro-intro-720.mp4", SRC_1080 = "/intro/synchro-intro.mp4";
/** Phim đang ở chế độ toàn màn hình của trang (nút Toàn màn hình của phim). Không đoán F11 theo kích thước khung trang: Chrome ẩn,
 *  ứng dụng cài trên máy tính bảng… có khung trang bằng màn hình mà không phải người xem chọn toàn màn hình, sẽ tải 19 MB không cần. */
const fullScreen = () => !!document.fullscreenElement;
/** Toàn màn hình trên màn lớn (không tiết kiệm dữ liệu): đổi sang bản 1080p, giữ vị trí đang phát và trạng thái phát / dừng. */
function hiRes(v: HTMLVideoElement) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (!fullScreen() || conn?.saveData || screen.width < 1280 || v.currentSrc.endsWith(SRC_1080)) return;
  swapSrc(v, SRC_1080);
}
/** Đổi tệp phim giữ nguyên vị trí và trạng thái phát / dừng. */
function swapSrc(v: HTMLVideoElement, src: string) {
  const t = v.currentTime, playing = !v.paused;
  v.preload = "auto";
  v.src = src;
  v.addEventListener("loadedmetadata", () => { try { v.currentTime = t; } catch {} if (playing) v.play().catch(() => {}); }, { once: true });
}
export function preloadIntro() {
  if (shared || typeof document === "undefined") return shared;
  const v = document.createElement("video");
  v.src = SRC_720;
  v.preload = "metadata";
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.className = "intro-v";
  v.load();
  shared = v;
  return v;
}

// Phụ đề tiếng Việt [bắt đầu, kết thúc (giây), [phụ đề, dòng tiếng Anh gốc trong phim], đặt trên cùng]: theo nhịp của phim
// (150 BPM, 1 phách = 0,4 s; synchro-intro-film/src/timeline.ts). Chỉ hiện khi giao diện tiếng Việt (phim vốn bằng tiếng Anh).
const CAPS: [number, number, [string, string], boolean?][] = [
  [2.2, 5.2, ["Tất cả AI của bạn, một Synchro: kết nối Claude, ChatGPT, Gemini, Grok và DeepSeek của chính bạn.", "All your AI. One Synchro. Connect your own Claude, ChatGPT, Gemini, Grok and DeepSeek."]],
  [5.3, 6.9, ["Mọi công cụ, mọi gói: trình duyệt, tiện ích Chrome, Skills và Connectors chạy cả trên gói miễn phí.", "Every tool. Every plan. Browser, Chrome extension, Skills and Connectors work even on free plans."]],
  [7.0, 9.1, ["“Lên kế hoạch cuối tuần ở Kyoto dưới 900 đô và báo cho Mai.”", "“Plan my Kyoto weekend under $900 and tell Mai.”"]],
  [9.7, 14.0, ["Chrome của bạn, tự lái: tiện ích Synchro tự bấm, tự gõ, tự đặt chỗ.", "Your Chrome, on autopilot. The Synchro extension clicks, types and books by itself."]],
  [14.2, 17.0, ["Rồi nhắn cho Mai giúp bạn: lịch và tin nhắn, xử lý luôn trên điện thoại.", "Then it texts Mai for you. Calendar and messages, handled on your phone too."]],
  [18.3, 19.6, ["Bạn giao việc. Synchro làm xong.", "You hand it off. Synchro gets it done."]],
  [20.0, 23.4, ["Chạy cả khi bạn ngủ: giao cho Autopilot một lần, Synchro chạy theo lịch trên máy chủ của nó, kể cả khi bạn gập máy.", "Runs while you sleep. Give Autopilot a job once. Synchro runs it on schedule on its own server, even with your laptop closed."]],
  [23.6, 25.8, ["Synchro Code: không gian làm việc thật với terminal, trình duyệt, git và pull request.", "Synchro Code. A real workspace: terminal, browser, git and pull requests."]],
  [26.0, 28.2, ["Skills & Connectors: kết nối ứng dụng của bạn, Synchro tự chọn skill hợp với việc.", "Skills & Connectors. Plug in your apps. Synchro picks the right skill for the job."]],
  [28.4, 30.9, ["Speech: giọng đọc, đổi giọng và trợ lý giọng nói, chạy bằng ElevenLabs.", "Speech. Voices, voice changer and voice agents, powered by ElevenLabs."]],
  [31.6, 33.0, ["Bộ não: một trí nhớ dùng chung cho mọi model bạn kết nối.", "The Brain. One memory, shared by every model you connect."]],
  [33.0, 34.4, ["1 · Học từ mọi đoạn chat.", "01 · Learns from every chat."]],
  [34.4, 35.8, ["2 · Tự chăm sóc chính nó.", "02 · Tends itself."]],
  [35.8, 37.8, ["3 · Đổi model, Synchro vẫn nhớ bạn.", "03 · Switch models. It still knows you."]],
  [40.8, 43.3, ["Trợ lý AI của bạn. Mọi nơi, mọi lúc.", "Your AI agent. Anywhere, anytime."]],
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

// Logo ở khung cuối của phim (synchro-intro-film/src/scenes/Finale.tsx): lockup cao 210 trong khung 1920×1080, góc trên trái (388,07; 435).
const LOCK = { x: 388.07, y: 435, k: 210 / 1050 };
type Fly = { mark: { x: number; y: number; h: number }; word: { x: number; y: number; h: number }; end: boolean };

/**
 * Màn phim phủ toàn màn hình (trên cả màn đăng nhập). onCovered: màn hình đã phủ kín màu nền phim (gỡ màn đăng nhập phía dưới);
 * onReveal: logo bắt đầu bay về chỗ (app bên dưới lắng xuống, giấu logo thật của app tới khi logo bay tới); onDone: xong hẳn.
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
  const [fly, setFly] = useState<Fly | null>(null); // logo của khung cuối, bay về chỗ trong app
  const [seedOn, setSeedOn] = useState(!reduced); // logo của lời chào (bản sao) đang làm chấm mở đầu của phim
  const [vig, setVig] = useState(vignette); // vignette của khung đầu phim cho vòng mực và nền sân khấu
  const [full, setFull] = useState(false); // màn phim đang ở chế độ toàn màn hình của trang (nút Toàn màn hình)
  // Nút Toàn màn hình chỉ trên màn lớn (≥ 1280px, cùng ngưỡng đổi sang 1080p): điện thoại không thêm nút nào cạnh phụ đề.
  const canFull = typeof document !== "undefined" && !!document.fullscreenEnabled && screen.width >= 1280;
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), iris = useRef<HTMLDivElement>(null), flyBox = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null), seed = useRef<HTMLSpanElement>(null);
  const seedFrom = useRef<{ box: Box; color: string } | null>(null), seedOut = useRef(false), shownAt = useRef(0);
  const bar = useRef<HTMLDivElement>(null), skipBtn = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const leaving = useRef(false), shownRef = useRef(false); // shownRef: leave() chạy cả từ sự kiện "ended" đăng ký lúc gắn video
  const cb = useRef({ onCovered, onReveal, onDone });
  cb.current = { onCovered, onReveal, onDone };
  const vi = getLang() === "vi";

  // Gắn thẻ video đã tải trước; theo dõi tiến độ (thanh mảnh dưới đáy + phụ đề) không qua state cho mượt.
  useEffect(() => {
    const v = preloadIntro()!;
    video.current = v;
    host.current?.appendChild(v);
    // Phim sắp phát: tải hết bản 720p (lúc hiện lời chào chỉ tải phần đầu).
    v.preload = "auto";
    const fs = () => { setFull(!!document.fullscreenElement); hiRes(v); };
    document.addEventListener("fullscreenchange", fs);
    v.muted = false; v.volume = 0;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime, d = v.duration || 43.2;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, t / d)})`;
      if (vi) { const c = CAPS.find(([a, b]) => t >= a && t < b) ?? null; setCap((p) => (p === c ? p : c)); }
      // Chấm của phim đã đủ cỡ ngay dưới bản sao: nhường chỗ (nhỏ hơn và nằm gọn trong chấm của phim nên không thấy chỗ nối).
      if (t >= DOT_AT && !v.paused && shownRef.current && performance.now() - shownAt.current > 160) hideSeed(120);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ended = () => leave(true);
    // Bản 1080p tải lỗi giữa chừng: quay về bản 720p ở đúng chỗ đang phát, không kết thúc phim. Bản 720p lỗi thì mới rời phim, nhưng chỉ
    // khi đã ở bước chờ / phát: lỗi tới giữa lúc vòng mực đang nở (hay lúc hỏi Xem phim) mà rời ngay thì màn đăng nhập chưa được gỡ
    // (onCovered chưa chạy), người dùng kẹt ở lời chào. Khi đó bước chờ thấy v.error và rời phim (effect của phase "wait").
    const failed = () => { if (v.currentSrc.endsWith(SRC_1080)) swapSrc(v, SRC_720); else if (phaseRef.current === "wait" || phaseRef.current === "play") leave(); };
    v.addEventListener("ended", ended); v.addEventListener("error", failed);
    const vis = () => { if (leaving.current) return; if (document.hidden) v.pause(); else if (!pausedRef.current && phaseRef.current === "play") v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("fullscreenchange", fs); cancelAnimationFrame(raf); v.removeEventListener("ended", ended); v.removeEventListener("error", failed); document.removeEventListener("visibilitychange", vis); v.pause(); v.remove(); shared = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const pausedRef = useRef(paused); pausedRef.current = paused;

  // Phụ đề: trong dải đen dưới phim nếu cao ≥ 60px, không thì nổi trên phim.
  useEffect(() => {
    const fit = () => { const h = innerWidth * 9 / 16, band = (innerHeight - h) / 2; setCapBottom(band >= 60 ? band / 2 : null); setVig(vignette()); };
    fit(); addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  // Bản sao logo của lời chào: đặt khít lên logo thật trước khi vẽ khung đầu tiên (màn đăng nhập ẩn logo thật cùng lúc, lớp auth-out).
  useLayoutEffect(() => {
    const el = seed.current, svg = document.querySelector(".auth-root .auth-mark svg");
    if (!el || !svg) { setSeedOn(false); return; }
    const box = boxOf(svg), color = getComputedStyle(svg).color;
    seedFrom.current = { box, color };
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, color, visibility: "visible" });
  }, []);
  function hideSeed(ms: number) {
    if (seedOut.current || !seed.current) return;
    seedOut.current = true;
    seed.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: OUT, fill: "forwards" }).finished.then(() => setSeedOn(false), () => setSeedOn(false));
  }

  // Vào: vòng tròn kính quanh logo hoá mực (logo đổi sang Ivory), rồi nở ra phủ kín màn hình; logo lướt về giữa khung phim, thu về cỡ chấm mở đầu.
  useEffect(() => {
    if (phase !== "iris") return;
    const orb = document.querySelector(".auth-root .auth-orb")?.getBoundingClientRect();
    const x = orb ? orb.left + orb.width / 2 : innerWidth / 2, y = orb ? orb.top + orb.height / 2 : innerHeight / 2;
    const r0 = orb ? orb.width / 2 : 0, r1 = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
    const go = () => { try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} cb.current.onCovered(); setPhase("wait"); };
    const el = iris.current;
    if (!el) { go(); return; }
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: OUT, fill: "both" });
    const a = el.animate([{ clipPath: `circle(${r0}px at ${x}px ${y}px)` }, { clipPath: `circle(${r1}px at ${x}px ${y}px)` }],
      { duration: 1050, delay: 200, easing: "cubic-bezier(.65,0,.35,1)", fill: "both" });
    const s = seed.current, from = seedFrom.current;
    if (s && from) {
      s.animate([{ color: from.color }, { color: IVORY }], { duration: 240, easing: OUT, fill: "both" });
      const k = Math.min(innerWidth / 1920, innerHeight / 1080), h = DOT * k, w = (h * from.box.w) / from.box.h;
      flyTo(s, from.box, { x: innerWidth / 2 - w / 2, y: innerHeight / 2 - h / 2, w, h }, { ms: 1000, delay: 200 });
    }
    // Phim bắt đầu khi vòng mực đã phủ gần hết (đã tải đủ): lúc phủ kín, chấm của phim vừa đủ cỡ ngay dưới bản sao — không có nhịp đứng chờ.
    const early = window.setTimeout(() => {
      const v = video.current;
      if (!v || v.readyState < 3) return;
      v.muted = false; v.volume = 0;
      v.play().then(() => { if (!v.muted) fade(v, VOLUME, 700); }, () => {});
    }, 200 + 1050 * 0.78);
    a.onfinish = go;
    return () => { clearTimeout(early); a.onfinish = null; };
  }, [phase, uid]);

  // Chờ đủ dữ liệu rồi phát: phim hiện dần, tiếng to dần. Bị chặn tiếng thì phát không tiếng. Chờ lâu (mạng chậm): chấm logo ở giữa xoay
  // theo nhịp đồng bộ (180° rồi nghỉ); có dữ liệu thì xoay nốt vòng đang dở cho nhanh rồi mới phát, để phim bắt đầu đúng từ chấm đứng yên.
  useEffect(() => {
    if (phase !== "wait") return;
    const v = video.current!;
    // Bản 720p đã lỗi từ lúc tải trước (tệp phim thiếu trên máy chủ: sự kiện "error" xảy ra trước khi gắn thẻ video): không có gì để chờ,
    // rời phim vào thẳng app thay vì quay chấm chờ mãi.
    if (v.error && !v.currentSrc.endsWith(SRC_1080)) { leave(); return; }
    let off = false, spin: Animation | null = null;
    const slow = setTimeout(() => {
      const r = seedOn ? seed.current?.querySelector(".mk-r") : null;
      if (r) spin = r.animate([{ transform: "rotate(0deg)", easing: "cubic-bezier(.65,0,.35,1)" }, { transform: "rotate(180deg)", offset: 0.75 }, { transform: "rotate(180deg)" }], { duration: 1600, iterations: Infinity });
    }, 350);
    const ready = async () => {
      clearTimeout(slow);
      if (spin) {
        const it = spin.effect?.getComputedTiming().currentIteration ?? 0;
        spin.effect?.updateTiming({ iterations: it + 1 });
        spin.playbackRate = 2.5;
        await spin.finished.catch(() => {});
        spin.cancel(); spin = null;
      }
      start();
    };
    const start = async () => {
      if (off) return;
      if (!v.paused) { setPhase("play"); setShown(true); shownRef.current = true; shownAt.current = performance.now(); return; }
      v.muted = false; v.volume = 0;
      try { await v.play(); }
      catch { v.muted = true; setMuted(true); setNeedSound(true); try { await v.play(); } catch { return leave(); } }
      if (off) return;
      setPhase("play"); setShown(true); shownRef.current = true; shownAt.current = performance.now();
      if (!v.muted) fade(v, VOLUME, 700);
    };
    if (v.readyState >= 3) ready(); else v.addEventListener("canplay", ready, { once: true });
    return () => { off = true; clearTimeout(slow); spin?.cancel(); v.removeEventListener("canplay", ready); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "play") return;
    const t = setTimeout(() => setSkip(true), 1200);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => { if (skip) skipBtn.current?.focus({ preventScroll: true }); }, [skip]);

  // Ra: tiếng nhỏ dần; logo của khung cuối ở lại khi phim mờ đi (hết phim: đè khít lên khung cuối; Bỏ qua: hiện lên đúng chỗ đó),
  // rồi bay về chỗ trong app. Giảm chuyển động / phim chưa hiện: chỉ mờ dần.
  function leave(end = false) {
    if (leaving.current) return;
    leaving.current = true;
    hideSeed(300);
    const v = video.current!;
    if (!v.paused && !v.muted) fade(v, 0, 450).then(() => v.pause()); else v.pause();
    // Đang toàn màn hình: thoát trước rồi mới đo (logo bay về chỗ trong app ở khung trang thường).
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}).then(() => requestAnimationFrame(() => out(end))); return; }
    out(end);
  }
  function out(end: boolean) {
    const r = host.current?.getBoundingClientRect();
    if (reduced || !shownRef.current || !r?.width) {
      setPhase("out"); cb.current.onReveal();
      setTimeout(() => cb.current.onDone(), 600);
      return;
    }
    const s = Math.min(r.width / 1920, r.height / 1080), k = LOCK.k * s;
    const x = r.left + (r.width - 1920 * s) / 2 + LOCK.x * s, y = r.top + (r.height - 1080 * s) / 2 + LOCK.y * s;
    setFly({ mark: { x, y, h: 1050 * k }, word: { x: x + 1108.33 * k, y: y + 38 * k, h: 949 * k }, end });
    setPhase("out");
    setTimeout(land, end ? 450 : 650);
  }
  // Logo bay về chỗ theo đường cong (đo chỗ đến trước khi app lắng xuống; chỗ đến không thấy — thanh bên đóng, không ở trang chủ — thì mờ đi);
  // nền phim mở ra thành lỗ tròn từ chỗ biểu tượng hạ cánh, trang chủ lắp lại quanh đó.
  function land() {
    const box = flyBox.current;
    if (!box) return cb.current.onDone();
    settleApp();
    const plan: [HTMLElement | null, Element | null, number][] = [
      [box.querySelector<HTMLElement>(".fly-mk"), markTarget(), 0],
      [box.querySelector<HTMLElement>(".fly-wd"), document.querySelector(".app .side-brand .lk"), 70],
    ];
    const ends = plan.map(([, to]) => (to ? boxOf(to) : null));
    const at = onScreen(ends[0]) ? center(ends[0]) : null;
    const mk = plan[0][0];
    cb.current.onReveal();
    const jobs: Promise<unknown>[] = plan.map(([el, to, delay], i) => {
      const b = ends[i];
      if (!el) return Promise.resolve();
      if (!to || !onScreen(b)) return el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.94)" }], { duration: 550, delay, easing: OUT, fill: "forwards" }).finished;
      // Biểu tượng mang lỗ sáng theo nó nên đổi màu sớm; chữ còn trên nền phim lâu hơn nên đổi muộn.
      return flyTo(el, boxOf(el), b, { ms: 1000, delay, arc: 0.16, color: [IVORY, getComputedStyle(to).color], colorSpan: i ? [0.12, 0.6] : [0.05, 0.45] }).finished;
    });
    if (stage.current) jobs.push(openHole(stage.current, at && mk ? () => center(boxOf(mk)) : { x: innerWidth / 2, y: innerHeight / 2 }, { ms: 1100, delay: 120 }));
    jobs.push(assemble(at));
    Promise.all(jobs).then(() => cb.current.onDone(), () => cb.current.onDone());
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
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen().catch(() => {});
  };
  const watch = () => { onCovered(); try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} setPhase("wait"); };

  return (
    <div ref={root} className={`intro ${reduced ? "reduced" : ""}`} data-phase={phase} role="dialog" aria-modal="true" aria-label={tr("Phim giới thiệu Synchro")} style={{ ["--intro-bg" as string]: BG }}>
      {!reduced && phase === "iris" && <div ref={iris} className="intro-iris" style={{ clipPath: "circle(0px at 50% 50%)", background: vig || undefined }} />}
      <div ref={stage} className="intro-stage" style={vig ? { background: vig } : undefined} onClick={() => { if (phase === "play") toggle(); }}>
        <div ref={host} className={`intro-host ${shown ? "on" : ""}`} />
        {phase === "wait" && !seedOn && <div className="intro-load"><Loader size={34} label={tr("Đang tải phim")} /></div>}
        {phase === "ask" && (
          <div className="intro-ask" onClick={(e) => e.stopPropagation()}>
            <img src="/intro/synchro-intro-poster.jpg" alt="" />
            <div className="intro-ask-a">
              <button type="button" className="intro-btn pri" onClick={watch}>{tr("Xem phim giới thiệu (43 giây)")}</button>
              <button type="button" className="intro-btn" onClick={() => { onCovered(); try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch {} leave(); }}>{trc("Vào Synchro", "phim giới thiệu")}</button>
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
            {trc("Bỏ qua", "phim giới thiệu")}<svg viewBox="0 0 20 20" aria-hidden><path d="M8 5l5 5-5 5" /></svg>
          </button>
          {needSound
            ? <button type="button" className="intro-btn sound-need" onClick={sound}>{trc("Bật tiếng", "phim giới thiệu")}</button>
            : phase === "play" && <button type="button" className="intro-btn snd" aria-label={muted ? trc("Bật tiếng", "phim giới thiệu") : trc("Tắt tiếng", "phim giới thiệu")} onClick={sound}>
                <svg viewBox="0 0 20 20" aria-hidden><path d="M3.5 8h2.6L10 4.8v10.4L6.1 12H3.5z" />{muted ? <path d="M13 8l4 4M17 8l-4 4" /> : <path d="M13.2 7.2a4 4 0 010 5.6M15.4 5a7 7 0 010 10" />}</svg>
              </button>}
          {phase === "play" && canFull && <button type="button" className={`intro-btn fs ${needSound ? "solo" : ""}`} aria-label={full ? tr("Thoát toàn màn hình") : tr("Toàn màn hình")} onClick={toggleFull}>
            <svg viewBox="0 0 20 20" aria-hidden>{full ? <path d="M8 3.5V8H3.5M12 3.5V8h4.5M8 16.5V12H3.5M12 16.5V12h4.5" /> : <path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" />}</svg>
          </button>}
          <div className="intro-bar"><div ref={bar} /></div>
        </div>
      )}
      {seedOn && <span ref={seed} className="intro-seed" aria-hidden><Mark size={46} state="sync" /></span>}
      {fly && (
        <div ref={flyBox} className={`intro-fly ${fly.end ? "" : "skip"}`} aria-hidden>
          <span className="fly-mk" style={{ left: fly.mark.x, top: fly.mark.y }}><Mark size={fly.mark.h} /></span>
          <span className="fly-wd" style={{ left: fly.word.x, top: fly.word.y }}><Wordmark height={fly.word.h} /></span>
        </div>
      )}
    </div>
  );
}
