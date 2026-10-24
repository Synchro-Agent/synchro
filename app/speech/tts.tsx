"use client";
// Đọc văn bản: một giọng hoặc hội thoại nhiều người nói, thẻ cảm xúc, cài đặt giọng, lịch sử.
import { useRef, useState } from "react";
import * as I from "../icons";
import { FORMATS, LANGS, TAGS, TTS_MODELS, VOICES, fmtNum, type Voice } from "./data";
import { Field, Player, Range, Seg, Select, Tabs, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

const SAMPLE = "Chào mừng bạn đến với Synchro. [excited] Hôm nay chúng ta sẽ cùng khám phá cách biến bất kỳ văn bản nào thành giọng nói tự nhiên, chỉ trong vài giây. [short pause] Bạn chỉ cần nhập nội dung, chọn giọng, rồi bấm tạo.";
const MAX = 40_000;

type Line = { id: number; sp: number; text: string };
const HISTORY = [
  { id: 1, text: "Chào mừng bạn đến với Synchro. Hôm nay chúng ta sẽ cùng khám phá…", voice: VOICES[0], model: "Eleven v4", dur: 18, when: "10:42", seed: 5 },
  { id: 2, text: "Ưu đãi chỉ trong tuần này: giảm 30% cho mọi đơn hàng đầu tiên.", voice: VOICES[1], model: "Flash v2.5", dur: 6, when: "09:15", seed: 7 },
  { id: 3, text: "[whispers] Bạn có nghe thấy không? Có ai đó đang gõ cửa…", voice: VOICES[2], model: "Eleven v4", dur: 9, when: "Hôm qua", seed: 11 },
];

export function TTS({ say, demo, sub, setSub, draft }: ToolProps) {
  const mode = sub === "dialogue" ? "dialogue" : "single";
  const [text, setText] = useState(draft || SAMPLE);
  const [voice, setVoice] = useState<Voice>(VOICES[0]);
  const [speakers, setSpeakers] = useState<Voice[]>([VOICES[0], VOICES[1]]);
  const [lines, setLines] = useState<Line[]>([
    { id: 1, sp: 0, text: "[excited] Anh Minh ơi, bản thu hôm qua nghe hay lắm!" },
    { id: 2, sp: 1, text: "Thật à? [laughs] Anh còn lo đoạn giữa hơi chậm." },
    { id: 3, sp: 0, text: "Không đâu, nhịp vừa đủ để người nghe kịp thở." },
  ]);
  const [pick, setPick] = useState<null | "main" | number>(null);
  const [panel, setPanel] = useState<"set" | "hist">("set");
  const [model, setModel] = useState(TTS_MODELS[0].id);
  const [lang, setLang] = useState("Tự nhận diện");
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [style, setStyle] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [boost, setBoost] = useState(true);
  const [fmt, setFmt] = useState(FORMATS[1]);
  const [norm, setNorm] = useState("Tự động");
  const [seed, setSeed] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [result, setResult] = useState<null | { dur: number; seed: number }>(null);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const m = TTS_MODELS.find((x) => x.id === model)!;
  const chars = mode === "single" ? text.length : lines.reduce((n, l) => n + l.text.length, 0);
  const cost = Math.ceil(chars * m.rate);

  const insertTag = (tag: string) => {
    const el = ta.current;
    if (!el) { setText((t) => t + " " + tag); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    const next = text.slice(0, s) + tag + " " + text.slice(e);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + tag.length + 1; });
  };
  const generate = () => {
    if (!chars) return;
    setBusy(true);
    setTimeout(() => { setBusy(false); setResult({ dur: Math.max(4, Math.round(chars / 15)), seed: chars % 50 }); demo(); }, 900);
  };

  return (
    <div className="sp-split">
      <div className="sp-main">
        <ToolHead title="Đọc văn bản" desc="Biến văn bản thành giọng nói tự nhiên. Thêm thẻ trong ngoặc vuông để điều khiển cảm xúc.">
          <Seg label="Chế độ" value={mode} onChange={setSub} items={[{ k: "single", label: "Một giọng" }, { k: "dialogue", label: "Hội thoại" }]} />
        </ToolHead>

        <div className="sp-tags" aria-label="Chèn thẻ cảm xúc">
          {TAGS.map(([t, vi]) => <button key={t} className="sp-tag" title={`Thẻ cảm xúc: ${vi}`} onClick={() => (mode === "single" ? insertTag(t) : setLines((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, text: l.text + " " + t } : l))))}>{t}</button>)}
        </div>

        {mode === "single" ? (
          <div className="sp-editor">
            <textarea ref={ta} value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} aria-label="Văn bản" placeholder="Nhập văn bản cần đọc…" />
          </div>
        ) : (
          <div className="sp-dlg">
            <div className="sp-speakers">
              {speakers.map((v, i) => (
                <div key={i} className="sp-spk">
                  <span className="sp-spk-n">Người {i + 1}</span>
                  <VoiceChip small v={v} onClick={() => setPick(i)} />
                  {speakers.length > 2 && <button className="icon-btn" aria-label={`Bỏ người ${i + 1}`} onClick={() => { setSpeakers((s) => s.filter((_, j) => j !== i)); setLines((ls) => ls.map((l) => ({ ...l, sp: l.sp === i ? 0 : l.sp > i ? l.sp - 1 : l.sp }))); }}><I.X size={14} /></button>}
                </div>
              ))}
              {speakers.length < 10 && <button className="sp-add" onClick={() => setSpeakers((s) => [...s, VOICES[s.length % VOICES.length]])}><I.Plus size={14} />Thêm người nói</button>}
            </div>
            {lines.map((l) => (
              <div key={l.id} className="sp-dline">
                <span className="sp-sel sm">
                  <select aria-label="Người nói" value={l.sp} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, sp: Number(e.target.value) } : x)))}>
                    {speakers.map((v, i) => <option key={i} value={i}>{v.name}</option>)}
                  </select><I.Chevron size={12} />
                </span>
                <VoiceAvatar v={speakers[l.sp] ?? speakers[0]} size={20} />
                <textarea rows={1} value={l.text} aria-label="Lời thoại" onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, text: e.target.value } : x)))} placeholder="Lời thoại…" />
                <button className="icon-btn" aria-label="Xóa dòng" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><I.Trash size={15} /></button>
              </div>
            ))}
            <button className="sp-add" onClick={() => setLines((ls) => [...ls, { id: Date.now(), sp: ls.length ? (ls[ls.length - 1].sp + 1) % speakers.length : 0, text: "" }])}><I.Plus size={14} />Thêm lời thoại</button>
          </div>
        )}

        <div className="sp-gen">
          <span className="sp-muted">{fmtNum(chars)} / {fmtNum(MAX)} ký tự</span>
          <span className="sp-cost">≈ {fmtNum(cost)} credit{m.rate < 1 && " · giảm 50%"}</span>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => (mode === "single" ? setText("") : setLines([]))}>Xóa</button>
          <button className="btn dark sp-go" disabled={!chars || busy} onClick={generate}>{busy ? <span className="sp-spin" /> : <I.Play size={13} />}{busy ? "Đang tạo…" : "Tạo giọng nói"}</button>
        </div>

        {result && (
          <div className="sp-result">
            <div className="sp-result-h"><b>Bản vừa tạo</b><span className="sp-muted">{mode === "single" ? voice.name : `${speakers.length} người nói`} · {m.name} · {fmt.split(" ·")[0]}</span></div>
            <Player dur={result.dur} seed={result.seed} onDemo={demo} />
            <div className="sp-result-a">
              <button className="btn" onClick={generate}><I.Retry size={14} />Tạo lại</button>
              <button className="btn" onClick={() => say("Đã sao chép liên kết chia sẻ (mẫu)")}><I.Copy size={14} />Chia sẻ</button>
              <button className="btn" onClick={() => say("Đã lưu vào Lịch sử")}><I.Heart size={14} />Lưu</button>
            </div>
          </div>
        )}
      </div>

      <aside className="sp-aside">
        <div className="sp-aside-h"><Tabs label="Bảng bên" value={panel} onChange={setPanel} items={[{ k: "set", label: "Cài đặt" }, { k: "hist", label: "Lịch sử" }]} /></div>
        {panel === "set" ? (
          <div className="sp-aside-in">
            {mode === "single" && <Field label="Giọng"><button className="sp-vbig" onClick={() => setPick("main")}><VoiceAvatar v={voice} size={30} /><span><b>{voice.name}</b><small>{voice.desc} · {voice.lang}</small></span><I.Chevron size={14} /></button></Field>}
            <Field label="Model">
              <div className="sp-mpick">
                <button className="sp-vbig" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)}><span><b>{m.name}</b><small>{m.note}</small></span><I.Chevron size={14} /></button>
                {modelOpen && (
                  <div className="sp-mmenu" role="listbox" aria-label="Model">
                    {TTS_MODELS.map((x) => (
                      <button key={x.id} role="option" aria-selected={x.id === model} className={x.id === model ? "on" : ""} onClick={() => { setModel(x.id); setModelOpen(false); }}>
                        <span><b>{x.name}</b><small>{x.note}</small></span>{x.id === model && <I.Check size={15} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Select id="tts-lang" label="Ngôn ngữ" value={lang} options={LANGS} onChange={setLang} />
            <Range id="tts-stab" label="Độ ổn định" value={stab} onChange={setStab} left="Biểu cảm hơn" right="Ổn định hơn" show={`${stab}%`} />
            <Range id="tts-sim" label="Độ giống giọng gốc" value={sim} onChange={setSim} left="Thấp" right="Cao" show={`${sim}%`} />
            <Range id="tts-style" label="Phóng đại phong cách" value={style} onChange={setStyle} left="Không phóng đại" right="Phóng đại" show={`${style}%`} />
            <Range id="tts-speed" label="Tốc độ" value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} left="Chậm" right="Nhanh" show={`${speed.toFixed(2)}×`} />
            <Toggle checked={boost} onChange={setBoost} label="Tăng độ rõ người nói" hint="Giống giọng gốc hơn, chậm hơn một chút" />
            <hr className="sp-hr" />
            <Select id="tts-fmt" label="Định dạng tải xuống" value={fmt} options={FORMATS} onChange={setFmt} />
            <Select id="tts-norm" label="Đọc số và ký hiệu" value={norm} options={["Tự động", "Luôn chuẩn hóa", "Giữ nguyên"]} onChange={setNorm} />
            <Field label="Seed" hint="Giữ kết quả lặp lại được" htmlFor="tts-seed"><input id="tts-seed" className="sp-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Ngẫu nhiên" /></Field>
            <Field label="Từ điển phát âm" hint="PLS hoặc bảng thay thế">
              <button className="sp-vbig" onClick={() => say("Chọn hoặc tải từ điển phát âm (sẽ đồng bộ khi gắn API)")}><span><b>Không dùng</b><small>Ví dụ: “Synchro” → “Xin-crô”</small></span><I.Plus size={14} /></button>
            </Field>
            <button className="sp-link" onClick={() => { setStab(50); setSim(75); setStyle(0); setSpeed(1); setBoost(true); }}>Đặt lại mặc định</button>
          </div>
        ) : (
          <div className="sp-aside-in">
            {HISTORY.map((h) => (
              <div key={h.id} className="sp-hrow">
                <div className="sp-hrow-t"><VoiceAvatar v={h.voice} size={18} /><b>{h.voice.name}</b><span className="sp-muted">{h.model} · {h.when}</span></div>
                <p>{h.text}</p>
                <Player dur={h.dur} seed={h.seed} onDemo={demo} />
                <button className="sp-link" onClick={() => { setSub("single"); setText(h.text); setVoice(h.voice); }}>Dùng lại văn bản và giọng</button>
              </div>
            ))}
          </div>
        )}
      </aside>
      {pick !== null && <VoicePicker value={pick === "main" ? voice.id : speakers[pick]?.id} say={say} onClose={() => setPick(null)}
        onPick={(v) => (pick === "main" ? setVoice(v) : setSpeakers((s) => s.map((x, i) => (i === pick ? v : x))))} />}
    </div>
  );
}
