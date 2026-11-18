"use client";
// Đọc văn bản theo bố cục ElevenLabs: khung soạn (một giọng hoặc thêm người nói thành hội thoại), mẫu “Bắt đầu với”, thanh tạo ở đáy
// (credit, số ký tự, bảng thẻ cảm xúc), thẻ kết quả; bảng bên: giọng, model, thanh trượt, ngôn ngữ, hiệu ứng âm thanh, từ điển phát âm, định dạng.
import { useEffect, useRef, useState } from "react";
import * as I from "../icons";
import { usePref } from "../store";
import { tf, tr } from "../i18n";
import { DISTANCES, FX_VI, MODEL_NOTE, RECOMMENDED, STARTERS, TAG_GROUPS, creditRate, estCredits, stripTags, tagsOk } from "../../shared/speech/data";
import { ago, del, fmtNum, on, post, useDicts, useEffectsCatalog, useItems, useMyVoices, usePlan, type Item, type Voice } from "./client";
import { ErrBox, Field, ModelPick, Player, Range, Seg, Select, Spin, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { Group, Head, Split } from "./shell";
import type { ToolProps } from "./view";
import { BulkBar, BulkButton, BulkCheck, bulkRow, useBulk } from "../bulk";
import { itemActs } from "./audio";
import { PageBar, usePage } from "../pager";

type Line = { id: number; sp: number; text: string };
type Fx = { filter?: string; space?: string; noise?: string; distance?: string };
type DictSel = { id: string; version: string; name: string };
const NORM: [string, string][] = [["auto", "Tự động"], ["on", "Luôn chuẩn hóa"], ["off", "Giữ nguyên"]];
const FX_KINDS: { k: keyof Fx; label: string; hint: string }[] = [
  { k: "filter", label: "Lọc âm", hint: "Giọng qua radio cũ, điện thoại, robot…" },
  { k: "noise", label: "Tiếng nền", hint: "Tổng đài, quán cà phê, thành phố…" },
  { k: "space", label: "Không gian", hint: "Vang như trong phòng, hội trường, đường hầm…" },
  { k: "distance", label: "Khoảng cách", hint: "Người nói đứng gần hay xa micro" },
];

export function TTS({ say, sub, setSub, go, draft, auto, voice: shared, setVoice: setShared }: ToolProps) {
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
  const [model, setModel] = usePref("spTtsModel", "");
  const usable = models.filter((x) => mode === "single" || tagsOk(x.id));
  const m = usable.find((x) => x.id === model) ?? usable.find((x) => x.id === "eleven_v4") ?? usable.find((x) => x.id === "eleven_v3") ?? usable[0];
  const tags = !!m && tagsOk(m.id);
  const [lang, setLang] = useState("");
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [style, setStyle] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [boost, setBoost] = useState(true);
  const [fmt, setFmt] = useState("mp3_44100_128");
  const [norm, setNorm] = useState("auto");
  const [seed, setSeed] = useState("");
  const [fx, setFx] = useState<Fx>({});
  const [dictSel, setDictSel] = usePref<DictSel[]>("spDicts", []);
  const [results, setResults] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [hist, setHist] = useItems(["tts", "dialogue"]);
  const bkH = useBulk(hist ?? [], (x) => x.id);
  const pgH = usePage(hist ?? [], 10);
  const ta = useRef<HTMLTextAreaElement>(null);
  const focusLine = useRef<number | null>(null);
  // Hội thoại: hai người nói mặc định là hai giọng đầu tiên của tài khoản.
  useEffect(() => { if (mine?.length && !speakers.length) setSpeakers([mine[0], mine[1] ?? mine[0]]); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const chars = mode === "single" ? text.length : lines.reduce((n, l) => n + l.text.length, 0);
  // Ước tính theo bảng giá thật của model đang chọn (shared/speech/data.ts creditRate: Eleven v4 0,4, Flash / Turbo 0,5 credit mỗi ký tự).
  const cost = mode === "single" ? estCredits(m, text) : lines.reduce((n, l) => n + estCredits(m, l.text), 0);
  const left = plan ? (plan.credits.shared ? 0 : Math.max(0, plan.credits.limit - plan.credits.used)) : Infinity;
  const max = m?.max ?? 5000;
  const empty = chars === 0;

  const settings = () => ({ stability: stab / 100, similarity: sim / 100, style: style / 100, speed, boost });
  const effects = () => {
    const out: Record<string, unknown> = {};
    if (fx.filter) out.filter = fx.filter;
    if (fx.noise) out.noise = fx.noise;
    if (fx.space) out.space = fx.space;
    const d = DISTANCES.find((x) => x[0] === fx.distance);
    if (d) out.distance = d[2];
    return Object.keys(out).length ? out : undefined;
  };
  const generate = async () => {
    if (!chars || busy) return;
    setBusy(true); setErr("");
    try {
      const common = { model: m?.id, lang, format: fmt, effects: effects(), dicts: on(plan, "dict") ? dictSel.map(({ id, version }) => ({ id, version })) : undefined };
      const j = mode === "single"
        ? await post<{ item: Item }>("tts", { ...common, text, voice: voice?.id, voiceName: voice?.name, settings: settings(), normalize: norm, seed })
        : await post<{ item: Item }>("dialogue", { ...common, lines: lines.filter((l) => l.text.trim()).map((l) => ({ text: l.text, voice: speakers[l.sp]?.id, name: speakers[l.sp]?.name })) });
      setResults((r) => [j.item, ...r]); setHist((h) => [j.item, ...(h ?? [])]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  // Từ trang chính bấm “Tạo giọng nói”: tạo luôn khi đã có giọng.
  const ran = useRef(0);
  useEffect(() => { if (auto && auto !== ran.current && voice && m && text.trim()) { ran.current = auto; void generate(); } }, [auto, voice, m]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertTag = (tag: string) => {
    setTagOpen(false);
    if (mode !== "single") {
      const id = focusLine.current ?? lines[lines.length - 1]?.id;
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text: `${l.text} ${tag}`.trim() + " " } : l)));
      return;
    }
    const el = ta.current;
    const s = el?.selectionStart ?? text.length, e = el?.selectionEnd ?? text.length;
    setText(text.slice(0, s) + tag + " " + text.slice(e));
    requestAnimationFrame(() => { if (!el) return; el.focus(); el.selectionStart = el.selectionEnd = s + tag.length + 1; });
  };
  const starter = (i: number) => {
    const st = STARTERS[i];
    const fix = (t: string) => (tags ? tr(t) : stripTags(tr(t)));
    if (st.lines && dlgOk) {
      setLines(st.lines.map(([sp, t], j) => ({ id: Date.now() + j, sp, text: fix(t) })));
      if (speakers.length < 2 && mine?.length) setSpeakers([mine[0], mine[1] ?? mine[0]]);
      setSub("dialogue");
    } else { setText(fix(st.text ?? st.lines?.map((l) => l[1]).join(" ") ?? "")); setSub("single"); }
  };
  const toDialogue = () => {
    if (text.trim()) setLines([{ id: Date.now(), sp: 0, text }, { id: Date.now() + 1, sp: 1, text: "" }]);
    setSub("dialogue");
  };
  const toSingle = () => { const t = lines.map((l) => l.text).filter(Boolean).join("\n"); if (t && !text) setText(t); setSub("single"); };
  const remove = async (it: Item) => {
    try { await del("items", it.id); setHist((h) => h?.filter((x) => x.id !== it.id) ?? null); setResults((r) => r.filter((x) => x.id !== it.id)); } catch (e) { say((e as Error).message); }
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
  const resetAll = () => { setStab(50); setSim(75); setStyle(0); setSpeed(1); setBoost(true); setNorm("auto"); setSeed(""); setFx({}); setLang(""); };

  const bar = (
    <>
      <div className="sp-bottom-l">
        {plan && Number.isFinite(left) && <span className="sp-muted"><b className="sp-num">{fmtNum(left)}</b> credit còn lại</span>}
        <span className="sp-muted"><b className="sp-num">{fmtNum(chars)}</b> / {fmtNum(max)} ký tự</span>
        {chars > 0 && <span className={`sp-cost ${cost > left ? "bad" : ""}`}>≈ {fmtNum(cost)} credit{m && creditRate(m) === 0.5 && " · nửa giá"}{cost > left ? " · vượt số credit còn lại" : ""}</span>}
        {!empty && <button className="sp-link" onClick={() => (mode === "single" ? setText("") : setLines([{ id: Date.now(), sp: 0, text: "" }, { id: Date.now() + 1, sp: 1, text: "" }]))}>Xóa hết</button>}
      </div>
      <div className="sp-bottom-r">
        {tags && (
          <div className="sp-tagwrap">
            <button className="btn" aria-expanded={tagOpen} onClick={() => setTagOpen(!tagOpen)}><I.Sparkle size={14} />Thẻ cảm xúc</button>
            {tagOpen && <TagPicker onPick={insertTag} onClose={() => setTagOpen(false)} />}
          </div>
        )}
        <button className="btn dark sp-go" disabled={!chars || busy || (mode === "single" && !voice) || chars > max} onClick={generate}>{busy ? <Spin /> : <I.Play size={13} />}{busy ? "Đang tạo…" : results.length ? "Tạo lại" : "Tạo giọng nói"}</button>
      </div>
    </>
  );

  return (
    <Split head={<Head tool="tts" />} tab={panel} setTab={setPanel}
      tabs={[{ k: "set", label: "Cài đặt", icon: <I.Sliders size={14} /> }, { k: "hist", label: "Lịch sử", icon: <I.History size={14} /> }]}
      side={panel === "set" ? (
        <>
          {mode === "single"
            ? <Field label="Giọng"><button className="sp-vbig" onClick={() => setPick("main")}><VoiceAvatar v={voice} size={30} /><span><b data-notr>{voice?.name ?? "Chọn giọng"}</b><small>{voice ? [voice.desc, voice.lang].filter(Boolean).join(" · ") : "Giọng trong tài khoản ElevenLabs"}</small></span><I.Chevron size={14} /></button></Field>
            : <Field label="Người nói">{speakers.map((v, i) => <button key={i} className="sp-vbig sm" onClick={() => setPick(i)}><VoiceAvatar v={v} size={24} /><span><b data-notr>{v?.name ?? "Chọn giọng"}</b><small>Người {i + 1}</small></span><I.Chevron size={13} /></button>)}</Field>}
          <Field label="Model">
            <ModelPick value={m?.id ?? ""} onChange={setModel} models={usable.map((x) => ({
              id: x.id, name: x.name, note: `${MODEL_NOTE[x.id] ?? x.desc.split(".")[0]} · ${x.langs.length} ngôn ngữ`, langs: x.langs.map((l) => l.name),
              badge: x.id === RECOMMENDED.find((r) => usable.some((u) => u.id === r)) ? "Khuyên dùng" : undefined,
            }))} />
          </Field>
          {mode === "dialogue" && <p className="sp-hint">Hội thoại nhiều người dùng Eleven v3 / v4.</p>}
          {mode === "single" && (
            <>
              <Range id="tts-speed" label="Tốc độ" value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} left="Chậm hơn" right="Nhanh hơn" show={`${speed.toFixed(2)}×`} />
              {tags
                ? <Field label="Độ ổn định" hint="Eleven v3 / v4 có 3 mức"><Seg label="Độ ổn định" value={stab < 34 ? "0" : stab < 67 ? "50" : "100"} onChange={(v) => setStab(Number(v))} items={[{ k: "0", label: "Sáng tạo" }, { k: "50", label: "Tự nhiên" }, { k: "100", label: "Ổn định" }]} /></Field>
                : <Range id="tts-stab" label="Độ ổn định" value={stab} onChange={setStab} left="Sáng tạo" right="Ổn định" show={`${stab}%`} />}
              <Range id="tts-sim" label="Độ giống giọng gốc" value={sim} onChange={setSim} left="Thấp" right="Cao" show={`${sim}%`} />
              {m?.style && <Range id="tts-style" label="Phóng đại phong cách" value={style} onChange={setStyle} left="Không" right="Phóng đại" show={`${style}%`} />}
              {m?.boost && <Toggle checked={boost} onChange={setBoost} label="Tăng độ rõ người nói" hint="Giống giọng gốc hơn, chậm hơn một chút" />}
            </>
          )}
          <Select id="tts-lang" label="Ngôn ngữ" value={lang} options={[["", "Tự nhận diện (khuyên dùng)"], ...(m?.langs ?? []).map((x) => [x.id, x.name] as [string, string])]} onChange={setLang} />
          <hr className="sp-hr" />
          <EffectsBox fx={fx} setFx={setFx} fmt={fmt} />
          {on(plan, "dict") && <DictBox sel={dictSel} setSel={setDictSel} go={() => go("dict")} />}
          <hr className="sp-hr" />
          <Select id="tts-fmt" label="Định dạng tải xuống" value={fmt} options={(plan?.formats ?? []).map((f) => [f.id, f.label] as [string, string])} onChange={setFmt} />
          {mode === "single" && <Select id="tts-norm" label="Đọc số và ký hiệu" value={norm} options={NORM} onChange={setNorm} />}
          {mode === "single" && <Field label="Seed" hint="Giữ kết quả lặp lại được" htmlFor="tts-seed"><input id="tts-seed" className="sp-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Ngẫu nhiên" /></Field>}
          <button className="sp-link" onClick={resetAll}>Đặt lại mặc định</button>
        </>
      ) : (
        <>
          {hist === null && <div className="sp-empty"><Spin /></div>}
          {hist?.length === 0 && <div className="sp-empty">Chưa có bản đọc nào.</div>}
          {(hist?.length ?? 0) > 1 && <div className="bk-head"><BulkButton b={bkH} compact /></div>}
          {pgH.items.map((h) => (
            <div key={h.id} className="sp-hrow" {...bulkRow(bkH, h)}>
              <div className="sp-hrow-t">{bkH.on && <BulkCheck on={bkH.has(h)} />}<VoiceAvatar v={{ id: String(h.meta.voice ?? h.id) }} size={18} /><b data-notr>{h.kind === "dialogue" ? "Hội thoại" : String(h.meta.voiceName || "Giọng")}</b><span className="sp-muted">{String(h.meta.modelName ?? "")} · {ago(h.createdAt)}</span></div>
              <p data-notr>{h.title}</p>
              <Player src={h.url} dl={h.url} label={h.title} />
              {!bkH.on && <div className="sp-hrow-a"><button className="sp-link" onClick={() => reuse(h)}>Dùng lại văn bản và giọng</button><button className="icon-btn" aria-label="Xóa" onClick={() => remove(h)}><I.Trash size={14} /></button></div>}
            </div>
          ))}
          <PageBar pg={pgH} compact />
          <BulkBar b={bkH} acts={itemActs(setHist, say)} noun="bản" compact />
        </>
      )}>
      <div className="sp-editor">
        <div className="sp-ed-top">
          {mode === "single" ? (
            <>
              <VoiceChip v={voice} onClick={() => setPick("main")} />
              {dlgOk && <button className="sp-add" onClick={toDialogue}><I.Plus size={14} />Thêm người nói</button>}
            </>
          ) : (
            <>
              {speakers.map((v, i) => (
                <span key={i} className="sp-spk">
                  <VoiceChip small v={v} onClick={() => setPick(i)} />
                  {speakers.length > 2 && <button className="icon-btn" aria-label={`Bỏ người ${i + 1}`} onClick={() => { setSpeakers((s) => s.filter((_, j) => j !== i)); setLines((ls) => ls.map((l) => ({ ...l, sp: l.sp === i ? 0 : l.sp > i ? l.sp - 1 : l.sp }))); }}><I.X size={13} /></button>}
                </span>
              ))}
              {speakers.length < 10 && <button className="sp-add" onClick={() => setSpeakers((s) => [...s, mine?.[s.length % Math.max(1, mine.length)] ?? null])}><I.Plus size={14} />Thêm người nói</button>}
              <button className="sp-link sp-ed-back" onClick={toSingle}>Về một giọng</button>
            </>
          )}
        </div>
        {mode === "single" ? (
          <textarea ref={ta} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} aria-label="Văn bản"
            placeholder={tags ? "Bắt đầu nhập ở đây, hoặc dán bất kỳ văn bản nào bạn muốn biến thành giọng nói. Thêm [laughs], [whispers]… để giọng có cảm xúc." : "Bắt đầu nhập ở đây, hoặc dán bất kỳ văn bản nào bạn muốn biến thành giọng nói."} />
        ) : (
          <div className="sp-dlg">
            {lines.map((l) => (
              <div key={l.id} className="sp-dline">
                <span className="sp-sel sm">
                  <select aria-label="Người nói" value={l.sp} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, sp: Number(e.target.value) } : x)))}>
                    {speakers.map((v, i) => <option key={i} value={i}>{v?.name ?? `Người ${i + 1}`}</option>)}
                  </select><I.Chevron size={12} />
                </span>
                <VoiceAvatar v={speakers[l.sp] ?? null} size={20} />
                <textarea rows={1} value={l.text} aria-label="Lời thoại" onFocus={() => { focusLine.current = l.id; }} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, text: e.target.value } : x)))} placeholder="Lời thoại…" />
                <button className="icon-btn" aria-label="Xóa dòng" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><I.Trash size={15} /></button>
              </div>
            ))}
            <button className="sp-add" onClick={() => setLines((ls) => [...ls, { id: Date.now(), sp: ls.length ? (ls[ls.length - 1].sp + 1) % Math.max(1, speakers.length) : 0, text: "" }])}><I.Plus size={14} />Thêm lời thoại</button>
          </div>
        )}
        {empty && (
          <div className="sp-starters">
            <span>Bắt đầu với</span>
            {STARTERS.filter((s) => !s.lines || dlgOk).map((s) => <button key={s.label} className="sp-tag" onClick={() => starter(STARTERS.indexOf(s))}>{s.label}</button>)}
          </div>
        )}
        <div className="sp-ed-bar">{bar}</div>
      </div>
      <ErrBox msg={err} />
      {busy && <div className="sp-gcard pending"><Spin /><span>{`Đang tạo giọng nói với ${m?.name ?? "ElevenLabs"}…`}</span></div>}
      {results.map((r) => (
        <div key={r.id} className="sp-gcard">
          <div className="sp-gcard-h">
            <VoiceAvatar v={{ id: String(r.meta.voice ?? r.id) }} size={22} />
            <b data-notr>{r.kind === "dialogue" ? `Hội thoại · ${(r.meta.speakers as string[] | undefined)?.length ?? 2} người nói` : String(r.meta.voiceName || voice?.name || "")}</b>
            <span className="sp-muted">{String(r.meta.modelName ?? "")} · {fmtNum(Number(r.meta.cost) || Number(r.meta.chars) || 0)} credit · {ago(r.createdAt)}</span>
            <button className="icon-btn" style={{ marginLeft: "auto" }} aria-label="Xóa" title="Xóa" onClick={() => remove(r)}><I.Trash size={14} /></button>
          </div>
          <p data-notr>{r.title}</p>
          <Player src={r.url} dl={r.url} label={r.title} />
        </div>
      ))}
      {pick !== null && <VoicePicker value={pick === "main" ? voice?.id : speakers[pick]?.id} say={say} onClose={() => setPick(null)}
        onPick={(v) => (pick === "main" ? setShared(v) : setSpeakers((s) => s.map((x, i) => (i === pick ? v : x))))} />}
    </Split>
  );
}

