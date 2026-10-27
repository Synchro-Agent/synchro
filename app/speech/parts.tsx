"use client";
// Thành phần dùng chung của mục Speech: tab, thanh trượt, công tắc, chọn, vùng thả tệp, ghi âm, dạng sóng, trình phát, bộ chọn giọng.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "../icons";
import { LiquidOrb } from "../liquidorb";
import { CAT_LABEL, LANGS, api, fmtDur, fmtNum, hueOf, on, post, reloadVoices, useMyVoices, usePlan, type Voice } from "./client";
import { AGES, CATEGORIES, GENDERS } from "./data";

// Mức hoạt động khi đang phát (âm tiết và quãng nghỉ), dùng chung cho các quả cầu.
const talking = () => { const t = performance.now() / 1000; return Math.max(0, Math.sin(t * 0.85) + 0.35) * (0.12 + Math.max(0, Math.sin(t * 9.3 + Math.sin(t * 2.1))) ** 2 * 0.6); };
export const MAX_UPLOAD = 40 * 1024 * 1024;

export function Seg<T extends string>({ items, value, onChange, label, small }: { items: { k: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; small?: boolean }) {
  return (
    <div className={`sp-seg ${small ? "sm" : ""}`} role="tablist" aria-label={label}>
      {items.map((x) => <button key={x.k} role="tab" aria-selected={value === x.k} className={value === x.k ? "on" : ""} onClick={() => onChange(x.k)}>{x.label}</button>)}
    </div>
  );
}

export function Range({ id, label, value, onChange, min = 0, max = 100, step = 1, left, right, show }: { id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; left?: string; right?: string; show?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="sp-fld">
      <label htmlFor={id} className="sp-fl"><span>{label}</span>{show && <em>{show}</em>}</label>
      <input id={id} className="sp-range" type="range" min={min} max={max} step={step} value={value} style={{ "--p": `${pct}%` } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      {(left || right) && <div className="sp-ends"><span>{left}</span><span>{right}</span></div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="sp-line">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <button role="switch" aria-checked={checked} aria-label={label} className={`sp-tg ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} />
    </div>
  );
}

type Opt = string | [string, string];
export function Select({ id, label, value, options, onChange, inline }: { id: string; label: string; value: string; options: Opt[]; onChange: (v: string) => void; inline?: boolean }) {
  const sel = (
    <span className="sp-sel">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}</select>
      <I.Chevron size={13} />
    </span>
  );
  if (inline) return <div className="sp-line"><label htmlFor={id}>{label}</label>{sel}</div>;
  return <div className="sp-fld"><label htmlFor={id} className="sp-fl"><span>{label}</span></label>{sel}</div>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return <div className="sp-fld"><label htmlFor={htmlFor} className="sp-fl"><span>{label}</span>{hint && <em>{hint}</em>}</label>{children}</div>;
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Vùng thả tệp: bấm để chọn, kéo thả, hiện tên và dung lượng tệp đã chọn; tệp quá giới hạn tải lên thì báo ngay.
export function Drop({ title, sub, accept, file, onFile, multiple, compact, say, max = MAX_UPLOAD }: { title: string; sub: string; accept?: string; file?: File | null; onFile: (f: File[]) => void; multiple?: boolean; compact?: boolean; say?: (m: string) => void; max?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (fl: File[]) => {
    const big = fl.find((f) => f.size > max);
    if (big) { say?.(`“${big.name}” lớn hơn ${Math.round(max / 1024 / 1024)} MB. Dán liên kết tới tệp, hoặc cắt ngắn tệp.`); fl = fl.filter((f) => f.size <= max); }
    if (fl.length) onFile(fl);
  };
  return (
    <button type="button" className={`sp-drop ${compact ? "sm" : ""} ${over ? "over" : ""} ${file ? "has" : ""}`} onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(Array.from(e.dataTransfer.files)); }}>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <span className="sp-drop-ic"><I.Upload size={18} /></span>
      <b>{file ? file.name : title}</b>
      <span>{file ? `${size(file.size)} · bấm để chọn tệp khác` : sub}</span>
    </button>
  );
}

// Ghi âm bằng micro (MediaRecorder): trả về tệp âm thanh để chép lời, đổi giọng, nhân bản hay xác minh giọng.
export function Recorder({ onDone, say, label = "Ghi âm", max = 300 }: { onDone: (f: File) => void; say: (m: string) => void; label?: string; max?: number }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSec((s) => { if (s + 1 >= max) rec.stop(); return s + 1; }), 1000);
    return () => clearInterval(t);
  }, [rec, max]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        const mime = r.mimeType || "audio/webm", ext = /mp4/.test(mime) ? "m4a" : "webm";
        const d = new Date();
        if (chunks.length) onDone(new File(chunks, `Ghi âm ${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}.${ext}`, { type: mime.split(";")[0] }));
      };
      r.start(250); setSec(0); setRec(r);
    } catch { say("Không mở được micro: hãy cho phép Synchro dùng micro trong trình duyệt"); }
  };
  return rec
    ? <button type="button" className="btn sp-recon" onClick={() => rec.stop()}><i className="sp-recdot" />Dừng · {fmtDur(sec)}</button>
    : <button type="button" className="btn" onClick={start}><I.Mic size={14} />{label}</button>;
}

// ---- trình phát ----
const peaksCache = new Map<string, number[]>();
let playingEl: HTMLAudioElement | null = null;
async function peaksOf(src: string, n: number): Promise<number[]> {
  const k = `${n}:${src}`;
  if (peaksCache.has(k)) return peaksCache.get(k)!;
  const buf = await fetch(src).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); });
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const a = await ctx.decodeAudioData(buf);
    const d = a.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out: number[] = [];
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 16) m = Math.max(m, Math.abs(d[j])); out.push(m); }
    const top = Math.max(0.01, ...out);
    const res = out.map((x) => 0.12 + 0.88 * (x / top));
    peaksCache.set(k, res);
    return res;
  } finally { ctx.close().catch(() => {}); }
}
// Dạng sóng vẽ từ chính âm thanh (giải mã trên trình duyệt); bấm để tua.
export function Wave({ src, n = 56, progress = 0, h = 26, onSeek }: { src?: string | null; n?: number; progress?: number; h?: number; onSeek?: (f: number) => void }) {
  const [bars, setBars] = useState<number[] | null>(null);
  useEffect(() => {
    let dead = false;
    if (src) peaksOf(src, n).then((b) => !dead && setBars(b)).catch(() => !dead && setBars(null));
    return () => { dead = true; };
  }, [src, n]);
  const list = bars ?? Array.from({ length: n }, () => 0.3);
  return (
    <span className="sp-wave" aria-hidden="true" style={{ height: h, cursor: onSeek ? "pointer" : undefined }}
      onClick={(e) => { if (!onSeek) return; const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }}>
      {list.map((b, i) => <i key={i} style={{ height: `${Math.round(b * 100)}%`, background: i / n < progress ? "var(--text)" : undefined }} />)}
    </span>
  );
}
/** Trình phát âm thanh thật: phát / tạm dừng, tua trên dạng sóng, tải xuống. Mỗi lúc chỉ một trình phát chạy. */
export function Player({ src, title, dl, name, seekTo, onTime }: { src: string | null; title?: string; dl?: string | null; name?: string; seekTo?: { t: number; n: number }; onTime?: (t: number) => void }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [play, setPlay] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  useEffect(() => {
    if (!src) return;
    const a = new Audio(src);
    a.preload = "metadata";
    ref.current = a;
    a.onloadedmetadata = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    a.ontimeupdate = () => { setT(a.currentTime); onTime?.(a.currentTime); };
    a.onplay = () => { if (playingEl && playingEl !== a) playingEl.pause(); playingEl = a; setPlay(true); };
    a.onpause = () => setPlay(false);
    a.onended = () => { setPlay(false); setT(0); };
    return () => { a.pause(); a.src = ""; if (playingEl === a) playingEl = null; };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = ref.current; if (a && seekTo) { a.currentTime = seekTo.t; void a.play().catch(() => {}); } }, [seekTo]);
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); };
  const seek = (f: number) => { const a = ref.current; if (a && dur) { a.currentTime = f * dur; setT(a.currentTime); } };
  const save = () => {
    if (!dl) return;
    const a = document.createElement("a");
    if (dl.startsWith("data:") || dl.startsWith("blob:")) { a.href = dl; a.download = name ?? "synchro-audio"; } else a.href = dl + (dl.includes("?") ? "&" : "?") + "dl=1";
    document.body.appendChild(a); a.click(); a.remove();
  };
  return (
    <div className="sp-player">
      <button className="sp-pbtn" aria-label={play ? "Tạm dừng" : "Phát"} onClick={toggle} disabled={!src}>{play ? <I.Pause size={14} /> : <I.Play size={14} />}</button>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {title && <span className="sp-ptitle">{title}</span>}
        <Wave src={src} progress={dur ? t / dur : 0} onSeek={seek} />
      </div>
      <span className="sp-time">{fmtDur(t)} / {fmtDur(dur)}</span>
      {dl && <button className="icon-btn" aria-label="Tải xuống" title="Tải xuống" onClick={save}><I.Download size={17} /></button>}
    </div>
  );
}

// Ô chọn model ElevenLabs có mô tả ngắn, dùng chung cho Đọc văn bản và Voice Agent.
export function ModelPick({ models, value, onChange }: { models: { id: string; name: string; note: string }[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const m = models.find((x) => x.id === value) ?? models[0];
  if (!m) return <div className="sp-note">Chưa có model nào.</div>;
  return (
    <div className="sp-mpick">
      <button className="sp-vbig" aria-expanded={open} onClick={() => setOpen(!open)}><span><b>{m.name}</b><small>{m.note}</small></span><I.Chevron size={14} /></button>
      {open && (
        <div className="sp-mmenu" role="listbox" aria-label="Model">
          {models.map((x) => (
            <button key={x.id} role="option" aria-selected={x.id === value} className={x.id === value ? "on" : ""} onClick={() => { onChange(x.id); setOpen(false); }}>
              <span><b>{x.name}</b><small>{x.note}</small></span>{x.id === value && <I.Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Tab gạch chân cho các mục trong một trang.
export function Tabs<T extends string>({ items, value, onChange, label }: { items: { k: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sp-utabs" role="tablist" aria-label={label}>
      {items.map((x) => <button key={x.k} role="tab" aria-selected={value === x.k} className={value === x.k ? "on" : ""} onClick={() => onChange(x.k)}>{x.label}</button>)}
    </div>
  );
}

// Ảnh đại diện giọng: quả cầu màu chuyển động nhẹ, màu cố định theo id giọng.
export function VoiceAvatar({ v, size = 22, playing }: { v: { id: string } | null; size?: number; playing?: boolean }) {
  return <span className={`sp-av ${playing ? "on" : ""}`} style={{ width: size, height: size }}><LiquidOrb hue={v ? hueOf(v.id) : 210} activity={playing ? talking : 0} /></span>;
}
export const voiceLine = (v: Voice) => [v.desc, v.lang, v.accent].filter(Boolean).join(" · ");
export function VoiceChip({ v, onClick, small }: { v: Voice | null; onClick: () => void; small?: boolean }) {
  return <button type="button" className={`sp-vchip ${small ? "sm" : ""}`} onClick={onClick}><VoiceAvatar v={v} size={small ? 18 : 22} /><span>{v ? `${v.name}${v.desc ? ` · ${v.desc}` : ""}` : "Chọn giọng"}</span><I.Chevron size={12} /></button>;
}

// Quả cầu giọng nói lớn kèm nút phát và vòng tiến độ “tối thiểu / tốt nhất” như trang tạo giọng.
export function OrbStage({ hue, active, progress, min, best, size = 168, onPlay, playing }: { hue: number; active?: boolean; progress?: number; min?: string; best?: string; size?: number; onPlay?: () => void; playing?: boolean }) {
  const r = size / 2 + 14, c = 2 * Math.PI * r;
  return (
    <div className="sp-orbstage" style={{ width: size + 40, height: size + 40 }}>
      {progress !== undefined && (
        <svg className="sp-dial" viewBox={`0 0 ${size + 40} ${size + 40}`} aria-hidden="true">
          <circle cx={(size + 40) / 2} cy={(size + 40) / 2} r={r} pathLength={c} strokeDasharray="2 6" />
          <circle className="p" cx={(size + 40) / 2} cy={(size + 40) / 2} r={r} strokeDasharray={`${c * Math.min(1, progress)} ${c}`} />
        </svg>
      )}
      <div className="sp-orbc" style={{ width: size, height: size }}><LiquidOrb hue={hue} activity={active || playing ? talking : 0} /></div>
      {onPlay && <button className="sp-orbplay" onClick={onPlay} aria-label={playing ? "Dừng nghe" : "Nghe thử"}>{playing ? <I.Pause size={16} /> : <I.Play size={16} />}</button>}
      {min && <span className="sp-dial-l"><b>Tối thiểu</b>{min}</span>}
      {best && <span className="sp-dial-r"><b>Tốt nhất</b>{best}</span>}
    </div>
  );
}

/** Nút đang làm việc / thông báo lỗi dùng chung. */
export const Spin = () => <span className="sp-spin" />;
export function ErrBox({ msg }: { msg: string }) { return msg ? <div className="api-err" role="alert"><I.Alert size={14} /><span>{msg}</span></div> : null; }

function Sec({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="sp-fsec">
      <button className="sp-fsec-h" aria-expanded={open} onClick={onToggle}>{title}<span className={`sec-chev ${open ? "open" : ""}`}>{open ? <I.Chevron size={14} /> : <I.ChevronR size={14} />}</span></button>
      {open && <div className="sp-fsec-b">{children}</div>}
    </div>
  );
}
const CAT_ICON: Record<string, (p: { size?: number }) => React.ReactNode> = { conversational: I.Chat2, narrative_story: I.Book, characters_animation: I.Sparkle, social_media: I.Heart, informative_educational: I.Grad, advertisement: I.Speaker, entertainment_tv: I.Film };
const flag = (code: string) => (code ? code.split(/[-_]/)[0].toUpperCase().slice(0, 2) : "··");

// Nghe thử giọng (preview_url của ElevenLabs, không tốn credit).
function usePreview() {
  const [cur, setCur] = useState<string | null>(null);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { el.current?.pause(); }, []);
  const toggle = (v: Voice) => {
    if (cur === v.id) { el.current?.pause(); setCur(null); return; }
    el.current?.pause();
    if (!v.preview) { setCur(null); return; }
    const a = new Audio(v.preview); el.current = a; a.onended = () => setCur(null);
    void a.play().then(() => setCur(v.id)).catch(() => setCur(null));
  };
  return [cur, toggle] as const;
}

/** Bộ chọn giọng: “Giọng của tôi” là giọng trong tài khoản ElevenLabs dùng được với gói; “Thư viện” là thư viện cộng đồng
 *  (chỉ hiện khi gói dùng được giọng Thư viện qua API — gói Free thì không). */
export function VoicePicker({ value, onPick, onClose, say }: { value?: string; onPick: (v: Voice) => void; onClose: () => void; say: (m: string) => void }) {
  const plan = usePlan();
  const mine = useMyVoices();
  const [tab, setTab] = useState<"mine" | "lib">("mine");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("");
  const [cat, setCat] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ cat: true, gender: true, age: false });
  const [filters, setFilters] = useState(false);
  const [lib, setLib] = useState<Voice[] | null>(null);
  const [busy, setBusy] = useState("");
  const [vid, setVid] = useState("");
  const [playing, toggle] = usePreview();
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { input.current?.focus(); const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } }; window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true); }, []);
  // Thư viện: lọc ở máy chủ ElevenLabs (gõ xong 350 ms mới tìm).
  useEffect(() => {
    if (tab !== "lib") return;
    let dead = false;
    setLib(null);
    const t = setTimeout(() => {
      const p = new URLSearchParams({ lib: "1", q, lang, gender, age, use: cat });
      api<{ voices: Voice[] }>(`voices?${p}`).then((j) => !dead && setLib(j.voices)).catch((e: Error) => { if (!dead) { setLib([]); say(e.message); } });
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [tab, q, lang, gender, age, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    if (tab === "lib") return lib;
    if (!mine) return null;
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return mine.filter((v) => w.every((x) => `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.gender} ${v.age} ${v.use}`.toLowerCase().includes(x)) && (!lang || v.langCode.startsWith(lang))
      && (!gender || v.gender === GENDERS.find((g) => g[1] === gender)?.[0]) && (!age || v.age === AGES.find((g) => g[1] === age)?.[0]));
  }, [tab, lib, mine, q, lang, gender, age]);
  const nFilters = (cat ? 1 : 0) + (gender ? 1 : 0) + (age ? 1 : 0) + (lang ? 1 : 0);
  const reset = () => { setCat(""); setGender(""); setAge(""); setLang(""); };
  const pill = (label: string, active: boolean, flip: () => void, Icon?: (p: { size?: number }) => React.ReactNode) => (
    <button key={label} className={`sp-fpill ${active ? "on" : ""}`} aria-pressed={active} onClick={flip}>{Icon && <Icon size={13} />}{label}</button>
  );
  const sec = (k: string, title: string, body: React.ReactNode) => <Sec key={k} title={title} open={!!open[k]} onToggle={() => setOpen({ ...open, [k]: !open[k] })}>{body}</Sec>;
  const slots = plan?.voices;
  // Thêm giọng thư viện vào tài khoản (tốn một chỗ lưu giọng của gói) rồi chọn luôn.
  const add = async (v: Voice) => {
    setBusy(v.id);
    try {
      const j = await post<{ voiceId: string }>("voices/add", { owner: v.owner, id: v.id, name: v.name });
      await reloadVoices(true);
      onPick({ ...v, id: j.voiceId, mine: true }); say(`Đã thêm “${v.name}” vào Giọng của tôi`); onClose();
    } catch (e) { say((e as Error).message); } finally { setBusy(""); }
  };
  const useId = async () => {
    const id = vid.trim();
    if (!/^[A-Za-z0-9]{16,40}$/.test(id)) { say("Voice ID không hợp lệ (16–40 ký tự chữ và số)"); return; }
    setBusy("id");
    try {
      const j = await api<{ voice: Voice }>(`voices?id=${encodeURIComponent(id)}`);
      onPick(j.voice); say(`Đã chọn giọng “${j.voice.name}”`); onClose();
    } catch (e) { say((e as Error).message); } finally { setBusy(""); }
  };
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal sp-picker ${filters ? "show-f" : ""}`} role="dialog" aria-modal="true" aria-label="Chọn giọng">
        <aside className="sp-pf" aria-label="Bộ lọc">
          <div className="sp-pf-h"><b>Bộ lọc</b>{nFilters > 0 && <button className="sp-link" onClick={reset}>Xóa {nFilters} bộ lọc</button>}<button className="icon-btn sp-pf-x" onClick={() => setFilters(false)} aria-label="Đóng bộ lọc"><I.X size={16} /></button></div>
          <Select id="vp-lang" label="Ngôn ngữ" value={lang} options={LANGS.map(([c, n]) => [c, c ? n : "Tất cả ngôn ngữ"] as [string, string])} onChange={setLang} />
          {tab === "lib" && sec("cat", "Danh mục", <div className="sp-fpills">{CATEGORIES.map(([l, k]) => pill(l, cat === k, () => setCat(cat === k ? "" : k), CAT_ICON[k]))}</div>)}
          {sec("gender", "Giới tính", <div className="sp-fpills">{GENDERS.map(([l, k]) => pill(l, gender === k, () => setGender(gender === k ? "" : k)))}</div>)}
          {sec("age", "Độ tuổi", <div className="sp-fpills">{AGES.map(([l, k]) => pill(l, age === k, () => setAge(age === k ? "" : k)))}</div>)}
        </aside>
        <div className="sp-pm">
          <div className="sp-pm-h">
            {plan?.library && <Seg label="Nguồn giọng" value={tab} onChange={setTab} items={[{ k: "mine", label: "Giọng của tôi" }, { k: "lib", label: "Thư viện" }]} />}
            <label className="sp-search"><I.Search size={15} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm giọng: tên, “ấm áp”, “kể chuyện”…" aria-label="Tìm giọng" /></label>
            <button className={`icon-btn sp-pf-t ${nFilters ? "on" : ""}`} onClick={() => setFilters(true)} aria-label="Bộ lọc"><I.Sliders size={17} />{nFilters > 0 && <i>{nFilters}</i>}</button>
            <button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={18} /></button>
          </div>
          <div className="sp-vlist" role="listbox" aria-label="Danh sách giọng">
            {list === null && <div className="sp-empty"><Spin /> Đang tải giọng từ ElevenLabs…</div>}
            {list?.length === 0 && <div className="sp-empty">{tab === "lib" ? "Không có giọng khớp. Thử bỏ bớt bộ lọc." : "Không có giọng khớp."}</div>}
            {list?.map((v) => (
              <div key={v.id} role="option" aria-selected={value === v.id} className={`sp-vrow ${value === v.id ? "is-sel" : ""} ${playing === v.id ? "playing" : ""}`}>
                <button className="sp-avbtn" aria-label={playing === v.id ? `Dừng nghe ${v.name}` : `Nghe thử ${v.name}`} onClick={() => toggle(v)} disabled={!v.preview}>
                  <VoiceAvatar v={v} size={34} playing={playing === v.id} /><span className="sp-avplay">{playing === v.id ? <I.Pause size={12} /> : <I.Play size={12} />}</span>
                </button>
                <div className="sp-vmeta"><b data-notr>{v.name}{v.desc ? ` · ${v.desc}` : ""}</b><span>{v.mine ? CAT_LABEL[v.category] ?? v.category : [v.use, v.gender, v.age].filter(Boolean).join(" · ")}</span></div>
                <span className="sp-vlang"><span className="sp-flag">{flag(v.langCode)}</span>{v.lang || "Đa ngôn ngữ"}{v.accent && <em>{v.accent}</em>}</span>
                {!v.mine && <span className="sp-vnum" title="Lượt nhân bản"><I.User size={13} />{fmtNum(v.uses ?? 0)}</span>}
                <span className="sp-vact">
                  {v.mine
                    ? <button className="btn dark sp-use" onClick={() => { onPick(v); onClose(); }}>{value === v.id ? "Đang dùng" : "Dùng"}</button>
                    : v.added ? <span className="sp-muted">Đã thêm</span>
                    : <button className="btn dark sp-use" disabled={!!busy || (!!slots && slots.limit > 0 && slots.used >= slots.limit)} title={slots && slots.used >= slots.limit ? "Đã dùng hết chỗ lưu giọng của gói" : undefined} onClick={() => add(v)}>{busy === v.id ? <Spin /> : <I.Plus size={13} />}Thêm và dùng</button>}
                </span>
              </div>
            ))}
            {tab === "lib" && slots && slots.limit > 0 && <p className="sp-vnote">Đã dùng {slots.used}/{slots.limit} chỗ lưu giọng của gói {plan?.tierName}. Nghe thử miễn phí, không tốn credit.</p>}
          </div>
          {/* Dán Voice ID từ Thư viện: chỉ có ích khi gói dùng được giọng Thư viện qua API. */}
          {plan?.library && <div className="sp-vp-foot">
            <label htmlFor="sp-vid">Hoặc dán Voice ID từ ElevenLabs</label>
            <div className="sp-vid">
              <input id="sp-vid" value={vid} onChange={(e) => setVid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void useId(); }} placeholder="vd. JBFqnCBsd6RMkjVDRZzb" spellCheck={false} />
              <button className="btn dark" onClick={useId} disabled={!vid.trim() || !!busy}>{busy === "id" ? <Spin /> : null}Dùng ID này</button>
            </div>
            <span className="sp-hint"><a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer">Mở Thư viện giọng ElevenLabs<I.External size={12} /></a> · chọn giọng, bấm “Copy voice ID”, dán vào đây.</span>
          </div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Trạng thái khi chưa gắn ElevenLabs hoặc gói chưa có tính năng. */
export function NotReady({ admin }: { admin: boolean }) {
  const plan = usePlan();
  if (!plan) return <div className="sp-empty"><Spin /> Đang đọc gói ElevenLabs…</div>;
  return (
    <div className="sp-card sp-detect">
      <span className="sp-tic big"><I.Speaker size={26} /></span>
      <b>{plan.connected ? "Gói ElevenLabs hiện tại chưa có tính năng này" : "Chưa kết nối ElevenLabs"}</b>
      <p>{plan.note ?? (plan.connected ? "Tính năng sẽ tự hiện khi gói được nâng." : admin ? "Thêm khóa API ElevenLabs ở Cài đặt → Providers để dùng giọng nói thật." : "Nhờ quản trị viên thêm khóa API ElevenLabs ở Cài đặt → Providers.")}</p>
    </div>
  );
}
export const has = on;
