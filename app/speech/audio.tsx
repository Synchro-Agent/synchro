"use client";
// Âm thanh: tiếng động, nhạc, lọc tạp âm, đổi giọng, căn phụ đề (ElevenLabs thật), và trang phát hiện giọng AI chính thức.
import { useState } from "react";
import * as I from "../icons";
import { ago, del, on, post, postForm, saveText, useItems, usePlan, type Item, type Voice } from "./client";
import { Drop, ErrBox, Field, Player, Range, Recorder, Seg, Select, Spin, Tabs, Toggle, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

type Tab = "sfx" | "music" | "isolate" | "changer" | "align" | "detect";
const SFX_EX = ["Mưa rơi trên mái tôn, sấm xa", "Tiếng xe máy đi qua phố đêm Hà Nội", "Cửa gỗ cũ kẽo kẹt mở ra", "Đám đông vỗ tay trong hội trường", "Tiếng bàn phím cơ gõ nhanh", "Chuông gió leng keng trước hiên nhà"];
const MUSIC_EX = ["Nhạc lo-fi nhẹ nhàng để học bài, piano và tiếng mưa", "Nhạc nền quảng cáo tươi vui, guitar acoustic, tiết tấu nhanh", "Ballad tiếng Việt buồn, giọng nữ, piano và dây"];

function History({ kind, items, onDelete }: { kind: string; items: Item[] | null; onDelete: (it: Item) => void }) {
  if (items === null) return <div className="sp-empty"><Spin /></div>;
  const list = items.filter((x) => x.kind === kind);
  if (!list.length) return null;
  return (
    <div className="sp-card">
      <div className="sp-card-h">Đã tạo</div>
      {list.slice(0, 12).map((it) => (
        <div key={it.id} className="sp-hrow">
          <div className="sp-hrow-t"><b data-notr>{it.title}</b><span className="sp-muted">{ago(it.createdAt)}</span><button className="icon-btn" style={{ marginLeft: "auto" }} aria-label="Xóa" onClick={() => onDelete(it)}><I.Trash size={14} /></button></div>
          {it.url && <Player src={it.url} dl={it.url} />}
        </div>
      ))}
    </div>
  );
}

export function AudioTool({ say, sub, setSub }: ToolProps) {
  const plan = usePlan();
  const tabs = ([["sfx", "Tiếng động"], ["music", "Nhạc"], ["isolate", "Lọc tạp âm"], ["changer", "Đổi giọng"], ["align", "Căn phụ đề"]] as [Tab, string][]).filter(([k]) => on(plan, k as "sfx"));
  const tab: Tab = sub === "detect" ? "detect" : (tabs.find(([k]) => k === sub)?.[0] ?? tabs[0]?.[0] ?? "detect");
  const [items, setItems] = useItems(["sfx", "music", "isolate", "changer"]);
  const added = (it: Item) => setItems((l) => [it, ...(l ?? [])]);
  const remove = (it: Item) => { del("items", it.id).then(() => setItems((l) => l?.filter((x) => x.id !== it.id) ?? null)).catch((e: Error) => say(e.message)); };
  return (
    <div className="sp-wide">
      <ToolHead title="Âm thanh" desc="Tạo hiệu ứng âm thanh và nhạc, làm sạch bản thu, đổi giọng và căn phụ đề khớp từng từ.">
        <Tabs label="Công cụ" value={tab} onChange={setSub} items={[...tabs.map(([k, label]) => ({ k, label })), { k: "detect" as Tab, label: "Phát hiện AI" }]} />
      </ToolHead>
      {tab === "sfx" && <><Sfx say={say} onDone={added} /><History kind="sfx" items={items} onDelete={remove} /></>}
      {tab === "music" && <><Music onDone={added} /><History kind="music" items={items} onDelete={remove} /></>}
      {tab === "isolate" && <><Isolate say={say} onDone={added} /><History kind="isolate" items={items} onDelete={remove} /></>}
      {tab === "changer" && <><Changer say={say} onDone={added} /><History kind="changer" items={items} onDelete={remove} /></>}
      {tab === "align" && <Align say={say} />}
      {tab === "detect" && (
        <div className="sp-card sp-detect">
          <span className="sp-tic big"><I.ShieldCheck size={26} /></span>
          <b>Kiểm tra một đoạn âm thanh có phải do AI của ElevenLabs tạo ra không</b>
          <p>ElevenLabs chưa mở API cho công cụ này, nên Synchro mở trang chính thức của họ. Tải tệp lên đó để nhận kết quả xác suất.</p>
          <a className="btn dark" href="https://elevenlabs.io/ai-speech-classifier" target="_blank" rel="noreferrer">Mở AI Speech Classifier<I.External size={14} /></a>
        </div>
      )}
    </div>
  );
}

function Sfx({ onDone }: { say: (m: string) => void; onDone: (it: Item) => void }) {
  const [p, setP] = useState("");
  const [auto, setAuto] = useState(true);
  const [dur, setDur] = useState(5);
  const [infl, setInfl] = useState(30);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Item | null>(null);
  const go = async () => {
    setBusy(true); setErr("");
    try { const j = await post<{ item: Item }>("sfx", { text: p, duration: auto ? null : dur, influence: infl / 100, loop }); setRes(j.item); onDone(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Mô tả âm thanh" hint={`${p.length}/450`} htmlFor="sfx-p"><textarea id="sfx-p" className="sp-input ta" rows={4} maxLength={450} value={p} onChange={(e) => setP(e.target.value)} placeholder="Tả cụ thể: nguồn âm, không gian, khoảng cách, nhịp… (tiếng Anh cho kết quả tốt nhất)" /></Field>
        <div className="sp-exs">{SFX_EX.map((x) => <button key={x} className="sp-tag" onClick={() => setP(x)}>{x}</button>)}</div>
        <Toggle checked={auto} onChange={setAuto} label="Tự chọn độ dài" />
        {!auto && <Range id="sfx-d" label="Độ dài" value={dur} min={0.5} max={30} step={0.5} onChange={setDur} show={`${dur} giây`} left="0,5 s" right="30 s" />}
        <Range id="sfx-i" label="Bám sát mô tả" value={infl} onChange={setInfl} left="Sáng tạo" right="Bám sát" show={`${infl}%`} />
        <Toggle checked={loop} onChange={setLoop} label="Lặp liền mạch" hint="Nối đầu và cuối để phát lặp không bị giật" />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!p.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Wave size={14} />}Tạo tiếng động</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả</div>
        {res ? <Player title={res.title} src={res.url} dl={res.url} /> : <div className="sp-empty">Mỗi lần tạo cho một bản. Bấm lại để có biến thể khác.</div>}
      </div>
    </div>
  );
}

function Music({ onDone }: { onDone: (it: Item) => void }) {
  const [p, setP] = useState("");
  const [auto, setAuto] = useState(true);
  const [sec, setSec] = useState(30);
  const [inst, setInst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Item | null>(null);
  const go = async () => {
    setBusy(true); setErr("");
    try { const j = await post<{ item: Item }>("music", { prompt: p, seconds: auto ? null : sec, instrumental: inst }); setRes(j.item); onDone(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Mô tả bản nhạc" hint={`${p.length}/2000`} htmlFor="mu-p"><textarea id="mu-p" className="sp-input ta" rows={4} maxLength={2000} value={p} onChange={(e) => setP(e.target.value)} placeholder="Thể loại, tâm trạng, nhạc cụ, nhịp độ, có lời hay không…" /></Field>
        <div className="sp-exs">{MUSIC_EX.map((x) => <button key={x} className="sp-tag" onClick={() => setP(x)}>{x}</button>)}</div>
        <Toggle checked={auto} onChange={setAuto} label="Tự chọn độ dài" />
        {!auto && <Range id="mu-d" label="Độ dài" value={sec} min={10} max={300} step={5} onChange={setSec} show={`${sec} giây`} left="10 s" right="5 phút" />}
        <Toggle checked={inst} onChange={setInst} label="Chỉ nhạc, không lời" />
        <div className="sp-gen"><span className="sp-muted">Có thể mất tới vài phút</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!p.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Bars size={14} />}{busy ? "Đang sáng tác…" : "Tạo nhạc"}</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả</div>
        {res ? <Player title={res.title} src={res.url} dl={res.url} /> : <div className="sp-empty">Bản nhạc tạo xong sẽ phát được và tải xuống ở đây.</div>}
      </div>
    </div>
  );
}

function Isolate({ say, onDone }: { say: (m: string) => void; onDone: (it: Item) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [res, setRes] = useState<Item | null>(null);
  const [view, setView] = useState<"before" | "after">("after");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = (f: File) => { setFile(f); setRes(null); if (src) URL.revokeObjectURL(src); setSrc(URL.createObjectURL(f)); };
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name);
    try { const j = await postForm<{ item: Item }>("isolate", fd); setRes(j.item); setView("after"); onDone(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-card sp-isolate">
      <Drop title="Thả tệp vào đây" sub="Âm thanh hoặc video · tối đa 40 MB" accept="audio/*,video/*" file={file} onFile={(f) => pick(f[0])} say={say} />
      <div className="sp-gen"><Recorder say={say} label="Ghi âm" onDone={pick} /><span className="sp-muted">Tách giọng nói khỏi nhạc nền, tiếng gió, tiếng xe và tiếng vang phòng</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || busy} onClick={go}>{busy ? <Spin /> : <I.ShieldCheck size={14} />}Lọc tạp âm</button></div>
      <ErrBox msg={err} />
      {res && (
        <div className="sp-result">
          <div className="sp-result-h"><b data-notr>{res.title}</b><Seg small label="Nghe bản" value={view} onChange={setView} items={[{ k: "before", label: "Gốc" }, { k: "after", label: "Đã lọc" }]} /></div>
          <Player key={view} title={view === "after" ? "Đã lọc tạp âm" : "Bản gốc"} src={view === "after" ? res.url : src} dl={view === "after" ? res.url : null} />
        </div>
      )}
    </div>
  );
}

function Changer({ say, onDone }: { say: (m: string) => void; onDone: (it: Item) => void }) {
  const plan = usePlan();
  const [file, setFile] = useState<File | null>(null);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [pick, setPick] = useState(false);
  const [model, setModel] = useState("");
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [den, setDen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Item | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const sts = plan?.sts ?? [];
  const take = (f: File) => { setFile(f); if (orig) URL.revokeObjectURL(orig); setOrig(URL.createObjectURL(f)); };
  const go = async () => {
    if (!file || !voice) return;
    setBusy(true); setErr("");
    const fd = new FormData();
    fd.set("file", file, file.name); fd.set("voice", voice.id); fd.set("voiceName", voice.name); fd.set("model", model || sts[0]?.id || "");
    fd.set("stability", String(stab / 100)); fd.set("similarity", String(sim / 100)); fd.set("denoise", String(den));
    try { const j = await postForm<{ item: Item }>("changer", fd); setRes(j.item); onDone(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả bản thu giọng của bạn" sub="Tối đa 5 phút mỗi đoạn · giữ nguyên nhịp, cảm xúc" accept="audio/*,video/*" file={file} onFile={(f) => take(f[0])} say={say} />
        <Recorder say={say} label="Ghi âm trực tiếp" max={300} onDone={take} />
        <Field label="Đổi sang giọng"><VoiceChip v={voice} onClick={() => setPick(true)} /></Field>
        {sts.length > 1 && <Select id="vc-m" label="Model" value={model || sts[0].id} options={sts.map((x) => [x.id, x.name] as [string, string])} onChange={setModel} />}
        <Range id="vc-st" label="Độ ổn định" value={stab} onChange={setStab} show={`${stab}%`} />
        <Range id="vc-si" label="Độ giống giọng đích" value={sim} onChange={setSim} show={`${sim}%`} />
        <Toggle checked={den} onChange={setDen} label="Lọc tạp âm nền trước khi đổi" />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || !voice || busy} onClick={go}>{busy ? <Spin /> : <I.Swap size={14} />}Đổi giọng</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả</div>
        {res ? <><Player title="Bản gốc" src={orig} /><Player title={`Giọng ${voice?.name ?? ""}`} src={res.url} dl={res.url} /></> : <div className="sp-empty">Giọng mới giữ nguyên cách bạn nhấn nhá, ngắt nghỉ và cảm xúc.</div>}
      </div>
      {pick && <VoicePicker value={voice?.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}

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
  const t2 = (s: number, dot = false) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3.6e6)).padStart(2, "0")}:${String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, "0")}:${String(Math.floor((ms % 6e4) / 1000)).padStart(2, "0")}${dot ? "." : ","}${String(ms % 1000).padStart(3, "0")}`; };
  // Phụ đề: gom 7 từ hoặc tới dấu câu thành một dòng.
  const cues = () => { const out: { s: number; e: number; t: string }[] = []; let cur: { s: number; e: number; t: string } | null = null; for (const w of words ?? []) { if (!cur) cur = { s: w.s, e: w.e, t: w.t }; else { cur.t += " " + w.t; cur.e = w.e; } if (cur.t.split(" ").length >= 7 || /[.?!,;:]$/.test(w.t)) { out.push(cur); cur = null; } } if (cur) out.push(cur); return out; };
  const exp = (fmt: string) => {
    if (!words) return;
    const base = file?.name.replace(/\.[^.]+$/, "") ?? "phu-de";
    if (fmt === "srt") saveText(`${base}.srt`, cues().map((c, i) => `${i + 1}\n${t2(c.s)} --> ${t2(c.e)}\n${c.t}\n`).join("\n"));
    else if (fmt === "vtt") saveText(`${base}.vtt`, "WEBVTT\n\n" + cues().map((c) => `${t2(c.s, true)} --> ${t2(c.e, true)}\n${c.t}\n`).join("\n"), "text/vtt");
    else saveText(`${base}.json`, JSON.stringify(words.map((w) => ({ text: w.t, start: w.s, end: w.e })), null, 2), "application/json");
    say("Đã tải xuống");
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả tệp âm thanh hoặc video" sub="Tối đa 40 MB" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0])} compact say={say} />
        <Field label="Văn bản có sẵn" hint="ElevenLabs căn từng từ khớp với âm thanh" htmlFor="al-t"><textarea id="al-t" className="sp-input ta" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán lời thoại, kịch bản hoặc lời bài hát…" /></Field>
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || !text.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Subtitle size={14} />}Căn chỉnh</button></div>
        <ErrBox msg={err} />
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả{words && <span style={{ display: "flex", gap: 6 }}><button className="btn" onClick={() => exp("srt")}><I.Download size={14} />SRT</button><button className="btn" onClick={() => exp("vtt")}>VTT</button><button className="btn" onClick={() => exp("json")}>JSON</button></span>}</div>
        {words ? (
          <table className="sp-table"><thead><tr><th>Từ</th><th>Bắt đầu</th><th>Kết thúc</th></tr></thead><tbody>{words.slice(0, 400).map((w, i) => <tr key={i}><td data-notr>{w.t}</td><td>{w.s.toFixed(2)}s</td><td>{w.e.toFixed(2)}s</td></tr>)}</tbody></table>
        ) : <div className="sp-empty">Dùng để làm phụ đề karaoke, đồng bộ lời bài hát hay căn kịch bản lồng tiếng.</div>}
      </div>
    </div>
  );
}
