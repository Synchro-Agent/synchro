"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { Avatar } from "./avatar";
import { getLang, tr } from "./i18n";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc, saveBlob, fileContext } from "./filemenu";
import { Fade, Menu, Thinking } from "./ui";
import { HalftoneBg } from "./halftone";
import { CodeView } from "./codeview";
import { VoiceMode } from "./voicemode";
import { SpeechView, TOOL_ICON } from "./speech/view";
import { TOOLS as SP_TOOLS, toolOn, type SpeechTool } from "./speech/data";
import { usePlan as useSpeechPlan } from "./speech/client";
import { elSpeed, speakAI, type Speaking } from "./speak";
import { applyEvent, PlanCard, QueueChips, WorkParts, WorkStatus, type Queued, type RunEv } from "./worklog";
import { startScribe, type Scribe } from "./scribe";
import { AuthComponent, type AuthUser, type Providers } from "./auth";
import { Markdown } from "./md";
import { CommandPalette, type PaletteCmd, type PaletteGo } from "./palette";
import { SaveSkillChip } from "./saveskill";
import { ASK_EVENT } from "./askcard";
import { steerRun, takeSteer } from "./llm";
import { attachRun, callLLM, cancelRun, LLMError, takeCancelled, takeTrace, takeRoute, setActiveEffort, setActiveModel, setApprover, takeLibsUsed, takeOutputs, takeSkillsUsed, type ApprovalCall, type LibUse, type Decision, buildSystemPrompt, extractMemory, getRelevantContext, hasLLM, HISTORY_LIMIT, MEMORY_EVERY_N_USER_MSGS, type LLMMsg } from "./llm";
import { ProjectsPage, ProjectPage, ProjMenu } from "./projects";
import { Confirm, LangModal, ProjectModal, Settings, ShareModal, ShortcutsModal, UploadModal, UpgradeModal } from "./modals";

type View = "new" | "chat" | "projects" | "project" | "artifacts" | "customize" | "code" | "speech" | "inbox";
import { AppCtx, useApp, VOICE_LANG, VOICE_RATE, initials, readPref, reloadPrefs, resetPrefs, usePref, type Chat, type Msg, type Project } from "./store";
import { allowsModel, clampEffort, effortCap, effortsFor, isEffort, legacyModel, type Effort } from "./catalog";
import { AUTO, fitModel, modelName, refreshModels, useModels } from "./models";
import type { ProviderInfo } from "./catalog";
import { AppsGallery, PublishButton, PUBLISHABLE } from "./appsui";
import { InboxPage, useInboxCount } from "./tasksui";
import { adoptLegacyData, ls, setUserScope, userScope } from "./userscope";
import { shortName } from "./names";
import { ApprovalCard } from "./connectorsui";
import { loadCaps, useCaps } from "./capsclient";
import { artifactsAsCode, hasArtifacts, splitArtifacts, type ArtBlock } from "./artifacts";
import { resolveArt, type ArtVersion } from "./vfs";
import { criticKey, fixPatch, important, type CriticEntry, type Finding } from "./critic";
import { chatHistory, mixExtra } from "./history";
import { ContextMixer } from "./mixer";
import { ArtifactCard, ArtifactPanel, ArtifactsGallery, OutputFiles, saveArtifacts } from "./artifactui";
import { FilePanel, ProductSwitcher, type Product } from "./filepreview";
import type { OutFile } from "./llm";
import { UsageRing } from "./usageui";
import { CustomizePage, useStudios, type CzTab } from "./pluginsui";
import { ConnectorsPanel } from "./connectorsui";
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
// Mỗi mẫu là một "studio": gắn với plugin cùng tên (Design / Slides / Docs Studio) để model có cả thư viện skill chuyên môn.
const STUDIO_OF: Record<TplKey, "docs" | "slides" | "design"> = { doc: "docs", slides: "slides", design: "design" };
const NARROW = "(max-width: 760px)";
const TPLS: { k: TplKey; name: string; label: string; ph: string; desc: string; sys: string }[] = [
  { k: "doc", name: "Tài liệu", label: "Synchro Docs", ph: "Tài liệu này nên nói về chủ đề gì?", desc: "Tài liệu mà nhóm của bạn đọc, bình luận và chỉnh sửa trực tiếp, trong khi Synchro giữ cho tài liệu luôn cập nhật.",
    sys: "Tôi tạo một tài liệu soạn thảo bằng công cụ Docs, gồm tiêu đề và nội dung các phần. Tài liệu này có thể xuất ra Word, PDF hoặc Markdown." },
  { k: "slides", name: "Trang trình bày", label: "Synchro Slides", ph: "Bộ trang chiếu này nên nói về chủ đề gì?", desc: "Bộ trang chiếu mà bạn có thể trình chiếu, đổi kiểu dáng bằng hệ thống thiết kế và tải về dạng PowerPoint hoặc PDF.",
    sys: "Tôi tạo một bộ slide trong trình chỉnh sửa riêng. Mỗi slide là một tệp dữ liệu nhỏ, bạn có thể tự sửa tiêu đề hay chữ mà không cần nhờ tôi, và có thể tải về dạng PowerPoint hoặc PDF." },
  { k: "design", name: "Thiết kế", label: "Synchro Design", ph: "Bản thiết kế này nên thể hiện điều gì?", desc: "Màn hình, luồng và đồ họa được bố trí thành các bảng vẽ trên cùng một khung vẽ mà bạn có thể tự chỉnh sửa.",
    sys: "Tôi tạo một thiết kế trực quan như màn hình ứng dụng, poster, landing page hay mockup. Nó hiện trên canvas để bạn xem, chỉnh và chia sẻ." },
];

// Thư viện mẫu khi đang ở chế độ studio: bấm để điền sẵn một yêu cầu đầy đủ vào ô nhập, sửa lại rồi gửi.
const STARTERS: Record<TplKey, { t: string; d: string; p: string }[]> = {
  design: [
    { t: "Landing page", d: "Trang giới thiệu một sản phẩm hay cửa hàng", p: "Thiết kế landing page cho quán cà phê specialty tên Lumen: phần mở đầu có ảnh lớn, thực đơn nổi bật, giờ mở cửa và nút đặt bàn." },
    { t: "Logo", d: "Logo SVG, có bản cho nền tối", p: "Thiết kế logo SVG cho thương hiệu Synchro: tối giản, dùng tốt làm icon ứng dụng, kèm phiên bản cho nền tối." },
    { t: "Màn hình ứng dụng", d: "Giao diện điện thoại bấm thử được", p: "Thiết kế màn hình chính của ứng dụng quản lý chi tiêu trên điện thoại: số dư, biểu đồ chi tiêu trong tuần và danh sách giao dịch gần đây." },
    { t: "Poster sự kiện", d: "Ấn phẩm cho hội thảo, khai trương", p: "Thiết kế poster cho hội thảo công nghệ ngày 15/12 tại Hà Nội, phong cách hiện đại, làm nổi bật tên ba diễn giả chính." },
  ],
  slides: [
    { t: "Pitch deck gọi vốn", d: "10 slide cho vòng seed", p: "Làm pitch deck 10 slide gọi vốn vòng seed cho startup giao đồ ăn healthy: vấn đề, giải pháp, thị trường, mô hình kinh doanh, đội ngũ và số vốn cần gọi." },
    { t: "Báo cáo quý", d: "Số liệu, điểm nổi bật, kế hoạch", p: "Làm bản trình bày báo cáo kết quả kinh doanh quý III: doanh thu, tăng trưởng, điểm nổi bật, khó khăn và kế hoạch quý IV." },
    { t: "Giới thiệu nhân viên mới", d: "Văn hóa, phòng ban, tuần đầu", p: "Làm slide giới thiệu công ty cho nhân viên mới: văn hóa, cơ cấu phòng ban, cách làm việc và những điều cần biết trong tuần đầu." },
    { t: "Kế hoạch dự án", d: "Mục tiêu, mốc thời gian, phân công", p: "Làm slide trình bày kế hoạch triển khai dự án trong 3 tháng: mục tiêu, các mốc chính, phân công và rủi ro." },
  ],
  doc: [
    { t: "Đề xuất dự án", d: "Bối cảnh, mục tiêu, chi phí, lộ trình", p: "Viết đề xuất dự án triển khai hệ thống chăm sóc khách hàng mới: bối cảnh, mục tiêu, phạm vi, chi phí và lộ trình." },
    { t: "Báo cáo tuần", d: "Kết quả, chỉ số, việc tuần tới", p: "Viết báo cáo công việc tuần cho nhóm marketing: kết quả chính, chỉ số, việc đang làm, vướng mắc và kế hoạch tuần tới." },
    { t: "Quy trình nội bộ", d: "Các bước, người duyệt, thời hạn", p: "Viết quy trình xin nghỉ phép cho công ty 50 người: các bước, người duyệt, thời hạn và mẫu đơn." },
    { t: "Thông báo toàn công ty", d: "Rõ ràng, giọng văn thân thiện", p: "Viết thông báo toàn công ty về việc chuyển văn phòng sang địa điểm mới từ tháng sau, giọng văn thân thiện và rõ ràng." },
  ],
};

