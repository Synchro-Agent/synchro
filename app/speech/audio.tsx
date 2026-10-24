"use client";
// Âm thanh: tiếng động, lọc tạp âm, đổi giọng, căn chỉnh phụ đề, phát hiện giọng AI.
import { useState } from "react";
import * as I from "../icons";
import { VOICES, type Voice } from "./data";
import { Drop, Field, Player, Range, Seg, Select, Tabs, Toggle, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

const SFX_EX = ["Mưa rơi trên mái tôn, sấm xa", "Tiếng xe máy đi qua phố đêm Hà Nội", "Cửa gỗ cũ kẽo kẹt mở ra", "Đám đông vỗ tay trong hội trường", "Tiếng bàn phím cơ gõ nhanh", "Nhạc nền lo-fi nhẹ, lặp liền mạch"];
const ALIGN = [["Chào", "0.00", "0.31"], ["mừng", "0.31", "0.58"], ["bạn", "0.58", "0.80"], ["đến", "0.80", "1.02"], ["với", "1.02", "1.20"], ["Synchro", "1.20", "1.84"]];

export function AudioTool({ say, demo, sub, setSub }: ToolProps) {
  const tab = (["sfx", "isolate", "changer", "align", "detect"] as const).find((x) => x === sub) ?? "sfx";
  return (
    <div className="sp-wide">
      <ToolHead title="Âm thanh" desc="Tạo hiệu ứng âm thanh, làm sạch bản thu, đổi giọng và căn phụ đề khớp từng từ.">
        <Tabs label="Công cụ" value={tab} onChange={setSub} items={[{ k: "sfx", label: "Tiếng động" }, { k: "isolate", label: "Lọc tạp âm" }, { k: "changer", label: "Đổi giọng" }, { k: "align", label: "Căn phụ đề" }, { k: "detect", label: "Phát hiện AI" }]} />
      </ToolHead>
      {tab === "sfx" && <Sfx demo={demo} />}
      {tab === "isolate" && <Isolate demo={demo} />}
      {tab === "changer" && <Changer demo={demo} say={say} />}
      {tab === "align" && <Align demo={demo} say={say} />}
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

function Sfx({ demo }: { demo: () => void }) {
  const [p, setP] = useState("");
  const [auto, setAuto] = useState(true);
  const [dur, setDur] = useState(5);
  const [infl, setInfl] = useState(30);
  const [loop, setLoop] = useState(false);
  const [n, setN] = useState(0);
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Mô tả âm thanh" hint={`${p.length}/450`} htmlFor="sfx-p"><textarea id="sfx-p" className="sp-input ta" rows={4} maxLength={450} value={p} onChange={(e) => setP(e.target.value)} placeholder="Tả cụ thể: nguồn âm, không gian, khoảng cách, nhịp…" /></Field>
        <div className="sp-exs">{SFX_EX.map((x) => <button key={x} className="sp-tag" onClick={() => setP(x)}>{x}</button>)}</div>
        <Toggle checked={auto} onChange={setAuto} label="Tự chọn độ dài" />
        {!auto && <Range id="sfx-d" label="Độ dài" value={dur} min={0.5} max={30} step={0.5} onChange={setDur} show={`${dur} giây`} left="0,5 s" right="30 s" />}
        <Range id="sfx-i" label="Bám sát mô tả" value={infl} onChange={setInfl} left="Sáng tạo" right="Bám sát" show={`${infl}%`} />
        <Toggle checked={loop} onChange={setLoop} label="Lặp liền mạch" hint="Nối đầu và cuối để phát lặp không bị giật" />
        <div className="sp-gen"><span className="sp-muted">{auto ? "≈ 200 credit mỗi lần" : `≈ ${Math.round(dur * 40)} credit mỗi lần`} · 4 biến thể</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!p.trim()} onClick={() => { setN((x) => x + 1); demo(); }}><I.Wave size={14} />Tạo tiếng động</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả</div>
        {n ? [0, 1, 2, 3].map((i) => <Player key={i} title={`Biến thể ${i + 1}`} dur={auto ? 4 + i : dur} seed={n * 11 + i * 3} onDemo={demo} />) : <div className="sp-empty">Mỗi lần tạo cho 4 biến thể để chọn bản ưng nhất.</div>}
      </div>
    </div>
  );
}

const ISO_HIST = [["Phỏng vấn podcast · giọng sạch", "3:05", "mp3"], ["Video hướng dẫn · bỏ nhạc nền", "4:02", "mp4"], ["Ghi âm bài giảng · chỉ giọng nói", "5:17", "mp3"], ["Bài hát · tách giọng hát", "3:21", "wav"]];

function Isolate({ demo }: { demo: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [view, setView] = useState<"before" | "after">("after");
  const [q, setQ] = useState("");
  return (
    <>
      <div className="sp-card sp-isolate">
        <Drop title="Thả tệp vào đây" sub="Âm thanh hoặc video · tối đa 500 MB, 1 giờ · khoảng 1.000 credit mỗi phút" accept="audio/*,video/*" file={file} onFile={(f) => { setFile(f[0].name); setDone(false); }} />
        <div className="sp-gen"><span className="sp-muted">Tách giọng nói khỏi nhạc nền, tiếng gió, tiếng xe và tiếng vang phòng</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file} onClick={() => { setDone(true); demo(); }}><I.ShieldCheck size={14} />Lọc tạp âm</button></div>
        {done && (
          <div className="sp-result">
            <div className="sp-result-h"><b>{file}</b><Seg small label="Nghe bản" value={view} onChange={setView} items={[{ k: "before", label: "Gốc" }, { k: "after", label: "Đã lọc" }]} /></div>
            <Player title={view === "after" ? "Đã lọc tạp âm" : "Bản gốc"} dur={64} seed={view === "after" ? 3 : 31} onDemo={demo} />
          </div>
        )}
      </div>
      <label className="sp-search"><I.Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong lịch sử" aria-label="Tìm trong lịch sử" /></label>
      <table className="sp-table sp-hist">
        <thead><tr><th>Tên</th><th>Thời lượng</th><th>Định dạng</th><th aria-label="Tải xuống" /></tr></thead>
        <tbody>{ISO_HIST.filter((r) => r[0].toLowerCase().includes(q.toLowerCase())).map((r) => <tr key={r[0]}><td><I.Wave size={14} />{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td><button className="icon-btn" aria-label="Tải xuống" onClick={demo}><I.Download size={15} /></button></td></tr>)}</tbody>
      </table>
    </>
  );
}

function Changer({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [voice, setVoice] = useState<Voice>(VOICES[1]);
  const [pick, setPick] = useState(false);
  const [stab, setStab] = useState(50);
  const [sim, setSim] = useState(75);
  const [den, setDen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả bản thu giọng của bạn" sub="Tối đa 5 phút mỗi đoạn · giữ nguyên nhịp, cảm xúc" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0].name)} />
        <button className="sp-add" onClick={() => { setFile("ghi-am-truc-tiep.webm"); say("Ghi âm trực tiếp bằng micro (mẫu)"); }}><I.Mic size={14} />Ghi âm trực tiếp</button>
        <Field label="Đổi sang giọng"><VoiceChip v={voice} onClick={() => setPick(true)} /></Field>
        <Select id="vc-m" label="Model" value="Eleven Multilingual STS v2" options={["Eleven Multilingual STS v2", "Eleven English STS v2"]} onChange={() => {}} />
        <Range id="vc-st" label="Độ ổn định" value={stab} onChange={setStab} show={`${stab}%`} />
        <Range id="vc-si" label="Độ giống giọng đích" value={sim} onChange={setSim} show={`${sim}%`} />
        <Toggle checked={den} onChange={setDen} label="Lọc tạp âm nền trước khi đổi" />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file} onClick={() => { setDone(true); demo(); }}><I.Swap size={14} />Đổi giọng</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả</div>
        {done ? <><Player title="Bản gốc" dur={22} seed={17} onDemo={demo} /><Player title={`Giọng ${voice.name}`} dur={22} seed={5} onDemo={demo} /></> : <div className="sp-empty">Giọng mới giữ nguyên cách bạn nhấn nhá, ngắt nghỉ và cảm xúc.</div>}
      </div>
      {pick && <VoicePicker value={voice.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}

function Align({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [fmt, setFmt] = useState("Phụ đề SRT");
  const [done, setDone] = useState(false);
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả tệp âm thanh hoặc video" sub="Tối đa 3 GB, 10 giờ" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0].name)} compact />
        <Field label="Văn bản có sẵn" hint="ElevenLabs căn từng từ khớp với âm thanh" htmlFor="al-t"><textarea id="al-t" className="sp-input ta" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán lời thoại, kịch bản hoặc lời bài hát…" /></Field>
        <Select id="al-f" label="Xuất ra" value={fmt} options={["Phụ đề SRT", "WebVTT", "JSON từng từ", "JSON từng ký tự"]} onChange={setFmt} />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file || !text.trim()} onClick={() => { setDone(true); demo(); }}><I.Subtitle size={14} />Căn chỉnh</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Kết quả{done && <button className="btn" onClick={() => say(`Tải ${fmt}: sẽ có khi gắn API`)}><I.Download size={14} />Tải {fmt}</button>}</div>
        {done ? (
          <table className="sp-table"><thead><tr><th>Từ</th><th>Bắt đầu</th><th>Kết thúc</th></tr></thead><tbody>{ALIGN.map(([w, a, b]) => <tr key={w}><td>{w}</td><td>{a}s</td><td>{b}s</td></tr>)}</tbody></table>
        ) : <div className="sp-empty">Dùng để làm phụ đề karaoke, đồng bộ lời bài hát hay căn kịch bản lồng tiếng.</div>}
      </div>
    </div>
  );
}
