"use client";
// Voice Agent: gọi thử thời gian thực, cấu hình agent, công cụ, kiến thức, triển khai và lịch sử cuộc gọi.
import { useEffect, useMemo, useRef, useState } from "react";
import * as I from "../icons";
import { AGENT_MODELS, LANGS, VOICES, type Voice } from "./data";
import { Drop, Field, ModelPick, Range, Select, Toggle, VoiceAvatar, VoicePicker } from "./parts";
import { ToolHead, type ToolProps } from "./view";
import { startMicLevel, useSpeakingLevel } from "../voicefx";
import { PearlOrb } from "../pearlorb";

const SCRIPT: { who: "ai" | "me"; text: string }[] = [
  { who: "ai", text: "Xin chào! Mình là trợ lý của Synchro. Mình có thể giúp gì cho bạn hôm nay?" },
  { who: "me", text: "Mình muốn đặt lịch hẹn tư vấn vào chiều thứ Sáu." },
  { who: "ai", text: "Được ạ. Chiều thứ Sáu còn trống lúc 14 giờ và 16 giờ 30. Bạn chọn giờ nào?" },
  { who: "me", text: "16 giờ 30 nhé." },
  { who: "ai", text: "Mình đã đặt lịch 16 giờ 30 thứ Sáu và gửi xác nhận qua email cho bạn rồi." },
];
const TOOLS0 = [
  { k: "end", name: "Kết thúc cuộc gọi", desc: "Agent tự cúp máy khi xong việc", on: true },
  { k: "lang", name: "Chuyển ngôn ngữ", desc: "Đổi ngôn ngữ theo người gọi", on: true },
  { k: "transfer", name: "Chuyển máy cho người thật", desc: "Chuyển sang số tổng đài khi cần", on: false },
  { k: "web", name: "Tra cứu web", desc: "Tìm thông tin mới trên Internet", on: false },
  { k: "book", name: "Đặt lịch hẹn (webhook)", desc: "POST https://api.vidu.vn/lich-hen", on: true },
];
const DOCS0 = [
  { name: "bang-gia-2026.pdf", size: "1,2 MB", rag: true },
  { name: "https://synchro.net.nz/huong-dan", size: "14 trang", rag: true },
  { name: "cau-hoi-thuong-gap.docx", size: "86 KB", rag: false },
];
const CALLS = [
  { when: "Hôm nay 10:12", dur: "3:41", ok: true, sum: "Khách đặt lịch tư vấn chiều thứ Sáu, đã gửi email xác nhận." },
  { when: "Hôm qua 16:05", dur: "1:18", ok: true, sum: "Hỏi giá gói Pro, agent gửi bảng giá." },
  { when: "Hôm qua 09:47", dur: "0:22", ok: false, sum: "Người gọi cúp máy giữa chừng." },
];

