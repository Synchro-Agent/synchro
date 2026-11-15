"use client";
// Mục Speech (ElevenLabs): khung chung, thanh trên (gói và credit thật), trang chính, trình phát chung ở đáy. Từng công cụ nằm ở tệp riêng.
// Công cụ chỉ hiện khi gói ElevenLabs quét được có tính năng đó; gói cao hơn tự hiện thêm khi được nâng.
import "../styles/speech.css";
import { useEffect, useState } from "react";
import { SideToggle } from "../brand";
import * as I from "../icons";
import { useApp } from "../store";
import { GROUPS, STARTERS, TOOLS, estCredits, normTool, toolDef, toolOn, type SpeechTool } from "../../shared/speech/data";
import { KIND_LABEL, KIND_TOOL, ago, defaultVoice, fmtNum, refreshPlan, useItems, useMyVoices, usePlan, usePlanFailed, type Voice } from "./client";
import { Dock, NotReady, Player, VoiceChip, VoicePicker } from "./parts";
import { TOOL_ICON } from "./toolicons";
import { TTS } from "./tts";
import { STT } from "./stt";
import { AgentTool } from "./agent";
import { VoicesTool } from "./voices";
import { ChangerTool, IsolateTool, MusicTool, SfxTool } from "./audio";
import { DubTool, StudioTool } from "./studio";
import { DictTool } from "./dict";
import { NativeTool } from "./native";

export { TOOL_ICON };
export type ToolProps = { say: (m: string) => void; sub: string; setSub: (s: string) => void; go: (t: SpeechTool, sub?: string) => void; draft: string; auto: number; voice: Voice | null; setVoice: (v: Voice) => void; admin: boolean };

export function SpeechView({ say, tool: raw, setTool, sideOpen, onSide }: { say: (m: string) => void; tool: SpeechTool; setTool: (t: SpeechTool) => void; sideOpen: boolean; onSide: () => void }) {
  const admin = !!useApp().me?.isAdmin;
  const plan = usePlan();
  // Gói ElevenLabs còn đang đọc (lần gọi đầu có thể mất vài giây): khung trang, thẻ, danh sách gần đây hiện ngay; chỉ phần credit và
  // danh sách công cụ (theo gói) chờ — hiện khối giả đúng chỗ.
  const planFailed = usePlanFailed();
  const waiting = !plan && !planFailed;
  const mine = useMyVoices();
  const tool = normTool(raw);
  const [subs, setSubs] = useState<Partial<Record<SpeechTool, string>>>({});
  const [draft, setDraft] = useState("");
  const [auto, setAuto] = useState(0);
  const [picked, setVoice] = useState<Voice | null>(null);
  const voice = picked ?? defaultVoice(mine);
  useEffect(() => { if (raw !== tool) setTool(tool); }, [raw, tool, setTool]);
  const go = (t: SpeechTool, sub?: string) => { if (sub) setSubs((s) => ({ ...s, [t]: sub })); setTool(t); };
  const tools = TOOLS.filter((t) => toolOn(plan, t.k));
  const cur = toolDef(tool);
  const p: ToolProps = { say, sub: subs[tool] ?? "", setSub: (s) => setSubs((o) => ({ ...o, [tool]: s })), go, draft, auto, voice, setVoice, admin };
  // shared: hạn mức chung của máy chủ hôm nay đã hết, mọi thao tác bị chặn dù hạn mức riêng còn: hiện còn 0.
  const c = plan?.credits, left = c && !c.shared ? Math.max(0, c.limit - c.used) : 0;
  const ready = !!plan?.connected && toolOn(plan, tool);
  return (
    <div className="sp">
      <div className="sp-bar">
        <div className="sp-bar-l">
          {!sideOpen && <SideToggle onClick={onSide} />}
          <button className="sp-crumb" onClick={() => setTool("home")}>Speech</button>
          {tool !== "home" && <><span className="sp-crumb-sep">/</span><span className="sp-crumb-cur">{cur.label}</span></>}
        </div>
        <div className="sp-bar-r">
          {plan?.connected && c && c.limit > 0 && (
            plan.owner ? (
              <button className="sp-credit" title={`Đã dùng ${fmtNum(c.used)} / ${fmtNum(c.limit)} credit${c.resetAt ? ` · hồi lại ngày ${new Date(c.resetAt).toLocaleDateString("vi-VN")}` : ""} · bấm để quét lại gói`} onClick={() => { void refreshPlan(true).then(() => say("Đã quét lại gói ElevenLabs")); }}>
                <b>ElevenLabs {plan.tierName}</b><span className="sp-credit-n">{fmtNum(left)} credit</span>
                <span className="sp-credit-bar"><i style={{ width: `${Math.min(100, (left / c.limit) * 100)}%` }} /></span>
              </button>
            ) : (
              <button className="sp-credit" title={c.shared ? "Giọng AI đã hết hạn mức chung của cả máy chủ hôm nay · đặt lại lúc nửa đêm (giờ UTC)" : `Hạn mức giọng AI của bạn hôm nay: còn ${fmtNum(left)} / ${fmtNum(c.limit)} credit${c.resetAt ? ` · đặt lại lúc nửa đêm (giờ UTC)` : ""}`} onClick={() => { void refreshPlan(true); }}>
                <b>Giọng AI</b><span className="sp-credit-n">{fmtNum(left)} credit hôm nay</span>
                <span className="sp-credit-bar"><i style={{ width: `${Math.min(100, (left / c.limit) * 100)}%` }} /></span>
              </button>
            )
          )}
          {plan?.connected && !plan.readPlan && <span className="sp-demo" title={plan.note ?? ""}><i />Chưa đọc được gói</span>}
          {waiting && <span className="sk-blk sp-credit-wait" aria-hidden />}
        </div>
      </div>
      <nav className="sp-tabs" aria-label="Công cụ Speech">
        {tools.map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} className={tool === t.k ? "on" : ""} onClick={() => setTool(t.k)}><Ic size={15} />{t.label}</button>; })}
        {waiting && [64, 88, 72, 96, 60, 80].map((w, i) => <span key={i} className="sk-blk sp-tab-wait" style={{ width: w }} aria-hidden />)}
      </nav>
      <div className="sp-body" key={tool}>
        {plan?.connected && plan.note && <div className="sp-note sp-planote"><I.Alert size={14} />{plan.note}</div>}
        {tool === "home" && <Home {...p} onDraft={(t, run) => { setDraft(t); setAuto(run ? Date.now() : 0); go("tts", "single"); }} />}
        {tool !== "home" && !ready && <NotReady admin={admin} />}
        {ready && tool === "tts" && <TTS {...p} />}
        {ready && tool === "changer" && <ChangerTool {...p} />}
        {ready && tool === "agent" && <AgentTool {...p} />}
        {ready && tool === "voices" && <VoicesTool {...p} area="voices" />}
        {ready && tool === "create" && <VoicesTool {...p} area="create" />}
        {ready && tool === "stt" && <STT {...p} />}
        {ready && tool === "dub" && <DubTool {...p} />}
        {ready && tool === "music" && <MusicTool {...p} />}
        {ready && tool === "sfx" && <SfxTool {...p} />}
        {ready && tool === "isolate" && <IsolateTool {...p} />}
        {ready && tool === "dict" && <DictTool {...p} />}
        {ready && tool === "native" && <NativeTool {...p} />}
        {ready && tool === "studio" && <StudioTool {...p} />}
      </div>
      <Dock />
    </div>
  );
}

