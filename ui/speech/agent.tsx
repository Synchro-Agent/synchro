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
import { tr, locale } from "../i18n";
import { AGENT_MODELS, AGENT_TEMPLATES } from "../../shared/speech/data";
import { LANGS, ago, api, checkMic, del, fmtDur, langLabel, micError, post, useItems, usePlan, type Item, type Voice } from "./client";
import { ErrBox, Field, ModelPick, Range, Select, Spin, Toggle, VoiceAvatar, VoicePicker } from "./parts";
import { Head, Split } from "./shell";
import type { ToolProps } from "./view";

// langSet: người dùng tự chọn ngôn ngữ cố định (bản trước lưu sẵn "vi"; chưa tự chọn thì dùng Tự nhận diện).
type Cfg = { name: string; model: string; first: string; prompt: string; lang: string; langSet?: boolean; voiceId: string; voiceName: string; interrupt: boolean; eager: number; maxMin: number };
const CFG0: Cfg = {
  name: AGENT_TEMPLATES[0].name, model: AGENT_MODELS[0].id, first: AGENT_TEMPLATES[0].first, prompt: AGENT_TEMPLATES[0].prompt, lang: "", voiceId: "", voiceName: "", interrupt: true, eager: 50, maxMin: 10,
};
type Line = { who: "ai" | "me"; text: string };
type Conn = { close: () => void; sync?: () => void };

