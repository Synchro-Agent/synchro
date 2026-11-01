"use client";
// Đổi giọng, Tiếng động, Nhạc (tạo nhạc, nhạc cho video, tách stem) và Lọc tạp âm: mỗi công cụ một trang có hướng dẫn, chạy ElevenLabs thật.
import { useState } from "react";
import * as I from "../icons";
import { tr } from "../i18n";
import { MODEL_NOTE, MUSIC_CHIPS, MUSIC_EX, MUSIC_MODELS, SFX_CATS, SFX_MODELS } from "./data";
import { ago, del, download, fmtNum, on, post, postForm, useItems, usePlan, type Item, type Voice } from "./client";
import { Drop, ErrBox, Field, ModelPick, Player, Range, Recorder, Seg, Select, Spin, Tabs, Toggle, VoiceAvatar, VoicePicker } from "./parts";
import { Chips, Head, Split, Wide } from "./shell";
import type { ToolProps } from "./view";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "../bulk";
import { PageBar, usePage } from "../pager";

/** Danh sách sản phẩm đã tạo của một công cụ: phát, tải xuống, xóa. */
/** Chọn hàng loạt cho các danh sách bản đã tạo của Speech: tải về, xóa nhiều bản cùng lúc. */
export function itemActs(setItems: (f: (l: Item[] | null) => Item[] | null) => void, say: (m: string) => void): BulkAct<Item>[] {
  return [
    { id: "dl", label: "Tải về", icon: <I.Download size={14} />, stay: true, when: (l) => l.some((x) => !!x.url), run: (l) => each(l.filter((x) => !!x.url), async (x) => { download(x.url!); await new Promise((r) => setTimeout(r, 350)); }) },
    { id: "del", label: "Xóa", icon: <I.Trash size={14} />, danger: true, confirm: (l) => ({ title: `Xóa ${l.length} bản?`, text: "Các bản đã chọn và tệp của chúng sẽ bị xóa, không hoàn tác được.", ok: "Xóa" }),
      run: async (l) => { const gone = new Set<string>(); await each(l, async (x) => { await del("items", x.id); gone.add(x.id); }); setItems((li) => li?.filter((x) => !gone.has(x.id)) ?? null); say(`Đã xóa ${gone.size} bản`); } },
  ];
}

export function Results({ items, kinds, say, setItems, empty, title = "Đã tạo" }: { items: Item[] | null; kinds: string[]; say: (m: string) => void; setItems: (f: (l: Item[] | null) => Item[] | null) => void; empty: string; title?: string }) {
  const list = (items ?? []).filter((x) => kinds.includes(x.kind));
  const remove = (it: Item) => { del("items", it.id).then(() => setItems((l) => l?.filter((x) => x.id !== it.id) ?? null)).catch((e: Error) => say(e.message)); };
  const bk = useBulk(list, (x) => x.id);
  const pg = usePage(list, 10);
  return (
    <div className="sp-card">
      <div className="sp-card-h">{title}{list.length > 0 && <span className="sp-muted">{list.length} bản</span>}{list.length > 1 && <span className="sp-card-r"><BulkButton b={bk} compact /></span>}</div>
      {items === null && <div className="sp-empty"><Spin /></div>}
      {items && !list.length && <div className="sp-empty">{empty}</div>}
      {pg.items.map((it) => (
        <div key={it.id} className="sp-hrow" {...bulkRow(bk, it)}>
          <div className="sp-hrow-t">{bk.on && <BulkCheck on={bk.has(it)} />}<b data-notr>{it.title}</b><span className="sp-muted">{it.meta.cost ? `${fmtNum(Number(it.meta.cost))} credit · ` : ""}{ago(it.createdAt)}</span><button className="icon-btn" style={{ marginLeft: "auto" }} aria-label="Xóa" onClick={() => remove(it)}><I.Trash size={14} /></button></div>
          {it.url && it.mime?.startsWith("audio") ? <Player src={it.url} dl={it.url} label={it.title} />
            : it.url ? <button className="btn" onClick={() => download(it.url!)}><I.Download size={14} />Tải tệp ZIP</button> : null}
        </div>
      ))}
      <PageBar pg={pg} />
      <BulkBar b={bk} acts={itemActs(setItems, say)} noun="bản" />
    </div>
  );
}

