"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { Avatar } from "./avatar";
import { getLang, tr } from "./i18n";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc, saveBlob, fileContext } from "./filemenu";
import { Fade, Menu, Thinking } from "./ui";
import { Directory } from "./settings";
import { HalftoneBg } from "./halftone";
import { CodeView } from "./codeview";
import { VoiceMode } from "./voicemode";
import { SpeechView, TOOL_ICON } from "./speech/view";
import { TOOLS as SP_TOOLS, type SpeechTool } from "./speech/data";
import { AuthComponent, type AuthUser, type Providers } from "./auth";
import { Markdown, makeReply } from "./md";
import { callLLM, LLMError, setActiveEffort, setActiveModel, setApprover, takeSkillsUsed, type ApprovalCall, type Decision, buildSystemPrompt, extractMemory, getRelevantContext, hasLLM, HISTORY_LIMIT, MEMORY_EVERY_N_USER_MSGS, type LLMMsg } from "./llm";
import { ProjectsPage, ProjectPage, ProjMenu } from "./projects";
import { Confirm, LangModal, ProjectModal, SearchModal, Settings, ShareModal, ShortcutsModal, UploadModal, UpgradeModal } from "./modals";

type View = "new" | "chat" | "projects" | "project" | "artifacts" | "customize" | "code" | "speech";
import { AppCtx, useApp, VOICE_LANG, VOICE_RATE, initials, reloadPrefs, resetPrefs, usePref, type Chat, type Msg, type Project } from "./store";
import { allowsModel, clampEffort, effortCap, effortsFor, isEffort, legacyModel, type Effort } from "./catalog";
import { fitModel, modelName, refreshModels, useModels } from "./models";
import { adoptLegacyData, ls, setUserScope, userScope } from "./userscope";
import { shortName } from "./names";
import { ApprovalCard } from "./connectorsui";
type Say = (m: string) => void;

const MODELS: [string, string][] = [["Opus 5", "Mạnh nhất cho việc phức tạp"], ["Sonnet 5.5", "Cân bằng tốc độ và chất lượng"], ["Haiku 5", "Nhanh nhất cho việc đơn giản"]];

function useClickAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}


function MicPicker({ say, rec, onMic }: { say: Say; rec: boolean; onMic: () => void }) {
  const [open, setOpen] = useState(false);
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const [sel, setSel] = usePref("micId", "default");
  const [lvl, setLvl] = useState(0);
  const ref = useClickAway(() => setOpen(false));
  const stream = useRef<MediaStream | null>(null);

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);
  useEffect(() => {
    if (!open) { stop(); setLvl(0); return; }
    let dead = false, raf = 0, ctx: AudioContext | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { say("Trình duyệt không cho phép truy cập micro"); setOpen(false); return; }
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: sel === "default" ? true : { deviceId: { exact: sel } } });
        if (dead) { st.getTracks().forEach((t) => t.stop()); return; }
        stream.current = st;
        setDevs((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        ctx = new AudioContext();
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(st).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let m = 0; for (const b of buf) m = Math.max(m, Math.abs(b - 128));
          setLvl((o) => o + (Math.min(1, m / 60) - o) * 0.35);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        say("Không thể truy cập micro. Hãy cấp quyền cho trình duyệt");
        setOpen(false);
      }
    })();
    return () => { dead = true; cancelAnimationFrame(raf); ctx?.close(); stop(); };
  }, [open, sel, say, stop]);

  const cur = devs.find((d) => d.deviceId === sel) ?? devs.find((d) => d.deviceId === "default") ?? devs[0];
  return (
    <div className="mic-wrap" ref={ref} data-open={open ? "1" : "0"}>
      <button className={`icon-btn mic-main ${rec ? "ghost-on" : ""}`} data-tip="Đọc chính tả" onClick={onMic} aria-label="Nhập bằng giọng nói"><I.Mic /></button>
      <button className="chev" aria-label="Chọn micro" aria-expanded={open} onClick={() => setOpen(!open)}><I.Chevron size={12} /></button>
      <Menu open={open} className="mic-menu" style={{ bottom: "calc(100% + 8px)", right: 0, width: 320 }}>
        <div className="mic-meter"><I.Mic size={14} /><div className="bar"><i style={{ transform: `scaleX(${Math.max(0.04, lvl)})` }} /></div></div>
        {devs.length === 0 && <div className="mic-empty">Đang tìm micro...</div>}
        {devs.map((d, i) => (
          <button key={d.deviceId + i} className="menu-item mic-item" onClick={() => { setSel(d.deviceId); setOpen(false); say("Đã chọn micro: " + (d.label || "Micro")); }}>
            <span className="mic-name">{d.label || `Micro ${i + 1}`}</span>
            {cur?.deviceId === d.deviceId && <span className="ck"><I.Check /></span>}
          </button>
        ))}
      </Menu>
    </div>
  );
}

const EFFORTS: [string, string][] = [["low", "Thấp"], ["medium", "Trung bình"], ["high", "Cao"], ["extra", "Cao hơn"], ["max", "Tối đa"]];

type TplKey = "doc" | "slides" | "design";
const TPLS: { k: TplKey; name: string; label: string; ph: string; desc: string; sys: string }[] = [
  { k: "doc", name: "Tài liệu", label: "Synchro Docs", ph: "Tài liệu này nên nói về chủ đề gì?", desc: "Tài liệu mà nhóm của bạn đọc, bình luận và chỉnh sửa trực tiếp, trong khi Synchro giữ cho tài liệu luôn cập nhật.",
    sys: "Tôi tạo một tài liệu soạn thảo bằng công cụ Docs, gồm tiêu đề và nội dung các phần. Tài liệu này có thể xuất ra Word, PDF hoặc Markdown." },
  { k: "slides", name: "Trang trình bày", label: "Synchro Slides", ph: "Bộ trang chiếu này nên nói về chủ đề gì?", desc: "Bộ trang chiếu mà bạn có thể trình chiếu, đổi kiểu dáng bằng hệ thống thiết kế và tải về dạng PowerPoint hoặc PDF.",
    sys: "Tôi tạo một bộ slide trong trình chỉnh sửa riêng. Mỗi slide là một tệp dữ liệu nhỏ, bạn có thể tự sửa tiêu đề hay chữ mà không cần nhờ tôi, và có thể tải về dạng PowerPoint hoặc PDF." },
  { k: "design", name: "Thiết kế", label: "Synchro Design", ph: "Bản thiết kế này nên thể hiện điều gì?", desc: "Màn hình, luồng và đồ họa được bố trí thành các bảng vẽ trên cùng một khung vẽ mà bạn có thể tự chỉnh sửa.",
    sys: "Tôi tạo một thiết kế trực quan như màn hình ứng dụng, poster, landing page hay mockup. Nó hiện trên canvas để bạn xem, chỉnh và chia sẻ." },
];

function TplArt({ k }: { k: string }) {
  if (k === "doc") return (
    <div className="ta doc"><i className="b1" /><b className="A">A</b><i className="l1" /><i className="l2" /><i className="l3" /><span className="ck" /><i className="l4" /><i className="l5" /></div>
  );
  if (k === "design") return (
    <div className="ta des"><i className="notch" /><span className="d1" /><i className="r1" /><span className="d2" /><i className="r2" /><div className="bar"><u /><u /><u /></div></div>
  );
  return <div className="ta sl"><i className="h" /><i className="p1" /><i className="p2" /><i className="p3" /><span className="img" /></div>;
}

