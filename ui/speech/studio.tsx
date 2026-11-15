"use client";
// Lồng tiếng (ElevenLabs Dubbing) và Podcast & Sách nói (Studio API, chỉ hiện khi tài khoản được ElevenLabs duyệt).
// Các việc này chạy lâu ở ElevenLabs: tạo xong thì Synchro tự hỏi lại trạng thái tới khi có âm thanh.
import { useEffect, useState } from "react";
import * as I from "../icons";
import { tr } from "../i18n";
import { DUB_LANGS } from "../../shared/speech/data";
import { LANGS, ago, del, fmtDur, langLabel, on, running, usePoll, post, postForm, useItems, useMyVoices, usePlan, type Item, type Voice } from "./client";
import { Drop, ErrBox, Field, Player, Seg, Select, Spin, Tabs, Toggle, VoiceChip, VoicePicker } from "./parts";
import { Head, Wide } from "./shell";
import type { ToolProps } from "./view";

type Tab = "podcast" | "book";

/** Đồng hồ giây cho thanh tiến độ (chỉ chạy khi có dự án đang chạy). */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

export function StudioTool({ say, sub, setSub }: ToolProps) {
  const plan = usePlan();
  const tabs = ([["podcast", "Podcast"], ["book", "Sách nói"]] as [Tab, string][]).filter(([k]) => on(plan, k));
  const tab = tabs.find(([k]) => k === sub)?.[0] ?? tabs[0]?.[0] ?? "podcast";
  return (
    <Wide>
      <Head tool="studio">{tabs.length > 1 && <Tabs label="Công cụ" value={tab} onChange={setSub} items={tabs.map(([k, label]) => ({ k, label }))} />}</Head>
      {tab === "podcast" && <Podcast say={say} />}
      {tab === "book" && <Book say={say} />}
    </Wide>
  );
}

export function DubTool({ say }: ToolProps) {
  return <Wide><Head tool="dub" /><Dub say={say} /></Wide>;
}

function Projects({ items, setItems, say, kind }: { items: Item[] | null; setItems: (f: (l: Item[] | null) => Item[] | null) => void; say: (m: string) => void; kind: string }) {
  const list = (items ?? []).filter((x) => x.kind === kind);
  const now = useNow(list.some(running));
  const remove = (it: Item) => del("items", it.id).then(() => setItems((l) => l?.filter((x) => x.id !== it.id) ?? null)).catch((e: Error) => say(e.message));
  return (
    <div className="sp-card">
      <div className="sp-card-h">{kind === "dub" ? "Dự án lồng tiếng" : kind === "podcast" ? "Tập podcast" : "Sách nói"}</div>
      {items === null && <div className="sp-empty"><Spin /></div>}
      {items && !list.length && <div className="sp-empty">Chưa có dự án nào.</div>}
      {list.map((d) => {
        const st = String(d.meta.status);
        return (
          <div key={d.id} className="sp-proj">
            <div className="sp-proj-t"><I.Film size={16} /><b data-notr>{d.title}</b>{d.meta.target ? <span className="sp-pill">{langLabel(d.meta.target, String(d.meta.targetName ?? ""))}</span> : null}<span className="sp-muted">{ago(d.createdAt)}</span><button className="icon-btn" aria-label="Xóa" onClick={() => remove(d)}><I.Trash size={14} /></button></div>
            {st === "failed" ? <div className="api-err in"><I.Alert size={14} /><span>{String(d.meta.error ?? "ElevenLabs không hoàn thành được dự án này.")}</span></div>
              : d.url ? <Player src={d.url} dl={d.url} />
              : <Progress kind={kind} it={d} now={now} />}
          </div>
        );
      })}
    </div>
  );
}

