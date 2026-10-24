"use client";
// Chép lời (Scribe v2): từ tệp hoặc trực tiếp từ micro, tách người nói, thực thể, từ khóa, xuất phụ đề.
import { useEffect, useRef, useState } from "react";
import * as I from "../icons";
import { LANGS } from "./data";
import { Drop, Field, Player, Select, Tabs, Toggle } from "./parts";
import { VoiceOrb, startMicLevel } from "../voicefx";
import { ToolHead, type ToolProps } from "./view";

type Seg_ = { sp: number; t: number; text: string; ent?: [string, string][] };
const DEMO: Seg_[] = [
  { sp: 0, t: 0, text: "Xin chào, cảm ơn chị Hà đã dành thời gian cho buổi phỏng vấn hôm nay.", ent: [["chị Hà", "Tên người"]] },
  { sp: 1, t: 6, text: "Dạ không có gì, tôi rất vui được chia sẻ về dự án ở Đà Nẵng.", ent: [["Đà Nẵng", "Địa điểm"]] },
  { sp: 0, t: 13, text: "Chị có thể kể lại dự án bắt đầu từ khi nào không? (tiếng cười)" },
  { sp: 1, t: 18, text: "Chúng tôi bắt đầu từ tháng 3 năm 2025, với ngân sách khoảng 2 tỷ đồng.", ent: [["tháng 3 năm 2025", "Ngày"], ["2 tỷ đồng", "Tiền tệ"]] },
  { sp: 0, t: 26, text: "Số điện thoại liên hệ của dự án vẫn là 0912 345 678 đúng không ạ?", ent: [["0912 345 678", "Số điện thoại"]] },
  { sp: 1, t: 31, text: "Đúng rồi, mọi người cứ gọi số đó trong giờ hành chính." },
];
const RECENT = [["Giới thiệu sản phẩm mới", "12:40", "2 giờ trước"], ["Họp đánh giá kinh doanh quý", "48:12", "5 giờ trước"], ["Phỏng vấn khách hàng #12", "23:04", "Hôm qua"], ["Podcast tập 42: Tương lai của AI", "1:02:18", "3 ngày trước"]];
const SPK_COLORS = ["#2f7bf6", "#c2410c", "#16a34a", "#9333ea"];
const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Highlight({ s, redact }: { s: Seg_; redact: boolean }) {
  if (!s.ent?.length) return <>{s.text}</>;
  const parts: React.ReactNode[] = [];
  let rest = s.text;
  s.ent.forEach(([w, kind], i) => {
    const at = rest.indexOf(w);
    if (at < 0) return;
    parts.push(rest.slice(0, at));
    parts.push(<mark key={i} className="sp-ent" title={kind}>{redact ? `[${kind}]` : w}</mark>);
    rest = rest.slice(at + w.length);
  });
  parts.push(rest);
  return <>{parts}</>;
}

