"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Avatar } from "./avatar";
import { getLang, locale, tf, tr, trc, useLangReady, useLangVer } from "./i18n";
import { resetClock } from "./resetfmt";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc, fileContext } from "./filemenu";
import { addKeys, attachFiles, getStatus, abortFile } from "./filestate";
import { UPLOAD_ACCEPT } from "../shared/fileproc/types";
import { projectBrief, stripAppliedNotes, type Rejected } from "../shared/turnctx";
import { Boundary, Fade, Menu, Thinking } from "./ui";
import { chatError, GENERIC_ERR } from "../shared/chaterror";
import { armDraft, saveDraft, takeDraft } from "./draft";
import { Lockup, Mark, SideToggle } from "./brand";
import { BrandLogo, ModelLogo, ProviderLogo } from "./brands";
import { lazyView } from "./lazy";
import type { CodeMeta } from "./codeview";
import { deleteServerSession, flushAllNow, listServerSessions, patchServerSession, pushSession, resetCodePrefs, seedCodePrefs, useCodePrefs } from "./codesync";
import type { SpeechTool } from "../shared/speech/data";
import { aiVoiceNote, elSpeed, speakAI, type Speaking } from "./speak";
import { toSpeech, VI } from "./voiceflow";
import { ConnLoginWatcher } from "./connwatch";
import { readBrowser, stopBrowserRead } from "./browserspeak";
import { deltaSink } from "./deltasink";
import { applyEvent, QueueChips, type Queued, type RunEv } from "./worklog";
import { startScribe, type Scribe } from "./scribe";
import type { AuthUser, Providers } from "./auth";
import { VerifyBanner } from "./verifybanner";
import { cleanTags } from "./chattags";
import { TagChips, TagPicker } from "./tagsui";
import type { PaletteCmd, PaletteGo } from "./palette";
import { CHIP_LIMIT } from "./composerchips";
import { AttachStrip } from "./attachstrip";
import { adoptNewChip, designStyleFor, useDesignChip } from "./designchip";
import { ASK_EVENT } from "./askcard";
import { fit as fitFloat } from "./floatfit";
import { steerRun } from "./llm";
import { attachRun, callLLM, olderDigest, cancelRun, LLMError, setActiveEffort, setActiveModel, setApprover, type ApprovalCall, type ApprovalAnswer, type RunMeta, type LibUse, type Decision, buildSystemPrompt, extractMemory, getRelevantContext, HISTORY_LIMIT, MEMORY_EVERY_N_USER_MSGS, type LLMMsg } from "./llm";
import { Confirm, LangModal, LogoutConfirm, ProjectModal, Settings, ShortcutsModal, UploadModal, UpgradeModal } from "./modals";
import { ShareModal } from "./shareui";
import { useBrainSync } from "./brainsync";
import { countRender } from "./perfmark";
import { resetUi, sameFields, selectChatMeta, selectCurChat, selectNeedKey, useChatState, useChatStore, useChats, usePanelUi, useSideUi } from "./chatstore.client";
import { useEvent } from "./useevent";
import { useClickAway } from "./clickaway";
import { useBoot, useDragDrop, usePageSetup, useShortcuts } from "./homehooks";
import type { CodeItem, Say, View } from "./hometypes";
import { Sidebar, useTagsAll, type SideActs } from "./Sidebar";
import { ChatThread, openLastProduct, stickToBottom, useLiveArtFollow, type BrwState, type ThreadActs } from "./Thread";


// Tên tạm khi vừa tạo đoạn chat (trước khi model đặt tên theo nội dung): theo sản phẩm / chủ đề của tin đầu, bỏ câu
// đóng vai ("Bạn là nhà thiết kế …"), ký hiệu Markdown và tham số công cụ (topicTitle); liên kết chỉ giữ tên miền.
const roughTitle = (t: string) => {
  const s = t.replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/g, "$1").replace(/[[\]]+/g, " ");
  return topicTitle(s) || t.slice(0, 40);
};
// Tin đầu chỉ là lời chào / quá ngắn: tên đặt lúc đầu chưa nói được gì, đặt lại khi đoạn chat đã rõ chủ đề (tin thứ ba).
const vagueMsg = (t: string) => t.trim().split(/\s+/).length <= 3 || /^(xin )?ch[àa]o|^(hi|hello|hey|alo|test)\b/i.test(t.trim());
// U6: mỗi mục có một địa chỉ #v=… để Back / liên kết / F5 mở đúng trang (đoạn chat vẫn dùng #c=, Cài đặt dùng #s=<tab>).
// "project" (chi tiết một dự án) dùng chung #v=projects với danh sách dự án. "new"/"chat" không có #v=.
const HASH_VIEW: Partial<Record<View, string>> = { projects: "projects", project: "projects", artifacts: "artifacts", autopilot: "autopilot", brain: "brain", code: "code", speech: "speech", customize: "skills" };
// #v=inbox: địa chỉ cũ của Autopilot (trước đây là Hộp thư) trong dấu trang, email cũ: vẫn mở đúng trang, rồi địa chỉ
// tự đổi sang #v=autopilot.
const VIEW_OF_HASH: Record<string, View> = { projects: "projects", artifacts: "artifacts", autopilot: "autopilot", inbox: "autopilot", brain: "brain", code: "code", speech: "speech", skills: "customize" };
import { AppCtx, useApp, VOICE_LANG, VOICE_RATE, initials, readPref, reloadPrefs, resetPrefs, usePref, type Chat, type Msg, type Project } from "./store";
import { IMAGE_PLANS, allowsModel, clampEffort, effortCap, effortsFor, isEffort, legacyModel, type Effort } from "../shared/catalog";
import { AUTO, fitModel, modelName, modelsSettled, refreshModels, seedModels, useModels } from "./models";
import type { BootData } from "../server/bootdata";
import { seedInboxCount } from "./inboxcount";
import { useFitPlaceholder } from "./phfit";
import type { ProviderInfo } from "../shared/catalog";
import { useInboxCount } from "./inboxcount";
import { adoptLegacyData, clearAccountData, ls, setUserScope, userScope } from "./userscope";
import { useChatSync, useSyncStatus } from "./chatsync";
import { chatsForExport, closeChats, hydrateAll, loadChats, needChats, wipeChats, writeJournal } from "./chatload";
import { shortName, topicTitle } from "../shared/names";
import { loadCaps, seedCaps, useCaps } from "./capsclient";
import { hasArtifacts, splitArtifacts, type ArtBlock } from "../shared/artifacts";
import { BootSkeleton } from "./skeleton";
import { resolveArt, type ArtVersion } from "../shared/vfs";
import { criticKey, fixPatch, important, type CriticEntry, type Finding } from "../shared/critic";
import { chatHistory, continuable, mixExtra } from "./history";
import { DockMixer } from "./mixer";
import { saveArtifacts } from "./artifactcard";
import { GEN_IMG_EVENT } from "../shared/artgen";
import { UsageRing } from "./usagering";
import { cachedJson, clearJsonCache, fmtCount, HUB_DISCOVER, HUB_SEARCH, seedMeta, useStudios } from "./studios";
import type { CzTab } from "./pluginsui";
import { ConnLogo } from "./connlogo";
import type { ComposioInfo, Conn } from "./connectorsui";
// Dữ liệu connector cho menu + ở ô chat: Composio (connector chính) và connector người dùng tự thêm.
// err: lần tải danh sách hỏng (mạng, máy chủ lỗi) — khác với "chưa có connector nào"; menu hiện nút Thử lại thay vì báo trống.
type CxData = { connectors: Conn[]; composio?: ComposioInfo; err?: boolean };
import { wantsIntro } from "./introflag";
import { startWarmPing, warmChoice } from "./warmping";
import { decodeSettingsTab, hashStep, settingsHash } from "./hashnav";

// Trang đầu chỉ tải phần chat; các mục khác, hộp thoại và màn hình đăng nhập tải khi cần (rê chuột vào mục thì tải trước).
const CodeView = lazyView(() => import("./codeview").then((m) => m.CodeView));
const SpeechView = lazyView(() => import("./speech/view").then((m) => m.SpeechView));
// Bảng chọn phong cách và chip "Kiểu: …" (cả CSS) nạp khi mở bảng hoặc khi đoạn chat có chip, không nằm trong tải đầu.
const DesignStylePop = lazyView(() => import("./designstyleui").then((m) => m.DesignStylePop), null);
const DesignChipCard = lazyView(() => import("./designstyleui").then((m) => m.DesignChipCard), null);
const BrainWorkspace = lazyView(() => import("./brainui").then((m) => m.BrainWorkspace));
const AutopilotPage = lazyView(() => import("./tasksui").then((m) => m.AutopilotPage));
const CustomizePage = lazyView(() => import("./pluginsui").then((m) => m.CustomizePage));
const ConnectorsPanel = lazyView(() => import("./connectorsui").then((m) => m.ConnectorsPanel));
const ProjectsPage = lazyView(() => import("./projects").then((m) => m.ProjectsPage));
const ProjectPage = lazyView(() => import("./projects").then((m) => m.ProjectPage));
const Studio = lazyView(() => import("./studio").then((m) => m.Studio), null);
const AppsGallery = lazyView(() => import("./appsui").then((m) => m.AppsGallery));
const ArtifactsGallery = lazyView(() => import("./artifactui").then((m) => m.ArtifactsGallery));
const ReconnectLink = lazyView(() => import("./connectorsui").then((m) => m.ReconnectLink), null);
const VoiceMode = lazyView(() => import("./voicemode").then((m) => m.VoiceMode), null);
const CommandPalette = lazyView(() => import("./palette").then((m) => m.CommandPalette), null);
const AuthComponent = lazyView(() => import("./auth").then((m) => m.AuthComponent), null);
const IntroFilm = lazyView(() => import("./introfilm").then((m) => m.IntroFilm), null);
const HalftoneBg = lazyView(() => import("./halftone").then((m) => m.HalftoneBg), null);
// Khách chưa đăng nhập lần nào: tải sẵn màn hình đăng nhập ngay từ đầu.
if (typeof document !== "undefined" && !document.documentElement.dataset.sess) AuthComponent.preload();
const PRELOAD: Partial<Record<View, () => void>> = { artifacts: ArtifactsGallery.preload, code: CodeView.preload, speech: SpeechView.preload, brain: BrainWorkspace.preload, autopilot: AutopilotPage.preload, customize: CustomizePage.preload, projects: ProjectsPage.preload };

const MODELS: [string, string][] = [["Opus 5", "Mạnh nhất cho việc phức tạp"], ["Sonnet 5.5", "Cân bằng tốc độ và chất lượng"], ["Haiku 5", "Nhanh nhất cho việc đơn giản"]];


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
// Dưới 860px: thanh bên đóng sẵn, mở ra là bảng nổi đè lên chat kèm lớp phủ tối, chọn chat hoặc bấm lớp phủ thì đóng.
// (Ngăn kéo điện thoại dưới 640px vẫn giữ nguyên — xem @media trong globals.css.)
const NARROW = "(max-width: 860px)";
const TPLS: { k: TplKey; name: string; label: string; ph: string; desc: string; sys: string }[] = [
  { k: "doc", name: "Tài liệu", label: "Synchro Docs", ph: "Tài liệu này nên nói về chủ đề gì?", desc: "Tài liệu mà nhóm của bạn đọc, bình luận và chỉnh sửa trực tiếp, trong khi Synchro giữ cho tài liệu luôn cập nhật.",
    sys: "Tôi tạo một tài liệu soạn thảo bằng công cụ Docs, gồm tiêu đề và nội dung các phần. Tài liệu này có thể xuất ra Word, PDF hoặc Markdown." },
  { k: "slides", name: "Trang trình bày", label: "Synchro Slides", ph: "Bộ trang chiếu này nên nói về chủ đề gì?", desc: "Bộ trang chiếu mà bạn có thể trình chiếu, đổi kiểu dáng bằng hệ thống thiết kế và tải về dạng PowerPoint hoặc PDF.",
    sys: "Tôi tạo một bộ slide trong trình chỉnh sửa riêng. Mỗi slide là một tệp dữ liệu nhỏ, bạn có thể tự sửa tiêu đề hay chữ mà không cần nhờ tôi, và có thể tải về dạng PowerPoint hoặc PDF." },
  { k: "design", name: "Thiết kế", label: "Synchro Design", ph: "Bản thiết kế này nên thể hiện điều gì?", desc: "Màn hình, luồng và đồ họa dựng bằng mã, bố trí thành các bảng vẽ trên cùng một khung vẽ mà bạn có thể tự chỉnh sửa. Ảnh chụp hay tranh được tạo bằng AI qua gói đã đăng nhập.",
    sys: "Tôi tạo một thiết kế trực quan như màn hình ứng dụng, poster, landing page hay mockup, dựng bằng mã; ảnh chụp hay tranh trong thiết kế thì tạo bằng AI qua gói đã đăng nhập. Nó hiện trên canvas để bạn xem, chỉnh và chia sẻ." },
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

function ModelPicker({ model, setModel, prefix }: { model: string; setModel: (m: string) => void; prefix?: string }) {
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
  // Đo chiều cao thật của khung lúc nó gắn vào trang (MsubBody): ước lượng theo số dòng từng bỏ sót ghi chú gói, nên danh sách Gemini
  // bị đặt ngang hàng rồi phải cuộn trong một khung thấp dù phía trên còn nhiều chỗ.
  const subAnchor = useRef({ off: 0, below: 0, menuBottom: 0 });
  const hoverProv = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect(), menu = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? r;
    subAnchor.current = { off: el.offsetTop, below: window.innerHeight - r.top - 12, menuBottom: menu.bottom };
    setSub(id);
  };
  const placeSub = (scroller: HTMLElement) => {
    const panel = scroller.closest<HTMLElement>(".msub-models"), a = subAnchor.current;
    if (!panel) return;
    const need = panel.offsetHeight - scroller.clientHeight + scroller.scrollHeight;
    setSubPos(need <= a.below ? { top: a.off - 6, maxHeight: Math.min(420, a.below) } : { bottom: 0, maxHeight: Math.min(420, Math.max(160, a.menuBottom - 12)) });
  };
  const mref = useClickAway(() => { setMm(false); setSub(null); });
  const close = () => { setMm(false); setSub(null); };
  // Đo trước khi vẽ: mở bằng bàn phím, menu con từng hiện ở chỗ cũ rồi mới nhảy, phần dời vào màn hình tính theo chỗ cũ nên cách menu chính 80-200px.
  useLayoutEffect(() => {
    if (!sub) return;
    const m = mref.current?.querySelector(".model-menu") as HTMLElement | null;
    if (!m) return;
    const r = m.getBoundingClientRect();
    const w = sub === "effort" ? 320 : 260, vw = window.innerWidth;
    // Ưu tiên bên phải menu, rồi bên trái; màn hình hẹp quá thì đặt sát mép phải màn hình (đè lên menu) để không bị cắt.
    let x = r.right + 8;
    if (x + w > vw - 8) { x = r.left - 8 - w; if (x < 8) x = Math.max(8, vw - 8 - w); }
    setSubLeft(x - r.left);
  }, [sub, mm]); // eslint-disable-line react-hooks/exhaustive-deps
  // Đổi chỗ mà không đổi cỡ thì bộ theo dõi kích thước không báo: tính lại phần dời ngay.
  useLayoutEffect(() => { mref.current?.querySelectorAll<HTMLElement>(".model-sub").forEach(fitFloat); }, [sub, subLeft, subPos]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <div ref={mref} style={{ position: "relative" }} onKeyDown={(e) => { if (e.key === "ArrowLeft" && sub && (e.target as HTMLElement).closest(".model-sub")) setSub(null); }}>
      <button className="model-btn" data-tip="Chọn model" aria-label={prefix ? `${prefix}: ${none ? tr("Chưa có model") : model ? tr(modelName(model)) : tr("Chọn model")}` : undefined} aria-haspopup="menu" aria-expanded={mm} onPointerEnter={() => { if (!mm) refreshModels(); }} onClick={() => { setMm(!mm); setSub(null); }}>{!none && model ? (model === AUTO ? <span className="vlogo" style={{ width: 16, height: 16 }} aria-hidden><I.Sparkle size={15} /></span> : <ModelLogo k={model} />) : null}{prefix ? (
        // Trong Synchro Code: thêm tiền tố "Model:" để phân biệt với hai nút "Chế độ"/"Quyền" bên cạnh; dưới 1100px CSS ẩn nhãn, chỉ còn icon.
        <span className="mp-lbl"><span className="mp-k">{prefix}</span>: {none ? "Chưa có model" : model ? modelName(model) : "Chọn model"}{!(model === AUTO && autoEff) && <> <span className="muted">{eLabel}</span></>}</span>
      ) : (<>{none ? "Chưa có model" : model ? modelName(model) : "Chọn model"}{!(model === AUTO && autoEff) && <> <span className="muted">{eLabel}</span></>}</>)}<I.Chevron size={14} /></button>
      <Menu open={mm} className="model-menu" style={{ position: "absolute", ...(shift ? { translate: `${shift}px 0` } : {}) }}>
        {none && (
          <div className="mempty">
            <b>Chưa kết nối model nào</b>
            <span>{me?.isAdmin ? "Đăng nhập gói Claude, ChatGPT, Gemini hoặc Grok của bạn, hoặc nhập khóa API dùng chung." : "Đăng nhập gói Claude, ChatGPT, Gemini hoặc Grok của bạn để bắt đầu."}</span>
            <button className="btn dark" onClick={() => { close(); openSettings?.("Providers"); }}>Mở Cài đặt → Providers</button>
          </div>
        )}
        {!none && (
          <button className="menu-item mline mauto" onClick={() => pick(AUTO)} onMouseEnter={() => setSub(null)}>
            <span className="vlogo mauto-ic" style={{ width: 16, height: 16 }} aria-hidden><I.Sparkle size={15} /></span><span className="mauto-t"><b>Tự động</b><em>{`Chọn qua mọi hãng đã kết nối${providers.length ? ` (${providers.map((p) => p.name).join(", ")})` : ""}: việc dễ dùng model nhanh, việc khó dùng model mạnh nhất hợp với việc đó`}</em></span>{model === AUTO && <span className="ck"><I.Check /></span>}
          </button>
        )}
        {!none && <hr />}
        {/* Danh sách chưa về (máy chủ vừa khởi động lại còn kiểm tra đăng nhập gói): báo đang tải thay vì để trống. */}
        {!loaded && <div className="mload" role="status"><span className="art-spin sm" /><span>Đang tải danh sách model…</span></div>}
        {providers.map((pv) => (
          <button key={pv.id} aria-haspopup="menu" aria-expanded={sub === pv.id} className={`menu-item mline mprov ${sub === pv.id ? "is-sel" : ""}`} onClick={(e) => hoverProv(pv.id, e.currentTarget)} onMouseEnter={(e) => hoverProv(pv.id, e.currentTarget)}>
            <ProviderLogo p={pv} /><span className="mname-t" data-notr>{pv.name}</span><span className="sc">{pv.models.some((m) => m.key === model) && <i className="dot" />}<I.ChevronR size={16} /></span>
          </button>
        ))}
        {!none && <hr />}
        <button aria-haspopup="menu" aria-expanded={sub === "effort"} className={`menu-item mline ${sub === "effort" ? "is-sel" : ""}`} onClick={() => setSub("effort")} onMouseEnter={() => setSub("effort")}>Mức độ nỗ lực<span className="sc">{eLabel}<I.ChevronR size={16} /></span></button>
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
            <MsubBody on={sub === pv.id} count={pv.models.length} place={placeSub}>
            {pv.models.map((m) => (
              <button key={m.key} className={`menu-item mline ${ok(m.key) ? "" : "locked"}`} onClick={() => pick(m.key)} title={ok(m.key) ? m.id : "Quản trị viên chưa cho phép tài khoản của bạn dùng model này"}>
                <ModelLogo k={m.key} name={m.name} /><span className="mname-t">{m.name}</span>{m.isNew && !m.blockedUntil ? <span className="mtag mnew" title="Hãng vừa ra mắt, Synchro đã thử và cho dùng">Mới</span> : null}{m.blockedUntil ? <span className="mtag" title={resetClock(m.blockedUntil, getLang())}>{tr("Hết hạn mức")}</span> : null}{m.key === model ? <span className="ck"><I.Check /></span> : !ok(m.key) && <span className="sc"><I.Lock size={14} /></span>}
              </button>
            ))}
            </MsubBody>
          </Menu>
        ))}
      </Menu>
    </div>
  );
}

// Ghi chú gói subscription trong menu con của hãng: gói hết hạn mức (đề nghị dùng khóa API, chỉ chuyển khi người dùng bấm),
// đang dùng khóa API thay gói (quay lại gói), hay cần đăng nhập lại.

// Lượt lỗi → thông báo kèm tin nhắn. text: lời báo khi còn giữ được phần đã viết; không thì lời báo chính là nội dung tin (failed).
const noticeOf = (d: Record<string, unknown>, text: string): Msg["notice"] => ({
  ...(text ? { text, partial: true } : { failed: true }),
  ...(typeof d.resetsAt === "number" ? { at: d.resetsAt } : {}),
  ...(d.switchTo && typeof (d.switchTo as { model?: unknown }).model === "string" ? { switchTo: d.switchTo as { model: string; name: string } } : {}),
  ...(d.partialWork ? { work: true } : {}),
  ...(Array.isArray(d.tried) ? { tried: d.tried as string[] } : {}),
});

// Phần cuộn của danh sách model nằm trong khung kính chứ không phải chính khung kính: nền và viền kính là lớp ::before / ::after của khung,
// khung tự cuộn thì chúng trôi theo nội dung (viền cắt ngang dòng cuối, các dòng lòi ra ngoài nền). Ghi chú gói đứng yên ở đầu khung.
function MsubBody({ on, count, place, children }: { on: boolean; count: number; place: (scroller: HTMLElement) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (on && ref.current) place(ref.current); }, [on, count]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="menu-scroll msub-scroll">{children}</div>;
}

function PlanNote({ pv }: { pv: ProviderInfo }) {
  const p = pv.plan!;
  const at = (t: number) => resetClock(t, getLang());
  const set = (on: boolean) => fetch(`/api/engines/${p.cli}/use-api`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }).then(() => refreshModels()).catch(() => {});
  if (pv.source === "api" && p.usingApiUntil) return (
    <div className="msub-note msub-plan">
      <span>{tf("Đang dùng khóa API dùng chung thay gói tới {at}.", { at: at(p.usingApiUntil) })}</span>
      <button className="lnk" onClick={() => set(false)}>{tr("Quay lại gói")}</button>
    </div>
  );
  if (p.relogin) return <div className="msub-note msub-plan"><span>{tr("Gói cần đăng nhập lại ở Cài đặt → Providers.")}</span></div>;
  if (p.blockedUntil) return (
    <div className="msub-note msub-plan">
      <span>{tf("Gói đã hết hạn mức, hồi lại {at}.", { at: at(p.blockedUntil) })}</span>
      {p.hasApi && <button className="lnk" onClick={() => set(true)}>{tr("Dùng khóa API dùng chung")}</button>}
    </div>
  );
  return <div className="msub-note msub-plan"><span>{tr("Từ gói của bạn")}</span></div>;
}

