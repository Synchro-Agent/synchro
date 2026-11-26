"use client";
// Trình phát âm thanh dùng chung: mọi bản kết quả / bản gốc / lịch sử ở mục Speech và khung xem trước tệp âm thanh
// trong đoạn chat. Bản ghi bằng MediaRecorder (webm / ogg) không ghi thời lượng ở phần đầu tệp: thẻ <audio> báo
// Infinity / NaN cho tới khi đọc hết tệp, nên đồng hồ đứng ở “0:13 / 0:00” và dạng sóng không chạy theo. Thời lượng
// lấy lần lượt: metadata hữu hạn → tua thử tới cuối để trình duyệt tự dò độ dài thật → độ dài của bản đã giải mã để
// vẽ dạng sóng. Dạng sóng vẽ từ chính mẫu âm thanh; phần đã phát tô đậm và chạy mượt theo từng khung hình.
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { locale } from "./i18n";
import { fmtClockOf } from "../shared/speech/fmt";

const clock = (t: number, total: number) => fmtClockOf(t, total, locale());
const PROBE_AT = 1e101;

// ---- thời lượng ----
// Thời lượng đã dò được của từng thẻ <audio> (cả bản không có metadata): trình phát ở đáy trang Speech đọc lại ở đây.
const knownDur = new WeakMap<HTMLMediaElement, number>();
/** Sự kiện phát trên thẻ <audio> khi dò được thời lượng mà trình duyệt không tự báo (không có durationchange). */
export const DURATION_EVENT = "sx:duration";
/** Thời lượng (giây) của một thẻ <audio>, 0 khi chưa biết. */
export function mediaDuration(a: HTMLMediaElement): number {
  if (Number.isFinite(a.duration) && a.duration > 0) return a.duration;
  return knownDur.get(a) ?? 0;
}
function learnDuration(a: HTMLMediaElement, d: number) {
  if (!(d > 0) || !Number.isFinite(d) || knownDur.get(a) === d) return;
  knownDur.set(a, d);
  a.dispatchEvent(new Event(DURATION_EVENT));
}

/**
 * Thời lượng (giây) của một tệp âm thanh / video chọn từ máy hoặc vừa ghi âm, 0 nếu không đọc được. Bản ghi
 * MediaRecorder báo Infinity ở metadata nên tua thử tới cuối để trình duyệt dò độ dài thật; quá 4 giây vẫn chưa ra thì
 * trả 0 (chỗ gọi coi như chưa biết độ dài, không chặn người dùng).
 */
export function fileDuration(f: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(f);
    const el = document.createElement(f.type.startsWith("video") ? "video" : "audio");
    let settled = false;
    const done = (d: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const timer = setTimeout(() => done(0), 4000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) done(el.duration);
      else el.currentTime = PROBE_AT;
    };
    el.ondurationchange = () => { if (Number.isFinite(el.duration) && el.duration > 0) done(el.duration); };
    el.onerror = () => done(0);
    el.src = url;
  });
}

// ---- dạng sóng ----
type Decoded = { peaks: number[]; dur: number };
const peaksCache = new Map<string, Decoded>();
// Giải mã dùng chung một OfflineAudioContext (không mở thiết bị âm thanh) và lần lượt từng tệp: mỗi dạng sóng tạo
// một AudioContext riêng thì cả trang mở cùng lúc nhiều cái, giao diện đứng 300–450ms khi vào trang Speech. Cùng một
// tệp chỉ giải mã một lần. decodeAudioData đổi mẫu về tần số của context: 8 kHz đủ cho 56 vạch mà bản đã giải mã nhỏ
// hơn 5–6 lần so với 44,1 kHz.
const DECODE_RATE = 8000;
let decoder: BaseAudioContext | null = null;
type WebkitWindow = { webkitAudioContext: typeof AudioContext };
const decoderOf = () => (decoder ??= typeof OfflineAudioContext !== "undefined"
  ? new OfflineAudioContext(1, 1, DECODE_RATE)
  : new (window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext)());
