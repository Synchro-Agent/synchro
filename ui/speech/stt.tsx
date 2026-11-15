"use client";
// Chép lời (Scribe v2): từ tệp / liên kết hoặc trực tiếp từ micro, tách người nói, thực thể, từ khóa, xuất phụ đề;
// model Turbo / Medical, AI chỉnh bản chép theo yêu cầu; căn lời có sẵn với âm thanh (Forced Alignment) để làm phụ đề.
import { useMemo, useRef, useState } from "react";
import * as I from "../icons";
import { startScribe, type Scribe } from "../scribe";
import { PearlOrb } from "../pearlorb";
import { LANGS, KIND_LABEL, ago, api, del, fmtDur, on, post, postForm, saveText, useItems, usePlan, type Item } from "./client";
import { tr } from "../../app/i18n";
import { EDIT_IDEAS, STT_MODELS } from "../../shared/speech/data";
import { Drop, ErrBox, Field, ModelPick, Player, Recorder, Select, Spin, Tabs, Toggle } from "./parts";
import { Chips, Group, Head, Split } from "./shell";
import type { ToolProps } from "./view";
import { BulkBar, BulkButton, BulkCheck, bulkRow, useBulk } from "../bulk";
import { itemActs } from "./audio";
import { PageBar, usePage } from "../pager";