export function AgentTool({ say, demo, sub, setSub }: ToolProps) {
  const tab = (["agent", "tools", "kb", "deploy", "hist"] as const).find((x) => x === sub) ?? "agent";
  const [state, setState] = useState<"idle" | "listen" | "speak">("idle");
  const [lines, setLines] = useState<typeof SCRIPT>([]);
  const [sec, setSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [model, setModel] = useState(AGENT_MODELS[0].id);
  const [name, setName] = useState("Trợ lý Synchro");
  const [first, setFirst] = useState(SCRIPT[0].text);
  const [prompt, setPrompt] = useState("Bạn là trợ lý đặt lịch thân thiện của Synchro. Trả lời ngắn gọn, tự nhiên như người thật, luôn xác nhận lại ngày giờ trước khi đặt.");
  const [voice, setVoice] = useState<Voice>(VOICES[4]);
  const [lang, setLang] = useState("Tiếng Việt");
  const [interrupt, setInterrupt] = useState(true);
  const [eager, setEager] = useState(50);
  const [timeout_, setTimeout_] = useState(7);
  const [maxDur, setMaxDur] = useState("10 phút");
  const [tools, setTools] = useState(TOOLS0);
  const [docs, setDocs] = useState(DOCS0);
  const [pick, setPick] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  // Quả cầu phản ứng theo micro khi đến lượt người gọi, và nhấp nhô theo giọng agent khi agent nói.
  const micLv = useRef(0), aiLv = useRef(0);
  const level = useMemo(() => ({ get current() { return Math.max(micLv.current, aiLv.current); }, set current(_v: number) {} }), []);
  useSpeakingLevel(state === "speak", aiLv);
  useEffect(() => {
    if (state === "idle" || muted) return;
    let stop: (() => void) | null = null, dead = false;
    startMicLevel(micLv).then((s) => { if (dead) s(); else stop = s; }).catch(() => {});
    return () => { dead = true; stop?.(); };
  }, [state === "idle", muted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state === "idle") return;
    const a = setInterval(() => setSec((s) => s + 1), 1000);
    const b = setInterval(() => setLines((l) => (l.length >= SCRIPT.length ? l : [...l, SCRIPT[l.length]])), 2600);
    return () => { clearInterval(a); clearInterval(b); };
  }, [state === "idle"]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const l = lines[lines.length - 1]; if (l) setState((s) => (s === "idle" ? s : l.who === "ai" ? "speak" : "listen")); }, [lines]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  const start = () => { setLines([SCRIPT[0]]); setSec(0); setState("speak"); demo(); };
  const end = () => { setState("idle"); say(`Đã kết thúc cuộc gọi thử · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`); };

  return (
    <div className="sp-split">
      <div className="sp-main">
        <ToolHead title="Voice Agent" desc="Agent giọng nói trò chuyện hai chiều thời gian thực: tự nhận lượt nói, cho phép ngắt lời, gọi công cụ." />
        <div className={`sp-call ${state}`}>
          <div className="sp-agent-orb"><PearlOrb level={level} active={state !== "idle"} /></div>
          <b className="sp-call-n">{name}</b>
          <span className="sp-muted">{state === "idle" ? `${AGENT_MODELS.find((x) => x.id === model)?.name} · giọng ${voice.name} · ${lang}` : `${state === "speak" ? "Đang nói" : "Đang nghe"} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`}</span>
          <div className="sp-call-a">
            {state === "idle" ? (
              <button className="btn dark sp-go" onClick={start}><I.Mic size={15} />Gọi thử</button>
            ) : (
              <>
                <button className={`sp-round ${muted ? "on" : ""}`} aria-pressed={muted} aria-label={muted ? "Bật micro" : "Tắt micro"} onClick={() => setMuted(!muted)}><I.Mic size={18} /></button>
                <button className="sp-round end" aria-label="Kết thúc" onClick={end}><I.X size={18} /></button>
              </>
            )}
          </div>
        </div>
        <div className="sp-ctrans" ref={scroll} aria-live="polite">
          {lines.length === 0 && <div className="sp-empty">Bấm “Gọi thử” để nói chuyện với agent bằng micro. Lời thoại sẽ hiện ở đây.</div>}
          {lines.map((l, i) => <div key={i} className={`sp-bub ${l.who}`}>{l.who === "ai" && <VoiceAvatar v={voice} size={20} />}<p>{l.text}</p></div>)}
          {lines.length >= 3 && <div className="sp-toolcall"><I.Plug size={13} />Đã gọi công cụ <b>Đặt lịch hẹn</b> · 214 ms</div>}
        </div>
      </div>

      <aside className="sp-aside wide">
        <div className="sp-atabs" role="tablist" aria-label="Cấu hình agent">
          {([["agent", "Agent"], ["tools", "Công cụ"], ["kb", "Kiến thức"], ["deploy", "Triển khai"], ["hist", "Lịch sử"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>)}
        </div>
        <div className="sp-aside-in">
          {tab === "agent" && (
            <>
              <Field label="Tên agent" htmlFor="ag-name"><input id="ag-name" className="sp-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Model"><ModelPick models={AGENT_MODELS} value={model} onChange={setModel} /></Field>
              <p className="sp-note">Toàn bộ agent chạy trên ElevenLabs: nghe, suy nghĩ và nói đều do model Eleven Realtime đảm nhận.</p>
              <Field label="Giọng"><button className="sp-vbig" onClick={() => setPick(true)}><VoiceAvatar v={voice} size={30} /><span><b>{voice.name}</b><small>{voice.desc}</small></span><I.Chevron size={14} /></button></Field>
              <Select id="ag-lang" label="Ngôn ngữ chính" value={lang} options={LANGS.slice(1)} onChange={setLang} />
              <Field label="Lời chào đầu" htmlFor="ag-first"><textarea id="ag-first" className="sp-input ta" rows={2} value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
              <Field label="Hướng dẫn hệ thống" hint={`${prompt.length} ký tự`} htmlFor="ag-prompt"><textarea id="ag-prompt" className="sp-input ta" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
              <hr className="sp-hr" />
              <Toggle checked={interrupt} onChange={setInterrupt} label="Cho phép ngắt lời" hint="Người gọi nói chen thì agent dừng lại" />
              <Range id="ag-eager" label="Độ nhanh nhận lượt" value={eager} onChange={setEager} left="Kiên nhẫn" right="Nhanh nhảu" show={eager < 34 ? "Thấp" : eager < 67 ? "Vừa" : "Cao"} />
              <Range id="ag-to" label="Hỏi lại khi im lặng sau" value={timeout_} min={3} max={30} onChange={setTimeout_} show={`${timeout_} giây`} />
              <Select id="ag-max" label="Thời lượng tối đa mỗi cuộc gọi" value={maxDur} options={["5 phút", "10 phút", "30 phút", "60 phút"]} onChange={setMaxDur} inline />
            </>
          )}
          {tab === "tools" && (
            <>
              {tools.map((t) => <Toggle key={t.k} checked={t.on} onChange={(v) => setTools(tools.map((x) => (x.k === t.k ? { ...x, on: v } : x)))} label={t.name} hint={t.desc} />)}
              <button className="sp-add" onClick={() => say("Thêm webhook, công cụ phía trình duyệt hoặc máy chủ MCP (mẫu)")}><I.Plus size={14} />Thêm công cụ</button>
              <p className="sp-note">Công cụ dạng webhook gọi từ máy chủ Synchro, khóa bí mật không bao giờ lộ ra trình duyệt.</p>
            </>
          )}
          {tab === "kb" && (
            <>
              <Drop compact title="Thêm tài liệu" sub="PDF, DOCX, TXT, HTML, EPUB · hoặc dán URL" onFile={(f) => setDocs([...docs, ...f.map((x) => ({ name: x.name, size: `${Math.max(1, Math.round(x.size / 1024))} KB`, rag: true }))])} multiple />
              {docs.map((d, i) => (
                <div key={d.name + i} className="sp-doc">
                  <I.File size={16} /><span className="sp-doc-n"><b>{d.name}</b><small>{d.size}</small></span>
                  <button role="switch" aria-checked={d.rag} aria-label="Dùng RAG" className={`sp-tg ${d.rag ? "on" : ""}`} onClick={() => setDocs(docs.map((x, j) => (j === i ? { ...x, rag: !x.rag } : x)))} />
                  <button className="icon-btn" aria-label="Xóa" onClick={() => setDocs(docs.filter((_, j) => j !== i))}><I.Trash size={14} /></button>
                </div>
              ))}
              <p className="sp-note">Bật RAG để agent chỉ tra phần liên quan, giữ câu trả lời nhanh với tài liệu dài.</p>
            </>
          )}
          {tab === "deploy" && (
            <>
              <Field label="Nhúng vào website">
                <pre className="sp-code">{`<elevenlabs-convai agent-id="agent_demo_8f2c"></elevenlabs-convai>\n<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async></script>`}</pre>
              </Field>
              <button className="btn" onClick={() => say("Đã sao chép mã nhúng")}><I.Copy size={14} />Sao chép mã</button>
              <hr className="sp-hr" />
              <Field label="Số điện thoại"><button className="sp-vbig" onClick={() => say("Kết nối Twilio hoặc SIP trunk (mẫu)")}><span><b>Chưa gắn số</b><small>Twilio hoặc SIP trunk · nhận và gọi ra</small></span><I.Plus size={14} /></button></Field>
              <Field label="Gọi hàng loạt"><button className="sp-vbig" onClick={() => say("Tải danh sách CSV để gọi hàng loạt (mẫu)")}><span><b>Tải danh sách CSV</b><small>Nhắc lịch, khảo sát, chăm sóc khách</small></span><I.Upload size={14} /></button></Field>
            </>
          )}
          {tab === "hist" && CALLS.map((c, i) => (
            <div key={i} className="sp-hrow">
              <div className="sp-hrow-t"><span className={`sp-dot ${c.ok ? "ok" : "bad"}`} /><b>{c.when}</b><span className="sp-muted">{c.dur} · {c.ok ? "Thành công" : "Chưa xong"}</span></div>
              <p>{c.sum}</p>
              <button className="sp-link" onClick={() => say("Mở bản ghi và lời thoại cuộc gọi (mẫu)")}>Nghe lại và xem lời thoại</button>
            </div>
          ))}
        </div>
      </aside>
      {pick && <VoicePicker value={voice.id} onPick={setVoice} onClose={() => setPick(false)} say={say} />}
    </div>
  );
}
