"use client";
// Mục Speech (ElevenLabs): khung chung, thanh trên (gói và credit thật), trang chính. Từng công cụ nằm ở tệp riêng.
// Công cụ và thẻ chỉ hiện khi gói ElevenLabs quét được có tính năng đó; gói cao hơn tự hiện thêm khi được nâng.
import { useState } from "react";
import * as I from "../icons";
import { useApp } from "../store";
import { TOOLS, toolOn, type SpeechTool } from "./data";
import { KIND_LABEL, ago, defaultVoice, fmtNum, on, refreshPlan, useItems, useMyVoices, usePlan, type Feat, type Voice } from "./client";
import { NotReady, Player, VoiceChip, VoicePicker } from "./parts";
import { TTS } from "./tts";
import { STT } from "./stt";
import { AgentTool } from "./agent";
import { VoicesTool } from "./voices";
import { AudioTool } from "./audio";
import { StudioTool } from "./studio";
import * as T from "./toolicons";

export type ToolProps = { say: (m: string) => void; sub: string; setSub: (s: string) => void; go: (t: SpeechTool, sub?: string) => void; draft: string; voice: Voice | null; setVoice: (v: Voice) => void; admin: boolean };

export const TOOL_ICON: Record<SpeechTool, (p: { size?: number }) => React.ReactNode> = {
  home: T.Home, tts: T.TextToSpeech, stt: T.SpeechToText, agent: T.Agent, voices: T.VoiceClone, audio: T.SoundEffects, studio: T.Dubbing,
};

export function SpeechView({ say, tool, setTool, sideOpen, onSide }: { say: (m: string) => void; tool: SpeechTool; setTool: (t: SpeechTool) => void; sideOpen: boolean; onSide: () => void }) {
  const admin = !!useApp().me?.isAdmin;
  const plan = usePlan();
  const mine = useMyVoices();
  const [subs, setSubs] = useState<Partial<Record<SpeechTool, string>>>({});
  const [draft, setDraft] = useState("");
  const [picked, setVoice] = useState<Voice | null>(null);
  const voice = picked ?? defaultVoice(mine);
  const go = (t: SpeechTool, sub?: string) => { if (sub) setSubs((s) => ({ ...s, [t]: sub })); setTool(t); };
  const tools = TOOLS.filter((t) => toolOn(plan, t.k));
  const cur = TOOLS.find((t) => t.k === tool) ?? TOOLS[0];
  const p: ToolProps = { say, sub: subs[tool] ?? "", setSub: (s) => setSubs((o) => ({ ...o, [tool]: s })), go, draft, voice, setVoice, admin };
  const c = plan?.credits, left = c ? Math.max(0, c.limit - c.used) : 0;
  const ready = !!plan?.connected && toolOn(plan, tool);
  return (
    <div className="sp">
      <div className="sp-bar">
        <div className="sp-bar-l">
          {!sideOpen && <button className="icon-btn" onClick={onSide} aria-label="Mở thanh bên"><I.Panel /></button>}
          <button className="sp-crumb" onClick={() => setTool("home")}>Speech</button>
          {tool !== "home" && <><span className="sp-crumb-sep">/</span><span className="sp-crumb-cur">{cur.label}</span></>}
        </div>
        <div className="sp-bar-r">
          {plan?.connected && c && c.limit > 0 && (
            <button className="sp-credit" title={`Đã dùng ${fmtNum(c.used)} / ${fmtNum(c.limit)} credit${c.resetAt ? ` · hồi lại ngày ${new Date(c.resetAt).toLocaleDateString("vi-VN")}` : ""} · bấm để quét lại gói`} onClick={() => { void refreshPlan(true).then(() => say("Đã quét lại gói ElevenLabs")); }}>
              <b>ElevenLabs {plan.tierName}</b><span className="sp-credit-n">{fmtNum(left)} credit</span>
              <span className="sp-credit-bar"><i style={{ width: `${Math.min(100, (left / c.limit) * 100)}%` }} /></span>
            </button>
          )}
          {plan?.connected && !plan.readPlan && <span className="sp-demo" title={plan.note ?? ""}><i />Chưa đọc được gói</span>}
        </div>
      </div>
      <nav className="sp-tabs" aria-label="Công cụ Speech">
        {tools.map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} className={tool === t.k ? "on" : ""} onClick={() => setTool(t.k)}><Ic size={15} />{t.label}</button>; })}
      </nav>
      <div className="sp-body" key={tool}>
        {plan?.connected && plan.note && <div className="sp-note sp-planote"><I.Alert size={14} />{plan.note}</div>}
        {tool === "home" && <Home {...p} onDraft={(t) => { setDraft(t); go("tts", "single"); }} />}
        {tool !== "home" && !ready && <NotReady admin={admin} />}
        {ready && tool === "tts" && <TTS {...p} />}
        {ready && tool === "stt" && <STT {...p} />}
        {ready && tool === "agent" && <AgentTool {...p} />}
        {ready && tool === "voices" && <VoicesTool {...p} />}
        {ready && tool === "audio" && <AudioTool {...p} />}
        {ready && tool === "studio" && <StudioTool {...p} />}
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