// ---- Đổi giọng ----
export function ChangerTool({ say, voice: shared }: ToolProps) {
  const plan = usePlan();
  const [panel, setPanel] = useState<"set" | "hist">("set");
  const [file, setFile] = useState<File | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [pick, setPick] = useState(false);
  const [model, setModel] = useState("");
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [style, setStyle] = useState(0);
  const [boost, setBoost] = useState(true);
  const [den, setDen] = useState(false);
  const [fmt, setFmt] = useState("mp3_44100_128");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [last, setLast] = useState<{ item: Item; orig: string | null } | null>(null);
  const [items, setItems] = useItems(["changer"]);
  const sts = plan?.sts ?? [];
  const v = voice ?? shared;
  const mid = model || sts.find((x) => /multilingual/.test(x.id))?.id || sts[0]?.id || "";
  const take = (f: File) => { setFile(f); if (orig) URL.revokeObjectURL(orig); setOrig(URL.createObjectURL(f)); };
  const go = async () => {
    if (!file || !v) return;
    setBusy(true); setErr("");
    const fd = new FormData();
    fd.set("file", file, file.name); fd.set("voice", v.id); fd.set("voiceName", v.name); fd.set("model", mid); fd.set("format", fmt);
    fd.set("stability", String(stab / 100)); fd.set("similarity", String(sim / 100)); fd.set("style", String(style / 100)); fd.set("boost", String(boost)); fd.set("denoise", String(den));
    try { const j = await postForm<{ item: Item }>("changer", fd); setLast({ item: j.item, orig }); setItems((l) => [j.item, ...(l ?? [])]); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Split head={<Head tool="changer" />} tab={panel} setTab={setPanel}
      tabs={[{ k: "set", label: "Cài đặt", icon: <I.Sliders size={14} /> }, { k: "hist", label: "Lịch sử", icon: <I.History size={14} /> }]}
      bar={<><span className="sp-muted">{file ? `Sẵn sàng đổi “${file.name}” sang giọng ${v?.name ?? "…"}` : "Thả tệp hoặc ghi âm ở trên"}</span><button className="btn dark sp-go" disabled={!file || !v || busy} onClick={go}>{busy ? <Spin /> : <I.Swap size={14} />}{busy ? "Đang đổi…" : "Đổi giọng"}</button></>}
      side={panel === "set" ? (
        <>
          <Field label="Đổi sang giọng"><button className="sp-vbig" onClick={() => setPick(true)}><VoiceAvatar v={v} size={30} /><span><b data-notr>{v?.name ?? "Chọn giọng"}</b><small>{v ? [v.desc, v.lang].filter(Boolean).join(" · ") : "Giọng trong tài khoản ElevenLabs"}</small></span><I.Chevron size={14} /></button></Field>
          {sts.length > 0 && <Field label="Model"><ModelPick value={mid} onChange={setModel} models={sts.map((x) => ({ id: x.id, name: x.name, note: MODEL_NOTE[x.id] ?? `${x.langs.length} ngôn ngữ` }))} /></Field>}
          <Range id="vc-st" label="Độ ổn định" value={stab} onChange={setStab} left="Sáng tạo" right="Ổn định" show={`${stab}%`} />
          <Range id="vc-si" label="Độ giống giọng đích" value={sim} onChange={setSim} left="Thấp" right="Cao" show={`${sim}%`} />
          <Range id="vc-sy" label="Phóng đại phong cách" value={style} onChange={setStyle} left="Không" right="Phóng đại" show={`${style}%`} />
          <Toggle checked={den} onChange={setDen} label="Lọc tạp âm nền" hint="Bỏ tiếng ồn trong bản thu trước khi đổi" />
          <Toggle checked={boost} onChange={setBoost} label="Tăng độ rõ người nói" />
          <Select id="vc-fmt" label="Định dạng tải xuống" value={fmt} options={(plan?.formats ?? []).map((f) => [f.id, f.label] as [string, string])} onChange={setFmt} />
        </>
      ) : <Results items={items} kinds={["changer"]} say={say} setItems={setItems} title="Bản đã đổi" empty="Chưa có bản đổi giọng nào." />}>
      <Drop title="Thả bản thu giọng của bạn vào đây" sub="Âm thanh hoặc video · tối đa 5 phút mỗi đoạn" accept="audio/*,video/*" file={file} onFile={(f) => take(f[0])} say={say} />
      <div className="sp-or"><span>hoặc</span></div>
      <div className="sp-center"><Recorder say={say} label="Ghi âm trực tiếp" max={300} onDone={take} /></div>
      <ErrBox msg={err} />
      {last && (
        <div className="sp-gcard">
          <div className="sp-gcard-h"><b>Kết quả</b><span className="sp-muted">{String(last.item.meta.voiceName ?? "")}{last.item.meta.cost ? ` · ${fmtNum(Number(last.item.meta.cost))} credit` : ""}</span></div>
          {last.orig && <Player title="Bản gốc" label="Bản gốc" src={last.orig} />}
          <Player title={`Giọng ${String(last.item.meta.voiceName ?? "")}`} label={last.item.title} src={last.item.url} dl={last.item.url} />
        </div>
      )}
      {pick && <VoicePicker value={v?.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </Split>
  );
}

// ---- Tiếng động ----
export function SfxTool({ say }: ToolProps) {
  const [p, setP] = useState("");
  const [cat, setCat] = useState(0);
  const [model, setModel] = useState(SFX_MODELS[0].id);
  const [auto, setAuto] = useState(true);
  const [dur, setDur] = useState(5);
  const [infl, setInfl] = useState(30);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["sfx"]);
  const go = async () => {
    setBusy(true); setErr("");
    try { const j = await post<{ item: Item }>("sfx", { text: p, duration: auto ? null : dur, influence: infl / 100, loop, model }); setItems((l) => [j.item, ...(l ?? [])]); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Wide>
      <Head tool="sfx" />
      <div className="sp-two">
        <div className="sp-card">
          <Field label="Mô tả âm thanh" hint={`${p.length}/450`} htmlFor="sfx-p"><textarea id="sfx-p" className="sp-input ta" rows={4} maxLength={450} value={p} onChange={(e) => setP(e.target.value)} placeholder="Tả cụ thể: nguồn âm, không gian, khoảng cách, nhịp… Ví dụ: “Heavy rain on a tin roof with distant thunder”" /></Field>
          <div className="sp-catrow" role="tablist" aria-label="Danh mục gợi ý">{SFX_CATS.map((c, i) => <button key={c.label} role="tab" aria-selected={cat === i} className={`sp-fpill ${cat === i ? "on" : ""}`} onClick={() => setCat(i)}>{c.label}</button>)}</div>
          <div className="sp-exs">{SFX_CATS[cat].items.map(([vi, en]) => <button key={en} className="sp-tag" onClick={() => setP(en)}>{vi}</button>)}</div>
          <Field label="Model"><ModelPick value={model} onChange={setModel} models={SFX_MODELS} /></Field>
          <Toggle checked={auto} onChange={setAuto} label="Tự chọn độ dài" hint="AI chọn độ dài hợp với mô tả" />
          {!auto && <Range id="sfx-d" label="Độ dài" value={dur} min={0.5} max={30} step={0.5} onChange={setDur} show={`${String(dur).replace(".", ",")} giây`} left="0,5 giây" right="30 giây" />}
          <Range id="sfx-i" label="Bám sát mô tả" value={infl} onChange={setInfl} left="Sáng tạo" right="Bám sát" show={`${infl}%`} />
          <Toggle checked={loop} onChange={setLoop} label="Lặp liền mạch" hint="Nối đầu và cuối để phát lặp làm âm nền" />
          <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!p.trim() || busy} onClick={go}>{busy ? <Spin /> : <I.Wave size={14} />}{busy ? "Đang tạo…" : "Tạo tiếng động"}</button></div>
          <ErrBox msg={err} />
        </div>
        <Results items={items} kinds={["sfx"]} say={say} setItems={setItems} title="Tiếng động đã tạo" empty="Mỗi lần tạo ra một bản. Bấm lại để có biến thể khác." />
      </div>
    </Wide>
  );
}

// ---- Nhạc ----
type MTab = "gen" | "video" | "stems";
export function MusicTool({ say, sub, setSub }: ToolProps) {
  const tab: MTab = sub === "video" || sub === "stems" ? sub : "gen";
  const [items, setItems] = useItems(["music", "stems"]);
  const added = (it: Item) => setItems((l) => [it, ...(l ?? [])]);
  return (
    <Wide>
      <Head tool="music"><Tabs label="Chế độ" value={tab} onChange={setSub} items={[{ k: "gen", label: "Tạo nhạc" }, { k: "video", label: "Nhạc cho video" }, { k: "stems", label: "Tách stem" }]} /></Head>
      <div className="sp-two">
        {tab === "gen" && <MusicGen onDone={added} />}
        {tab === "video" && <VideoMusic say={say} onDone={added} />}
        {tab === "stems" && <Stems say={say} onDone={added} />}
        <Results items={items} kinds={tab === "stems" ? ["stems"] : ["music"]} say={say} setItems={setItems} title={tab === "stems" ? "Stem đã tách" : "Nhạc đã tạo"} empty={tab === "stems" ? "Tệp stem (ZIP) tách xong sẽ tải về được ở đây." : "Bản nhạc tạo xong phát được và tải xuống ở đây."} />
      </div>
    </Wide>
  );
}

function MusicGen({ onDone }: { onDone: (it: Item) => void }) {
  const [p, setP] = useState("");
  const [model, setModel] = useState(MUSIC_MODELS[0].id);
  const [lyr, setLyr] = useState<"auto" | "none" | "mine">("auto");
  const [lyrics, setLyrics] = useState("");
  const [auto, setAuto] = useState(true);
  const [sec, setSec] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = (w: string) => { const t = tr(w); setP((x) => (x.trim() ? `${x.trim().replace(/[,.]$/, "")}, ${t}` : t)); };
  const go = async () => {
    setBusy(true); setErr("");
    try { const j = await post<{ item: Item }>("music", { prompt: p, model, seconds: auto ? null : sec, instrumental: lyr === "none", lyrics: lyr === "mine" ? lyrics : "" }); onDone(j.item); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-card">
      <Field label="Mô tả bản nhạc" hint={`${p.length}/2000`} htmlFor="mu-p"><textarea id="mu-p" className="sp-input ta" rows={4} maxLength={2000} value={p} onChange={(e) => setP(e.target.value)} placeholder="Thể loại, tâm trạng, nhạc cụ, nhịp độ, giọng hát… Ví dụ: Nhạc lo-fi nhẹ nhàng để học bài, piano và tiếng mưa" /></Field>
      <div className="sp-exs">{MUSIC_EX.map(([l, v]) => <button key={l} className="sp-tag" title={v} onClick={() => setP(tr(v))}>{l}</button>)}</div>
      {MUSIC_CHIPS.map((g) => <Chips key={g.label} label={g.label} items={g.items} onPick={add} />)}
      <Field label="Lời bài hát"><Seg label="Lời bài hát" value={lyr} onChange={setLyr} items={[{ k: "auto", label: "AI tự viết" }, { k: "none", label: "Không lời" }, { k: "mine", label: "Lời của tôi" }]} /></Field>
      {lyr === "mine" && <textarea className="sp-input ta" rows={6} maxLength={4000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} aria-label="Lời bài hát" placeholder={"[Verse]\nSáng nay nắng vàng trên phố quen…\n\n[Chorus]\nCùng hát lên nào…"} />}
      <Field label="Model"><ModelPick value={model} onChange={setModel} models={MUSIC_MODELS} /></Field>
      <Toggle checked={auto} onChange={setAuto} label="Tự chọn độ dài" />
      {!auto && <Range id="mu-d" label="Độ dài" value={sec} min={10} max={300} step={5} onChange={setSec} show={sec >= 60 ? `${Math.floor(sec / 60)} phút ${sec % 60 ? `${sec % 60} giây` : ""}` : `${sec} giây`} left="10 giây" right="5 phút" />}
      <div className="sp-gen"><span className="sp-muted">Có thể mất tới vài phút</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!p.trim() || (lyr === "mine" && !lyrics.trim()) || busy} onClick={go}>{busy ? <Spin /> : <I.Bars size={14} />}{busy ? "Đang sáng tác…" : "Tạo nhạc"}</button></div>
      <ErrBox msg={err} />
    </div>
  );
}

function VideoMusic({ say, onDone }: { say: (m: string) => void; onDone: (it: Item) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [p, setP] = useState("");
  const [tags, setTags] = useState("");
  const [sfx, setSfx] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name); fd.set("prompt", p); fd.set("tags", tags); fd.set("sfx", String(sfx));
    try { const j = await postForm<{ item: Item }>("music/video", fd); onDone(j.item); say("Đã làm xong nhạc cho video"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-card">
      <Drop title="Thả video cần làm nhạc nền" sub="MP4, MOV, WEBM · tối đa 40 MB" accept="video/*" file={file} onFile={(f) => setFile(f[0])} say={say} />
      <Field label="Mô tả thêm" hint="Không bắt buộc" htmlFor="vm-p"><textarea id="vm-p" className="sp-input ta" rows={3} value={p} onChange={(e) => setP(e.target.value)} placeholder="Ví dụ: nhạc tươi vui, cao trào ở cuối video" /></Field>
      <Field label="Phong cách" hint="Cách nhau bằng dấu phẩy" htmlFor="vm-t"><input id="vm-t" className="sp-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cinematic, piano, upbeat" /></Field>
      <Toggle checked={sfx} onChange={setSfx} label="Thêm tiếng động theo cảnh" hint="AI thêm hiệu ứng âm thanh khớp hành động trong video" />
      <div className="sp-gen"><span className="sp-muted">AI xem video rồi sáng tác nhạc khớp nhịp cảnh</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || busy} onClick={go}>{busy ? <Spin /> : <I.Film size={14} />}{busy ? "Đang làm nhạc…" : "Làm nhạc cho video"}</button></div>
      <ErrBox msg={err} />
    </div>
  );
}

function Stems({ say, onDone }: { say: (m: string) => void; onDone: (it: Item) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [n, setN] = useState<"2" | "6">("2");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name); fd.set("stems", n);
    try { const j = await postForm<{ item: Item }>("music/stems", fd); onDone(j.item); say("Đã tách xong, tải tệp ZIP ở danh sách bên cạnh"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-card">
      <Drop title="Thả bài hát cần tách" sub="MP3, WAV, M4A · tối đa 40 MB" accept="audio/*" file={file} onFile={(f) => setFile(f[0])} say={say} />
      <Field label="Tách thành"><Seg label="Số stem" value={n} onChange={setN} items={[{ k: "2", label: "2 phần: giọng hát + nhạc" }, { k: "6", label: "6 phần: giọng, trống, bass, guitar, piano, khác" }]} /></Field>
      <div className="sp-gen"><span className="sp-muted">Kết quả là tệp ZIP gồm từng phần riêng</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || busy} onClick={go}>{busy ? <Spin /> : <I.Layers size={14} />}{busy ? "Đang tách…" : "Tách stem"}</button></div>
      <ErrBox msg={err} />
    </div>
  );
}

// ---- Lọc tạp âm ----
export function IsolateTool({ say }: ToolProps) {
  const plan = usePlan();
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [res, setRes] = useState<Item | null>(null);
  const [view, setView] = useState<"before" | "after">("after");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["isolate"]);
  const pick = (f: File) => { setFile(f); setRes(null); if (src) URL.revokeObjectURL(src); setSrc(URL.createObjectURL(f)); };
  const go = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name);
    try { const j = await postForm<{ item: Item }>("isolate", fd); setRes(j.item); setView("after"); setItems((l) => [j.item, ...(l ?? [])]); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Wide>
      <Head tool="isolate" />
      <div className="sp-card sp-isolate">
        <Drop title="Thả tệp âm thanh hoặc video vào đây" sub="Tối đa 40 MB · giữ lại giọng nói, bỏ nhạc nền và tiếng ồn" accept="audio/*,video/*" file={file} onFile={(f) => pick(f[0])} say={say} />
        <div className="sp-gen"><Recorder say={say} label="Ghi âm" onDone={pick} />{on(plan, "music") && <span className="sp-muted">Muốn tách nhạc thành từng nhạc cụ? Dùng Nhạc → Tách stem.</span>}<button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || busy} onClick={go}>{busy ? <Spin /> : <I.ShieldCheck size={14} />}{busy ? "Đang lọc…" : "Lọc tạp âm"}</button></div>
        <ErrBox msg={err} />
        {res && (
          <div className="sp-result">
            <div className="sp-result-h"><b data-notr>{res.title}</b><Seg small label="Nghe bản" value={view} onChange={setView} items={[{ k: "before", label: "Gốc" }, { k: "after", label: "Đã lọc" }]} /></div>
            <Player key={view} title={view === "after" ? "Đã lọc tạp âm" : "Bản gốc"} label={res.title} src={view === "after" ? res.url : src} dl={view === "after" ? res.url : null} />
          </div>
        )}
      </div>
      <Results items={items} kinds={["isolate"]} say={say} setItems={setItems} title="Bản đã lọc" empty="Chưa có bản lọc nào." />
    </Wide>
  );
}