function ModelPicker({ model, setModel }: { model: string; setModel: (m: string) => void }) {
  const [mm, setMm] = useState(false);
  const [sub, setSub] = useState<null | string>(null);
  const [subPos, setSubPos] = useState<React.CSSProperties>({});
  const [subLeft, setSubLeft] = useState<number | string>("calc(100% + 8px)");
  const [effort, setEffort] = usePref("effort", "medium");
  const { say, me, openSettings } = useApp();
  const { providers, allowed, loaded, effort: caps } = useModels();
  // Mức nỗ lực thật sự dùng: mức người dùng chọn, hạ theo giới hạn quản trị viên đặt cho model và các mức model hỗ trợ.
  const kind = providers.find((p) => p.models.some((m) => m.key === model))?.kind;
  const cap = effortCap(caps, model);
  const eff = clampEffort(isEffort(effort) ? effort : "medium", cap, kind);
  const capped = cap !== "max";
  const levelName = (k: string) => EFFORTS.find((e) => e[0] === k)?.[1] ?? k;
  useEffect(() => { setActiveEffort(eff); }, [eff]);
  // Danh sách model mở ngang hàng với tên hãng; không đủ chỗ phía dưới thì neo vào đáy menu và mọc lên trên, dài quá thì cuộn.
  const hoverProv = (id: string, el: HTMLElement) => {
    setSub(id);
    const r = el.getBoundingClientRect(), menu = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? r;
    const need = (providers.find((p) => p.id === id)?.models.length ?? 0) * el.offsetHeight + 12;
    const below = window.innerHeight - r.top - 12;
    setSubPos(need <= below ? { top: el.offsetTop - 6, maxHeight: Math.min(420, below) } : { bottom: 0, maxHeight: Math.min(420, Math.max(160, menu.bottom - 12)) });
  };
  const mref = useClickAway(() => { setMm(false); setSub(null); });
  const close = () => { setMm(false); setSub(null); };
  useEffect(() => {
    if (!sub) return;
    const m = mref.current?.querySelector(".model-menu") as HTMLElement | null;
    if (!m) return;
    const r = m.getBoundingClientRect();
    const w = sub === "effort" ? 320 : 260, vw = window.innerWidth;
    // Ưu tiên bên phải menu, rồi bên trái; màn hình hẹp quá thì đặt sát mép phải màn hình (đè lên menu) để không bị cắt.
    let x = r.right + 8;
    if (x + w > vw - 8) { x = r.left - 8 - w; if (x < 8) x = Math.max(8, vw - 8 - w); }
    setSubLeft(x - r.left);
  }, [sub, mm]);
  useEffect(() => { if (mm) refreshModels(); }, [mm]);
  const subX = { left: subLeft };
  const ok = (k: string) => allowsModel(allowed, k);
  const pick = (k: string) => {
    if (!ok(k)) { close(); say("Quản trị viên chưa cho phép tài khoản của bạn dùng model này"); return; }
    setModel(k); close();
  };
  const eLabel = levelName(eff);
  const none = loaded && !providers.length;
  return (
    <div ref={mref} style={{ position: "relative" }}>
      <button className="model-btn" onClick={() => { setMm(!mm); setSub(null); }}>{none ? "Chưa có model" : model ? modelName(model) : "Chọn model"} <span className="muted">{eLabel}</span><I.Chevron size={14} /></button>
      <Menu open={mm} className="model-menu" style={{ position: "absolute" }}>
        {none && (
          <div className="mempty">
            <b>Chưa kết nối model nào</b>
            <span>{me?.isAdmin ? "Nhập khóa API của Claude, ChatGPT hoặc Gemini để bắt đầu." : "Quản trị viên cần nhập khóa API để Synchro dùng được model."}</span>
            {me?.isAdmin && <button className="btn dark" onClick={() => { close(); openSettings?.("API"); }}>Mở Cài đặt → API</button>}
          </div>
        )}
        {providers.map((pv) => (
          <button key={pv.id} className={`menu-item mline mprov ${sub === pv.id ? "sel" : ""}`} onClick={(e) => (sub === pv.id ? setSub(null) : hoverProv(pv.id, e.currentTarget))} onMouseEnter={(e) => hoverProv(pv.id, e.currentTarget)}>
            {pv.name}<span className="sc">{pv.models.some((m) => m.key === model) && <i className="dot" />}<I.ChevronR size={16} /></span>
          </button>
        ))}
        {!none && <hr />}
        <button className={`menu-item mline ${sub === "effort" ? "sel" : ""}`} onClick={() => setSub(sub === "effort" ? null : "effort")} onMouseEnter={() => setSub("effort")}>Mức độ nỗ lực<span className="sc">{eLabel}<I.ChevronR size={16} /></span></button>
        <Menu open={sub === "effort"} className="model-sub" style={{ ...subX, bottom: 0, width: 320 }}>
          <div className="msub-note">Mức nỗ lực cao hơn đồng nghĩa với phản hồi kỹ lưỡng hơn, nhưng mất nhiều thời gian hơn và dùng hết giới hạn của bạn nhanh hơn.</div>
          {EFFORTS.filter(([k]) => effortsFor(kind).includes(k as Effort)).map(([k, l]) => {
            const locked = clampEffort(k as Effort, cap, kind) !== k;
            return (
              <button key={k} className={`menu-item mline ${locked ? "locked" : ""}`} aria-disabled={locked} title={locked ? "Quản trị viên đã khóa mức này" : undefined}
                onClick={() => { if (locked) { say(`Quản trị viên giới hạn ${modelName(model)} tối đa ở mức ${levelName(cap)}`); return; } setEffort(k); if (k === "max") say("Mức Tối đa dùng giới hạn nhanh hơn từ 5 lần"); close(); }}>
                {l}{k === "medium" && !locked && <span className="mtag">Được đề xuất</span>}
                {eff === k ? <span className="ck"><I.Check /></span> : locked && <span className="sc"><I.Lock size={14} /></span>}
              </button>
            );
          })}
          {capped && <div className="msub-note msub-cap"><I.Lock size={12} />{`Quản trị viên giới hạn model này tối đa ở mức ${levelName(cap)}.`}</div>}
        </Menu>
        {providers.map((pv) => (
          <Menu key={pv.id} open={sub === pv.id} className="model-sub msub-models" style={{ ...subX, ...subPos, width: 260 }}>
            {pv.models.map((m) => (
              <button key={m.key} className={`menu-item mline ${ok(m.key) ? "" : "locked"}`} onClick={() => pick(m.key)} title={ok(m.key) ? m.id : "Quản trị viên chưa cho phép tài khoản của bạn dùng model này"}>
                <span className="mname-t">{m.name}</span>{m.key === model ? <span className="ck"><I.Check /></span> : !ok(m.key) && <span className="sc"><I.Lock size={14} /></span>}
              </button>
            ))}
          </Menu>
        ))}
      </Menu>
    </div>
  );
}

type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };

function Composer(p: {
  onSend: (t: string, f: string[]) => void; busy: boolean; onStop: () => void; dock?: boolean; say: Say;
  prefill: { t: string; n: number }; files: string[]; setFiles: (f: string[]) => void;
  model: string; setModel: (m: string) => void; goCustom: () => void; placeholder?: string; focusPlaceholder?: string; openUpload: () => void;
  onVoice?: () => void;
}) {
  const { onSend, busy, onStop, dock, say, files, setFiles, model, setModel, openUpload } = p;
  const fm = useFileMenu(say);
  const [v, setV] = useState("");
  const [foc, setFoc] = useState(false);
  const [menu, setMenu] = useState(false);
  const [web, setWeb] = useState(true);
  const perms = useApp().me?.perms;
  const [mem, setMem] = useState(true);
  const [rec, setRec] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const recRef = useRef<Rec | null>(null);
  const ref = useClickAway(() => setMenu(false));

  useEffect(() => {
    if (p.prefill.n) { setV(p.prefill.t); ta.current?.focus(); }
  }, [p.prefill]);
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "auto";
    ta.current.style.height = Math.min(ta.current.scrollHeight, 240) + "px";
  }, [v]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "u") { e.preventDefault(); openUpload(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const canSend = !!(v.trim() || files.length);
  const submit = () => {
    if (!canSend || busy) return;
    onSend(v.trim() || "Xem tệp đính kèm", files);
    setV("");
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const [vlang] = usePref("vlang", "Vietnamese");
  usePref("uilang", "vi");
  const mic = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
    if (!SR) return say("Trình duyệt này không hỗ trợ nhập bằng giọng nói");
    if (rec) { recRef.current?.stop(); return; }
    const r = new SR();
    r.lang = VOICE_LANG[vlang] ?? "vi-VN"; r.interimResults = true;
    r.onresult = (e) => setV(Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setRec(false);
    recRef.current = r; setRec(true); r.start();
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = Array.from(e.target.files ?? []); fl.forEach((x) => saveBlob(x.name, x)); const n = fl.map((f) => f.name);
    if (n.length) setFiles([...files, ...n]);
    e.target.value = "";
  };
  const soon = (m = "Tính năng này sẽ sớm ra mắt") => { setMenu(false); say(m); };

  const plus = (
    <div ref={ref} style={{ position: "relative" }}>
      <input ref={fileIn} type="file" multiple hidden onChange={pick} />
      <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Thêm"><I.Plus /></button>
        <Menu open={!!(menu)} className="" style={{ bottom: 40, left: 0, width: 264 }}>
          {perms?.features.files !== false && <button className="menu-item" onClick={() => { setMenu(false); openUpload(); }}><I.Clip />Tải lên hoặc thêm tệp<span className="sc">⌘U</span></button>}
          <button className="menu-item" onClick={() => { setMenu(false); setFiles([...files, "Ảnh chụp màn hình.png"]); say("Đã chụp ảnh màn hình"); }}><I.Camera />Chụp ảnh màn hình</button>
          <button className="menu-item" onClick={() => soon("Hãy tạo dự án trước ở mục Dự án")}><I.Layers />Thêm vào dự án<span className="sc"><I.ChevronR size={16} /></span></button>
          <hr />
          {perms?.features.skills !== false && <button className="menu-item" onClick={() => { setMenu(false); p.goCustom(); }}><I.Scroll />Skills<span className="sc"><I.ChevronR size={16} /></span></button>}
          <button className="menu-item" onClick={() => soon("Chưa có hệ thống thiết kế nào")}><I.Palette />Hệ thống thiết kế<span className="sc"><I.ChevronR size={16} /></span></button>
          <hr />
          {perms?.features.web !== false && <button className="menu-item" onClick={() => { setWeb(!web); say(web ? "Đã tắt tìm kiếm web" : "Đã bật tìm kiếm web"); }}><I.Globe />Tìm kiếm trên web{web && <span className="ck"><I.Check /></span>}</button>}
          <button className="menu-item" onClick={() => { setMem(!mem); say(mem ? "Đã tắt bộ nhớ" : "Đã bật bộ nhớ"); }}><I.History />Bộ nhớ{mem && <span className="ck"><I.Check /></span>}</button>
        </Menu>
    </div>
  );

  const sendBtn = (
    <button className="send" disabled={!busy && !canSend} onClick={busy ? onStop : submit} aria-label="Gửi">
      {busy ? <I.Stop /> : dock ? <I.Enter /> : <I.Arrow />}
    </button>
  );
  const micBtn = <MicPicker say={say} rec={rec} onMic={mic} />;
  const modelPicker = <ModelPicker model={model} setModel={setModel} />;
  const chips = files.length > 0 && (
    <div className="attach">{fm.node}{files.map((f, i) => <FileCard key={f + i} name={f} onContextMenu={(e) => fm.open(e, f)} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}</div>
  );

  if (dock)
    return (
      <div className="composer" style={{ flexWrap: "wrap" }}>
        {chips && <div style={{ width: "100%" }}>{chips}</div>}
        {plus}
        <textarea ref={ta} rows={1} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} placeholder={p.placeholder ?? "Viết tin nhắn..."} style={{ flex: 1 }} />
        {micBtn}
        {!canSend && !busy && p.onVoice ? <button className="icon-btn vm-open" data-tip="Trò chuyện bằng giọng nói" onClick={p.onVoice} aria-label="Trò chuyện bằng giọng nói"><I.Wave /></button> : sendBtn}
      </div>
    );

  return (
    <div className="composer">
      {chips}
      <textarea ref={ta} rows={1} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} placeholder={foc && p.focusPlaceholder ? p.focusPlaceholder : p.placeholder ?? "Hôm nay tôi có thể giúp gì cho bạn?"} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)} autoFocus={!p.focusPlaceholder} />
      <div className="comp-row">
        {plus}
        <div className="model">
          {modelPicker}
          {micBtn}
          {canSend ? sendBtn : <button className="icon-btn vm-open" data-tip="Trò chuyện bằng giọng nói" onClick={p.onVoice ?? mic} aria-label="Trò chuyện bằng giọng nói"><I.Wave /></button>}
        </div>
      </div>
    </div>
  );
}