// Thư viện skill một câu trả lời đã dùng: chế độ studio người dùng chọn, hoặc thư viện model tự mở, kèm skill đã đọc.
function LibChips({ libs, onOpen }: { libs: LibUse[]; onOpen: () => void }) {
  return <div className="skill-used">{libs.map((l) => (
    <button key={l.key} className="skill-chip lib-chip" onClick={onOpen} title={l.skills.join(", ")}>
      <I.Plugins size={13} /><span>{tr(l.forced ? "Chế độ" : "Thư viện")} <b data-notr={l.key.startsWith("lib-") || undefined}>{l.key.startsWith("lib-") ? l.label : tr(l.label)}</b></span>
      {l.skills.length > 0 && <span className="lib-sk" data-notr>{l.skills.slice(0, 3).join(", ")}{l.skills.length > 3 ? ` +${l.skills.length - 3}` : ""}</span>}
    </button>))}</div>;
}

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
  const [effort, setEffort] = usePref("effort", "auto");
  const { say, me, openSettings } = useApp();
  const { providers, allowed, loaded, effort: caps } = useModels();
  // Mức nỗ lực thật sự dùng: mức người dùng chọn, hạ theo giới hạn quản trị viên đặt cho model và các mức model hỗ trợ.
  const kind = providers.find((p) => p.models.some((m) => m.key === model))?.kind;
  const cap = effortCap(caps, model);
  // "Tự động": máy chủ chọn mức theo độ khó của từng việc (vẫn trong giới hạn quản trị viên đặt).
  const autoEff = effort === "auto";
  const eff = clampEffort(isEffort(effort) ? effort : "medium", cap, kind);
  const capped = cap !== "max";
  const levelName = (k: string) => EFFORTS.find((e) => e[0] === k)?.[1] ?? k;
  useEffect(() => { setActiveEffort(autoEff ? "auto" : eff); }, [eff, autoEff]);
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
  // Menu mở ra bị tràn khỏi màn hình (nút nằm giữa ô soạn tin trên điện thoại): dịch ngang cho vừa.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!mm) { setShift(0); return; }
    // Menu canh mép phải theo nút; đo sau khi menu đã gắn (bỏ qua hiệu ứng phóng to lúc mở).
    const raf = requestAnimationFrame(() => {
      const m = mref.current?.querySelector(".model-menu") as HTMLElement | null, w = mref.current?.getBoundingClientRect();
      if (!m || !w) return;
      const left = w.right - m.offsetWidth, vw = window.innerWidth;
      setShift(left < 12 ? 12 - left : w.right > vw - 12 ? vw - 12 - w.right : 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [mm]);
  const subX = { left: subLeft };
  const ok = (k: string) => k === AUTO || allowsModel(allowed, k);
  const pick = (k: string) => {
    if (!ok(k)) { close(); say("Quản trị viên chưa cho phép tài khoản của bạn dùng model này"); return; }
    setModel(k); close();
  };
  const eLabel = autoEff ? "Tự động" : levelName(eff);
  const none = loaded && !providers.length;
  return (
    <div ref={mref} style={{ position: "relative" }}>
      <button className="model-btn" onClick={() => { setMm(!mm); setSub(null); }}>{none ? "Chưa có model" : model ? modelName(model) : "Chọn model"} <span className="muted">{eLabel}</span><I.Chevron size={14} /></button>
      <Menu open={mm} className="model-menu" style={{ position: "absolute", ...(shift ? { translate: `${shift}px 0` } : {}) }}>
        {none && (
          <div className="mempty">
            <b>Chưa kết nối model nào</b>
            <span>{me?.isAdmin ? "Đăng nhập gói Claude, ChatGPT hoặc Gemini của bạn, hoặc nhập khóa API dùng chung." : "Đăng nhập gói Claude, ChatGPT hoặc Gemini của bạn để bắt đầu."}</span>
            <button className="btn dark" onClick={() => { close(); openSettings?.("Providers"); }}>Mở Cài đặt → Providers</button>
          </div>
        )}
        {!none && (
          <button className="menu-item mline mauto" onClick={() => pick(AUTO)} onMouseEnter={() => setSub(null)}>
            <span className="mauto-t"><b>Tự động</b><em>Chọn qua cả Claude, ChatGPT, Gemini: việc dễ dùng model nhanh, việc khó dùng model mạnh nhất hợp với việc đó</em></span>{model === AUTO && <span className="ck"><I.Check /></span>}
          </button>
        )}
        {!none && <hr />}
        {providers.map((pv) => (
          <button key={pv.id} className={`menu-item mline mprov ${sub === pv.id ? "sel" : ""}`} onClick={(e) => (sub === pv.id ? setSub(null) : hoverProv(pv.id, e.currentTarget))} onMouseEnter={(e) => hoverProv(pv.id, e.currentTarget)}>
            {pv.name}<span className="sc">{pv.models.some((m) => m.key === model) && <i className="dot" />}<I.ChevronR size={16} /></span>
          </button>
        ))}
        {!none && <hr />}
        <button className={`menu-item mline ${sub === "effort" ? "sel" : ""}`} onClick={() => setSub(sub === "effort" ? null : "effort")} onMouseEnter={() => setSub("effort")}>Mức độ nỗ lực<span className="sc">{eLabel}<I.ChevronR size={16} /></span></button>
        <Menu open={sub === "effort"} className="model-sub" style={{ ...subX, bottom: 0, width: 320 }}>
          <div className="msub-note">Mức nỗ lực cao hơn đồng nghĩa với phản hồi kỹ lưỡng hơn, nhưng mất nhiều thời gian hơn và dùng hết giới hạn của bạn nhanh hơn.</div>
          <button className="menu-item mline mauto" onClick={() => { setEffort("auto"); close(); }}>
            <span className="mauto-t"><b>Tự động</b><em>Việc dễ trả lời nhanh, việc khó suy nghĩ kỹ</em></span>{autoEff ? <span className="ck"><I.Check /></span> : <span className="mtag">Được đề xuất</span>}
          </button>
          {EFFORTS.filter(([k]) => effortsFor(kind).includes(k as Effort)).map(([k, l]) => {
            const locked = clampEffort(k as Effort, cap, kind) !== k;
            return (
              <button key={k} className={`menu-item mline ${locked ? "locked" : ""}`} aria-disabled={locked} title={locked ? "Quản trị viên đã khóa mức này" : undefined}
                onClick={() => { if (locked) { say(`Quản trị viên giới hạn ${modelName(model)} tối đa ở mức ${levelName(cap)}`); return; } setEffort(k); if (k === "max") say("Mức Tối đa dùng giới hạn nhanh hơn từ 5 lần"); close(); }}>
                {l}
                {!autoEff && eff === k ? <span className="ck"><I.Check /></span> : locked && <span className="sc"><I.Lock size={14} /></span>}
              </button>
            );
          })}
          {capped && <div className="msub-note msub-cap"><I.Lock size={12} />{`Quản trị viên giới hạn model này tối đa ở mức ${levelName(cap)}.`}</div>}
        </Menu>
        {providers.map((pv) => (
          <Menu key={pv.id} open={sub === pv.id} className="model-sub msub-models" style={{ ...subX, ...subPos, width: 260 }}>
            {pv.plan && <PlanNote pv={pv} />}
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

// Ghi chú gói subscription trong menu con của hãng: gói hết hạn mức (đề nghị dùng khóa API, chỉ chuyển khi người dùng bấm),
// đang dùng khóa API thay gói (quay lại gói), hay cần đăng nhập lại.
function PlanNote({ pv }: { pv: ProviderInfo }) {
  const p = pv.plan!;
  const en = getLang() === "en";
  const at = (t: number) => new Date(t).toLocaleString(en ? "en-US" : "vi-VN", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const set = (on: boolean) => fetch(`/api/engines/${p.cli}/use-api`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }).then(() => refreshModels()).catch(() => {});
  if (pv.source === "api" && p.usingApiUntil) return (
    <div className="msub-note msub-plan">
      <span>{en ? `Using the shared API key instead of your plan until ${at(p.usingApiUntil)}.` : `Đang dùng khóa API dùng chung thay gói tới ${at(p.usingApiUntil)}.`}</span>
      <button className="lnk" onClick={() => set(false)}>{en ? "Back to my plan" : "Quay lại gói"}</button>
    </div>
  );
  if (p.relogin) return <div className="msub-note msub-plan"><span>{en ? "Your plan needs you to sign in again in Settings → Providers." : "Gói cần đăng nhập lại ở Cài đặt → Providers."}</span></div>;
  if (p.blockedUntil) return (
    <div className="msub-note msub-plan">
      <span>{en ? `Your plan hit its limit. It resets ${at(p.blockedUntil)}.` : `Gói đã hết hạn mức, hồi lại ${at(p.blockedUntil)}.`}</span>
      <button className="lnk" onClick={() => set(true)}>{en ? "Use the shared API key" : "Dùng khóa API dùng chung"}</button>
    </div>
  );
  return <div className="msub-note msub-plan"><span>{en ? "From your plan" : "Từ gói của bạn"}</span></div>;
}

type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };

function Composer(p: {
  onSend: (t: string, f: string[]) => void; busy: boolean; onStop: () => void; dock?: boolean; say: Say;
  prefill: { t: string; n: number }; files: string[]; setFiles: (f: string[]) => void;
  model: string; setModel: (m: string) => void; goCustom: () => void; placeholder?: string; focusPlaceholder?: string; openUpload: () => void;
  onVoice?: () => void; extra?: React.ReactNode;
  projects?: { id: number; name: string }[]; project?: number; onProject?: (id: number | undefined) => void;
  /** Đang chạy mà gửi thêm: later = false ghép vào việc đang làm, true = gửi sau khi xong. */
  onSteer?: (text: string, later: boolean) => void;
}) {
  const { onSend, busy, onStop, dock, say, files, setFiles, model, setModel, openUpload } = p;
  const fm = useFileMenu(say);
  const [v, setV] = useState("");
  const [foc, setFoc] = useState(false);
  const [menu, setMenu] = useState(false);
  // Tìm web và bộ nhớ: lưu theo người dùng, gửi kèm mỗi lượt chat.
  const [web, setWeb] = usePref("webSearch", true);
  const perms = useApp().me?.perms;
  const [mem, setMem] = usePref("chatMemory", true);
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
  const submit = (later = false) => {
    // Đang chạy: không ngắt — Enter ghép tin vào việc đang làm, ⌘/Ctrl + Enter xếp hàng gửi sau khi xong.
    if (busy && p.onSteer && v.trim()) { p.onSteer(v.trim(), later); setV(""); return; }
    if (!canSend || busy) return;
    onSend(v.trim() || "Xem tệp đính kèm", files);
    setV("");
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  };
  const [vlang] = usePref("vlang", "Vietnamese");
  usePref("uilang", "vi");
  // Nhập bằng giọng nói: ElevenLabs Scribe Realtime (chữ hiện ngay khi nói); chưa có ElevenLabs thì dùng nhận dạng của trình duyệt.
  const scribeRef = useRef<Scribe | null>(null);
  const mic = async () => {
    if (rec) { scribeRef.current?.stop(); scribeRef.current = null; recRef.current?.stop(); setRec(false); return; }
    const lang = VOICE_LANG[vlang] ?? "vi-VN";
    const base = v.trim() ? v.trimEnd() + " " : "";
    let said = "";
    setRec(true);
    try {
      // Không đặt ngôn ngữ: ElevenLabs tự nhận, nói tiếng nào chép tiếng đó (kể cả đổi tiếng giữa chừng).
      const s = await startScribe({}, {
        onPartial: (t) => setV(base + said + t),
        onCommit: (t) => { said += t + " "; setV(base + said); },
        onError: (m) => say(m),
        onClose: () => { scribeRef.current = null; setRec(false); },
      });
      if (s) { scribeRef.current = s; return; }
    } catch { setRec(false); return say("Không mở được micro: hãy cho phép Synchro dùng micro"); }
    const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
    if (!SR) { setRec(false); return say("Trình duyệt này không hỗ trợ nhập bằng giọng nói"); }
    const r = new SR();
    r.lang = lang; r.interimResults = true;
    r.onresult = (e) => setV(base + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setRec(false);
    recRef.current = r; r.start();
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = Array.from(e.target.files ?? []); fl.forEach((x) => saveBlob(x.name, x)); const n = fl.map((f) => f.name);
    if (n.length) setFiles([...files, ...n]);
    e.target.value = "";
  };
  const [projOpen, setProjOpen] = useState(false);
  // Chụp màn hình thật: trình duyệt hỏi chọn màn hình / cửa sổ / tab, chụp một khung hình rồi đính kèm như ảnh tải lên.
  const shot = async () => {
    setMenu(false);
    if (!navigator.mediaDevices?.getDisplayMedia) return say("Trình duyệt này không hỗ trợ chụp màn hình");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const vid = document.createElement("video");
      vid.srcObject = stream; vid.muted = true; await vid.play();
      await new Promise((r) => setTimeout(r, 300));
      const c = document.createElement("canvas");
      c.width = vid.videoWidth; c.height = vid.videoHeight;
      c.getContext("2d")!.drawImage(vid, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
      if (!blob) return say("Không chụp được màn hình");
      const d = new Date(), name = `Ảnh chụp màn hình ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}.${String(d.getSeconds()).padStart(2, "0")}.png`;
      saveBlob(name, new File([blob], name, { type: "image/png" }));
      setFiles([...files, name]);
      say("Đã đính kèm ảnh chụp màn hình");
    } catch (e) { if ((e as Error).name !== "NotAllowedError") say("Không chụp được màn hình"); }
  };

  const plus = (
    <div ref={ref} style={{ position: "relative" }}>
      <input ref={fileIn} type="file" multiple hidden onChange={pick} />
      <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Thêm"><I.Plus /></button>
        <Menu open={!!(menu)} className="" style={{ bottom: 40, left: 0, width: 264 }}>
          {perms?.features.files !== false && <button className="menu-item" onClick={() => { setMenu(false); openUpload(); }}><I.Clip />Tải lên hoặc thêm tệp<span className="sc">⌘U</span></button>}
          {perms?.features.files !== false && <button className="menu-item" onClick={shot}><I.Camera />Chụp ảnh màn hình</button>}
          {p.onProject && perms?.features.projects !== false && (p.projects?.length ? (
            <>
              <button className="menu-item" aria-expanded={projOpen} onClick={() => setProjOpen(!projOpen)}><I.Layers />Thêm vào dự án<span className="sc">{projOpen ? <I.Chevron size={16} /> : <I.ChevronR size={16} />}</span></button>
              {projOpen && p.projects.map((pr) => <button key={pr.id} className="menu-item sub" onClick={() => { setMenu(false); setProjOpen(false); p.onProject!(p.project === pr.id ? undefined : pr.id); }}><span data-notr>{pr.name}</span>{p.project === pr.id && <span className="ck"><I.Check /></span>}</button>)}
            </>
          ) : <button className="menu-item" onClick={() => { setMenu(false); p.onProject!(undefined); }}><I.Layers />Tạo dự án để thêm vào</button>)}
          <hr />
          {perms?.features.skills !== false && <button className="menu-item" onClick={() => { setMenu(false); p.goCustom(); }}><I.Plugins />Skill Hub<span className="sc"><I.ChevronR size={16} /></span></button>}
          <hr />
          {perms?.features.web !== false && <button className="menu-item" onClick={() => { setWeb(!web); say(web ? "Đã tắt tìm kiếm web" : "Đã bật tìm kiếm web"); }}><I.Globe />Tìm kiếm trên web{web && <span className="ck"><I.Check /></span>}</button>}
          <button className="menu-item" onClick={() => { setMem(!mem); say(mem ? "Đã tắt bộ nhớ" : "Đã bật bộ nhớ"); }}><I.History />Bộ nhớ{mem && <span className="ck"><I.Check /></span>}</button>
        </Menu>
    </div>
  );

  const sendBtn = (
    <button className="send" disabled={!busy && !canSend} onClick={busy ? (v.trim() && p.onSteer ? () => submit() : onStop) : () => submit()} aria-label={busy ? (v.trim() && p.onSteer ? "Gửi thêm" : "Dừng") : "Gửi"}>
      {busy ? (v.trim() && p.onSteer ? <I.Arrow /> : <I.Stop />) : dock ? <I.Enter /> : <I.Arrow />}
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
        <textarea ref={ta} rows={1} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} placeholder={busy && p.onSteer ? "Nhắn thêm: ↵ ghép vào việc đang làm, ⌘↵ gửi sau khi xong" : p.placeholder ?? "Viết tin nhắn..."} style={{ flex: 1 }} />
        {p.extra}
        {micBtn}
        {!canSend && !busy && p.onVoice ? <button className="icon-btn vm-open" data-tip="Trò chuyện bằng giọng nói" onClick={p.onVoice} aria-label="Trò chuyện bằng giọng nói"><I.Wave /></button> : sendBtn}
      </div>
    );

  return (
    <div className="composer">
      {chips}
      <textarea ref={ta} rows={1} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} placeholder={busy && p.onSteer ? "Nhắn thêm: ↵ ghép vào việc đang làm, ⌘↵ gửi sau khi xong" : foc && p.focusPlaceholder ? p.focusPlaceholder : p.placeholder ?? "Hôm nay tôi có thể giúp gì cho bạn?"} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)} autoFocus={!p.focusPlaceholder} />
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

// Tin "Chỉ và sửa": hiện gọn phần tử đã chỉ (thẻ, nội dung, dòng mã) và yêu cầu; khối <point_edit> đầy đủ chỉ dành cho model.
const PE_RE = /^([\s\S]*?)<point_edit>([\s\S]*?)<\/point_edit>\s*(?:Yêu cầu:\s*)?([\s\S]*)$/;
function UserText({ text }: { text: string }) {
  const m = PE_RE.exec(text);
  if (!m) return <>{text}</>;
  const get = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(m[2])?.[1]?.trim() ?? "";
  const tag = /^<([a-zA-Z][\w-]*)/.exec(get("mã của phần tử"))?.[1];
  const line = /^(\d+)-(\d+)$/.exec(get("dòng"));
  const title = /“([^”]*)”/.exec(m[1])?.[1];
  return (
    <>
      <span className="pe-msg" title={title}>
        <I.Pointer size={12} />{tag && <code data-notr>{`<${tag}>`}</code>}<span data-notr>{get("nội dung đang hiện") || get("vị trí")}</span>
        {line && <em>{tr("Dòng")} <span data-notr>{line[1] === line[2] ? line[1] : `${line[1]}–${line[2]}`}</span></em>}
      </span>
      {m[3].trim()}
    </>
  );
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
  const { caps } = useCaps();
  const [vlang] = usePref("vlang", "Vietnamese");
  usePref("uilang", "vi");
  const [vspeed] = usePref("vspeed", "Normal");
  const [vvoice] = usePref("vvoice", "");
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
    // Mặc định bằng cột chat của Claude (48rem = 768px); Vừa / Rộng cho màn hình lớn.
    r.style.setProperty("--thread-w", { Narrow: "768px", Medium: "880px", Wide: "1040px" }[width] ?? "768px");
  }, [motion, font, uiFont, size, width]);
  const [view, setView] = useState<View>("new");
  const [open, setOpen] = useState(true);
  // Màn hình hẹp (điện thoại): thanh bên là ngăn kéo trượt đè lên nội dung, mặc định đóng, chọn mục xong tự đóng.
  const narrow = () => typeof window !== "undefined" && window.matchMedia(NARROW).matches;
  useEffect(() => { if (narrow()) setOpen(false); }, []);
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
  // Dự án chọn từ khung soạn trước khi gửi tin đầu tiên của đoạn chat mới.
  const [nextProj, setNextProj] = useState<number | undefined>(undefined);
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
  // Công cụ Speech ở thanh bên hiện theo gói ElevenLabs (chỉ quét khi đã mở Speech).
  const spPlan = useSpeechPlan(view === "speech" || spOpen);
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
  useEffect(() => { if (me) loadCaps(true); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!models.loaded) return; const f = fitModel(model, models); if (f !== model) setModel(f); }, [models, model]);
  useEffect(() => {
    if (me && view === "code" && !me.perms.features.code) setView("new");
    if (me && view === "speech" && !me.perms.features.speech) setView("new");
    if (me && view === "customize" && !me.perms.features.skills) setView("new");
    if (me && (view === "projects" || view === "project") && !me.perms.features.projects) setView("new");
  }, [me, model, view]);
  useEffect(() => {
    if (!loaded) return;
    ls.set("chats", JSON.stringify(chats.filter((c) => !c.inc).map((c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, done: true, prog: undefined })) }))));
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
  // Artifact của cuộc trò chuyện đang mở: mỗi identifier là một artifact, mỗi lần model viết lại là một phiên bản.
  const [artSel, setArtSel] = useState<{ chat: number; ident: string; v: number; follow: boolean } | null>(null);
  const [artFull, setArtFull] = useState(false);
  // Tệp do code tạo đang xem trước (cùng khung bên cạnh với artifact; mở cái này thì đóng cái kia).
  const [fileSel, setFileSel] = useState<{ chat: number; file: OutFile } | null>(null);
  const artDismissed = useRef("");
  const arts = (() => {
    // Bản sửa (mode="patch") được áp vào phiên bản trước để thành phiên bản đầy đủ (vfs.ts).
    const map = new Map<string, (ArtVersion & { msg: number })[]>();
    const at: Record<number, { ident: string; v: number }[]> = {};
    if (!chat || !caps.art) return { map, at };
    chat.msgs.forEach((m, i) => {
      if (m.role !== "ai" || !hasArtifacts(m.text)) return;
      for (const sg of splitArtifacts(m.text)) if (sg.kind === "art") {
        const l = map.get(sg.art.ident) ?? [];
        l.push({ ...resolveArt(l[l.length - 1], sg.art), msg: i });
        map.set(sg.art.ident, l);
        (at[i] ??= []).push({ ident: sg.art.ident, v: l.length - 1 });
      }
    });
    return { map, at };
  })();
  const artVersions = artSel && chat && artSel.chat === chat.id ? arts.map.get(artSel.ident) ?? null : null;
  const artIndex = artVersions ? (artSel!.follow ? artVersions.length - 1 : Math.min(artSel!.v, artVersions.length - 1)) : 0;
  const artOpen = view === "chat" && !!artVersions?.length;
  // Câu trả lời đang viết có artifact: tự mở khung xem và đi theo phiên bản mới nhất (trừ khi người dùng vừa đóng).
  const lastIdx = chat ? chat.msgs.length - 1 : -1;
  const liveArt = chat && lastIdx >= 0 && !chat.msgs[lastIdx].done ? arts.at[lastIdx]?.at(-1) : undefined;
  useEffect(() => {
    if (!chat || !liveArt) return;
    const key = `${chat.id}-${lastIdx}-${liveArt.ident}`;
    if (artDismissed.current === key) return;
    if (artSel?.chat !== chat.id || artSel.ident !== liveArt.ident || !artSel.follow) { setFileSel(null); setArtSel({ chat: chat.id, ident: liveArt.ident, v: liveArt.v, follow: true }); }
  }, [chat?.id, lastIdx, liveArt?.ident, liveArt?.v]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileOpen = view === "chat" && !!chat && fileSel?.chat === chat.id && !artOpen;
  const panelOpen = artOpen || fileOpen;
  useEffect(() => { if (!panelOpen) setArtFull(false); }, [panelOpen]);
  const openArt = (s: { chat: number; ident: string; v: number; follow: boolean }) => { setFileSel(null); setArtSel(s); };
  const openFile = (f: OutFile) => { if (!chat) return; setArtSel(null); setFileSel({ chat: chat.id, file: f }); };
  // Mọi sản phẩm của đoạn chat (artifact bản mới nhất, tệp code đã tạo), để chuyển nhanh trong khung xem trước.
  const products: Product[] = !chat ? [] : [
    ...[...arts.map.entries()].map(([ident, vs]) => { const a = vs[vs.length - 1]; return { key: `a:${ident}`, title: a.title, type: a.type, content: a.content, open: () => openArt({ chat: chat.id, ident, v: vs.length - 1, follow: false }) }; }),
    ...chat.msgs.flatMap((m) => m.outs ?? []).map((f) => ({ key: `f:${f.id}`, title: f.name, file: f, open: () => openFile(f) })),
  ];
  const activeProduct = artOpen && artSel ? `a:${artSel.ident}` : fileOpen && fileSel ? `f:${fileSel.file.id}` : "";
  const closeArt = () => {
    if (chat && liveArt) artDismissed.current = `${chat.id}-${lastIdx}-${liveArt.ident}`;
    setArtSel(null);
  };
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

  // user = false: câu trả lời vừa hiện xong. Mặc định (nút Dừng, đổi đoạn chat…): hủy luôn lượt ở máy chủ để không tốn thêm token,
  // phần đã viết được giữ lại và đánh dấu đã dừng (lượt sau model biết câu trả lời này chưa hoàn chỉnh).
  const runRef = useRef<string | null>(null);
  // Tin nhắn gửi trong lúc đang chạy: "steer" đang chờ ghép vào lượt, "later" gửi thành lượt mới khi xong.
  const [queued, setQueued] = useState<Queued[]>([]);
  const onSteer = async (text: string, later: boolean) => {
    const chatId = cur;
    if (chatId === null) return;
    const qid = Date.now() + Math.random();
    const run = runRef.current;
    if (later || !run) { setQueued((q) => [...q, { id: qid, chat: chatId, text, mode: "later" }]); return; }
    setQueued((q) => [...q, { id: qid, chat: chatId, text, mode: "steer" }]);
    if (!(await steerRun(run, text))) setQueued((q) => q.map((x) => (x.id === qid ? { ...x, mode: "later" } : x)));
  };
  const stop = (user: unknown = true) => {
    approvalRef.current?.resolve({});
    setApproval(null);
    genRef.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setBusy(false);
    if (user !== false && runRef.current) cancelRun(runRef.current);
    runRef.current = null;
    setChats((cs) => cs.map((c) => ({ ...c, msgs: c.msgs.map((m) => (m.done ? m : { ...m, done: true, prog: undefined, ...(user !== false && m.role === "ai" ? { stopped: true, run: undefined } : {}) })) })));
  };
  const genRef = useRef(0);
  const capsRef = useRef(caps);
  capsRef.current = caps;
  const [artRefresh, setArtRefresh] = useState(0);
  const [artQ, setArtQ] = useState("");
  const [czTab, setCzTab] = useState<CzTab>("hub");
  // Plugin gắn với các nút studio (Thiết kế / Trình bày / Tài liệu): tên và số skill để hiện trên nút.
  const studios = useStudios();
  const openPlugins = () => { setCzTab("hub"); setView("customize"); };
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const projsRef = useRef<Project[]>([]);
  projsRef.current = projects;
  const workOf = (x?: Msg) => (x?.role === "ai" ? { parts: x.parts, plan: x.plan, seq: x.seq } : {});
  const streamReply = async (id: number, text: string, hist?: LLMMsg[], pid?: number, studio?: Chat["studio"]) => {
    const gen = ++genRef.current;
    setBusy(true);
    const pr = pid !== undefined ? projsRef.current.find((x) => x.id === pid) : undefined;
    const history = (hist ?? [{ role: "user" as const, content: text }]).slice(-HISTORY_LIMIT);
    const system = pr ? buildSystemPrompt(pr, text) : "Bạn là một trợ lý AI hữu ích.";
    let reply: string;
    let usedSk: string[] = [], usedTl: string[] = [], libs: LibUse[] = [], via: string | null = null;
    let outs: Msg["outs"] = [], trace: Msg["trace"] = [], cancelled = false;
    // Chữ đến theo thời gian thực: cập nhật tin nhắn tối đa mỗi khung hình.
    let streamed = false, pend: string | null = null, raf = 0;
    const flush = () => { raf = 0; if (pend === null || gen !== genRef.current) return; const t = pend; pend = null; patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), { ...ms[ms.length - 1], text: t, prog: undefined }] : ms)); };
    const onDelta = (t: string) => { streamed = true; pend = t; if (!raf) raf = requestAnimationFrame(flush); };
    // Bước của lượt: lời dẫn (chuyển từ chữ đang viết sang nhật ký), công cụ, kết quả, danh sách việc; tin nhắn thêm đã ghép
    // thì đóng phần trả lời trước, hiện tin người dùng, phần tiếp theo của lượt nằm ở câu trả lời mới bên dưới.
    const onEvent = (ev: RunEv) => {
      if (gen !== genRef.current) return;
      if (ev.kind === "steer") {
        patch(id, (ms) => {
          const last = ms[ms.length - 1];
          if (!last || last.role !== "ai" || (last.seq ?? 0) >= ev.seq) return ms;
          return [...ms.slice(0, -1), { ...last, done: true, prog: undefined, run: undefined, seq: ev.seq }, { role: "user", text: ev.text, time: Date.now(), steer: true }, { role: "ai", text: "", time: Date.now(), run: last.run, seq: ev.seq }];
        });
        setQueued((q) => { const k = q.findIndex((x) => x.chat === id && x.mode === "steer" && x.text === ev.text); return k < 0 ? q : q.filter((_, j) => j !== k); });
        return;
      }
      if (ev.kind === "say") pend = null;
      patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), { ...ms[ms.length - 1], ...applyEvent(ms[ms.length - 1], ev), ...(ev.kind === "say" ? { text: "" } : {}) }] : ms));
    };
    try {
      // Skill hai câu trả lời gần nhất đã dùng: lượt tiếp nối (sửa, thêm, đổi) đọc lại để giữ cùng phong cách.
      const recentSkills = [...new Set((chatsRef.current.find((c) => c.id === id)?.msgs ?? []).filter((m) => m.role === "ai" && (m.skills?.length || m.libs?.length)).slice(-2)
        .flatMap((m) => [...(m.libs ?? []).flatMap((l) => l.skills), ...(m.skills ?? [])]))];
      // Lượt chạy bền: máy chủ trả lời ở nền; mã lượt lưu vào tin nhắn để tải lại trang vẫn nhận được kết quả.
      const lastMsg = (f: (m: Msg) => Msg) => patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), f(ms[ms.length - 1])] : ms));
      reply = await callLLM(system, history, 1500, undefined, true, { project: pid, conv: id, studio: studio ?? chatsRef.current.find((c) => c.id === id)?.studio, recentSkills,
        onRun: (run) => { runRef.current = run; lastMsg((m) => ({ ...m, run })); }, onProgress: (prog) => { if (gen === genRef.current) lastMsg((m) => ({ ...m, prog })); }, onDelta, onEvent,
        // Model của câu trả lời trước: người dùng chê ("làm lại", "sai rồi") thì chế độ Tự động đổi sang model khác.
        extra: { ...mixExtra(chatsRef.current.find((c) => c.id === id)), web: readPref("webSearch", true), memory: readPref("chatMemory", true), incognito: !!chatsRef.current.find((c) => c.id === id)?.inc, prevModel: [...(chatsRef.current.find((c) => c.id === id)?.msgs ?? [])].reverse().find((m) => m.role === "ai" && m.done && m.via)?.via } });
      const used = takeSkillsUsed();
      libs = takeLibsUsed();
      // Skill nằm trong thư viện đã hiện ở chip thư viện; mục "studio-…" / "lib-…" chỉ là mục lục, không hiện riêng.
      const inLib = new Set(libs.flatMap((l) => [l.key, ...l.skills]));
      usedSk = [...new Set(used.filter((u) => u.kind === "skill" && !inLib.has(u.name)).map((u) => u.name))];
      usedTl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
      outs = takeOutputs();
      via = takeRoute();
      trace = takeTrace();
      cancelled = takeCancelled();
      // Tin nhắn thêm tới khi model đã ở bước trả lời cuối: gửi thành lượt tiếp theo ngay khi xong (không mất tin).
      const left = takeSteer();
      setQueued((q) => {
        const mine = q.map((x) => (x.chat === id && x.mode === "steer" ? { ...x, mode: "later" as const } : x));
        const extra = left.filter((t) => !mine.some((x) => x.chat === id && x.text === t)).map((t, k) => ({ id: Date.now() + k + Math.random(), chat: id, text: t, mode: "later" as const }));
        return [...mine, ...extra];
      });
    } catch (e) {
      setQueued((q) => q.map((x) => (x.chat === id && x.mode === "steer" ? { ...x, mode: "later" as const } : x)));
      reply = e instanceof LLMError && [400, 401, 403, 404, 409, 410, 429, 503].includes(e.status) && e.message ? e.message : tr("Không thể kết nối tới model. Vui lòng thử lại.");
      // Gói subscription hết hạn mức hoặc phiên đăng nhập hỏng: hỏi người dùng có chuyển sang khóa API của cùng hãng không (không tự chuyển).
      if (e instanceof LLMError && (e.data.planLimit || e.data.relogin) && typeof e.data.apiModel === "string") {
        const retry = () => { patch(id, (m) => [...m.slice(0, -1), { role: "ai", text: "", time: Date.now() }]); streamReply(id, text, hist, pid, studio); };
        setTimeout(() => askPlanSwitch(e.data, retry), 300);
      }
    }
    if (raf) cancelAnimationFrame(raf);
    // Người dùng đã bấm Dừng: máy chủ trả phần đã viết và dấu vết (công cụ bị dừng ghi cancelled_by_user) — lưu lại cho lượt sau.
    if (gen !== genRef.current) {
      if (cancelled) patch(id, (ms) => ms.map((m, k) => (k === ms.length - 1 && m.role === "ai" && m.stopped ? { ...m, text: m.text || reply, trace: trace?.length ? trace : m.trace, outs: outs?.length ? outs : m.outs } : m)));
      return;
    }
    if (streamed || cancelled) {
      // Đã hiện dần theo thời gian thực: hiện bản cuối ngay, không giả lập gõ chữ.
      patch(id, (m) => [...m.slice(0, -1), { ...workOf(m[m.length - 1]), role: "ai", text: reply, done: true, time: Date.now(), skills: usedSk.length ? usedSk : undefined, libs: libs.length ? libs : undefined, tools: usedTl.length ? usedTl : undefined, outs: outs?.length ? outs : undefined, via: via ?? undefined, trace: trace?.length ? trace : undefined, stopped: cancelled || undefined }]);
      finishReply(id, reply, pr, history, via);
      return;
    }
    const usedPj = pr && !hasLLM && (pr.ins?.trim() || pr.mem?.length || getRelevantContext(pr, text).length);
    const note = usedPj ? `\n\n_${getLang() === "en" ? "Project context applied" : "Đã áp dụng ngữ cảnh dự án"}: ${[pr.ins?.trim() && (getLang() === "en" ? "instructions" : "hướng dẫn"), pr.mem?.length && (getLang() === "en" ? "memory" : "bộ nhớ"), getRelevantContext(pr, text).length && (getLang() === "en" ? "documents" : "tài liệu")].filter(Boolean).join(", ")}_` : "";
    const words = (reply + note + (ins.trim() ? `\n\n_${getLang() === "en" ? "Applied your instructions" : "Đã áp dụng hướng dẫn của bạn"}: “${ins.trim().slice(0, 90)}”_` : "")).split(/(\s+)/);
    let i = 0;
    let wait = 42;
    timer.current = setInterval(() => {
      if (wait-- > 0) return;
      i += 2;
      patch(id, (m) => [...m.slice(0, -1), { ...workOf(m[m.length - 1]), role: "ai", text: words.slice(0, i).join(""), done: i >= words.length, time: Date.now(), skills: usedSk.length ? usedSk : undefined, libs: libs.length ? libs : undefined, tools: usedTl.length ? usedTl : undefined, outs: outs?.length && i >= words.length ? outs : undefined, via: via ?? undefined, trace: trace?.length ? trace : undefined }]);
      if (i >= words.length) finishReply(id, reply, pr, history, via);
    }, 38);
  };
  // Hỏi Có / Không trước khi dùng khóa API dùng chung thay cho gói đã hết hạn mức. Đồng ý: nhóm model của hãng đó chuyển sang model API
  // (tới khi gói hồi lại), chọn model tương đương và gửi lại lượt vừa lỗi. Không đồng ý: giữ nguyên gói.
  const askPlanSwitch = (d: Record<string, unknown>, retry: () => void) => {
    const cli = String(d.planLimit ?? d.relogin), api = String(d.apiModel), apiName = typeof d.apiModelName === "string" ? d.apiModelName : modelName(api);
    const name = cli === "claude" ? "Claude" : cli === "codex" ? "ChatGPT" : "Gemini";
    const at = typeof d.resetsAt === "number" ? new Date(d.resetsAt).toLocaleString(getLang() === "en" ? "en-US" : "vi-VN", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const en = getLang() === "en";
    setGc({
      title: d.relogin ? (en ? `Your ${name} plan needs you to sign in again` : `Gói ${name} cần đăng nhập lại`) : en ? `Your ${name} plan hit its limit` : `Gói ${name} đã hết hạn mức`,
      text: en
        ? `Switch to the shared ${name} API key (${apiName})${at ? ` until your plan resets (${at})` : " until your plan is back"}? This message will be sent again with the API key. Choose Cancel to keep your plan.`
        : `Chuyển sang khóa API ${name} dùng chung (${apiName})${at ? ` cho tới khi gói hồi lại (${at})` : " cho tới khi gói dùng lại được"}? Tin nhắn vừa rồi sẽ được gửi lại bằng khóa API. Chọn Hủy để giữ nguyên gói.`,
      ok: en ? "Use the API key" : "Dùng khóa API",
      fn: async () => {
        await fetch(`/api/engines/${cli}/use-api`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true }) }).catch(() => null);
        await refreshModels();
        setActiveModel(api); setModel(api);
        retry();
      },
    });
  };
  // Câu trả lời đã hiện xong: lưu artifact (bản đầy đủ, đã áp các bản sửa), thông báo, rút trí nhớ dự án.
  // Artifact trong câu trả lời vừa xong: lưu bản đầy đủ (đã áp các bản sửa) lên máy chủ, rồi nhờ hội đồng phản biện đọc lại
  // các sản phẩm quan trọng ở nền (code, trang web, ứng dụng React) bằng model của hãng khác.
  const afterArtifacts = (id: number, reply: string, gen = "", question = "") => {
    const c = chatsRef.current.find((x) => x.id === id);
    if (!capsRef.current.art || !hasArtifacts(reply) || !c || c.inc) return;
    const st = new Map<string, ArtVersion>();
    for (const m of c.msgs) if (m.role === "ai" && m.text !== reply) for (const sg of splitArtifacts(m.text)) if (sg.kind === "art") st.set(sg.art.ident, resolveArt(st.get(sg.art.ident), sg.art));
    const full = splitArtifacts(reply).flatMap((sg): ArtBlock[] => { if (sg.kind !== "art") return []; const r = resolveArt(st.get(sg.art.ident), sg.art); st.set(sg.art.ident, r); return r.fix?.failed.length ? [] : [{ ident: r.ident, title: r.title, type: r.type, lang: r.lang, content: r.content, complete: r.complete }]; });
    if (full.length) saveArtifacts(String(id), full).then(() => setArtRefresh((n) => n + 1));
    if (capsRef.current.crit) for (const a of full) if (important(a)) runCritic(id, a, gen, question);
  };
  const runCritic = (id: number, a: ArtBlock, gen = "", question = "") => {
    const key = criticKey(a.ident, a.content);
    // Giữ kết quả của 30 phiên bản gần nhất trong đoạn chat.
    const put = (e: CriticEntry) => setChats((cs) => cs.map((c) => (c.id !== id ? c : { ...c, critic: Object.fromEntries([...Object.entries(c.critic ?? {}).filter(([k]) => k !== key).sort((x, y) => y[1].at - x[1].at).slice(0, 29), [key, e]]) })));
    put({ status: "run", findings: [], by: [], at: Date.now() });
    fetch("/api/critic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: a.title, type: a.type, lang: a.lang, content: a.content, model: gen, question: question.slice(0, 1500) }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        put(r.ok ? { status: "done", findings: Array.isArray(j.findings) ? j.findings : [], by: Array.isArray(j.by) ? j.by : [], at: Date.now() } : { status: "error", findings: [], by: [], at: Date.now(), error: j.error || tr("Hội đồng phản biện chưa trả lời được.") });
      })
      .catch(() => put({ status: "error", findings: [], by: [], at: Date.now(), error: tr("Không kết nối được tới máy chủ.") }));
  };
  // Áp dụng sửa: thêm một cặp tin (yêu cầu + bản sửa SEARCH/REPLACE) vào đoạn chat, thành phiên bản mới của artifact ngay,
  // không cần gọi model; lượt sau model cũng thấy bản sửa này trong lịch sử.
  const applyFix = (id: number, a: { ident: string; title: string; content: string }, f: Finding) => {
    const p = fixPatch(a.content, f);
    if (!p) { say(tr("Không áp được bản sửa này. Hãy nhờ Synchro sửa trong khung chat.")); return; }
    const where = f.line_start === f.line_end ? `${tr("dòng")} ${f.line_start}` : `${tr("dòng")} ${f.line_start}–${f.line_end}`;
    const now = Date.now();
    const ai = `${tr("Đã áp dụng bản sửa của hội đồng phản biện")}: ${f.title}.\n\n<artifact identifier="${a.ident}" mode="patch">\n${p}\n</artifact>`;
    patch(id, (m) => [...m, { role: "user", text: `${tr("Áp dụng sửa")} “${f.title}” (${a.title}, ${where})`, time: now }, { role: "ai", text: ai, done: true, time: now }]);
    setArtSel({ chat: id, ident: a.ident, v: 0, follow: true });
    say(tr("Đã áp dụng bản sửa, tạo phiên bản mới"));
    setTimeout(() => afterArtifacts(id, ai), 0);
  };
  const finishReply = (id: number, reply: string, pr: Project | undefined, history: LLMMsg[], via?: string | null) => {
    stop(false);
    const q = [...history].reverse().find((m) => m.role === "user");
    afterArtifacts(id, reply, via || (model !== AUTO ? model : ""), typeof q?.content === "string" ? q.content : "");
    if (notif[0] && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Synchro", { body: "Câu trả lời đã hoàn tất." });
    if (pr && history.filter((m) => m.role === "user").length % MEMORY_EVERY_N_USER_MSGS === 0) {
      const full: LLMMsg[] = [...history, { role: "assistant", content: reply }];
      extractMemory(projsRef.current.find((x) => x.id === pr.id) ?? pr, full).then((items) => {
        if (!items.length) return;
        setProjects((ps) => ps.map((x) => (x.id === pr.id ? { ...x, mem: [...(x.mem ?? []), ...items.filter((c) => !(x.mem ?? []).some((m) => m.content === c)).map((c, k) => ({ id: Date.now() + k, content: c }))] } : x)));
      });
    }
  };
  // Mở ứng dụng nội bộ khi chưa đăng nhập: /apps/<id> chuyển về đây kèm ?next=, đăng nhập xong thì quay lại đúng ứng dụng.
  useEffect(() => {
    if (!me) return;
    const n = new URLSearchParams(location.search).get("next");
    if (n && /^\/apps\/[\w-]{1,40}$/.test(n)) location.replace(n);
  }, [me]);
  // Mở lại trang khi câu trả lời còn đang chạy ở máy chủ: nối vào lượt đó, hiện bước đang làm, nhận kết quả khi xong.
  const resumed = useRef(false);
  useEffect(() => {
    if (!loaded || !me || resumed.current) return;
    resumed.current = true;
    for (const c of chatsRef.current) {
      const last = c.msgs[c.msgs.length - 1];
      // Còn mã lượt chạy = câu trả lời chưa nhận xong (mọi đường hoàn tất đều xóa mã này; bản lưu trong trình duyệt luôn ghi done).
      if (!last || last.role !== "ai" || !last.run) continue;
      const run = last.run;
      const set = (f: (m: Msg) => Msg) => patch(c.id, (ms) => (ms.length && ms[ms.length - 1].run === run ? [...ms.slice(0, -1), f(ms[ms.length - 1])] : ms));
      set((m) => ({ ...m, done: false }));
      runRef.current = run;
      attachRun(run, (prog) => set((m) => ({ ...m, prog })), (text) => set((m) => ({ ...m, text, prog: undefined })), (ev) => { if (ev.kind !== "steer") set((m) => ({ ...m, ...applyEvent(m, ev), ...(ev.kind === "say" ? { text: "" } : {}) })); }).then((text) => {
        const used = takeSkillsUsed(), libs = takeLibsUsed(), outs = takeOutputs(), trace = takeTrace(), stopped = takeCancelled();
        const inLib = new Set(libs.flatMap((l) => [l.key, ...l.skills]));
        const sk = [...new Set(used.filter((u) => u.kind === "skill" && !inLib.has(u.name)).map((u) => u.name))];
        const tl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
        const via = takeRoute();
        set((m) => ({ ...m, text, done: true, prog: undefined, run: undefined, time: Date.now(), skills: sk.length ? sk : undefined, libs: libs.length ? libs : undefined, tools: tl.length ? tl : undefined, outs: outs.length ? outs : undefined, via: via ?? undefined, trace: trace.length ? trace : undefined, stopped: stopped || undefined }));
        if (runRef.current === run) runRef.current = null;
      }, (e) => set((m) => ({ ...m, done: true, prog: undefined, run: undefined, text: e instanceof LLMError && e.message ? e.message : tr("Không thể kết nối tới model. Vui lòng thử lại.") })));
    }
  }, [loaded, me]); // eslint-disable-line react-hooks/exhaustive-deps
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
      setChats((cs) => [{ id: nid, title: t.slice(0, 40), msgs, inc: incog || undefined, project: nextProj ?? (view === "project" ? curProj ?? undefined : undefined), studio: tp ? STUDIO_OF[tp.k] : undefined }, ...cs]);
      setNextProj(undefined);
      setCur(id);
      setView("chat");
    } else patch(id, (m) => [...m, ...msgs]);
    setFiles([]);
    setTplMode(null);
    setPrefill({ t: "", n: 0 });
    const prior = id !== null && view === "chat" ? (chatsRef.current.find((c) => c.id === id)?.msgs ?? []) : [];
    // Lịch sử theo chuẩn Synchro (history.ts): kèm dấu vết công cụ, đánh dấu câu trả lời bị dừng, bỏ phần đã nén.
    const hist: LLMMsg[] = [...chatHistory(prior, chatsRef.current.find((c) => c.id === id)?.compact), { role: "user", content: t }];
    const pid = view === "project" ? curProj ?? undefined : chatsRef.current.find((c) => c.id === id)?.project;
    fileContext(f, t).then(({ blocks, errors }) => {
      errors.forEach((m) => say(m));
      if (blocks.length) hist[hist.length - 1] = { role: "user", content: [{ type: "text", text: t || "Hãy xem các tệp đính kèm." }, ...blocks] };
      streamReply(id, t, hist, pid, tp ? STUDIO_OF[tp.k] : undefined);
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
  // Đọc to câu trả lời bằng giọng ElevenLabs (giọng chọn ở Cài đặt → Giọng nói); chưa có ElevenLabs thì dùng giọng của trình duyệt.
  const aiSpeak = useRef<Speaking | null>(null);
  const stopSpeak = () => { aiSpeak.current?.stop(); aiSpeak.current = null; window.speechSynthesis?.cancel(); };
  const speak = async (key: string, text: string) => {
    if (speaking === key) { stopSpeak(); setSpeaking(null); return; }
    stopSpeak();
    setSpeaking(key);
    const clean = text.replace(/```[\s\S]*?```/g, " ");
    const ai = await speakAI(clean, { voice: vvoice, speed: elSpeed(VOICE_RATE[vspeed] ?? 1) });
    if (ai) { aiSpeak.current = ai; void ai.done.then(() => { if (aiSpeak.current === ai) aiSpeak.current = null; setSpeaking((k) => (k === key ? null : k)); }); return; }
    const s = window.speechSynthesis;
    if (!s) { setSpeaking(null); return say("Trình duyệt không hỗ trợ đọc to"); }
    const u = new SpeechSynthesisUtterance(clean);
    // Đọc bằng đúng ngôn ngữ của câu trả lời (có dấu tiếng Việt thì giọng Việt), không ép theo cài đặt.
    const vi = /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(text);
    const pref = VOICE_LANG[vlang] ?? "vi-VN";
    u.lang = vi ? "vi-VN" : pref.startsWith("vi") ? "en-US" : pref; u.rate = VOICE_RATE[vspeed] ?? 1; u.onend = () => setSpeaking(null);
    s.speak(u);
  };
  const like = (i: number, v: 1 | -1) => {
    if (!chat) return;
    const m = chat.msgs[i], next = m?.like === v ? undefined : v;
    patch(chat.id, (ms) => ms.map((x, j) => (j === i ? { ...x, like: next } : x)));
    // Điểm cho các skill và thư viện câu trả lời đã dùng; Kho kỹ năng cộng điểm để chỉ ra skill hay bị chê.
    const used = [...(m?.skills ?? []), ...(m?.libs ?? []).flatMap((l) => l.skills)];
    if (m && used.length) fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msg: `${chat.id}:${m.time}`, skills: used, value: next ?? 0 }) }).catch(() => {});
    say("Cảm ơn phản hồi của bạn");
  };

  const goNew = () => {
    if (busy) stop();
    stopSpeak(); setSpeaking(null);
    setChats((cs) => cs.filter((c) => !c.inc));
    setView("new"); setCur(null); setTplMode(null); setFiles([]); setPrefill({ t: "", n: 0 });
  };
  const goCustom = () => { setCzTab("hub"); setView("customize"); };
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
  // Thẻ hỏi lại (```ask): lựa chọn của người dùng thành tin nhắn tiếp theo.
  const sendRef = useRef<(t: string) => void>(() => {});
  sendRef.current = (t) => send(t);
  useEffect(() => { const h = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t) sendRef.current(t); }; window.addEventListener(ASK_EVENT, h); return () => window.removeEventListener(ASK_EVENT, h); }, []);

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

  const Nav = ({ v, icon, label, tag, plus, badge }: { v: View; icon: React.ReactNode; label: string; tag?: string; plus?: () => void; badge?: number }) => (
    <button className={`nav-item ${view === v || (v === "projects" && view === "project") ? "active" : ""}`} onClick={() => { setView(v); if (v === "projects") setCurProj(null); }}>{icon}{label}{tag && <span className="tag">{tag}</span>}{badge ? <span className="nav-badge" aria-label={`${badge} kết quả chưa đọc`}>{badge > 99 ? "99+" : badge}</span> : null}{plus && <span className="nav-plus" role="button" aria-label="Dự án mới" onClick={(e) => { e.stopPropagation(); plus(); }}><I.Plus size={16} /></span>}</button>
  );
  const [voiceOn, setVoiceOn] = useState(false);
  const inboxN = useInboxCount(!!me);
  // Bảng lệnh ⌘K: lệnh nhanh và cách mở từng loại kết quả.
  const paletteCmds: PaletteCmd[] = [
    { id: "new", label: "Đoạn chat mới", icon: <I.Plus size={16} />, keys: "⇧⌘O", hint: "new chat tao moi", run: goNew },
    { id: "inbox", label: "Hộp thư", icon: <I.Inbox size={16} />, hint: "inbox tac vu nen lich hen ket qua", run: () => setView("inbox") },
    { id: "hub", label: "Kho kỹ năng", icon: <I.Plugins size={16} />, hint: "skill hub plugin thu vien", run: goCustom },
    { id: "connectors", label: "Kết nối", icon: <I.Connectors size={16} />, hint: "connectors mcp", run: () => { setCzTab("connectors"); setView("customize"); } },
    ...(caps.art !== false ? [{ id: "artifacts", label: "Artifacts", icon: <I.Shapes size={16} />, hint: "ung dung apps", run: () => setView("artifacts") }] : []),
    { id: "projects", label: "Dự án", icon: <I.Folder size={16} />, hint: "projects", run: () => { setCurProj(null); setView("projects"); } },
    { id: "settings", label: "Cài đặt", icon: <I.Cog size={16} />, keys: "⇧⌘,", hint: "settings", run: () => { setSettingsTab("General"); setModal("settings"); } },
    { id: "theme", label: theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối", icon: theme === "dark" ? <I.Sun size={16} /> : <I.Moon size={16} />, hint: "theme dark light toi sang", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "sidebar", label: "Ẩn / hiện thanh bên", icon: <I.Panel size={16} />, keys: "⌘.", hint: "sidebar", run: () => setOpen((o) => !o) },
    { id: "keys", label: "Phím tắt", icon: <I.Keyboard size={16} />, keys: "⌘/", hint: "shortcuts", run: () => setModal("keys") },
  ];
  const paletteGo: PaletteGo = {
    chat: (id) => { setCur(id); setView("chat"); },
    artifact: (conv, title) => { const c = chats.find((x) => String(x.id) === conv); if (c) { setCur(c.id); setView("chat"); } else { setTab(0); setArtQ(title); setView("artifacts"); } },
    app: (id) => window.open(`/apps/${id}`, "_blank", "noopener"),
    skillHub: goCustom,
  };
  // Mở kết quả tác vụ nền thành đoạn chat để hỏi tiếp.
  const openAsChat = (title: string, text: string) => {
    const id = Date.now();
    setChats((cs) => [{ id, title: title.slice(0, 40), msgs: [{ role: "user", text: `${tr("Tác vụ nền")}: ${title}`, time: id }, { role: "ai", text, done: true, time: id }] }, ...cs]);
    setCur(id); setView("chat");
  };
  // Lượt xong: gửi lần lượt các tin đã xếp hàng của đoạn chat đang mở.
  useEffect(() => {
    if (busy || cur === null || view !== "chat") return;
    const next = queued.find((q) => q.chat === cur && q.mode === "later");
    if (!next) return;
    const t = setTimeout(() => { setQueued((q) => q.filter((x) => x.id !== next.id)); send(next.text); }, 250);
    return () => clearTimeout(t);
  }, [busy, queued, cur, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const composerProps = { onSend: send, busy, onSteer, onStop: stop, say, prefill, files, setFiles, model, setModel, goCustom, openUpload: () => setModal("upload"), onVoice: () => { stopSpeak(); setSpeaking(null); setVoiceOn(true); },
    projects: projects.filter((x) => !x.archived).map((x) => ({ id: x.id, name: x.name })),
    project: view === "chat" && chat ? chat.project : nextProj ?? (view === "project" ? curProj ?? undefined : undefined),
    onProject: (pid: number | undefined) => {
      if (!projects.length) { setModal("proj"); return; }
      const name = projects.find((x) => x.id === pid)?.name;
      if (view === "chat" && chat) { setChats((cs) => cs.map((x) => (x.id === chat.id ? { ...x, project: pid } : x))); say(pid ? `Đã thêm vào "${name}"` : "Đã gỡ khỏi dự án"); }
      else { setNextProj(pid); say(pid ? `Đoạn chat mới sẽ nằm trong "${name}"` : "Đoạn chat mới không thuộc dự án nào"); }
    } };
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
        if (narrow() && t.closest(".nav-item,.chat-item") && !t.closest(".nav-row > .icon-btn, .chat-item .icon-btn, .chat-item input")) setTimeout(() => setOpen(false), 0);
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
          <Nav v="inbox" icon={<I.Inbox />} label="Hộp thư" badge={inboxN} />
          {me?.perms.features.code !== false && <Nav v="code" icon={<I.Code />} label="Code" />}
          {me?.perms.features.speech !== false && (
            <>
              <div className="nav-row">
                <button className={`nav-item ${view === "speech" && (spTool === "home" || !spOpen) ? "active" : ""}`} onClick={() => { setView("speech"); setSpTool("home"); }}><I.Speech />Speech</button>
                <button className={`nav-chev ${spOpen ? "open" : ""}`} aria-expanded={spOpen} aria-label={spOpen ? "Thu gọn công cụ Speech" : "Mở công cụ Speech"} onClick={() => setSpOpen(!spOpen)}><I.ChevronR size={14} /></button>
              </div>
              <div className={`fold ${spOpen ? "open" : ""}`}>
                <div className="nav-sub" aria-label="Công cụ Speech">
                  {SP_TOOLS.filter((t) => t.k !== "home" && toolOn(spPlan, t.k)).map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} className={`nav-item ${view === "speech" && spTool === t.k ? "active" : ""}`} tabIndex={spOpen ? 0 : -1} onClick={() => { setView("speech"); setSpTool(t.k); }}><Ic size={16} />{t.label}</button>; })}
                </div>
              </div>
            </>
          )}
          {me?.perms.features.skills !== false && <Nav v="customize" icon={<I.Plugins />} label="Skill Hub" />}
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
          {me?.perms.features.skills !== false && <button className="icon-btn" onClick={goCustom} aria-label="Skill Hub" data-tip="Skill Hub"><I.Plugins size={16} /></button>}
          <button className="icon-btn" onClick={() => setModal("search")} aria-label="Tìm kiếm"><I.Search size={16} /></button>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <main className={`main ${panelOpen ? `has-art ${artFull ? "art-full" : ""}` : ""}`}>
        {view !== "code" && view !== "speech" && <div className="topbar">
          <div className="left">
            {!open && <button className="icon-btn side-toggle" onClick={() => setOpen(true)} aria-label="Mở thanh bên"><I.Panel /></button>}
            {view === "chat" && chat && (
              <div className="title-wrap" style={{ position: "relative" }}>
                <button className="sel" style={{ fontSize: 14 }} onClick={() => setTitleMenu(!titleMenu)}><span className="sel-t">{chat.title}</span><I.Chevron size={14} /></button>
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
            {view === "chat" && products.length > 0 && !panelOpen && <button className="btn prod-btn" onClick={() => products[products.length - 1].open()} title={tr("Xem trước sản phẩm của đoạn chat")}><I.Eye size={15} />{tr("Sản phẩm")}<span className="prod-n">{products.length}</span></button>}
            {view === "chat" && <button className="btn" onClick={() => setModal("share")}>Chia sẻ</button>}
          </div>
        </div>}

        {view === "new" && (
          <div className="hero" key={String(incog)}>
            <div className="greeting">{incog && <I.Ghost size={26} />}{incog ? "Đoạn chat ẩn danh" : greet}</div>
            <Composer {...composerProps} placeholder={tplMode ? TPLS.find((x) => x.k === tplMode)?.ph : undefined} />
            {tplMode && !incog && (() => { const t = TPLS.find((x) => x.k === tplMode)!; return (
              <div className="modewrap" key={tplMode}>
                <div className="modebar">
                  <span className={`mode-tag mt-${t.k}`}>{t.label}<button className="mode-x" onClick={() => setTplMode(null)} aria-label="Bỏ chế độ" data-tip="Bỏ chế độ, để Synchro tự chọn"><I.X size={12} /></button></span>
                  {/* Thư viện skill của studio: bấm để xem / cài plugin. */}
                  {studios[STUDIO_OF[t.k]] ? <button className="mode-sys" onClick={openPlugins} title={studios[STUDIO_OF[t.k]]!.name}><I.Plugins size={16} />Thư viện {studios[STUDIO_OF[t.k]]!.skills} skill</button>
                    : <button className="mode-sys" onClick={openPlugins}><I.Plugins size={16} />Cài thư viện {t.k === "doc" ? "tài liệu" : t.k === "slides" ? "trình bày" : "thiết kế"}</button>}
                </div>
                <div className="starters">
                  {STARTERS[t.k].map((x) => (
                    <button key={x.t} className={`starter mt-${t.k}`} onClick={() => setPrefill((p) => ({ t: tr(x.p), n: p.n + 1 }))}><b>{x.t}</b><span>{x.d}</span></button>
                  ))}
                </div>
              </div>); })()}
            {incog ? <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>Đoạn chat ẩn danh sẽ không được lưu vào lịch sử</p> : null}
          </div>
        )}

        {view === "chat" && chat && (
          <>
            <div className="thread" ref={threadRef} onScroll={onScroll}>
              <div className="thread-in">
                {chat.msgs.map((m, i) => <Fragment key={i}>{chat.compact?.upto === i && <div className="cx-mark" role="note"><I.Sparkle size={13} /><span>{tr("Các tin phía trên đã được nén thành bản tóm tắt; model nhận bản tóm tắt thay cho chúng.")}</span></div>}{
                  m.role === "user" ? (
                    <div key={i} className="user-wrap">
                      {m.files && <div className="attach" style={{ justifyContent: "flex-end" }}>{m.files.map((f, k) => <FileCard key={k} name={f} onContextMenu={(e) => fm.open(e, f)} />)}</div>}
                      {m.steer && <span className="steer-tag">{tr("Nhắn thêm khi Synchro đang làm")}</span>}
                      <div className="user-msg"><UserText text={m.text} /></div>
                    </div>
                  ) : (
                    <div key={i}>
                      <div className="ai-msg">{m.tools?.length ? <div className="skill-used">{m.tools.map((n) => <span key={n} className="skill-chip tool-chip"><I.SetPlug size={13} /><span>{tr("Đã dùng")}</span><span data-notr>{n}</span></span>)}</div> : null}{m.libs?.length ? <LibChips libs={m.libs} onOpen={openPlugins} /> : null}{m.skills?.length ? <div className="skill-used">{m.skills.map((n) => <span key={n} className="skill-chip"><I.Scroll size={13} />{tr("Đang dùng skill")}: {n}</span>)}</div> : null}{m.parts?.length ? <WorkParts parts={m.parts} live={!m.done} render={(t) => <Markdown text={t} say={say} />} /> : null}{m.text ? (caps.art && hasArtifacts(m.text) ? splitArtifacts(m.text).map((sg, k) => sg.kind === "text" ? <Markdown key={k} text={sg.text} say={say} viz={caps.inl} live={m.done && i === chat.msgs.length - 1 && !busy} /> : (() => {
                        const pos = arts.at[i]?.find((x) => x.ident === sg.art.ident && arts.map.get(x.ident)?.[x.v]?.msg === i);
                        const total = arts.map.get(sg.art.ident)?.length ?? 1;
                        const v = pos?.v ?? 0;
                        const active = artOpen && artSel?.ident === sg.art.ident && artIndex === v;
                        const full = arts.map.get(sg.art.ident)?.[v];
                        return <ArtifactCard key={k} art={full ?? sg.art} version={v + 1} total={total} active={active} fix={full?.fix} onRedo={i === chat.msgs.length - 1 && !busy ? () => send(`${tr("Bản sửa")} “${full?.title ?? sg.art.ident}” ${tr("không áp được. Hãy viết lại toàn bộ artifact này (không dùng mode=\"patch\"), giữ các thay đổi tôi vừa yêu cầu.")}`) : undefined} onOpen={() => openArt({ chat: chat.id, ident: sg.art.ident, v, follow: false })} />;
                      })()) : <Markdown text={hasArtifacts(m.text) ? artifactsAsCode(m.text) : m.text} say={say} viz={caps.inl} live={m.done && i === chat.msgs.length - 1 && !busy} />) : null}{m.plan?.length ? <PlanCard plan={m.plan} live={!m.done} /> : null}{!m.done ? <WorkStatus label={m.prog} since={m.time} chars={m.text.length + (m.parts ?? []).reduce((n, p) => n + (p.k === "say" ? p.text.length : 0), 0)} /> : null}{m.outs?.length ? <OutputFiles files={m.outs} onOpen={openFile} active={fileOpen ? fileSel?.file.id : undefined} /> : null}</div>
                      {m.done && (
                        <div className="actions in">
                          <button className="icon-btn" onClick={() => copy(`${chat.id}-${i}`, m.text)} aria-label="Sao chép">{copied === `${chat.id}-${i}` ? <I.Check size={16} /> : <I.Copy size={16} />}</button>
                          <button className={`icon-btn ${speaking === `${chat.id}-${i}` ? "like-on" : ""}`} onClick={() => speak(`${chat.id}-${i}`, m.text)} aria-label="Đọc to"><I.Speaker size={16} /></button>
                          <button className={`icon-btn ${m.like === 1 ? "like-on" : ""}`} onClick={() => like(i, 1)} aria-label="Hữu ích"><I.ThumbUp size={16} /></button>
                          <button className={`icon-btn ${m.like === -1 ? "like-on" : ""}`} onClick={() => like(i, -1)} aria-label="Không hữu ích"><I.ThumbDown size={16} /></button>
                          {i === chat.msgs.length - 1 && <button className="icon-btn" onClick={retry} aria-label="Thử lại"><I.Retry size={16} /></button>}
                          {m.via && <span className="via" title="Chế độ Tự động đã chọn model này">{modelName(m.via)}</span>}
                          <span className="when">{ago(m.time)}</span>
                        </div>
                      )}
                      {m.done && i === chat.msgs.length - 1 && !busy && <SaveSkillChip chat={chat} all={chats} say={say} />}
                    </div>
                  )
                }</Fragment>)}
                {approval && approval.chat === chat.id && <ApprovalCard calls={approval.calls} onDone={(d) => { approval.resolve(d); setApproval(null); }} />}
                <div ref={endRef} />
              </div>
            </div>
            {showDown && <button className="scroll-down" onClick={toBottom} aria-label="Cuộn xuống cuối"><I.Chevron size={16} /></button>}
            {artOpen && artVersions && (
              <ArtifactPanel versions={artVersions} index={artIndex} setIndex={(v) => setArtSel({ chat: chat.id, ident: artSel!.ident, v, follow: false })} ai={caps.ai} onClose={closeArt}
                expanded={artFull} setExpanded={setArtFull} say={say} switcher={<ProductSwitcher items={products} active={activeProduct} />}
                conv={chat.inc ? undefined : String(chat.id)} extra={(a) => (!chat.inc && PUBLISHABLE.has(a.type) ? <PublishButton conv={String(chat.id)} art={a} say={say} /> : null)}
                onAsk={busy ? undefined : (text) => send(text)}
                criticOf={(a) => chat.critic?.[criticKey(a.ident, a.content)]} onCritic={chat.inc ? undefined : (a) => runCritic(chat.id, a)}
                onApplyFix={busy || chat.inc ? undefined : (a, f) => applyFix(chat.id, a, f)}
                onFix={busy ? undefined : (a, err) => send(`${tr("Artifact")} “${a.title}” ${tr("gặp lỗi")}: ${err}\n${tr("Hãy sửa lỗi này.")}`)} />
            )}
            {fileOpen && fileSel && (
              <FilePanel file={fileSel.file} onClose={() => setFileSel(null)} expanded={artFull} setExpanded={setArtFull} say={say} switcher={<ProductSwitcher items={products} active={activeProduct} />} />
            )}
            <div className="dock">
              {chat.studio && (() => { const k = (Object.keys(STUDIO_OF) as TplKey[]).find((x) => STUDIO_OF[x] === chat.studio)!; return (
                <div className="dock-mode"><span className={`mode-tag sm mt-${k}`}>{TPLS.find((x) => x.k === k)!.label}<button className="mode-x" aria-label="Bỏ chế độ" data-tip="Bỏ chế độ, để Synchro tự chọn"
                  onClick={() => { setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, studio: undefined } : c))); say("Đã bỏ chế độ. Synchro sẽ tự chọn thư viện skill phù hợp."); }}><I.X size={12} /></button></span></div>); })()}
              <QueueChips items={queued.filter((q) => q.chat === chat.id)} onCancel={(qid) => setQueued((q) => q.filter((x) => x.id !== qid))} />
              <Composer {...composerProps} dock extra={<ContextMixer chat={chat} studio={chat.studio} busy={busy} say={say} recentSkills={[...new Set(chat.msgs.filter((m) => m.role === "ai").slice(-2).flatMap((m) => [...(m.libs ?? []).flatMap((l) => l.skills), ...(m.skills ?? [])]))]}
                onChange={(p) => setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, ...p } : c)))} />} />
              <div className="disclaimer dock-note"><span>Synchro là AI và có thể mắc lỗi. Vui lòng kiểm tra kỹ các câu trả lời.</span><ModelPicker model={model} setModel={setModel} /><UsageRing model={model} onDetails={() => { setSettingsTab("Usage"); setModal("settings"); }} /></div>
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
              {["Tất cả", "Của bạn", "Được chia sẻ với bạn", "Ứng dụng"].map((t, i) => <button key={t} className={`tab ${tab === i ? "on" : ""}`} onClick={() => setTab(i)}>{t}</button>)}
              <span className="art-search"><I.Search size={15} /><input placeholder="Tìm artifact" value={artQ} onChange={(e) => setArtQ(e.target.value)} /></span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Tạo thứ gì đó mới</div>
            <div className="tpls">
              {TPLS.map((t, i) => (
                <button key={t.k} className={`tpl tpl-${t.k} ${i === 2 ? "last" : ""}`} onClick={() => { setTplMode(t.k); setView("new"); }}>
                  <div className="th"><TplArt k={t.k} /><span className="cur"><svg width="16" height="18" viewBox="0 0 16 18"><path d="M1.5 1l12 7.2-5.4 1.3-2.6 5.2z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" /></svg><em>Synchro</em></span></div>
                  <span className="tl">{t.name}{studios[STUDIO_OF[t.k]] ? <span className="tpl-lib" title={studios[STUDIO_OF[t.k]]!.name}><I.Plugins size={12} />{studios[STUDIO_OF[t.k]]!.skills} skill</span> : <span className="new-tag">Mới</span>}</span>
                  <span className="tpl-pop"><b>{t.name}</b><i>Của Synchro</i><span>{t.desc}</span></span>
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, margin: "28px 0 10px" }}>{tab === 3 ? "Ứng dụng nội bộ" : tab === 2 ? "Được chia sẻ với bạn" : "Artifact của bạn"}</div>
            {tab === 3 ? <AppsGallery q={artQ} say={say} /> : <ArtifactsGallery tab={tab} q={artQ} ai={caps.ai} say={say} refreshKey={artRefresh}
              onOpenChat={(conv) => { const c = chats.find((x) => String(x.id) === conv); if (!c) return false; setCur(c.id); setView("chat"); return true; }} />}
          </div></div>
        )}

        {view === "inbox" && <InboxPage say={say} model={model} onOpenChat={openAsChat} />}
        {view === "customize" && <CustomizePage tab={czTab} setTab={setCzTab} connectors={<ConnectorsPanel />} feats={{ skills: me?.perms.features.skills !== false, connectors: me?.perms.features.connectors !== false }} />}
        {view === "code" && <CodeView say={say} onEmpty={setCodeEmpty} sid={codeCur} title={codeList.find((c) => c.id === codeCur)?.title ?? "Synchro Code"} model={model} modelPicker={<ModelPicker model={model} setModel={setModel} />} sideOpen={open} onSide={() => setOpen(true)} onNew={() => setCodeCur(null)} onCreate={(id, title) => { setCodeList((l) => [{ id, title }, ...l]); setCodeCur(id); }} />}
        {view === "speech" && <SpeechView say={say} tool={spTool} setTool={setSpTool} sideOpen={open} onSide={() => setOpen(true)} />}
      </main>

      {drag && <div className="drop"><div className="drop-in"><div className="drop-ic"><I.Image size={30} /><I.Copy size={30} /><I.Folder size={30} /></div><span>Thả tệp vào đây</span></div></div>}
      <Toast text={toast} />
      {voiceOn && <VoiceMode onClose={() => setVoiceOn(false)} onAsk={(t) => send(t)} onTurn={voiceTurn} busy={busy} reply={lastAi ? { text: lastAi.text, time: lastAi.time ?? 0 } : null} rate={VOICE_RATE[vspeed] ?? 1} voice={vvoice} say={say} />}
      <Fade show={!!(modal === "settings")}><Settings key={settingsTab} initial={settingsTab} onClose={() => setModal(null)} theme={theme} setTheme={setTheme} /></Fade>
      <Fade show={!!(modal === "lang")}><LangModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "search")}><CommandPalette chats={visible} cmds={paletteCmds} go={paletteGo} onClose={() => setModal(null)} /></Fade>
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
