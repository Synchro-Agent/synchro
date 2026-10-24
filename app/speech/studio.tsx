"use client";
// Lồng tiếng & Studio: lồng tiếng video, sách nói theo chương, podcast hai người dẫn, avatar nhép môi.
import { useState } from "react";
import * as I from "../icons";
import { DUB_LANGS, LANGS, VOICES, type Voice } from "./data";
import { Drop, Field, Player, Seg, Select, Toggle, VoiceAvatar, VoiceChip, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

const DUBS = [
  { name: "gioi-thieu-san-pham.mp4", langs: ["Tiếng Anh", "Tiếng Nhật"], pct: 100, when: "Hôm nay" },
  { name: "Hướng dẫn sử dụng tập 3 (YouTube)", langs: ["Tiếng Hàn"], pct: 64, when: "Đang xử lý" },
];
const CHAPTERS = [
  { t: "Chương 1. Thành phố trong sương", words: 3120, st: "done" },
  { t: "Chương 2. Người lạ ở bến tàu", words: 2870, st: "done" },
  { t: "Chương 3. Lá thư không ký tên", words: 3410, st: "run" },
  { t: "Chương 4. Đêm trước bão", words: 2990, st: "todo" },
];

export function StudioTool({ say, demo, sub, setSub }: ToolProps) {
  const tab = (["dub", "book", "podcast", "avatar"] as const).find((x) => x === sub) ?? "dub";
  return (
    <div className="sp-wide">
      <ToolHead title="Lồng tiếng & Studio" desc="Dịch và lồng tiếng video, chuyển sách thành sách nói, tạo podcast và avatar nói chuyện.">
        <Seg label="Công cụ" value={tab} onChange={setSub} items={[{ k: "dub", label: "Lồng tiếng" }, { k: "book", label: "Sách nói" }, { k: "podcast", label: "Podcast" }, { k: "avatar", label: "Avatar" }]} />
      </ToolHead>
      {tab === "dub" && <Dub demo={demo} say={say} />}
      {tab === "book" && <Book demo={demo} say={say} />}
      {tab === "podcast" && <Podcast demo={demo} say={say} />}
      {tab === "avatar" && <Avatar demo={demo} say={say} />}
    </div>
  );
}

function Dub({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [src, setSrc] = useState("Tự nhận diện");
  const [to, setTo] = useState<string[]>(["Tiếng Anh"]);
  const [nsp, setNsp] = useState("Tự động");
  const [bg, setBg] = useState(true);
  const [wm, setWm] = useState(false);
  const [review, setReview] = useState(false);
  const [list, setList] = useState(DUBS);
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả video hoặc âm thanh cần lồng tiếng" sub="MP4, MOV, MP3, WAV… tối đa 1 GB, 2,5 giờ" accept="audio/*,video/*" file={file} onFile={(f) => setFile(f[0].name)} />
        <div className="sp-or"><span>hoặc dán liên kết</span></div>
        <input className="sp-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube, TikTok, X, Vimeo…" aria-label="Liên kết video" />
        <Select id="db-src" label="Ngôn ngữ gốc" value={src} options={LANGS} onChange={setSrc} />
        <Field label="Lồng sang" hint={`${to.length} ngôn ngữ`}>
          <div className="sp-fchips">{DUB_LANGS.map((l) => <button key={l} className={`sp-fchip ${to.includes(l) ? "on" : ""}`} aria-pressed={to.includes(l)} onClick={() => setTo(to.includes(l) ? to.filter((x) => x !== l) : [...to, l])}>{to.includes(l) && <I.Check size={11} />}{l}</button>)}</div>
        </Field>
        <Select id="db-n" label="Số người nói" value={nsp} options={["Tự động", "1", "2", "3", "4", "5", "6", "8", "10"]} onChange={setNsp} inline />
        <Toggle checked={bg} onChange={setBg} label="Giữ nhạc nền và tiếng động" />
        <Toggle checked={wm} onChange={setWm} label="Gắn watermark" hint="Gói Pro có thể tắt watermark" />
        <Toggle checked={review} onChange={setReview} label="Duyệt trước khi xuất" hint="Sửa lời dịch và giọng từng câu" />
        <div className="sp-gen"><span className="sp-muted">Tính theo phút video × số ngôn ngữ</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={(!file && !url.trim()) || !to.length}
          onClick={() => { setList([{ name: file ?? url, langs: to, pct: 8, when: "Đang xử lý" }, ...list]); setFile(null); setUrl(""); demo(); }}><I.Globe size={14} />Lồng tiếng</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Dự án lồng tiếng</div>
        {list.map((d, i) => (
          <div key={i} className="sp-proj">
            <div className="sp-proj-t"><I.Film size={16} /><b>{d.name}</b><span className="sp-muted">{d.when}</span></div>
            {d.pct < 100 ? <div className="sp-progress"><i style={{ width: `${d.pct}%` }} /><span>Đang dịch và lồng tiếng · {d.pct}%</span></div> : (
              <div className="sp-proj-l">{d.langs.map((l) => <div key={l} className="sp-proj-row"><span className="sp-pill">{l}</span><Player dur={95} seed={l.length * 5} onDemo={demo} /></div>)}</div>
            )}
            {d.pct === 100 && <button className="sp-link" onClick={() => say("Mở trình sửa lời dịch từng câu (mẫu)")}>Sửa lời dịch và giọng</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Book({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [file, setFile] = useState<string | null>("thanh-pho-trong-suong.epub");
  const [narr, setNarr] = useState<Voice>(VOICES[5]);
  const [pick, setPick] = useState(false);
  const [chars, setChars] = useState(true);
  const [q, setQ] = useState("Cao");
  const [out, setOut] = useState("M4B có mốc chương");
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop title="Thả sách hoặc tài liệu" sub="EPUB, PDF, DOCX, TXT, HTML · hoặc dán URL bài viết" accept=".epub,.pdf,.docx,.txt,.html" file={file} onFile={(f) => setFile(f[0].name)} compact />
        <Field label="Người đọc chính"><VoiceChip v={narr} onClick={() => setPick(true)} /></Field>
        <Toggle checked={chars} onChange={setChars} label="Tự gán giọng cho nhân vật" hint="Mỗi nhân vật trong lời thoại một giọng riêng" />
        <Select id="bk-q" label="Chất lượng" value={q} options={["Chuẩn", "Cao", "Siêu cao", "Không nén (lossless)"]} onChange={setQ} inline />
        <Select id="bk-o" label="Xuất ra" value={out} options={["M4B có mốc chương", "MP3 từng chương", "Một tệp MP3"]} onChange={setOut} inline />
        <div className="sp-gen"><span className="sp-muted">12.390 từ · ≈ 61.000 credit</span><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!file} onClick={demo}><I.Book size={14} />Chuyển cả sách</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Chương{file && <span className="sp-muted">{file}</span>}</div>
        {CHAPTERS.map((c, i) => (
          <div key={i} className="sp-chap">
            <span className={`sp-stepn ${c.st}`}>{c.st === "done" ? <I.Check size={13} /> : i + 1}</span>
            <div className="sp-chap-t"><b>{c.t}</b><span className="sp-muted">{c.words.toLocaleString("vi-VN")} từ · {c.st === "done" ? "Đã chuyển" : c.st === "run" ? "Đang chuyển…" : "Chưa chuyển"}</span></div>
            {c.st === "done" ? <button className="icon-btn" aria-label={`Nghe ${c.t}`} onClick={demo}><I.Play size={14} /></button> : c.st === "todo" ? <button className="btn" onClick={demo}>Chuyển</button> : <span className="sp-spin" />}
          </div>
        ))}
        <button className="sp-link" onClick={() => say("Mở trình biên tập: sửa câu, đổi giọng từng đoạn, thêm khoảng lặng (mẫu)")}>Mở trình biên tập chi tiết</button>
      </div>
      {pick && <VoicePicker value={narr.id} onPick={setNarr} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}

function Podcast({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [srcKind, setSrcKind] = useState<"text" | "url" | "file">("url");
  const [src, setSrc] = useState("");
  const [fmt, setFmt] = useState<"conv" | "bulletin">("conv");
  const [host, setHost] = useState<Voice>(VOICES[0]);
  const [guest, setGuest] = useState<Voice>(VOICES[1]);
  const [pick, setPick] = useState<null | "host" | "guest">(null);
  const [len, setLen] = useState<"short" | "default" | "long">("default");
  const [lang, setLang] = useState("Tiếng Việt");
  const [focus, setFocus] = useState("");
  const [music, setMusic] = useState(true);
  const [done, setDone] = useState(false);
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Field label="Nguồn nội dung"><Seg small label="Nguồn" value={srcKind} onChange={setSrcKind} items={[{ k: "url", label: "Liên kết" }, { k: "text", label: "Văn bản" }, { k: "file", label: "Tệp" }]} /></Field>
        {srcKind === "file" ? <Drop compact title="Thả PDF, DOCX, TXT" sub="Synchro tóm ý và viết kịch bản" onFile={(f) => setSrc(f[0].name)} file={src || null} /> :
          srcKind === "url" ? <input className="sp-input" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Bài báo, blog, trang tài liệu…" aria-label="Liên kết nguồn" /> :
          <textarea className="sp-input ta" rows={4} value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Dán nội dung cần biến thành podcast…" aria-label="Văn bản nguồn" />}
        <Field label="Kiểu"><Seg label="Kiểu podcast" value={fmt} onChange={setFmt} items={[{ k: "conv", label: "Hai người trò chuyện" }, { k: "bulletin", label: "Một người bình luận" }]} /></Field>
        <div className="sp-hosts">
          <Field label="Người dẫn"><VoiceChip small v={host} onClick={() => setPick("host")} /></Field>
          {fmt === "conv" && <Field label="Khách mời"><VoiceChip small v={guest} onClick={() => setPick("guest")} /></Field>}
        </div>
        <Field label="Độ dài"><Seg small label="Độ dài" value={len} onChange={setLen} items={[{ k: "short", label: "Ngắn ~3 phút" }, { k: "default", label: "Vừa ~7 phút" }, { k: "long", label: "Dài ~12 phút" }]} /></Field>
        <Select id="pc-l" label="Ngôn ngữ" value={lang} options={LANGS.slice(1)} onChange={setLang} inline />
        <Field label="Hướng nội dung" hint="Không bắt buộc" htmlFor="pc-f"><input id="pc-f" className="sp-input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="vd. Tập trung vào lợi ích cho sinh viên" /></Field>
        <Toggle checked={music} onChange={setMusic} label="Nhạc mở đầu và kết thúc" />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!src.trim()} onClick={() => { setDone(true); demo(); }}><I.Bars size={14} />Tạo podcast</button></div>
      </div>
      <div className="sp-card">
        <div className="sp-card-h">Tập podcast</div>
        {done ? (
          <>
            <Player title="Tập mới · bản nháp" dur={len === "short" ? 190 : len === "long" ? 730 : 430} seed={27} onDemo={demo} />
            <div className="sp-script">
              <p><VoiceAvatar v={host} size={18} /><b>{host.name}:</b> Chào mừng các bạn quay lại với chương trình! Hôm nay chúng ta có một chủ đề rất thú vị.</p>
              {fmt === "conv" && <p><VoiceAvatar v={guest} size={18} /><b>{guest.name}:</b> Đúng vậy, [cười] tôi đã đọc bài này hai lần rồi đấy.</p>}
            </div>
            <button className="sp-link" onClick={() => say("Sửa kịch bản rồi tạo lại (mẫu)")}>Sửa kịch bản</button>
          </>
        ) : <div className="sp-empty">Synchro đọc nguồn, viết kịch bản tự nhiên rồi thu âm với giọng bạn chọn.</div>}
      </div>
      {pick && <VoicePicker value={(pick === "host" ? host : guest).id} onPick={pick === "host" ? setHost : setGuest} onClose={() => setPick(null)} say={say} />}
    </div>
  );
}

function Avatar({ demo, say }: { demo: () => void; say: (m: string) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [srcKind, setSrcKind] = useState<"text" | "audio">("text");
  const [text, setText] = useState("Xin chào, mình là trợ lý ảo của Synchro. Hôm nay mình sẽ hướng dẫn bạn ba bước để bắt đầu.");
  const [voice, setVoice] = useState<Voice>(VOICES[4]);
  const [pick, setPick] = useState(false);
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "1:1">("9:16");
  const [res, setRes] = useState("1080p");
  return (
    <div className="sp-two">
      <div className="sp-card">
        <Drop compact title="Ảnh chân dung" sub="JPG, PNG · nhìn thẳng, rõ mặt" accept="image/*" file={img} onFile={(f) => { setImg(f[0].name); setImgUrl(URL.createObjectURL(f[0])); }} />
        <Field label="Lời nói"><Seg small label="Nguồn lời nói" value={srcKind} onChange={setSrcKind} items={[{ k: "text", label: "Từ văn bản" }, { k: "audio", label: "Tải âm thanh" }]} /></Field>
        {srcKind === "text" ? (
          <>
            <textarea className="sp-input ta" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Lời avatar nói" />
            <Field label="Giọng"><VoiceChip small v={voice} onClick={() => setPick(true)} /></Field>
          </>
        ) : <Drop compact title="Thả tệp âm thanh" sub="Tối đa 5 phút" accept="audio/*" onFile={() => say("Đã chọn âm thanh")} />}
        <Field label="Khung hình"><Seg small label="Khung hình" value={ratio} onChange={setRatio} items={[{ k: "9:16", label: "Dọc 9:16" }, { k: "16:9", label: "Ngang 16:9" }, { k: "1:1", label: "Vuông 1:1" }]} /></Field>
        <Select id="av-r" label="Độ phân giải" value={res} options={["720p", "1080p"]} onChange={setRes} inline />
        <div className="sp-gen"><button className="btn dark sp-go" style={{ marginLeft: "auto" }} disabled={!img} onClick={demo}><I.Film size={14} />Tạo video</button></div>
      </div>
      <div className="sp-card sp-avstage">
        <div className={`sp-avframe r-${ratio.replace(":", "x")}`}>
          {imgUrl ? <img src={imgUrl} alt="Ảnh avatar" /> : <span className="sp-avph"><I.User size={42} /><small>Xem trước avatar</small></span>}
          <span className="sp-avcap">{srcKind === "text" ? text.slice(0, 60) + (text.length > 60 ? "…" : "") : "Âm thanh tải lên"}</span>
        </div>
      </div>
      {pick && <VoicePicker value={voice.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