type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: (e: { error: string }) => void; onend: () => void; start: () => void; stop: () => void };
// Lỗi nhận dạng của trình duyệt → một câu cho người dùng. Không có tiếng (no-speech) và bị dừng (aborted) không phải lỗi.
const REC_ERR: Record<string, string> = { "not-allowed": "Không mở được micro: hãy cho phép Synchro dùng micro", "service-not-allowed": "Trình duyệt đang chặn nhận dạng giọng nói", "audio-capture": "Không tìm thấy micro trên máy này", network: "Nhận dạng giọng nói của trình duyệt cần kết nối mạng", "language-not-supported": "Trình duyệt chưa nhận dạng được ngôn ngữ này" };

// Ô soạn tin: memo, mọi prop là giá trị đơn hoặc hàm ổn định (useEvent ở Home), nên không vẽ lại theo từng mẩu chữ đang chảy (blueprint B2).
const Composer = memo(function Composer(p: {
  onSend: (t: string, f: string[], pick?: { id: string; label: string }[]) => void; busy: boolean; onStop: () => void; dock?: boolean; say: Say;
  prefill: { t: string; n: number }; files: string[]; setFiles: (f: string[]) => void;
  model: string; setModel: (m: string) => void; goCustom: () => void; goConnectors?: () => void; placeholder?: string; focusPlaceholder?: string; openUpload: () => void;
  onVoice?: () => void; extra?: React.ReactNode;
  projects?: { id: number; name: string }[]; project?: number; onProject?: (id: number | undefined) => void;
  /** Đang chạy mà gửi thêm: later = false ghép vào việc đang làm, true = gửi sau khi xong. */
  onSteer?: (text: string, later: boolean) => void;
  /** Đổi giá trị (bấm Mới, mở đoạn chat, chọn chế độ…) thì đưa con trỏ vào ô nhập. */
  focusKey?: string;
  /** Đoạn chat đang soạn ("new" khi chưa tạo): chip "Kiểu: …" gắn theo đoạn chat này. */
  chatKey?: string;
}) {
  countRender("Composer");
  // memo chặn lần vẽ lại của Home khi từ điển ngôn ngữ vừa tải xong: tự theo dõi để chữ tr() đổi ngôn ngữ.
  useLangReady();
  const { onSend, busy, onStop, dock, say, files, setFiles, model, setModel, openUpload } = p;
  const fm = useFileMenu(say);
  const [v, setV] = useState("");
  const [foc, setFoc] = useState(false);
  const [menu, setMenu] = useState(false);
  // Tìm web và bộ nhớ: lưu theo người dùng, gửi kèm mỗi lượt chat.
  const [web, setWeb] = usePref("webSearch", true);
  const app = useApp(), mdl = useModels();
  const perms = app.me?.perms;
  const [mem, setMem] = usePref("chatMemory", true);
  const [rec, setRec] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const steerPh = useFitPlaceholder(ta, ["Nhắn thêm: ↵ ghép vào việc đang làm, ⌘↵ gửi sau khi xong", "Nhắn thêm vào việc đang làm…"]);
  const fileIn = useRef<HTMLInputElement>(null);
  const recRef = useRef<Rec | null>(null);
  const ref = useClickAway(() => { setMenu(false); setSub(null); });
  // Menu + → Kho kỹ năng / Connectors: menu con bên phải (điện thoại: thay chỗ menu chính, có nút quay lại).
  const [sub, setSub] = useState<null | "skills" | "conn" | "access">(null);
  const [picks, setPicks] = useState<{ id: string; label: string }[]>([]);
  // "Làm theo kiểu này": bảng chọn phong cách và chip của đoạn chat (gửi kèm mọi lượt tới khi bỏ).
  const [dsOpen, setDsOpen] = useState(false);
  const [dchip, setDchip] = useDesignChip(p.chatKey ?? "new");
  const closeDs = useCallback(() => setDsOpen(false), []);
  // Menu "+" vừa mở: tải trước bảng chọn phong cách để bấm "Làm theo kiểu này…" là hiện ngay.
  useEffect(() => {
    if (menu) DesignStylePop.preload();
  }, [menu]);
  const openDs = () => {
    setMenu(false);
    setSub(null);
    setDsOpen(true);
  };
  // Dải thẻ đính kèm: quá CHIP_LIMIT thẻ thì gộp phần dư vào "+N"; bấm "+N" trải ra lưới nhiều hàng (xem ui/composerchips.ts).
  const [chipsOpen, setChipsOpen] = useState(false);
  // Lưới đã trải chỉ dành cho bộ thẻ đang soạn: còn ≤ CHIP_LIMIT thẻ (đã gửi, đã gỡ bớt) thì lần đính kèm sau lại bắt đầu từ dải một hàng.
  const chipCount = picks.length + files.length + (dchip ? 1 : 0);
  useEffect(() => { if (chipCount <= CHIP_LIMIT) setChipsOpen(false); }, [chipCount]);
  const [skl, setSkl] = useState<{ id: string; label: string; lib?: boolean; cat?: boolean }[] | null>(null);
  const [skq, setSkq] = useState("");
  // Thư viện từ danh mục Claude không tải sẵn: gõ tìm thì hỏi máy chủ.
  const [skCat, setSkCat] = useState<{ id: string; label: string; lib?: boolean; cat?: boolean }[]>([]);
  useEffect(() => {
    const k = skq.trim();
    if (k.length < 2) { setSkCat([]); return; }
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/plugins?view=lite&q=${encodeURIComponent(k)}`).then((r) => (r.ok ? r.json() : { plugins: [] })).then((j: { plugins?: { slug: string; name: string; enabled: boolean; mine: { enabled: boolean } }[] }) => {
        if (live) setSkCat((j.plugins ?? []).filter((x) => x.enabled && x.mine?.enabled !== false).map((x) => ({ id: `lib-${x.slug}`, label: x.name, lib: true, cat: true })));
      }).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [skq]);
  const [cx, setCx] = useState<CxData | null>(null);
  const loadSkl = () => Promise.all([
    cachedJson<{ skills?: { name: string; enabled: boolean }[] }>("/api/skills").then((j) => j.skills ?? []),
    cachedJson<{ plugins?: { slug: string; name: string; enabled: boolean; mine: { enabled: boolean }; catalogId: string | null }[] }>("/api/plugins?view=lite").then((j) => j.plugins ?? []),
  ]).then(([s, l]) => { setSkq(""); setSkl([...l.filter((x) => x.enabled && x.mine?.enabled !== false).map((x) => ({ id: `lib-${x.slug}`, label: x.name, lib: true, cat: !!x.catalogId?.startsWith("cd:") })), ...s.filter((x) => x.enabled).map((x) => ({ id: x.name, label: x.name }))]); });
  // Danh sách hỏng (mạng, máy chủ lỗi): báo "Không tải được · Thử lại" thay vì để như "chưa có connector nào".
  const loadCx = () => fetch("/api/connectors").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j) => setCx(j)).catch(() => setCx({ connectors: [], err: true }));
  const openSub = (k: NonNullable<typeof sub>) => { setSub(sub === k ? null : k); if (k === "skills") void loadSkl(); if (k === "conn" || k === "access") void loadCx(); };
  // Composio của bạn đã liên kết và đang chạy (có trong lượt chat): thêm vào các thao tác chung như quyền dùng công cụ.
  const cxMain = cx?.composio?.state === "linked" && cx.composio.connector?.status === "ok" ? cx.composio.connector : null;
  const cxPatch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/connectors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { say(j.error || "Không đổi được connector"); return; }
    void loadCx();
  };
  // Gõ @ trong ô nhập (đầu dòng hoặc sau khoảng trắng, không phải giữa địa chỉ email): danh sách connector đang dùng được để chỉ định
  // connector cho tin này. Chọn là chèn "@Tên " vào tin; hướng dẫn hệ thống dặn model ưu tiên công cụ của connector được nhắc (connectors.ts).
  const [at, setAt] = useState<{ start: number; end: number; q: string } | null>(null);
  const [atSel, setAtSel] = useState(0);
  const foldAt = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  const atList = at && cx ? [...(cxMain && cxMain.enabled ? [{ id: cxMain.id, name: "Composio", logo: "composio" as string | undefined, color: "#5B4BDB", icon: undefined as string | undefined, site: undefined as string | undefined }] : []),
    ...cx.connectors.filter((c) => c.enabled && !c.adminBlocked && c.status === "ok").map((c) => ({ id: c.id, name: c.name, logo: c.logo, color: c.color, icon: c.icon, site: c.site }))]
    .filter((c) => !at.q || foldAt(c.name).includes(foldAt(at.q))).slice(0, 8) : [];
  const typed = (val: string, caret: number) => {
    setV(val);
    const m = val.slice(0, caret).match(/(^|\s)@([^\s@]{0,30})$/);
    if (!m || perms?.features.connectors === false) { if (at) setAt(null); return; }
    if (!cx) void loadCx();
    setAt({ start: caret - m[2].length - 1, end: caret, q: m[2] });
    setAtSel(0);
  };
  const pickAt = (name: string) => {
    if (!at) return;
    const ins = `@${name.replace(/\s+/g, "")} `, next = v.slice(0, at.start) + ins + v.slice(at.end);
    setV(next); setAt(null);
    const pos = at.start + ins.length;
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(pos, pos); } });
  };

  useEffect(() => {
    if (p.prefill.n) { setV(p.prefill.t); ta.current?.focus(); }
  }, [p.prefill]);
  // Bấm Mới, mở đoạn chat: gõ được ngay. Bấm Mới khi đang ở trang chủ thì ô nhập không gắn lại nên autoFocus không chạy, chữ gõ từng bị mất.
  // Điện thoại không tự mở bàn phím ảo; đang có hộp thoại thì tiêu điểm thuộc về hộp.
  useEffect(() => {
    if (p.focusPlaceholder || matchMedia("(pointer: coarse)").matches) return;
    const f = requestAnimationFrame(() => { if (!document.querySelector(".overlay")) ta.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(f);
  }, [p.focusKey, p.focusPlaceholder]);
  // Phần đang gõ nằm trong bản nháp của tab: trang lỗi, tải lại, đăng nhập lại khi phiên hết hạn đều không làm mất.
  useEffect(() => { const d = takeDraft(); if (d) setV((o) => o || d); }, []);
  useEffect(() => { saveDraft(v); }, [v]);
  // Bấm vào chỗ trống trong khung soạn tin cũng là bấm vào ô nhập.
  const boxDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,a,input,textarea,select,label,[role=button],.menu,.attach")) return;
    e.preventDefault();
    ta.current?.focus();
  };
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "auto";
    ta.current.style.height = Math.min(ta.current.scrollHeight, 240) + "px";
  }, [v]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "u" && !document.querySelector(".app[inert]")) { e.preventDefault(); openUpload(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const canSend = !!(v.trim() || files.length);
  const submit = (later = false) => {
    // Đang chạy: không ngắt — Enter ghép tin vào việc đang làm, ⌘/Ctrl + Enter xếp hàng gửi sau khi xong.
    if (busy && p.onSteer && v.trim()) { p.onSteer(v.trim(), later); setV(""); return; }
    if (!canSend || busy) return;
    // Chưa có model nào: đưa tới chỗ kết nối, tin đang gõ vẫn nằm nguyên trong ô (không gửi đi để nhận về một câu lỗi).
    if (mdl.loaded && !mdl.providers.length) { say("Hãy kết nối một gói AI để gửi tin này"); app.openSettings?.("Providers"); return; }
    const fire = () => { onSend(v.trim() || "Xem tệp đính kèm", files, picks.length ? picks : undefined); setV(""); setPicks([]); setAt(null); setChipsOpen(false); };
    // Có thẻ tệp báo lỗi: hỏi trước khi gửi, vì các tệp đó sẽ không gửi được (model chỉ được báo tên và lý do).
    const bad = files.filter((f) => getStatus(f)?.state === "error").length;
    if (bad) {
      const why = `${bad} ${tr("tệp không đọc được sẽ không được gửi. Gửi phần còn lại?")}`;
      app.confirm(tr("Không gửi được một số tệp"), why, tr("Gửi phần còn lại"), fire, { safe: true });
      return;
    }
    fire();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (at && !e.nativeEvent.isComposing) {
      if (e.key === "Escape") { e.preventDefault(); setAt(null); return; }
      if (atList.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setAtSel((i) => (i + (e.key === "ArrowDown" ? 1 : atList.length - 1)) % atList.length); return; }
      if (atList.length && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) { e.preventDefault(); pickAt(atList[Math.min(atSel, atList.length - 1)].name); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  };
  const atMenu = at && (
    <div className="at-menu" role="listbox" aria-label={tr("Chọn connector")} onMouseDown={(e) => e.preventDefault()}>
      <div className="at-h">{tr("Dùng connector cho tin này")}</div>
      {cx === null ? <div className="cm-empty"><span className="art-spin sm" /></div>
        : atList.length ? atList.map((c, i) => (
          <button key={c.id} type="button" role="option" aria-selected={i === atSel} className={`menu-item${i === atSel ? " on" : ""}`} onMouseEnter={() => setAtSel(i)} onClick={() => pickAt(c.name)}>
            <ConnLogo logo={c.logo} color={c.color} icon={c.icon} site={c.site} name={c.name} size={18} /><span className="cv-ell" data-notr>{c.name}</span>
          </button>))
        : <button type="button" className="menu-item" onClick={() => { setAt(null); (p.goConnectors ?? p.goCustom)(); }}><I.Connectors />{tr(at.q ? "Không có connector nào khớp · Quản lý connectors" : "Chưa kết nối connector nào · Quản lý connectors")}</button>}
    </div>
  );
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
    if (!SR) { setRec(false); return say("Trình duyệt này chưa nhập được bằng giọng nói. Hãy dùng Chrome, Edge hoặc Safari, hoặc gõ tin nhắn"); }
    const r = new SR();
    // continuous: nghe tiếp qua các khoảng nghỉ, tới khi người dùng bấm dừng (hoặc trình duyệt tự kết thúc).
    r.lang = lang; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => setV(base + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onerror = (e) => { const m = REC_ERR[e.error]; if (m) say(m); };
    r.onend = () => setRec(false);
    recRef.current = r;
    try { r.start(); } catch { setRec(false); say("Không mở được nhận dạng giọng nói, hãy thử lại"); }
  };
  // Thêm tệp vào tin đang soạn; trả lời báo tên thẻ khác tên tệp (đã báo cho người dùng) để người gọi khỏi báo đè.
  const attach = (list: File[]) => {
    const r = attachFiles(files, list, say);
    setFiles(addKeys(files, r.keys, say));
    if (r.note) say(r.note);
    return r.note;
  };
  // Dán ảnh / tệp từ bộ nhớ tạm (⌘V) như Claude, ChatGPT: thành tệp đính kèm; ảnh dán không tên thì đặt tên theo giờ.
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fl = Array.from(e.clipboardData?.files ?? []);
    if (!fl.length) return;
    e.preventDefault();
    const d = new Date(), stamp = `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}.${String(d.getSeconds()).padStart(2, "0")}`;
    const named = fl.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Ảnh dán ${stamp}${fl.length > 1 ? `-${i + 1}` : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })));
    attach(named);
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = Array.from(e.target.files ?? []);
    if (fl.length) attach(fl);
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
      const note = attach([new File([blob], name, { type: "image/png" })]);
      if (!note) say("Đã đính kèm ảnh chụp màn hình");
    } catch (e) { if ((e as Error).name !== "NotAllowedError") say("Không chụp được màn hình"); }
  };

  const plus = (
    <div ref={ref} style={{ position: "relative" }}>
      <input ref={fileIn} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={pick} />
      <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Thêm" aria-haspopup="menu" aria-expanded={menu}><I.Plus /></button>
        <Menu open={!!(menu)} className="plus-menu" style={{ bottom: 40, left: 0, width: 264 }}>
          {perms?.features.files !== false && <button className="menu-item" onClick={() => { setMenu(false); openUpload(); }}><I.Clip />Tải lên hoặc thêm tệp<span className="sc">⌘U</span></button>}
          {perms?.features.files !== false && <button className="menu-item" onClick={shot}><I.Camera />Chụp ảnh màn hình</button>}
          <button className="menu-item" aria-haspopup="dialog" onClick={openDs}><I.Palette />Làm theo kiểu này…</button>
          {p.onProject && perms?.features.projects !== false && (p.projects?.length ? (
            <>
              <button className="menu-item" aria-expanded={projOpen} onClick={() => setProjOpen(!projOpen)}><I.Layers />Thêm vào dự án<span className="sc">{projOpen ? <I.M icon="Chevron" size={16} /> : <I.M icon="ChevronR" size={16} />}</span></button>
              {projOpen && p.projects.map((pr) => <button key={pr.id} className="menu-item sub" onClick={() => { setMenu(false); setProjOpen(false); p.onProject!(p.project === pr.id ? undefined : pr.id); }}><span data-notr>{pr.name}</span>{p.project === pr.id && <span className="ck"><I.Check /></span>}</button>)}
            </>
          ) : <button className="menu-item" onClick={() => { setMenu(false); p.onProject!(undefined); }}><I.Layers />Tạo dự án để thêm vào</button>)}
          <hr />
          {perms?.features.skills !== false && <button className={`menu-item${sub === "skills" ? " on" : ""}`} aria-haspopup="menu" aria-expanded={sub === "skills"} onClick={() => openSub("skills")}><I.Plugins />Kho kỹ năng<span className="sc"><I.ChevronR size={16} /></span></button>}
          {perms?.features.connectors !== false && <button className={`menu-item${sub === "conn" || sub === "access" ? " on" : ""}`} aria-haspopup="menu" aria-expanded={sub === "conn"} onClick={() => openSub("conn")}><I.Connectors />Connectors<span className="sc"><I.ChevronR size={16} /></span></button>}
          <hr />
          {perms?.features.web !== false && <button className="menu-item" onClick={() => { setWeb(!web); say(web ? "Đã tắt tìm kiếm web" : "Đã bật tìm kiếm web"); }}><I.Globe />Tìm kiếm trên web{web && <span className="ck"><I.Check /></span>}</button>}
          <button className="menu-item" onClick={() => { setMem(!mem); say(mem ? "Đã tắt bộ nhớ" : "Đã bật bộ nhớ"); }}><I.History />Bộ nhớ{mem && <span className="ck"><I.Check /></span>}</button>
          {sub && (
            <div className="menu cm-fly" role="menu">
              <button className="menu-item cm-back" onClick={() => setSub(sub === "access" ? "conn" : null)}><I.ChevronL size={16} />{sub === "skills" ? "Kho kỹ năng" : sub === "access" ? "Quyền dùng công cụ" : "Connectors"}</button>
              {sub === "skills" && (<>
                {/* Như Claude: ô tìm ở đầu danh sách. Chưa gõ: skill và thư viện bạn tự cài; gõ: tìm cả thư viện của danh mục skill (vài nghìn). */}
                {skl && skl.length > 8 && <div className="cm-find"><I.Search size={14} /><input autoFocus value={skq} onChange={(e) => setSkq(e.target.value)} placeholder="Tìm skill hoặc thư viện" aria-label="Tìm skill hoặc thư viện" /></div>}
                <div className="cm-list">
                  {skl === null ? <div className="cm-empty"><span className="art-spin sm" /></div> : !skl.length ? <div className="cm-empty">Chưa có skill nào đang bật</div>
                    : (() => { const q = skq.trim().toLowerCase(); const l = (q ? [...skl, ...skCat].filter((k) => k.label.toLowerCase().includes(q) || k.id.includes(q)) : skl.filter((k) => !k.cat)).slice(0, 60); return l.length ? l : [null]; })().map((k) => { if (!k) return <div key="none" className="cm-empty">Không có skill hoặc thư viện nào khớp</div>; const on = picks.some((x) => x.id === k.id); return (
                      <button key={k.id} className="menu-item" role="menuitemcheckbox" aria-checked={on} onClick={() => { setPicks(on ? picks.filter((x) => x.id !== k.id) : [...picks, { id: k.id, label: k.label }]); setMenu(false); setSub(null); ta.current?.focus(); }}>
                        {k.lib ? <I.Plugins /> : <I.Scroll />}<span className="cv-ell" data-notr>{k.label}</span>{on && <span className="ck"><I.Check /></span>}
                      </button>); })}
                </div>
                <hr />
                <button className="menu-item" onClick={() => { setMenu(false); setSub(null); p.goCustom(); }}><I.Brief />Quản lý skill</button>
                <button className="menu-item" onClick={() => { setMenu(false); setSub(null); try { sessionStorage.setItem("hub-tab", "discover"); } catch {} p.goCustom(); window.dispatchEvent(new Event(HUB_DISCOVER)); }}><I.Plus />Duyệt skill</button>
              </>)}
              {sub === "conn" && (<>
                <div className="cm-list">
                  {cx === null ? <div className="cm-empty"><span className="art-spin sm" /></div> : cx.err ? <div className="cm-empty cm-err"><span>Không tải được</span><span className="cm-dot">·</span><button className="cn-link" onClick={() => { setCx(null); void loadCx(); }}>Thử lại</button></div> : <>
                    {cx.composio && (() => {
                      const k = cx.composio, c = k.connector, live = k.state === "linked" && c?.status === "ok", on = live && !!c?.enabled;
                      const note = k.state === "unlinked" ? "Chưa liên kết" : k.state === "blocked" ? "Không được phép" : live ? "" : "Cần liên kết lại";
                      return (
                        <div className="menu-item cm-conn cm-cx">
                          <ConnLogo logo="composio" color="#5B4BDB" name="Composio" size={20} /><span className="cv-ell" data-notr>Composio</span>{note && <span className={`cm-cnt${k.state !== "blocked" ? " cm-dup" : ""}`} title={note}>{note}</span>}
                          {live && c
                            ? <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`${on ? "Tắt" : "Bật"} Composio`} onClick={() => cxPatch(c.id, { enabled: !c.enabled })} />
                            : <button className="cn-link cm-rec" onClick={() => { setMenu(false); setSub(null); (p.goConnectors ?? p.goCustom)(); }}>{k.state === "blocked" ? "Xem" : "Liên kết"}</button>}
                        </div>);
                    })()}
                    {cx.connectors.map((c) => { const on = c.enabled && !c.adminBlocked && c.status === "ok"; return (
                      <div key={c.id} className="menu-item cm-conn">
                        <ConnLogo logo={c.logo} color={c.color} icon={c.icon} site={c.site} name={c.name} size={20} /><span className="cv-ell" data-notr>{c.name}</span>
                        {c.status !== "ok" && !c.adminBlocked
                          ? <ReconnectLink c={c} say={say} onDone={loadCx} onManage={() => { setMenu(false); setSub(null); (p.goConnectors ?? p.goCustom)(); }} />
                          : <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`${on ? "Tắt" : "Bật"} ${c.name}`} disabled={c.adminBlocked} onClick={() => cxPatch(c.id, { enabled: !c.enabled })} />}
                      </div>); })}
                    {!cx.composio && !cx.connectors.length && <div className="cm-empty">Chưa kết nối connector nào</div>}
                  </>}
                </div>
                <hr />
                <button className="menu-item" onClick={() => { setMenu(false); setSub(null); (p.goConnectors ?? p.goCustom)(); }}><I.Brief />Quản lý connectors</button>
                <button className="menu-item" aria-haspopup="menu" onClick={() => openSub("access")} disabled={!cx?.connectors.length && !cxMain}><I.Search />Quyền dùng công cụ<span className="sc"><I.ChevronR size={16} /></span></button>
              </>)}
              {sub === "access" && cx && (() => {
                const live = [...(cxMain ? [cxMain] : []), ...cx.connectors].filter((c) => c.status === "ok" && !c.adminBlocked);
                const cur = (ro: boolean) => { const ps = new Set(live.flatMap((c) => c.tools.filter((t) => t.readOnly === ro).map((t) => t.perm))); return ps.size === 1 ? [...ps][0] : null; };
                const set = async (kind: "read" | "write", perm: string) => { for (const c of live) await cxPatch(c.id, { group: { kind, perm } }); say("Đã đổi quyền dùng công cụ cho mọi connector"); };
                const opt = (kind: "read" | "write", perm: string, label: string) => <button key={kind + perm} className="menu-item" role="menuitemradio" aria-checked={cur(kind === "read") === perm} onClick={() => set(kind, perm)}>{label}{cur(kind === "read") === perm && <span className="ck"><I.Check /></span>}</button>;
                return (<>
                  <div className="cm-h">Công cụ chỉ đọc</div>
                  {opt("read", "allow", "Tự dùng")}{opt("read", "ask", "Hỏi trước")}
                  <hr />
                  <div className="cm-h">Công cụ thay đổi dữ liệu</div>
                  {opt("write", "ask", "Hỏi trước")}{opt("write", "allow", "Tự dùng")}{opt("write", "block", "Chặn")}
                </>);
              })()}
            </div>
          )}
        </Menu>
        {dsOpen && <DesignStylePop open onClose={closeDs} onPick={setDchip} files={files} brief={v} say={say}
          anchor={ref} />}
    </div>
  );

  const sendBtn = (
    <button className="send" disabled={!busy && !canSend} onClick={busy ? (v.trim() && p.onSteer ? () => submit() : onStop) : () => submit()} aria-label={busy ? (v.trim() && p.onSteer ? "Gửi thêm" : "Dừng") : "Gửi"}>
      {busy ? (v.trim() && p.onSteer ? <I.M icon="Arrow" /> : <I.M icon="Stop" />) : dock ? <I.M icon="Enter" /> : <I.M icon="Arrow" />}
    </button>
  );
  const micBtn = <MicPicker say={say} rec={rec} onMic={mic} />;
  const modelPicker = <ModelPicker model={model} setModel={setModel} />;
  // Thẻ = chip skill đã chọn + tệp đính kèm, theo đúng thứ tự đó. Quá CHIP_LIMIT thẻ: dải một hàng chỉ hiện CHIP_LIMIT thẻ rồi "+N".
  const cards = [
    ...(dchip ? [<DesignChipCard key="sty-chip" chip={dchip} onRemove={() => setDchip(null)} />] : []),
    ...picks.map((k) => <span key={"pk-" + k.id} className="pick-chip">{k.id.startsWith("lib-") ? <I.Plugins size={14} /> : <I.Scroll size={14} />}<span className="cv-ell" data-notr>{k.label}</span><button className="icon-btn" aria-label={`Bỏ skill ${k.label}`} onClick={() => setPicks(picks.filter((x) => x.id !== k.id))}><I.X size={12} /></button></span>),
    ...files.map((f, i) => <FileCard key={"fc-" + f + i} name={f} onOpen={() => fm.show(f)} onContextMenu={(e) => fm.open(e, f)} onRemove={() => { abortFile(f); setFiles(files.filter((_, j) => j !== i)); }} />),
  ];
  // U2: dải một hàng chỉ dựng những thẻ hiện trọn được rồi "+N" ở mép phải, bấm thì trải lưới (ui/attachstrip.tsx, dùng chung với Synchro Code).
  const chips = cards.length > 0 && <AttachStrip cards={cards} open={chipsOpen} setOpen={setChipsOpen} lead={fm.node} />;

  if (dock)
    return (
      <div className="composer" style={{ flexWrap: "wrap" }} onMouseDown={boxDown}>
        {chips && <div style={{ width: "100%" }}>{chips}</div>}
        {atMenu}
        {plus}
        <textarea ref={ta} rows={1} aria-label="Tin nhắn cho Synchro" value={v} onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)} onKeyDown={keys} onPaste={paste} onBlur={() => setAt(null)} placeholder={busy && p.onSteer ? steerPh : p.placeholder ?? "Viết tin nhắn..."} style={{ flex: 1 }} />
        {p.extra}
        {micBtn}
        {!canSend && !busy && p.onVoice ? <button className="icon-btn vm-open" data-tip="Trò chuyện bằng giọng nói" onClick={p.onVoice} aria-label="Trò chuyện bằng giọng nói"><I.Wave /></button> : sendBtn}
      </div>
    );

  return (
    <div className="composer" onMouseDown={boxDown}>
      {chips}
      {atMenu}
      <textarea ref={ta} rows={1} aria-label="Tin nhắn cho Synchro" value={v} onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)} onKeyDown={keys} onPaste={paste} placeholder={busy && p.onSteer ? steerPh : foc && p.focusPlaceholder ? p.focusPlaceholder : p.placeholder ?? "Hôm nay tôi có thể giúp gì cho bạn?"} onFocus={() => setFoc(true)} onBlur={() => { setFoc(false); setAt(null); }} autoFocus={!p.focusPlaceholder} />
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
});

// Lời chào và tên gọi tách riêng: lời chào dịch theo giao diện, tên giữ nguyên.
function greeting(call: string): [string, string] {
  const n = call.trim().split(/\s+/).pop() || "";
  const h = new Date().getHours();
  if (h < 5) return ["Khuya rồi, bạn chưa ngủ à?", ""];
  if (h < 11) return ["Chào buổi sáng", n];
  if (h < 14) return ["Chào buổi trưa", n];
  if (h < 18) return ["Chiều tốt lành", n];
  return ["Tối rồi, mọi thứ thế nào?", ""];
}

// Lời chào luôn một dòng như khung chờ lúc mở app (.boot-greet một dòng, ui/skeleton.tsx): câu dài (lời chào lúc khuya, bản tiếng Anh, tên dài)
// ở màn hẹp thu nhỏ cỡ chữ cho vừa thay vì xuống hai dòng, giữ nguyên chiều cao dòng, nên lời chào và ô soạn tin không xê dịch so với khung chờ.
// Trước đây từ 0 giờ tới 5 giờ, ở 375px "Khuya rồi, bạn chưa ngủ à?" xuống hai dòng: lời chào lệch 15px, ô soạn tin bị đẩy xuống.
// Đo lại khi khung đổi bề rộng (ResizeObserver trên cả chữ lẫn khung) và khi chữ đổi: bộ dịch đổi chữ sau khi vẽ, đổi ngôn ngữ, đổi tên gọi.
// Chữ đã thu nhỏ (nowrap) thì đổi sang câu dài hơn không làm hộp đổi cỡ (.greet-t là mục flex min-width:0, chữ chỉ tràn bên trong), ResizeObserver
// không báo: theo dõi chính nút chữ bằng một MutationObserver nhỏ chỉ trên span này. Không dùng domwatch: thêm loại characterData ở đó thì lúc đổi
// ngôn ngữ bộ dịch nhận lại bản ghi do chính lần dịch cả trang của nó ghi ra. Vừa sẵn thì không đổi gì.
function FitLine({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      const st = el.style;
      st.fontSize = ""; st.lineHeight = ""; st.whiteSpace = "nowrap";
      const cs = getComputedStyle(el), right = box.getBoundingClientRect().right - (parseFloat(getComputedStyle(box).paddingRight) || 0);
      const avail = right - el.getBoundingClientRect().left, need = el.scrollWidth, fs = parseFloat(cs.fontSize);
      if (need <= avail + 0.5 || !fs || avail <= 0) { st.whiteSpace = ""; return; }
      const size = Math.floor(((fs * avail) / need) * 2) / 2;
      // Quá dài (tên rất dài): thu nhỏ quá thì khó đọc, để xuống dòng như trước.
      if (size < fs * 0.6) { st.whiteSpace = ""; return; }
      st.lineHeight = cs.lineHeight;
      st.fontSize = `${size}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el); ro.observe(box);
    const mo = new MutationObserver(fit);
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);
  return <span ref={ref} className={className}>{children}</span>;
}