const CARDS: { t: SpeechTool; sub?: string; f: Feat; icon: (p: { size?: number }) => React.ReactNode; title: string; desc: string }[] = [
  { t: "tts", sub: "single", f: "tts", icon: T.TextToSpeech, title: "Đọc văn bản", desc: "Giọng tự nhiên, 90+ ngôn ngữ, thẻ cảm xúc" },
  { t: "tts", sub: "dialogue", f: "dialogue", icon: T.Dialogue, title: "Hội thoại", desc: "Nhiều người nói trong một bản" },
  { t: "agent", f: "agent", icon: T.Agent, title: "Voice Agent", desc: "Trò chuyện thời gian thực bằng giọng nói" },
  { t: "stt", sub: "file", f: "stt", icon: T.SpeechToText, title: "Chép lời", desc: "Scribe v2, tách người nói, mốc từng từ" },
  { t: "voices", sub: "design", f: "design", icon: T.VoiceDesign, title: "Thiết kế giọng", desc: "Tạo giọng mới từ một câu mô tả" },
  { t: "voices", sub: "ivc", f: "ivc", icon: T.VoiceClone, title: "Nhân bản giọng", desc: "Nhân bản nhanh từ vài phút âm thanh" },
  { t: "audio", sub: "sfx", f: "sfx", icon: T.SoundEffects, title: "Tiếng động", desc: "Hiệu ứng âm thanh từ mô tả, tới 30 giây" },
  { t: "audio", sub: "music", f: "music", icon: T.Podcast, title: "Nhạc", desc: "Sáng tác nhạc nền từ mô tả" },
  { t: "audio", sub: "isolate", f: "isolate", icon: T.Isolator, title: "Lọc tạp âm", desc: "Tách giọng khỏi nhạc và tiếng ồn" },
  { t: "audio", sub: "changer", f: "changer", icon: T.VoiceChanger, title: "Đổi giọng", desc: "Giữ cảm xúc, đổi sang giọng khác" },
  { t: "studio", sub: "dub", f: "dub", icon: T.Dubbing, title: "Lồng tiếng", desc: "Dịch video và âm thanh sang ngôn ngữ khác" },
  { t: "studio", sub: "book", f: "book", icon: T.Audiobook, title: "Sách nói", desc: "Từ EPUB, PDF, DOCX, theo chương" },
  { t: "studio", sub: "podcast", f: "podcast", icon: T.Podcast, title: "Podcast", desc: "Hai người dẫn từ tài liệu hoặc link" },
];

function Home({ go, onDraft, say, voice, setVoice, admin }: ToolProps & { onDraft: (t: string) => void }) {
  const plan = usePlan();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(false);
  const [recent] = useItems([]);
  const cards = CARDS.filter((c) => on(plan, c.f));
  const model = plan?.tts.find((m) => m.id === "eleven_v4") ?? plan?.tts[0];
  if (plan && !plan.connected) return <div className="sp-home"><h1 className="sp-hero">Hôm nay bạn muốn <em>nghe</em> gì?</h1><NotReady admin={admin} /></div>;
  return (
    <div className="sp-home">
      <h1 className="sp-hero">Hôm nay bạn muốn <em>nghe</em> gì?</h1>
      {on(plan, "tts") && (
        <div className="sp-compose">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Văn bản cần đọc"
            placeholder="Nhập hoặc dán văn bản để Synchro đọc lên. Thêm cảm xúc bằng thẻ như [laughs], [whispers]…"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onDraft(text); }} />
          <div className="sp-compose-f">
            <VoiceChip v={voice} onClick={() => setPick(true)} />
            {model && <span className="sp-pill">{model.name}</span>}
            <span className="sp-muted" style={{ marginLeft: "auto" }}>{text.length ? `${fmtNum(text.length)} ký tự ≈ ${fmtNum(text.length * (model?.rate ?? 1))} credit` : "⌘ Enter để tạo"}</span>
            <button className="btn dark" disabled={!text.trim()} onClick={() => onDraft(text)}>Tạo giọng nói</button>
          </div>
        </div>
      )}
      <div className="sp-cards">
        {cards.map((c) => (
          <button key={c.title} className="sp-tcard" onClick={() => go(c.t, c.sub)}>
            <span className="sp-tic"><c.icon size={24} /></span>
            <b>{c.title}</b><span>{c.desc}</span>
          </button>
        ))}
      </div>
      <div className="sp-sec-h"><b>Gần đây</b></div>
      <div className="sp-recent">
        {recent === null && <div className="sp-empty">Đang tải…</div>}
        {recent?.length === 0 && <div className="sp-empty">Âm thanh và bản chép lời bạn tạo sẽ nằm ở đây.</div>}
        {recent?.slice(0, 8).map((r) => (
          <div key={r.id} className="sp-rrow">
            <div className="sp-rmeta"><b data-notr>{r.title}</b><span>{KIND_LABEL[r.kind] ?? r.kind}{r.meta.voiceName ? ` · ${r.meta.voiceName}` : ""} · {ago(r.createdAt)}</span></div>
            {r.url && r.mime?.startsWith("audio") ? <Player src={r.url} dl={r.url} /> : <button className="btn" onClick={() => go(r.kind === "stt" ? "stt" : r.kind === "align" ? "audio" : "tts", r.kind === "align" ? "align" : undefined)}>Mở</button>}
          </div>
        ))}
      </div>
      {pick && <VoicePicker value={voice?.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