export function STT({ say, demo, sub, setSub }: ToolProps) {
  const mode = sub === "live" ? "live" : "file";
  const [file, setFile] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("Scribe v2");
  const [lang, setLang] = useState("Tự nhận diện");
  const [diar, setDiar] = useState(true);
  const [nsp, setNsp] = useState("Tự động");
  const [events, setEvents] = useState(true);
  const [ents, setEnts] = useState(true);
  const [redact, setRedact] = useState(false);
  const [verb, setVerb] = useState(false);
  const [gran, setGran] = useState("Từng từ");
  const [keys, setKeys] = useState<string[]>(["Synchro", "Đà Nẵng"]);
  const [key, setKey] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState(["Người nói 1", "Người nói 2"]);
  const [find, setFind] = useState("");
  const [exp, setExp] = useState(false);
  const run = () => { setBusy(true); setTimeout(() => { setBusy(false); setDone(true); demo(); }, 900); };
  const addKey = () => { const k = key.trim(); if (k && !keys.includes(k) && keys.length < 100) setKeys([...keys, k]); setKey(""); };

  return (
    <div className="sp-split">
      <div className="sp-main">
        <ToolHead title="Chép lời" desc="Scribe v2 chép lời 90+ ngôn ngữ, tách tới 32 người nói, mốc thời gian tới từng từ.">
          <Tabs label="Nguồn" value={mode} onChange={setSub} items={[{ k: "file", label: "Từ tệp" }, { k: "live", label: "Trực tiếp" }]} />
        </ToolHead>
        {mode === "file" ? (
          <>
            {!done ? (
              <>
                <Drop title="Thả tệp âm thanh hoặc video vào đây" sub="MP3, WAV, M4A, MP4, MOV… tối đa 3 GB, 10 giờ" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0].name)} />
                <div className="sp-or"><span>hoặc dán liên kết</span></div>
                <div className="sp-urlrow"><input className="sp-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube, TikTok, Google Drive, liên kết tệp…" aria-label="Liên kết" /></div>
                <div className="sp-gen">
                  <span className="sp-muted">Tính theo thời lượng âm thanh thật</span>
                  <button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={(!file && !url.trim()) || busy} onClick={run}>{busy ? <span className="sp-spin" /> : <I.Subtitle size={14} />}{busy ? "Đang chép…" : "Chép lời"}</button>
                </div>
                <button className="sp-link" onClick={() => { setFile("phong-van-khach-hang-12.m4a"); run(); }}>Thử với bản ghi mẫu</button>
                <div className="sp-sec-h"><b>Bản chép gần đây</b></div>
                <table className="sp-table sp-hist">
                  <thead><tr><th>Tên</th><th>Thời lượng</th><th>Tạo lúc</th></tr></thead>
                  <tbody>{RECENT.map((r) => <tr key={r[0]} onClick={() => { setFile(r[0]); setDone(true); }}><td><I.Subtitle size={14} />{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
                </table>
              </>
            ) : (
              <div className="sp-trans">
                <div className="sp-trans-h">
                  <div style={{ minWidth: 0 }}><b>{file ?? "Bản ghi"}</b><span className="sp-muted">23 phút 04 giây · {model} · Tiếng Việt (tự nhận diện, 99%)</span></div>
                  <div className="sp-trans-a">
                    <label className="sp-search sm"><I.Search size={14} /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Tìm trong bản chép" aria-label="Tìm trong bản chép" /></label>
                    <div style={{ position: "relative" }}>
                      <button className="btn" aria-expanded={exp} onClick={() => setExp(!exp)}><I.Download size={14} />Xuất</button>
                      {exp && <div className="sp-mmenu right" role="menu">{["Văn bản (.txt)", "Phụ đề (.srt)", "WebVTT (.vtt)", "Word (.docx)", "PDF", "JSON từng từ"].map((x) => <button key={x} role="menuitem" onClick={() => { setExp(false); say(`Xuất ${x}: sẽ có khi gắn API`); }}><span><b>{x}</b></span></button>)}</div>}
                    </div>
                    <button className="btn" onClick={() => { setDone(false); setFile(null); }}><I.Plus size={14} />Tệp mới</button>
                  </div>
                </div>
                <Player dur={1384} seed={21} onDemo={demo} />
                <div className="sp-spkrow">
                  {names.map((n, i) => (
                    <label key={i} className="sp-spkname"><i style={{ background: SPK_COLORS[i] }} /><input value={n} aria-label={`Tên người nói ${i + 1}`} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} /></label>
                  ))}
                  {ents && <span className="sp-muted" style={{ marginLeft: "auto" }}>6 thực thể · <button className="sp-link" onClick={() => setRedact(!redact)}>{redact ? "Hiện thực thể" : "Che thực thể"}</button></span>}
                </div>
                <div className="sp-lines">
                  {DEMO.filter((s) => !find || s.text.toLowerCase().includes(find.toLowerCase())).map((s, i) => (
                    <div key={i} className="sp-tline">
                      <button className="sp-ts" onClick={() => say(`Phát từ ${ts(s.t)}`)}>{ts(s.t)}</button>
                      <span className="sp-who" style={{ color: SPK_COLORS[s.sp] }}>{diar ? names[s.sp] : ""}</span>
                      <p contentEditable suppressContentEditableWarning><Highlight s={s} redact={redact && ents} /></p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : <Live say={say} demo={demo} lang={lang} />}
      </div>

      <aside className="sp-aside">
        <div className="sp-aside-h"><b>Cài đặt chép lời</b></div>
        <div className="sp-aside-in">
          <Select id="stt-model" label="Model" value={model} options={mode === "live" ? ["Scribe v2 Realtime"] : ["Scribe v2", "Scribe v2 Medical"]} onChange={setModel} />
          <Select id="stt-lang" label="Ngôn ngữ" value={lang} options={LANGS} onChange={setLang} />
          <Toggle checked={diar} onChange={setDiar} label="Tách người nói" hint="Gắn nhãn ai nói câu nào" />
          {diar && <Select id="stt-nsp" label="Số người nói" value={nsp} options={["Tự động", ...Array.from({ length: 32 }, (_, i) => String(i + 1))]} onChange={setNsp} inline />}
          <Toggle checked={events} onChange={setEvents} label="Gắn thẻ sự kiện âm thanh" hint="(tiếng cười), (vỗ tay), (nhạc)…" />
          <Toggle checked={ents} onChange={setEnts} label="Nhận diện thực thể" hint="Tên, địa điểm, số điện thoại… 65 loại" />
          {ents && <Toggle checked={redact} onChange={setRedact} label="Che thông tin nhạy cảm" hint="Thay bằng nhãn loại thực thể" />}
          <Toggle checked={verb} onChange={setVerb} label="Bỏ từ đệm" hint="Lược “ừm”, “à”, lặp từ" />
          <Select id="stt-gran" label="Mốc thời gian" value={gran} options={["Từng từ", "Từng ký tự", "Không có"]} onChange={setGran} inline />
          <Field label="Từ khóa" hint={`${keys.length}/100`} htmlFor="stt-key">
            <div className="sp-keys">
              {keys.map((k) => <span key={k} className="sp-key">{k}<button aria-label={`Bỏ ${k}`} onClick={() => setKeys(keys.filter((x) => x !== k))}><I.X size={11} /></button></span>)}
              <input id="stt-key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKey(); } }} placeholder="Tên riêng, thuật ngữ…" />
            </div>
          </Field>
          {model === "Scribe v2 Medical" && <p className="sp-note">Bản Y khoa chính xác hơn với thuật ngữ, tên thuốc và liều lượng. Cùng giá Scribe v2.</p>}
        </div>
      </aside>
    </div>
  );
}

const LIVE = ["Hôm nay mình muốn ghi lại vài ý tưởng cho buổi họp sáng mai.", "Thứ nhất là kế hoạch ra mắt bản mới vào cuối tháng.", "Thứ hai, cần chốt lại ngân sách quảng cáo với bên đối tác."];

function Live({ demo, lang, say }: { say: (m: string) => void; demo: () => void; lang: string }) {
  const [on, setOn] = useState(false);
  const [n, setN] = useState(0);
  const [sec, setSec] = useState(0);
  const level = useRef(0);
  useEffect(() => {
    if (!on) return;
    let stop: (() => void) | null = null, dead = false;
    startMicLevel(level).then((s) => { if (dead) s(); else stop = s; }).catch(() => say("Không mở được micro: hãy cho phép Synchro dùng micro"));
    const a = setInterval(() => setSec((s) => s + 1), 1000);
    const b = setInterval(() => setN((x) => Math.min(x + 1, LIVE.length * 2)), 1600);
    return () => { dead = true; stop?.(); clearInterval(a); clearInterval(b); };
  }, [on, say]);
  const full = Math.floor(n / 2), partial = n % 2 === 1 && full < LIVE.length ? LIVE[full].slice(0, Math.ceil(LIVE[full].length / 2)) : "";
  return (
    <div className="sp-live">
      <div className="sp-live-stage">
        <div className={`sp-live-orb ${on ? "on" : ""}`}><VoiceOrb hue={0} level={level} idle={on ? 0.04 : 0} /></div>
        <b>{on ? "Đang nghe…" : "Bấm micro để bắt đầu"}</b>
        <span className="sp-muted">{on ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} · độ trễ ~150 ms · ${lang}` : "Scribe v2 Realtime · độ trễ ~150 ms · không lộ khóa API (token dùng một lần)"}</span>
        <button className={`sp-mic ${on ? "on" : ""}`} aria-pressed={on} aria-label={on ? "Dừng ghi" : "Bắt đầu ghi"} onClick={() => { if (!on) { setN(0); setSec(0); demo(); } setOn(!on); }}>{on ? <I.Stop size={22} /> : <I.Mic size={22} />}</button>
      </div>
      <div className="sp-live-text" aria-live="polite">
        {full === 0 && !partial && <span className="sp-muted">Lời nói sẽ hiện ở đây theo thời gian thực.</span>}
        {LIVE.slice(0, full).map((t, i) => <p key={i}>{t}</p>)}
        {partial && <p className="partial">{partial}…</p>}
      </div>
    </div>
  );
}
