"use client";
// Mục Speech (ElevenLabs): khung chung, thanh trên, trang chính. Từng công cụ nằm ở tệp riêng.
import { useState } from "react";
import * as I from "../icons";
import { TOOLS, VOICES, DEMO_NOTE, fmtNum, type SpeechTool, type Voice } from "./data";
import { Player, VoiceChip, VoicePicker } from "./parts";
import { TTS } from "./tts";
import { STT } from "./stt";
import { AgentTool } from "./agent";
import { VoicesTool } from "./voices";
import { AudioTool } from "./audio";
import { StudioTool } from "./studio";
import * as T from "./toolicons";

export type ToolProps = { say: (m: string) => void; demo: () => void; sub: string; setSub: (s: string) => void; go: (t: SpeechTool, sub?: string) => void; draft: string };

export const TOOL_ICON: Record<SpeechTool, (p: { size?: number }) => React.ReactNode> = {
  home: T.Home, tts: T.TextToSpeech, stt: T.SpeechToText, agent: T.Agent, voices: T.VoiceClone, audio: T.SoundEffects, studio: T.Dubbing,
};

// Gói Pro: 500.000 credit mỗi tháng (số đã dùng là dữ liệu mẫu cho tới khi gắn API).
const PLAN = { name: "Pro", total: 500_000, used: 12_770 };

export function SpeechView({ say, tool, setTool, sideOpen, onSide }: { say: (m: string) => void; tool: SpeechTool; setTool: (t: SpeechTool) => void; sideOpen: boolean; onSide: () => void }) {
  const [subs, setSubs] = useState<Partial<Record<SpeechTool, string>>>({});
  const [draft, setDraft] = useState("");
  const go = (t: SpeechTool, sub?: string) => { if (sub) setSubs((s) => ({ ...s, [t]: sub })); setTool(t); };
  const demo = () => say(DEMO_NOTE);
  const cur = TOOLS.find((t) => t.k === tool) ?? TOOLS[0];
  const p: ToolProps = { say, demo, sub: subs[tool] ?? "", setSub: (s) => setSubs((o) => ({ ...o, [tool]: s })), go, draft };
  const left = PLAN.total - PLAN.used;
  return (
    <div className="sp">
      <div className="sp-bar">
        <div className="sp-bar-l">
          {!sideOpen && <button className="icon-btn" onClick={onSide} aria-label="Mở thanh bên"><I.Panel /></button>}
          <button className="sp-crumb" onClick={() => setTool("home")}>Speech</button>
          {tool !== "home" && <><span className="sp-crumb-sep">/</span><span className="sp-crumb-cur">{cur.label}</span></>}
        </div>
        <div className="sp-bar-r">
          <span className="sp-demo" title={DEMO_NOTE}><i />Chế độ mẫu</span>
          <span className="sp-credit" title={`Đã dùng ${fmtNum(PLAN.used)} / ${fmtNum(PLAN.total)} credit tháng này`}>
            <b>{PLAN.name}</b><span className="sp-credit-n">{fmtNum(left)} credit</span>
            <span className="sp-credit-bar"><i style={{ width: `${(left / PLAN.total) * 100}%` }} /></span>
          </span>
        </div>
      </div>
      <nav className="sp-tabs" aria-label="Công cụ Speech">
        {TOOLS.map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} className={tool === t.k ? "on" : ""} onClick={() => setTool(t.k)}><Ic size={15} />{t.label}</button>; })}
      </nav>
      <div className="sp-body" key={tool}>
        {tool === "home" && <Home {...p} onDraft={(t) => { setDraft(t); go("tts", "single"); }} />}
        {tool === "tts" && <TTS {...p} />}
        {tool === "stt" && <STT {...p} />}
        {tool === "agent" && <AgentTool {...p} />}
        {tool === "voices" && <VoicesTool {...p} />}
        {tool === "audio" && <AudioTool {...p} />}
        {tool === "studio" && <StudioTool {...p} />}
      </div>
    </div>
  );
}

export function ToolHead({ title, desc, children }: { title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="sp-head">
      <div><h1>{title}</h1><p>{desc}</p></div>
      {children}
    </div>
  );
}