// Câu gợi ý thay nhau trong ô nhập ở trang chính (như ô lệnh của ElevenLabs).
const HINTS = ["Dán một đoạn văn để AI đọc lên…", "Thử: “Chào mừng bạn đến với kênh của mình!”", "Viết lời quảng cáo, kể chuyện, bài giảng…", "Thêm [laughs] hay [whispers] để giọng có cảm xúc"];
const QUICK: { t: SpeechTool; sub?: string; label: string; desc: string; starter?: number }[] = [
  { t: "tts", sub: "single", label: "Nghe AI kể chuyện", desc: "Điền sẵn một câu chuyện có cảm xúc, bấm Tạo là nghe", starter: 0 },
  { t: "agent", label: "Nói chuyện với AI", desc: "Gọi thử trợ lý bằng micro" },
  { t: "music", label: "Sáng tác một bài nhạc", desc: "Chỉ cần một câu mô tả" },
  { t: "stt", label: "Chép lời một video", desc: "Dán link YouTube, TikTok hoặc tải tệp" },
];

function Home({ go, onDraft, say, voice, setVoice, admin }: ToolProps & { onDraft: (t: string, run: boolean) => void }) {
  const plan = usePlan();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(false);
  const [hint, setHint] = useState(0);
  const [recent] = useItems([]);
  useEffect(() => { const t = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3800); return () => clearInterval(t); }, []);
  const failed = usePlanFailed();
  const model = plan?.tts.find((m) => m.id === "eleven_v4") ?? plan?.tts[0];
  const recentList = (
    <>
      <div className="sp-sec-h"><b>Gần đây</b></div>
      <div className="sp-recent">
        {recent === null && <div className="sp-empty">Đang tải…</div>}
        {recent?.length === 0 && <div className="sp-empty">Âm thanh và bản chép lời bạn tạo sẽ nằm ở đây.</div>}
        {recent?.slice(0, 8).map((r) => (
          <div key={r.id} className="sp-rrow">
            <div className="sp-rmeta"><b data-notr>{r.title}</b><span>{KIND_LABEL[r.kind] ?? r.kind}{r.meta.voiceName ? ` · ${r.meta.voiceName}` : ""} · {ago(r.createdAt)}</span></div>
            {r.url && r.mime?.startsWith("audio") ? <Player src={r.url} dl={r.url} label={r.title} /> : <button className="btn" onClick={() => go(normTool(KIND_TOOL[r.kind] ?? "home"), r.kind === "align" ? "align" : undefined)}>Mở</button>}
          </div>
        ))}
      </div>
    </>
  );
  // Gói còn đang đọc: dựng ngay bố cục trang chính (ô soạn, thẻ công cụ, gần đây) bằng khối giả; gói về thì thay bằng phần thật.
  if (!plan && !failed) return (
    <div className="sp-home" aria-busy="true">
      <h1 className="sp-hero">Bạn muốn <em>tạo</em> gì hôm nay?</h1>
      <span className="sr-only" role="status">Đang đọc gói ElevenLabs…</span>
      <div className="sp-compose sp-wait" aria-hidden><span className="sk-blk sp-wait-ta" /><div className="sp-compose-f"><span className="sk-blk sp-wait-chip" /><span className="sk-blk sp-wait-go" /></div></div>
      <div className="sp-quick sp-wait" aria-hidden>{QUICK.map((q) => <span key={q.label} className="sk-blk sp-wait-q" />)}</div>
      {GROUPS.map((g) => (
        <section key={g.label} className="sp-grp-home" aria-hidden>
          <div className="sp-sec-h"><b>{g.label}</b></div>
          <div className="sp-cards">{g.tools.map((k) => <span key={k} className="sk-blk sp-wait-card" />)}</div>
        </section>
      ))}
      {recentList}
    </div>
  );
  if (!plan || !plan.connected) return <div className="sp-home"><h1 className="sp-hero">Bạn muốn <em>tạo</em> gì hôm nay?</h1><NotReady admin={admin} /></div>;
  const quick = QUICK.filter((q) => toolOn(plan, q.t));
  return (
    <div className="sp-home">
      <h1 className="sp-hero">Bạn muốn <em>tạo</em> gì hôm nay?</h1>
      {toolOn(plan, "tts") && (
        <div className="sp-compose">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Văn bản cần đọc" placeholder={HINTS[hint]}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onDraft(text, true); }} />
          <div className="sp-compose-f">
            <VoiceChip v={voice} onClick={() => setPick(true)} />
            {model && <span className="sp-pill">{model.name}</span>}
            <span className="sp-muted" style={{ marginLeft: "auto" }}>{text.length ? `${fmtNum(text.length)} ký tự ≈ ${fmtNum(estCredits(model, text))} credit` : "⌘ Enter để tạo"}</span>
            <button className="btn dark sp-go" disabled={!text.trim()} onClick={() => onDraft(text, true)}><I.Play size={13} />Tạo giọng nói</button>
          </div>
        </div>
      )}
      {quick.length > 0 && (
        <>
          <div className="sp-sec-h"><b>Mới bắt đầu? Thử ngay</b></div>
          <div className="sp-quick">
            {quick.map((q) => {
              const Ic = TOOL_ICON[q.t];
              return (
                <button key={q.label} className={`sp-qcard ${toolDef(q.t).color}`} onClick={() => (q.starter !== undefined ? onDraft(STARTERS[q.starter].text ?? "", false) : go(q.t, q.sub))}>
                  <span className="sp-tic"><Ic size={20} /></span><span><b>{q.label}</b><small>{q.desc}</small></span><I.ChevronR size={14} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {GROUPS.map((g) => {
        const list = g.tools.filter((k) => toolOn(plan, k));
        if (!list.length) return null;
        return (
          <section key={g.label} className="sp-grp-home">
            <div className="sp-sec-h"><b>{g.label}</b></div>
            <div className="sp-cards">
              {list.map((k) => {
                const t = toolDef(k), Ic = TOOL_ICON[k];
                return <button key={k} className={`sp-tcard ${t.color}`} onClick={() => go(k)}><span className="sp-tic"><Ic size={22} /></span><b>{t.label}</b><span>{t.desc}</span></button>;
              })}
            </div>
          </section>
        );
      })}
      {recentList}
      <a className="sp-classifier" href="https://elevenlabs.io/ai-speech-classifier" target="_blank" rel="noreferrer">
        <I.ShieldCheck size={18} /><span><b>Kiểm tra một đoạn âm thanh có phải do AI tạo ra</b><small>Công cụ chính thức của ElevenLabs (chưa có API), mở ở tab mới</small></span><I.External size={14} />
      </a>
      {pick && <VoicePicker value={voice?.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
