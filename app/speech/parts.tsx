"use client";
// Thành phần dùng chung của mục Speech: tab, thanh trượt, công tắc, chọn, vùng thả tệp, dạng sóng, trình phát, bộ chọn giọng.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "../icons";
import { fmtUses, MY_VOICES, VOICES, KIND_LABEL, type Voice } from "./data";

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

export function Select({ id, label, value, options, onChange, inline }: { id: string; label: string; value: string; options: string[]; onChange: (v: string) => void; inline?: boolean }) {
  const sel = (
    <span className="sp-sel">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
      <I.Chevron size={13} />
    </span>
  );
  if (inline) return <div className="sp-line"><label htmlFor={id}>{label}</label>{sel}</div>;
  return <div className="sp-fld"><label htmlFor={id} className="sp-fl"><span>{label}</span></label>{sel}</div>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return <div className="sp-fld"><label htmlFor={htmlFor} className="sp-fl"><span>{label}</span>{hint && <em>{hint}</em>}</label>{children}</div>;
}

// Vùng thả tệp: bấm để chọn, kéo thả, hiện tên tệp đã chọn.
export function Drop({ title, sub, accept, file, onFile, multiple, compact }: { title: string; sub: string; accept?: string; file?: string | null; onFile: (f: File[]) => void; multiple?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button className={`sp-drop ${compact ? "sm" : ""} ${over ? "over" : ""} ${file ? "has" : ""}`} onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onFile(f); }}>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFile(f); e.target.value = ""; }} />
      <span className="sp-drop-ic"><I.Upload size={18} /></span>
      <b>{file ?? title}</b>
      <span>{file ? "Bấm để chọn tệp khác" : sub}</span>
    </button>
  );
}

// Dạng sóng giả lập (ổn định theo seed) — khi có API sẽ vẽ từ âm thanh thật.
export function Wave({ n = 48, seed = 1, progress = 0, h = 26, color }: { n?: number; seed?: number; progress?: number; h?: number; color?: string }) {
  const bars = useMemo(() => Array.from({ length: n }, (_, i) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return 0.25 + 0.75 * (x - Math.floor(x)); }), [n, seed]);
  return (
    <span className="sp-wave" aria-hidden="true" style={{ height: h }}>
      {bars.map((b, i) => <i key={i} style={{ height: `${Math.round(b * 100)}%`, background: i / n < progress ? color ?? "var(--text)" : undefined }} />)}
    </span>
  );
}

// Trình phát mẫu: có tiến trình và nút tải xuống. Khi gắn API sẽ phát âm thanh thật.
export function Player({ title, dur, seed = 3, onDemo }: { title?: string; dur: number; seed?: number; onDemo?: () => void }) {
  const [play, setPlay] = useState(false);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!play) return;
    const i = setInterval(() => setT((x) => { if (x + 0.2 >= dur) { setPlay(false); return 0; } return x + 0.2; }), 200);
    return () => clearInterval(i);
  }, [play, dur]);
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="sp-player">
      <button className="sp-pbtn" aria-label={play ? "Tạm dừng" : "Phát"} onClick={() => setPlay(!play)}>{play ? <I.Pause size={14} /> : <I.Play size={14} />}</button>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {title && <span className="sp-ptitle">{title}</span>}
        <Wave seed={seed} progress={t / dur} />
      </div>
      <span className="sp-time">{mm(t)} / {mm(dur)}</span>
      <button className="icon-btn" aria-label="Tải xuống" onClick={onDemo}><I.Download size={17} /></button>
    </div>
  );
}

export function VoiceAvatar({ v, size = 22 }: { v: Voice; size?: number }) {
  return <span className="sp-av" style={{ width: size, height: size, background: `radial-gradient(circle at 35% 30%, #fff8, transparent 55%), ${v.color}` }} />;
}

export function VoiceChip({ v, onClick, small }: { v: Voice; onClick: () => void; small?: boolean }) {
  return <button className={`sp-vchip ${small ? "sm" : ""}`} onClick={onClick}><VoiceAvatar v={v} size={small ? 18 : 22} />{v.name} · {v.desc}<I.Chevron size={12} /></button>;
}

