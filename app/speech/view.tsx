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

export type ToolProps = { say: (m: string) => void; demo: () => void; sub: string; setSub: (s: string) => void; go: (t: SpeechTool, sub?: string) => void; draft: string };

export const TOOL_ICON: Record<SpeechTool, (p: { size?: number }) => React.ReactNode> = {
  home: I.Speech, tts: I.Speaker, stt: I.Subtitle, agent: I.Chat2, voices: I.VoicePlus, audio: I.Pulse, studio: I.Film,
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

const CARDS: { t: SpeechTool; sub?: string; icon: (p: { size?: number }) => React.ReactNode; title: string; desc: string; tone: string }[] = [
  { t: "tts", sub: "single", icon: I.Speaker, title: "Đọc văn bản", desc: "Giọng tự nhiên, 90+ ngôn ngữ, thẻ cảm xúc", tone: "blue" },
  { t: "tts", sub: "dialogue", icon: I.Chat2, title: "Hội thoại", desc: "Nhiều người nói trong một bản", tone: "violet" },
  { t: "agent", icon: I.Mic, title: "Voice Agent", desc: "Trò chuyện thời gian thực, gọi hàm", tone: "green" },
  { t: "stt", sub: "file", icon: I.Subtitle, title: "Chép lời", desc: "Scribe v2, tách người nói, mốc từng từ", tone: "amber" },
  { t: "voices", sub: "design", icon: I.Sparkle, title: "Thiết kế giọng", desc: "Tạo giọng mới từ một câu mô tả", tone: "pink" },
  { t: "voices", sub: "ivc", icon: I.VoicePlus, title: "Nhân bản giọng", desc: "Nhanh từ 1 phút, chuyên sâu từ 30 phút", tone: "blue" },
  { t: "audio", sub: "sfx", icon: I.Wave, title: "Tiếng động", desc: "Hiệu ứng âm thanh từ mô tả, tới 30 giây", tone: "amber" },
  { t: "audio", sub: "isolate", icon: I.ShieldCheck, title: "Lọc tạp âm", desc: "Tách giọng khỏi nhạc và tiếng ồn", tone: "green" },
  { t: "audio", sub: "changer", icon: I.Swap, title: "Đổi giọng", desc: "Giữ cảm xúc, đổi sang giọng khác", tone: "violet" },
  { t: "studio", sub: "dub", icon: I.Globe, title: "Lồng tiếng", desc: "Dịch video sang 90+ ngôn ngữ", tone: "pink" },
  { t: "studio", sub: "book", icon: I.Book, title: "Sách nói", desc: "Từ EPUB, PDF, DOCX, theo chương", tone: "amber" },
  { t: "studio", sub: "podcast", icon: I.Bars, title: "Podcast", desc: "Hai người dẫn từ tài liệu hoặc link", tone: "blue" },
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
          <button key={c.title} className={`sp-tcard t-${c.tone}`} onClick={() => go(c.t, c.sub)}>
            <span className="sp-tic"><c.icon size={18} /></span>
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