// Bảng thẻ cảm xúc theo nhóm như ElevenLabs, có ô tìm; bấm thẻ để chèn vào chỗ con trỏ.
function TagPicker({ onPick, onClose }: { onPick: (t: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".sp-tagwrap")) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [onClose]);
  const w = q.trim().toLowerCase();
  return (
    <div className="sp-tagpop" ref={box} role="dialog" aria-label="Thẻ cảm xúc">
      <label className="sp-search sm"><I.Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thẻ: cười, thì thầm…" aria-label="Tìm thẻ" /></label>
      <div className="sp-tagpop-in">
        {TAG_GROUPS.map((g) => {
          const list = g.tags.filter(([t, vi]) => !w || t.includes(w) || vi.includes(w));
          if (!list.length) return null;
          return (
            <div key={g.label} className="sp-taggrp">
              <b>{g.label}</b>
              <div>{list.map(([t, vi]) => <button key={t} className="sp-tag" title={t} onClick={() => onPick(t)}>{vi}<em>{t}</em></button>)}</div>
            </div>
          );
        })}
      </div>
      <p className="sp-hint">Thẻ là tiếng Anh trong ngoặc vuông; AI làm theo thẻ ở đoạn ngay sau nó.</p>
    </div>
  );
}

// Hiệu ứng âm thanh (ElevenLabs Audio Effects): thêm từng loại, chọn một kiểu cho mỗi loại; áp vào lần tạo kế tiếp.
function EffectsBox({ fx, setFx, fmt }: { fx: Fx; setFx: React.Dispatch<React.SetStateAction<Fx>>; fmt: string }) {
  const cat = useEffectsCatalog(true);
  const [menu, setMenu] = useState(false);
  const [shown, setShown] = useState<(keyof Fx)[]>(() => FX_KINDS.map((k) => k.k).filter((k) => fx[k]));
  const opts = (k: keyof Fx): [string, string][] => k === "distance" ? DISTANCES.map(([id, l]) => [id, l])
    : ((k === "filter" ? cat?.filters : k === "noise" ? cat?.noises : cat?.spaces) ?? []).map((x) => [x.id, FX_VI[x.id] ?? x.name]);
  const left = FX_KINDS.filter((k) => !shown.includes(k.k));
  const stereo = !!(fx.space) && !/^(mp3|opus|wav)/.test(fmt);
  return (
    <Group title="Hiệu ứng âm thanh" hint="Không bắt buộc" right={left.length > 0 && (
      <div className="sp-fxadd">
        <button className="sp-add" aria-expanded={menu} onClick={() => setMenu(!menu)}><I.Plus size={13} />Thêm</button>
        {menu && <div className="sp-mmenu right" role="menu">{left.map((k) => <button key={k.k} role="menuitem" onClick={() => { setShown((l) => [...l, k.k]); setMenu(false); }}><span><b>{k.label}</b><small>{k.hint}</small></span></button>)}</div>}
      </div>
    )}>
      {!shown.length && <p className="sp-hint">Làm giọng nghe như qua radio cũ, điện thoại, trong hội trường hay giữa quán cà phê.</p>}
      {shown.map((k) => {
        const def = FX_KINDS.find((x) => x.k === k)!;
        return (
          <div key={k} className="sp-fxrow">
            <div className="sp-fxrow-h"><span>{def.label}</span><button className="icon-btn" aria-label={`Bỏ ${def.label}`} onClick={() => { setShown((l) => l.filter((x) => x !== k)); setFx((o) => ({ ...o, [k]: undefined })); }}><I.X size={13} /></button></div>
            <div className="sp-fpills">{opts(k).map(([id, l]) => <button key={id} className={`sp-fpill ${fx[k] === id ? "on" : ""}`} aria-pressed={fx[k] === id} onClick={() => setFx((o) => ({ ...o, [k]: o[k] === id ? undefined : id }))}>{l}</button>)}</div>
          </div>
        );
      })}
      {stereo && <p className="sp-hint warn">Hiệu ứng không gian cần định dạng MP3, Opus hoặc WAV.</p>}
    </Group>
  );
}