// Tiến độ của dự án đang chạy: lồng tiếng có thời gian ElevenLabs dự kiến (expected_duration_sec) thì hiện thanh phần trăm và đã chạy / dự kiến
// (giữ dưới 95% tới khi thật sự xong); không có dự kiến thì thanh chạy liên tục kèm thời gian đã chạy.
function Progress({ kind, it, now }: { kind: string; it: Item; now: number }) {
  const sec = Math.max(0, (now - it.createdAt) / 1000), exp = Number(it.meta.expected) || 0;
  const pct = exp > 0 ? Math.min(95, Math.round((sec / exp) * 100)) : 0;
  const label = kind === "dub" ? "Đang dịch và lồng tiếng" : "Đang tạo âm thanh";
  return (
    <div className={`sp-progress ${exp > 0 ? "det" : "ind"}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(exp > 0 ? { "aria-valuenow": pct, style: { "--pct": `${pct}%` } as React.CSSProperties } : {})}>
      <i />
      <span title={tr("Synchro tự cập nhật khi xong.")}>{label}{exp > 0 ? ` · ${pct}% · ${fmtDur(sec)} / ~${fmtDur(exp)}` : "… Synchro tự cập nhật khi xong."}</span>
    </div>
  );
}

function Dub({ say }: { say: (m: string) => void }) {
  const plan = usePlan();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [src, setSrc] = useState("");
  const [to, setTo] = useState("en");
  const [nsp, setNsp] = useState("");
  const [bg, setBg] = useState(true);
  const [wm, setWm] = useState(true);
  const [adv, setAdv] = useState(false);
  const [hd, setHd] = useState(false);
  const [noClone, setNoClone] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["dub"]);
  usePoll(items, setItems, "dub");
  const clean = on(plan, "dubClean");
  const go = async () => {
    setBusy(true); setErr("");
    const fd = new FormData();
    if (file) fd.set("file", file, file.name); else fd.set("url", url.trim());
    fd.set("target", to); fd.set("source", src); fd.set("speakers", nsp); fd.set("keepBackground", String(bg)); fd.set("watermark", String(!clean || wm));
    fd.set("hd", String(hd)); fd.set("noClone", String(noClone)); fd.set("start", String(secOf(start))); fd.set("end", String(secOf(end)));
    try { const j = await postForm<{ item: Item }>("dub", fd); setItems((l) => [j.item, ...(l ?? [])]); setFile(null); setUrl(""); say("Đã gửi sang ElevenLabs. Synchro tự cập nhật khi lồng tiếng xong."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả video hoặc âm thanh cần lồng tiếng" sub="MP4, MOV, MP3, WAV… tối đa 40 MB khi tải lên" accept="audio/*,video/*" file={file} onFile={(f) => { setFile(f[0]); setUrl(""); }} say={say} />
        <div className="sp-or"><span>hoặc dán liên kết</span></div>
        <input className="sp-input" value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) setFile(null); }} placeholder="YouTube, TikTok, X, Vimeo, liên kết tệp…" aria-label="Liên kết video" />
        <Select id="db-src" label="Ngôn ngữ gốc" value={src} options={LANGS} onChange={setSrc} />
        <Select id="db-to" label="Lồng sang" value={to} options={DUB_LANGS} onChange={setTo} />
        <Select id="db-n" label="Số người nói" value={nsp} options={[["", "Tự động"], ...["1", "2", "3", "4", "5", "6", "8", "10"].map((x) => [x, x] as [string, string])]} onChange={setNsp} inline />
        <Toggle checked={bg} onChange={setBg} label="Giữ nhạc nền và tiếng động" />
        {clean ? <Toggle checked={wm} onChange={setWm} label="Gắn watermark" /> : <p className="sp-note">Gói {plan?.tierName} lồng tiếng có watermark (ElevenLabs bắt buộc). Gói Starter trở lên tắt được.</p>}
        <button className="sp-fsec-h sp-adv" aria-expanded={adv} onClick={() => setAdv(!adv)}>Tùy chọn nâng cao<span className={`sec-chev ${adv ? "open" : ""}`}>{adv ? <I.M icon="Chevron" size={14} /> : <I.M icon="ChevronR" size={14} />}</span></button>
        {adv && (
          <>
            <div className="sp-two flat">
              <Field label="Bắt đầu từ" hint="phút:giây" htmlFor="db-st"><input id="db-st" className="sp-input" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" /></Field>
              <Field label="Kết thúc ở" hint="để trống = hết video" htmlFor="db-en"><input id="db-en" className="sp-input" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="1:30" /></Field>
            </div>
            <Toggle checked={hd} onChange={setHd} label="Độ phân giải cao nhất" hint="Video lồng tiếng giữ chất lượng gốc, xử lý lâu hơn" />
            <Toggle checked={noClone} onChange={setNoClone} label="Không nhân bản giọng gốc" hint="Dùng giọng có sẵn thay vì giọng người nói trong video" />
          </>
        )}
        <div className="sp-gen"><span className="sp-muted">Tính theo phút</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={(!file && !/^https?:\/\//.test(url.trim())) || busy} onClick={go}>{busy ? <Spin /> : <I.Globe size={14} />}Lồng tiếng</button></div>
        <ErrBox msg={err} />
      </div>
      <Projects items={items} setItems={setItems} say={say} kind="dub" />
    </div>
  );
}

// “1:30” → 90 giây; “90” → 90 giây.
const secOf = (t: string) => { const p = t.trim().split(":").map(Number); if (p.some((x) => !Number.isFinite(x))) return 0; return p.reduce((a, x) => a * 60 + x, 0); };

function Podcast({ say }: { say: (m: string) => void }) {
  const mine = useMyVoices();
  const [srcKind, setSrcKind] = useState<"url" | "text">("url");
  const [src, setSrc] = useState("");
  const [fmt, setFmt] = useState<"conv" | "bulletin">("conv");
  const [host, setHost] = useState<Voice | null>(null);
  const [guest, setGuest] = useState<Voice | null>(null);
  const [pick, setPick] = useState<null | "host" | "guest">(null);
  const [len, setLen] = useState<"short" | "default" | "long">("default");
  const [lang, setLang] = useState("vi");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["podcast"]);
  usePoll(items, setItems, "project");
  const h = host ?? mine?.[0] ?? null, g = guest ?? mine?.[1] ?? null;
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const j = await post<{ item: Item }>("podcast", { source: srcKind === "url" ? { type: "url", url: src } : { type: "text", text: src }, mode: fmt === "bulletin" ? "bulletin" : "conversation", host: h?.id, guest: g?.id, length: len, lang, focus });
      setItems((l) => [j.item, ...(l ?? [])]); setSrc(""); say("Đang tạo podcast ở ElevenLabs.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Nguồn nội dung"><Seg small label="Nguồn" value={srcKind} onChange={setSrcKind} items={[{ k: "url", label: "Liên kết" }, { k: "text", label: "Văn bản" }]} /></Field>
        {srcKind === "url" ? <input className="sp-input" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Bài báo, blog, trang tài liệu…" aria-label="Liên kết nguồn" />
          : <textarea className="sp-input ta" rows={4} value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Dán nội dung cần biến thành podcast…" aria-label="Văn bản nguồn" />}
        <Field label="Kiểu"><Seg label="Kiểu podcast" value={fmt} onChange={setFmt} items={[{ k: "conv", label: "Hai người trò chuyện" }, { k: "bulletin", label: "Một người bình luận" }]} /></Field>
        <div className="sp-hosts">
          <Field label="Người dẫn"><VoiceChip small v={h} onClick={() => setPick("host")} /></Field>
          {fmt === "conv" && <Field label="Khách mời"><VoiceChip small v={g} onClick={() => setPick("guest")} /></Field>}
        </div>
        <Field label="Độ dài"><Seg small label="Độ dài" value={len} onChange={setLen} items={[{ k: "short", label: "Ngắn" }, { k: "default", label: "Vừa" }, { k: "long", label: "Dài" }]} /></Field>
        <Select id="pc-l" label="Ngôn ngữ" value={lang} options={LANGS.filter(([c]) => c)} onChange={setLang} inline />
        <Field label="Hướng nội dung" hint="Không bắt buộc" htmlFor="pc-f"><input id="pc-f" className="sp-input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="vd. Tập trung vào lợi ích cho sinh viên" /></Field>
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!src.trim() || !h || busy} onClick={go}>{busy ? <Spin /> : <I.Bars size={14} />}Tạo podcast</button></div>
        <ErrBox msg={err} />
      </div>
      <Projects items={items} setItems={setItems} say={say} kind="podcast" />
      {pick && <VoicePicker value={(pick === "host" ? h : g)?.id} onPick={pick === "host" ? setHost : setGuest} onClose={() => setPick(null)} say={say} />}
    </div>
  );
}

function Book({ say }: { say: (m: string) => void }) {
  const mine = useMyVoices();
  const [file, setFile] = useState<File | null>(null);
  const [narr, setNarr] = useState<Voice | null>(null);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("high");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useItems(["book"]);
  usePoll(items, setItems, "project");
  const v = narr ?? mine?.[0] ?? null;
  const go = async () => {
    if (!file || !v) return;
    setBusy(true); setErr("");
    const fd = new FormData(); fd.set("file", file, file.name); fd.set("voice", v.id); fd.set("quality", q);
    try { const j = await postForm<{ item: Item }>("book", fd); setItems((l) => [j.item, ...(l ?? [])]); setFile(null); say("Đang chuyển sách thành sách nói ở ElevenLabs."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả sách hoặc tài liệu" sub="EPUB, PDF, DOCX, TXT, HTML · tối đa 40 MB" accept=".epub,.pdf,.docx,.txt,.html" file={file} onFile={(f) => setFile(f[0])} compact say={say} />
        <Field label="Người đọc"><VoiceChip v={v} onClick={() => setPick(true)} /></Field>
        <Select id="bk-q" label="Chất lượng" value={q} options={[["standard", "Chuẩn"], ["high", "Cao"], ["ultra", "Siêu cao"], ["ultra_lossless", "Không nén"]]} onChange={setQ} inline />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || !v || busy} onClick={go}>{busy ? <Spin /> : <I.Book size={14} />}Chuyển cả sách</button></div>
        <ErrBox msg={err} />
      </div>
      <Projects items={items} setItems={setItems} say={say} kind="book" />
      {pick && <VoicePicker value={v?.id} onPick={setNarr} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
