"use client";
// Đọc văn bản: một giọng hoặc hội thoại nhiều người nói, thẻ cảm xúc, cài đặt giọng, lịch sử thật (lưu riêng cho từng người).
import { useEffect, useRef, useState } from "react";
import * as I from "../icons";
import { TAGS, tagsOk } from "./data";
import { ago, del, fmtNum, on, post, useItems, useMyVoices, usePlan, type Item, type Voice } from "./client";
import { ErrBox, Field, ModelPick, Player, Range, Seg, Select, Spin, Tabs, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

type Line = { id: number; sp: number; text: string };
const NORM: [string, string][] = [["auto", "Tự động"], ["on", "Luôn chuẩn hóa"], ["off", "Giữ nguyên"]];

export function TTS({ say, sub, setSub, draft, voice: shared, setVoice: setShared }: ToolProps) {
  const plan = usePlan();
  const mine = useMyVoices();
  const dlgOk = on(plan, "dialogue");
  const mode = sub === "dialogue" && dlgOk ? "dialogue" : "single";
  const [text, setText] = useState(draft);
  const voice = shared;
  const [speakers, setSpeakers] = useState<(Voice | null)[]>([]);
  const [lines, setLines] = useState<Line[]>([{ id: 1, sp: 0, text: "" }, { id: 2, sp: 1, text: "" }]);
  const [pick, setPick] = useState<null | "main" | number>(null);
  const [panel, setPanel] = useState<"set" | "hist">("set");
  const models = plan?.tts ?? [];
  const [model, setModel] = useState("");
  const m = models.find((x) => x.id === model) ?? models.find((x) => x.id === "eleven_v4") ?? models[0];
  const [lang, setLang] = useState("");
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [style, setStyle] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [boost, setBoost] = useState(true);
  const [fmt, setFmt] = useState("mp3_44100_128");
  const [norm, setNorm] = useState("auto");
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hist, setHist] = useItems(["tts", "dialogue"]);
  const ta = useRef<HTMLTextAreaElement>(null);
  // Hội thoại: hai người nói mặc định là hai giọng đầu tiên của tài khoản.
  useEffect(() => { if (mine?.length && !speakers.length) setSpeakers([mine[0], mine[1] ?? mine[0]]); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const chars = mode === "single" ? text.length : lines.reduce((n, l) => n + l.text.length, 0);
  const cost = Math.ceil(chars * (m?.rate ?? 1));
  const left = plan ? plan.credits.limit - plan.credits.used : Infinity;
  const max = m?.max ?? 5000;

  const insertTag = (tag: string) => {
    const el = ta.current;
    if (!el || mode !== "single") { setLines((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, text: `${l.text} ${tag}`.trim() } : l))); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    setText(text.slice(0, s) + tag + " " + text.slice(e));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + tag.length + 1; });
  };
  const generate = async () => {
    if (!chars || busy) return;
    setBusy(true); setErr("");
    try {
      const settings = { stability: stab / 100, similarity: sim / 100, style: style / 100, speed, boost };
      const j = mode === "single"
        ? await post<{ item: Item }>("tts", { text, voice: voice?.id, voiceName: voice?.name, model: m?.id, lang, settings, format: fmt, normalize: norm, seed })
        : await post<{ item: Item }>("dialogue", { lines: lines.filter((l) => l.text.trim()).map((l) => ({ text: l.text, voice: speakers[l.sp]?.id, name: speakers[l.sp]?.name })), model: m?.id, lang, format: fmt });
      setResult(j.item); setHist((h) => [j.item, ...(h ?? [])]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (it: Item) => {
    try { await del("items", it.id); setHist((h) => h?.filter((x) => x.id !== it.id) ?? null); if (result?.id === it.id) setResult(null); } catch (e) { say((e as Error).message); }
  };
  const reuse = (it: Item) => {
    const mt = it.meta as { text?: string; voice?: string; model?: string; lines?: { text: string; voice_id: string }[] };
    if (it.kind === "dialogue" && mt.lines) {
      const ids = [...new Set(mt.lines.map((l) => l.voice_id))];
      setSpeakers(ids.map((id) => mine?.find((v) => v.id === id) ?? null));
      setLines(mt.lines.map((l, i) => ({ id: Date.now() + i, sp: ids.indexOf(l.voice_id), text: l.text })));
      setSub("dialogue");
    } else {
      setText(mt.text ?? ""); setSub("single");
      const v = mine?.find((x) => x.id === mt.voice); if (v) setShared(v);
    }
    if (mt.model) setModel(mt.model);
    setPanel("set");
  };

  return (
    <div className="sp-split">
      <div className="sp-main">
        <ToolHead title="Đọc văn bản" desc="Biến văn bản thành giọng nói tự nhiên. Với Eleven v3 / v4, thêm thẻ trong ngoặc vuông để điều khiển cảm xúc.">
          {dlgOk && <Seg label="Chế độ" value={mode} onChange={setSub} items={[{ k: "single", label: "Một giọng" }, { k: "dialogue", label: "Hội thoại" }]} />}
        </ToolHead>

        {m && tagsOk(m.id) && (
          <div className="sp-tags" aria-label="Chèn thẻ cảm xúc">
            {TAGS.map(([t, vi]) => <button key={t} className="sp-tag" title={`Thẻ cảm xúc: ${vi}`} onClick={() => insertTag(t)}>{t}</button>)}
          </div>
        )}

        {mode === "single" ? (
          <div className="sp-editor">
            <textarea ref={ta} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} aria-label="Văn bản" placeholder="Nhập văn bản cần đọc…" />
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
              {speakers.length < 10 && <button className="sp-add" onClick={() => setSpeakers((s) => [...s, mine?.[s.length % Math.max(1, mine.length)] ?? null])}><I.Plus size={14} />Thêm người nói</button>}
            </div>
            {lines.map((l) => (
              <div key={l.id} className="sp-dline">
                <span className="sp-sel sm">
                  <select aria-label="Người nói" value={l.sp} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, sp: Number(e.target.value) } : x)))}>
                    {speakers.map((v, i) => <option key={i} value={i}>{v?.name ?? `Người ${i + 1}`}</option>)}
                  </select><I.Chevron size={12} />
                </span>
                <VoiceAvatar v={speakers[l.sp] ?? null} size={20} />
                <textarea rows={1} value={l.text} aria-label="Lời thoại" onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, text: e.target.value } : x)))} placeholder="Lời thoại…" />
                <button className="icon-btn" aria-label="Xóa dòng" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><I.Trash size={15} /></button>
              </div>
            ))}
            <button className="sp-add" onClick={() => setLines((ls) => [...ls, { id: Date.now(), sp: ls.length ? (ls[ls.length - 1].sp + 1) % Math.max(1, speakers.length) : 0, text: "" }])}><I.Plus size={14} />Thêm lời thoại</button>
          </div>
        )}

        <div className="sp-gen">
          <span className="sp-muted">{fmtNum(chars)} / {fmtNum(max)} ký tự</span>
          <span className={`sp-cost ${cost > left ? "bad" : ""}`}>≈ {fmtNum(cost)} credit{m && m.rate < 1 && " · giảm 50%"}{cost > left ? " · vượt số credit còn lại" : ""}</span>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => (mode === "single" ? setText("") : setLines([{ id: Date.now(), sp: 0, text: "" }]))}>Xóa</button>
          <button className="btn dark sp-go" disabled={!chars || busy || (mode === "single" && !voice)} onClick={generate}>{busy ? <Spin /> : <I.Play size={13} />}{busy ? "Đang tạo…" : "Tạo giọng nói"}</button>
        </div>
        <ErrBox msg={err} />

        {result && (
          <div className="sp-result">
            <div className="sp-result-h"><b>Bản vừa tạo</b><span className="sp-muted">{result.kind === "dialogue" ? `${(result.meta.speakers as string[] | undefined)?.length ?? 2} người nói` : String(result.meta.voiceName || voice?.name || "")} · {String(result.meta.modelName ?? "")} · {fmtNum(Number(result.meta.cost) || Number(result.meta.chars) || 0)} credit</span></div>
            <Player src={result.url} dl={result.url} />
            <div className="sp-result-a">
              <button className="btn" onClick={generate} disabled={busy}><I.Retry size={14} />Tạo lại</button>
              <button className="btn" onClick={() => remove(result)}><I.Trash size={14} />Xóa</button>
            </div>
          </div>
        )}
      </div>

      <aside className="sp-aside">
        <div className="sp-aside-h"><Tabs label="Bảng bên" value={panel} onChange={setPanel} items={[{ k: "set", label: "Cài đặt" }, { k: "hist", label: "Lịch sử" }]} /></div>
        {panel === "set" ? (
          <div className="sp-aside-in">
            {mode === "single" && <Field label="Giọng"><button className="sp-vbig" onClick={() => setPick("main")}><VoiceAvatar v={voice} size={30} /><span><b data-notr>{voice?.name ?? "Chọn giọng"}</b><small>{voice ? [voice.desc, voice.lang].filter(Boolean).join(" · ") : "Giọng trong tài khoản ElevenLabs"}</small></span><I.Chevron size={14} /></button></Field>}
            <Field label="Model">
              <ModelPick models={models.filter((x) => mode === "single" || /v3|v4/.test(x.id)).map((x) => ({ id: x.id, name: x.name, note: `${x.langs.length} ngôn ngữ · tối đa ${fmtNum(x.max)} ký tự${x.rate < 1 ? " · nửa giá" : ""}` }))} value={m?.id ?? ""} onChange={setModel} />
            </Field>
            <Select id="tts-lang" label="Ngôn ngữ" value={lang} options={[["", "Tự nhận diện"], ...(m?.langs ?? []).map((x) => [x.id, x.name] as [string, string])]} onChange={setLang} />
            {mode === "single" && (
              <>
                <Range id="tts-stab" label="Độ ổn định" value={stab} onChange={setStab} left="Biểu cảm hơn" right="Ổn định hơn" show={`${stab}%`} />
                <Range id="tts-sim" label="Độ giống giọng gốc" value={sim} onChange={setSim} left="Thấp" right="Cao" show={`${sim}%`} />
                {m?.style && <Range id="tts-style" label="Phóng đại phong cách" value={style} onChange={setStyle} left="Không phóng đại" right="Phóng đại" show={`${style}%`} />}
                <Range id="tts-speed" label="Tốc độ" value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} left="Chậm" right="Nhanh" show={`${speed.toFixed(2)}×`} />
                {m?.boost && <Toggle checked={boost} onChange={setBoost} label="Tăng độ rõ người nói" hint="Giống giọng gốc hơn, chậm hơn một chút" />}
              </>
            )}
            <hr className="sp-hr" />
            <Select id="tts-fmt" label="Định dạng" value={fmt} options={(plan?.formats ?? []).map((f) => [f.id, f.label] as [string, string])} onChange={setFmt} />
            {mode === "single" && <Select id="tts-norm" label="Đọc số và ký hiệu" value={norm} options={NORM} onChange={setNorm} />}
            {mode === "single" && <Field label="Seed" hint="Giữ kết quả lặp lại được" htmlFor="tts-seed"><input id="tts-seed" className="sp-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Ngẫu nhiên" /></Field>}
            <button className="sp-link" onClick={() => { setStab(50); setSim(75); setStyle(0); setSpeed(1); setBoost(true); setNorm("auto"); setSeed(""); }}>Đặt lại mặc định</button>
          </div>
        ) : (
          <div className="sp-aside-in">
            {hist === null && <div className="sp-empty"><Spin /></div>}
            {hist?.length === 0 && <div className="sp-empty">Chưa có bản đọc nào.</div>}
            {hist?.map((h) => (
              <div key={h.id} className="sp-hrow">
                <div className="sp-hrow-t"><VoiceAvatar v={{ id: String(h.meta.voice ?? h.id) }} size={18} /><b data-notr>{h.kind === "dialogue" ? "Hội thoại" : String(h.meta.voiceName || "Giọng")}</b><span className="sp-muted">{String(h.meta.modelName ?? "")} · {ago(h.createdAt)}</span></div>
                <p data-notr>{h.title}</p>
                <Player src={h.url} dl={h.url} />
                <div className="sp-hrow-a"><button className="sp-link" onClick={() => reuse(h)}>Dùng lại văn bản và giọng</button><button className="icon-btn" aria-label="Xóa" onClick={() => remove(h)}><I.Trash size={14} /></button></div>
              </div>
            ))}
          </div>
        )}
      </aside>
      {pick !== null && <VoicePicker value={pick === "main" ? voice?.id : speakers[pick]?.id} say={say} onClose={() => setPick(null)}
        onPick={(v) => (pick === "main" ? setShared(v) : setSpeakers((s) => s.map((x, i) => (i === pick ? v : x))))} />}
    </div>
  );
}
