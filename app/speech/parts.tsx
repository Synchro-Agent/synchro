"use client";
// Thành phần dùng chung của mục Speech: tab, thanh trượt, công tắc, chọn, vùng thả tệp, dạng sóng, trình phát, bộ chọn giọng.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "../icons";
import { CATEGORIES, NOTICES, fmtUses, MY_VOICES, VOICES, KIND_LABEL, type Voice } from "./data";
import { LiquidOrb } from "../liquidorb";

// Mức hoạt động giả lập khi đang nghe thử (âm tiết và quãng nghỉ), dùng chung cho các quả cầu.
const talking = () => { const t = performance.now() / 1000; return Math.max(0, Math.sin(t * 0.85) + 0.35) * (0.12 + Math.max(0, Math.sin(t * 9.3 + Math.sin(t * 2.1))) ** 2 * 0.6); };

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
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
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

// Tab gạch chân cho các mục trong một trang (giống Settings/History của ElevenLabs).
export function Tabs<T extends string>({ items, value, onChange, label }: { items: { k: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sp-utabs" role="tablist" aria-label={label}>
      {items.map((x) => <button key={x.k} role="tab" aria-selected={value === x.k} className={value === x.k ? "on" : ""} onClick={() => onChange(x.k)}>{x.label}</button>)}
    </div>
  );
}

// Ảnh đại diện giọng: quả cầu màu chuyển động nhẹ bên trong (CSS, nhẹ hơn WebGL khi có nhiều giọng trong danh sách).
export function VoiceAvatar({ v, size = 22, playing }: { v: Voice; size?: number; playing?: boolean }) {
  return <span className={`sp-av ${playing ? "on" : ""}`} style={{ width: size, height: size }}><LiquidOrb hue={v.hue ?? 210} activity={playing ? talking : 0} /></span>;
}

export function VoiceChip({ v, onClick, small }: { v: Voice; onClick: () => void; small?: boolean }) {
  return <button className={`sp-vchip ${small ? "sm" : ""}`} onClick={onClick}><VoiceAvatar v={v} size={small ? 18 : 22} /><span>{v.name} · {v.desc}</span><I.Chevron size={12} /></button>;
}

// Quả cầu giọng nói lớn (WebGL) kèm nút phát và vòng tiến độ “tối thiểu / tốt nhất” như trang tạo giọng.
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

function Sec({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="sp-fsec">
      <button className="sp-fsec-h" aria-expanded={open} onClick={onToggle}>{title}<span className={`sec-chev ${open ? "open" : ""}`}>{open ? <I.Chevron size={14} /> : <I.ChevronR size={14} />}</span></button>
      {open && <div className="sp-fsec-b">{children}</div>}
    </div>
  );
}

const LANG_CODE: Record<string, string> = { "Tiếng Việt": "VN", "Tiếng Anh": "EN", "Tiếng Nhật": "JP", "Tiếng Hàn": "KR", "Tiếng Trung": "CN", "Tiếng Pháp": "FR", "Tiếng Đức": "DE", "Tiếng Thái": "TH", "Tiếng Tây Ban Nha": "ES", "Tiếng Indonesia": "ID", "Tiếng Hindi": "IN" };
const CAT_ICON: Record<string, (p: { size?: number }) => React.ReactNode> = { "Hội thoại": I.Chat2, "Kể chuyện": I.Book, "Nhân vật": I.Sparkle, "Mạng xã hội": I.Heart, "Giáo dục": I.Grad, "Quảng cáo": I.Speaker, "Giải trí": I.Film };

// Bộ chọn giọng (theo bố cục ElevenLabs): cột bộ lọc bên trái, danh sách giọng bên phải, dán Voice ID ở dưới.
export function VoicePicker({ value, onPick, onClose, say }: { value?: string; onPick: (v: Voice) => void; onClose: () => void; say: (m: string) => void }) {
  const [tab, setTab] = useState<"lib" | "mine">("lib");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("Tất cả ngôn ngữ");
  const [cats, setCats] = useState<string[]>([]);
  const [gender, setGender] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [excl, setExcl] = useState(true);
  const [studio, setStudio] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ cat: true, gender: true, age: false, notice: false, rates: false, quality: false });
  const [sort, setSort] = useState("Thịnh hành");
  const [sortOpen, setSortOpen] = useState(false);
  const [filters, setFilters] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [vid, setVid] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { input.current?.focus(); const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } }; window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true); }, []);
  const langs = useMemo(() => ["Tất cả ngôn ngữ", ...Array.from(new Set(VOICES.map((x) => x.lang)))], []);
  const list = useMemo(() => {
    const src = tab === "lib" ? VOICES : MY_VOICES;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let r = src.filter((v) => {
      const hay = `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.gender} ${v.age} ${v.use}`.toLowerCase();
      return words.every((w) => hay.includes(w)) && (lang === "Tất cả ngôn ngữ" || v.lang === lang) && (!cats.length || cats.includes(v.use)) && (!gender || v.gender === gender) && (!age || v.age === age) && (!notice || v.notice === notice) && (!studio || v.studio);
    });
    if (sort === "Mới nhất") r = [...r].reverse(); else if (sort === "Tên A–Z") r = [...r].sort((a, b) => a.name.localeCompare(b.name)); else r = [...r].sort((a, b) => b.uses - a.uses);
    return r;
  }, [tab, q, lang, cats, gender, age, notice, studio, sort]);
  const nFilters = cats.length + (gender ? 1 : 0) + (age ? 1 : 0) + (notice ? 1 : 0) + (studio ? 1 : 0) + (lang !== "Tất cả ngôn ngữ" ? 1 : 0);
  const reset = () => { setCats([]); setGender(null); setAge(null); setNotice(null); setStudio(false); setLang("Tất cả ngôn ngữ"); };
  const pill = (label: string, on: boolean, toggle: () => void, Icon?: (p: { size?: number }) => React.ReactNode) => (
    <button key={label} className={`sp-fpill ${on ? "on" : ""}`} aria-pressed={on} onClick={toggle}>{Icon && <Icon size={13} />}{label}</button>
  );
  const sec = (k: string, title: string, body: React.ReactNode) => <Sec key={k} title={title} open={!!open[k]} onToggle={() => setOpen({ ...open, [k]: !open[k] })}>{body}</Sec>;
  const useId = () => {
    const id = vid.trim();
    if (!/^[A-Za-z0-9]{16,40}$/.test(id)) { say("Voice ID không hợp lệ (16–40 ký tự chữ và số)"); return; }
    onPick({ id, name: "Voice ID", desc: id.slice(0, 8) + "…", lang: "Tự nhận diện", accent: "", gender: "Nữ", age: "Trẻ", use: "", uses: 0, color: "#d9d6cc", hue: 200 });
    say("Đã chọn giọng theo Voice ID");
    onClose();
  };
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal sp-picker ${filters ? "show-f" : ""}`} role="dialog" aria-modal="true" aria-label="Chọn giọng">
        <aside className="sp-pf" aria-label="Bộ lọc">
          <div className="sp-pf-h"><b>Bộ lọc</b>{nFilters > 0 && <button className="sp-link" onClick={reset}>Xóa {nFilters} bộ lọc</button>}<button className="icon-btn sp-pf-x" onClick={() => setFilters(false)} aria-label="Đóng bộ lọc"><I.X size={16} /></button></div>
          <Select id="vp-lang" label="Ngôn ngữ" value={lang} options={langs} onChange={setLang} />
          {sec("cat", "Danh mục", <div className="sp-fpills">{CATEGORIES.map((c) => pill(c, cats.includes(c), () => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]), CAT_ICON[c]))}</div>)}
          {sec("gender", "Giới tính", <div className="sp-fpills">{["Nam", "Nữ", "Trung tính"].map((g) => pill(g, gender === g, () => setGender(gender === g ? null : g)))}</div>)}
          {sec("age", "Độ tuổi", <div className="sp-fpills">{["Trẻ", "Trung niên", "Lớn tuổi"].map((g) => pill(g, age === g, () => setAge(age === g ? null : g)))}</div>)}
          {sec("notice", "Thời hạn báo trước", <div className="sp-fpills">{NOTICES.map((g) => pill(g, notice === g, () => setNotice(notice === g ? null : g)))}</div>)}
          {sec("rates", "Giá riêng", <div className="sp-fpills">{pill("Loại trừ", excl, () => setExcl(!excl))}</div>)}
          {sec("quality", "Chất lượng", <div className="sp-fpills">{pill("Chất lượng studio", studio, () => setStudio(!studio))}</div>)}
        </aside>
        <div className="sp-pm">
          <div className="sp-pm-h">
            <Seg label="Nguồn giọng" value={tab} onChange={setTab} items={[{ k: "lib", label: "Khám phá" }, { k: "mine", label: "Giọng của tôi" }]} />
            <label className="sp-search"><I.Search size={15} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm giọng: tên, “ấm áp”, “kể chuyện”…" aria-label="Tìm giọng" /></label>
            <button className={`icon-btn sp-pf-t ${nFilters ? "on" : ""}`} onClick={() => setFilters(true)} aria-label="Bộ lọc"><I.Sliders size={17} />{nFilters > 0 && <i>{nFilters}</i>}</button>
            <div style={{ position: "relative" }}>
              <button className="icon-btn" aria-label={`Sắp xếp: ${sort}`} aria-expanded={sortOpen} onClick={() => setSortOpen(!sortOpen)}><I.Sort size={17} /></button>
              {sortOpen && <div className="sp-mmenu right" role="menu">{["Thịnh hành", "Dùng nhiều nhất", "Mới nhất", "Tên A–Z"].map((x) => <button key={x} role="menuitemradio" aria-checked={sort === x} className={sort === x ? "on" : ""} onClick={() => { setSort(x); setSortOpen(false); }}><span><b>{x}</b></span>{sort === x && <I.Check size={14} />}</button>)}</div>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={18} /></button>
          </div>
          <div className="sp-vlist" role="listbox" aria-label="Danh sách giọng">
            {tab === "lib" && !q && !nFilters && (
              <div className="sp-vrow auto" role="option" aria-selected={false}>
                <span className="sp-autoic"><I.Sparkle size={15} /></span>
                <div className="sp-vmeta"><b>Tự chọn giọng</b><span>Chọn giọng phù hợp với văn bản mỗi lần tạo</span></div>
                <button className="btn dark sp-use" onClick={() => { onPick({ ...VOICES[0], id: "auto", name: "Tự chọn", desc: "theo văn bản" }); onClose(); }}>Dùng</button>
              </div>
            )}
            {list.length === 0 && <div className="sp-empty">Không có giọng khớp. Thử bỏ bớt bộ lọc, hoặc dán Voice ID ở dưới.</div>}
            {list.map((v) => (
              <div key={v.id} role="option" aria-selected={value === v.id} className={`sp-vrow ${value === v.id ? "is-sel" : ""} ${playing === v.id ? "playing" : ""}`}>
                <button className="sp-avbtn" aria-label={playing === v.id ? `Dừng nghe ${v.name}` : `Nghe thử ${v.name}`} onClick={() => setPlaying(playing === v.id ? null : v.id)}>
                  <VoiceAvatar v={v} size={34} playing={playing === v.id} /><span className="sp-avplay">{playing === v.id ? <I.Pause size={12} /> : <I.Play size={12} />}</span>
                </button>
                <div className="sp-vmeta"><b>{v.name} · {v.desc}</b><span>{v.kind ? KIND_LABEL[v.kind] : v.use}</span></div>
                <span className="sp-vlang"><span className="sp-flag">{LANG_CODE[v.lang] ?? "··"}</span>{v.lang}<em>{v.accent}</em>{!!v.more && <small>+{v.more}</small>}</span>
                <span className="sp-vnum" title="Thời hạn báo trước"><I.Clock size={13} />{v.notice ?? "—"}</span>
                <span className="sp-vnum" title="Lượt dùng"><I.User size={13} />{v.uses ? fmtUses(v.uses).replace(" lượt", "") : "0"}</span>
                <span className="sp-vact">
                  <button className="btn dark sp-use" onClick={() => { onPick(v); onClose(); }}>{value === v.id ? "Đang dùng" : "Dùng"}</button>
                  {tab === "lib" && <button className="btn sp-use" onClick={() => say(`Đã thêm “${v.name}” vào Giọng của tôi`)}><I.Plus size={13} />Thêm</button>}
                </span>
              </div>
            ))}
            {tab === "lib" && excl && <p className="sp-vnote">Đã ẩn các giọng có giá riêng. Nghe thử miễn phí, không tốn credit.</p>}
          </div>
          <div className="sp-vp-foot">
            <label htmlFor="sp-vid">Hoặc dán Voice ID từ ElevenLabs</label>
            <div className="sp-vid">
              <input id="sp-vid" value={vid} onChange={(e) => setVid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") useId(); }} placeholder="vd. JBFqnCBsd6RMkjVDRZzb" spellCheck={false} />
              <button className="btn dark" onClick={useId} disabled={!vid.trim()}>Dùng ID này</button>
            </div>
            <span className="sp-hint"><a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer">Mở Thư viện giọng ElevenLabs<I.External size={12} /></a> · chọn giọng, bấm “Copy voice ID”, dán vào đây.</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