function Toast({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (text) { setShown(text); setOut(false); return; }
    setOut(true);
    const t = setTimeout(() => setShown(""), 180);
    return () => clearTimeout(t);
  }, [text]);
  if (!shown || typeof document === "undefined") return null;
  // Gắn vào cuối <body>, trên mọi lớp phủ: thông báo (vd. lỗi kết nối connector) không bị hộp đang mở che mất.
  return createPortal(<div className={`toast ${out ? "out" : ""}`} key={shown} role="status">{shown}</div>, document.body);
}

// Phần cần cả danh sách hay nội dung đoạn chat (trang dự án, bảng lệnh ⌘K, hộp chia sẻ, chế độ giọng nói) tự đăng ký kho, chỉ trong lúc đang
// mở: Home không đăng ký danh sách đoạn chat nên mẩu chữ đang chảy không vẽ lại cả trang (blueprint B2 bước 7).
function ProjectsFor(p: Omit<React.ComponentProps<typeof ProjectsPage>, "chats">) { const chats = useChats(); return <ProjectsPage {...p} chats={chats} />; }
function ProjectFor(p: Omit<React.ComponentProps<typeof ProjectPage>, "chats">) { const chats = useChats(); return <ProjectPage {...p} chats={chats} />; }
function PaletteFor(p: Omit<React.ComponentProps<typeof CommandPalette>, "chats">) {
  const chats = useChats();
  const visible = useMemo(() => chats.filter((c) => !c.inc), [chats]);
  return <CommandPalette {...p} chats={visible} />;
}
function ShareFor(p: Omit<React.ComponentProps<typeof ShareModal>, "chat">) { const chat = useChatStore(selectCurChat); return chat ? <ShareModal {...p} chat={chat} /> : null; }
// Câu trả lời mới nhất của đoạn chat đang mở: chế độ giọng nói đọc nó (chỉ đăng ký khi đang mở chế độ này).
function VoiceFor(p: Omit<React.ComponentProps<typeof VoiceMode>, "reply">) {
  const lastAi = useChatStore((s) => selectCurChat(s)?.msgs.filter((m) => m.role === "ai").at(-1));
  return <VoiceMode {...p} reply={lastAi ? { text: lastAi.failed ? tr(chatError(lastAi.err).text) : stripAppliedNotes(lastAi.text), time: lastAi.time ?? 0 } : null} />;
}
// Dải cảnh báo trình duyệt hết chỗ: tự đăng ký trạng thái đồng bộ (đổi sau mỗi lần đẩy lên máy chủ), không làm Home vẽ lại.
function SyncWarn({ onExport }: { onExport: () => void }) {
  const st = useSyncStatus();
  if (!st.risk) return null;
  return <div className="sync-warn" role="alert"><I.InfoCircle size={16} /><span>{tr("Trình duyệt đã hết chỗ và máy chủ chưa nhận được bản mới nhất của")} {st.pending + st.tooBig} {tr("mục. Đừng đóng trang trước khi xuất dữ liệu.")}</span><button className="btn" onClick={onExport}>{tr("Xuất dữ liệu")}</button></div>;
}