let queue: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<Decoded>>();

// Giới hạn bộ nhớ khi vẽ dạng sóng. Trình duyệt giải mã cả tệp ra mẫu float32 ở tần số gốc, đủ mọi kênh, rồi mới đổi
// mẫu: một bản MP3 nén 20 MB (khoảng 21 phút stereo) thành khoảng 450 MB, đủ làm treo hay sập thẻ trên điện thoại và
// trong ứng dụng máy tính ngay khi mở xem trước. Nên giới hạn theo kích thước SAU giải mã (ước tệ nhất 48 kHz stereo,
// khoảng 80 MB ≈ 3,5 phút) chứ không theo dung lượng nén; vượt mức thì hiện vạch đều, vẫn phát và tua được.
const WORST_PCM_BYTES_PER_SEC = 48000 * 2 * 4;
export const WAVE_MAX_SEC = Math.floor(80e6 / WORST_PCM_BYTES_PER_SEC);
/** Dung lượng tối đa tải thêm lần nữa để vẽ dạng sóng (WAV không nén có thể rất nặng dù ngắn). */
export const WAVE_MAX_BYTES = 16 * 1024 * 1024;
// Chưa biết thời lượng (tua thử không ra): chỉ giải mã tệp nhỏ. 3 MB bản ghi opus / MP3 là cỡ vài phút.
const WAVE_BLIND_BYTES = 3 * 1024 * 1024;
// Chờ thời lượng tối đa chừng này trước khi giải mã theo giới hạn dung lượng (bản không báo được thời lượng).
const WAVE_WAIT_MS = 2500;

/** Đỉnh biên độ (0,12…1) của n đoạn đều nhau trong một kênh. */
function peaksOfChannel(d: Float32Array, n: number): number[] {
  const step = Math.max(1, Math.floor(d.length / n)), out: number[] = [];
  // Bước nhảy 2 mẫu ở 8 kHz: chu kỳ giọng nói dài hàng chục mẫu nên đỉnh vẫn khớp, mà bản 3,5 phút quét vài ms.
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(d.length, (i + 1) * step);
    for (let j = i * step; j < end; j += 2) m = Math.max(m, Math.abs(d[j]));
    out.push(m);
  }
  const top = Math.max(0.01, ...out);
  return out.map((x) => 0.12 + 0.88 * (x / top));
}