export function AgentTool({ say, sub, setSub, voice: shared }: ToolProps) {
  const tab = sub === "hist" ? "hist" : "agent";
  const [cfg, setCfg] = usePref<Cfg>("spAgent", CFG0);
  const c0 = { ...CFG0, ...cfg, ...(cfg.langSet ? {} : { lang: "" }) };
  // Tên, lời chào, hướng dẫn còn đúng chữ gốc của một mẫu (chưa sửa, như mặc định “Trợ lý Synchro”): hiện và dùng theo ngôn ngữ giao diện,
  // để giao diện tiếng Anh không còn chữ Việt dưới quả cầu, trong tiêu đề cuộc gọi hay lời agent chào. Chữ người dùng tự gõ giữ nguyên.
  // So cả bản tiếng Anh của mẫu: đổi cài đặt khi đang ở giao diện tiếng Anh lưu chữ Anh, quay về tiếng Việt vẫn hiện chữ Việt.
  const loc = (v: string, k: "name" | "first" | "prompt") => { const t = AGENT_TEMPLATES.find((x) => x[k] === v || tr(x[k], "en") === v); return t ? tr(t[k]) : v; };
  const c = { ...c0, name: loc(c0.name, "name"), first: loc(c0.first, "first"), prompt: loc(c0.prompt, "prompt") };
  const set = (p: Partial<Cfg>) => setCfg({ ...c, ...p });
  const [phase, setPhase] = useState<"idle" | "connecting" | RtPhase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [sec, setSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [micErr, setMicErr] = useState("");
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
      try { const j = await post<{ item: Item }>("live/save", { kind: "call", title: `${c.name} · ${new Date().toLocaleString(locale())}`, lines: ls, seconds: secRef.current, lang: c.lang }); setHist((h) => [j.item, ...(h ?? [])]); } catch {}
    }
  };
  const start = async () => {
    setLines([]); setSec(0); secRef.current = 0; setPhase("connecting"); setMicErr("");
    // Mở thử micro trước: trình duyệt chặn micro thì báo rõ cách cho phép ngay tại khung gọi, không để nút đứng im.
    const bad = await checkMic();
    if (bad) { setPhase("idle"); setMicErr(bad); say(bad); return; }
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
    } catch (e) {
      setPhase("idle");
      const name = (e as { name?: string } | null)?.name ?? "";
      const m = /^(NotAllowed|NotFound|NotReadable|Security|Overconstrained|Abort)Error$/.test(name) ? micError(e) : (e as Error).message || micError(e);
      if (m === micError(e)) setMicErr(m);
      say(m);
    }
  };
  const view = async (it: Item) => {
    try { const j = await api<{ data: { lines: Line[] } }>(`items?id=${it.id}`); setOpen({ item: it, lines: j.data?.lines ?? [] }); } catch (e) { say((e as Error).message); }
  };
  const live = phase !== "idle";
  const model = AGENT_MODELS.find((x) => x.id === c.model) ?? AGENT_MODELS[0];
  const voiceObj = { id: voiceId || "default" };

  const rt = !!usePlan()?.realtime;
  const tpl = AGENT_TEMPLATES.find((t) => (t.prompt === c.prompt || tr(t.prompt) === c.prompt) && (t.first === c.first || tr(t.first) === c.first))?.label;
  return (
    <Split head={<Head tool="agent" />} tab={tab} setTab={setSub} wide
      tabs={[{ k: "agent", label: "Agent", icon: <I.Sliders size={14} /> }, { k: "hist", label: "Lịch sử", icon: <I.History size={14} /> }]}
      side={<>
          {tab === "agent" ? (
            <>
              <Field label="Tên agent" htmlFor="ag-name"><input id="ag-name" className="sp-input" value={c.name} onChange={(e) => set({ name: e.target.value })} disabled={live} /></Field>
              {rt ? <Field label="Model"><ModelPick models={AGENT_MODELS} value={c.model} onChange={(model) => set({ model })} /></Field>
                : <p className="sp-hint">Khóa ElevenLabs chưa có quyền Eleven Realtime, nên agent chạy nối tiếp: Scribe nghe bạn nói, model chat của Synchro trả lời, giọng ElevenLabs đọc lên.</p>}
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
      </>}>
      {!live && (
        <div className="sp-tpls" aria-label="Mẫu agent">
          <span>Chọn mẫu</span>
          {AGENT_TEMPLATES.map((t) => <button key={t.label} className={`sp-tag ${tpl === t.label ? "on" : ""}`} onClick={() => set({ name: tr(t.name), first: tr(t.first), prompt: tr(t.prompt) })}>{t.label}</button>)}
        </div>
      )}
        <div className={`sp-call ${phase === "speak" ? "speak" : live ? "listen" : "idle"}`}>
          <div className="sp-agent-orb"><PearlOrb level={level} active={live} /></div>
          <b className="sp-call-n" data-notr>{c.name}</b>
          <span className="sp-muted">{!live ? `${rt ? model.name : "Scribe + Synchro + ElevenLabs"} · giọng ${voiceName} · ${LANGS.find((x) => x[0] === c.lang)?.[1] ?? langLabel(c.lang, c.lang)}` : phase === "connecting" ? "Đang kết nối…" : `${phase === "speak" ? "Đang nói" : phase === "think" ? "Đang nghĩ" : "Đang nghe"} · ${fmtDur(sec)}`}</span>
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
          {!live && <ErrBox msg={micErr} />}
        </div>
        <div className="sp-ctrans" ref={scroll} aria-live="polite">
          {!lines.length && !caption && !heard && <div className="sp-empty">Bấm “Gọi thử” để nói chuyện với agent bằng micro. Lời thoại sẽ hiện ở đây.</div>}
          {lines.map((l, i) => <div key={i} className={`sp-bub ${l.who}`}>{l.who === "ai" && <VoiceAvatar v={voiceObj} size={20} />}<p data-notr>{l.text}</p></div>)}
          {heard && <div className="sp-bub me partial"><p data-notr>{heard}</p></div>}
          {caption && <div className="sp-bub ai partial"><VoiceAvatar v={voiceObj} size={20} playing /><p data-notr>{caption}</p></div>}
        </div>
      {pick && <VoicePicker value={voiceId} onPick={(v: Voice) => set({ voiceId: v.id, voiceName: v.name })} onClose={() => setPick(false)} say={say} />}
    </Split>
  );
}