function ago(t: number): string {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "bây giờ";
  if (m < 60) return `${m} phút trước`;
  return fmt(t);
}

function greeting(call: string): string {
  const n = call.trim().split(/\s+/).pop() || "";
  const h = new Date().getHours();
  if (h < 5) return "Khuya rồi, bạn chưa ngủ à?";
  if (h < 11) return `Chào buổi sáng${n ? ", " + n : ""}`;
  if (h < 14) return `Chào buổi trưa${n ? ", " + n : ""}`;
  if (h < 18) return `Chiều tốt lành${n ? ", " + n : ""}`;
  return "Tối rồi, mọi thứ thế nào?";
}
const fmt = (t: number) => new Date(t).toLocaleTimeString(getLang() === "en" ? "en-US" : "vi-VN", { hour: "2-digit", minute: "2-digit" });

function Toast({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (text) { setShown(text); setOut(false); return; }
    setOut(true);
    const t = setTimeout(() => setShown(""), 180);
    return () => clearTimeout(t);
  }, [text]);
  if (!shown) return null;
  return <div className={`toast ${out ? "out" : ""}`} key={shown} role="status">{shown}</div>;
}

export default function Home() {
  const [name, setName] = usePref("name", "Lâm Tùng");
  const [, setAcct] = usePref("acct", "");
  const [call, setCall] = usePref("call", "Lâm Tùng");
  const [, setWork] = usePref("work", "Data science");
  const [ins] = usePref("ins", "");
  const [size] = usePref("size", "Medium");
  const [font] = usePref("font", "Anthropic Sans");
  const [uiFont] = usePref("uiFont", "Anthropic Sans");
  const [width] = usePref("width", "Narrow");
  const [motion] = usePref("motion", "System");
  const [notif] = usePref("notif", [false, true, true, true]);
  const [caps] = usePref<Record<string, boolean>>("caps", { art: true });
  const [vlang] = usePref("vlang", "Vietnamese");
  usePref("uilang", "vi");
  const [vspeed] = usePref("vspeed", "Normal");
  const [breakH] = usePref("breakH", "–");
  const [breakM] = usePref("breakM", "–");
  const [qdays] = usePref<number[]>("qdays", []);
  const [qtimes] = usePref<Record<number, [string, string]>>("qtimes", {});
  const [gc, setGc] = useState<{ title: string; text: string; ok: string; fn: () => void } | null>(null);
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.motion = motion === "Reduced" ? "reduced" : "";
    r.dataset.chatFont = font;
    r.dataset.uiFont = uiFont;
    r.dataset.textSize = size;
    r.style.setProperty("--thread-w", { Narrow: "640px", Medium: "760px", Wide: "900px" }[width] ?? "640px");
  }, [motion, font, uiFont, size, width]);
  const [view, setView] = useState<View>("new");
  const [open, setOpen] = useState(true);
  const [chats, setChats] = useState<Chat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cur, setCur] = useState<number | null>(null);
  const curRef = useRef(cur);
  curRef.current = cur;
  // Công cụ connector đang chờ người dùng duyệt: thẻ hiện cuối cuộc trò chuyện đang trả lời.
  const [approval, setApproval] = useState<{ chat: number | null; calls: ApprovalCall[]; resolve: (d: Record<string, Decision>) => void } | null>(null);
  const approvalRef = useRef(approval);
  approvalRef.current = approval;
  useEffect(() => {
    setApprover((calls) => new Promise((resolve) => setApproval({ chat: curRef.current, calls, resolve })));
    return () => setApprover(null);
  }, []);
  const [curProj, setCurProj] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fm = useFileMenu((m) => say(m));
  const [modal, setModal] = useState<null | "settings" | "lang" | "proj" | "search" | "share" | "upgrade" | "keys" | "logout" | "upload">(null);
  const [userMenu, setUserMenu] = useState(false);
  const [chatMenu, setChatMenu] = useState<number | null>(null);
  const [codeList, setCodeList] = usePref<{ id: number; title: string; pinned?: boolean }[]>("codeList", []);
  const [codeCur, setCodeCur] = useState<number | null>(null);
  const [codeEmpty, setCodeEmpty] = useState(false);
  const [codeOpen, setCodeOpen] = useState(true);
  const [spTool, setSpTool] = usePref<SpeechTool>("spTool", "home");
  const [spOpen, setSpOpen] = usePref("spOpen", false);
  // Rời Speech sang mục khác thì tự thu gọn danh sách công cụ.
  useEffect(() => { if (view !== "speech") setSpOpen(false); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const [codeRen, setCodeRen] = useState<number | null>(null);
  const [codeMenu, setCodeMenu] = useState<number | null>(null);
  const [pickProj, setPickProj] = useState(false);
  const [pjClosed, setPjClosed] = usePref<Record<number, boolean>>("pjClosed", {});
  const [titleMenu, setTitleMenu] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [delId, setDelId] = useState<number | null>(null);
  const [delProj, setDelProj] = useState<number | null>(null);
  const [theme, setThemeS] = useState("light");
  const [banner, setBanner] = useState(true);
  const [tab, setTab] = useState(0);
  const [tplMode, setTplMode] = useState<TplKey | null>(null);
  const [tplMenu, setTplMenu] = useState(false);
  const tplRef = useClickAway(() => setTplMenu(false));
  const [toast, setToast] = useState("");
  const [model, setModel] = useState("");
  const models = useModels();
  const [settingsTab, setSettingsTab] = useState("General");
  const [incog, setIncog] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [prefill, setPrefill] = useState({ t: "", n: 0 });
  const [greet, setGreet] = useState("");
  const [drag, setDrag] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<AuthUser | null | undefined>(undefined);
  const [providers, setProviders] = useState<Providers>();
  const [authLeaving, setAuthLeaving] = useState(false);
  // Hồ sơ trên máy chủ là nguồn chính; các ô trong Cài đặt → Tài khoản đọc từ đây.
  const syncProfile = (u: AuthUser) => {
    setAcct(u.email);
    if (u.profile.fullName) setName(u.profile.fullName);
    const c = u.profile.nickname || u.profile.fullName?.trim().split(/\s+/).pop();
    if (c) setCall(c);
    if (u.profile.occupation) setWork(u.profile.occupation);
  };
  // Chat, dự án, model đã chọn… của tài khoản đang dùng (localStorage đã tách theo tài khoản).
  const loadLocal = () => {
    try {
      setChats(JSON.parse(ls.get("chats") || "[]"));
      setProjects(JSON.parse(ls.get("projects") || "[]"));
      setModel(legacyModel(ls.get("model") ?? "") ?? "");
      setBanner(ls.get("banner") !== "0");
    } catch {}
  };
  // Chuyển sang vùng dữ liệu của tài khoản u: mỗi tài khoản có chat, dự án, cài đặt, ảnh đại diện riêng.
  const enterAccount = (u: AuthUser) => {
    if (userScope() === u.id) return;
    setUserScope(u.id);
    if (u.isAdmin) adoptLegacyData(u.id);
    reloadPrefs();
    loadLocal();
    setCur(null); setView("new");
  };
  useEffect(() => {
    localStorage.removeItem("session"); // phiên giả lập cũ, nay dùng cookie máy chủ
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => { setProviders(j.providers); if (j.user) { enterAccount(j.user); syncProfile(j.user); } setMe(j.user); }).catch(() => setMe(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [editProj, setEditProj] = useState<number | null>(null);
  const [sideProj, setSideProj] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 2400);
  }, []);
  // Quay về từ trang đăng nhập connector (trình duyệt chặn cửa sổ bật lên): mở Cài đặt đúng tab và báo kết quả.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const tab = q.get("settings");
    if (!tab) return;
    setSettingsTab(tab);
    setModal("settings");
    const msg = q.get("msg");
    if (msg) say(msg);
    history.replaceState(null, "", location.pathname);
  }, [say]);

  useEffect(() => {
    try {
      setChats(JSON.parse(ls.get("chats") || "[]"));
      setProjects(JSON.parse(ls.get("projects") || "[]"));
      setModel(legacyModel(ls.get("model") ?? "") ?? "");
      setBanner(ls.get("banner") !== "0");
    } catch {}
    setThemeS(localStorage.getItem("theme") || "light");
    setGreet(greeting(call));
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) setGreet(greeting(call)); }, [call, loaded]);
  useEffect(() => { setActiveModel(model); }, [model]);
  // Danh sách model đổi (quản trị viên thêm khóa, đổi quyền) → chọn lại model hợp lệ.
  useEffect(() => { if (me) refreshModels(); }, [me]);
  useEffect(() => { if (!models.loaded) return; const f = fitModel(model, models); if (f !== model) setModel(f); }, [models, model]);
  useEffect(() => {
    if (me && view === "code" && !me.perms.features.code) setView("new");
    if (me && view === "speech" && !me.perms.features.speech) setView("new");
    if (me && view === "customize" && !me.perms.features.skills) setView("new");
    if (me && (view === "projects" || view === "project") && !me.perms.features.projects) setView("new");
  }, [me, model, view]);
  useEffect(() => {
    if (!loaded) return;
    ls.set("chats", JSON.stringify(chats.filter((c) => !c.inc).map((c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, done: true })) }))));
    ls.set("projects", JSON.stringify(projects));
    ls.set("model", model);
    ls.set("banner", banner ? "1" : "0");
  }, [chats, projects, model, banner, loaded]);

  const setTheme = (t: string) => {
    setThemeS(t);
    localStorage.setItem("theme", t);
    document.documentElement.dataset.theme = t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  };

  const chat = chats.find((c) => c.id === cur);
  const patch = (id: number, fn: (m: Msg[]) => Msg[]) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, msgs: fn(c.msgs) } : c)));
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showDown, setShowDown] = useState(false);
  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
    stick.current = !far;
    setShowDown(far);
  };
  const toBottom = () => { threadRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); };
  useEffect(() => {
    const el = threadRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [chat?.msgs, busy]);

  const stop = () => {
    approvalRef.current?.resolve({});
    setApproval(null);
    genRef.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setBusy(false);
    setChats((cs) => cs.map((c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, done: true })) })));
  };
  const genRef = useRef(0);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const projsRef = useRef<Project[]>([]);
  projsRef.current = projects;
  const streamReply = async (id: number, text: string, hist?: LLMMsg[], pid?: number) => {
    const gen = ++genRef.current;
    setBusy(true);
    const pr = pid !== undefined ? projsRef.current.find((x) => x.id === pid) : undefined;
    const history = (hist ?? [{ role: "user" as const, content: text }]).slice(-HISTORY_LIMIT);
    const system = pr ? buildSystemPrompt(pr, text) : "Bạn là một trợ lý AI hữu ích.";
    let reply: string;
    let usedSk: string[] = [], usedTl: string[] = [];
    try {
      reply = await callLLM(system, history, 1500, undefined, true, { project: pid, conv: id });
      const used = takeSkillsUsed();
      usedSk = [...new Set(used.filter((u) => u.kind === "skill").map((u) => u.name))];
      usedTl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
    } catch (e) { reply = e instanceof LLMError && [400, 401, 403, 404, 410, 429, 503].includes(e.status) && e.message ? e.message : tr("Không thể kết nối tới model. Vui lòng thử lại."); }
    if (gen !== genRef.current) return;
    const usedPj = pr && !hasLLM && (pr.ins?.trim() || pr.mem?.length || getRelevantContext(pr, text).length);
    const note = usedPj ? `\n\n_${getLang() === "en" ? "Project context applied" : "Đã áp dụng ngữ cảnh dự án"}: ${[pr.ins?.trim() && (getLang() === "en" ? "instructions" : "hướng dẫn"), pr.mem?.length && (getLang() === "en" ? "memory" : "bộ nhớ"), getRelevantContext(pr, text).length && (getLang() === "en" ? "documents" : "tài liệu")].filter(Boolean).join(", ")}_` : "";
    const words = (reply + note + (ins.trim() ? `\n\n_${getLang() === "en" ? "Applied your instructions" : "Đã áp dụng hướng dẫn của bạn"}: “${ins.trim().slice(0, 90)}”_` : "")).split(/(\s+)/);
    let i = 0;
    let wait = 42;
    timer.current = setInterval(() => {
      if (wait-- > 0) return;
      i += 2;
      patch(id, (m) => [...m.slice(0, -1), { role: "ai", text: words.slice(0, i).join(""), done: i >= words.length, time: Date.now(), skills: usedSk.length ? usedSk : undefined, tools: usedTl.length ? usedTl : undefined }]);
      if (i >= words.length) {
        stop();
        if (notif[0] && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Synchro", { body: "Câu trả lời đã hoàn tất." });
        if (pr && history.filter((m) => m.role === "user").length % MEMORY_EVERY_N_USER_MSGS === 0) {
          const full: LLMMsg[] = [...history, { role: "assistant", content: reply }];
          extractMemory(projsRef.current.find((x) => x.id === pr.id) ?? pr, full).then((items) => {
            if (!items.length) return;
            setProjects((ps) => ps.map((x) => (x.id === pr.id ? { ...x, mem: [...(x.mem ?? []), ...items.filter((c) => !(x.mem ?? []).some((m) => m.content === c)).map((c, k) => ({ id: Date.now() + k, content: c }))] } : x)));
          });
        }
      }
    }, 38);
  };
  const send = (t: string, f: string[] = []) => {
    if (busy) return;
    stick.current = true;
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const pm = (x: string) => { const [t, ap] = x.split(" "); const [h, m] = t.split(":").map(Number); return ((h % 12) + (ap === "PM" ? 12 : 0)) * 60 + m; };
    const quiet = (d: number) => { const w = qtimes[d]; if (!w || !qdays.includes(d)) return false; const a = pm(w[0]), b = pm(w[1]); return a > b ? mins >= a : mins >= a && mins < b; };
    if (quiet(now.getDay()) || (mins < 12 * 60 && quiet((now.getDay() + 6) % 7))) say("Đang trong giờ yên tĩnh bạn đã đặt — hãy cân nhắc nghỉ ngơi");
    const tp = tplMode ? TPLS.find((x) => x.k === tplMode) : undefined;
    const msgs: Msg[] = [{ role: "user", text: t, files: f.length ? f : undefined, time: Date.now(), sys: tp?.sys ?? (view === "project" ? proj?.ins : undefined) }, { role: "ai", text: "", time: Date.now() }];
    let id = cur;
    if (view !== "chat" || id === null) {
      id = Date.now();
      const nid = id;
      setChats((cs) => [{ id: nid, title: t.slice(0, 40), msgs, inc: incog || undefined, project: view === "project" ? curProj ?? undefined : undefined }, ...cs]);
      setCur(id);
      setView("chat");
    } else patch(id, (m) => [...m, ...msgs]);
    setFiles([]);
    setTplMode(null);
    setPrefill({ t: "", n: 0 });
    const prior = id !== null && view === "chat" ? (chatsRef.current.find((c) => c.id === id)?.msgs ?? []) : [];
    const hist: LLMMsg[] = [...prior.filter((m) => m.text).map((m) => ({ role: (m.role === "ai" ? "assistant" : "user") as LLMMsg["role"], content: m.text })), { role: "user", content: t }];
    const pid = view === "project" ? curProj ?? undefined : chatsRef.current.find((c) => c.id === id)?.project;
    fileContext(f, t).then(({ blocks, errors }) => {
      errors.forEach((m) => say(m));
      if (blocks.length) hist[hist.length - 1] = { role: "user", content: [{ type: "text", text: t || "Hãy xem các tệp đính kèm." }, ...blocks] };
      streamReply(id, t, hist, pid);
    });
  };
  const retry = () => {
    if (!chat || busy) return;
    const lastUser = [...chat.msgs].reverse().find((m) => m.role === "user");
    patch(chat.id, (m) => [...m.slice(0, -1), { role: "ai", text: "", time: Date.now() }]);
    const upto = chat.msgs.slice(0, chat.msgs.lastIndexOf(lastUser!) + 1);
    streamReply(chat.id, lastUser?.text ?? "", upto.filter((m) => m.text).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text })), chat.project);
  };
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key); say("Đã sao chép");
    setTimeout(() => setCopied(null), 1500);
  };
  const speak = (key: string, text: string) => {
    const s = window.speechSynthesis;
    if (!s) return say("Trình duyệt không hỗ trợ đọc to");
    if (speaking === key) { s.cancel(); setSpeaking(null); return; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " "));
    // Đọc bằng đúng ngôn ngữ của câu trả lời (có dấu tiếng Việt thì giọng Việt), không ép theo cài đặt.
    const vi = /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(text);
    const pref = VOICE_LANG[vlang] ?? "vi-VN";
    u.lang = vi ? "vi-VN" : pref.startsWith("vi") ? "en-US" : pref; u.rate = VOICE_RATE[vspeed] ?? 1; u.onend = () => setSpeaking(null);
    setSpeaking(key); s.speak(u);
  };
  const like = (i: number, v: 1 | -1) => {
    if (!chat) return;
    patch(chat.id, (m) => m.map((x, j) => (j === i ? { ...x, like: x.like === v ? undefined : v } : x)));
    say("Cảm ơn phản hồi của bạn");
  };

  const goNew = () => {
    if (busy) stop();
    window.speechSynthesis?.cancel();
    setChats((cs) => cs.filter((c) => !c.inc));
    setView("new"); setCur(null); setTplMode(null); setFiles([]); setPrefill({ t: "", n: 0 });
  };
  const goCustom = () => setView("customize");
  const removeChat = (id: number) => { setChats((cs) => cs.filter((c) => c.id !== id)); if (cur === id) goNew(); };
  const togglePin = (id: number) => setChats((cs) => cs.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (userRef.current && !userRef.current.contains(t)) setUserMenu(false);
      if (!t.closest(".chat-wrap")) { setChatMenu(null); setCodeMenu(null); setPickProj(false); }
      if (!t.closest(".title-wrap")) setTitleMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        const ov = [...document.querySelectorAll(".overlay")].filter((o) => !o.closest(".closing"));
        if (ov.length > 1) { ov[ov.length - 1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return; }
        setGc(null); setModal(null); setDelId(null); setDelProj(null); setUserMenu(false); setChatMenu(null); setCodeMenu(null); setTitleMenu(false); }
      else if (mod && k === "k") { e.preventDefault(); setModal("search"); }
      else if (mod && e.shiftKey && k === "o") { e.preventDefault(); goNewRef.current(); }
      else if (mod && k === ".") { e.preventDefault(); setOpen((o) => !o); }
      else if (mod && k === "/") { e.preventDefault(); setModal("keys"); }
      else if (mod && e.shiftKey && k === ",") { e.preventDefault(); setSettingsTab("General"); setModal("settings"); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  const goNewRef = useRef(goNew);
  goNewRef.current = goNew;

  useEffect(() => {
    let n = 0;
    const over = (e: DragEvent) => { if (document.querySelector("[data-av]")) return; if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); n++; setDrag(true); } };
    const leave = () => { n = Math.max(0, n - 1); if (!n) setDrag(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); n = 0; setDrag(false);
      if (document.querySelector("[data-av]")) return;
      const fl = Array.from(e.dataTransfer?.files ?? []); fl.forEach((x) => saveBlob(x.name, x)); const f = fl.map((x) => x.name);
      if (f.length) { setFiles((o) => [...o, ...f]); setModal((m) => (m === "upload" ? null : m)); say(`Đã thêm ${f.length} tệp`); }
    };
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragenter", over); window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop); window.addEventListener("dragover", prevent);
    return () => { window.removeEventListener("dragenter", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("dragover", prevent); };
  }, [say]);

  const Nav = ({ v, icon, label, tag, plus }: { v: View; icon: React.ReactNode; label: string; tag?: string; plus?: () => void }) => (
    <button className={`nav-item ${view === v || (v === "projects" && view === "project") ? "active" : ""}`} onClick={() => { setView(v); if (v === "projects") setCurProj(null); }}>{icon}{label}{tag && <span className="tag">{tag}</span>}{plus && <span className="nav-plus" role="button" aria-label="Dự án mới" onClick={(e) => { e.stopPropagation(); plus(); }}><I.Plus size={16} /></span>}</button>
  );
  const [voiceOn, setVoiceOn] = useState(false);
  const composerProps = { onSend: send, busy, onStop: stop, say, prefill, files, setFiles, model, setModel, goCustom, openUpload: () => setModal("upload"), onVoice: () => { window.speechSynthesis?.cancel(); setVoiceOn(true); } };
  const lastAi = chat?.msgs.filter((m) => m.role === "ai").at(-1);
  // Lượt hỏi đáp từ Eleven Realtime được lưu vào đoạn chat như tin nhắn thường.
  const voiceTurn = (u: string, a: string) => {
    const now = Date.now();
    const msgs: Msg[] = [{ role: "user", text: u || "(Câu hỏi bằng giọng nói)", time: now }, { role: "ai", text: a, time: now, done: true }];
    if (view === "chat" && cur !== null) patch(cur, (m) => [...m, ...msgs]);
    else { setChats((cs) => [{ id: now, title: (u || a).slice(0, 40), msgs }, ...cs]); setCur(now); setView("chat"); }
  };
  const visible = chats.filter((c) => !c.inc);
  const [pinOpen, setPinOpen] = usePref("pinOpen", true);
  const [recentOpen, setRecentOpen] = usePref("recentOpen", true);
  const pill = false && (
    <div className="plan-pill">Gói Free · <a onClick={() => setModal("upgrade")}>Nâng cấp</a>{view === "chat" && <button onClick={() => setBanner(false)} style={{ display: "grid", marginLeft: 2 }}><I.X size={14} /></button>}</div>
  );
  const proj = projects.find((x) => x.id === curProj);
  const sideRef = useClickAway(() => setSideProj(null));
  const patchProj = (id: number, f: Partial<Project>) => setProjects((ps) => ps.map((x) => (x.id === id ? { ...x, ...f, upd: Date.now() } : x)));

  useEffect(() => {
    const total = (breakH === "–" ? 0 : parseInt(breakH) * 60) + (breakM === "–" ? 0 : parseInt(breakM));
    if (!total) return;
    const t = setInterval(() => { say(`Bạn đã dùng Synchro một lúc rồi — nghỉ giải lao ${total >= 60 ? total / 60 + " giờ" : total + " phút"} nhé`); }, total * 60000);
    return () => clearInterval(t);
  }, [breakH, breakM, say]);

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile: { name, call, instructions: ins }, projects, chats: chats.filter((c) => !c.inc) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "claude-data-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say("Đã xuất dữ liệu");
  };
  // Xóa phiên trên máy chủ. Dữ liệu của tài khoản vẫn được giữ (đã tách theo tài khoản) cho lần đăng nhập sau.
  const logout = () => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUserScope(null); reloadPrefs();
    setChats([]); setProjects([]); setBanner(true); setModal(null); goNew(); setMe(null);
  };
  const api = {
    say, chats, exportData,
    upgrade: () => setModal("upgrade"),
    openSettings: (t?: string) => { setSettingsTab(t ?? "General"); setModal("settings"); },
    goCode: () => { setModal(null); setCodeCur(null); setView("code"); },
    close: () => setModal(null),
    ask: (t: string) => { setModal(null); setTimeout(() => { goNewRef.current(); setPrefill((p) => ({ t: tr(t), n: p.n + 1 })); }, 180); },
    confirm: (title: string, text: string, ok: string, fn: () => void) => setGc({ title, text, ok, fn }),
    unshare: (id: number) => { setChats((cs) => cs.map((c) => (c.id === id ? { ...c, shared: false } : c))); say("Đã dừng chia sẻ"); },
    wipe: (what: "all" | "chats") => { if (what === "all") ls.clear(); else ["chats", "projects", "model", "banner"].forEach((k) => ls.remove(k)); setChats([]); setProjects([]); setBanner(true); goNew(); },
    me: me ?? null, setMe, logout,
  };

  if (me === undefined) return <div style={{ position: "fixed", inset: 0, background: "var(--bg)" }} />;
  // Màn hình đăng nhập phủ lên app: khi xong, app hiện ngay bên dưới và màn hình này tan dần (authLeaving).
  const needProfile = !!me?.needsProfile;
  const authEl = !me || needProfile || authLeaving ? (
    <AuthComponent key="auth" brandName="Synchro" logo={null} providers={providers} mode={needProfile ? "profile" : "auth"} user={me} leaving={authLeaving}
      onDone={(u) => { enterAccount(u); syncProfile(u); setMe(u); if (!u.needsProfile) setAuthLeaving(true); }} onLeft={() => setAuthLeaving(false)} onSignOut={logout} />
  ) : null;
  if (!me || needProfile) return <>{null}{authEl}</>;

  return (<>
    <AppCtx.Provider value={api}>
    <div className={`app ${view === "code" && codeEmpty ? "code-view" : ""}`}>
      {view === "code" && codeEmpty && <div className="code-bg"><HalftoneBg /></div>}
      <aside className={`sidebar ${open ? "" : "closed"}`} onClickCapture={(e) => {
        // Bấm vào một mục khác (không thuộc nhóm Speech) thì thu gọn danh sách công cụ Speech.
        const t = e.target as HTMLElement;
        if (spOpen && t.closest(".nav-item,.chat-item,.user,.icon-btn") && !t.closest(".nav-row,.nav-sub")) setSpOpen(false);
      }}>
        <div className="side-top">
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Đóng thanh bên"><I.Panel /></button>
          <span className="logo">Synchro</span>
        </div>
        <div className="nav">
          <button className={`nav-item ${view === "new" ? "active" : ""}`} onClick={goNew}>
            {view === "new" ? <I.Plus /> : <span className="plus"><I.Plus size={14} /></span>}Mới<span className="sc-hint">⇧⌘O</span>
          </button>
          {me?.perms.features.projects !== false && <Nav v="projects" icon={<I.Layers />} label="Dự án" plus={() => setModal("proj")} />}
          {caps.art !== false && <Nav v="artifacts" icon={<I.Shapes />} label="Artifacts" />}
          {me?.perms.features.code !== false && <Nav v="code" icon={<I.Code />} label="Code" />}
          {me?.perms.features.speech !== false && (
            <>
              <div className="nav-row">
                <button className={`nav-item ${view === "speech" && (spTool === "home" || !spOpen) ? "active" : ""}`} onClick={() => { setView("speech"); setSpTool("home"); }}><I.Speech />Speech</button>
                <button className={`nav-chev ${spOpen ? "open" : ""}`} aria-expanded={spOpen} aria-label={spOpen ? "Thu gọn công cụ Speech" : "Mở công cụ Speech"} onClick={() => setSpOpen(!spOpen)}><I.ChevronR size={14} /></button>
              </div>
              <div className={`fold ${spOpen ? "open" : ""}`}>
                <div className="nav-sub" aria-label="Công cụ Speech">
                  {SP_TOOLS.filter((t) => t.k !== "home").map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} className={`nav-item ${view === "speech" && spTool === t.k ? "active" : ""}`} tabIndex={spOpen ? 0 : -1} onClick={() => { setView("speech"); setSpTool(t.k); }}><Ic size={16} />{t.label}</button>; })}
                </div>
              </div>
            </>
          )}
          {me?.perms.features.skills !== false && <Nav v="customize" icon={<I.Scroll />} label="Skills" />}
        </div>
        {(() => {
          const row = (c: Chat) => (
            <div key={c.id} className="chat-wrap">
              {renaming === c.id ? (
                <input className="field" autoFocus defaultValue={c.title} style={{ margin: 0, height: 32 }}
                  onBlur={(e) => { setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, title: e.target.value || x.title } : x))); setRenaming(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              ) : (
                <button className={`chat-item ${view === "chat" && cur === c.id ? "active" : ""}`} onClick={() => { if (busy) stop(); setCur(c.id); setView("chat"); }}>{c.title}</button>
              )}
              <button className="dots" onClick={() => { setChatMenu(chatMenu === c.id ? null : c.id); setPickProj(false); }}>⋮</button>
                <Menu open={!!(chatMenu === c.id)} className="down" style={{ top: 34, right: 0, width: 220 }}>
                  {!pickProj ? (
                    <>
                      <button className="menu-item" onClick={() => { togglePin(c.id); setChatMenu(null); }}>{c.pinned ? <I.PinOff /> : <I.Pin />}{c.pinned ? "Bỏ ghim" : "Ghim"}<span className="sc">P</span></button>
                      <button className="menu-item" onClick={() => { setRenaming(c.id); setChatMenu(null); }}><I.Pencil />Đổi tên<span className="sc">R</span></button>
                      <button className="menu-item" onClick={() => (projects.length ? setPickProj(true) : (say("Hãy tạo dự án trước ở mục Dự án"), setChatMenu(null)))}><I.Layers />Thêm vào dự án<span className="sc"><I.ChevronR size={16} /></span></button>
                      {c.project !== undefined && <button className="menu-item" onClick={() => { setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, project: undefined } : x))); setChatMenu(null); say("Đã gỡ khỏi dự án"); }}><I.Layers />Gỡ khỏi dự án</button>}
                      <button className="menu-item" onClick={() => { say("Nhóm đoạn chat sẽ sớm ra mắt"); setChatMenu(null); }}><I.Folder />Chuyển vào nhóm<span className="sc"><I.ChevronR size={16} /></span></button>
                      <hr />
                      <button className="menu-item del" onClick={() => { setDelId(c.id); setChatMenu(null); }}><I.Trash />Xóa<span className="sc">D</span></button>
                    </>
                  ) : (
                    projects.map((pr) => (
                      <button key={pr.id} className="menu-item" onClick={() => { setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, project: pr.id } : x))); say(`Đã thêm vào "${pr.name}"`); setChatMenu(null); setPickProj(false); }}><I.Layers />{pr.name}{c.project === pr.id && <span className="ck"><I.Check /></span>}</button>
                    ))
                  )}
                </Menu>
            </div>
          );
          const codeRow = (c: { id: number; title: string; pinned?: boolean }) => (
            <div key={"code" + c.id} className="chat-wrap">
              {codeRen === c.id ? (
                <input className="field" autoFocus defaultValue={c.title} style={{ margin: 0, height: 32 }}
                  onBlur={(e) => { setCodeList((l) => l.map((x) => (x.id === c.id ? { ...x, title: e.target.value || x.title } : x))); setCodeRen(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              ) : (
                <button className={`chat-item ${view === "code" && codeCur === c.id ? "active" : ""}`} onClick={() => { setCodeCur(c.id); setView("code"); }}>{c.title}</button>
              )}
              <button className="dots" onClick={() => setCodeMenu(codeMenu === c.id ? null : c.id)}>⋮</button>
              <Menu open={codeMenu === c.id} className="down" style={{ top: 34, right: 0, width: 220 }}>
                <button className="menu-item" onClick={() => { setCodeList((l) => l.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x))); setCodeMenu(null); }}>{c.pinned ? <I.PinOff /> : <I.Pin />}{c.pinned ? "Bỏ ghim" : "Ghim"}</button>
                <button className="menu-item" onClick={() => { setCodeRen(c.id); setCodeMenu(null); }}><I.Pencil />Đổi tên</button>
                <hr />
                <button className="menu-item del" onClick={() => { setCodeMenu(null); setCodeList((l) => l.filter((x) => x.id !== c.id)); ls.remove("codeS:" + c.id); if (codeCur === c.id) setCodeCur(null); say("Đã xóa phiên code"); }}><I.Trash />Xóa</button>
              </Menu>
            </div>
          );
          const pinProjs = projects.filter((x) => x.pinned && !x.archived);
          const pjIds = new Set(pinProjs.map((x) => x.id));
          const nested = (c: Chat) => c.project !== undefined && pjIds.has(c.project);
          const projRow = (x: Project) => {
            const kids = visible.filter((c) => c.project === x.id);
            const open = !pjClosed[x.id];
            return (
              <div key={x.id}>
                <div className="chat-wrap" ref={sideProj === x.id ? sideRef : undefined}>
                  <button className={`chat-item pj-row ${view === "project" && curProj === x.id ? "active" : ""}`} onClick={() => { setCurProj(x.id); setView("project"); }}>
                    <span className="pj-ic"><I.Layers size={15} /></span>
                    <span className="pj-tg" role="button" aria-label={open ? "Thu gọn" : "Mở rộng"} onClick={(e) => { e.stopPropagation(); setPjClosed({ ...pjClosed, [x.id]: open }); }}><span className={`sec-chev ${open ? "open" : ""}`}><I.Chevron size={14} /></span></span>
                    <span>{x.name}</span>
                  </button>
                  <button className="dots" onClick={() => setSideProj(sideProj === x.id ? null : x.id)}>⋮</button>
                  <ProjMenu p={x} open={sideProj === x.id} pin style={{ top: 34, right: 0, width: 240 }}
                    onPin={() => { patchProj(x.id, { pinned: false }); setSideProj(null); }}
                    onEdit={() => { setSideProj(null); setEditProj(x.id); }}
                    onArchive={() => { patchProj(x.id, { archived: true }); setSideProj(null); if (view === "project" && curProj === x.id) setView("projects"); say("Đã lưu trữ dự án"); }}
                    onDelete={() => { setSideProj(null); setDelProj(x.id); }} />
                </div>
                <div className={`fold ${open && kids.length ? "open" : ""}`}><div className="pj-kids">{kids.map(row)}</div></div>
              </div>
            );
          };
          const pinned = visible.filter((c) => c.pinned && !nested(c));
          const rest = visible.filter((c) => !c.pinned && !nested(c));
          const codePinned = codeList.filter((c) => c.pinned);
          const codeRest = codeList.filter((c) => !c.pinned);
          return (
            <div className="chat-scroll">
              {(pinned.length > 0 || pinProjs.length > 0 || codePinned.length > 0) && (
                <>
                  <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setPinOpen(!pinOpen)}><span>Đã ghim</span><span className={`sec-chev ${pinOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button></div>
                  <div className={`fold ${pinOpen ? "open" : ""}`}><div className="chat-list">{pinProjs.map(projRow)}{codePinned.map(codeRow)}{pinned.map(row)}</div></div>
                </>
              )}
              {codeRest.length > 0 && (
                <>
                  <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setCodeOpen(!codeOpen)}><span>Code</span><span className={`sec-chev ${codeOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button></div>
                  <div className={`fold ${codeOpen ? "open" : ""}`}><div className="chat-list">{codeRest.map(codeRow)}</div></div>
                </>
              )}
              <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setRecentOpen(!recentOpen)}><span>Đoạn chat và tác vụ</span><span className={`sec-chev ${recentOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button><button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setModal("search")}><I.Sliders size={16} /></button></div>
              <div className={`fold ${recentOpen ? "open" : ""}`}>
                <div className="chat-list">
                  {visible.length === 0 && <div className="muted" style={{ padding: "6px 10px", fontSize: 13 }}>Chưa có đoạn chat nào</div>}
                  {rest.map(row)}
                </div>
              </div>
            </div>
          );
        })()}
        <div className="side-bottom">
          <div ref={userRef} style={{ flex: 1, position: "relative" }}>
            <button className="user" style={{ width: "100%" }} onClick={() => setUserMenu(!userMenu)}>
              <Avatar name={name} /><span title={name}>{shortName(name)}</span><span style={{ marginLeft: "auto" }} className="muted"><I.Chevron size={14} /></span>
            </button>
              <Menu open={!!(userMenu)} style={{ bottom: 44, left: 0, width: 300 }} className="usermenu">
                <div className="muted" style={{ fontSize: 13, padding: "6px 10px" }}>{me.email}</div>
                <button className="menu-item" onClick={() => { setSettingsTab("General"); setModal("settings"); setUserMenu(false); }}><I.Cog />Cài đặt<span className="sc">⇧⌘,</span></button>
                <button className="menu-item" onClick={() => { setModal("lang"); setUserMenu(false); }}><I.Globe />Ngôn ngữ</button>
                <hr />
                <button className="menu-item" onClick={() => { window.open("/download", "_blank", "noopener"); setUserMenu(false); }}><I.GetApps />Tải ứng dụng</button>
                <button className="menu-item" onClick={() => { setModal("keys"); setUserMenu(false); }}><I.Keyboard />Phím tắt<span className="sc">⌘/</span></button>
                <hr />
                <button className="menu-item" onClick={() => { setModal("logout"); setUserMenu(false); }}><I.Out />Đăng xuất</button>
              </Menu>
          </div>
          {me?.perms.features.skills !== false && <button className="icon-btn" onClick={() => setView("customize")} aria-label="Skills" data-tip="Skills"><I.Scroll size={16} /></button>}
          <button className="icon-btn" onClick={() => setModal("search")} aria-label="Tìm kiếm"><I.Search size={16} /></button>
        </div>
      </aside>

      <main className="main">
        {view !== "code" && view !== "speech" && <div className="topbar">
          <div className="left">
            {!open && <button className="icon-btn side-toggle" onClick={() => setOpen(true)} aria-label="Mở thanh bên"><I.Panel /></button>}
            {view === "chat" && chat && (
              <div className="title-wrap" style={{ position: "relative" }}>
                <button className="sel" style={{ fontSize: 14 }} onClick={() => setTitleMenu(!titleMenu)}>{chat.title}<I.Chevron size={14} /></button>
                  <Menu open={!!(titleMenu)} className="down" style={{ top: 36, left: 0, width: 200 }}>
                    <button className="menu-item" onClick={() => { togglePin(chat.id); setTitleMenu(false); }}>{chat.pinned ? <I.PinOff /> : <I.Pin />}{chat.pinned ? "Bỏ ghim" : "Ghim"}</button>
                    <button className="menu-item" onClick={() => { setRenaming(chat.id); setOpen(true); setTitleMenu(false); }}><I.Pencil />Đổi tên</button>
                    <hr />
                    <button className="menu-item del" onClick={() => { setDelId(chat.id); setTitleMenu(false); }}><I.Trash />Xóa</button>
                  </Menu>
              </div>
            )}
          </div>
          {(view === "new" || view === "chat") && pill}
          <div className="right">
            {view === "new" && <button className={`icon-btn ${incog ? "ghost-on" : ""}`} onClick={() => { setIncog(!incog); say(incog ? "Đã tắt chế độ ẩn danh" : "Chế độ ẩn danh: đoạn chat sẽ không được lưu"); }} aria-label="Ẩn danh"><I.Ghost /></button>}
            {view === "chat" && <button className="btn" onClick={() => setModal("share")}>Chia sẻ</button>}
          </div>
        </div>}

        {view === "new" && (
          <div className="hero" key={String(incog)}>
            <div className="greeting">{incog && <I.Ghost size={26} />}{incog ? "Đoạn chat ẩn danh" : greet}</div>
            <Composer {...composerProps} placeholder={tplMode ? TPLS.find((x) => x.k === tplMode)?.ph : undefined} />
            {tplMode && !incog && (() => { const t = TPLS.find((x) => x.k === tplMode)!; return (
              <div className="modebar" key={tplMode}>
                <div ref={tplRef} style={{ position: "relative" }}>
                  <button className={`mode-tag mt-${t.k}`} onClick={() => setTplMenu(!tplMenu)}>{t.label}</button>
                  <Menu open={tplMenu} className="tpl-menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0 }}>
                    <button className="menu-item" onClick={() => { setTplMode(null); setTplMenu(false); }}><I.X size={14} />Xóa {t.k === "doc" ? "tài liệu" : t.k === "slides" ? "bản trình bày" : "thiết kế"}</button>
                  </Menu>
                </div>
                {t.k !== "doc" && <button className="mode-sys" onClick={() => say("Hệ thống thiết kế: chưa có hệ thống nào được thiết lập")}><I.Palette size={16} />Hệ thống thiết kế</button>}
              </div>); })()}
            {incog ? <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>Đoạn chat ẩn danh sẽ không được lưu vào lịch sử</p> : null}
          </div>
        )}

        {view === "chat" && chat && (
          <>
            <div className="thread" ref={threadRef} onScroll={onScroll}>
              <div className="thread-in">
                {chat.msgs.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="user-wrap">
                      {m.files && <div className="attach" style={{ justifyContent: "flex-end" }}>{m.files.map((f, k) => <FileCard key={k} name={f} onContextMenu={(e) => fm.open(e, f)} />)}</div>}
                      <div className="user-msg">{m.text}</div>
                    </div>
                  ) : (
                    <div key={i}>
                      <div className="ai-msg">{m.tools?.length ? <div className="skill-used">{m.tools.map((n) => <span key={n} className="skill-chip tool-chip"><I.SetPlug size={13} /><span>{tr("Đã dùng")}</span><span data-notr>{n}</span></span>)}</div> : null}{m.skills?.length ? <div className="skill-used">{m.skills.map((n) => <span key={n} className="skill-chip"><I.Scroll size={13} />{tr("Đang dùng skill")}: {n}</span>)}</div> : null}{m.text ? <Markdown text={m.text} say={say} /> : !m.done ? <Thinking label="Đang suy nghĩ…" /> : null}</div>
                      {m.done && (
                        <div className="actions in">
                          <button className="icon-btn" onClick={() => copy(`${chat.id}-${i}`, m.text)} aria-label="Sao chép">{copied === `${chat.id}-${i}` ? <I.Check size={16} /> : <I.Copy size={16} />}</button>
                          <button className={`icon-btn ${speaking === `${chat.id}-${i}` ? "like-on" : ""}`} onClick={() => speak(`${chat.id}-${i}`, m.text)} aria-label="Đọc to"><I.Speaker size={16} /></button>
                          <button className={`icon-btn ${m.like === 1 ? "like-on" : ""}`} onClick={() => like(i, 1)} aria-label="Hữu ích"><I.ThumbUp size={16} /></button>
                          <button className={`icon-btn ${m.like === -1 ? "like-on" : ""}`} onClick={() => like(i, -1)} aria-label="Không hữu ích"><I.ThumbDown size={16} /></button>
                          {i === chat.msgs.length - 1 && <button className="icon-btn" onClick={retry} aria-label="Thử lại"><I.Retry size={16} /></button>}
                          <span className="when">{ago(m.time)}</span>
                        </div>
                      )}
                    </div>
                  )
                )}
                {approval && approval.chat === chat.id && <ApprovalCard calls={approval.calls} onDone={(d) => { approval.resolve(d); setApproval(null); }} />}
                <div ref={endRef} />
              </div>
            </div>
            {showDown && <button className="scroll-down" onClick={toBottom} aria-label="Cuộn xuống cuối"><I.Chevron size={16} /></button>}
            <div className="dock">
              <Composer {...composerProps} dock />
              <div className="disclaimer dock-note"><span>Synchro là AI và có thể mắc lỗi. Vui lòng kiểm tra kỹ các câu trả lời.</span><ModelPicker model={model} setModel={setModel} /></div>
            </div>
          </>
        )}

        {view === "projects" && (
          <ProjectsPage projects={projects} chats={chats} say={say} onNew={() => setModal("proj")} onOpen={(id) => { setCurProj(id); setView("project"); }} patch={patchProj} onEdit={(id) => setEditProj(id)} onDelete={(id) => setDelProj(id)} />
        )}

        {view === "project" && proj && (
          <ProjectPage proj={proj} chats={chats} say={say} patch={patchProj} onBack={() => setView("projects")} onOpenChat={(id) => { setCur(id); setView("chat"); }} onEdit={() => setEditProj(proj.id)} onDelete={() => setDelProj(proj.id)}
            composer={<Composer {...composerProps} placeholder="Hôm nay tôi có thể giúp gì cho bạn?" focusPlaceholder="Nhập / để dùng Skills" />} />
        )}

        {view === "artifacts" && (
          <div className="page"><div className="page-in">
            <h1 style={{ marginBottom: 24 }}>Artifacts</h1>
            <div className="tabs" style={{ alignItems: "center" }}>
              {["Tất cả", "Của bạn", "Được chia sẻ với bạn"].map((t, i) => <button key={t} className={`tab ${tab === i ? "on" : ""}`} onClick={() => setTab(i)}>{t}</button>)}
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}><I.Search /><I.List /><I.Sliders /></span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Tạo thứ gì đó mới</div>
            <div className="tpls">
              {TPLS.map((t, i) => (
                <button key={t.k} className={`tpl tpl-${t.k} ${i === 2 ? "last" : ""}`} onClick={() => { setTplMode(t.k); setView("new"); }}>
                  <div className="th"><TplArt k={t.k} /><span className="cur"><svg width="16" height="18" viewBox="0 0 16 18"><path d="M1.5 1l12 7.2-5.4 1.3-2.6 5.2z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" /></svg><em>Synchro</em></span></div>
                  <span className="tl">{t.name}<span className="new-tag">Mới</span></span>
                  <span className="tpl-pop"><b>{t.name}</b><i>Của Synchro</i><span>{t.desc}</span></span>
                </button>
              ))}
            </div>
            <div className="empty"><I.Shapes size={64} /><b>Các artifact của bạn nằm ở đây</b><span>Bắt đầu từ một mẫu ở trên, hoặc yêu cầu Synchro tạo thứ gì đó trong bất kỳ đoạn chat nào.</span></div>
          </div></div>
        )}

        {view === "customize" && (
          <div className="page"><div className="page-in" style={{ maxWidth: 820 }}>
            <Directory />
          </div></div>
        )}
        {view === "code" && <CodeView say={say} onEmpty={setCodeEmpty} sid={codeCur} title={codeList.find((c) => c.id === codeCur)?.title ?? "Synchro Code"} model={model} modelPicker={<ModelPicker model={model} setModel={setModel} />} sideOpen={open} onSide={() => setOpen(true)} onNew={() => setCodeCur(null)} onCreate={(id, title) => { setCodeList((l) => [{ id, title }, ...l]); setCodeCur(id); }} />}
        {view === "speech" && <SpeechView say={say} tool={spTool} setTool={setSpTool} sideOpen={open} onSide={() => setOpen(true)} />}
      </main>

      {drag && <div className="drop"><div className="drop-in"><div className="drop-ic"><I.Image size={30} /><I.Copy size={30} /><I.Folder size={30} /></div><span>Thả tệp vào đây</span></div></div>}
      <Toast text={toast} />
      {voiceOn && <VoiceMode onClose={() => setVoiceOn(false)} onAsk={(t) => send(t)} onTurn={voiceTurn} busy={busy} reply={lastAi ? { text: lastAi.text, time: lastAi.time ?? 0 } : null} rate={VOICE_RATE[vspeed] ?? 1} say={say} />}
      <Fade show={!!(modal === "settings")}><Settings key={settingsTab} initial={settingsTab} onClose={() => setModal(null)} theme={theme} setTheme={setTheme} /></Fade>
      <Fade show={!!(modal === "lang")}><LangModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "search")}><SearchModal chats={visible} onClose={() => setModal(null)} onPick={(id) => { setCur(id); setView("chat"); setModal(null); }} onNew={() => { goNew(); setModal(null); }} /></Fade>
      <Fade show={!!(modal === "share" && chat)}><ShareModal title={chat?.title ?? ""} onClose={() => setModal(null)} say={say} onCopy={() => chat && setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, shared: true } : c)))} /></Fade>
      {fm.node}
      <Fade show={!!(modal === "upload")}><UploadModal say={say} onConverted={(f, md) => { saveDoc(f.name, md); setFiles((o) => [...o, f.name]); setModal(null); say(`Đã chuyển thành ${f.name}`); }} onClose={() => setModal(null)} onFiles={(f) => { f.forEach((x) => saveBlob(x.name, x)); setFiles((o) => [...o, ...f.map((x) => x.name)]); setModal(null); say(`Đã thêm ${f.length} tệp`); }} /></Fade>
      <Fade show={!!(modal === "upgrade")}><UpgradeModal onClose={() => setModal(null)} say={say} /></Fade>
      <Fade show={!!(modal === "keys")}><ShortcutsModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "logout")}><Confirm title="Đăng xuất?" text="Bạn có chắc chắn muốn đăng xuất không? Dữ liệu của bạn vẫn được giữ cho lần đăng nhập sau." ok="Đăng xuất" onCancel={() => setModal(null)} onOk={() => { setModal(null); logout(); }} /></Fade>
      <Fade show={!!(delId !== null)}><Confirm title="Xóa đoạn chat?" text="Bạn có chắc chắn muốn xóa đoạn chat này không?" ok="Xóa" onCancel={() => setDelId(null)} onOk={() => { if (delId !== null) removeChat(delId); setDelId(null); say("Đã xóa đoạn chat"); }} /></Fade>
      <Fade show={!!(delProj !== null)}><Confirm title="Xóa dự án?" text="Dự án sẽ bị xóa. Các đoạn chat bên trong vẫn được giữ lại." ok="Xóa" onCancel={() => setDelProj(null)} onOk={() => { setProjects((ps) => ps.filter((x) => x.id !== delProj)); setChats((cs) => cs.map((c) => (c.project === delProj ? { ...c, project: undefined } : c))); setDelProj(null); say("Đã xóa dự án"); }} /></Fade>
      <Fade show={!!(modal === "proj")}><ProjectModal onClose={() => setModal(null)} onCreate={(n, d) => { const id = Date.now(); setProjects([{ id, name: n, desc: d, upd: id, pinned: true }, ...projects]); setModal(null); setCurProj(id); setView("project"); say("Đã tạo dự án"); }} /></Fade>
      <Fade show={editProj !== null}><ProjectModal title="Chỉnh sửa dự án" ok="Lưu" init={projects.find((x) => x.id === editProj)} onClose={() => setEditProj(null)} onCreate={(n, d) => { if (editProj !== null) patchProj(editProj, { name: n, desc: d }); setEditProj(null); say("Đã cập nhật dự án"); }} /></Fade>
      <Fade show={!!gc}><Confirm title={gc?.title ?? ""} text={gc?.text ?? ""} ok={gc?.ok ?? ""} onCancel={() => setGc(null)} onOk={() => { gc?.fn(); setGc(null); }} /></Fade>
    </div>
    </AppCtx.Provider>
    {authEl}
  </>);
}