/** Tải src, bỏ dở khi lớn hơn maxBytes (đọc Content-Length trước khi tải phần thân nếu máy chủ có báo). */
async function fetchCapped(src: string, maxBytes: number): Promise<ArrayBuffer> {
  const stop = new AbortController();
  const r = await fetch(src, { signal: stop.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const mb = (n: number) => Math.round(n / 1048576);
  const big = (n: number) => new Error(`tệp ${mb(n)} MB, quá mức ${mb(maxBytes)} MB`);
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > maxBytes) { stop.abort(); throw big(len); }
  const buf = await r.arrayBuffer();
  if (buf.byteLength > maxBytes) throw big(buf.byteLength);
  return buf;
}

/** Dạng sóng thật và thời lượng của bản đã giải mã; cùng tệp, cùng số vạch chỉ tải và giải mã một lần. */
export function decodePeaks(src: string, n: number, maxBytes = WAVE_MAX_BYTES): Promise<Decoded> {
  const k = `${n}:${src}`;
  const hit = peaksCache.get(k);
  if (hit) return Promise.resolve(hit);
  const cur = inflight.get(k);
  if (cur) return cur;
  const p = (async () => {
    const buf = await fetchCapped(src, maxBytes);
    const job = queue.then(async () => {
      const a = await decoderOf().decodeAudioData(buf);
      return { peaks: peaksOfChannel(a.getChannelData(0), n), dur: a.duration };
    });
    // Hàng đợi chỉ để xếp lượt: lỗi của tệp này đã trả cho người gọi qua `job`, lượt sau vẫn chạy.
    queue = job.catch(() => undefined);
    const res = await job;
    peaksCache.set(k, res);
    return res;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Bước tua bằng phím mũi tên: 5 giây; bản ngắn hơn 50 giây thì một phần mười độ dài để không nhảy thẳng tới cuối. */
const keyStep = (dur: number) => Math.min(5, Math.max(0.1, dur / 10));

type WaveProps = {
  peaks: number[] | null; n: number; dur: number; t: number; onSeek: (sec: number) => void;
  /** Lớp vạch tô đậm: trình phát cắt nó theo vị trí phát qua ref, mỗi khung hình, không dựng lại cả trình phát. */
  playedRef: React.RefObject<HTMLSpanElement | null>;
};
// Ngón tay phải đi quá chừng này (px) mới tính là kéo; ít hơn là chạm để tua.
const TOUCH_SLOP = 8;
type Grip = { id: number; x: number; y: number; drag: boolean };

/**
 * Dạng sóng kiêm thanh tua (role="slider"): vạch vẽ từ mẫu âm thanh thật, phần đã phát tô đậm. Bấm / chạm hoặc kéo
 * ngang để tua; bàn phím: mũi tên ±5 giây (bản ngắn ±10%), PageUp / PageDown ±10%, Home / End về đầu / cuối.
 */
function Wave({ peaks, n, dur, t, onSeek, playedRef }: WaveProps) {
  // Con trỏ đang nhấn trên dạng sóng; drag = đang tua theo con trỏ.
  const grip = useRef<Grip | null>(null);
  const list = peaks ?? Array.from({ length: n }, () => 0.3);
  const bars = list.map((b, i) => <i key={i} style={{ height: `${Math.round(b * 100)}%` }} />);
  const at = (e: React.PointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * dur;
  };
  const key = (e: React.KeyboardEvent) => {
    if (!dur) return;
    const s = keyStep(dur);
    const to: Record<string, number> = {
      ArrowRight: t + s, ArrowUp: t + s, ArrowLeft: t - s, ArrowDown: t - s,
      PageUp: t + dur * 0.1, PageDown: t - dur * 0.1, Home: 0, End: dur,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    onSeek(Math.min(dur, Math.max(0, to[e.key])));
  };
  // Chuột / bút: tua ngay khi nhấn rồi kéo theo. Cảm ứng: dạng sóng chiếm gần hết bề ngang thẻ trên điện thoại nên
  // vuốt dọc bắt đầu trên nó phải cuộn trang (touch-action: pan-y), không tua; chỉ chạm nhẹ hoặc kéo ngang mới tua.
  const down = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dur || e.button !== 0) return;
    const touch = e.pointerType === "touch";
    grip.current = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: !touch };
    if (touch) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(at(e));
  };
  const move = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.drag) {
      const dx = Math.abs(e.clientX - g.x), dy = Math.abs(e.clientY - g.y);
      if (dx < TOUCH_SLOP && dy < TOUCH_SLOP) return;
      // Đi dọc là cuộn trang: trình duyệt cuộn và gửi pointercancel, ở đây chỉ thôi theo dõi.
      if (dy >= dx) { grip.current = null; return; }
      g.drag = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    onSeek(at(e));
  };
  const end = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = grip.current;
    grip.current = null;
    // Chạm nhẹ (nhấc tay khi chưa đi quá ngưỡng): tua tới chỗ chạm. pointercancel (trang đã cuộn) thì không tua.
    if (g && g.id === e.pointerId && !g.drag && e.type === "pointerup") onSeek(at(e));
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <span className="aud-wave" role="slider" tabIndex={dur ? 0 : -1} aria-label="Tua" aria-disabled={!dur}
      aria-valuemin={0} aria-valuemax={Math.round(dur * 10) / 10} aria-valuenow={Math.round(Math.min(t, dur) * 10) / 10}
      aria-valuetext={`${clock(t, dur)} / ${clock(dur, dur)}`} style={{ cursor: dur ? "pointer" : undefined }}
      onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="aud-wave-row">{bars}</span>
      <span ref={playedRef} className="aud-wave-row on" aria-hidden="true">{bars}</span>
    </span>
  );
}