// Bộ chọn giọng: tìm kiếm tức thì trong thư viện + dán thẳng Voice ID (theo đúng kiến trúc đã chọn).
export function VoicePicker({ value, onPick, onClose, say }: { value?: string; onPick: (v: Voice) => void; onClose: () => void; say: (m: string) => void }) {
  const [tab, setTab] = useState<"lib" | "mine">("lib");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState<string | null>("Tiếng Việt");
  const [gender, setGender] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [use, setUse] = useState<string | null>(null);
  const [sort, setSort] = useState("Phổ biến nhất");
  const [playing, setPlaying] = useState<string | null>(null);
  const [vid, setVid] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { input.current?.focus(); const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } }; window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true); }, []);
  const list = useMemo(() => {
    const src = tab === "lib" ? VOICES : MY_VOICES;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let r = src.filter((v) => {
      const hay = `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.gender} ${v.age} ${v.use}`.toLowerCase();
      return words.every((w) => hay.includes(w)) && (!lang || v.lang === lang) && (!gender || v.gender === gender) && (!age || v.age === age) && (!use || v.use === use);
    });
    if (sort === "Mới nhất") r = [...r].reverse(); else r = [...r].sort((a, b) => b.uses - a.uses);
    return r.slice(0, 20);
  }, [tab, q, lang, gender, age, use, sort]);
  const chip = (label: string, cur: string | null, set: (v: string | null) => void) => (
    <button key={label} className={`sp-fchip ${cur === label ? "on" : ""}`} onClick={() => set(cur === label ? null : label)}>{label}{cur === label && <I.X size={11} />}</button>
  );
  const useId = () => {
    const id = vid.trim();
    if (!/^[A-Za-z0-9]{16,40}$/.test(id)) { say("Voice ID không hợp lệ (16–40 ký tự chữ và số)"); return; }
    onPick({ id, name: "Voice ID", desc: id.slice(0, 8) + "…", lang: "Tự nhận diện", accent: "", gender: "Nữ", age: "Trẻ", use: "", uses: 0, color: "#d9d6cc" });
    say("Đã chọn giọng theo Voice ID");
  };
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sp-picker" role="dialog" aria-modal="true" aria-labelledby="sp-vp-t">
        <div className="sp-vp-head">
          <h2 id="sp-vp-t">Chọn giọng</h2>
          <Seg label="Nguồn giọng" value={tab} onChange={setTab} items={[{ k: "lib", label: "Thư viện 10.000+ giọng" }, { k: "mine", label: `Giọng của tôi · ${MY_VOICES.length}` }]} />
          <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Đóng"><I.X size={18} /></button>
        </div>
        <div className="sp-vp-search">
          <label className="sp-search"><I.Search size={16} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm giọng: tên, “ấm áp”, “kể chuyện”, “miền Nam”…" aria-label="Tìm giọng" /><span>{list.length} giọng</span></label>
          <div className="sp-fchips">
            {["Tiếng Việt", "Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn"].map((l) => chip(l, lang, setLang))}
            <span className="sp-vsep" />
            {["Nữ", "Nam"].map((g) => chip(g, gender, setGender))}
            <span className="sp-vsep" />
            {["Trẻ", "Trung niên", "Lớn tuổi"].map((a) => chip(a, age, setAge))}
            <span className="sp-vsep" />
            {["Kể chuyện", "Quảng cáo", "Hội thoại", "Tin tức", "Nhân vật"].map((u) => chip(u, use, setUse))}
            <span className="sp-sort"><select aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value)}><option>Phổ biến nhất</option><option>Đang thịnh hành</option><option>Mới nhất</option></select><I.Chevron size={12} /></span>
          </div>
        </div>
        <div className="sp-vlist" role="listbox" aria-label="Kết quả">
          {list.length === 0 && <div className="sp-empty">Không có giọng khớp. Thử bỏ bớt bộ lọc, hoặc dán Voice ID ở dưới.</div>}
          {list.map((v) => (
            <div key={v.id} role="option" aria-selected={value === v.id} className={`sp-vrow ${value === v.id ? "sel" : ""}`}>
              <button className={`sp-pp ${playing === v.id ? "on" : ""}`} aria-label={playing === v.id ? `Dừng nghe ${v.name}` : `Nghe thử ${v.name}`} onClick={() => setPlaying(playing === v.id ? null : v.id)}>{playing === v.id ? <I.Pause size={11} /> : <I.Play size={11} />}</button>
              <VoiceAvatar v={v} size={34} />
              <div className="sp-vmeta"><b>{v.name} · {v.desc}</b><span>{v.kind ? KIND_LABEL[v.kind] : `${v.accent} · ${v.use}`}</span></div>
              {playing === v.id ? <span className="sp-vplay"><Wave n={18} seed={v.uses % 97} h={18} progress={0.4} color="var(--accent)" />Đang nghe</span> : <span className="sp-vtags">{v.lang} · {v.gender} · {v.age}</span>}
              <span className="sp-vuses">{v.uses ? fmtUses(v.uses) : ""}</span>
              <button className={`btn ${value === v.id ? "dark" : ""} sp-use`} onClick={() => { onPick(v); onClose(); }}>{value === v.id ? "Đã chọn" : "Dùng"}</button>
            </div>
          ))}
          {tab === "lib" && <p className="sp-vnote">Đã ẩn các giọng có giá riêng (tính phí cao hơn). Nghe thử miễn phí, không tốn credit.</p>}
        </div>
        <div className="sp-vp-foot">
          <label htmlFor="sp-vid">Hoặc dán Voice ID từ ElevenLabs</label>
          <div className="sp-vid">
            <input id="sp-vid" value={vid} onChange={(e) => setVid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") useId(); }} placeholder="vd. JBFqnCBsd6RMkjVDRZzb" spellCheck={false} />
            <button className="btn dark" onClick={useId} disabled={!vid.trim()}>Dùng ID này</button>
          </div>
          <span className="sp-hint"><a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer">Mở Thư viện giọng ElevenLabs<I.External size={12} /></a> · chọn giọng, bấm “Copy voice ID”, dán vào đây. Synchro tự thêm giọng vào tài khoản ở lần dùng đầu.</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