type W = { t: string; s: number; e: number; k: number; sp: string };
type Ent = { text: string; entity_type?: string; type?: string };
type Data = { text: string; words?: W[]; entities?: Ent[]; lines?: { who: string; text: string }[]; edited?: string };
type SegT = { sp: string; s: number; e: number; text: string };
const SPK_COLORS = ["#2f7bf6", "#c2410c", "#16a34a", "#9333ea", "#0891b2", "#be185d"];
const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Gộp từng từ thành đoạn: đổi người nói, nghỉ hơn 1,2 giây hoặc hết câu dài thì sang đoạn mới.
function segments(words: W[]): SegT[] {
  const out: SegT[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (!last || (w.k !== 0 && (w.sp !== last.sp || w.s - last.e > 1.2 || (/[.?!…]$/.test(last.text) && last.text.length > 160)))) {
      if (w.k === 0) continue;
      out.push({ sp: w.sp, s: w.s, e: w.e, text: w.t });
    } else { last.text += w.t; if (w.k !== 0) last.e = w.e; }
  }
  return out.map((x) => ({ ...x, text: x.text.trim() }));
}
const srtTime = (s: number, dot = false) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), x = Math.floor((ms % 6e4) / 1000), r = ms % 1000; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}${dot ? "." : ","}${String(r).padStart(3, "0")}`; };

function Highlight({ text, ents, redact }: { text: string; ents: Ent[]; redact: boolean }) {
  if (!ents.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text, k = 0;
  for (;;) {
    let best: { at: number; e: Ent } | null = null;
    for (const e of ents) { const at = e.text ? rest.indexOf(e.text) : -1; if (at >= 0 && (!best || at < best.at)) best = { at, e }; }
    if (!best) break;
    parts.push(rest.slice(0, best.at));
    const kind = (best.e.entity_type ?? best.e.type ?? "").replace(/_/g, " ");
    parts.push(<mark key={k++} className="sp-ent" title={kind}>{redact ? `[${kind}]` : best.e.text}</mark>);
    rest = rest.slice(best.at + best.e.text.length);
  }
  parts.push(rest);
  return <>{parts}</>;
}

export function STT({ say, sub, setSub }: ToolProps) {
  const plan = usePlan();
  const liveOk = on(plan, "live"), alignOk = on(plan, "align"), fileOk = on(plan, "stt");
  const mode = sub === "live" && liveOk ? "live" : sub === "align" && alignOk ? "align" : fileOk ? "file" : liveOk ? "live" : "align";
  const [panel, setPanel] = useState<"set" | "hist">("set");
  const [model, setModel] = useState(STT_MODELS[0].id);
  const [roles, setRoles] = useState(false);
  const [lib, setLib] = useState(false);
  const [edit, setEdit] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("");
  const [diar, setDiar] = useState(true);
  const [nsp, setNsp] = useState("");
  const [events, setEvents] = useState(true);
  const [ents, setEnts] = useState(false);
  const [redact, setRedact] = useState(false);
  const [verb, setVerb] = useState(false);
  const [gran, setGran] = useState("word");
  const [keys, setKeys] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<{ item: Item; data: Data } | null>(null);
  const [recent, setRecent] = useItems(["stt", "live"]);
  const bkS = useBulk(recent ?? [], (x) => x.id);
  const pgS = usePage(recent ?? [], 10);
  const run = async () => {
    setBusy(true); setErr("");
    const fd = new FormData();
    if (file) fd.set("file", file, file.name); else fd.set("url", url.trim());
    fd.set("lang", lang); fd.set("diarize", String(diar)); fd.set("speakers", nsp); fd.set("events", String(events)); fd.set("entities", String(ents));
    fd.set("redact", String(redact)); fd.set("noVerbatim", String(verb)); fd.set("granularity", gran); fd.set("keyterms", JSON.stringify(keys));
    fd.set("model", model); fd.set("roles", String(roles)); fd.set("speakerLibrary", String(lib)); fd.set("edit", edit.trim());
    try {
      const j = await postForm<{ item: Item; data: Data }>("stt", fd);
      setOpen(j); setRecent((r) => [j.item, ...(r ?? [])]); setFile(null); setUrl("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const load = async (it: Item) => {
    try { const j = await api<{ item: Item; data: Data }>(`items?id=${it.id}`); setOpen({ item: j.item, data: j.data ?? { text: String(it.meta.preview ?? "") } }); setSub(it.kind === "live" ? "file" : sub); }
    catch (e) { say((e as Error).message); }
  };
  const addKey = () => { const k = key.trim(); if (k && !keys.includes(k) && keys.length < 100) setKeys([...keys, k]); setKey(""); };

  const modes = [...(fileOk ? [{ k: "file", label: "Từ tệp" }] : []), ...(liveOk ? [{ k: "live", label: "Trực tiếp" }] : []), ...(alignOk ? [{ k: "align", label: "Căn lời có sẵn" }] : [])];
  return (
    <Split head={<Head tool="stt">{modes.length > 1 && <Tabs label="Nguồn" value={mode} onChange={(k) => { setSub(k); setOpen(null); }} items={modes} />}</Head>} tab={panel} setTab={setPanel}
      tabs={[{ k: "set", label: "Cài đặt", icon: <I.Sliders size={14} /> }, { k: "hist", label: "Lịch sử", icon: <I.History size={14} /> }]}
      side={panel === "hist" ? (
        recent === null ? <div className="sp-empty"><Spin /></div> : !recent.length ? <div className="sp-empty">Chưa có bản chép lời nào.</div> : (
          <>{recent.map((r) => <button key={r.id} className="sp-hitem" onClick={() => load(r)}><I.Subtitle size={14} /><span><b data-notr>{r.title}</b><small>{r.kind === "live" ? `${KIND_LABEL.live} · ` : ""}{fmtDur(Number(r.meta.dur ?? r.meta.seconds ?? 0))} · {ago(r.createdAt)}</small></span></button>)}</>
        )
      ) : mode === "align" ? (
        <p className="sp-hint">Căn lời có sẵn không cần cài đặt: chỉ cần tệp âm thanh và đúng lời nói trong đó. ElevenLabs trả về thời điểm bắt đầu, kết thúc của từng từ.</p>
      ) : (
        <>
          {mode === "file"
            ? <Field label="Model"><ModelPick value={model} onChange={setModel} models={STT_MODELS.map((x, i) => ({ ...x, badge: i === 0 ? "Khuyên dùng" : undefined }))} /></Field>
            : <Field label="Model"><div className="sp-vbig"><span><b>Scribe v2 Realtime</b><small>Hiện chữ ngay khi bạn nói</small></span></div></Field>}
          <Select id="stt-lang" label="Ngôn ngữ" value={lang} options={LANGS} onChange={setLang} />
          {mode === "file" && (
            <>
              <Group title="Người nói">
                <Toggle checked={diar} onChange={setDiar} label="Tách người nói" hint="Gắn nhãn ai nói câu nào" />
                {diar && <Select id="stt-nsp" label="Số người nói" value={nsp} options={[["", "Tự động"], ...Array.from({ length: 32 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])]} onChange={setNsp} inline />}
                {diar && <Toggle checked={roles} onChange={setRoles} label="Nhận vai người nói" hint="Ví dụ nhân viên / khách hàng, bác sĩ / bệnh nhân" />}
                {diar && <Toggle checked={lib} onChange={setLib} label="Nhận người nói đã lưu" hint="Gán tên người nói từ thư viện người nói của ElevenLabs" />}
              </Group>
              <Group title="Nội dung">
                <Toggle checked={events} onChange={setEvents} label="Gắn thẻ sự kiện âm thanh" hint="(tiếng cười), (vỗ tay), (nhạc)…" />
                <Toggle checked={verb} onChange={setVerb} label="Bỏ từ đệm" hint="Lược “ừm”, “à”, lặp từ" />
                <Toggle checked={ents} onChange={setEnts} label="Nhận diện thực thể" hint="Tên, địa điểm, số điện thoại…" />
                {ents && <Toggle checked={redact} onChange={setRedact} label="Che thông tin nhạy cảm" hint="ElevenLabs thay bằng nhãn loại thực thể" />}
                <Select id="stt-gran" label="Mốc thời gian" value={gran} options={[["word", "Từng từ"], ["character", "Từng ký tự"], ["none", "Không có"]]} onChange={setGran} inline />
              </Group>
              <Group title="Chỉnh bản chép" hint="Không bắt buộc">
                <textarea className="sp-input ta" rows={2} maxLength={2000} value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Yêu cầu chỉnh bản chép" placeholder="AI sửa bản chép theo yêu cầu này" />
                <Chips items={EDIT_IDEAS} onPick={(v) => setEdit(tr(v))} />
              </Group>
            </>
          )}
          <Field label="Từ khóa" hint={`${keys.length}/100`} htmlFor="stt-key">
            <div className="sp-keys">
              {keys.map((k) => <span key={k} className="sp-key" data-notr>{k}<button aria-label={`Bỏ ${k}`} onClick={() => setKeys(keys.filter((x) => x !== k))}><I.X size={11} /></button></span>)}
              <input id="stt-key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKey(); } }} placeholder="Tên riêng, thuật ngữ… rồi Enter" />
            </div>
          </Field>
        </>
      )}>
      {mode === "live" ? <Live say={say} lang={lang} keyterms={keys} onSaved={(it) => setRecent((r) => [it, ...(r ?? [])])} />
        : mode === "align" ? <Align say={say} />
        : open ? (
          <Transcript key={open.item.id} item={open.item} data={open.data} say={say} onClose={() => setOpen(null)} onDelete={async () => { await del("items", open.item.id).catch(() => {}); setRecent((r) => r?.filter((x) => x.id !== open.item.id) ?? null); setOpen(null); }} />
        ) : (
          <>
            <Drop title="Thả tệp âm thanh hoặc video vào đây" sub="MP3, WAV, M4A, MP4, MOV, WEBM… tối đa 40 MB khi tải lên" accept="audio/*,video/*" file={file} onFile={(f) => { setFile(f[0]); setUrl(""); }} say={say} />
            <div className="sp-or"><span>hoặc dán liên kết (tệp lớn, YouTube, TikTok…)</span></div>
            <div className="sp-urlrow"><input className="sp-input" value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) setFile(null); }} placeholder="https://… liên kết tới âm thanh / video" aria-label="Liên kết" /></div>
            <div className="sp-gen">
              <Recorder say={say} label="Ghi âm để chép" onDone={(f) => { setFile(f); setUrl(""); }} />
              <span className="sp-muted">{STT_MODELS.find((x) => x.id === model)?.name} · tính theo thời lượng âm thanh</span>
              <button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={(!file && !/^https?:\/\//.test(url.trim())) || busy} onClick={run}>{busy ? <Spin /> : <I.Subtitle size={14} />}{busy ? "Đang chép…" : "Chép lời"}</button>
            </div>
            <ErrBox msg={err} />
            <div className="sp-sec-h"><b>Bản chép gần đây</b>{(recent?.length ?? 0) > 1 && <span className="sp-card-r"><BulkButton b={bkS} compact /></span>}</div>
            {recent === null ? <div className="sp-empty"><Spin /></div> : !recent.length ? <div className="sp-empty">Chưa có bản chép lời nào.</div> : (
              <table className="sp-table sp-hist">
                <thead><tr><th>Tên</th><th>Thời lượng</th><th>Tạo lúc</th></tr></thead>
                <tbody>{pgS.items.map((r) => <tr key={r.id} onClick={() => load(r)} {...bulkRow(bkS, r)}><td>{bkS.on ? <BulkCheck on={bkS.has(r)} /> : <I.Subtitle size={14} />}<span data-notr>{r.title}</span>{r.kind === "live" && <span className="sp-pill">{KIND_LABEL.live}</span>}</td><td>{fmtDur(Number(r.meta.dur ?? r.meta.seconds ?? 0))}</td><td>{ago(r.createdAt)}</td></tr>)}</tbody>
              </table>
            )}
            <PageBar pg={pgS} />
            <BulkBar b={bkS} acts={itemActs(setRecent, say)} noun="bản" />
          </>
        )}
    </Split>
  );
}

function Transcript({ item, data, say, onClose, onDelete }: { item: Item; data: Data; say: (m: string) => void; onClose: () => void; onDelete: () => void }) {
  const words = data.words ?? [];
  const segs = useMemo(() => (words.length ? segments(words) : (data.lines ?? [{ who: "", text: data.text }]).map((l, i) => ({ sp: l.who, s: i, e: i, text: l.text }))), [words, data]);
  const speakers = useMemo(() => [...new Set(segs.map((x) => x.sp).filter(Boolean))], [segs]);
  const [names, setNames] = useState<Record<string, string>>({});
  const name = (sp: string) => names[sp] ?? (sp ? `Người nói ${speakers.indexOf(sp) + 1}` : "");
  const [find, setFind] = useState("");
  const [exp, setExp] = useState(false);
  const [redact, setRedact] = useState(false);
  const [seek, setSeek] = useState<{ t: number; n: number }>();
  const [now, setNow] = useState(0);
  const n = useRef(0);
  const timed = words.length > 0;
  const m = item.meta as { langName?: string; prob?: number; dur?: number };
  const out = (fmt: string) => {
    setExp(false);
    const base = item.title.replace(/\.[^.]+$/, "") || "ban-chep-loi";
    if (fmt === "txt") return saveText(`${base}.txt`, segs.map((x) => (speakers.length > 1 ? `${name(x.sp)}: ` : "") + x.text).join("\n\n"));
    if (fmt === "json") return saveText(`${base}.json`, JSON.stringify({ text: data.text, segments: segs.map((x) => ({ speaker: name(x.sp), start: x.s, end: x.e, text: x.text })), words }, null, 2), "application/json");
    if (!timed) { say("Bản này không có mốc thời gian để làm phụ đề."); return; }
    if (fmt === "srt") return saveText(`${base}.srt`, segs.map((x, i) => `${i + 1}\n${srtTime(x.s)} --> ${srtTime(x.e)}\n${speakers.length > 1 ? `${name(x.sp)}: ` : ""}${x.text}\n`).join("\n"));
    if (fmt === "vtt") return saveText(`${base}.vtt`, "WEBVTT\n\n" + segs.map((x) => `${srtTime(x.s, true)} --> ${srtTime(x.e, true)}\n${speakers.length > 1 ? `<v ${name(x.sp)}>` : ""}${x.text}\n`).join("\n"), "text/vtt");
  };
  const ents = data.entities ?? [];
  const [showEdit, setShowEdit] = useState(!!data.edited);
  return (
    <div className="sp-trans">
      <div className="sp-trans-h">
        <div style={{ minWidth: 0 }}><b data-notr>{item.title}</b><span className="sp-muted">{[m.dur ? fmtDur(m.dur) : "", m.langName ? `${m.langName}${m.prob ? ` (${Math.round(m.prob * 100)}%)` : ""}` : "", speakers.length > 1 ? `${speakers.length} người nói` : ""].filter(Boolean).join(" · ")}</span></div>
        <div className="sp-trans-a">
          <label className="sp-search sm"><I.Search size={14} /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Tìm trong bản chép" aria-label="Tìm trong bản chép" /></label>
          <div style={{ position: "relative" }}>
            <button className="btn" aria-expanded={exp} onClick={() => setExp(!exp)}><I.Download size={14} />Xuất</button>
            {exp && <div className="sp-mmenu right" role="menu">{[["txt", "Văn bản (.txt)"], ["srt", "Phụ đề (.srt)"], ["vtt", "WebVTT (.vtt)"], ["json", "JSON từng từ"]].map(([k, l]) => <button key={k} role="menuitem" onClick={() => out(k)}><span><b>{l}</b></span></button>)}</div>}
          </div>
          <button className="icon-btn" aria-label="Xóa bản chép" title="Xóa bản chép" onClick={onDelete}><I.Trash size={15} /></button>
          <button className="btn" onClick={onClose}><I.Plus size={14} />Tệp mới</button>
        </div>
      </div>
      {item.url && <Player src={item.url} dl={item.url} seekTo={seek} onTime={setNow} />}
      {speakers.length > 1 && (
        <div className="sp-spkrow">
          {speakers.map((sp, i) => (
            <label key={sp} className="sp-spkname"><i style={{ background: SPK_COLORS[i % SPK_COLORS.length] }} /><input value={name(sp)} aria-label={`Tên người nói ${i + 1}`} onChange={(e) => setNames({ ...names, [sp]: e.target.value })} /></label>
          ))}
          {ents.length > 0 && <span className="sp-muted" style={{ marginLeft: "auto" }}>{ents.length} thực thể · <button className="sp-link" onClick={() => setRedact(!redact)}>{redact ? "Hiện thực thể" : "Che thực thể"}</button></span>}
        </div>
      )}
      {data.edited && <Tabs label="Bản chép" value={showEdit ? "edit" : "raw"} onChange={(k) => setShowEdit(k === "edit")} items={[{ k: "edit", label: "Bản đã chỉnh" }, { k: "raw", label: "Bản gốc" }]} />}
      {data.edited && showEdit ? (
        <div className="sp-edited">
          <p data-notr>{data.edited}</p>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(data.edited ?? "").then(() => say("Đã sao chép"))}><I.Copy size={14} />Sao chép</button>
        </div>
      ) : <div className="sp-lines">
        {segs.filter((x) => !find || x.text.toLowerCase().includes(find.toLowerCase())).map((x, i) => (
          <div key={i} className={`sp-tline ${timed && now >= x.s && now < x.e + 0.3 ? "now" : ""}`}>
            {timed ? <button className="sp-ts" onClick={() => { if (item.url) setSeek({ t: x.s, n: ++n.current }); else say("Bản chép từ liên kết không lưu âm thanh để phát lại."); }}>{ts(x.s)}</button> : <span className="sp-ts" />}
            <span className="sp-who" style={{ color: SPK_COLORS[Math.max(0, speakers.indexOf(x.sp)) % SPK_COLORS.length] }}>{speakers.length > 1 ? name(x.sp) : ""}</span>
            <p data-notr><Highlight text={x.text} ents={ents} redact={redact} /></p>
          </div>
        ))}
      </div>}
    </div>
  );
}

function Live({ say, lang, keyterms, onSaved }: { say: (m: string) => void; lang: string; keyterms: string[]; onSaved: (it: Item) => void }) {
  const [on_, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [sec, setSec] = useState(0);
  const level = useRef(0);
  const s = useRef<Scribe | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { s.current?.stop(); s.current = null; setOn(false); if (timer.current) clearInterval(timer.current); };
  const start = async () => {
    setLines([]); setPartial(""); setSec(0);
    try {
      const x = await startScribe({ lang, level, keyterms }, { onPartial: setPartial, onCommit: (t) => setLines((l) => [...l, t]), onError: (m) => { say(m); stop(); }, onClose: () => setOn(false) });
      if (!x) { say("Không mở được chép lời trực tiếp."); return; }
      s.current = x; setOn(true);
      timer.current = setInterval(() => setSec((v) => v + 1), 1000);
    } catch { say("Không mở được micro: hãy cho phép Synchro dùng micro"); }
  };
  const save = async () => {
    try { const j = await post<{ item: Item }>("live/save", { kind: "live", lines: lines.map((text) => ({ who: "", text })), seconds: sec, lang }); onSaved(j.item); say("Đã lưu bản chép lời"); }
    catch (e) { say((e as Error).message); }
  };
  return (
    <div className="sp-live">
      <div className="sp-live-stage">
        <div className={`sp-live-orb ${on_ ? "on" : ""}`}><PearlOrb level={level} active={on_} /></div>
        <b>{on_ ? "Đang nghe…" : "Bấm micro để bắt đầu"}</b>
        <span className="sp-muted">{on_ ? `${fmtDur(sec)} · Scribe v2 Realtime` : "Scribe v2 Realtime · khóa API không rời máy chủ (token dùng một lần)"}</span>
        <button className={`sp-mic ${on_ ? "on" : ""}`} aria-pressed={on_} aria-label={on_ ? "Dừng ghi" : "Bắt đầu ghi"} onClick={() => (on_ ? stop() : void start())}>{on_ ? <I.M icon="Stop" size={22} /> : <I.M icon="Mic" size={22} />}</button>
      </div>
      <div className="sp-live-text" aria-live="polite">
        {!lines.length && !partial && <span className="sp-muted">Lời nói sẽ hiện ở đây theo thời gian thực.</span>}
        {lines.map((t, i) => <p key={i} data-notr>{t}</p>)}
        {partial && <p className="partial" data-notr>{partial}…</p>}
      </div>
      {!on_ && lines.length > 0 && (
        <div className="sp-gen">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(lines.join(" ")).then(() => say("Đã sao chép"))}><I.Copy size={14} />Sao chép</button>
          <button className="btn dark" onClick={save}><I.Download size={14} />Lưu vào lịch sử</button>
        </div>
      )}
    </div>
  );
}

// Căn lời có sẵn (Forced Alignment): khớp văn bản với âm thanh, ra mốc thời gian từng từ để làm phụ đề / karaoke.
function Align({ say }: { say: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [words, setWords] = useState<{ t: string; s: number; e: number }[] | null>(null);
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name); fd.set("text", text);
    try { const j = await postForm<{ data: { words: { t: string; s: number; e: number }[] } }>("align", fd); setWords(j.data.words); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  // Phụ đề: gom 7 từ hoặc tới dấu câu thành một dòng.
  const cues = () => { const out: { s: number; e: number; t: string }[] = []; let cur: { s: number; e: number; t: string } | null = null; for (const w of words ?? []) { if (!cur) cur = { s: w.s, e: w.e, t: w.t }; else { cur.t += " " + w.t; cur.e = w.e; } if (cur.t.split(" ").length >= 7 || /[.?!,;:]$/.test(w.t)) { out.push(cur); cur = null; } } if (cur) out.push(cur); return out; };
  const exp = (fmt: string) => {
    if (!words) return;
    const base = file?.name.replace(/\.[^.]+$/, "") ?? "phu-de";
    if (fmt === "srt") saveText(`${base}.srt`, cues().map((c, i) => `${i + 1}\n${srtTime(c.s)} --> ${srtTime(c.e)}\n${c.t}\n`).join("\n"));
    else if (fmt === "vtt") saveText(`${base}.vtt`, "WEBVTT\n\n" + cues().map((c) => `${srtTime(c.s, true)} --> ${srtTime(c.e, true)}\n${c.t}\n`).join("\n"), "text/vtt");
    else saveText(`${base}.json`, JSON.stringify(words.map((w) => ({ text: w.t, start: w.s, end: w.e })), null, 2), "application/json");
    say("Đã tải xuống");
  };
  return (
    <>
      <Drop title="Thả tệp âm thanh hoặc video" sub="Tối đa 40 MB" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0])} compact say={say} />
      <Field label="Lời có sẵn" hint="Đúng lời nói trong tệp" htmlFor="al-t"><textarea id="al-t" className="sp-input ta" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán lời thoại, kịch bản hoặc lời bài hát…" /></Field>
      <div className="sp-gen"><span className="sp-muted">Dùng làm phụ đề karaoke, đồng bộ lời bài hát, căn kịch bản lồng tiếng</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || !text.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Subtitle size={14} />}{busy ? "Đang căn…" : "Căn chỉnh"}</button></div>
      <ErrBox msg={err} />
      {words && (
        <div className="sp-card">
          <div className="sp-card-h">{words.length} từ đã căn<span style={{ display: "flex", gap: 6 }}><button className="btn" onClick={() => exp("srt")}><I.Download size={14} />SRT</button><button className="btn" onClick={() => exp("vtt")}>VTT</button><button className="btn" onClick={() => exp("json")}>JSON</button></span></div>
          <table className="sp-table"><thead><tr><th>Từ</th><th>Bắt đầu</th><th>Kết thúc</th></tr></thead><tbody>{words.slice(0, 400).map((w, i) => <tr key={i}><td data-notr>{w.t}</td><td>{w.s.toFixed(2)}s</td><td>{w.e.toFixed(2)}s</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