export default function Home({ boot }: { boot?: BootData | null }) {
  countRender("Home");
  // Giữ khung chờ tới khi từ điển của ngôn ngữ đang dùng về (tải riêng từng thứ tiếng, i18n.tsx): không nháy chữ sai ngôn ngữ.
  // langVer: đổi ngôn ngữ thì tăng, cho deps của phần tử đã memo có chữ tr() (khối soạn tin ở đáy đoạn chat).
  const langVer = useLangVer(), langReady = langVer > 0;
  // Gói khởi động dựng sẵn ở máy chủ (app/page.tsx, blueprint A3): dùng một lần lúc mở trang thay cho /api/auth/me và các lệnh hỏi đầu.
  // Đã biết tài khoản ngay lúc hydrate: bắt đầu hỏi đoạn chat mới song song, không chờ trang dựng xong (chatsync.ts prefetchChats).
  const bootRef = useRef(boot ?? null);
  // Kho đã gieo từ gói khởi động (uid, lúc gieo): lần hỏi đầu của danh sách model / khả năng bỏ qua (xem các hiệu ứng refreshModels, loadCaps).
  const bootSeeded = useRef<{ uid: string; at: number; models: boolean; caps: boolean } | null>(null);
  const seededNow = (uid: string, k: "models" | "caps") => { const sd = bootSeeded.current; return !!sd && sd.uid === uid && sd[k] && Date.now() - sd.at < 10_000; };
  // Hỏi đoạn chat sớm, cài đặt hiển thị trên <html>, gợi ý / khung nổi / khả năng truy cập (homehooks.ts).
  usePageSetup(boot);
  // Họ tên và tên gọi đã lưu (Cài đặt → Tài khoản). Không có tên mặc định của ai: chưa có thì lấy từ tên tài khoản (xem name / call bên dưới).
  const [namePref, setName] = usePref("name", "");
  const [, setAcct] = usePref("acct", "");
  const [callPref, setCall] = usePref("call", "");
  const [, setWork] = usePref("work", "");
  const [ins, setIns] = usePref("ins", "");
  const [notif] = usePref("notif", [false, true, true, true]);
  const { caps } = useCaps();
  // Artifact đang viết: tự mở khung xem ở mọi trang (khung đoạn chat chỉ gắn ở trang chat), như trước khi tách Thread.tsx.
  useLiveArtFollow(!!caps.art);
  const [vlang] = usePref("vlang", "Vietnamese");
  usePref("uilang", "vi");
  const [vspeed] = usePref("vspeed", "Normal");
  const [vvoice] = usePref("vvoice", "");
  const [breakH] = usePref("breakH", "–");
  const [breakM] = usePref("breakM", "–");
  const [qdays] = usePref<number[]>("qdays", []);
  const [qtimes] = usePref<Record<number, [string, string]>>("qtimes", {});
  type Gc = { title: string; text: string; ok: string; fn: () => void; safe?: boolean };
  const [gc, setGc] = useState<Gc | null>(null);
  const [view, setView] = useState<View>("new");
  const [open, setOpen] = useState(true);
  const openRef = useRef(open);
  openRef.current = open;
  // Màn hình hẹp (điện thoại): thanh bên là ngăn kéo trượt đè lên nội dung, mặc định đóng, chọn mục xong tự đóng.
  const narrow = () => typeof window !== "undefined" && window.matchMedia(NARROW).matches;
  useEffect(() => { if (narrow()) setOpen(false); }, []);
  useEffect(() => startWarmPing(), []);
  // Đoạn chat, dự án, đoạn chat đang mở, lượt đang chạy, tin chờ gửi nằm ở kho ui/chatstore.client.ts (blueprint B2).
  // Các hàm đặt giá trị dùng như setState của React và không bao giờ đổi, nên lấy thẳng từ kho. Home đọc qua useChatState (cùng nhịp vẽ với useState).
  // Home không đăng ký cả danh sách đoạn chat (blueprint B2 bước 7): mẩu chữ đang chảy chỉ vẽ lại khung đoạn chat (Thread.tsx).
  // Home cần gì về đoạn chat đang mở thì lấy phần không có tin nhắn (meta); hàm xử lý đọc bản mới nhất từ kho lúc chạy (chatsRef, curChat).
  const projects = useChatState((s) => s.projects);
  const cur = useChatState((s) => s.cur);
  const meta = useChatState(selectChatMeta, sameFields);
  const { setChats, setProjects, setCur, setRunning, setQueued, setBusy: setBusyOf, patch } = useChatStore.getState();
  const chatsRef = useMemo(() => ({ get current() { return useChatStore.getState().chats; } }), []);
  const curChat = () => selectCurChat(useChatStore.getState());
  // Home gắn lại sau khi đã gỡ khỏi trang: kho về trạng thái ban đầu như useState trước đây, không mang theo dấu "đang chạy", đoạn chat đang mở
  // của lần trước. Chỉ lần gắn thật (ref mới): Fast Refresh khi sửa mã và lần chạy hiệu ứng thứ hai của StrictMode giữ ref nên không xóa gì,
  // như useState được giữ. Đặt trước mọi hiệu ứng ghi vào kho (khởi động, tải đoạn chat đã lưu).
  const freshMount = useRef(true);
  useEffect(() => { if (!freshMount.current) return; freshMount.current = false; useChatStore.getState().reset(); resetUi(); }, []);
  const curRef = useRef(cur);
  curRef.current = cur;
  // Công cụ connector đang chờ người dùng duyệt: thẻ hiện cuối cuộc trò chuyện đang trả lời.
  const [approval, setApproval] = useState<{ chat: number | null; calls: ApprovalCall[]; resolve: (d: ApprovalAnswer) => void } | null>(null);
  const approvalRef = useRef(approval);
  approvalRef.current = approval;
  // Bảng lệnh ⌘K cần mở tức thì: tải sẵn khi trang đã rảnh.
  useEffect(() => { const t = setTimeout(() => CommandPalette.preload(), 4000); return () => clearTimeout(t); }, []);
  useEffect(() => {
    setApprover((calls, conv) => new Promise((resolve) => setApproval({ chat: conv !== undefined && Number.isFinite(Number(conv)) ? Number(conv) : curRef.current, calls, resolve })));
    return () => setApprover(null);
  }, []);
  const [curProj, setCurProj] = useState<number | null>(null);
  // Dự án chọn từ khung soạn trước khi gửi tin đầu tiên của đoạn chat mới.
  const [nextProj, setNextProj] = useState<number | undefined>(undefined);
  // Đoạn chat đang có câu trả lời chạy (lượt chạy ở máy chủ, theo dõi qua SSE). Chuyển sang mục khác (Speech, Code…), mở đoạn chat khác
  // hay đoạn chat mới đều không dừng nó: câu trả lời vẫn chạy và hiện đủ khi quay lại; chỉ nút Dừng mới hủy.
  const running = useChatState((s) => s.running);
  // busy: đoạn chat đang mở có câu trả lời đang chạy (ô soạn tin thành "Nhắn thêm", nút Dừng…).
  const busy = view === "chat" && cur !== null && running.has(cur);
  const viewRef = useRef(view);
  viewRef.current = view;
  const fm = useFileMenu((m) => say(m));
  const [modal, setModal] = useState<null | "settings" | "lang" | "proj" | "search" | "share" | "upgrade" | "keys" | "logout" | "upload">(null);
  const [userMenu, setUserMenu] = useState(false);
  const [codeList, setCodeList] = usePref<CodeItem[]>("codeList", []);
  const codeListRef = useRef(codeList); codeListRef.current = codeList;
  // Cài đặt Synchro Code: không hỏi lúc mở trang (blueprint A3.5). Hỏi khi mở Code, hoặc lúc trang đã rảnh nếu máy này có phiên Code
  // (đồng bộ danh sách phiên, trạng thái đang chạy ở thanh bên vẫn như trước).
  const [cpWant, setCpWant] = useState(false);
  const cpPage = useCodePrefs(cpWant);
  // Độ rộng khung hội thoại (Cài đặt → Chung → Giao diện): áp cho khung chat và Synchro Code.
  const [tw] = usePref<"narrow" | "medium" | "wide">("threadWidth", "medium");
  useEffect(() => { document.documentElement.dataset.tw = tw; }, [tw]);
  // Trạng thái phiên Code (đang chạy / cần bạn / chờ xem lại / xong) do khung Code báo về.
  const onCodeMeta = useCallback((id: number, m: CodeMeta) => {
    setCodeList((l) => l.map((x) => (x.id === id ? { ...x, ...(m.state !== undefined ? { state: m.state, reason: m.reason ?? null } : {}), ...(m.running !== undefined ? { running: m.running } : {}), upd: Date.now(), archived: false } : x)));
  }, [setCodeList]);
  const listAt = useRef(0);
  // Tự lưu trữ phiên Code không hoạt động khi không đồng bộ (đồng bộ thì máy chủ tự làm).
  useEffect(() => {
    const days = cpPage?.archiveAfter ?? 0;
    if (!days || cpPage?.sync) return;
    const run = () => {
      const before = Date.now() - days * 86_400_000;
      setCodeList((l) => (l.some((x) => !x.archived && !x.pinned && !x.running && (x.upd ?? x.id) < before) ? l.map((x) => (!x.archived && !x.pinned && !x.running && (x.upd ?? x.id) < before ? { ...x, archived: true } : x)) : l));
    };
    run();
    const t = setInterval(run, 3600_000);
    return () => clearInterval(t);
  }, [cpPage?.archiveAfter, cpPage?.sync]); // eslint-disable-line react-hooks/exhaustive-deps
  const codePatch = (id: number, p: Partial<CodeItem>) => {
    setCodeList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
    if (cpPage?.sync) patchServerSession(id, { ...(p.title !== undefined ? { title: p.title } : {}), ...(p.pinned !== undefined ? { pinned: p.pinned } : {}), ...(p.archived !== undefined ? { archived: p.archived } : {}) });
  };
  const [codeCur, setCodeCur] = useState<number | null>(null);
  const [codeEmpty, setCodeEmpty] = useState(false);
  const [spTool, setSpTool] = usePref<SpeechTool>("spTool", "home");
  const [spOpen, setSpOpen] = usePref("spOpen", false);
  // Rời Speech sang mục khác thì tự thu gọn danh sách công cụ.
  useEffect(() => { if (view !== "speech") setSpOpen(false); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const [delId, setDelId] = useState<number | null>(null);
  const [delArts, setDelArts] = useState(false);
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
  const [greet, setGreet] = useState<[string, string]>(["", ""]);
  const [copied, setCopied] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<AuthUser | null | undefined>(undefined);
  const name = namePref.trim() || me?.profile.fullName?.trim() || me?.name || "";
  const call = callPref.trim() || me?.profile.nickname?.trim() || shortName(name);
  // Màn chờ lúc mở app: mở thẳng một đoạn chat (#c=…) thì vùng chính chờ dạng tin nhắn thay vì lời chào (đặt sau khi gắn để khớp bản dựng ở máy chủ).
  const [bootChat, setBootChat] = useState(false);
  useEffect(() => { if (/^#c=/.test(location.hash)) setBootChat(true); }, []);
  // Đã qua màn chờ: bỏ dấu "mở thẳng đoạn chat" của lệnh trong <head> (layout.tsx), lần màn chờ sau (đổi tài khoản…) theo bootChat.
  useEffect(() => { if (me !== undefined) document.documentElement.removeAttribute("data-boot-chat"); }, [me]);
  // Đồng bộ danh sách phiên Code với máy chủ (Cài đặt → Synchro Code → Đồng bộ phiên): phiên mở ở thiết bị khác, trạng thái mới,
  // phiên đã xóa / lưu trữ ở nơi khác. Lần đầu đẩy các phiên chỉ có ở thiết bị này lên.
  useEffect(() => {
    if (!me || !cpPage?.sync) return;
    let stop = false;
    const tick = async () => {
      const j = await listServerSessions(listAt.current ? listAt.current - 3000 : 0);
      if (!j || stop || !j.sync) return;
      const first = !listAt.current;
      listAt.current = j.now;
      const remote = new Map(j.sessions.map((x) => [x.id, x]));
      for (const x of j.sessions) if (x.deleted) ls.remove("codeS:" + x.id);
      setCodeList((l) => {
        let next = l.filter((x) => !remote.get(x.id)?.deleted);
        for (const x of j.sessions) {
          if (x.deleted) continue;
          const item: CodeItem = { id: x.id, title: x.title || next.find((y) => y.id === x.id)?.title || "Phiên code", pinned: x.pinned, archived: x.archived, state: x.state, reason: x.reason, running: x.running, upd: x.touched, pr: x.pr };
          const i = next.findIndex((y) => y.id === x.id);
          if (i < 0) next = [item, ...next]; else next = next.map((y, k) => (k === i ? { ...y, ...item } : y));
        }
        return next;
      });
      if (first) for (const x of codeListRef.current) if (!remote.has(x.id)) {
        let data: Record<string, unknown> | null = null;
        try { data = JSON.parse(ls.get("codeS:" + x.id) ?? "null"); } catch {}
        if (data) pushSession(x.id, x.title, data, undefined, !!x.pinned);
      }
    };
    // Lần đầu lùi lại sau khi trang đã vẽ (lấy cả danh sách, có thể hơn 100 KB). Tab ẩn không hỏi; ngoài mục Code hỏi thưa, về lại tab thì hỏi ngay.
    let at = 0;
    const run = () => { at = Date.now(); void tick(); };
    // Máy chưa có danh sách nào (thiết bị mới): lấy ngay, cùng lúc đoạn chat về, để mục Code không chen vào đẩy danh sách xuống sau 3 giây.
    const first = setTimeout(run, viewRef.current === "code" || !codeListRef.current.length ? 0 : 3000);
    const t = setInterval(() => { if (!document.hidden && (viewRef.current === "code" || Date.now() - at >= 60_000)) run(); }, 15_000);
    window.addEventListener("focus", run);
    return () => { stop = true; clearTimeout(first); clearInterval(t); window.removeEventListener("focus", run); };
  }, [me?.id, cpPage?.sync]); // eslint-disable-line react-hooks/exhaustive-deps
  const [providers, setProviders] = useState<Providers>();
  const [signupOpen, setSignupOpen] = useState(true);
  // Máy chủ chưa có khóa ElevenLabs: thành viên không thấy mục Speech (không có gì để dùng, và họ không thêm khóa được); quản trị viên vẫn thấy để biết phải thêm khóa.
  const [speechReady, setSpeechReady] = useState(true);
  const [authLeaving, setAuthLeaving] = useState(false);
  // Phim giới thiệu cho tài khoản mới (ui/introfilm.tsx): giữ màn đăng nhập tới khi phim phủ kín màn hình. Vào app (từ phim hoặc từ lời
  // chào khi đăng nhập lại): logo bay về chỗ, trang chủ lắp lại quanh đó (ui/handoff.ts); reveal giấu logo thật của app tới khi bản sao
  // bay tới — "film": cả chữ "synchro" ở đầu thanh bên (chữ của khung cuối phim bay về đó), "login": chỉ biểu tượng cạnh lời chào.
  const [intro, setIntro] = useState(false);
  const [authHold, setAuthHold] = useState(false);
  const [reveal, setReveal] = useState<"" | "film" | "login">("");
  // Hồ sơ trên máy chủ là nguồn chính; các ô trong Cài đặt → Tài khoản đọc từ đây.
  const syncProfile = (u: AuthUser) => {
    setAcct(u.email);
    if (u.profile.fullName) setName(u.profile.fullName);
    const c = u.profile.nickname || u.profile.fullName?.trim().split(/\s+/).pop();
    if (c) setCall(c);
    if (u.profile.occupation) setWork(u.profile.occupation);
    // Hướng dẫn cho Synchro trước đây chỉ lưu trong trình duyệt (model không nhận được): đưa lên máy chủ một lần cho tài khoản này.
    const local = (() => { try { return String(JSON.parse(ls.get("p:ins") || '""') ?? ""); } catch { return ""; } })();
    if (!u.profile.instructions && local.trim() && !ls.get("p:insSynced")) {
      fetch("/api/auth/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instructions: local }) })
        .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.user) { ls.set("p:insSynced", "true"); setMe(j.user); } }).catch(() => {});
    } else {
      ls.set("p:insSynced", "true");
      setIns(u.profile.instructions ?? "");
    }
  };
  const flushDirtyRef = useRef<() => void>(() => {});
  // Dự án, model đã chọn… của tài khoản đang dùng (localStorage đã tách theo tài khoản).
  const loadPrefs = () => {
    try {
      setProjects(JSON.parse(ls.get("projects") || "[]"));
      setModel(legacyModel(ls.get("model") ?? "") ?? "");
      setBanner(ls.get("banner") !== "0");
    } catch {}
  };
  // Đoạn chat của tài khoản: kho của thiết bị (IndexedDB, ui/chatload.ts), đọc bất đồng bộ; thanh bên hiện khung chờ tới khi có chỉ mục.
  // Đoạn chat tạo trong lúc chờ (gửi tin ngay khi mở trang) được giữ, xếp trên các đoạn đã lưu. Xong thì loaded, rồi đọc dần thân ở nền.
  const startChats = (uid: string) => {
    void loadChats(uid, openWant.current !== null ? [openWant.current] : []).then((list) => {
      if (!list || userScope() !== uid) return;
      setChats((cs) => { if (!cs.length) return list; const have = new Set(list.map((c) => c.id)); const extra = cs.filter((c) => !have.has(c.id)); return extra.length ? [...extra, ...list] : list; });
      setLoaded(true);
      void hydrateAll();
    });
  };
  // Chuyển sang vùng dữ liệu của tài khoản u: mỗi tài khoản có chat, dự án, cài đặt, ảnh đại diện riêng.
  const enterAccount = (u: AuthUser) => {
    if (userScope() === u.id) return;
    flushDirtyRef.current();
    setUserScope(u.id);
    if (u.isAdmin) adoptLegacyData(u.id);
    reloadPrefs();
    resetCodePrefs(); clearJsonCache();
    listAt.current = 0;
    // Không để đoạn chat của tài khoản trước hiện lại trong lúc đọc kho của tài khoản này.
    setChats([]); setLoaded(false);
    loadPrefs();
    startChats(u.id);
    setCur(null); setView("new");
  };
  // Mở app: gói khởi động hoặc /api/auth/me, tự thử lại khi chưa kết nối được; phiên hết hạn khi đang mở (homehooks.ts useBoot).
  const { bootErr, retry: bootRetry, expired, setExpired } = useBoot({ boot: bootRef.current, me, setMe, apply: (j, b) => {
    setProviders(j.providers); setSignupOpen(j.signupOpen !== false); setSpeechReady(j.speechReady !== false);
    if (j.user) {
      enterAccount(j.user);
      // Gieo các kho của trang từ gói khởi động (sau enterAccount: kho nào cũng theo vùng dữ liệu của tài khoản đang mở).
      if (b) { bootSeeded.current = { uid: j.user.id, at: Date.now(), models: seedModels(b.models), caps: seedCaps(b.caps) }; seedMeta(b.studios); seedInboxCount(b.inboxCount); seedCodePrefs(b.codePrefs); }
      syncProfile(j.user);
    }
    // Lần thử lại về sau khi khách vừa đăng nhập xong ở màn hình đăng nhập: không ghi đè.
    setMe((m) => (m && !j.user ? m : j.user));
  } });
  const [editProj, setEditProj] = useState<number | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    // Câu dài (lời giải thích lỗi kết nối) cần nhiều thời gian đọc hơn.
    toastT.current = setTimeout(() => setToast(""), Math.min(10_000, Math.max(2400, m.length * 55)));
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

  // Mở trang chưa biết tài khoản (khách, chưa có gói khởi động): dữ liệu của vùng "anon". Đã vào tài khoản (enterAccount chạy trước, trong
  // useBoot) thì đoạn chat đang được đọc từ kho, loaded bật khi xong.
  useEffect(() => {
    if (userScope() === "anon") {
      try { setChats(JSON.parse(ls.get("chats") || "[]")); } catch {}
      loadPrefs();
      setLoaded(true);
    }
    setThemeS(localStorage.getItem("theme") || "light");
    setGreet(greeting(call));
  }, []);
  useEffect(() => { if (loaded) setGreet(greeting(call)); }, [call, loaded]);
  useEffect(() => { setActiveModel(model); }, [model]);
  // Đổi model hoặc nỗ lực: khởi động sẵn đúng lựa chọn mới (chạy sau khi nỗ lực đã được hạ theo giới hạn).
  const [effortPick] = usePref("effort", "auto");
  useEffect(() => { if (me) warmChoice(); }, [model, effortPick, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Danh sách model đổi (quản trị viên thêm khóa, đổi quyền) → chọn lại model hợp lệ.
  // Lần đầu sau gói khởi động: danh sách model và khả năng đã gieo, không hỏi lại (bootSeeded); các lần sau như cũ.
  useEffect(() => { if (me && !seededNow(me.id, "models")) refreshModels(); }, [me]);
  useEffect(() => { if (me && !seededNow(me.id, "caps")) loadCaps(); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === "code") setCpWant(true); }, [view]);
  // Cài đặt Code thường đã gieo từ gói khởi động (đồng bộ phiên chạy ngay, kể cả thiết bị mới chưa có phiên nào). Không có gói (dựng lỗi,
  // tài khoản vừa đăng nhập ở màn đăng nhập): tự tải sau 5 giây dù máy này đã có phiên Code hay chưa, để phiên của thiết bị khác vẫn về.
  useEffect(() => { if (!me) return; const t = setTimeout(() => setCpWant(true), 5000); return () => clearTimeout(t); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!models.loaded) return;
    const f = fitModel(model, models);
    if (f === model) return;
    // Model đã chọn tay bị hãng gỡ, hoặc dòng của nó đã có bản mới hơn (không còn ở bộ chọn): báo một lần đã chuyển sang bản mới nhất cùng dòng
    // (lựa chọn mới được lưu nên không báo lại).
    const rep = models.replaced?.[model];
    if (rep && rep.to === f) say(rep.why === "old" ? `${rep.name} đã có bản mới hơn nên Synchro đã chuyển sang ${modelName(f)}` : `${rep.name} không còn dùng được nên Synchro đã chuyển sang ${modelName(f)}`);
    setModel(f);
  }, [models, model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me && view === "code" && !me.perms.features.code) setView("new");
    if (me && view === "speech" && (!me.perms.features.speech || (!speechReady && !me.isAdmin))) setView("new");
    if (me && view === "customize" && !me.perms.features.skills) setView("new");
    if (me && (view === "projects" || view === "project") && !me.perms.features.projects) setView("new");
  }, [me, model, view, speechReady]);
  // Xóa bộ não (Cài đặt → Bộ não): quên luôn bộ nhớ của các dự án (lưu trong trình duyệt).
  useEffect(() => {
    const forget = () => setProjects((ps) => ps.map((p) => (p.mem?.length ? { ...p, mem: [] } : p)));
    window.addEventListener("synchro:forget", forget);
    return () => window.removeEventListener("synchro:forget", forget);
  }, []);
  // Ảnh dựng nền (G4) vừa về hay không dựng được: khung xem trước / thẻ ảnh phát sự kiện (artdoc.ts noteGenSettled), báo một dòng (W23-2).
  useEffect(() => {
    const on = (e: Event) => say((e as CustomEvent<{ ok?: boolean }>).detail?.ok ? tr("Ảnh dựng nền đã xong và đã thay vào artifact.") : tr("Không dựng được ảnh nền; artifact vẫn giữ khung giữ chỗ."));
    window.addEventListener(GEN_IMG_EVENT, on);
    return () => window.removeEventListener(GEN_IMG_EVENT, on);
  }, [say]);
  // Thẻ "chưa tạo được ảnh" trong nhật ký làm việc: mở thẳng Cài đặt → Providers.
  useEffect(() => {
    const open = () => { setSettingsTab("Providers"); setModal("settings"); };
    window.addEventListener("synchro:providers", open);
    return () => window.removeEventListener("synchro:providers", open);
  }, []);
  const retryRef = useRef<(avoid?: string) => void>(() => {});
  // Thẻ đếm ngược của connector bị giới hạn tốc độ: hết giờ, nút "Thử lại ngay" gửi lại tin vừa rồi của đoạn chat đang mở.
  useEffect(() => {
    const again = () => retryRef.current();
    window.addEventListener("synchro:retry", again);
    return () => window.removeEventListener("synchro:retry", again);
  }, []);
  // Đoạn chat và dự án theo tài khoản: đồng bộ với máy chủ, chuyển dần từ trình duyệt (chatsync.ts).
  const chatSync = useChatSync({ uid: me?.id ?? null, loaded, running, setChats, setProjects });
  const chatSyncRef = useRef(chatSync);
  chatSyncRef.current = chatSync;
  // Lưu đoạn chat: gộp ghi, không ghi toàn bộ lịch sử mỗi khung hình lúc chữ đang chảy. Có tin mới, lượt chạy mới thì ghi gần như ngay
  // (tải lại trang vẫn nối được vào lượt đó); đang chảy chữ thì vài giây một lần; xong lượt, rời trang thì ghi ngay.
  const saveT = useRef<{ t: ReturnType<typeof setTimeout>; at: number } | null>(null);
  const savedSig = useRef("");
  const saveSig = () => `${chatsRef.current.length}:${chatsRef.current.reduce((n, c) => n + c.msgs.length, 0)}:${runs.current.size}`;
  const flushChats = useCallback(() => {
    if (saveT.current) clearTimeout(saveT.current.t);
    saveT.current = null;
    savedSig.current = saveSig();
    chatSyncRef.current?.saveChats(chatsRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const flushDirty = useCallback(() => { if (saveT.current) flushChats(); }, [flushChats]);
  flushDirtyRef.current = flushDirty;
  // Theo dõi kho thay cho hiệu ứng [chats] (Home không vẽ lại theo từng mẩu chữ nữa): mỗi lần danh sách đổi thì hẹn lần ghi như trước.
  useEffect(() => {
    if (!loaded) return;
    const schedule = () => {
      const d = saveSig() !== savedSig.current ? 300 : useChatStore.getState().running.size ? 5000 : 800, at = Date.now() + d;
      if (saveT.current && saveT.current.at <= at) return;
      if (saveT.current) clearTimeout(saveT.current.t);
      saveT.current = { t: setTimeout(flushChats, d), at };
    };
    schedule();
    return useChatStore.subscribe((st, prev) => { if (st.chats !== prev.chats) schedule(); });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const runN = running.size, lastRunN = useRef(runN);
  useEffect(() => { if (runN < lastRunN.current) flushDirty(); lastRunN.current = runN; }, [runN, flushDirty]);
  const wasRunning = useRef<ReadonlySet<number>>(running);
  useEffect(() => {
    const id = curRef.current;
    if (id !== null && viewRef.current === "chat" && wasRunning.current.has(id) && !running.has(id)) {
      const m = chatsRef.current.find((c) => c.id === id)?.msgs.at(-1);
      if (m?.role === "ai") setSayAt(m.failed ? tr("Câu trả lời chưa hoàn thành") : m.stopped ? tr("Đã dừng · giữ lại phần đã viết") : `${tr("Câu trả lời đã hoàn tất.")} ${m.text.replace(/```[\s\S]*?(```|$)|<artifact[\s\S]*?(<\/artifact>|$)/g, " ").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 200)}`);
    }
    wasRunning.current = running;
  }, [running]);
  // Rời trang / ẩn tab: ghi nhật ký nhỏ các đoạn chưa lưu xong (giao dịch IndexedDB có thể bị hủy cùng trang, chatload.ts) rồi lưu ngay.
  useEffect(() => {
    const leave = () => { writeJournal(); flushDirty(); };
    const hide = () => { if (document.visibilityState === "hidden") leave(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", hide); };
  }, [flushDirty]);
  useEffect(() => {
    if (!loaded) return;
    chatSync.saveProjects(projects);
    ls.set("model", model);
    ls.set("banner", banner ? "1" : "0");
  }, [projects, model, banner, loaded]);

  const setTheme = (t: string) => {
    setThemeS(t);
    localStorage.setItem("theme", t);
    document.documentElement.dataset.theme = t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  };
  // Màu thanh trình duyệt / thanh trạng thái điện thoại theo giao diện đang dùng trong app (Carbon / Ivory của bộ nhận diện).
  useEffect(() => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#111210" : "#EEECE5"));
  }, [theme]);

  // Đoạn chat đang mở nằm trong địa chỉ trang (#c=<mã>, không tới máy chủ): F5 mở lại đúng đoạn đó, kể cả khi câu trả lời còn đang chạy (lượt tự nối lại bên dưới).
  // Trước đây tải lại luôn về trang chủ, trông như mất câu trả lời nên người dùng gửi lại và tốn hạn mức. Đoạn chat ẩn danh không ghi vào địa chỉ.
  const openWant = useRef<number | null>(typeof location === "undefined" ? null : Number(/^#c=(\d{1,16})$/.exec(location.hash)?.[1] ?? 0) || null);
  // Chỉ trong lúc chờ đoạn chat của #c= (lúc mở app): Home theo danh sách đoạn chat để thử lại mỗi lần danh sách đổi; xong thì thôi theo.
  const waitChats = useChatState((s) => (openWant.current === null ? null : s.chats));
  useEffect(() => {
    const id = openWant.current;
    if (id === null || !loaded || !me) return;
    // Người dùng đã tự đi nơi khác trong lúc chờ.
    if (view !== "new" || cur !== null) { openWant.current = null; return; }
    if (chatsRef.current.some((c) => c.id === id && !c.inc)) { openWant.current = null; setCur(id); setView("chat"); return; }
    // Chưa có ở trình duyệt này: đợi đồng bộ về một lúc (thiết bị mới), không có thì thôi.
    const t = setTimeout(() => { if (openWant.current === id) { openWant.current = null; history.replaceState(null, "", location.pathname + location.search); } }, 8000);
    return () => clearTimeout(t);
  }, [waitChats, loaded, me, view, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  // U6: mục bị tắt theo quyền (feature flags) coi như địa chỉ lạ — không ghi vào #v= và không mở khi gặp link #v= đó.
  const viewAllowed = useCallback((v: View): boolean => {
    if (!me) return true; // chưa biết quyền: cho qua, lớp bảo vệ ở trên sẽ chỉnh lại khi biết
    const f = me.perms.features;
    if (v === "code") return f.code !== false;
    if (v === "speech") return f.speech !== false && (speechReady || !!me.isAdmin);
    if (v === "customize") return f.skills !== false;
    if (v === "projects" || v === "project") return f.projects !== false;
    if (v === "artifacts") return caps.art !== false;
    return true; // autopilot, brain, new, chat
  }, [me, speechReady, caps.art]);
  // Địa chỉ mà trạng thái hiện tại nên có: Cài đặt (#s=) ưu tiên, rồi đoạn chat không ẩn danh (#c=), rồi mục (#v=).
  const curHash = (): string => {
    if (modal === "settings") return settingsHash(settingsTab);
    if (view === "chat" && cur !== null && meta && !meta.inc) return `#c=${cur}`;
    const h = HASH_VIEW[view];
    return h && viewAllowed(view) ? `#v=${h}` : "";
  };
  // Áp địa chỉ lúc mở app (deep-link), chỉ sau khi đoạn chat + dự án đã tải (loaded) để mở đúng; #v= cần biết quyền (me).
  const [bootDone, setBootDone] = useState(false);
  useEffect(() => {
    if (bootDone || !loaded) return;
    const h = typeof location === "undefined" ? "" : location.hash;
    if (/^#c=/.test(h)) { setBootDone(true); return; } // openWant lo phần đoạn chat ở trên
    if (/^#s=/.test(h)) { setSettingsTab(decodeSettingsTab(h.slice(3))); setModal("settings"); setBootDone(true); return; } // mục lạ: Settings tự về General
    const mv = /^#v=([a-z]+)$/.exec(h);
    if (mv) {
      if (!me) return; // chờ biết quyền
      const v = VIEW_OF_HASH[mv[1]];
      if (v && viewAllowed(v)) { setView(v); if (v === "projects") setCurProj(null); }
      setBootDone(true); return;
    }
    setBootDone(true);
  }, [loaded, me, bootDone, viewAllowed]);
  // Trạng thái → địa chỉ: đổi mục / mở đoạn chat = một mục lịch sử (pushState) để Back quay lại trang trước.
  // Mở Cài đặt cũng push (Back đóng Cài đặt, về lại đoạn chat); đổi mục trong Cài đặt chỉ replace; đóng Cài đặt về trang đã mở nó thì
  // history.back() để bỏ mục #s= vừa thêm. Lần ghi đầu sau khi mở app thì replace (địa chỉ lạ không ở lại trong lịch sử). Xem hashnav.ts.
  const settingsFrom = useRef<string | null>(null); // địa chỉ trước khi mở Cài đặt, chỉ khi chính app đã push mục #s=
  const firstSync = useRef(true);
  useEffect(() => {
    if (!loaded || !bootDone || openWant.current !== null) return;
    const want = curHash(), cur = location.hash;
    const step = hashStep(cur, want, settingsFrom.current, firstSync.current);
    firstSync.current = false;
    if (step === "none") return;
    if (!want.startsWith("#s=")) settingsFrom.current = null;
    if (step === "back") { history.back(); return; } // popstate về đúng địa chỉ want, trạng thái đã khớp
    const url = location.pathname + location.search + want;
    if (step === "push") { if (want.startsWith("#s=")) settingsFrom.current = cur; history.pushState(null, "", url); }
    else history.replaceState(null, "", url);
  }, [view, cur, meta?.inc, modal, settingsTab, loaded, bootDone, me, speechReady, caps.art]); // eslint-disable-line react-hooks/exhaustive-deps
  // Địa chỉ → trạng thái: nút Back / Forward (popstate). Đóng Cài đặt khi địa chỉ không còn là #s=.
  useEffect(() => {
    const onPop = () => {
      const h = location.hash;
      if (/^#s=/.test(h)) { setSettingsTab(decodeSettingsTab(h.slice(3))); setModal("settings"); return; }
      settingsFrom.current = null; // đã rời mục #s= bằng Back / Forward
      setModal((m) => (m === "settings" ? null : m));
      if (/^#c=/.test(h)) { const id = Number(/^#c=(\d{1,16})$/.exec(h)?.[1] ?? 0) || null; if (id !== null && chatsRef.current.some((c) => c.id === id && !c.inc)) { setCur(id); setView("chat"); } return; }
      const mv = /^#v=([a-z]+)$/.exec(h);
      if (mv) {
        const v = VIEW_OF_HASH[mv[1]];
        if (v && viewAllowed(v)) { setCur(null); setCurProj(null); setView(v); }
        // Địa chỉ cũ (#v=inbox) bấm khi đang ở đúng trang đó: view không đổi nên hiệu ứng ghi địa chỉ không chạy lại,
        // phải tự đổi sang địa chỉ mới ở đây.
        const canon = v && HASH_VIEW[v];
        if (canon && canon !== mv[1]) history.replaceState(history.state, "", `#v=${canon}`);
        return;
      }
      setCur(null); setView("new"); // địa chỉ trống: về trang Mới
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [viewAllowed]);
  // Đoạn chat đang chờ bạn duyệt công cụ: ở ngoài đoạn chat đó vẫn phải thấy, quá 10 phút không trả lời thì công cụ bị từ chối và model làm tiếp.
  // So bằng chuỗi mã (selectNeedKey): chữ đang chảy không đổi chuỗi nên Home không vẽ lại.
  const needKey = useChatState(selectNeedKey);
  const needYou = useMemo(() => {
    const out = new Set<number>(needKey ? needKey.split(",").map(Number) : []);
    if (approval?.chat !== null && approval?.chat !== undefined) out.add(approval.chat);
    return out;
  }, [needKey, approval]);
  const needSeen = useRef<ReadonlySet<number>>(new Set());
  // Lời báo cho trình đọc màn hình: câu trả lời xong, cần duyệt. Nằm ngoài chữ đang chảy nên không đọc từng chữ.
  const [sayAt, setSayAt] = useState("");
  // Đổi đoạn chat / trang: bỏ lời báo của đoạn trước, để vùng trạng thái không còn giữ câu trả lời cũ (trình đọc màn hình đọc lại khi duyệt trang).
  useEffect(() => { setSayAt(""); }, [cur, view]);
  useEffect(() => {
    const fresh = [...needYou].filter((id) => !needSeen.current.has(id));
    needSeen.current = needYou;
    for (const id of fresh) {
      const c = chatsRef.current.find((x) => x.id === id), name = c?.title ?? "Synchro";
      const open = viewRef.current === "chat" && curRef.current === id;
      setSayAt(`${tr("Đang chờ bạn duyệt")}: ${name}`);
      if (document.hidden && notif[0] && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Synchro", { body: `${tr("Đang chờ bạn duyệt")}: ${name}`, tag: `ask-${id}` });
      else if (!open && !document.hidden) say(`${tr("Đang chờ bạn duyệt")}: ${name}`);
    }
  }, [needYou]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tiêu đề thẻ trình duyệt theo màn hình đang xem: nhiều thẻ vẫn phân biệt được, trình đọc màn hình có tín hiệu đổi trang. Đoạn chat ẩn danh không lộ tên lên thẻ.
  const VIEW_TITLE: Partial<Record<View, string>> = { projects: "Dự án", project: "Dự án", artifacts: "Artifacts", customize: "Kho kỹ năng", code: "Code", speech: "Speech", autopilot: "Autopilot", brain: "Bộ não" };
  const tabName = view === "chat" ? (meta && !meta.inc ? meta.title : "") : tr(VIEW_TITLE[view] ?? "");
  useEffect(() => {
    const n = needYou.size;
    document.title = `${n ? `(${n}) ` : ""}${tabName ? `${tabName} · ` : ""}Synchro`;
  }, [needYou.size, tabName]);
  // Khung bên cạnh đoạn chat (artifact, tệp, trình duyệt) nằm ở usePanelUi: khung đoạn chat (Thread.tsx) vẽ và báo lại khung nào đang mở.
  const { setArtSel, setFileSel, setBrwFor, setBrwPrefer, setArtFull } = usePanelUi.getState();
  const panel = usePanelUi((s) => s.panel), prodN = usePanelUi((s) => s.prodN), artFull = usePanelUi((s) => s.artFull), brwFor = usePanelUi((s) => s.brwFor);
  // Trình duyệt cạnh đoạn chat (như khung trình duyệt của Synchro Code): nút quả địa cầu ở đầu mọi đoạn chat mở / đóng khung;
  // khung tự mở khi Synchro bắt đầu dùng trình duyệt (của Synchro, hoặc Chrome của bạn qua tiện ích), và đoạn chat đó được đánh
  // dấu (chấm trên nút quả địa cầu). brwFor: đoạn chat đang mở khung.
  const [brw, setBrw] = useState<BrwState | null>(null);
  // Trạng thái trình duyệt chỉ cần cho nút / khung trình duyệt ở đoạn chat đang mở: không hỏi lúc mở trang (blueprint A3.5), hỏi một lần
  // cho mỗi tài khoản khi lần đầu mở một đoạn chat hay khi khung trình duyệt được mở.
  const brwAsked = useRef("");
  const needBrw = view === "chat" || brwFor !== null;
  useEffect(() => {
    if (!me || !needBrw || brwAsked.current === me.id) return;
    brwAsked.current = me.id;
    fetch("/api/browser").then((r) => (r.ok ? r.json() : null)).then((j) => j && setBrw(j)).catch(() => { brwAsked.current = ""; });
  }, [me?.id, needBrw]); // eslint-disable-line react-hooks/exhaustive-deps
  // Synchro vừa bắt đầu làm ở trình duyệt nào (của Synchro / Chrome của bạn): khung trình duyệt chuyển sang đó.
  const openBrowser = (ev: RunEv, chatId: number) => {
    if (ev.kind !== "ui" || !ev.text.startsWith("browser")) return;
    setBrwPrefer((p) => ({ v: ev.text === "browser:user" ? "user" : "synchro", n: (p?.n ?? 0) + 1 }));
    setChats((cs) => cs.map((c) => (c.id === chatId && !c.browser ? { ...c, browser: true } : c)));
    // Câu trả lời đang chạy ở nền (người dùng xem đoạn chat khác): không đóng khung đang mở của họ; quay lại thì mở bằng nút trình duyệt.
    if (chatId !== curRef.current) return;
    setArtSel(null); setFileSel(null); setBrwFor(chatId);
  };
  const brwOk = !!(brw?.available || brw?.ext?.allowed);
  const panelOpen = view === "chat" && panel !== null;
  const brwShow = view === "chat" && panel === "brw";
  useEffect(() => { if (!panelOpen) setArtFull(false); }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Laptop: khung xem mở cạnh chat thì ô soạn tin từng bị ép còn vài chục px. Tự thu bảng đoạn chat (thanh điều hướng vẫn còn) cho đủ chỗ, đóng khung thì mở lại.
  const sideAuto = useRef(false);
  useEffect(() => {
    if (narrow()) return;
    if (panelOpen && open && window.innerWidth < 1360) { sideAuto.current = true; setOpen(false); }
    else if (!panelOpen && sideAuto.current) { sideAuto.current = false; setOpen(true); }
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Theo từng đoạn chat: mã lượt chạy ở máy chủ, và số thế hệ của lần theo dõi hiện tại (Dừng hay chạy lại thì số cũ hết hiệu lực,
  // mọi cập nhật đến muộn của lần trước bị bỏ qua).
  const runs = useRef(new Map<number, string>());
  const gens = useRef(new Map<number, number>());
  const genSeq = useRef(0);
  // Tin nhắn gửi trong lúc đang chạy: "steer" đang chờ ghép vào lượt, "later" gửi thành lượt mới khi xong.
  const queued = useChatState((s) => s.queued);
  const onSteer = async (text: string, later: boolean) => {
    const chatId = cur;
    if (chatId === null) return;
    const qid = Date.now() + Math.random();
    const run = runs.current.get(chatId);
    if (later || !run) { setQueued((q) => [...q, { id: qid, chat: chatId, text, mode: "later" }]); return; }
    setQueued((q) => [...q, { id: qid, chat: chatId, text, mode: "steer" }]);
    if (!(await steerRun(run, text))) setQueued((q) => q.map((x) => (x.id === qid ? { ...x, mode: "later" } : x)));
  };
  // Dừng câu trả lời của một đoạn chat (mặc định: đoạn đang mở). user = false: câu trả lời vừa hiện xong, chỉ dọn trạng thái.
  // Mặc định (nút Dừng, xóa đoạn chat): hủy luôn lượt ở máy chủ để không tốn thêm token, phần đã viết được giữ lại và đánh dấu đã dừng
  // (lượt sau model biết câu trả lời này chưa hoàn chỉnh). Chuyển mục hay đổi đoạn chat không gọi hàm này.
  const stop = (user: unknown = true, id: number | null = curRef.current) => {
    if (id === null) return;
    if (approvalRef.current && approvalRef.current.chat === id) { approvalRef.current.resolve({ decisions: {} }); setApproval(null); }
    gens.current.delete(id);
    setBusyOf(id, false);
    const run = runs.current.get(id);
    if (user !== false && run) cancelRun(run);
    runs.current.delete(id);
    patch(id, (ms) => ms.map((m) => (m.done ? m : { ...m, done: true, prog: undefined, ...(user !== false && m.role === "ai" ? { stopped: true, run: undefined, dur: Date.now() - m.time } : {}) })));
  };
  const capsRef = useRef(caps);
  capsRef.current = caps;
  const [artRefresh, setArtRefresh] = useState(0);
  const [artQ, setArtQ] = useState("");
  const [czTab, setCzTab] = useState<CzTab>("hub");
  // Plugin gắn với các nút studio (Thiết kế / Trình bày / Tài liệu): tên và số skill để hiện trên nút.
  const studios = useStudios(!!me);
  const openPlugins = () => { setCzTab("hub"); setView("customize"); };
  const projsRef = useRef<Project[]>([]);
  projsRef.current = projects;
  const workOf = (x?: Msg) => (x?.role === "ai" ? { parts: x.parts, plan: x.plan, seq: x.seq } : {});
  // avoid: "Chạy lại bằng model khác" dưới câu trả lời của chế độ Tự động — lượt này vẫn Tự động nhưng tránh model đó. Truyền theo lượt, không qua biến dùng chung:
  // lượt dừng sớm (tệp đính kèm không đọc được) không được để lại model cần tránh cho tin nhắn sau, ở đoạn chat khác.
  // rejected: thẻ tệp báo lỗi của lượt này (tên, loại, lý do): máy chủ báo cho model để câu trả lời nói rõ tệp nào không đọc được và vì sao.
  const streamReply = async (id: number, text: string, hist?: LLMMsg[], pid?: number, studio?: Chat["studio"], picked?: string[], avoid?: string, rejected?: Rejected[]) => {
    const gen = ++genSeq.current;
    gens.current.set(id, gen);
    setBusyOf(id, true);
    const t0 = Date.now();
    // Lần theo dõi này còn hiệu lực (chưa bị Dừng, chưa có lượt mới của cùng đoạn chat).
    const mine = () => gens.current.get(id) === gen;
    const meta: Partial<RunMeta> = {};
    const pr = pid !== undefined ? projsRef.current.find((x) => x.id === pid) : undefined;
    const history = (hist ?? [{ role: "user" as const, content: text }]).slice(-HISTORY_LIMIT);
    const system = pr ? buildSystemPrompt(pr, text) : "Bạn là một trợ lý AI hữu ích.";
    let reply: string;
    let usedSk: string[] = [], usedTl: string[] = [], libs: LibUse[] = [], via: string | null = null, viaTask: string | undefined;
    let outs: Msg["outs"] = [], trace: Msg["trace"] = [], cancelled = false, failed = false, said = "", notice: Msg["notice"], webs: Msg["webs"] = [];
    // Chữ đến theo thời gian thực, gộp lại vẽ khoảng 20 lần mỗi giây (deltaSink).
    const sink = deltaSink(mine, (t) => patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), { ...ms[ms.length - 1], text: t, prog: undefined }] : ms)));
    const onDelta = sink.push;
    // Bước của lượt: lời dẫn (chuyển từ chữ đang viết sang nhật ký), công cụ, kết quả, danh sách việc; tin nhắn thêm đã ghép
    // thì đóng phần trả lời trước, hiện tin người dùng, phần tiếp theo của lượt nằm ở câu trả lời mới bên dưới.
    const onEvent = (ev: RunEv) => {
      if (!mine()) return;
      openBrowser(ev, id);
      if (ev.kind === "steer") {
        patch(id, (ms) => {
          const last = ms[ms.length - 1];
          if (!last || last.role !== "ai" || (last.seq ?? 0) >= ev.seq) return ms;
          return [...ms.slice(0, -1), { ...last, done: true, prog: undefined, run: undefined, seq: ev.seq }, { role: "user", text: ev.text, time: Date.now(), steer: true }, { role: "ai", text: "", time: Date.now(), run: last.run, seq: ev.seq }];
        });
        setQueued((q) => { const k = q.findIndex((x) => x.chat === id && x.mode === "steer" && x.text === ev.text); return k < 0 ? q : q.filter((_, j) => j !== k); });
        return;
      }
      if (ev.kind === "say") sink.drop();
      patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), { ...ms[ms.length - 1], ...applyEvent(ms[ms.length - 1], ev), ...(ev.kind === "say" ? { text: "" } : {}) }] : ms));
    };
    try {
      // Skill hai câu trả lời gần nhất đã dùng: lượt tiếp nối (sửa, thêm, đổi) đọc lại để giữ cùng phong cách.
      const recentSkills = [...new Set((chatsRef.current.find((c) => c.id === id)?.msgs ?? []).filter((m) => m.role === "ai" && (m.skills?.length || m.libs?.length)).slice(-2)
        .flatMap((m) => [...(m.libs ?? []).flatMap((l) => l.skills), ...(m.skills ?? [])]))];
      // Lượt chạy bền: máy chủ trả lời ở nền; mã lượt lưu vào tin nhắn để tải lại trang vẫn nhận được kết quả.
      const lastMsg = (f: (m: Msg) => Msg) => patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), f(ms[ms.length - 1])] : ms));
      reply = await callLLM(system, history, 1500, undefined, true, { project: pid, conv: id, studio: studio ?? chatsRef.current.find((c) => c.id === id)?.studio, recentSkills, pickedSkills: picked,
        onRun: (run) => { if (mine()) runs.current.set(id, run); lastMsg((m) => ({ ...m, run })); }, onProgress: (prog) => { if (mine()) lastMsg((m) => ({ ...m, prog })); }, onDelta, onEvent, meta,
        // Model của câu trả lời trước: người dùng chê ("làm lại", "sai rồi") thì chế độ Tự động đổi sang model khác.
        extra: { ...mixExtra(chatsRef.current.find((c) => c.id === id)), web: readPref("webSearch", true), memory: readPref("chatMemory", true), incognito: !!chatsRef.current.find((c) => c.id === id)?.inc, prevModel: [...(chatsRef.current.find((c) => c.id === id)?.msgs ?? [])].reverse().find((m) => m.role === "ai" && m.done && m.via)?.via,
          // histTotal: số tin thật trước khi cắt còn HISTORY_LIMIT (để nối tiếp phiên CLI); tz: múi giờ của người dùng cho dòng giờ hiện tại.
          histTotal: hist?.length ?? 1, ...(hist && hist.length > HISTORY_LIMIT ? { olderDigest: olderDigest(hist.slice(0, -HISTORY_LIMIT)) } : {}), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(avoid ? { avoidModel: avoid } : {}), ...(rejected?.length ? { rejected } : {}),
          // Chip "Kiểu: …" của đoạn chat: máy chủ dùng phong cách đó làm mẫu cho sản phẩm thiết kế.
          designStyle: designStyleFor(id),
          // pjFull: trình duyệt có đủ dữ liệu dự án nên lời nhắc trên là bản đúng; dự án chỉ là bản rút gọn (stub) thì máy chủ tự thêm hướng dẫn dự án.
          ...(pr && !pr.stub ? { pjFull: true } : {}) } });
      webs = meta.webs ?? [];
      // Tự động đã chuyển sang model khác vì model đầu lỗi / quá tải: giữ lời báo dưới câu trả lời (thanh thông báo chỉ hiện một lúc).
      // Tự động chạy bằng khóa API chung (có gói mà không dùng gói): giữ dòng nói lượt này tính vào hạn mức chi phí API.
      if (meta.switched || meta.keyNote) notice = { text: (meta.switched ?? meta.keyNote)! };
      const used = meta.skills ?? [];
      libs = meta.libs ?? [];
      // Skill nằm trong thư viện đã hiện ở chip thư viện; mục "studio-…" / "lib-…" chỉ là mục lục, không hiện riêng.
      const inLib = new Set(libs.flatMap((l) => [l.key, ...l.skills]));
      usedSk = [...new Set(used.filter((u) => u.kind === "skill" && !inLib.has(u.name)).map((u) => u.name))];
      usedTl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
      outs = meta.files ?? [];
      via = meta.route ?? null;
      viaTask = meta.routeTask;
      trace = meta.trace ?? [];
      cancelled = !!meta.cancelled;
      // Tin nhắn thêm tới khi model đã ở bước trả lời cuối: gửi thành lượt tiếp theo ngay khi xong (không mất tin).
      const left = meta.steer ?? [];
      setQueued((q) => {
        const mine = q.map((x) => (x.chat === id && x.mode === "steer" ? { ...x, mode: "later" as const } : x));
        const extra = left.filter((t) => !mine.some((x) => x.chat === id && x.text === t)).map((t, k) => ({ id: Date.now() + k + Math.random(), chat: id, text: t, mode: "later" as const }));
        return [...mine, ...extra];
      });
    } catch (e) {
      setQueued((q) => q.map((x) => (x.chat === id && x.mode === "steer" ? { ...x, mode: "later" as const } : x)));
      // Máy chủ trả lời kèm lý do (kể cả lỗi của gói / model, mã 5xx): hiện đúng lý do; chỉ khi không có lý do mới báo chung chung.
      failed = true;
      said = e instanceof LLMError && e.message && !/^(LLM|Run|Lỗi) \d+$/.test(e.message) ? e.message : GENERIC_ERR;
      // Lỗi giữa chừng (hết hạn mức, treo…): chữ đã viết, tệp đã tạo vẫn giữ; lời báo lỗi hiện riêng bên dưới.
      const d = e instanceof LLMError ? e.data : {};
      const kept = typeof d.text === "string" && d.text.trim() ? d.text : "";
      reply = kept || said;
      notice = noticeOf(d, kept ? said : "");
      if (Array.isArray(d.files)) outs = d.files as Msg["outs"];
      if (Array.isArray(d.trace)) trace = d.trace as Msg["trace"];
      if (Array.isArray(d.webSources)) webs = d.webSources as Msg["webs"];
      // Gói subscription hết hạn mức hoặc phiên đăng nhập hỏng: hỏi người dùng có chuyển sang khóa API của cùng hãng không (không tự chuyển).
      if (e instanceof LLMError && (e.data.planLimit || e.data.relogin) && typeof e.data.apiModel === "string") {
        const retry = () => { patch(id, (m) => [...m.slice(0, -1), { role: "ai", text: "", time: Date.now() }]); streamReply(id, text, hist, pid, studio, picked, avoid, rejected); };
        setTimeout(() => askPlanSwitch(e.data, retry), 300);
      }
    }
    sink.cancel();
    // Người dùng đã bấm Dừng: máy chủ trả phần đã viết và dấu vết (công cụ bị dừng ghi cancelled_by_user) — lưu lại cho lượt sau.
    if (!mine()) {
      const pend = sink.pending();
      if (cancelled) patch(id, (ms) => ms.map((m, k) => (k === ms.length - 1 && m.role === "ai" && m.stopped ? { ...m, text: m.text || reply || pend || "", trace: trace?.length ? trace : m.trace, outs: outs?.length ? outs : m.outs } : m)));
      return;
    }
    // Lượt lỗi: hiện thẻ lỗi ngay (không giả lập gõ chữ), giữ phần đã viết và nhật ký làm việc; không tính là câu trả lời xong.
    if (failed) {
      const partial = notice?.partial ? reply : sink.pending();
      patch(id, (m) => [...m.slice(0, -1), { ...workOf(m[m.length - 1]), role: "ai", text: partial ?? m[m.length - 1]?.text ?? "", failed: true, err: said, notice, done: true, time: Date.now(), dur: Date.now() - t0, outs: outs?.length ? outs : undefined, trace: trace?.length ? trace : undefined, webs: webs?.length ? webs : undefined }]);
      stop(false, id);
      doneAway(id, true);
      return;
    }
    // Đã dùng hướng dẫn cá nhân / ngữ cảnh dự án: chỉ đặt cờ để hiện chip trung tính dưới câu trả lời. Mọi câu trả lời thật đều truyền theo thời gian thực
    // (lượt chạy bền qua waitRun/pollRun), nên KHÔNG xét "streamed" — nếu không chip cá nhân không bao giờ hiện; chỉ cần lượt xong và không bị Dừng.
    // Không bao giờ ghép nội dung hướng dẫn vào chữ câu trả lời: dòng ghi chú kèm 90 ký tự đầu của hướng dẫn từng lộ hướng dẫn cá nhân trong lịch sử, bản chia sẻ, bản xuất.
    const insApplied = !cancelled && !!ins.trim();
    const pjApplied = !cancelled && !!pr && !!(projectBrief(pr) || pr.mem?.[0] || getRelevantContext(pr, text).length);
    // Câu trả lời đã đầy đủ thì hiện ngay (trước đây câu không truyền theo thời gian thực phải chờ 1,6 giây rồi mới gõ dần từng chữ).
    patch(id, (m) => [...m.slice(0, -1), { ...workOf(m[m.length - 1]), role: "ai", text: reply, done: true, ...(insApplied ? { insApplied } : {}), ...(pjApplied ? { pjApplied } : {}), time: Date.now(), dur: Date.now() - t0, skills: usedSk.length ? usedSk : undefined, libs: libs.length ? libs : undefined, tools: usedTl.length ? usedTl : undefined, outs: outs?.length ? outs : undefined, ...(notice ? { notice } : {}), via: via ?? undefined, viaTask: via ? viaTask : undefined, webs: webs?.length ? webs : undefined, trace: trace?.length ? trace : undefined, stopped: cancelled || undefined }]);
    finishReply(id, reply, pr, history, via);
  };
  // Hỏi Có / Không trước khi dùng khóa API dùng chung thay cho gói đã hết hạn mức. Đồng ý: nhóm model của hãng đó chuyển sang model API
  // (tới khi gói hồi lại), chọn model tương đương và gửi lại lượt vừa lỗi. Không đồng ý: giữ nguyên gói.
  const askPlanSwitch = (d: Record<string, unknown>, retry: () => void) => {
    const cli = String(d.planLimit ?? d.relogin), api = String(d.apiModel), apiName = typeof d.apiModelName === "string" ? d.apiModelName : modelName(api);
    const name = ({ claude: "Claude", codex: "ChatGPT", agy: "Gemini", grok: "Grok" } as Record<string, string>)[cli] ?? cli;
    const at = typeof d.resetsAt === "number" ? resetClock(d.resetsAt, getLang()) : "";
    setGc({
      title: d.relogin ? tf("Gói {name} cần đăng nhập lại", { name }) : tf("Gói {name} đã hết hạn mức", { name }),
      text: at
        ? tf("Chuyển sang khóa API {name} dùng chung ({api}) cho tới khi gói hồi lại ({at})? Tin nhắn vừa rồi sẽ được gửi lại bằng khóa API. Chọn Hủy để giữ nguyên gói.", { name, api: apiName, at })
        : tf("Chuyển sang khóa API {name} dùng chung ({api}) cho tới khi gói dùng lại được? Tin nhắn vừa rồi sẽ được gửi lại bằng khóa API. Chọn Hủy để giữ nguyên gói.", { name, api: apiName }),
      ok: trc("Dùng khóa API", "gói hết hạn mức"),
      safe: true,
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
  const afterArtifacts = (id: number, reply: string, gen = "", question = "", byUser = false) => {
    const c = chatsRef.current.find((x) => x.id === id);
    if (!capsRef.current.art || !hasArtifacts(reply) || !c || c.inc) return;
    const st = new Map<string, ArtVersion>();
    for (const m of c.msgs) if (m.role === "ai" && m.text !== reply) for (const sg of splitArtifacts(m.text)) if (sg.kind === "art") st.set(sg.art.ident, resolveArt(st.get(sg.art.ident), sg.art));
    const full = splitArtifacts(reply).flatMap((sg): ArtBlock[] => { if (sg.kind !== "art") return []; const r = resolveArt(st.get(sg.art.ident), sg.art); st.set(sg.art.ident, r); return r.fix?.failed.length ? [] : [{ ident: r.ident, title: r.title, type: r.type, lang: r.lang, content: r.content, complete: r.complete }]; });
    if (full.length) saveArtifacts(String(id), full).then(() => setArtRefresh((n) => n + 1));
    // Phản biện tự động chạy trên gói của người dùng (mỗi lần một lượt tính vào hạn mức): một lần cho mỗi artifact được viết lại trọn trong câu
    // trả lời này, bản cuối cùng của nó. Bản sửa nhỏ model tự viết (mode="patch") không tự phản biện lại; người dùng vẫn bấm được.
    // byUser: người dùng vừa bấm "Áp dụng sửa" / đổi phong cách: phản biện lại để xác nhận bản sửa.
    const whole = new Set(splitArtifacts(reply).flatMap((sg) => (sg.kind === "art" && (byUser || !sg.art.patch) ? [sg.art.ident] : [])));
    const last = new Map(full.filter((a) => whole.has(a.ident)).map((a) => [a.ident, a]));
    if (capsRef.current.crit) for (const a of last.values()) if (important(a)) runCritic(id, a, gen, question, true);
  };
  const runCritic = (id: number, a: ArtBlock, gen = "", question = "", auto = false) => {
    const key = criticKey(a.ident, a.content);
    // Giữ kết quả của 30 phiên bản gần nhất trong đoạn chat.
    const put = (e: CriticEntry) => setChats((cs) => cs.map((c) => (c.id !== id ? c : { ...c, critic: Object.fromEntries([...Object.entries(c.critic ?? {}).filter(([k]) => k !== key).sort((x, y) => y[1].at - x[1].at).slice(0, 29), [key, e]]) })));
    put({ status: "run", findings: [], by: [], at: Date.now() });
    fetch("/api/critic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: a.title, type: a.type, lang: a.lang, content: a.content, model: gen, question: question.slice(0, 1500), auto, ui: getLang() }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        // Máy chủ bỏ qua lần tự chạy này: không có kết quả nào để hiện, càng không phải dấu "Ổn".
        if (r.ok && j.skipped) { setChats((cs) => cs.map((c) => (c.id !== id || !c.critic ? c : { ...c, critic: Object.fromEntries(Object.entries(c.critic).filter(([k]) => k !== key)) }))); return; }
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
    setTimeout(() => afterArtifacts(id, ai, "", "", true), 0);
  };
  // Đổi phong cách artifact không gọi model: một cặp tin (yêu cầu + bản sửa data-sx-preset) thành phiên bản mới, lượt sau model thấy phong cách mới trong lịch sử.
  // Bộ thiết kế (artkit, designpresets: hơn 100 KB) chỉ tải khi bấm đổi phong cách, không nằm trong phần tải đầu (blueprint B3.2).
  const restyle = async (id: number, a: { ident: string; title: string; content: string }, preset: string) => {
    const [{ restylePatch }, { presetOf }] = await Promise.all([import("../shared/artkit"), import("../shared/designpresets")]);
    const p = restylePatch(a.content, preset);
    if (!p) return;
    const now = Date.now(), label = tr(presetOf(preset)?.name ?? preset);
    const ai = `${tr("Đã đổi phong cách sang")} ${label}.\n\n<artifact identifier="${a.ident}" mode="patch">\n${p}\n</artifact>`;
    patch(id, (m) => [...m, { role: "user", text: `${tr("Đổi phong cách")} “${a.title}” → ${label}`, time: now }, { role: "ai", text: ai, done: true, time: now }]);
    setArtSel({ chat: id, ident: a.ident, v: 0, follow: true });
    setTimeout(() => afterArtifacts(id, ai, "", "", true), 0);
  };
  // Tự đặt tên đoạn chat theo nội dung (như Claude): sau câu trả lời đầu tiên; tin đầu chỉ là lời chào thì đặt lại sau tin thứ ba.
  // Người dùng đã tự đổi tên thì giữ nguyên; force: người dùng bấm "Đặt tên tự động".
  const titling = useRef(new Set<number>());
  const autoTitle = (id: number, force = false) => {
    const c = chatsRef.current.find((x) => x.id === id);
    if (!c || c.inc || titling.current.has(id) || (c.named && !force)) return;
    const users = c.msgs.filter((m) => m.role === "user" && !m.steer && m.text.trim());
    const n = users.length;
    if (!n || (!force && c.titled !== undefined && !(c.titled < 3 && n >= 3 && vagueMsg(users[0].text)))) return;
    titling.current.add(id);
    const messages = c.msgs.filter((m) => m.text.trim() && !m.failed && (m.role === "user" || m.done)).slice(0, 6).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", text: m.text.slice(0, 4000) }));
    fetch("/api/title", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) })
      .then(async (r) => { const j = await r.json().catch(() => null); return r.ok && typeof j?.title === "string" ? (j.title as string) : ""; })
      .catch(() => "")
      .then((t) => {
        // Đặt tên hỏng (máy chủ bận, model lỗi) thì chưa đánh dấu là đã đặt: câu trả lời sau thử lại, không để đoạn chat mãi không tên.
        setChats((cs) => cs.map((x) => (x.id !== id || !t ? x : { ...x, titled: n, ...(force || !x.named ? { title: t, named: undefined } : {}) })));
        if (force && !t) say("Chưa đặt được tên tự động. Thử lại sau.");
      })
      .finally(() => titling.current.delete(id));
  };
  const finishReply = (id: number, reply: string, pr: Project | undefined, history: LLMMsg[], via?: string | null) => {
    stop(false, id);
    doneAway(id);
    setTimeout(() => autoTitle(id), 300);
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
  // Câu trả lời xong khi người dùng đang ở mục khác hoặc đoạn chat khác: báo một dòng để họ biết quay lại xem.
  const doneAway = (id: number, failed = false) => {
    if (viewRef.current === "chat" && curRef.current === id) return;
    const c = chatsRef.current.find((x) => x.id === id);
    if (c && !document.hidden) say(failed ? tf("Câu trả lời trong “{title}” gặp lỗi", { title: c.title }) : tf("Synchro đã trả lời xong “{title}”", { title: c.title }));
  };
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
      runs.current.set(c.id, run);
      const gen = ++genSeq.current;
      gens.current.set(c.id, gen);
      setBusyOf(c.id, true);
      const mine = () => gens.current.get(c.id) === gen;
      const meta: Partial<RunMeta> = {};
      // Chữ của lượt nối lại cũng gộp như lượt đang gửi (trước đây mỗi mẩu chữ dựng lại cả trang).
      const sink = deltaSink(mine, (text) => set((m) => ({ ...m, text, prog: undefined })));
      attachRun(run, (prog) => { if (mine()) set((m) => ({ ...m, prog })); }, (text) => { if (mine()) sink.push(text); }, (ev) => { if (!mine()) return; openBrowser(ev, c.id); if (ev.kind === "say") sink.drop(); if (ev.kind !== "steer") set((m) => ({ ...m, ...applyEvent(m, ev), ...(ev.kind === "say" ? { text: "" } : {}) })); }, meta, c.id).then((text) => {
        sink.cancel();
        const used = meta.skills ?? [], libs = meta.libs ?? [], outs = meta.files ?? [], trace = meta.trace ?? [], stopped = !!meta.cancelled;
        // Người dùng bấm Dừng trong lúc chờ: tin đã đánh dấu dừng, chỉ giữ thêm phần máy chủ trả về.
        // Chữ chưa kịp vẽ (sink.pending(), cancel() không xóa): dự phòng khi tin chưa có chữ và máy chủ không trả lại phần đã viết.
        if (!mine()) { if (stopped) { const pend = sink.pending(); patch(c.id, (ms) => ms.map((m, k) => (k === ms.length - 1 && m.role === "ai" && m.stopped ? { ...m, text: m.text || text || pend || "", trace: trace.length ? trace : m.trace } : m))); } return; }
        const inLib = new Set(libs.flatMap((l) => [l.key, ...l.skills]));
        const sk = [...new Set(used.filter((u) => u.kind === "skill" && !inLib.has(u.name)).map((u) => u.name))];
        const tl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
        const via = meta.route ?? null;
        set((m) => ({ ...m, text, done: true, prog: undefined, run: undefined, time: Date.now(), dur: Date.now() - (last.time ?? Date.now()), skills: sk.length ? sk : undefined, libs: libs.length ? libs : undefined, tools: tl.length ? tl : undefined, outs: outs.length ? outs : undefined, via: via ?? undefined, viaTask: via ? meta.routeTask : undefined, trace: trace.length ? trace : undefined, stopped: stopped || undefined, webs: meta.webs?.length ? meta.webs : undefined }));
        stop(false, c.id);
        doneAway(c.id);
        setTimeout(() => autoTitle(c.id), 300);
      }, (e) => {
        sink.cancel();
        if (!mine()) return;
        const said = e instanceof LLMError && e.message ? e.message : GENERIC_ERR, d = e instanceof LLMError ? e.data : {};
        const kept = typeof d.text === "string" && d.text.trim() ? d.text : "";
        // Lỗi mạng / lỗi không kèm chữ: giữ mẩu chữ chưa kịp vẽ (mới hơn m.text; ở tab nền có khi là cả câu vì requestAnimationFrame không chạy).
        const pend = sink.pending();
        set((m) => ({ ...m, done: true, prog: undefined, run: undefined, failed: true, err: said, text: kept || pend || m.text, notice: noticeOf(d, kept ? said : ""), ...(Array.isArray(d.files) && d.files.length ? { outs: d.files as Msg["outs"] } : {}), ...(Array.isArray(d.trace) && d.trace.length ? { trace: d.trace as Msg["trace"] } : {}) }));
        stop(false, c.id);
      });
    }
  }, [loaded, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const [undoTurn, setUndoTurn] = useState<{ chat: number; msgs: Msg[]; compact: Chat["compact"]; n: number } | null>(null);
  const send = (t: string, f: string[] = [], pick?: { id: string; label: string }[]) => {
    if (busy) return;
    setUndoTurn(null);
    const was = view === "chat" ? curChat() : undefined;
    if (was?.stub) return say(was.local ? "Đang mở đoạn chat, hãy thử lại sau giây lát" : "Đoạn chat đang tải từ máy chủ, hãy thử lại sau giây lát");
    stickToBottom();
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const pm = (x: string) => { const [t, ap] = x.split(" "); const [h, m] = t.split(":").map(Number); return ((h % 12) + (ap === "PM" ? 12 : 0)) * 60 + m; };
    const quiet = (d: number) => { const w = qtimes[d]; if (!w || !qdays.includes(d)) return false; const a = pm(w[0]), b = pm(w[1]); return a > b ? mins >= a : mins >= a && mins < b; };
    if (quiet(now.getDay()) || (mins < 12 * 60 && quiet((now.getDay() + 6) % 7))) say("Đang trong giờ yên tĩnh bạn đã đặt — hãy cân nhắc nghỉ ngơi");
    const tp = tplMode ? TPLS.find((x) => x.k === tplMode) : undefined;
    const msgs: Msg[] = [{ role: "user", text: t, files: f.length ? f : undefined, pick, time: Date.now(), sys: tp?.sys ?? (view === "project" ? proj?.ins : undefined) }, { role: "ai", text: "", time: Date.now() }];
    let id = cur;
    // Dự án của lượt này. Đoạn chat mới (kể cả chọn dự án ở khung soạn của trang chủ): lấy đúng dự án vừa gán, không tìm trong chatsRef — đoạn chat mới
    // chưa có ở đó cho tới lần vẽ sau, nên câu đầu từng đi không kèm dự án (không có hướng dẫn dự án, còn đi đường nhanh).
    let pid: number | undefined;
    if (view !== "chat" || id === null) {
      id = Date.now();
      const nid = id;
      const np = nextProj ?? (view === "project" ? curProj ?? undefined : undefined);
      pid = np;
      setChats((cs) => [{ id: nid, title: roughTitle(t), msgs, inc: incog || undefined, project: np, studio: tp ? STUDIO_OF[tp.k] : undefined }, ...cs]);
      // Chip "Kiểu: …" đặt ở ô soạn của trang chủ thuộc về đoạn chat vừa tạo này, không về đoạn chat nào mở sau.
      adoptNewChip(nid);
      setNextProj(undefined);
      setCur(id);
      setView("chat");
    } else {
      const eid = id;
      pid = chatsRef.current.find((c) => c.id === eid)?.project;
      patch(id, (m) => [...m, ...msgs]);
    }
    setFiles([]);
    setTplMode(null);
    setPrefill({ t: "", n: 0 });
    // Tin trước lượt này: đọc từ đoạn chat lấy TRƯỚC khi thêm tin mới (chatsRef đọc thẳng kho, đã có tin vừa thêm).
    const prior = id !== null && view === "chat" ? (was?.msgs ?? []) : [];
    // Lịch sử theo chuẩn Synchro (history.ts): kèm dấu vết công cụ, đánh dấu câu trả lời bị dừng, bỏ phần đã nén.
    const hist: LLMMsg[] = [...chatHistory(prior, chatsRef.current.find((c) => c.id === id)?.compact), { role: "user", content: t }];
    runTurn(id, t, f, hist, pid, tp ? STUDIO_OF[tp.k] : undefined, pick?.map((x) => x.id));
  };
  // Chạy một lượt: đọc các tệp đính kèm chưa có trên máy chủ rồi gọi model (gửi mới, thử lại, sửa tin đã gửi).
  const runTurn = (id: number, t: string, f: string[], hist: LLMMsg[], pid?: number, studio?: Chat["studio"], picked?: string[], avoid?: string) => {
    fileContext(f, t).then(({ blocks, errors, rejected, failed }) => {
      errors.forEach((m) => say(m));
      // Nhớ mã tệp trên máy chủ: các lượt sau (kể cả khi chế độ Tự động đổi model) gửi lại tệp này cùng lịch sử.
      const fids = Object.fromEntries(f.flatMap((n) => { const x = getStatus(n)?.id; return x ? [[n, x]] : []; }));
      if (Object.keys(fids).length) patch(id, (ms) => ms.map((m, k) => (k === ms.length - 2 && m.role === "user" ? { ...m, fids: { ...m.fids, ...fids } } : m)));
      // Không lấy được nội dung các tệp đọc được: báo ngay trong khung trả lời, không hỏi model như thể tin nhắn không có tệp.
      // Tệp bị từ chối (thẻ báo lỗi) thì vẫn gửi lượt, kèm danh sách để model nói rõ tệp nào không đọc được và vì sao.
      if (failed) { patch(id, (m) => [...m.slice(0, -1), { role: "ai", text: "", failed: true, err: errors[errors.length - 1] ?? "Không lấy được nội dung tệp đính kèm. Hãy gửi lại.", time: Date.now(), done: true }]); return; }
      if (blocks.length) { const c = hist[hist.length - 1].content; hist[hist.length - 1] = { role: "user", content: [...(Array.isArray(c) ? c : [{ type: "text" as const, text: t || "Hãy xem các tệp đính kèm." }]), ...blocks] }; }
      else if (rejected.length && !t.trim()) hist[hist.length - 1] = { role: "user", content: "Hãy xem các tệp đính kèm." };
      streamReply(id, t, hist, pid, studio, picked, avoid, rejected);
    });
  };
  // Gửi lại tin thứ k của đoạn chat (u: nội dung tin đó, đã sửa hoặc không): bỏ mọi tin sau nó, lượt mới giữ nguyên tệp và skill đã chọn.
  // Số tin đổi nên máy chủ tự mở phiên CLI mới kèm lịch sử (subs.ts, so số lượt) thay vì nối vào phiên cũ.
  const resend = (c: Chat, k: number, u: Msg, avoid?: string) => {
    stickToBottom();
    const upto = [...c.msgs.slice(0, k), u];
    const compact = c.compact && c.compact.upto <= k ? c.compact : undefined;
    // Sửa tin hay thử lại đều thay các tin phía sau: giữ bản cũ để khôi phục được, tới khi gửi tin mới.
    const lost = c.msgs.slice(k + 1).filter((m) => !m.failed && m.text.trim());
    setUndoTurn(lost.length ? { chat: c.id, msgs: c.msgs, compact: c.compact, n: lost.length } : null);
    setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, compact, msgs: [...upto, { role: "ai", text: "", time: Date.now() }] } : x)));
    runTurn(c.id, u.text, (u.files ?? []).filter((n) => !u.fids?.[n]), chatHistory(upto, compact), c.project, c.studio, u.pick?.map((x) => x.id), avoid);
  };
  // Rẽ nhánh đoạn chat từ một câu trả lời: chép các tin tới đó sang đoạn chat mới (cùng dự án, chế độ), mở đoạn chat mới để hỏi tiếp theo hướng khác.
  // Không chép mã lượt đang chạy, kết quả hội đồng phản biện hay bản nén ngữ cảnh: nhánh mới gửi lại đủ lịch sử ở lượt đầu.
  const fork = (i: number) => {
    const c = curChat();
    if (!c || c.inc || c.stub) return;
    const id = Date.now();
    const msgs = c.msgs.slice(0, i + 1).map((m) => ({ ...m, run: undefined, prog: undefined, done: true }));
    const title = tf("{title} · nhánh", { title: c.title });
    setChats((cs) => [{ id, title, named: true, msgs, project: c.project, studio: c.studio, mixer: c.mixer, pins: c.pins }, ...cs]);
    setUndoTurn(null);
    setCur(id);
    setView("chat");
    say("Đã rẽ nhánh thành đoạn chat mới, đoạn chat gốc giữ nguyên");
  };
  const undoLost = () => {
    const u = undoTurn;
    if (!u) return;
    setUndoTurn(null);
    if (running.has(u.chat)) stop(true, u.chat);
    setChats((cs) => cs.map((x) => (x.id === u.chat ? { ...x, msgs: u.msgs, compact: u.compact } : x)));
  };
  // Thử lại sau lượt lỗi đã làm được một phần (bị ngắt vì hết hạn mức giữa lúc tra cứu…): giữ lượt đó trong lịch sử (phần đã viết, dấu vết công cụ)
  // và làm tiếp, không vứt đi rồi làm lại từ đầu. "Chạy lại bằng model khác" (avoid) vẫn là chạy lại từ đầu.
  const retry = (avoid?: string) => {
    const chat = curChat();
    if (!chat || busy) return;
    if (!avoid && continuable(chat.msgs[chat.msgs.length - 1])) { send(tr("Tiếp tục từ chỗ đang dở")); return; }
    const k = chat.msgs.map((m) => m.role).lastIndexOf("user");
    if (k >= 0) resend(chat, k, chat.msgs[k], avoid);
  };
  retryRef.current = retry;
  // Đổi model bằng một lần bấm sau khi lượt lỗi. Đã có phần làm dở thì làm tiếp (dấu vết công cụ nằm trong lịch sử, model mới biết việc nào đã xong),
  // chưa có gì thì gửi lại đúng tin vừa rồi. Đang để Tự động thì giữ Tự động: máy chủ đã biết model nào đang nghỉ.
  const switchModel = (key: string) => {
    if (!curChat() || busy) return;
    if (model !== AUTO) { setActiveModel(key); setModel(key); }
    retry();
  };
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key); say("Đã sao chép");
    setTimeout(() => setCopied(null), 1500);
  };
  // Đọc to câu trả lời bằng giọng ElevenLabs (giọng chọn ở Cài đặt → Giọng nói); chưa có ElevenLabs thì dùng giọng của trình duyệt.
  const aiSpeak = useRef<Speaking | null>(null);
  const stopSpeak = () => { aiSpeak.current?.stop(); aiSpeak.current = null; stopBrowserRead(); };
  const speak = async (key: string, text: string) => {
    if (speaking === key) { stopSpeak(); setSpeaking(null); return; }
    stopSpeak();
    setSpeaking(key);
    // Không đọc mã nguồn artifact, khối code và ký hiệu Markdown; câu trả lời chỉ có sản phẩm thì nói rõ thay vì im lặng.
    const parts = toSpeech(text), clean = parts.join(" ");
    if (!clean) { setSpeaking(null); return say("Câu trả lời này chỉ có sản phẩm, không có chữ để đọc"); }
    const browserRead = (list: string[]) => {
      // Đọc bằng đúng ngôn ngữ của câu trả lời (có dấu tiếng Việt thì giọng Việt), không ép theo cài đặt. Đọc từng đoạn: trình duyệt hay dừng giữa chừng với đoạn dài.
      const pref = VOICE_LANG[vlang] ?? "vi-VN", lang = VI.test(clean) ? "vi-VN" : pref.startsWith("vi") ? "en-US" : pref;
      const off = () => setSpeaking((k) => (k === key ? null : k));
      // Máy không có giọng, giọng lỗi: dừng và báo một lần, không kẹt ở trạng thái đang đọc.
      readBrowser(list, { lang, rate: VOICE_RATE[vspeed] ?? 1, onEnd: off, onFail: (m) => { off(); say(m); }, onNote: say });
    };
    const ai = await speakAI(clean, { voice: vvoice, speed: elSpeed(VOICE_RATE[vspeed] ?? 1) });
    if (ai) {
      aiSpeak.current = ai;
      void ai.done.then((ok) => {
        if (aiSpeak.current === ai) aiSpeak.current = null;
        // Giọng AI dừng giữa chừng (hết hạn mức, hết credit, mất mạng): đọc nốt bằng giọng của trình duyệt, không dừng như đã đọc xong.
        const rest = ok ? "" : ai.rest();
        if (rest) { say(aiVoiceNote() || "Giọng AI dừng giữa chừng, Synchro đọc nốt bằng giọng của trình duyệt"); browserRead(toSpeech(rest)); return; }
        setSpeaking((k) => (k === key ? null : k));
      });
      return;
    }
    const why = aiVoiceNote();
    if (why) say(why);
    browserRead(parts);
  };
  const like = (i: number, v: 1 | -1) => {
    const chat = curChat();
    if (!chat) return;
    const m = chat.msgs[i], next = m?.like === v ? undefined : v;
    patch(chat.id, (ms) => ms.map((x, j) => (j === i ? { ...x, like: next } : x)));
    // Điểm cho các skill và thư viện câu trả lời đã dùng; Kho kỹ năng cộng điểm để chỉ ra skill hay bị chê.
    const used = [...(m?.skills ?? []), ...(m?.libs ?? []).flatMap((l) => l.skills)];
    if (m && used.length) fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msg: `${chat.id}:${m.time}`, skills: used, value: next ?? 0 }) }).catch(() => {});
    say("Cảm ơn phản hồi của bạn");
  };

  const [focusN, setFocusN] = useState(0);
  const goNew = () => {
    setFocusN((n) => n + 1);
    stopSpeak(); setSpeaking(null);
    setChats((cs) => cs.filter((c) => !c.inc));
    setView("new"); setCur(null); setTplMode(null); setFiles([]); setPrefill({ t: "", n: 0 });
  };
  const goCustom = () => { setCzTab("hub"); setView("customize"); };
  const removeChat = (id: number) => { if (running.has(id)) stop(true, id); setChats((cs) => cs.filter((c) => c.id !== id)); chatSync.forget("chat", [id]); if (cur === id) goNew(); };
  // Đoạn chat đang mở vừa bị xóa ở thiết bị khác.
  const curGone = useChatState((st) => st.cur !== null && !st.chats.some((c) => c.id === st.cur));
  useEffect(() => { if (curGone && loaded && view === "chat" && cur !== null) { setCur(null); setView("new"); } }, [curGone]); // eslint-disable-line react-hooks/exhaustive-deps
  const { togglePin, setChatTags } = useChatStore.getState();
  const filterTag = (t: string | null) => { useSideUi.getState().setTagFilter(t); if (t) setOpen(true); };

  // Phím tắt toàn trang, bấm ra ngoài thì đóng menu (homehooks.ts useShortcuts).
  const palSeed = useShortcuts({ searchOpen: modal === "search", isOpen: () => openRef.current, narrow, setOpen, goNew: () => goNewRef.current(), userRef, closeUserMenu: () => setUserMenu(false),
    openSearch: () => setModal("search"), openKeys: () => setModal("keys"), openSettings: () => { setSettingsTab("General"); setModal("settings"); },
    escape: () => { setGc(null); setModal(null); setDelId(null); setDelProj(null); setUserMenu(false); } });
  const goNewRef = useRef(goNew);
  goNewRef.current = goNew;
  // Thẻ hỏi lại (```ask): lựa chọn của người dùng thành tin nhắn tiếp theo.
  const sendRef = useRef<(t: string) => void>(() => {});
  sendRef.current = (t) => send(t);
  useEffect(() => { const h = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t) sendRef.current(t); }; window.addEventListener(ASK_EVENT, h); return () => window.removeEventListener(ASK_EVENT, h); }, []);

  // Kéo thả tệp vào trang (homehooks.ts useDragDrop).
  const drag = useDragDrop(say, files, setFiles, () => setModal((m) => (m === "upload" ? null : m)));

  // Mục trên thanh điều hướng: gọi như một hàm trả về JSX (không phải component định nghĩa lại mỗi lần vẽ), nên bấm vào không dựng lại
  // cả mục; biểu tượng cố định, không đổi hình khi rê / bấm. tip: tên đầy đủ khi nhãn ngắn hơn tên trang.
  const nav = ({ v, icon, label, badge, onPick, tip }: { v: View; icon: React.ReactNode; label: string; badge?: number; onPick?: () => void; tip?: string }) => (
    <button key={v} data-nav={v} data-tip={tip} onPointerEnter={() => PRELOAD[v]?.()} onFocus={() => PRELOAD[v]?.()} aria-current={view === v || (v === "projects" && view === "project") ? "page" : undefined} className={`nav-item ${view === v || (v === "projects" && view === "project") ? "active" : ""}`} onClick={() => { setView(v); if (v === "projects") setCurProj(null); onPick?.(); }}>
      <span className="rail-ic">{icon}</span><span className="rail-l">{label}</span>{badge ? <span className="nav-badge" aria-label={`${badge} kết quả chưa đọc`}>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
  const [voiceOn, setVoiceOn] = useState(false);
  // Bộ não: mở từ Cài đặt → Bộ não (kèm ghi chú cần mở), và tự nạp dần các đoạn chat cũ của trình duyệt này lên bộ não.
  const [brainAt, setBrainAt] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const t = (e as CustomEvent).detail?.title as string | null; setModal(null); setView("brain"); setBrainAt(t ?? null); };
    window.addEventListener("synchro:brain", h);
    return () => window.removeEventListener("synchro:brain", h);
  }, []);
  useBrainSync(!!me);
  // Autopilot xong một việc khi người dùng đang mở app ở chỗ khác: báo một dòng (trang Autopilot đang mở thì đã thấy
  // ngay trên danh sách).
  const inboxN = useInboxCount(!!me, (x) => {
    if (viewRef.current === "autopilot") return;
    const v = { title: x.title };
    say(x.proposals ? tf("Autopilot: “{title}” có đề xuất chờ bạn duyệt", v) : tf("Autopilot đã xong “{title}”", v));
  });
  // Bảng lệnh ⌘K: lệnh nhanh và cách mở từng loại kết quả.
  const paletteCmds: PaletteCmd[] = [
    { id: "new", label: "Đoạn chat mới", icon: <I.Plus size={16} />, keys: "⇧⌘O", hay: "new chat tao moi", run: goNew },
    { id: "autopilot", label: "Autopilot", icon: <I.Autopilot size={16} />, run: () => setView("autopilot"),
      hay: "autopilot hop thu inbox tac vu nen lich hen cron ket qua tu dong" },
    { id: "hub", label: "Kho kỹ năng", icon: <I.Plugins size={16} />, hay: "skill hub plugin thu vien", run: goCustom },
    { id: "connectors", label: "Connectors", icon: <I.Connectors size={16} />, hay: "connectors mcp ket noi", run: () => { setCzTab("connectors"); setView("customize"); } },
    ...(caps.art !== false ? [{ id: "artifacts", label: "Artifacts", icon: <I.Shapes size={16} />, hay: "ung dung apps", run: () => setView("artifacts") }] : []),
    { id: "projects", label: "Dự án", icon: <I.Folder size={16} />, hay: "projects", run: () => { setCurProj(null); setView("projects"); } },
    { id: "settings", label: "Cài đặt", icon: <I.Cog size={16} />, keys: "⇧⌘,", hay: "settings", run: () => { setSettingsTab("General"); setModal("settings"); } },
    { id: "theme", label: theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối", icon: theme === "dark" ? <I.M icon="Sun" size={16} /> : <I.M icon="Moon" size={16} />, hay: "theme dark light toi sang", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "sidebar", label: "Ẩn / hiện thanh bên", icon: <I.Panel size={16} />, keys: "⌘.", hay: "sidebar", run: () => setOpen((o) => !o) },
    { id: "keys", label: "Phím tắt", icon: <I.Keyboard size={16} />, keys: "⌘/", hay: "shortcuts", run: () => setModal("keys") },
  ];
  const paletteGo: PaletteGo = {
    chat: (id) => { setCur(id); setView("chat"); },
    artifact: (conv, title) => { const c = chatsRef.current.find((x) => String(x.id) === conv); if (c) { setCur(c.id); setView("chat"); } else { setTab(0); setArtQ(title); setView("artifacts"); } },
    app: (id) => window.open(`/apps/${id}`, "_blank", "noopener"),
    skillHub: (q) => { if (q) { try { sessionStorage.setItem("hub-q", q); } catch {} } goCustom(); if (q) window.dispatchEvent(new CustomEvent(HUB_SEARCH, { detail: q })); },
    project: (id) => { setCurProj(id); setView("project"); },
    code: (id) => { setCodeCur(id); setView("code"); if (codeList.find((c) => c.id === id)?.archived) codePatch(id, { archived: false }); },
    brain: (title) => window.dispatchEvent(new CustomEvent("synchro:brain", { detail: { title } })),
    autopilot: () => setView("autopilot"),
    tag: (t) => filterTag(t),
  };
  // Mở kết quả của Autopilot để hỏi tiếp. chat: đoạn chat máy chủ đã tạo cho kết quả; máy này chưa đồng bộ về thì xin
  // máy chủ đúng đoạn đó và chờ tối đa 8 giây. Kết quả cũ (trước khi có đoạn chat kết quả) hay chờ không được thì dựng
  // đoạn chat mới từ chữ của kết quả.
  const openAsChat = (title: string, text: string, chat?: number) => {
    const has = (id: number) => chatsRef.current.some((c) => c.id === id);
    const local = () => {
      if (!text) return say("Đoạn chat kết quả chưa về máy này, hãy thử lại sau giây lát");
      const id = Date.now();
      setChats((cs) => [{ id, title: title.slice(0, 40), msgs: [{ role: "user", text: title, time: id }, { role: "ai", text, done: true, time: id }] }, ...cs]);
      setCur(id); setView("chat");
    };
    if (chat === undefined) return local();
    if (has(chat)) { setCur(chat); setView("chat"); return; }
    needChats([chat]);
    const t0 = Date.now();
    const wait = setInterval(() => {
      if (has(chat)) { clearInterval(wait); setCur(chat); setView("chat"); }
      else if (Date.now() - t0 > 8000) { clearInterval(wait); local(); }
    }, 250);
  };
  // Gửi tiếp một tin vào đoạn chat có sẵn (tin "gửi sau khi xong"), kể cả khi người dùng đang ở mục khác hay đoạn chat khác.
  const followUp = (id: number, t: string) => {
    const c = chatsRef.current.find((x) => x.id === id);
    if (!c) return;
    if (id === curRef.current) stickToBottom();
    const hist: LLMMsg[] = [...chatHistory(c.msgs, c.compact), { role: "user", content: t }];
    patch(id, (m) => [...m, { role: "user", text: t, time: Date.now() }, { role: "ai", text: "", time: Date.now() }]);
    streamReply(id, t, hist, c.project, c.studio);
  };
  // Lượt của một đoạn chat xong: gửi lần lượt các tin đã xếp hàng của đoạn chat đó.
  useEffect(() => {
    const next = queued.find((q) => q.mode === "later" && !running.has(q.chat));
    if (!next) return;
    const t = setTimeout(() => { setQueued((q) => q.filter((x) => x.id !== next.id)); followUp(next.chat, next.text); }, 250);
    return () => clearTimeout(t);
  }, [running, queued]); // eslint-disable-line react-hooks/exhaustive-deps
  // Prop của ô soạn tin (Composer đã memo): hàm qua useEvent, danh sách dự án chỉ dựng lại khi dự án đổi, còn lại là giá trị đơn / state,
  // nên lúc chữ đang chảy ô soạn tin không vẽ lại; chỉ vẽ khi bắt đầu / xong lượt (busy) hay khi chính các giá trị này đổi.
  const projPick = useMemo(() => projects.filter((x) => !x.archived).map((x) => ({ id: x.id, name: x.name })), [projects]);
  const onSend = useEvent(send), onSteerE = useEvent(onSteer), onStop = useEvent(stop), goCustomE = useEvent(goCustom);
  const goConnectors = useEvent(() => { setCzTab("connectors"); setView("customize"); }), openUpload = useEvent(() => setModal("upload"));
  const onVoice = useEvent(() => { stopSpeak(); setSpeaking(null); setVoiceOn(true); });
  const onProject = useEvent((pid: number | undefined) => {
    if (!projects.length) { setModal("proj"); return; }
    const name = projects.find((x) => x.id === pid)?.name;
    const chat = view === "chat" ? curChat() : undefined;
    if (chat) { setChats((cs) => cs.map((x) => (x.id === chat.id ? { ...x, project: pid } : x))); say(pid ? `Đã thêm vào "${name}"` : "Đã gỡ khỏi dự án"); }
    else { setNextProj(pid); say(pid ? `Đoạn chat mới sẽ nằm trong "${name}"` : "Đoạn chat mới không thuộc dự án nào"); }
  });
  const focusKey = `${view}:${cur}:${focusN}:${tplMode}`;
  const project = view === "chat" && meta ? meta.project : nextProj ?? (view === "project" ? curProj ?? undefined : undefined);
  // Cùng một đối tượng khi các giá trị không đổi: khối soạn tin ở đáy đoạn chat là phần tử đã memo (dock), khung đoạn chat (memo) nhận lại đúng nó.
  // Cùng điều kiện với send(): ngoài màn đoạn chat, lượt gửi luôn tạo đoạn chat mới, nên chip thuộc khóa "new".
  const chatKey = view !== "chat" || cur === null ? "new" : String(cur);
  const composerProps = useMemo(() => ({
    focusKey, onSend, busy, onSteer: onSteerE, onStop, say, prefill, files, setFiles, model, setModel,
    goCustom: goCustomE, goConnectors, openUpload, onVoice, projects: projPick, project, onProject, chatKey,
    // Các hàm là useEvent (ổn định), không cần nằm trong danh sách phụ thuộc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [focusKey, busy, prefill, files, model, projPick, project, chatKey]);
  // Bàn trộn ngữ cảnh trong ô soạn tin ở đoạn chat: phần tử chỉ dựng lại khi đổi đoạn chat hay bắt đầu / xong lượt; DockMixer tự đọc đoạn chat từ kho.
  const chatId = meta?.id;
  const dockMixer = useMemo(() => (chatId === undefined ? null : <DockMixer chatId={chatId} busy={busy} say={say} />), [chatId, busy, say]);
  // Lượt hỏi đáp từ Eleven Realtime được lưu vào đoạn chat như tin nhắn thường.
  const voiceTurn = (u: string, a: string) => {
    const now = Date.now();
    const msgs: Msg[] = [{ role: "user", text: u || "(Câu hỏi bằng giọng nói)", time: now }, { role: "ai", text: a, time: now, done: true }];
    if (view === "chat" && cur !== null) patch(cur, (m) => [...m, ...msgs]);
    else { setChats((cs) => [{ id: now, title: (u || a).slice(0, 40), msgs }, ...cs]); setCur(now); setView("chat"); }
  };
  const pill = false && (
    <div className="plan-pill">Gói Free · <a onClick={() => setModal("upgrade")}>Nâng cấp</a>{view === "chat" && <button aria-label={tr("Đóng")} onClick={() => setBanner(false)} style={{ display: "grid", marginLeft: 2 }}><I.X size={14} /></button>}</div>
  );
  const proj = projects.find((x) => x.id === curProj);
  const patchProj = (id: number, f: Partial<Project>) => setProjects((ps) => ps.map((x) => (x.id === id ? { ...x, ...f, upd: Date.now() } : x)));

  useEffect(() => {
    const total = (breakH === "–" ? 0 : parseInt(breakH) * 60) + (breakM === "–" ? 0 : parseInt(breakM));
    if (!total) return;
    const t = setInterval(() => { say(`Bạn đã dùng Synchro một lúc rồi — nghỉ giải lao ${total >= 60 ? total / 60 + " giờ" : total + " phút"} nhé`); }, total * 60000);
    return () => clearInterval(t);
  }, [breakH, breakM, say]);

  // Xuất đủ nội dung: đọc hết thân còn trong kho trước (bản rút gọn local chưa có tin nhắn); đoạn vẫn không đọc được thì bỏ ra và báo.
  const exportData = useEvent(async () => {
    const { chats: out, missing } = await chatsForExport();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile: { name, call, instructions: ins }, projects, chats: out }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "synchro-data-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say(missing ? tf("Đã xuất dữ liệu, nhưng tệp thiếu nội dung của {n} đoạn chat (chưa đọc được trên thiết bị này). Tải lại trang rồi xuất lại.", { n: missing }) : "Đã xuất dữ liệu");
  });
  // Xóa phiên trên máy chủ. Mặc định dữ liệu của tài khoản vẫn được giữ trên thiết bị (đã tách theo tài khoản) cho lần đăng nhập sau;
  // clear (hộp đăng xuất: "Xóa dữ liệu trên thiết bị này") xóa mọi khóa u:<uid>:* sau khi đã đẩy lên máy chủ (LogoutConfirm), đăng nhập lại thì tải về.
  const logout = (clear = false) => {
    const uid = userScope();
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    flushDirty();
    // Đóng kho đoạn chat (xóa thiết bị: đóng ngay vì cơ sở dữ liệu sắp bị xóa và mọi thứ đã lên máy chủ; không thì chờ lần lưu vừa rồi xong).
    void closeChats(clear);
    setUserScope(null); reloadPrefs(); resetCodePrefs(); clearJsonCache(); listAt.current = 0;
    if (clear) clearAccountData(uid);
    // Thôi theo dõi các câu trả lời đang chạy (không hủy ở máy chủ: đăng nhập lại thì trang nối vào lượt đó như khi tải lại).
    gens.current.clear(); runs.current.clear(); setRunning(new Set());
    approvalRef.current?.resolve({ decisions: {} }); setApproval(null);
    setChats([]); setProjects([]); setBanner(true); setModal(null); goNew(); setMe(null);
  };
  // Giá trị của AppCtx: các hàm ổn định (useEvent), chỉ đổi khi tài khoản đổi; hơn 50 chỗ dùng useApp() không vẽ lại theo từng mẩu chữ đang chảy.
  const logoutEv = useEvent(logout);
  const wipe = useEvent((what: "all" | "chats") => { if (saveT.current) { clearTimeout(saveT.current.t); saveT.current = null; } void wipeChats(); if (what === "all") ls.clear(); else ["chats", "projects", "model", "banner"].forEach((k) => ls.remove(k)); chatSync.wipeAll(chatsRef.current.filter((c) => !c.inc).map((c) => c.id), projects.map((p) => p.id)); setChats([]); setProjects([]); setBanner(true); goNew(); });
  const api = useMemo(() => ({
    say, exportData,
    upgrade: () => setModal("upgrade"),
    openSettings: (t?: string) => { setSettingsTab(t ?? "General"); setModal("settings"); },
    goCode: () => { setModal(null); setCodeCur(null); setView("code"); },
    close: () => setModal(null),
    ask: (t: string) => { setModal(null); setTimeout(() => { goNewRef.current(); setPrefill((p) => ({ t: tr(t), n: p.n + 1 })); }, 180); },
    confirm: (title: string, text: string, ok: string, fn: () => void, o?: { safe?: boolean }) =>
      setGc({ title, text, ok, fn, safe: o?.safe }),
    wipe, me: me ?? null, setMe, logout: logoutEv,
  }), [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Thanh bên và khung đoạn chat là component memo (Sidebar.tsx, Thread.tsx): nhận một ref hàm luôn trỏ tới bản mới nhất của Home
  // (gán mỗi lần vẽ như rowCx trước đây, chỉ đọc lúc bấm), nên hàm dựng lại mỗi lần vẽ không làm chúng vẽ lại.
  const sideHx = useRef<SideActs>(null!);
  sideHx.current = {
    goNew, openSearch: () => setModal("search"), setView, setCurProj, setCodeCur, codePatch, setCodeList, patchProj, setDelId, setDelProj, setEditProj, confirm: setGc, say,
    stop: (id) => stop(true, id), forget: (ids) => chatSync.forget("chat", ids), dropCode: (id) => { ls.remove("codeS:" + id); if (cpPage?.sync) deleteServerSession(id); },
  };
  const threadHx = useRef<ThreadActs>(null!);
  threadHx.current = {
    say, fm, openPlugins, openProviders: () => { setSettingsTab("Providers"); setModal("settings"); }, send: (t) => send(t), copy, speak, like, retry, switchModel, fork, resend,
    stop: () => stop(), undoLost, approvalDone: (a) => { approvalRef.current?.resolve(a); setApproval(null); }, runCritic, applyFix, restyle,
  };
  const altModels = models.providers.flatMap((p) => p.models).filter((x) => allowsModel(models.allowed, x.key)).length > 1;
  // Khối soạn tin ở đáy đoạn chat: phần tử dựng ở đây (chế độ studio, tin chờ gửi, ô soạn tin, dòng ghi chú) và chỉ dựng lại khi chính các giá trị
  // này đổi; khung đoạn chat nhận đúng phần tử cũ nên ô soạn tin không vẽ lại khi chữ đang chảy.
  const studio = meta?.studio;
  const queuedLater = useMemo(() => queued.filter((q) => q.chat === chatId && q.mode === "later"), [queued, chatId]);
  const dock = useMemo(() => (chatId === undefined ? null : <>
    {studio && (() => { const k = (Object.keys(STUDIO_OF) as TplKey[]).find((x) => STUDIO_OF[x] === studio)!; return (
      <div className="dock-mode"><span className={`mode-tag sm mt-${k}`}>{TPLS.find((x) => x.k === k)!.label}<button className="mode-x" aria-label="Bỏ chế độ" data-tip="Bỏ chế độ, để Synchro tự chọn"
        onClick={() => { setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, studio: undefined } : c))); say("Đã bỏ chế độ. Synchro sẽ tự chọn thư viện skill phù hợp."); }}><I.X size={12} /></button></span></div>); })()}
    <QueueChips items={queuedLater} onCancel={(qid) => setQueued((q) => q.filter((x) => x.id !== qid))} />
    <Composer {...composerProps} dock extra={dockMixer} />
    <div className="disclaimer dock-note"><span>Synchro là AI và có thể mắc lỗi. Vui lòng kiểm tra kỹ các câu trả lời.</span><ModelPicker model={model} setModel={setModel} /><UsageRing model={model} onDetails={() => { setSettingsTab("Usage"); setModal("settings"); }} /></div>
  </>), [chatId, studio, queuedLater, composerProps, dockMixer, model, langVer]); // eslint-disable-line react-hooks/exhaustive-deps
  // Menu tiêu đề đoạn chat (thanh trên cùng): trạng thái chung với thanh bên (Gắn thẻ, Đổi tên ngay trên dòng ở thanh bên).
  const titleMenu = useSideUi((st) => st.titleMenu), pickTag = useSideUi((st) => st.pickTag);
  const { setTitleMenu, setPickTag, setChatMenu, setRenaming } = useSideUi.getState();
  const tagsAll = useTagsAll();

  // Chưa biết đã đăng nhập chưa: người đã đăng nhập lần trước thấy ngay khung app (html[data-sess], layout.tsx), người mới thấy nền trống rồi tới màn hình đăng nhập.
  if (me === undefined || !langReady) return <div className="boot" aria-busy={!bootErr}><BootSkeleton chat={bootChat} />
    {bootErr && <div className="boot-err" role="alert"><Mark size={26} /><b>{tr("Chưa kết nối được tới Synchro")}</b><p>{tr("Đoạn chat và phần bạn đang gõ vẫn còn. Synchro đang tự thử lại.")}</p><button className="btn dark" onClick={() => bootRetry()}>{tr("Thử lại")}</button></div>}</div>;
  // Màn hình đăng nhập phủ lên app: khi xong, app hiện ngay bên dưới và màn hình này tan dần (authLeaving).
  const needProfile = !!me?.needsProfile;
  const authEl = !me || needProfile || authLeaving || authHold || expired ? (
    <AuthComponent key="auth" brandName="Synchro" signupOpen={signupOpen} logo={<Lockup height={22} intro className="lk-hover" />} providers={providers} mode={needProfile ? "profile" : "auth"} user={expired ? null : me} leaving={authLeaving} again={expired} notice={expired ? tr("Phiên đăng nhập đã hết hạn. Đăng nhập lại để dùng tiếp, phần đang làm vẫn được giữ.") : undefined}
      toFilm={intro} onReveal={() => setReveal("login")}
      onDone={(u, kind) => {
        setExpired(false);
        enterAccount(u); syncProfile(u); setMe(u);
        if (u.needsProfile) return;
        if (wantsIntro(u, kind)) { setAuthHold(true); setIntro(true); } else setAuthLeaving(true);
      }} onLeft={() => { setAuthLeaving(false); setReveal(""); }} onSignOut={() => { setExpired(false); logout(); }} />
  ) : null;
  if (!me || needProfile) return <>{null}{authEl}</>;

  return (<>
    <AppCtx.Provider value={api}>
      <ConnLoginWatcher say={say} />
    <a className="skip-link" inert={expired} href="#main" onClick={(e) => { e.preventDefault(); const el = document.querySelector<HTMLElement>("#main textarea") ?? document.querySelector<HTMLElement>("#main"); el?.focus(); }}>Đến nội dung chính</a>
    {/* Phiên hết hạn: màn hình đăng nhập phủ lên trên, bên dưới không nhận tiêu điểm, phím hay trình đọc màn hình (trước đây chữ gõ vẫn rơi vào ô soạn tin bị che). */}
    <div inert={expired} className={`app ${view === "code" && codeEmpty ? "code-view" : ""}${reveal ? ` app-reveal reveal-${reveal}` : ""}`}>
      {view === "code" && codeEmpty && <div className="code-bg"><HalftoneBg /></div>}
      <div className={`shell-side ${open ? "" : "closed"}`} onClickCapture={(e) => {
        // Bấm vào một mục khác (không thuộc nhóm Speech) thì thu gọn danh sách công cụ Speech.
        const t = e.target as HTMLElement;
        if (spOpen && t.closest(".nav-item,.chat-item,.user,.icon-btn") && !t.closest(".nav-row,.nav-sub")) setSpOpen(false);
        if (narrow() && t.closest(".nav-item,.chat-item") && !t.closest(".nav-row > .icon-btn, .chat-item .icon-btn, .chat-item input, [data-bk]")) setTimeout(() => setOpen(false), 0);
        // U3, 761–860px: thanh điều hướng đứng trên lớp phủ (để bấm được mục) nhưng vẫn là "bên ngoài" bảng đoạn chat nổi: bấm chỗ trống hay nút
        // Tìm kiếm trên thanh cũng đóng bảng. Trừ logo (tự bật / tắt bảng) và ảnh đại diện cùng menu của nó. Điện thoại: thanh nằm trong ngăn kéo.
        else if (open && t.closest(".rail") && !t.closest(".rail-mark, .rail-user, .menu") && window.matchMedia("(min-width: 761px) and (max-width: 860px)").matches) setTimeout(() => setOpen(false), 0);
      }}>
      {/* Thanh điều hướng dọc: luôn hiện trên máy tính (cả khi thu bảng đoạn chat), có nhãn dưới icon; mục đang mở có ô icon màu mực. */}
      <nav className="rail" aria-label="Điều hướng">
        {/* Logo trong vòng tròn; rê chuột vào thì thành nút mở / đóng bảng đoạn chat. */}
        <button className="rail-mark" onClick={() => setOpen(!open)} aria-label={open ? "Đóng bảng đoạn chat" : "Mở bảng đoạn chat"} aria-expanded={open} data-tip={open ? "Đóng bảng đoạn chat" : "Mở bảng đoạn chat"}>
          <span className="rm-logo"><Mark size={18} /></span><span className="rm-panel"><I.Panel size={16} /></span>
        </button>
        <button className={`nav-item rail-new ${view === "new" ? "active" : ""}`} aria-current={view === "new" ? "page" : undefined} onClick={goNew} data-tip="⇧⌘O"><span className="rail-ic"><I.Plus /></span><span className="rail-l">Mới</span></button>
        <div className="rail-nav">
          {me?.perms.features.projects !== false && nav({ v: "projects", icon: <I.Layers />, label: "Dự án" })}
          {caps.art !== false && nav({ v: "artifacts", icon: <I.Shapes />, label: "Artifacts" })}
          {nav({ v: "autopilot", icon: <I.Autopilot />, label: "Autopilot", badge: inboxN })}
          {nav({ v: "brain", icon: <I.Brain />, label: "Bộ não" })}
          {me?.perms.features.code !== false && nav({ v: "code", icon: <I.Code />, label: "Code", onPick: () => {
            // Rời Code khi lượt đang chạy rồi quay lại thì về đúng phiên đó, không phải trang trống. Đang ở trong Code mà bấm lại thì mới là mở phiên mới.
            const live = view !== "code" ? (codeList.find((c) => c.id === codeCur && c.running) ?? codeList.find((c) => c.running)) : undefined;
            setCodeCur(live ? live.id : null);
          } })}
          {me?.perms.features.speech !== false && (speechReady || me?.isAdmin) && nav({ v: "speech", icon: <I.Speech />, label: "Speech", onPick: () => setSpTool("home") })}
          {me?.perms.features.skills !== false && nav({ v: "customize", icon: <I.Plugins />, label: trc("Skill", "tên mục"), tip: "Kho kỹ năng" })}
        </div>
        <div className="rail-foot">
          <button className="icon-btn rail-btn" onClick={() => setModal("search")} aria-label="Tìm kiếm" data-tip="⌘K"><I.Search size={17} /></button>
          <div ref={userRef} className="rail-user">
            <button className="user" onClick={() => setUserMenu(!userMenu)} aria-haspopup="menu" aria-expanded={userMenu} aria-label={name} title={name} data-notr><Avatar name={name} /></button>
            <Menu open={!!(userMenu)} style={{ bottom: 0, left: "calc(100% + 10px)", width: 300 }} className="usermenu">
              <div className="um-head"><Avatar name={name} /><span><b data-notr>{shortName(name)}</b><em data-notr>{me.email}</em></span></div>
              <hr />
              <button className="menu-item" onClick={() => { setSettingsTab("General"); setModal("settings"); setUserMenu(false); }}><I.Cog />Cài đặt<span className="sc">⇧⌘,</span></button>
              <button className="menu-item" onClick={() => { setModal("lang"); setUserMenu(false); }}><I.Globe />Ngôn ngữ</button>
              <hr />
              <button className="menu-item" onClick={() => { window.open("/download", "_blank", "noopener"); setUserMenu(false); }}><I.GetApps />Tải ứng dụng</button>
              <button className="menu-item" onClick={() => { setModal("keys"); setUserMenu(false); }}><I.Keyboard />Phím tắt<span className="sc">⌘/</span></button>
              <hr />
              <button className="menu-item" onClick={() => { setModal("logout"); setUserMenu(false); }}><I.Out />Đăng xuất</button>
            </Menu>
          </div>
        </div>
      </nav>
      <Sidebar view={view} cur={cur} curProj={curProj} codeCur={codeCur} codeList={codeList} approvalChat={approval?.chat ?? null} speech={view === "speech" && me?.perms.features.speech !== false} hx={sideHx} />
      </div>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <main id="main" tabIndex={-1} className={`main ${panelOpen ? `has-art ${artFull ? "art-full" : ""}` : ""}`}>
        <VerifyBanner me={me ?? null} onChange={setMe} />
        <div className="sr-only" role="status" aria-live="polite" data-notr>{sayAt}</div>
        <SyncWarn onExport={exportData} />
        {view !== "code" && view !== "speech" && view !== "brain" && <div className="topbar">
          <div className="left">
            {!open && <SideToggle onClick={() => setOpen(true)} />}
            {view === "chat" && meta && (
              <div className="title-wrap" style={{ position: "relative" }}>
                <button className="sel" style={{ fontSize: 14 }} aria-haspopup="menu" aria-expanded={titleMenu} onClick={() => { setTitleMenu(!titleMenu); setPickTag(false); setChatMenu(null); }}><span className="sel-t" data-notr>{meta.title}</span><I.Chevron size={14} /></button>
                  <Menu open={!!(titleMenu)} className="down" style={{ top: 36, left: 0, width: pickTag ? 240 : 200 }}>
                    {pickTag && titleMenu ? <TagPicker tags={cleanTags(meta.tags)} all={tagsAll} onChange={(t) => setChatTags(meta.id, t)} onBack={() => setPickTag(false)} /> : <>
                    <button className="menu-item" onClick={() => { togglePin(meta.id); setTitleMenu(false); }}>{meta.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{meta.pinned ? "Bỏ ghim" : "Ghim"}</button>
                    <button className="menu-item" onClick={() => { setRenaming(meta.id); setOpen(true); setTitleMenu(false); }}><I.Pencil />Đổi tên</button>
                    <button className="menu-item" onClick={() => setPickTag(true)}><I.Icon name="Tag" />Gắn thẻ{meta.tags?.length ? <span className="sc tag-n">{meta.tags.length}</span> : <span className="sc"><I.ChevronR size={16} /></span>}</button>
                    <button className="menu-item" onClick={() => { setTitleMenu(false); autoTitle(meta.id, true); }}><I.Sparkle />Đặt tên tự động</button>
                    <hr />
                    <button className="menu-item del" onClick={() => { setDelId(meta.id); setTitleMenu(false); }}><I.Trash />Xóa</button>
                    </>}
                  </Menu>
              </div>
            )}
            {view === "chat" && meta ? <TagChips tags={cleanTags(meta.tags)} onPick={filterTag} onOpen={() => { setChatMenu(null); setTitleMenu(true); setPickTag(true); }} /> : null}
          </div>
          {(view === "new" || view === "chat") && pill}
          <div className="right">
            {view === "new" && <button className={`icon-btn ${incog ? "ghost-on" : ""}`} onClick={() => { armDraft(); setIncog(!incog); say(incog ? "Đã tắt chế độ ẩn danh" : "Chế độ ẩn danh: không lưu vào lịch sử, không vào Bộ não"); }} aria-label="Ẩn danh" aria-pressed={incog}><I.Ghost /></button>}
            {view === "chat" && prodN > 0 && !panelOpen && <button className="btn prod-btn" onClick={() => openLastProduct()} title={tr("Xem trước sản phẩm của đoạn chat")}><I.Eye size={15} />{tr("Sản phẩm")}<span className="prod-n">{prodN}</span></button>}
            {view === "chat" && meta && brwOk && <button className={`icon-btn brw-btn ${brwShow ? "on" : ""}`} onClick={() => { setArtSel(null); setFileSel(null); setBrwFor(brwShow ? null : meta.id); }} aria-label={brwShow ? "Đóng trình duyệt" : "Mở trình duyệt"} data-tip={brwShow ? "Đóng trình duyệt" : "Trình duyệt"}><I.Globe size={17} />{meta.browser && <span className="brw-dot" aria-hidden />}</button>}
            {view === "chat" && <button className="btn" onClick={() => setModal("share")}>Chia sẻ</button>}
          </div>
        </div>}

        {view === "new" && (
          <div className="hero" key={String(incog)}>
            <div className="hero-col">
            <div className="hero-date" data-notr>{new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}</div>
            <h1 className="greeting">{incog && <I.Ghost size={26} />}<FitLine className="greet-t">{incog ? "Đoạn chat ẩn danh" : <>{greet[0]}{greet[1] && <>, <span data-notr>{greet[1]}</span></>}</>}</FitLine></h1>
            {models.loaded && !models.providers.length && (!model || modelsSettled()) && (
              <section className="ob-card" aria-labelledby="ob-t">
                <b id="ob-t">Kết nối gói AI của bạn để bắt đầu</b>
                <p>Synchro chạy bằng chính tài khoản AI của bạn. ChatGPT, Gemini và Grok dùng được cả tài khoản miễn phí, Claude cần gói Pro hoặc Max. Đăng nhập một tài khoản là chat được ngay, tin bạn đã gõ dưới đây vẫn được giữ.</p>
                <div className="ob-row">
                  {([["anthropic", "Claude"], ["openai", "ChatGPT"], ["google", "Gemini"], ["xai", "Grok"]] as const).map(([id, n]) => <button key={id} className="btn" data-notr onClick={() => { try { sessionStorage.setItem("pv-open", id); } catch {} setSettingsTab("Providers"); setModal("settings"); }}><BrandLogo id={id} size={16} />{n}</button>)}
                </div>
              </section>
            )}
            <Composer {...composerProps} placeholder={tplMode ? TPLS.find((x) => x.k === tplMode)?.ph : undefined} />
            {!tplMode && !incog && caps.art !== false && (
              <div className="hero-quick" aria-label="Bắt đầu nhanh">
                {TPLS.map((t) => { const Ic = t.k === "doc" ? I.Article : t.k === "slides" ? I.Slides : I.PenNib; return (
                  <button key={t.k} className="hero-chip" onClick={() => setTplMode(t.k)}><Ic size={16} /><span>{t.name}</span></button>); })}
                {models.providers.some((p) => p.plan && IMAGE_PLANS.has(p.plan.cli)) && <button className="hero-chip" data-tip="Tạo ảnh chụp, tranh, logo, poster bằng gói đã đăng nhập" onClick={() => setPrefill((p) => ({ t: tf("Tạo ảnh {what}", { what: "" }), n: p.n + 1 }))}><I.Image size={16} /><span>Tạo ảnh</span></button>}
              </div>
            )}
            {tplMode && !incog && (() => { const t = TPLS.find((x) => x.k === tplMode)!; return (
              <div className="modewrap" key={tplMode}>
                <div className="modebar">
                  <span className={`mode-tag mt-${t.k}`}>{t.label}<button className="mode-x" onClick={() => setTplMode(null)} aria-label="Bỏ chế độ" data-tip="Bỏ chế độ, để Synchro tự chọn"><I.X size={12} /></button></span>
                  {/* Thư viện skill của studio: bấm để xem / cài plugin. */}
                  {studios[STUDIO_OF[t.k]] ? <button className="mode-sys" onClick={openPlugins} title={studios[STUDIO_OF[t.k]]!.name}><I.Plugins size={16} />Thư viện {fmtCount(studios[STUDIO_OF[t.k]]!.skills)} skill</button>
                    : <button className="mode-sys" onClick={openPlugins}><I.Plugins size={16} />Cài thư viện {t.k === "doc" ? "tài liệu" : t.k === "slides" ? "trình bày" : "thiết kế"}</button>}
                </div>
                <div className="starters">
                  {STARTERS[t.k].map((x) => (
                    <button key={x.t} className={`starter mt-${t.k}`} onClick={() => setPrefill((p) => ({ t: tr(x.p), n: p.n + 1 }))}><b>{x.t}</b><span>{x.d}</span></button>
                  ))}
                </div>
              </div>); })()}
            {incog ? <p className="muted hero-note">Đoạn chat ẩn danh sẽ không được lưu vào lịch sử</p> : null}
            </div>
          </div>
        )}

        {view === "chat" && meta && <ChatThread busy={busy} copied={copied} speaking={speaking} model={model} altModels={altModels} undoFor={undoTurn?.chat ?? null} approval={approval} brw={brw} dock={dock} hx={threadHx} />}

        <Boundary resetKey={`${view}-${curProj}`}>
        {view === "projects" && (
          <ProjectsFor projects={projects} say={say} onNew={() => setModal("proj")} onOpen={(id) => { setCurProj(id); setView("project"); }} patch={patchProj} onEdit={(id) => setEditProj(id)} onDelete={(id) => setDelProj(id)}
            onDeleteMany={(ids) => { const del = new Set(ids); setProjects((ps) => ps.filter((x) => !del.has(x.id))); chatSync.forget("project", ids); setChats((cs) => cs.map((c) => (c.project !== undefined && del.has(c.project) ? { ...c, project: undefined } : c))); if (curProj !== null && del.has(curProj)) setCurProj(null); }} />
        )}

        {view === "project" && proj && (
          <ProjectFor proj={proj} say={say} patch={patchProj} onBack={() => setView("projects")} onOpenChat={(id) => { setCur(id); setView("chat"); }} onEdit={() => setEditProj(proj.id)} onDelete={() => setDelProj(proj.id)}
            onChats={(ids, op) => { const set = new Set(ids); if (op === "delete") { for (const x of ids) if (running.has(x)) stop(true, x); chatSync.forget("chat", ids); } setChats((cs) => (op === "delete" ? cs.filter((c) => !set.has(c.id)) : cs.map((c) => (set.has(c.id) ? { ...c, project: undefined } : c)))); if (op === "delete" && cur !== null && set.has(cur)) setCur(null); }}
            composer={<Composer {...composerProps} placeholder="Hôm nay tôi có thể giúp gì cho bạn?" focusPlaceholder="Nhập / để dùng Skills" />} />
        )}

        {view === "artifacts" && (
          <div className="page ds-page ds-art"><div className="page-in">
            <header className="ds-head">
              <div className="ds-head-t"><h1>Artifacts</h1><p>Tài liệu, trang trình bày, thiết kế và ứng dụng bạn làm cùng Synchro.</p></div>
              <label className="ds-search"><I.Search size={16} /><input placeholder="Tìm artifact" value={artQ} onChange={(e) => setArtQ(e.target.value)} />{artQ && <button className="ds-clear" aria-label="Xóa" onClick={() => setArtQ("")}><I.X size={14} /></button>}</label>
            </header>
            <Studio items={TPLS.map((t) => ({ k: t.k, name: t.name, desc: t.desc, lib: studios[STUDIO_OF[t.k]] ?? null }))} onCreate={(k) => { setTplMode(k); setView("new"); }} />
            <div className="ds-bar">
              <div className="ds-seg" role="tablist">
                {["Tất cả", "Của bạn", "Được chia sẻ", "Ứng dụng"].map((t, i) => <button key={t} role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t}</button>)}
              </div>
            </div>
            {tab === 3 ? <AppsGallery q={artQ} say={say} /> : <ArtifactsGallery tab={tab} q={artQ} ai={caps.ai} say={say} refreshKey={artRefresh}
              onOpenChat={(conv) => { const c = chatsRef.current.find((x) => String(x.id) === conv); if (!c) return false; setCur(c.id); setView("chat"); return true; }} />}
          </div></div>
        )}

        {view === "autopilot" && <AutopilotPage say={say} model={model} onOpenChat={openAsChat} />}
        {view === "customize" && <CustomizePage tab={czTab} setTab={setCzTab} connectors={<ConnectorsPanel />} feats={{ skills: me?.perms.features.skills !== false, connectors: me?.perms.features.connectors !== false }} />}
        {view === "code" && <CodeView say={say} onMeta={onCodeMeta} onEmpty={setCodeEmpty} sid={codeCur} title={codeList.find((c) => c.id === codeCur)?.title ?? "Synchro Code"} model={model} modelPicker={<ModelPicker model={model} setModel={setModel} prefix="Model" />} sideOpen={open} onSide={() => setOpen(true)} onNew={() => setCodeCur(null)} onCreate={(id, title) => { setCodeList((l) => [{ id, title }, ...l]); setCodeCur(id); }} />}
        {view === "brain" && <BrainWorkspace initial={brainAt} onInitial={() => setBrainAt(null)} sideOpen={open} onSide={() => setOpen(true)} />}
        {view === "speech" && <SpeechView say={say} tool={spTool} setTool={setSpTool} sideOpen={open} onSide={() => setOpen(true)} />}
        </Boundary>
      </main>

      {drag && <div className="drop"><div className="drop-in"><div className="drop-ic"><I.Image size={30} /><I.Copy size={30} /><I.Folder size={30} /></div><span>Thả tệp vào đây</span></div></div>}
      <Toast text={toast} />
      {voiceOn && <VoiceFor onClose={() => setVoiceOn(false)} onAsk={(t) => send(t)} onTurn={voiceTurn} busy={busy} rate={VOICE_RATE[vspeed] ?? 1} voice={vvoice} say={say} />}
      <Fade show={!!(modal === "settings")}><Settings initial={settingsTab} onTab={setSettingsTab} onClose={() => setModal(null)} theme={theme} setTheme={setTheme} /></Fade>
      <Fade show={!!(modal === "lang")}><LangModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "search")}><PaletteFor projects={projects} codes={codeList} cmds={paletteCmds} go={paletteGo} seed={palSeed} onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "share" && meta)}>{meta ? <ShareFor onClose={() => setModal(null)} say={say} /> : <></>}</Fade>
      {fm.node}
      <Fade show={!!(modal === "upload")}>
        <UploadModal
          say={say}
          onConverted={(f, md) => {
            const r = attachFiles(files, [f], say);
            saveDoc(r.keys[0], md);
            setFiles((o) => addKeys(o, r.keys, say));
            setModal(null);
            say(r.note ?? `Đã chuyển thành ${f.name}`);
          }}
          onClose={() => setModal(null)}
          onFiles={(f) => {
            const r = attachFiles(files, f, say);
            setFiles((o) => addKeys(o, r.keys, say));
            setModal(null);
            say(r.note ?? `Đã thêm ${f.length} tệp`);
          }}
        />
      </Fade>
      <Fade show={!!(modal === "upgrade")}><UpgradeModal onClose={() => setModal(null)} say={say} /></Fade>
      <Fade show={!!(modal === "keys")}><ShortcutsModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "logout")}><LogoutConfirm localOnly={modal === "logout" && !cpPage?.sync ? ls.keys().filter((k) => k.startsWith("codeS:")).length : 0}
        flush={async () => { flushDirty(); const a = await chatSync.flush(); if (!cpPage?.sync) return a; const codeIds = ls.keys().filter((k) => k.startsWith("codeS:")).map((k) => Number(k.slice(6))).filter((n) => Number.isFinite(n)); return a + await flushAllNow(codeIds); }}
        onCancel={() => setModal(null)} onOk={(clear) => { setModal(null); logout(clear); }} /></Fade>
      <Fade show={!!(delId !== null)}><Confirm title="Xóa đoạn chat?" text="Đoạn chat sẽ bị xóa khỏi mọi thiết bị, cùng với lịch sử phiên của model, ghi chú trong Bộ não, liên kết chia sẻ, và tệp chỉ đoạn chat này dùng. Bản đã có trong sao lưu của máy chủ mất đi theo vòng xoay, tối đa khoảng 5 tuần. Không hoàn tác được." ok="Xóa" onCancel={() => { setDelId(null); setDelArts(false); }} onOk={() => { if (delId !== null) { if (delArts) void fetch(`/api/artifacts?conv=${delId}`, { method: "DELETE" }).catch(() => {}); removeChat(delId); } setDelId(null); setDelArts(false); say("Đã xóa đoạn chat"); }}><label style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 16px", fontSize: 14 }}><input type="checkbox" checked={delArts} onChange={(e) => setDelArts(e.target.checked)} />Xóa cả artifact của đoạn chat này (nếu không, chúng vẫn ở trang Artifacts)</label></Confirm></Fade>
      <Fade show={!!(delProj !== null)}><Confirm title="Xóa dự án?" text="Dự án sẽ bị xóa. Các đoạn chat bên trong vẫn được giữ lại." ok="Xóa" onCancel={() => setDelProj(null)} onOk={() => { setProjects((ps) => ps.filter((x) => x.id !== delProj)); if (delProj !== null) chatSync.forget("project", [delProj]); setChats((cs) => cs.map((c) => (c.project === delProj ? { ...c, project: undefined } : c))); setDelProj(null); say("Đã xóa dự án"); }} /></Fade>
      <Fade show={!!(modal === "proj")}><ProjectModal onClose={() => setModal(null)} onCreate={(n, d) => { const id = Date.now(); setProjects([{ id, name: n, desc: d, upd: id, pinned: true }, ...projects]); setModal(null); setCurProj(id); setView("project"); say("Đã tạo dự án"); }} /></Fade>
      <Fade show={editProj !== null}><ProjectModal title="Chỉnh sửa dự án" ok="Lưu" init={projects.find((x) => x.id === editProj)} onClose={() => setEditProj(null)} onCreate={(n, d) => { if (editProj !== null) patchProj(editProj, { name: n, desc: d }); setEditProj(null); say("Đã cập nhật dự án"); }} /></Fade>
      <Fade show={!!gc}>
        <Confirm title={gc?.title ?? ""} text={gc?.text ?? ""} ok={gc?.ok ?? ""} safe={gc?.safe}
          onCancel={() => setGc(null)} onOk={() => { gc?.fn(); setGc(null); }} />
      </Fade>
    </div>
    </AppCtx.Provider>
    {authEl}
    {intro && me && <IntroFilm uid={me.id} onCovered={() => setAuthHold(false)} onReveal={() => setReveal("film")}
      onDone={() => { setReveal(""); setIntro(false); }} />}
  </>);
}