// Màu các ô đi theo một dải sắc có chủ đích: xanh cho giọng nói, ấm cho âm thanh, hồng tím cho sáng tạo.
const CARDS: { t: SpeechTool; sub?: string; icon: (p: { size?: number }) => React.ReactNode; title: string; desc: string; hue: number }[] = [
  { t: "tts", sub: "single", icon: T.TextToSpeech, title: "Đọc văn bản", desc: "Giọng tự nhiên, 90+ ngôn ngữ, thẻ cảm xúc", hue: 222 },
  { t: "tts", sub: "dialogue", icon: T.Dialogue, title: "Hội thoại", desc: "Nhiều người nói trong một bản", hue: 252 },
  { t: "agent", icon: T.Agent, title: "Voice Agent", desc: "Trò chuyện thời gian thực, gọi hàm", hue: 168 },
  { t: "stt", sub: "file", icon: T.SpeechToText, title: "Chép lời", desc: "Scribe v2, tách người nói, mốc từng từ", hue: 196 },
  { t: "voices", sub: "design", icon: T.VoiceDesign, title: "Thiết kế giọng", desc: "Tạo giọng mới từ một câu mô tả", hue: 318 },
  { t: "voices", sub: "ivc", icon: T.VoiceClone, title: "Nhân bản giọng", desc: "Nhanh từ 1 phút, chuyên sâu từ 30 phút", hue: 282 },
  { t: "audio", sub: "sfx", icon: T.SoundEffects, title: "Tiếng động", desc: "Hiệu ứng âm thanh từ mô tả, tới 30 giây", hue: 22 },
  { t: "audio", sub: "isolate", icon: T.Isolator, title: "Lọc tạp âm", desc: "Tách giọng khỏi nhạc và tiếng ồn", hue: 148 },
  { t: "audio", sub: "changer", icon: T.VoiceChanger, title: "Đổi giọng", desc: "Giữ cảm xúc, đổi sang giọng khác", hue: 266 },
  { t: "studio", sub: "dub", icon: T.Dubbing, title: "Lồng tiếng", desc: "Dịch video sang 90+ ngôn ngữ", hue: 340 },
  { t: "studio", sub: "book", icon: T.Audiobook, title: "Sách nói", desc: "Từ EPUB, PDF, DOCX, theo chương", hue: 38 },
  { t: "studio", sub: "podcast", icon: T.Podcast, title: "Podcast", desc: "Hai người dẫn từ tài liệu hoặc link", hue: 8 },
];

const RECENT = [
  { title: "Giới thiệu sản phẩm mùa thu", tool: "Đọc văn bản", voice: "Lan", dur: 42, when: "10 phút trước", seed: 4 },
  { title: "Phỏng vấn khách hàng #12", tool: "Chép lời", voice: "2 người nói", dur: 1384, when: "Hôm qua", seed: 9 },
  { title: "Tiếng mưa trên mái tôn", tool: "Tiếng động", voice: "Lặp liền mạch", dur: 12, when: "2 ngày trước", seed: 13 },
];

function Home({ go, onDraft, say }: ToolProps & { onDraft: (t: string) => void }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Voice>(VOICES[0]);
  const [pick, setPick] = useState(false);
  return (
    <div className="sp-home">
      <h1 className="sp-hero">Hôm nay bạn muốn <em>nghe</em> gì?</h1>
      <div className="sp-compose">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Văn bản cần đọc"
          placeholder="Nhập hoặc dán văn bản để Synchro đọc lên. Thêm cảm xúc bằng thẻ như [laughs], [whispers]…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onDraft(text); }} />
        <div className="sp-compose-f">
          <VoiceChip v={voice} onClick={() => setPick(true)} />
          <span className="sp-pill">Eleven v4</span>
          <span className="sp-muted" style={{ marginLeft: "auto" }}>{text.length ? `${fmtNum(text.length)} ký tự ≈ ${fmtNum(text.length)} credit` : "⌘ Enter để tạo"}</span>
          <button className="btn dark" disabled={!text.trim()} onClick={() => onDraft(text)}>Tạo giọng nói</button>
        </div>
      </div>
      <div className="sp-cards">
        {CARDS.map((c) => (
          <button key={c.title} className="sp-tcard" onClick={() => go(c.t, c.sub)}>
            <T.ToolTile hue={c.hue}><c.icon size={20} /></T.ToolTile>
            <b>{c.title}</b><span>{c.desc}</span>
          </button>
        ))}
      </div>
      <div className="sp-sec-h"><b>Gần đây</b><button className="sp-link" onClick={() => go("tts", "single")}>Xem tất cả</button></div>
      <div className="sp-recent">
        {RECENT.map((r) => (
          <div key={r.title} className="sp-rrow">
            <div className="sp-rmeta"><b>{r.title}</b><span>{r.tool} · {r.voice} · {r.when}</span></div>
            <Player dur={r.dur} seed={r.seed} onDemo={() => say("Tải xuống sẽ có khi gắn API ElevenLabs")} />
          </div>
        ))}
      </div>
      {pick && <VoicePicker value={voice.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