// Từ điển phát âm áp vào lúc đọc (tối đa 3), lưu lựa chọn cho lần sau.
function DictBox({ sel, setSel, go }: { sel: DictSel[]; setSel: (s: DictSel[]) => void; go: () => void }) {
  const list = useDicts(true);
  const flip = (d: { id: string; version: string; name: string }) => {
    if (sel.some((x) => x.id === d.id)) setSel(sel.filter((x) => x.id !== d.id));
    else if (sel.length < 3) setSel([...sel, { id: d.id, version: d.version, name: d.name }]);
  };
  // Từ điển đã sửa quy tắc có phiên bản mới: luôn dùng phiên bản mới nhất.
  useEffect(() => {
    if (!list) return;
    const fresh = sel.map((s) => { const d = list.find((x) => x.id === s.id); return d ? { ...s, version: d.version, name: d.name } : null; }).filter(Boolean) as DictSel[];
    if (JSON.stringify(fresh) !== JSON.stringify(sel)) setSel(fresh);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Group title="Từ điển phát âm" hint={sel.length ? `${sel.length}/3 đang bật` : "Tối đa 3"} right={<button className="sp-link" onClick={go}>Quản lý</button>}>
      {list === null && <div className="sp-muted"><Spin /> Đang tải…</div>}
      {list?.length === 0 && <p className="sp-hint">Chưa có từ điển nào. Tạo từ điển để AI đọc đúng tên riêng, từ viết tắt.</p>}
      {list?.map((d) => (
        <label key={d.id} className="sp-check"><input type="checkbox" checked={sel.some((x) => x.id === d.id)} disabled={!sel.some((x) => x.id === d.id) && sel.length >= 3} onChange={() => flip(d)} /><span data-notr>{d.name}</span><em>{tf("{n} quy tắc", { n: d.count })}</em></label>
      ))}
    </Group>
  );
}
