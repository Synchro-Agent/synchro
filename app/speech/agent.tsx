"use client";
// Voice Agent: gọi thử thật với Eleven Realtime (nghe, suy nghĩ và nói đều ở ElevenLabs) theo cấu hình của bạn,
// lời thoại hiện trực tiếp và được lưu vào lịch sử khi kết thúc cuộc gọi. Khóa chưa có quyền Realtime: gọi bằng chế độ nối tiếp
// (Scribe nghe, model chat của Synchro trả lời, giọng ElevenLabs đọc), tự nhận ngôn ngữ người nói.
import { useEffect, useMemo, useRef, useState } from "react";
import * as I from "../icons";
import { usePref } from "../store";
import { startRealtime, type RtHandlers, type RtPhase } from "../realtime";
import { startCascade } from "../voicecall";
import { PearlOrb } from "../pearlorb";
import { AGENT_MODELS } from "./data";
import { LANGS, ago, api, del, fmtDur, post, useItems, type Item, type Voice } from "./client";
import { Field, ModelPick, Range, Select, Spin, Toggle, VoiceAvatar, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";

// langSet: người dùng tự chọn ngôn ngữ cố định (bản trước lưu sẵn "vi"; chưa tự chọn thì dùng Tự nhận diện).
type Cfg = { name: string; model: string; first: string; prompt: string; lang: string; langSet?: boolean; voiceId: string; voiceName: string; interrupt: boolean; eager: number; maxMin: number };
const CFG0: Cfg = {
  name: "Trợ lý Synchro", model: AGENT_MODELS[0].id, first: "Xin chào! Mình là trợ lý của Synchro. Mình có thể giúp gì cho bạn hôm nay?",
  prompt: "Bạn là trợ lý thân thiện của Synchro. Trả lời ngắn gọn, tự nhiên như người thật, hỏi lại khi chưa rõ.", lang: "", voiceId: "", voiceName: "", interrupt: true, eager: 50, maxMin: 10,
};
type Line = { who: "ai" | "me"; text: string };
type Conn = { close: () => void; sync?: () => void };

export function AgentTool({ say, sub, setSub, voice: shared }: ToolProps) {
  const tab = sub === "hist" ? "hist" : "agent";
  const [cfg, setCfg] = usePref<Cfg>("spAgent", CFG0);
  const c = { ...CFG0, ...cfg, ...(cfg.langSet ? {} : { lang: "" }) };
  const set = (p: Partial<Cfg>) => setCfg({ ...c, ...p });
  const [phase, setPhase] = useState<"idle" | "connecting" | RtPhase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [sec, setSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [pick, setPick] = useState(false);
  const [hist, setHist] = useItems(["call"]);
  const [open, setOpen] = useState<{ item: Item; lines: Line[] } | null>(null);
  const conn = useRef<Conn | null>(null);
  const linesRef = useRef<Line[]>([]);
  const secRef = useRef(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  useEffect(() => { conn.current?.sync?.(); }, [muted]);
  const scroll = useRef<HTMLDivElement>(null);
  const micLv = useRef(0), aiLv = useRef(0);
  const level = useMemo(() => ({ get current() { return Math.max(micLv.current, aiLv.current); }, set current(_v: number) {} }), []);
  const voiceId = c.voiceId || shared?.id || "", voiceName = c.voiceName || shared?.name || "mặc định";
  useEffect(() => { linesRef.current = lines; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  useEffect(() => {
    if (phase === "idle" || phase === "connecting") return;
    const t = setInterval(() => setSec((s) => { secRef.current = s + 1; return s + 1; }), 1000);
    return () => clearInterval(t);
  }, [phase === "idle" || phase === "connecting"]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => conn.current?.close(), []);

  const end = async (why?: string) => {
    conn.current?.close(); conn.current = null;
    setPhase("idle"); setCaption(""); setHeard("");
    if (why) say(why);
    const ls = linesRef.current;
    if (ls.length) {
      try { const j = await post<{ item: Item }>("live/save", { kind: "call", title: `${c.name} · ${new Date().toLocaleString("vi-VN")}`, lines: ls, seconds: secRef.current, lang: c.lang }); setHist((h) => [j.item, ...(h ?? [])]); } catch {}
    }
  };
  const start = async () => {
    setLines([]); setSec(0); secRef.current = 0; setPhase("connecting");
    try {
      const s = await post<{ value?: string; url: string; model: string; voice: string; cascade?: boolean }>("agent/session", { model: c.model, voice: voiceId, prompt: c.prompt, lang: c.lang, eagerness: c.eager < 34 ? "low" : c.eager < 67 ? "medium" : "high", interrupt: c.interrupt, maxMin: c.maxMin });
      const handlers: RtHandlers = {
        onPhase: setPhase,
        onCaption: setCaption,
        onUser: setHeard,
        onTurn: (u, a) => { setLines((l) => [...l, ...(u ? [{ who: "me" as const, text: u }] : []), { who: "ai" as const, text: a }]); setCaption(""); setHeard(""); },
        onError: (m) => say(m),
        onClose: () => void end("Cuộc gọi đã kết thúc"),
      };
      if (s.cascade || !s.value) {
        conn.current = await startCascade({ system: c.prompt, greet: c.first, voice: voiceId || undefined, micLevel: micLv, outLevel: aiLv, muted: () => mutedRef.current, barge: () => c.interrupt, maxSeconds: c.maxMin * 60 }, handlers);
      } else {
        if (voiceId && !s.voice) say("Giọng đã chọn chưa dùng được cho Realtime, agent dùng giọng mặc định");
        conn.current = await startRealtime({ url: s.url, model: s.model, secret: s.value, micLevel: micLv, outLevel: aiLv, muted: () => mutedRef.current, barge: () => c.interrupt, greet: c.first }, handlers);
      }
    } catch (e) { setPhase("idle"); say((e as Error).message || "Không mở được micro: hãy cho phép Synchro dùng micro"); }
  };
  const view = async (it: Item) => {
    try { const j = await api<{ data: { lines: Line[] } }>(`items?id=${it.id}`); setOpen({ item: it, lines: j.data?.lines ?? [] }); } catch (e) { say((e as Error).message); }
  };
  const live = phase !== "idle";
  const model = AGENT_MODELS.find((x) => x.id === c.model) ?? AGENT_MODELS[0];
  const voiceObj = { id: voiceId || "default" };

  return (
    <div className="sp-split">
      <div className="sp-main">
        <ToolHead title="Voice Agent" desc="Agent giọng nói trò chuyện hai chiều thời gian thực: tự nhận lượt nói, cho phép ngắt lời. Tốn phút trò chuyện của gói ElevenLabs." />
        <div className={`sp-call ${phase === "speak" ? "speak" : live ? "listen" : "idle"}`}>
          <div className="sp-agent-orb"><PearlOrb level={level} active={live} /></div>
          <b className="sp-call-n" data-notr>{c.name}</b>
          <span className="sp-muted">{!live ? `${model.name} · giọng ${voiceName} · ${LANGS.find((x) => x[0] === c.lang)?.[1] ?? c.lang}` : phase === "connecting" ? "Đang kết nối…" : `${phase === "speak" ? "Đang nói" : phase === "think" ? "Đang nghĩ" : "Đang nghe"} · ${fmtDur(sec)}`}</span>
          <div className="sp-call-a">
            {!live ? (
              <button className="btn dark sp-go" onClick={start}><I.Mic size={15} />Gọi thử</button>
            ) : (
              <>
                <button className={`sp-round ${muted ? "on" : ""}`} aria-pressed={muted} aria-label={muted ? "Bật micro" : "Tắt micro"} onClick={() => setMuted(!muted)}><I.Mic size={18} /></button>
                <button className="sp-round end" aria-label="Kết thúc" onClick={() => void end()}><I.X size={18} /></button>
              </>
            )}
          </div>
        </div>
        <div className="sp-ctrans" ref={scroll} aria-live="polite">
          {!lines.length && !caption && !heard && <div className="sp-empty">Bấm “Gọi thử” để nói chuyện với agent bằng micro. Lời thoại sẽ hiện ở đây.</div>}
          {lines.map((l, i) => <div key={i} className={`sp-bub ${l.who}`}>{l.who === "ai" && <VoiceAvatar v={voiceObj} size={20} />}<p data-notr>{l.text}</p></div>)}
          {heard && <div className="sp-bub me partial"><p data-notr>{heard}</p></div>}
          {caption && <div className="sp-bub ai partial"><VoiceAvatar v={voiceObj} size={20} playing /><p data-notr>{caption}</p></div>}
        </div>
      </div>

      <aside className="sp-aside wide">
        <div className="sp-atabs" role="tablist" aria-label="Cấu hình agent">
          {([["agent", "Agent"], ["hist", "Lịch sử"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>)}
        </div>
        <div className="sp-aside-in">
          {tab === "agent" ? (
            <>
              <Field label="Tên agent" htmlFor="ag-name"><input id="ag-name" className="sp-input" value={c.name} onChange={(e) => set({ name: e.target.value })} disabled={live} /></Field>
              <Field label="Model"><ModelPick models={AGENT_MODELS} value={c.model} onChange={(model) => set({ model })} /></Field>
              <Field label="Giọng"><button className="sp-vbig" onClick={() => setPick(true)} disabled={live}><VoiceAvatar v={voiceObj} size={30} /><span><b data-notr>{voiceName}</b><small>Giọng trong tài khoản ElevenLabs</small></span><I.Chevron size={14} /></button></Field>
              <Select id="ag-lang" label="Ngôn ngữ" value={c.lang} options={LANGS} onChange={(lang) => set({ lang, langSet: true })} />
              <Field label="Lời chào đầu" hint="Để trống thì agent chờ bạn nói trước" htmlFor="ag-first"><textarea id="ag-first" className="sp-input ta" rows={2} value={c.first} onChange={(e) => set({ first: e.target.value })} /></Field>
              <Field label="Hướng dẫn hệ thống" hint={`${c.prompt.length} ký tự`} htmlFor="ag-prompt"><textarea id="ag-prompt" className="sp-input ta" rows={5} value={c.prompt} onChange={(e) => set({ prompt: e.target.value })} /></Field>
              <hr className="sp-hr" />
              <Toggle checked={c.interrupt} onChange={(interrupt) => set({ interrupt })} label="Cho phép ngắt lời" hint="Bạn nói chen thì agent dừng lại" />
              <Range id="ag-eager" label="Độ nhanh nhận lượt" value={c.eager} onChange={(eager) => set({ eager })} left="Kiên nhẫn" right="Nhanh nhảu" show={c.eager < 34 ? "Thấp" : c.eager < 67 ? "Vừa" : "Cao"} />
              <Select id="ag-max" label="Thời lượng tối đa mỗi cuộc gọi" value={String(c.maxMin)} options={[["3", "3 phút"], ["5", "5 phút"], ["10", "10 phút"], ["30", "30 phút"]]} onChange={(v) => set({ maxMin: Number(v) })} inline />
              <button className="sp-link" onClick={() => setCfg(CFG0)}>Đặt lại mặc định</button>
            </>
          ) : open ? (
            <>
              <button className="sp-back" onClick={() => setOpen(null)}><I.Back size={15} />Lịch sử</button>
              <b data-notr>{open.item.title}</b>
              {open.lines.map((l, i) => <div key={i} className={`sp-bub ${l.who}`}><p data-notr>{l.text}</p></div>)}
            </>
          ) : (
            <>
              {hist === null && <div className="sp-empty"><Spin /></div>}
              {hist?.length === 0 && <div className="sp-empty">Chưa có cuộc gọi thử nào.</div>}
              {hist?.map((h) => (
                <div key={h.id} className="sp-hrow">
                  <div className="sp-hrow-t"><b data-notr>{h.title}</b><span className="sp-muted">{fmtDur(Number(h.meta.seconds ?? 0))} · {ago(h.createdAt)}</span></div>
                  <p data-notr>{String(h.meta.preview ?? "")}</p>
                  <div className="sp-hrow-a"><button className="sp-link" onClick={() => view(h)}>Xem lời thoại</button><button className="icon-btn" aria-label="Xóa" onClick={() => del("items", h.id).then(() => setHist((x) => x?.filter((y) => y.id !== h.id) ?? null))}><I.Trash size={14} /></button></div>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
      {pick && <VoicePicker value={voiceId} onPick={(v: Voice) => set({ voiceId: v.id, voiceName: v.name })} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