// Mỗi lúc chỉ một trình phát chạy: bấm phát bản khác thì bản đang phát dừng.
let playingEl: HTMLAudioElement | null = null;

export type AudioPlayerProps = {
  src: string | null; title?: string; dl?: string | null;
  /** Tên tệp khi tải về một bản blob: / data:. */
  name?: string;
  /** Tua tới giây t rồi phát; đổi n để tua lại cùng chỗ. */
  seekTo?: { t: number; n: number };
  onTime?: (t: number) => void;
  /** Bỏ giải mã dạng sóng (đã biết tệp quá nặng): vẫn phát và tua được trên các vạch đều. */
  noWave?: boolean;
  /** Báo thẻ <audio> bắt đầu phát / bị gỡ, cho trình phát chung ở đáy trang Speech. */
  onPlay?: (a: HTMLAudioElement) => void;
  onGone?: (a: HTMLAudioElement) => void;
};
const BARS = 56;

/** Trình phát: phát / tạm dừng, dạng sóng thật có vệt tiến độ, tua bằng chuột hoặc bàn phím, đồng hồ, tải xuống. */
export function AudioPlayer({ src, title, dl, name, seekTo, onTime, noWave, onPlay, onGone }: AudioPlayerProps) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef<HTMLSpanElement | null>(null);
  const [play, setPlay] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  // Hàm gọi lại mới nhất cho các sự kiện của thẻ <audio> (gắn một lần mỗi src), không phải gắn lại khi cha dựng lại.
  const cb = useRef({ onTime, onPlay, onGone });
  const durRef = useRef(0);
  useEffect(() => { cb.current = { onTime, onPlay, onGone }; });
  useEffect(() => { durRef.current = dur; paint(ref.current?.currentTime ?? 0); }, [dur]);
  function paint(sec: number) {
    const d = durRef.current, el = playedRef.current;
    if (el) el.style.clipPath = `inset(0 ${d ? 100 - Math.min(100, (sec / d) * 100) : 100}% 0 0)`;
  }

  useEffect(() => {
    setT(0); setDur(0); setPlay(false); setPeaks(null);
    durRef.current = 0; paint(0);
    if (!src) return;
    const a = new Audio();
    a.preload = "metadata";
    ref.current = a;
    // Đang tua thử tới cuối để dò thời lượng: bỏ qua sự kiện vị trí của lần tua đó để đồng hồ không nhảy.
    let probing = false, raf = 0, dead = false, waveOn = false;
    // Vẽ dạng sóng khi đã biết thời lượng (để bỏ qua bản quá dài trước khi tải và giải mã), hoặc sau WAVE_WAIT_MS
    // với bản không báo được thời lượng: khi đó chỉ giải mã tệp nhỏ, độ dài bản giải mã thay cho metadata.
    const wave = () => {
      if (noWave || waveOn || dead) return;
      waveOn = true;
      clearTimeout(waveWait);
      const d = mediaDuration(a);
      if (d > WAVE_MAX_SEC) {
        console.debug(`[audio] bản dài ${Math.round(d)} giây: vạch đều thay dạng sóng để khỏi giải mã cả tệp vào RAM`);
        return;
      }
      decodePeaks(src, BARS, d > 0 ? WAVE_MAX_BYTES : WAVE_BLIND_BYTES).then((r) => {
        if (dead) return;
        setPeaks(r.peaks);
        // Thẻ <audio> vẫn chưa biết thời lượng (không có metadata, tua thử không được): dùng độ dài bản đã giải mã.
        if (!(mediaDuration(a) > 0)) learnDuration(a, r.dur);
      }).catch((e: Error) => {
        // Không giải mã được (định dạng lạ, tệp hết hạn, quá nặng): giữ vạch đều; thẻ <audio> vẫn phát và tua được.
        if (!dead) console.debug("[audio] không vẽ được dạng sóng:", e.message);
      });
    };
    const waveWait = noWave ? 0 : setTimeout(wave, WAVE_WAIT_MS);
    const take = () => { const d = mediaDuration(a); if (d > 0) { setDur(d); wave(); } };
    const endProbe = () => { if (probing) { probing = false; a.currentTime = 0; } };
    const tick = () => { paint(a.currentTime); raf = requestAnimationFrame(tick); };
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) { take(); return; }
      probing = true;
      a.currentTime = PROBE_AT;
    };
    a.ondurationchange = () => {
      if (!Number.isFinite(a.duration) || !(a.duration > 0)) return;
      learnDuration(a, a.duration);
      take();
      endProbe();
    };
    // Thời lượng lấy từ bản giải mã khi trình duyệt không dò được bằng cách tua thử: thôi chờ và đưa vị trí về đầu.
    const learned = () => { take(); endProbe(); };
    a.addEventListener(DURATION_EVENT, learned);
    a.ontimeupdate = () => {
      if (probing) return;
      setT(a.currentTime);
      cb.current.onTime?.(a.currentTime);
      if (a.paused) paint(a.currentTime);
    };
    a.onplay = () => {
      if (playingEl && playingEl !== a) playingEl.pause();
      playingEl = a;
      setPlay(true);
      cb.current.onPlay?.(a);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    a.onpause = () => { setPlay(false); cancelAnimationFrame(raf); paint(a.currentTime); };
    a.onended = () => {
      if (probing) return;
      setPlay(false); cancelAnimationFrame(raf);
      a.currentTime = 0; setT(0); paint(0);
    };
    a.src = src;
    return () => {
      dead = true;
      clearTimeout(waveWait);
      cancelAnimationFrame(raf);
      a.removeEventListener(DURATION_EVENT, learned);
      a.onloadedmetadata = a.ondurationchange = a.ontimeupdate = a.onplay = a.onpause = a.onended = null;
      a.pause();
      a.removeAttribute("src");
      a.load();
      if (playingEl === a) playingEl = null;
      if (ref.current === a) ref.current = null;
      cb.current.onGone?.(a);
    };
  }, [src, noWave]);

  useEffect(() => {
    const a = ref.current;
    if (!a || !seekTo) return;
    a.currentTime = seekTo.t;
    setT(seekTo.t);
    paint(seekTo.t);
    void a.play().catch((e: Error) => console.debug("[audio] trình duyệt chặn tự phát:", e.message));
  }, [seekTo]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch((e: Error) => console.debug("[audio] không phát được:", e.message));
    else a.pause();
  };
  const seek = (sec: number) => {
    const a = ref.current;
    if (!a || !dur) return;
    a.currentTime = sec;
    setT(sec);
    paint(sec);
    cb.current.onTime?.(sec);
  };
  return (
    <div className="aud-player">
      <button className="aud-btn" aria-label={play ? "Tạm dừng" : "Phát"} onClick={toggle} disabled={!src}>
        {play ? <I.M icon="Pause" size={14} /> : <I.M icon="Play" size={14} />}
      </button>
      <div className="aud-main">
        {title && <span className="aud-title">{title}</span>}
        <Wave peaks={peaks} n={BARS} dur={dur} t={t} onSeek={seek} playedRef={playedRef} />
      </div>
      <span className="aud-time">{clock(t, dur)} / {clock(dur, dur)}</span>
      {dl && (
        <button className="icon-btn" aria-label="Tải xuống" title="Tải xuống" onClick={() => saveAudioUrl(dl, name)}>
          <I.Download size={17} />
        </button>
      )}
    </div>
  );
}

/** Tải một bản âm thanh: blob: / data: tải thẳng kèm tên tệp; đường dẫn máy chủ thêm ?dl=1 để máy chủ đặt tên tệp. */
export function saveAudioUrl(dl: string, name?: string) {
  const a = document.createElement("a");
  if (dl.startsWith("data:") || dl.startsWith("blob:")) {
    a.href = dl;
    a.download = name ?? "synchro-audio";
  } else a.href = dl + (dl.includes("?") ? "&" : "?") + "dl=1";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
