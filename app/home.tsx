"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Avatar } from "./avatar";
import { getLang, tr, trCx, useLangReady } from "./i18n";
import { resetClock, resetAt } from "./resetfmt";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc, saveBlob, fileContext } from "./filemenu";
import { capFiles, getStatus, abortFile } from "./filestate";
import { UPLOAD_ACCEPT } from "./fileproc/types";
import { stripAppliedNotes, type Rejected } from "./turnctx";
import { Boundary, Fade, Menu, Thinking } from "./ui";
import { chatError, GENERIC_ERR, isForeign } from "./chaterror";
import { armDraft, saveDraft, takeDraft } from "./draft";
import { Lockup, Mark, SideToggle, Wordmark } from "./brand";
import { BrandLogo, ModelLogo, ProviderLogo } from "./brands";
import { BulkBar, BulkCheck, bulkRow, useBulk, type BulkAct } from "./bulk";
import { Pager, usePage } from "./pager";
import { lazyView } from "./lazy";
import type { CodeMeta } from "./codeview";
import { answerAsk, deleteServerSession, flushAllNow, listServerSessions, patchServerSession, pushSession, resetCodePrefs, seedCodePrefs, useCodePrefs, type SessionState } from "./codesync";
import type { SpeechTool } from "./speech/data";
import { usePlan as useSpeechPlan } from "./speech/client";
import { aiVoiceNote, elSpeed, speakAI, type Speaking } from "./speak";
import { toSpeech, VI } from "./voiceflow";
import { ConnLoginWatcher } from "./connwatch";
import { readBrowser, stopBrowserRead } from "./browserspeak";
import { applyEvent, ConnCards, PlanCard, QueueChips, stepsOf, WorkParts, WorkStatus, WorkSummary, type Queued, type RunEv } from "./worklog";
import { startScribe, type Scribe } from "./scribe";
import type { AuthUser, Providers } from "./auth";
import { VerifyBanner } from "./verifybanner";
import { CiteCtx, SourceChips } from "./cites";
import { allTags, cleanTags, hasTag, tagKey } from "./chattags";
import { TagChips, TagFilter, TagPicker } from "./tagsui";
import { Markdown } from "./md";
import type { PaletteCmd, PaletteGo } from "./palette";
import { CHIP_LIMIT } from "./composerchips";
import { AttachStrip } from "./attachstrip";
import { ASK_EVENT } from "./askcard";
import { installTips } from "./tips";
import { fit as fitFloat, installFloatFit } from "./floatfit";
import { installA11y } from "./a11y";
import { steerRun } from "./llm";
import { attachRun, callLLM, olderDigest, cancelRun, LLMError, setActiveEffort, setActiveModel, setApprover, type ApprovalCall, type ApprovalAnswer, type RunMeta, type LibUse, type Decision, buildSystemPrompt, extractMemory, getRelevantContext, HISTORY_LIMIT, MEMORY_EVERY_N_USER_MSGS, type LLMMsg } from "./llm";
import { Confirm, LangModal, LogoutConfirm, ProjectModal, Settings, ShortcutsModal, UploadModal, UpgradeModal } from "./modals";
import { ShareModal } from "./shareui";
import { useBrainSync } from "./brainsync";
import { countRender } from "./perfmark";
import { useChatState, useChatStore } from "./chatstore.client";

// Trình duyệt của Synchro (khung cạnh chat, trang Trình duyệt): vé xem màn hình trực tiếp.
const browserTicket = () => fetch("/api/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "ticket" }) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.error || "Không mở được trình duyệt."); return j.url as string; });

// Tên tạm khi vừa tạo đoạn chat (trước khi model đặt tên theo nội dung): câu đầu của tin nhắn, bỏ ký hiệu Markdown và tham số công cụ.
const roughTitle = (t: string) => {
  const s = t.replace(/#(?:tool|args)=\S+/g, "").replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/g, "$1").replace(/[*_`#>~|[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const first = /^(.{8,60}?)[.!?…](\s|$)/.exec(s)?.[1] ?? s;
  const cut = first.length > 48 ? `${first.slice(0, 48).replace(/\s+\S*$/, "")}…` : first;
  return cut ? cut[0].toUpperCase() + cut.slice(1) : t.slice(0, 40);
};
// Tin đầu chỉ là lời chào / quá ngắn: tên đặt lúc đầu chưa nói được gì, đặt lại khi đoạn chat đã rõ chủ đề (tin thứ ba).
// Nhãn công cụ đã dùng: Composio là "<ứng dụng> · <thao tác>", thao tác dịch theo ngôn ngữ giao diện; connector khác giữ nguyên.
const toolChip = (n: string) => { const i = n.indexOf(" · "); return i > 0 ? `${n.slice(0, i)} · ${trCx(n.slice(i + 3))}` : n; };
const vagueMsg = (t: string) => t.trim().split(/\s+/).length <= 3 || /^(xin )?ch[àa]o|^(hi|hello|hey|alo|test)\b/i.test(t.trim());
type View = "new" | "chat" | "projects" | "project" | "artifacts" | "customize" | "code" | "speech" | "inbox" | "brain";
// U6: mỗi mục có một địa chỉ #v=… để Back / liên kết / F5 mở đúng trang (đoạn chat vẫn dùng #c=, Cài đặt dùng #s=<tab>).
// "project" (chi tiết một dự án) dùng chung #v=projects với danh sách dự án. "new"/"chat" không có #v=.
const HASH_VIEW: Partial<Record<View, string>> = { projects: "projects", project: "projects", artifacts: "artifacts", inbox: "inbox", brain: "brain", code: "code", speech: "speech", customize: "skills" };
const VIEW_OF_HASH: Record<string, View> = { projects: "projects", artifacts: "artifacts", inbox: "inbox", brain: "brain", code: "code", speech: "speech", skills: "customize" };
import { AppCtx, chatFont, useApp, VOICE_LANG, VOICE_RATE, initials, readPref, reloadPrefs, resetPrefs, usePref, type Chat, type Msg, type Project } from "./store";
import { IMAGE_PLANS, allowsModel, clampEffort, effortCap, effortsFor, isEffort, legacyModel, type Effort } from "./catalog";
import { AUTO, autoTaskName, fitModel, modelName, modelsSettled, refreshModels, seedModels, useModels } from "./models";
import type { BootData } from "./bootdata";
import { seedInboxCount } from "./inboxcount";
import { loadMe, watchSession } from "./session";
import { useFitPlaceholder } from "./phfit";
import type { ProviderInfo } from "./catalog";
import { useInboxCount } from "./inboxcount";
import { adoptLegacyData, clearAccountData, ls, setUserScope, userScope } from "./userscope";
import { prefetchChats, useChatSync, useSyncStatus } from "./chatsync";
import { shortName } from "./names";
import { loadCaps, seedCaps, useCaps } from "./capsclient";
import { ART_LABEL, artifactsAsCode, hasArtifacts, PUBLISHABLE, splitArtifacts, type ArtBlock } from "./artifacts";
import { ArtPanelSkeleton, BootSkeleton, ChatListSkeleton, ThreadSkeleton } from "./skeleton";
import { resolveArt, type ArtVersion } from "./vfs";
import { criticKey, fixPatch, important, type CriticEntry, type Finding } from "./critic";
import { chatHistory, continuable, mixExtra } from "./history";
import { ContextMixer } from "./mixer";
import { ArtifactCard, OutputFiles, saveArtifacts } from "./artifactcard";
import { GEN_IMG_EVENT } from "./artgen";
import type { Product } from "./filepreview";
import type { OutFile } from "./llm";
import { UsageRing } from "./usagering";
import { cachedJson, clearJsonCache, fmtCount, HUB_DISCOVER, HUB_SEARCH, seedMeta, useStudios } from "./studios";
import type { CzTab } from "./pluginsui";
import { ConnLogo } from "./connlogo";
import type { ComposioInfo, Conn } from "./connectorsui";
// Dữ liệu connector cho menu + ở ô chat: Composio (connector chính) và connector người dùng tự thêm.
// err: lần tải danh sách hỏng (mạng, máy chủ lỗi) — khác với "chưa có connector nào"; menu hiện nút Thử lại thay vì báo trống.
type CxData = { connectors: Conn[]; composio?: ComposioInfo; err?: boolean };
import { wantsIntro } from "./introflag";
import { rowHeight } from "./rowsize";
import { startWarmPing, warmChoice } from "./warmping";
import { decodeSettingsTab, hashStep, settingsHash } from "./hashnav";
type Say = (m: string) => void;

// Trang đầu chỉ tải phần chat; các mục khác, hộp thoại và màn hình đăng nhập tải khi cần (rê chuột vào mục thì tải trước).
const CodeView = lazyView(() => import("./codeview").then((m) => m.CodeView));
const SpeechView = lazyView(() => import("./speech/view").then((m) => m.SpeechView));
// Công cụ Speech ở thanh bên: danh mục công cụ chỉ tải khi đang ở Speech (blueprint B3.3).
const SpeechSideTools = lazyView(() => import("./speech/sidetools").then((m) => m.SpeechSideTools), null);
const BrainWorkspace = lazyView(() => import("./brainui").then((m) => m.BrainWorkspace));
const InboxPage = lazyView(() => import("./tasksui").then((m) => m.InboxPage));
const CustomizePage = lazyView(() => import("./pluginsui").then((m) => m.CustomizePage));
const ConnectorsPanel = lazyView(() => import("./connectorsui").then((m) => m.ConnectorsPanel));
const ProjectsPage = lazyView(() => import("./projects").then((m) => m.ProjectsPage));
const ProjectPage = lazyView(() => import("./projects").then((m) => m.ProjectPage));
const Studio = lazyView(() => import("./studio").then((m) => m.Studio), null);
const AppsGallery = lazyView(() => import("./appsui").then((m) => m.AppsGallery));
const ProjMenu = lazyView(() => import("./projects").then((m) => m.ProjMenu), null);
const PublishButton = lazyView(() => import("./appsui").then((m) => m.PublishButton), null);
const BrowserHub = lazyView(() => import("./browserhub").then((m) => m.BrowserHub));
// Khung xem tệp / artifact đang tải phần mã: khung chờ cùng chỗ, cùng bề rộng, có sẵn tên (cột chat không co giãn hai lần).
const FilePanel = lazyView(() => import("./filepreview").then((m) => m.FilePanel), (p) => <ArtPanelSkeleton title={p.file.name} expanded={p.expanded} acts={3} />);
const ArtifactPanel = lazyView(() => import("./artifactui").then((m) => m.ArtifactPanel), (p) => { const a = p.versions[p.index] ?? p.versions.at(-1); return <ArtPanelSkeleton title={a?.title} sub={a ? tr(ART_LABEL[a.type]) : undefined} tabs={!!a && a.type !== "code"} expanded={p.expanded} acts={6} />; });
const ArtifactsGallery = lazyView(() => import("./artifactui").then((m) => m.ArtifactsGallery));
const ProductSwitcher = lazyView(() => import("./filepreview").then((m) => m.ProductSwitcher), null);
const ApprovalCard = lazyView(() => import("./connectorsui").then((m) => m.ApprovalCard), null);
const ReconnectLink = lazyView(() => import("./connectorsui").then((m) => m.ReconnectLink), null);
const SaveSkillChip = lazyView(() => import("./saveskill").then((m) => m.SaveSkillChip), null);
const VoiceMode = lazyView(() => import("./voicemode").then((m) => m.VoiceMode), null);
const CommandPalette = lazyView(() => import("./palette").then((m) => m.CommandPalette), null);
const AuthComponent = lazyView(() => import("./auth").then((m) => m.AuthComponent), null);
const IntroFilm = lazyView(() => import("./introfilm").then((m) => m.IntroFilm), null);
const HalftoneBg = lazyView(() => import("./halftone").then((m) => m.HalftoneBg), null);
// Khách chưa đăng nhập lần nào: tải sẵn màn hình đăng nhập ngay từ đầu.
if (typeof document !== "undefined" && !document.documentElement.dataset.sess) AuthComponent.preload();
const PRELOAD: Partial<Record<View, () => void>> = { artifacts: ArtifactsGallery.preload, code: CodeView.preload, speech: SpeechView.preload, brain: BrainWorkspace.preload, inbox: InboxPage.preload, customize: CustomizePage.preload, projects: ProjectsPage.preload };

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

// Thư viện skill một câu trả lời đã dùng: chế độ studio người dùng chọn, hoặc thư viện model tự mở, kèm skill đã đọc.
function LibChips({ libs, onOpen }: { libs: LibUse[]; onOpen: () => void }) {
  return <div className="skill-used">{libs.map((l) => (
    <button key={l.key} className="skill-chip lib-chip" onClick={onOpen} title={l.skills.join(", ")}>
      <I.Plugins size={13} /><span>{tr(l.forced ? "Chế độ" : "Thư viện")} <b data-notr={l.key.startsWith("lib-") || undefined}>{l.key.startsWith("lib-") ? l.label : tr(l.label)}</b></span>
      {l.skills.length > 0 && <span className="lib-sk" data-notr>{l.skills.slice(0, 3).join(", ")}{l.skills.length > 3 ? ` +${l.skills.length - 3}` : ""}</span>}
    </button>))}</div>;
}

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
      <button className="model-btn" data-tip="Chọn model" aria-label={prefix ? `${prefix}: ${none ? "Chưa có model" : model ? modelName(model) : "Chọn model"}` : undefined} aria-haspopup="menu" aria-expanded={mm} onPointerEnter={() => { if (!mm) refreshModels(); }} onClick={() => { setMm(!mm); setSub(null); }}>{!none && model ? (model === AUTO ? <span className="vlogo" style={{ width: 16, height: 16 }} aria-hidden><I.Sparkle size={15} /></span> : <ModelLogo k={model} />) : null}{prefix ? (
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
                <ModelLogo k={m.key} name={m.name} /><span className="mname-t">{m.name}</span>{m.isNew && !m.blockedUntil ? <span className="mtag mnew" title="Hãng vừa ra mắt, Synchro đã thử và cho dùng">Mới</span> : null}{m.blockedUntil ? <span className="mtag" title={resetClock(m.blockedUntil, getLang())}>{getLang() === "en" ? "Limit reached" : "Hết hạn mức"}</span> : null}{m.key === model ? <span className="ck"><I.Check /></span> : !ok(m.key) && <span className="sc"><I.Lock size={14} /></span>}
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
  const en = getLang() === "en";
  const at = (t: number) => resetClock(t, en ? "en" : "vi");
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
      {p.hasApi && <button className="lnk" onClick={() => set(true)}>{en ? "Use the shared API key" : "Dùng khóa API dùng chung"}</button>}
    </div>
  );
  return <div className="msub-note msub-plan"><span>{en ? "From your plan" : "Từ gói của bạn"}</span></div>;
}

type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: (e: { error: string }) => void; onend: () => void; start: () => void; stop: () => void };
// Lỗi nhận dạng của trình duyệt → một câu cho người dùng. Không có tiếng (no-speech) và bị dừng (aborted) không phải lỗi.
const REC_ERR: Record<string, string> = { "not-allowed": "Không mở được micro: hãy cho phép Synchro dùng micro", "service-not-allowed": "Trình duyệt đang chặn nhận dạng giọng nói", "audio-capture": "Không tìm thấy micro trên máy này", network: "Nhận dạng giọng nói của trình duyệt cần kết nối mạng", "language-not-supported": "Trình duyệt chưa nhận dạng được ngôn ngữ này" };

function Composer(p: {
  onSend: (t: string, f: string[], pick?: { id: string; label: string }[]) => void; busy: boolean; onStop: () => void; dock?: boolean; say: Say;
  prefill: { t: string; n: number }; files: string[]; setFiles: (f: string[]) => void;
  model: string; setModel: (m: string) => void; goCustom: () => void; goConnectors?: () => void; placeholder?: string; focusPlaceholder?: string; openUpload: () => void;
  onVoice?: () => void; extra?: React.ReactNode;
  projects?: { id: number; name: string }[]; project?: number; onProject?: (id: number | undefined) => void;
  /** Đang chạy mà gửi thêm: later = false ghép vào việc đang làm, true = gửi sau khi xong. */
  onSteer?: (text: string, later: boolean) => void;
  /** Đổi giá trị (bấm Mới, mở đoạn chat, chọn chế độ…) thì đưa con trỏ vào ô nhập. */
  focusKey?: string;
}) {
  countRender("Composer");
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
  // Dải thẻ đính kèm: quá CHIP_LIMIT thẻ thì gộp phần dư vào "+N"; bấm "+N" trải ra lưới nhiều hàng (xem app/composerchips.ts).
  const [chipsOpen, setChipsOpen] = useState(false);
  // Lưới đã trải chỉ dành cho bộ thẻ đang soạn: còn ≤ CHIP_LIMIT thẻ (đã gửi, đã gỡ bớt) thì lần đính kèm sau lại bắt đầu từ dải một hàng.
  const chipCount = picks.length + files.length;
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
    if (bad) { app.confirm(tr("Không gửi được một số tệp"), `${bad} ${tr("tệp không đọc được sẽ không được gửi. Gửi phần còn lại?")}`, tr("Gửi phần còn lại"), fire); return; }
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
  // Dán ảnh / tệp từ bộ nhớ tạm (⌘V) như Claude, ChatGPT: thành tệp đính kèm; ảnh dán không tên thì đặt tên theo giờ.
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fl = Array.from(e.clipboardData?.files ?? []);
    if (!fl.length) return;
    e.preventDefault();
    const d = new Date(), stamp = `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}.${String(d.getSeconds()).padStart(2, "0")}`;
    const named = fl.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Ảnh dán ${stamp}${fl.length > 1 ? `-${i + 1}` : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })));
    named.forEach((x) => saveBlob(x.name, x, say));
    setFiles(capFiles(files, named.map((x) => x.name), say));
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = Array.from(e.target.files ?? []); fl.forEach((x) => saveBlob(x.name, x, say)); const n = fl.map((f) => f.name);
    if (n.length) setFiles(capFiles(files, n, say));
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
      saveBlob(name, new File([blob], name, { type: "image/png" }), say);
      setFiles(capFiles(files, [name], say));
      say("Đã đính kèm ảnh chụp màn hình");
    } catch (e) { if ((e as Error).name !== "NotAllowedError") say("Không chụp được màn hình"); }
  };

  const plus = (
    <div ref={ref} style={{ position: "relative" }}>
      <input ref={fileIn} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={pick} />
      <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Thêm" aria-haspopup="menu" aria-expanded={menu}><I.Plus /></button>
        <Menu open={!!(menu)} className="plus-menu" style={{ bottom: 40, left: 0, width: 264 }}>
          {perms?.features.files !== false && <button className="menu-item" onClick={() => { setMenu(false); openUpload(); }}><I.Clip />Tải lên hoặc thêm tệp<span className="sc">⌘U</span></button>}
          {perms?.features.files !== false && <button className="menu-item" onClick={shot}><I.Camera />Chụp ảnh màn hình</button>}
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
    ...picks.map((k) => <span key={"pk-" + k.id} className="pick-chip">{k.id.startsWith("lib-") ? <I.Plugins size={14} /> : <I.Scroll size={14} />}<span className="cv-ell" data-notr>{k.label}</span><button className="icon-btn" aria-label={`Bỏ skill ${k.label}`} onClick={() => setPicks(picks.filter((x) => x.id !== k.id))}><I.X size={12} /></button></span>),
    ...files.map((f, i) => <FileCard key={"fc-" + f + i} name={f} onOpen={() => fm.show(f)} onContextMenu={(e) => fm.open(e, f)} onRemove={() => { abortFile(f); setFiles(files.filter((_, j) => j !== i)); }} />),
  ];
  // U2: dải một hàng chỉ dựng những thẻ hiện trọn được rồi "+N" ở mép phải, bấm thì trải lưới (app/attachstrip.tsx, dùng chung với Synchro Code).
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
}

function ago(t: number): string {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "bây giờ";
  if (m < 60) return `${m} phút trước`;
  return fmt(t);
}

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
  if (!shown || typeof document === "undefined") return null;
  // Gắn vào cuối <body>, trên mọi lớp phủ: thông báo (vd. lỗi kết nối connector) không bị hộp đang mở che mất.
  return createPortal(<div className={`toast ${out ? "out" : ""}`} key={shown} role="status">{shown}</div>, document.body);
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

// Đoạn chat đang chờ người dùng duyệt công cụ: phải thấy được từ ngoài đoạn chat đó (cột bên, thông báo), không thì lượt treo tới hết giờ mà không ai biết.
// Phiên Synchro Code ở thanh bên (danh sách lưu ở trình duyệt, đồng bộ với máy chủ khi bật).
type CodeItem = { id: number; title: string; pinned?: boolean; archived?: boolean; state?: SessionState; reason?: string | null; running?: boolean; upd?: number; pr?: { number: number; url: string | null; state: string } | null };
// Trạng thái phiên: đang chạy, cần bạn (hỏi lại / chờ duyệt / gặp lỗi / bị dừng), chờ xem lại (có thay đổi chưa commit / chưa push / PR chờ duyệt), xong.
function CodeBadge({ c }: { c: CodeItem }) {
  if (c.running && c.state !== "blocked") return <span className="cb run" title={tr("Đang chạy")} aria-label={tr("Đang chạy")}><span className="wl-spin" /></span>;
  if (!c.state) return null;
  const t = tr(c.state === "blocked" ? "Cần bạn" : c.state === "review" ? "Chờ xem lại" : "Xong");
  return <span className={`cb ${c.state}`} title={c.reason ? `${t}: ${c.reason}` : t} aria-label={t} />;
}

// Giờ gửi của một tin: dòng đã memo thì không tự vẽ lại, tin còn mới tự đếm "N phút trước" theo đồng hồ riêng.
function When({ t }: { t: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (Date.now() - t > 3600_000) return;
    const x = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(x);
  }, [t]);
  return <span className="when">{ago(t)}</span>;
}

// Bảng artifact của đoạn chat: mỗi identifier một danh sách phiên bản; bản sửa (mode="patch") áp vào phiên bản trước thành bản đầy đủ (vfs.ts).
type ArtScan = { map: Map<string, (ArtVersion & { msg: number })[]>; at: Record<number, { ident: string; v: number }[]> };
const ART_EMPTY: ArtScan = { map: new Map(), at: {} };
// Kết quả tách artifact theo từng tin: tin đã xong không đổi nên không tách lại mỗi khung hình.
const artSegs = new WeakMap<Msg, ReturnType<typeof splitArtifacts>>();
function scanArts(msgs: Msg[], from: number, base: ArtScan): ArtScan {
  const map: ArtScan["map"] = new Map(), at = { ...base.at };
  for (const [k, v] of base.map) map.set(k, [...v]);
  for (let i = from; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "ai" || !hasArtifacts(m.text)) continue;
    let segs = artSegs.get(m);
    if (!segs) { segs = splitArtifacts(m.text); artSegs.set(m, segs); }
    for (const sg of segs) if (sg.kind === "art") {
      const l = map.get(sg.art.ident) ?? [];
      l.push({ ...resolveArt(l[l.length - 1], sg.art), msg: i });
      map.set(sg.art.ident, l);
      (at[i] = [...(at[i] ?? [])]).push({ ident: sg.art.ident, v: l.length - 1 });
    }
  }
  return { map, at };
}

// Những gì một dòng tin cần từ trang (luôn là bản mới nhất, đọc qua ref): đổi hàm không làm cả danh sách vẽ lại.
type RowCx = {
  chat: Chat; chats: Chat[]; say: Say; fm: ReturnType<typeof useFileMenu>; arts: ArtScan; artOpen: boolean; artIdent?: string; artIndex: number;
  openPlugins: () => void; openArt: (s: { chat: number; ident: string; v: number; follow: boolean }) => void; openFile: (f: OutFile) => void; send: (t: string) => void;
  copy: (key: string, text: string) => void; speak: (key: string, text: string) => void; like: (i: number, v: 1 | -1) => void; retry: (avoid?: string) => void; openProviders: () => void; edit: (i: number, text: string) => void; model: string; switchModel: (key: string) => void;
  // Tài khoản có hơn một model dùng được: mới hiện nút "Chạy lại bằng model khác" dưới câu trả lời của chế độ Tự động.
  altModels: boolean;
  // Rẽ nhánh: đoạn chat mới gồm các tin tới hết câu trả lời thứ i (đoạn chat gốc giữ nguyên).
  fork: (i: number) => void;
};
// Thẻ lỗi của một lượt chat: khác hẳn câu trả lời thường, nói việc nên làm tiếp, lỗi thô để trong phần chi tiết.
function ErrCard({ raw, onRetry, onProviders }: { raw?: string; onRetry?: () => void; onProviders: () => void }) {
  // Thẻ nằm trong .ai-msg (bộ dịch trang bỏ qua) và trong dòng tin đã memo: tự vẽ lại khi từ điển về / đổi ngôn ngữ, không kẹt chữ tiếng Việt.
  useLangReady();
  const e = chatError(raw, (s) => isForeign(s, tr(s), getLang()));
  return (
    <div className="msg-err" role="alert">
      <div className="msg-err-h"><I.M icon="WarningCircle" size={16} /><b>{tr("Câu trả lời chưa hoàn thành")}</b></div>
      <p>{tr(e.text)}</p>
      {e.detail && <details><summary>{tr("Chi tiết kỹ thuật")}</summary><code data-notr>{e.detail}</code></details>}
      {(onRetry || e.act) && <div className="msg-err-a">{onRetry && <button className="btn dark" onClick={onRetry}><I.Retry size={14} />{tr("Thử lại")}</button>}{e.act === "providers" && <button className="btn" onClick={onProviders}>{tr("Mở Providers")}</button>}</div>}
    </div>
  );
}
/** Tin của AI không còn dòng ghi chú "đã áp dụng hướng dẫn" kiểu cũ (stripAppliedNotes); tin không đổi thì trả đúng đối tượng cũ. */
const cleanAiMsg = (m: Msg): Msg => { if (m.role !== "ai") return m; const text = stripAppliedNotes(m.text); return text === m.text ? m : { ...m, text }; };
// Một tin của đoạn chat. memo: mỗi khung hình chữ đang chảy chỉ vẽ lại tin cuối; đoạn chat dài không phải dựng lại toàn bộ tin nhắn.
const MsgRow = memo(function MsgRow({ m: raw, i, last, busy, mark, art, inl, fileActive, copied, speaking, chatId, cx }: {
  // lang: đổi ngôn ngữ thì dòng tin đã memo cũng dịch lại các nút và lời báo.
  m: Msg; i: number; last: boolean; lang: string; busy: boolean; mark: boolean; art?: boolean; inl?: boolean; artSig: string; fileActive?: string; copied: boolean; speaking: boolean; chatId: number; cx: React.RefObject<RowCx | null>;
}) {
  // W1-08: câu trả lời cũ còn dòng ghi chú "đã áp dụng hướng dẫn" kèm trích dẫn trong chữ (đã lưu, đã đồng bộ): bỏ khi vẽ và khi sao chép,
  // như lịch sử gửi model (history.ts) và bản chia sẻ (sharesnap.ts). Không có dòng đó thì giữ nguyên đối tượng tin.
  const m = useMemo(() => cleanAiMsg(raw), [raw]);
  // Đang sửa tin đã gửi: nội dung đang sửa; null là không sửa.
  const [ed, setEd] = useState<string | null>(null);
  const saveEd = () => { const t = ed?.trim(); if (!t) return; setEd(null); if (t !== m.text.trim()) cx.current!.edit(i, t); };
  const c = cx.current!;
  const { say, fm, arts } = c;
  const key = `${chatId}-${i}`;
  // Nguồn tìm web: số [n] trong câu trả lời trỏ tới chip thứ n (cites.tsx). Chỉ khi câu trả lời đã xong và có nguồn.
  const citeId = key;
  const cites = useMemo(() => (m.done && m.webs?.length ? { webs: m.webs, id: citeId } : null), [m.done, m.webs, citeId]);
  const est = useMemo<React.CSSProperties>(() => ({ containIntrinsicSize: `auto ${rowHeight(m)}px` }), [m.text, m.files?.length, m.outs?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    {mark && <div className="cx-mark" role="note"><I.Sparkle size={13} /><span>{tr("Các tin phía trên đã được nén thành bản tóm tắt; model nhận bản tóm tắt thay cho chúng.")}</span></div>}
    {m.role === "user" ? (
      <div className="user-wrap" style={est}>
        {m.files && <div className="attach sent">{m.files.map((f, k) => <FileCard key={k} name={f} fid={m.fids?.[f]} onOpen={() => cx.current!.fm.show(f, m.fids?.[f])} onContextMenu={(e) => cx.current!.fm.open(e, f)} />)}</div>}
        {m.steer && <span className="steer-tag">{tr("Nhắn thêm khi Synchro đang làm")}</span>}
        {m.pick?.length ? <div className="u-picks">{m.pick.map((k) => <span key={k.id} className="skill-chip">{k.id.startsWith("lib-") ? <I.Plugins size={13} /> : <I.Scroll size={13} />}<span data-notr>{k.label}</span></span>)}</div> : null}
        {ed === null ? <div className="user-msg"><UserText text={m.text} /></div> : (
          <div className="u-edit">
            <textarea autoFocus rows={Math.min(10, ed.split("\n").length + 1)} value={ed} aria-label={tr("Sửa tin nhắn")} onChange={(e) => setEd(e.target.value)} onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setEd(null); } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEd(); } }} />
            {!last && <div className="u-edit-n">{tr("Các tin phía sau sẽ được thay bằng câu trả lời mới.")}</div>}
            <div className="u-edit-a"><button className="btn" onClick={() => setEd(null)}>{tr("Hủy")}</button><button className="btn dark" disabled={!ed.trim() || busy} onClick={saveEd}>{tr("Gửi lại")}</button></div>
          </div>
        )}
        {ed === null && (
          <div className="u-actions">
            <button className="icon-btn" onClick={() => cx.current!.copy(key, m.text)} aria-label={tr("Sao chép")} data-tip={tr("Sao chép")}>{copied ? <I.M icon="Check" size={15} /> : <I.M icon="Copy" size={15} />}</button>
            {!busy && !m.steer && !PE_RE.test(m.text) && <button className="icon-btn" onClick={() => setEd(m.text)} aria-label={tr("Sửa tin nhắn")} data-tip={tr("Sửa tin nhắn")}><I.Pencil size={15} /></button>}
          </div>
        )}
      </div>
    ) : (
      <div style={est}>
        <CiteCtx.Provider value={cites}><div className={`ai-msg${m.done ? "" : " ai-streaming"}`}>{m.tools?.length ? <div className="skill-used">{m.tools.map((n) => <span key={n} className="skill-chip tool-chip"><I.SetPlug size={13} /><span>{tr("Đã dùng")}</span><span data-notr>{toolChip(n)}</span></span>)}</div> : null}{m.libs?.length ? <LibChips libs={m.libs} onOpen={() => cx.current!.openPlugins()} /> : null}{m.skills?.length ? <div className="skill-used">{m.skills.map((n) => <span key={n} className="skill-chip"><I.Scroll size={13} />{tr("Đang dùng skill")}: {n}</span>)}</div> : null}{m.done ? <WorkSummary parts={m.parts} plan={m.plan} ms={m.dur} stopped={m.stopped} failed={m.failed || !!m.notice?.partial} render={(t) => <Markdown text={t} say={say} />} /> : m.parts?.length ? <WorkParts parts={m.parts} live onAnswer={answerAsk} render={(t) => <Markdown text={t} say={say} />} /> : null}{m.text ? (art && hasArtifacts(m.text) ? splitArtifacts(m.text).map((sg, k) => sg.kind === "text" ? <Markdown key={k} text={sg.text} say={say} viz={inl} live={m.done && last && !busy} streaming={!m.done} /> : (() => {
          const pos = arts.at[i]?.find((x) => x.ident === sg.art.ident && arts.map.get(x.ident)?.[x.v]?.msg === i);
          const total = arts.map.get(sg.art.ident)?.length ?? 1;
          const v = pos?.v ?? 0;
          const active = c.artOpen && c.artIdent === sg.art.ident && c.artIndex === v;
          const full = arts.map.get(sg.art.ident)?.[v];
          return <ArtifactCard key={k} art={full ?? sg.art} version={v + 1} total={total} active={active} fix={full?.fix} onRedo={last && !busy ? () => cx.current!.send(`${tr("Bản sửa")} “${full?.title ?? sg.art.ident}” ${tr("không áp được. Hãy viết lại toàn bộ artifact này (không dùng mode=\"patch\"), giữ các thay đổi tôi vừa yêu cầu.")}`) : undefined} onOpen={() => cx.current!.openArt({ chat: chatId, ident: sg.art.ident, v, follow: false })} />;
        })()) : <Markdown text={hasArtifacts(m.text) ? artifactsAsCode(m.text) : m.text} say={say} viz={inl} live={m.done && last && !busy} streaming={!m.done} />) : null}{m.failed ? <ErrCard raw={m.err} onRetry={last && !busy ? () => cx.current!.retry() : undefined} onProviders={() => cx.current!.openProviders()} /> : null}{m.done && last ? <ConnCards parts={m.parts} text={m.text} /> : null}{!m.done && m.plan?.length ? <PlanCard plan={m.plan} live /> : null}{!m.done ? <WorkStatus label={m.parts?.some((p) => p.k === "ask" && p.state === "wait") ? tr("Đang chờ bạn duyệt") : m.prog} since={m.time} steps={stepsOf(m.parts)} /> : null}{m.outs?.length ? <OutputFiles files={m.outs} onOpen={(f) => cx.current!.openFile(f)} active={fileActive} /> : null}</div></CiteCtx.Provider>
        {m.done && m.stopped && <div className="msg-stopped"><I.Stop size={11} />{tr("Đã dừng · giữ lại phần đã viết")}</div>}
        {m.done && !m.failed && (m.pjApplied || m.insApplied) ? <div className="msg-applied">{m.pjApplied && <span className="skill-chip"><I.Folder size={13} />{tr("Đã áp dụng ngữ cảnh dự án")}</span>}{m.insApplied && <span className="skill-chip"><I.User size={13} />{tr("Đã áp dụng hướng dẫn cá nhân")}</span>}</div> : null}
        {m.done && m.webs?.length ? <SourceChips webs={m.webs} id={citeId} /> : null}
        {m.done && m.notice && ((m.notice.text && !m.failed) || m.notice.work || m.notice.at || m.notice.tried?.length || m.notice.switchTo) ? (
          <div className="msg-notice" role="status">
            {m.notice.text && !m.failed && <p>{tr(m.notice.text)}</p>}
            {m.notice.work && <p>{tr("Model đã làm một phần việc nên Synchro không tự chạy lại, để tránh làm hai lần.")}</p>}
            {m.notice.at && m.notice.at > Date.now() ? <p data-notr>{resetAt(m.notice.at, getLang())}</p> : null}
            {m.notice.tried?.length ? <p data-notr>{`${getLang() === "en" ? "Tried" : "Đã thử"}: ${m.notice.tried.join(", ")}`}</p> : null}
            {m.notice.switchTo && last && !busy ? (
              <div className="msg-notice-act">
                <button className="btn dark" onClick={() => cx.current!.switchModel(m.notice!.switchTo!.model)} data-notr>{`${getLang() === "en" ? (c.model === AUTO ? "Try again with Auto" : `Use another model: ${m.notice.switchTo.name}`) : c.model === AUTO ? "Thử lại bằng Tự động" : `Dùng model khác: ${m.notice.switchTo.name}`}`}</button>
                {c.model !== AUTO && <button className="lnk" onClick={() => cx.current!.switchModel(AUTO)}>{tr("Dùng Tự động")}</button>}
              </div>
            ) : null}
          </div>
        ) : null}
        {m.done && !m.failed && (
          <div className="actions in">
            <button className="icon-btn" onClick={() => cx.current!.copy(key, m.text)} aria-label="Sao chép">{copied ? <I.M icon="Check" size={16} /> : <I.M icon="Copy" size={16} />}</button>
            <button className={`icon-btn ${speaking ? "like-on" : ""}`} onClick={() => cx.current!.speak(key, m.text)} aria-label="Đọc to"><I.Speaker size={16} /></button>
            <button className={`icon-btn ${m.like === 1 ? "like-on" : ""}`} onClick={() => cx.current!.like(i, 1)} aria-label="Hữu ích" aria-pressed={m.like === 1}><I.ThumbUp size={16} /></button>
            <button className={`icon-btn ${m.like === -1 ? "like-on" : ""}`} onClick={() => cx.current!.like(i, -1)} aria-label="Không hữu ích" aria-pressed={m.like === -1}><I.ThumbDown size={16} /></button>
            {last && <button className="icon-btn" onClick={() => cx.current!.retry()} aria-label="Thử lại"><I.Retry size={16} /></button>}
            {!c.chat.inc && <button className="icon-btn" onClick={() => cx.current!.fork(i)} aria-label={tr("Rẽ nhánh từ đây")} data-tip={tr("Rẽ nhánh từ đây")}><I.Branch size={15} /></button>}
            {m.via && <span className="via" title={tr("Chế độ Tự động đã chọn model này")} data-notr><ModelLogo k={m.via} size={14} /><span className="via-t">{(() => { const en = getLang() === "en", task = m.viaTask ? autoTaskName(m.viaTask, en) : ""; return task ? (en ? `Auto picked ${modelName(m.via)} for ${task}` : `Tự động chọn ${modelName(m.via)} cho việc ${task}`) : modelName(m.via); })()}</span></span>}
            {m.via && last && !busy && c.altModels && <button className="via via-alt" onClick={() => cx.current!.retry(m.via)} title={tr("Vẫn để Tự động, chỉ không dùng model vừa trả lời")}><I.Retry size={12} />{tr("Chạy lại bằng model khác")}</button>}
            <When t={m.time} />
          </div>
        )}
        {m.done && !m.failed && last && !busy && <SaveSkillChip chat={c.chat} all={c.chats} say={say} />}
      </div>
    )}
  </>);
});

export default function Home({ boot }: { boot?: BootData | null }) {
  countRender("Home");
  // Giữ khung chờ tới khi từ điển của ngôn ngữ đang dùng về (tải riêng từng thứ tiếng, i18n.tsx): không nháy chữ sai ngôn ngữ.
  const langReady = useLangReady();
  // Gói khởi động dựng sẵn ở máy chủ (app/page.tsx, blueprint A3): dùng một lần lúc mở trang thay cho /api/auth/me và các lệnh hỏi đầu.
  // Đã biết tài khoản ngay lúc hydrate: bắt đầu hỏi đoạn chat mới song song, không chờ trang dựng xong (chatsync.ts prefetchChats).
  const bootRef = useRef(boot ?? null);
  // Kho đã gieo từ gói khởi động (uid, lúc gieo): lần hỏi đầu của danh sách model / khả năng bỏ qua (xem các hiệu ứng refreshModels, loadCaps).
  const bootSeeded = useRef<{ uid: string; at: number; models: boolean; caps: boolean } | null>(null);
  const seededNow = (uid: string, k: "models" | "caps") => { const sd = bootSeeded.current; return !!sd && sd.uid === uid && sd[k] && Date.now() - sd.at < 10_000; };
  useState(() => { if (boot?.user && typeof window !== "undefined") prefetchChats(boot.user.id); return 0; });
  // Họ tên và tên gọi đã lưu (Cài đặt → Tài khoản). Không có tên mặc định của ai: chưa có thì lấy từ tên tài khoản (xem name / call bên dưới).
  const [namePref, setName] = usePref("name", "");
  const [, setAcct] = usePref("acct", "");
  const [callPref, setCall] = usePref("call", "");
  const [, setWork] = usePref("work", "");
  const [ins, setIns] = usePref("ins", "");
  const [size] = usePref("size", "Medium");
  const [font] = usePref("font", "Default");
  const [uiFont] = usePref("uiFont", "Default");
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
    r.dataset.chatFont = chatFont(font);
    r.dataset.uiFont = uiFont;
    r.dataset.textSize = size;
    // Mặc định bằng cột chat của Claude (48rem = 768px); Vừa / Rộng cho màn hình lớn.
    r.style.setProperty("--thread-w", { Narrow: "768px", Medium: "880px", Wide: "1040px" }[width] ?? "768px");
  }, [motion, font, uiFont, size, width]);
  const [view, setView] = useState<View>("new");
  const [open, setOpen] = useState(true);
  const openRef = useRef(open);
  openRef.current = open;
  // Màn hình hẹp (điện thoại): thanh bên là ngăn kéo trượt đè lên nội dung, mặc định đóng, chọn mục xong tự đóng.
  const narrow = () => typeof window !== "undefined" && window.matchMedia(NARROW).matches;
  useEffect(() => { if (narrow()) setOpen(false); }, []);
  useEffect(() => startWarmPing(), []);
  // Đoạn chat, dự án, đoạn chat đang mở, lượt đang chạy, tin chờ gửi nằm ở kho app/chatstore.client.ts (blueprint B2).
  // Các hàm đặt giá trị dùng như setState của React và không bao giờ đổi, nên lấy thẳng từ kho. Home đọc qua useChatState (cùng nhịp vẽ với useState).
  const chats = useChatState((s) => s.chats);
  const projects = useChatState((s) => s.projects);
  const cur = useChatState((s) => s.cur);
  const { setChats, setProjects, setCur, setRunning, setQueued, setBusy: setBusyOf, patch } = useChatStore.getState();
  // Home gỡ khỏi trang: kho về trạng thái ban đầu như useState trước đây, lần gắn sau không mang theo dấu "đang chạy" cũ.
  useEffect(() => () => useChatStore.getState().reset(), []);
  const curRef = useRef(cur);
  curRef.current = cur;
  // Công cụ connector đang chờ người dùng duyệt: thẻ hiện cuối cuộc trò chuyện đang trả lời.
  const [approval, setApproval] = useState<{ chat: number | null; calls: ApprovalCall[]; resolve: (d: ApprovalAnswer) => void } | null>(null);
  const approvalRef = useRef(approval);
  approvalRef.current = approval;
  // Gợi ý khi rê chuột tự lật xuống dưới / canh theo mép khi sát mép màn hình hay mép khung (tips.ts).
  useEffect(() => installTips(), []);
  useEffect(() => installFloatFit(), []);
  useEffect(() => installA11y(), []);
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
  const [chatMenu, setChatMenu] = useState<number | null>(null);
  const [codeList, setCodeList] = usePref<CodeItem[]>("codeList", []);
  const codeListRef = useRef(codeList); codeListRef.current = codeList;
  const [archOpen, setArchOpen] = useState(false);
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
  // Thẻ: khung "Gắn thẻ" đang mở trong menu ⋮ / menu tiêu đề; thẻ đang lọc ở thanh bên (null: tất cả).
  const [pickTag, setPickTag] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [pjClosed, setPjClosed] = usePref<Record<number, boolean>>("pjClosed", {});
  const [titleMenu, setTitleMenu] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
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
  const [drag, setDrag] = useState(false);
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
  // Phim giới thiệu cho tài khoản mới (app/introfilm.tsx): giữ màn đăng nhập tới khi phim phủ kín màn hình. Vào app (từ phim hoặc từ lời
  // chào khi đăng nhập lại): logo bay về chỗ, trang chủ lắp lại quanh đó (app/handoff.ts); reveal giấu logo thật của app tới khi bản sao
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
    flushDirtyRef.current();
    setUserScope(u.id);
    if (u.isAdmin) adoptLegacyData(u.id);
    reloadPrefs();
    resetCodePrefs(); clearJsonCache();
    listAt.current = 0;
    loadLocal();
    setCur(null); setView("new");
  };
  // Không hỏi được máy chủ lúc mở trang (mất mạng, máy chủ đang khởi động lại) không có nghĩa là đã đăng xuất: người đã đăng nhập thấy "không kết nối được" kèm tự thử lại,
  // không bị đưa về màn hình đăng ký. Chỉ khi máy chủ trả lời rõ { user: null } mới coi là chưa đăng nhập.
  const [bootErr, setBootErr] = useState(false);
  const bootRetry = useRef<() => void>(() => {});
  useEffect(() => {
    localStorage.removeItem("session"); // phiên giả lập cũ, nay dùng cookie máy chủ
    let dead = false, t: ReturnType<typeof setTimeout> | undefined;
    const apply = (j: { user: AuthUser | null; providers: Providers; signupOpen?: boolean; speechReady?: boolean }, b?: BootData) => {
      bootRetry.current = () => {};
      setBootErr(false); setProviders(j.providers); setSignupOpen(j.signupOpen !== false); setSpeechReady(j.speechReady !== false);
      if (j.user) {
        enterAccount(j.user);
        // Gieo các kho của trang từ gói khởi động (sau enterAccount: kho nào cũng theo vùng dữ liệu của tài khoản đang mở).
        if (b) { bootSeeded.current = { uid: j.user.id, at: Date.now(), models: seedModels(b.models), caps: seedCaps(b.caps) }; seedMeta(b.studios); seedInboxCount(b.inboxCount); seedCodePrefs(b.codePrefs); }
        syncProfile(j.user);
      }
      // Lần thử lại về sau khi khách vừa đăng nhập xong ở màn hình đăng nhập: không ghi đè.
      setMe((m) => (m && !j.user ? m : j.user));
    };
    const go = (tries?: number) => {
      clearTimeout(t);
      // Lần đầu: gói dựng sẵn ở máy chủ, không hỏi gì thêm. Không có gói (khách chưa đăng nhập, máy chủ dựng lỗi) hay lần thử lại: hỏi /api/auth/me như trước.
      const b = tries === undefined ? bootRef.current : null;
      if (b) { apply(b, b); return; }
      loadMe<{ user: AuthUser | null; providers: Providers; signupOpen?: boolean; speechReady?: boolean }>(tries).then((j) => {
        if (dead) return;
        apply(j);
      }).catch(() => {
        if (dead) return;
        let was = false;
        try { was = !!localStorage.getItem("signedIn"); } catch {}
        if (was) setBootErr(true); else setMe((m) => (m === undefined ? null : m));
        t = setTimeout(() => go(0), 5000);
      });
    };
    bootRetry.current = () => go(0);
    const online = () => bootRetry.current();
    window.addEventListener("online", online);
    go();
    return () => { dead = true; clearTimeout(t); window.removeEventListener("online", online); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Phiên hết hạn khi app đang mở: phủ màn hình đăng nhập lên trên, bên dưới giữ nguyên (đoạn chat đang mở, phần đang gõ, lượt đang chạy); đăng nhập lại là dùng tiếp.
  const [expired, setExpired] = useState(false);
  const signedIn = useRef(false);
  signedIn.current = !!me;
  useEffect(() => watchSession(() => { if (signedIn.current) setExpired(true); }), []);
  useEffect(() => { try { if (me) localStorage.setItem("signedIn", "1"); else if (me === null) localStorage.removeItem("signedIn"); } catch {} }, [me]);
  const [editProj, setEditProj] = useState<number | null>(null);
  const [sideProj, setSideProj] = useState<number | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
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
  // Đổi model hoặc nỗ lực: khởi động sẵn đúng lựa chọn mới (chạy sau khi nỗ lực đã được hạ theo giới hạn).
  const [effortPick] = usePref("effort", "auto");
  useEffect(() => { if (me) warmChoice(); }, [model, effortPick, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Danh sách model đổi (quản trị viên thêm khóa, đổi quyền) → chọn lại model hợp lệ.
  // Lần đầu sau gói khởi động: danh sách model và khả năng đã gieo, không hỏi lại (bootSeeded); các lần sau như cũ.
  useEffect(() => { if (me && !seededNow(me.id, "models")) refreshModels(); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Thẻ đếm ngược của connector bị giới hạn tốc độ: hết giờ, nút "Thử lại ngay" gửi lại tin vừa rồi của đoạn chat đang mở.
  useEffect(() => {
    const again = () => rowCx.current?.retry();
    window.addEventListener("synchro:retry", again);
    return () => window.removeEventListener("synchro:retry", again);
  }, []);
  // Đoạn chat và dự án theo tài khoản: đồng bộ với máy chủ, chuyển dần từ trình duyệt (chatsync.ts).
  const chatSync = useChatSync({ uid: me?.id ?? null, loaded, chats, projects, running, setChats, setProjects });
  const chatSyncRef = useRef(chatSync);
  chatSyncRef.current = chatSync;
  const syncSt = useSyncStatus();
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
  useEffect(() => {
    if (!loaded) return;
    const d = saveSig() !== savedSig.current ? 300 : running.size ? 5000 : 800, at = Date.now() + d;
    if (saveT.current && saveT.current.at <= at) return;
    if (saveT.current) clearTimeout(saveT.current.t);
    saveT.current = { t: setTimeout(flushChats, d), at };
  }, [chats, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
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
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") flushDirty(); };
    window.addEventListener("pagehide", flushDirty);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("pagehide", flushDirty); document.removeEventListener("visibilitychange", hide); };
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

  const chat = chats.find((c) => c.id === cur);
  // Đoạn chat đang mở nằm trong địa chỉ trang (#c=<mã>, không tới máy chủ): F5 mở lại đúng đoạn đó, kể cả khi câu trả lời còn đang chạy (lượt tự nối lại bên dưới).
  // Trước đây tải lại luôn về trang chủ, trông như mất câu trả lời nên người dùng gửi lại và tốn hạn mức. Đoạn chat ẩn danh không ghi vào địa chỉ.
  const openWant = useRef<number | null>(typeof location === "undefined" ? null : Number(/^#c=(\d{1,16})$/.exec(location.hash)?.[1] ?? 0) || null);
  useEffect(() => {
    const id = openWant.current;
    if (id === null || !loaded || !me) return;
    // Người dùng đã tự đi nơi khác trong lúc chờ.
    if (view !== "new" || cur !== null) { openWant.current = null; return; }
    if (chats.some((c) => c.id === id && !c.inc)) { openWant.current = null; setCur(id); setView("chat"); return; }
    // Chưa có ở trình duyệt này: đợi đồng bộ về một lúc (thiết bị mới), không có thì thôi.
    const t = setTimeout(() => { if (openWant.current === id) { openWant.current = null; history.replaceState(null, "", location.pathname + location.search); } }, 8000);
    return () => clearTimeout(t);
  }, [chats, loaded, me, view, cur]);
  // U6: mục bị tắt theo quyền (feature flags) coi như địa chỉ lạ — không ghi vào #v= và không mở khi gặp link #v= đó.
  const viewAllowed = useCallback((v: View): boolean => {
    if (!me) return true; // chưa biết quyền: cho qua, lớp bảo vệ ở trên sẽ chỉnh lại khi biết
    const f = me.perms.features;
    if (v === "code") return f.code !== false;
    if (v === "speech") return f.speech !== false && (speechReady || !!me.isAdmin);
    if (v === "customize") return f.skills !== false;
    if (v === "projects" || v === "project") return f.projects !== false;
    if (v === "artifacts") return caps.art !== false;
    return true; // inbox, brain, new, chat
  }, [me, speechReady, caps.art]);
  // Địa chỉ mà trạng thái hiện tại nên có: Cài đặt (#s=) ưu tiên, rồi đoạn chat không ẩn danh (#c=), rồi mục (#v=).
  const curHash = (): string => {
    if (modal === "settings") return settingsHash(settingsTab);
    if (view === "chat" && cur !== null && chat && !chat.inc) return `#c=${cur}`;
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
  }, [view, cur, chat?.inc, modal, settingsTab, loaded, bootDone, me, speechReady, caps.art]); // eslint-disable-line react-hooks/exhaustive-deps
  // Địa chỉ → trạng thái: nút Back / Forward (popstate). Đóng Cài đặt khi địa chỉ không còn là #s=.
  useEffect(() => {
    const onPop = () => {
      const h = location.hash;
      if (/^#s=/.test(h)) { setSettingsTab(decodeSettingsTab(h.slice(3))); setModal("settings"); return; }
      settingsFrom.current = null; // đã rời mục #s= bằng Back / Forward
      setModal((m) => (m === "settings" ? null : m));
      if (/^#c=/.test(h)) { const id = Number(/^#c=(\d{1,16})$/.exec(h)?.[1] ?? 0) || null; if (id !== null && chatsRef.current.some((c) => c.id === id && !c.inc)) { setCur(id); setView("chat"); } return; }
      const mv = /^#v=([a-z]+)$/.exec(h);
      if (mv) { const v = VIEW_OF_HASH[mv[1]]; if (v && viewAllowed(v)) { setCur(null); setCurProj(null); setView(v); } return; }
      setCur(null); setView("new"); // địa chỉ trống: về trang Mới
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [viewAllowed]);
  // Đoạn chat đang chờ bạn duyệt công cụ: ở ngoài đoạn chat đó vẫn phải thấy, quá 10 phút không trả lời thì công cụ bị từ chối và model làm tiếp.
  const needYou = useMemo(() => {
    const out = new Set<number>();
    for (const c of chats) {
      if (!running.has(c.id)) continue;
      const m = c.msgs[c.msgs.length - 1];
      if (m?.role === "ai" && !m.done && m.parts?.some((p) => p.k === "ask" && p.state === "wait")) out.add(c.id);
    }
    if (approval?.chat !== null && approval?.chat !== undefined) out.add(approval.chat);
    return out;
  }, [chats, running, approval]);
  const needSeen = useRef<ReadonlySet<number>>(new Set());
  // Lời báo cho trình đọc màn hình: câu trả lời xong, cần duyệt. Nằm ngoài chữ đang chảy nên không đọc từng chữ.
  const [sayAt, setSayAt] = useState("");
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
  const VIEW_TITLE: Partial<Record<View, string>> = { projects: "Dự án", project: "Dự án", artifacts: "Artifacts", customize: "Kho kỹ năng", code: "Code", speech: "Speech", inbox: "Hộp thư", brain: "Bộ não" };
  const tabName = view === "chat" ? (chat && !chat.inc ? chat.title : "") : tr(VIEW_TITLE[view] ?? "");
  useEffect(() => {
    const n = needYou.size;
    document.title = `${n ? `(${n}) ` : ""}${tabName ? `${tabName} · ` : ""}Synchro`;
  }, [needYou.size, tabName]);
  // Artifact của cuộc trò chuyện đang mở: mỗi identifier là một artifact, mỗi lần model viết lại là một phiên bản.
  const [artSel, setArtSel] = useState<{ chat: number; ident: string; v: number; follow: boolean } | null>(null);
  const [artFull, setArtFull] = useState(false);
  // Trình duyệt cạnh đoạn chat (như khung trình duyệt của Synchro Code): nút quả địa cầu ở đầu mọi đoạn chat mở / đóng khung;
  // khung tự mở khi Synchro bắt đầu dùng trình duyệt (của Synchro, hoặc Chrome của bạn qua tiện ích), và đoạn chat đó được đánh
  // dấu (chấm trên nút quả địa cầu). brwFor: đoạn chat đang mở khung.
  const [brwFor, setBrwFor] = useState<number | null>(null);
  const [brw, setBrw] = useState<{ available: boolean; reason?: string; control?: boolean; ext?: { allowed: boolean; paired: boolean }; target?: "synchro" | "user" } | null>(null);
  // Synchro vừa bắt đầu làm ở trình duyệt nào (của Synchro / Chrome của bạn): khung trình duyệt chuyển sang đó.
  const [brwPrefer, setBrwPrefer] = useState<{ v: "synchro" | "user"; n: number } | null>(null);
  // Trạng thái trình duyệt chỉ cần cho nút / khung trình duyệt ở đoạn chat đang mở: không hỏi lúc mở trang (blueprint A3.5), hỏi một lần
  // cho mỗi tài khoản khi lần đầu mở một đoạn chat hay khi khung trình duyệt được mở.
  const brwAsked = useRef("");
  const needBrw = view === "chat" || brwFor !== null;
  useEffect(() => {
    if (!me || !needBrw || brwAsked.current === me.id) return;
    brwAsked.current = me.id;
    fetch("/api/browser").then((r) => (r.ok ? r.json() : null)).then((j) => j && setBrw(j)).catch(() => { brwAsked.current = ""; });
  }, [me?.id, needBrw]); // eslint-disable-line react-hooks/exhaustive-deps
  const openBrowser = (ev: RunEv, chatId: number) => {
    if (ev.kind !== "ui" || !ev.text.startsWith("browser")) return;
    setBrwPrefer((p) => ({ v: ev.text === "browser:user" ? "user" : "synchro", n: (p?.n ?? 0) + 1 }));
    setChats((cs) => cs.map((c) => (c.id === chatId && !c.browser ? { ...c, browser: true } : c)));
    // Câu trả lời đang chạy ở nền (người dùng xem đoạn chat khác): không đóng khung đang mở của họ; quay lại thì mở bằng nút trình duyệt.
    if (chatId !== curRef.current) return;
    setArtSel(null); setFileSel(null); setBrwFor(chatId);
  };
  const brwOk = !!(brw?.available || brw?.ext?.allowed);
  // Tệp do code tạo đang xem trước (cùng khung bên cạnh với artifact; mở cái này thì đóng cái kia).
  const [fileSel, setFileSel] = useState<{ chat: number; file: OutFile } | null>(null);
  const artDismissed = useRef("");
  // Quét theo tiền tố: các tin trước tin cuối không đổi trong lúc chữ đang chảy, chỉ tin cuối phải tách và áp bản sửa lại.
  const artBase = useRef<{ msgs: Msg[]; scan: ArtScan } | null>(null);
  const arts = useMemo(() => {
    if (!chat || !caps.art) return ART_EMPTY;
    const ms = chat.msgs, n = Math.max(0, ms.length - 1), b = artBase.current;
    if (!b || b.msgs.length !== n || b.msgs.some((m, k) => m !== ms[k])) artBase.current = { msgs: ms.slice(0, n), scan: scanArts(ms.slice(0, n), 0, ART_EMPTY) };
    return scanArts(ms, n, artBase.current!.scan);
  }, [chat?.msgs, caps.art]); // eslint-disable-line react-hooks/exhaustive-deps
  // Đoạn chat có artifact: tải sẵn khung xem để bấm thẻ là mở ngay.
  useEffect(() => { if (arts.map.size) ArtifactPanel.preload(); }, [arts.map.size]);
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
  const brwShow = view === "chat" && !!chat && brwFor === chat.id && !artOpen && !fileOpen && brwOk;
  const panelOpen = artOpen || fileOpen || brwShow;
  useEffect(() => { if (!panelOpen) setArtFull(false); }, [panelOpen]);
  // Laptop: khung xem mở cạnh chat thì ô soạn tin từng bị ép còn vài chục px. Tự thu bảng đoạn chat (thanh điều hướng vẫn còn) cho đủ chỗ, đóng khung thì mở lại.
  const sideAuto = useRef(false);
  useEffect(() => {
    if (narrow()) return;
    if (panelOpen && open && window.innerWidth < 1360) { sideAuto.current = true; setOpen(false); }
    else if (!panelOpen && sideAuto.current) { sideAuto.current = false; setOpen(true); }
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const openArt = (s: { chat: number; ident: string; v: number; follow: boolean }) => { setFileSel(null); setArtSel(s); };
  const openFile = (f: OutFile) => { if (!chat) return; setArtSel(null); setFileSel({ chat: chat.id, file: f }); };
  // Mọi sản phẩm của đoạn chat (artifact bản mới nhất, tệp code đã tạo), để chuyển nhanh trong khung xem trước.
  const products: Product[] = !chat ? [] : [
    ...[...arts.map.entries()].map(([ident, vs]) => { const a = vs[vs.length - 1]; return { key: `a:${ident}`, title: a.title, type: a.type, content: a.content, open: () => openArt({ chat: chat.id, ident, v: vs.length - 1, follow: false }) }; }),
    ...chat.msgs.flatMap((m) => m.outs ?? []).filter((f) => !f.skipped).map((f) => ({ key: `f:${f.id}`, title: f.name, file: f, open: () => openFile(f) })),
  ];
  const activeProduct = artOpen && artSel ? `a:${artSel.ident}` : fileOpen && fileSel ? `f:${fileSel.file.id}` : "";
  const closeArt = () => {
    if (chat && liveArt) artDismissed.current = `${chat.id}-${lastIdx}-${liveArt.ident}`;
    setArtSel(null);
  };
  const threadRef = useRef<HTMLDivElement>(null);
  // Khoảng đệm cuối đoạn chat và nút "cuộn xuống" theo chiều cao thật của khối soạn tin (thẻ chế độ, tin chờ gửi xếp trên ô soạn):
  // tin cuối không bao giờ nằm dưới các thẻ đó.
  // Theo chính phần tử: khối soạn tin có thể gắn lại mà view, chat không đổi (phần tải sau, khung bắt lỗi), lúc đó bộ theo dõi cũ nằm trên phần tử đã mất.
  const [dockEl, dockRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const d = dockEl, host = d?.parentElement;
    if (!d || !host) return;
    // Cột chat hẹp (khung artifact mở, màn hình nhỏ): data-narrow bỏ dòng ghi chú dưới ô soạn tin để nó không vỡ nhiều dòng.
    const ro = new ResizeObserver(() => {
      host.style.setProperty("--dock-h", `${Math.round(d.getBoundingClientRect().height)}px`);
      const w = (d.querySelector(".composer") as HTMLElement | null)?.offsetWidth ?? d.clientWidth;
      if (w < 600) d.dataset.narrow = ""; else delete d.dataset.narrow;
      // Hẹp hơn nữa: ô nhập chiếm một dòng riêng, các nút xuống dòng dưới; ô nhập không bao giờ bị ép còn vài ký tự.
      if (w < 520) d.dataset.tight = ""; else delete d.dataset.tight;
    });
    ro.observe(d);
    return () => { ro.disconnect(); host.style.removeProperty("--dock-h"); };
  }, [dockEl]);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const [showDown, setShowDown] = useState(false);
  // Tự cuộn theo chữ đang viết chỉ khi người dùng đang đứng ở cuối. Kéo lên dù chỉ hơn 5px (lăn chuột, vuốt, kéo thanh cuộn, phím) là dừng
  // tự cuộn ngay, hiện nút nổi để quay xuống; trước đây phải lên quá 120px mới dừng nên đọc phần trên vẫn bị kéo tuột xuống.
  // Nội dung co lại (thu gọn khối, ảnh nở xong) làm trình duyệt hạ scrollTop nhưng vẫn sát đáy: xét khoảng cách tới đáy trước.
  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const top = el.scrollTop, gap = el.scrollHeight - top - el.clientHeight;
    if (gap <= 6) stick.current = true;
    else if (top < lastTop.current - 5) stick.current = false;
    lastTop.current = top;
    setShowDown(!stick.current && gap > 6);
  };
  // Lăn chuột / vuốt lên, phím lên trang: dừng tự cuộn ngay lúc đó (sự kiện scroll tới sau một khung hình, chữ mới có thể kịp kéo xuống trước).
  const userUp = () => { const el = threadRef.current; if (el && el.scrollTop > 0) stick.current = false; };
  const touchY = useRef(0);
  // Kéo về cuối khi đang bám đáy. Người dùng vừa kéo lên mà sự kiện scroll chưa kịp tới (chữ đang chảy): coi là đã rời đáy, không kéo lại.
  const follow = (el: HTMLElement) => {
    if (!stick.current) return;
    if (el.scrollTop < lastTop.current - 5 && el.scrollHeight - el.scrollTop - el.clientHeight > 6) { stick.current = false; setShowDown(true); return; }
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  };
  // Xa hơn vài màn hình thì nhảy tới gần cuối rồi mới trượt nốt: trượt suốt đoạn chat dài từng mất gần 1,5 giây, hàng ẩn dựng lại khi lướt qua.
  const toBottom = () => {
    const el = threadRef.current;
    if (!el) return;
    const left = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (left > el.clientHeight * 3) el.scrollTop = el.scrollHeight - el.clientHeight * 2;
    el.scrollTo({ top: 1e9, behavior: "smooth" });
  };
  // Mở một đoạn chat: đứng ngay ở tin cuối, không trôi từ đầu xuống (trôi mượt chỉ dành cho nút "cuộn xuống").
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    stick.current = true;
    setShowDown(false);
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [chat?.id, view]);
  useEffect(() => {
    const el = threadRef.current;
    if (el) follow(el);
  }, [chat?.msgs, busy]);
  // Tin ngoài màn hình chỉ có chiều cao ước tính (content-visibility), vẽ thật mới đủ cao; ảnh, biểu đồ cũng nở sau. Đang đứng ở cuối thì giữ ở cuối.
  useEffect(() => {
    const el = threadRef.current, inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => follow(el));
    ro.observe(inner);
    return () => ro.disconnect();
  }, [chat?.id, view]);

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
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
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
    // Chữ đến theo thời gian thực: cập nhật tin nhắn tối đa mỗi khung hình.
    // Vẽ tối đa khoảng 20 lần mỗi giây: mắt không thấy khác, cả trang (thanh bên, ô soạn) không phải dựng lại 60 lần mỗi giây.
    let pend: string | null = null, raf = 0, lastPaint = 0;
    const flush = () => { raf = 0; if (pend === null || !mine()) return; const now = performance.now(); if (now - lastPaint < 45) { raf = requestAnimationFrame(flush); return; } lastPaint = now; const t = pend; pend = null; patch(id, (ms) => (ms.length && ms[ms.length - 1].role === "ai" ? [...ms.slice(0, -1), { ...ms[ms.length - 1], text: t, prog: undefined }] : ms)); };
    const onDelta = (t: string) => { pend = t; if (!raf) raf = requestAnimationFrame(flush); };
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
      if (ev.kind === "say") pend = null;
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
          // pjFull: trình duyệt có đủ dữ liệu dự án nên lời nhắc trên là bản đúng; dự án chỉ là bản rút gọn (stub) thì máy chủ tự thêm hướng dẫn dự án.
          ...(pr && !pr.stub ? { pjFull: true } : {}) } });
      webs = meta.webs ?? [];
      // Tự động đã chuyển sang model khác vì model đầu lỗi / quá tải: giữ lời báo dưới câu trả lời (thanh thông báo chỉ hiện một lúc).
      if (meta.switched) notice = { text: meta.switched };
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
    if (raf) cancelAnimationFrame(raf);
    // Người dùng đã bấm Dừng: máy chủ trả phần đã viết và dấu vết (công cụ bị dừng ghi cancelled_by_user) — lưu lại cho lượt sau.
    if (!mine()) {
      if (cancelled) patch(id, (ms) => ms.map((m, k) => (k === ms.length - 1 && m.role === "ai" && m.stopped ? { ...m, text: m.text || reply, trace: trace?.length ? trace : m.trace, outs: outs?.length ? outs : m.outs } : m)));
      return;
    }
    // Lượt lỗi: hiện thẻ lỗi ngay (không giả lập gõ chữ), giữ phần đã viết và nhật ký làm việc; không tính là câu trả lời xong.
    if (failed) {
      const partial = notice?.partial ? reply : pend;
      patch(id, (m) => [...m.slice(0, -1), { ...workOf(m[m.length - 1]), role: "ai", text: partial ?? m[m.length - 1]?.text ?? "", failed: true, err: said, notice, done: true, time: Date.now(), dur: Date.now() - t0, outs: outs?.length ? outs : undefined, trace: trace?.length ? trace : undefined, webs: webs?.length ? webs : undefined }]);
      stop(false, id);
      doneAway(id, true);
      return;
    }
    // Đã dùng hướng dẫn cá nhân / ngữ cảnh dự án: chỉ đặt cờ để hiện chip trung tính dưới câu trả lời. Mọi câu trả lời thật đều truyền theo thời gian thực
    // (lượt chạy bền qua waitRun/pollRun), nên KHÔNG xét "streamed" — nếu không chip cá nhân không bao giờ hiện; chỉ cần lượt xong và không bị Dừng.
    // Không bao giờ ghép nội dung hướng dẫn vào chữ câu trả lời: dòng ghi chú kèm 90 ký tự đầu của hướng dẫn từng lộ hướng dẫn cá nhân trong lịch sử, bản chia sẻ, bản xuất.
    const insApplied = !cancelled && !!ins.trim();
    const pjApplied = !cancelled && !!pr && !!(pr.ins?.trim() || pr.mem?.length || getRelevantContext(pr, text).length);
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
    if (capsRef.current.crit) for (const a of full) if (important(a)) runCritic(id, a, gen, question, true);
  };
  const runCritic = (id: number, a: ArtBlock, gen = "", question = "", auto = false) => {
    const key = criticKey(a.ident, a.content);
    // Giữ kết quả của 30 phiên bản gần nhất trong đoạn chat.
    const put = (e: CriticEntry) => setChats((cs) => cs.map((c) => (c.id !== id ? c : { ...c, critic: Object.fromEntries([...Object.entries(c.critic ?? {}).filter(([k]) => k !== key).sort((x, y) => y[1].at - x[1].at).slice(0, 29), [key, e]]) })));
    put({ status: "run", findings: [], by: [], at: Date.now() });
    fetch("/api/critic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: a.title, type: a.type, lang: a.lang, content: a.content, model: gen, question: question.slice(0, 1500), auto }) })
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
    setTimeout(() => afterArtifacts(id, ai), 0);
  };
  // Đổi phong cách artifact không gọi model: một cặp tin (yêu cầu + bản sửa data-sx-preset) thành phiên bản mới, lượt sau model thấy phong cách mới trong lịch sử.
  // Bộ thiết kế (artkit, designpresets: hơn 100 KB) chỉ tải khi bấm đổi phong cách, không nằm trong phần tải đầu (blueprint B3.2).
  const restyle = async (id: number, a: { ident: string; title: string; content: string }, preset: string) => {
    const [{ restylePatch }, { presetOf }] = await Promise.all([import("./artkit"), import("./designpresets")]);
    const p = restylePatch(a.content, preset);
    if (!p) return;
    const now = Date.now(), label = tr(presetOf(preset)?.name ?? preset);
    const ai = `${tr("Đã đổi phong cách sang")} ${label}.\n\n<artifact identifier="${a.ident}" mode="patch">\n${p}\n</artifact>`;
    patch(id, (m) => [...m, { role: "user", text: `${tr("Đổi phong cách")} “${a.title}” → ${label}`, time: now }, { role: "ai", text: ai, done: true, time: now }]);
    setArtSel({ chat: id, ident: a.ident, v: 0, follow: true });
    setTimeout(() => afterArtifacts(id, ai), 0);
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
    if (c && !document.hidden) say(failed ? (getLang() === "en" ? `The reply in “${c.title}” hit an error` : `Câu trả lời trong “${c.title}” gặp lỗi`) : getLang() === "en" ? `Synchro finished replying in “${c.title}”` : `Synchro đã trả lời xong “${c.title}”`);
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
      attachRun(run, (prog) => { if (mine()) set((m) => ({ ...m, prog })); }, (text) => { if (mine()) set((m) => ({ ...m, text, prog: undefined })); }, (ev) => { if (!mine()) return; openBrowser(ev, c.id); if (ev.kind !== "steer") set((m) => ({ ...m, ...applyEvent(m, ev), ...(ev.kind === "say" ? { text: "" } : {}) })); }, meta, c.id).then((text) => {
        const used = meta.skills ?? [], libs = meta.libs ?? [], outs = meta.files ?? [], trace = meta.trace ?? [], stopped = !!meta.cancelled;
        // Người dùng bấm Dừng trong lúc chờ: tin đã đánh dấu dừng, chỉ giữ thêm phần máy chủ trả về.
        if (!mine()) { if (stopped) patch(c.id, (ms) => ms.map((m, k) => (k === ms.length - 1 && m.role === "ai" && m.stopped ? { ...m, text: m.text || text, trace: trace.length ? trace : m.trace } : m))); return; }
        const inLib = new Set(libs.flatMap((l) => [l.key, ...l.skills]));
        const sk = [...new Set(used.filter((u) => u.kind === "skill" && !inLib.has(u.name)).map((u) => u.name))];
        const tl = [...new Set(used.filter((u) => u.kind === "tool").map((u) => u.name))];
        const via = meta.route ?? null;
        set((m) => ({ ...m, text, done: true, prog: undefined, run: undefined, time: Date.now(), dur: Date.now() - (last.time ?? Date.now()), skills: sk.length ? sk : undefined, libs: libs.length ? libs : undefined, tools: tl.length ? tl : undefined, outs: outs.length ? outs : undefined, via: via ?? undefined, viaTask: via ? meta.routeTask : undefined, trace: trace.length ? trace : undefined, stopped: stopped || undefined, webs: meta.webs?.length ? meta.webs : undefined }));
        stop(false, c.id);
        doneAway(c.id);
        setTimeout(() => autoTitle(c.id), 300);
      }, (e) => {
        if (!mine()) return;
        const said = e instanceof LLMError && e.message ? e.message : GENERIC_ERR, d = e instanceof LLMError ? e.data : {};
        const kept = typeof d.text === "string" && d.text.trim() ? d.text : "";
        set((m) => ({ ...m, done: true, prog: undefined, run: undefined, failed: true, err: said, text: kept || m.text, notice: noticeOf(d, kept ? said : ""), ...(Array.isArray(d.files) && d.files.length ? { outs: d.files as Msg["outs"] } : {}), ...(Array.isArray(d.trace) && d.trace.length ? { trace: d.trace as Msg["trace"] } : {}) }));
        stop(false, c.id);
      });
    }
  }, [loaded, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const [undoTurn, setUndoTurn] = useState<{ chat: number; msgs: Msg[]; compact: Chat["compact"]; n: number } | null>(null);
  const send = (t: string, f: string[] = [], pick?: { id: string; label: string }[]) => {
    if (busy) return;
    setUndoTurn(null);
    if (view === "chat" && chat?.stub) return say("Đoạn chat đang tải từ máy chủ, hãy thử lại sau giây lát");
    stick.current = true;
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
    const prior = id !== null && view === "chat" ? (chatsRef.current.find((c) => c.id === id)?.msgs ?? []) : [];
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
    stick.current = true;
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
    const c = chat;
    if (!c || c.inc || c.stub) return;
    const id = Date.now();
    const msgs = c.msgs.slice(0, i + 1).map((m) => ({ ...m, run: undefined, prog: undefined, done: true }));
    const title = `${c.title} · ${getLang() === "en" ? "branch" : "nhánh"}`;
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
    if (!chat || busy) return;
    if (!avoid && continuable(chat.msgs[chat.msgs.length - 1])) { send(tr("Tiếp tục từ chỗ đang dở")); return; }
    const k = chat.msgs.map((m) => m.role).lastIndexOf("user");
    if (k >= 0) resend(chat, k, chat.msgs[k], avoid);
  };
  // Đổi model bằng một lần bấm sau khi lượt lỗi. Đã có phần làm dở thì làm tiếp (dấu vết công cụ nằm trong lịch sử, model mới biết việc nào đã xong),
  // chưa có gì thì gửi lại đúng tin vừa rồi. Đang để Tự động thì giữ Tự động: máy chủ đã biết model nào đang nghỉ.
  const switchModel = (key: string) => {
    if (!chat || busy) return;
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
  useEffect(() => { if (loaded && view === "chat" && cur !== null && !chats.some((c) => c.id === cur)) { setCur(null); setView("new"); } }, [chats]); // eslint-disable-line react-hooks/exhaustive-deps
  const { togglePin, setChatTags } = useChatStore.getState();
  const filterTag = (t: string | null) => { setTagFilter(t); if (t) setOpen(true); };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (userRef.current && !userRef.current.contains(t)) setUserMenu(false);
      if (!t.closest(".chat-wrap")) { setChatMenu(null); setCodeMenu(null); setPickProj(false); if (!t.closest(".title-wrap")) setPickTag(false); }
      if (!t.closest(".title-wrap")) setTitleMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // ⌘K mở bảng lệnh tải lazy: ô tìm chỉ nhận focus sau khi phần mềm của bảng tải xong, nên các phím gõ ngay sau ⌘K bị rơi.
  // Giữ các phím đó lại từ lúc bấm ⌘K cho tới khi ô tìm có focus rồi chèn vào (bảng lệnh gọi palSeed khi đã gắn — tháo đúng lúc đó,
  // không theo một khoảng thời gian cố định có thể hết trước khi chunk lazy tải xong trên máy chậm).
  const palBuf = useRef("");
  const palArmed = useRef(false);
  const palSeed = useCallback(() => { const b = palBuf.current; palBuf.current = ""; palArmed.current = false; return b; }, []);
  // Đóng bảng lệnh bằng bất kỳ đường nào thì ngừng giữ phím (tránh giữ nhầm phím khi người dùng làm việc khác).
  useEffect(() => { if (modal !== "search") palArmed.current = false; }, [modal]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector(".app[inert]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // Đang giữ phím cho bảng lệnh và ô tìm chưa nhận focus: gom ký tự in được vào bộ đệm, chặn để không rơi vào trang.
      if (palArmed.current && !mod && !e.altKey && e.key.length === 1) {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest(".pal")) { palBuf.current += e.key; e.preventDefault(); return; }
        palArmed.current = false; // ô tìm đã có focus: tự nó nhận phím từ đây
      }
      if (e.key === "Escape") {
        // Đóng lớp phủ nằm trên cùng (z-index cao nhất; bằng nhau thì lớp sau): hộp gắn vào cuối <body> (createPortal) đứng sau hộp xác nhận
        // trong DOM dù hộp xác nhận nằm trên nó.
        const ov = [...document.querySelectorAll(".overlay")].filter((o) => !o.closest(".closing"));
        const z = (o: Element) => Number(getComputedStyle(o).zIndex) || 0;
        if (ov.length) ov.reduce((a, o) => (z(o) >= z(a) ? o : a)).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        if (ov.length > 1) return;
        // Màn hẹp (≤ 860px): bảng đoạn chat nổi / ngăn kéo điện thoại nằm trên lớp phủ tối như một hộp thoại, Esc đóng nó khi không còn lớp nào
        // trên nó (menu đã tự đóng ở a11y.ts, hộp thoại ở trên). Đang gõ trong bảng (đổi tên, tìm) thì Esc là của ô đó. Tiêu điểm về nút đã mở bảng.
        const tgt = e.target as HTMLElement | null;
        if (!ov.length && openRef.current && narrow() && !tgt?.closest?.(".shell-side :is(input,textarea,select,[contenteditable=true])")) {
          const inSide = !!document.activeElement?.closest(".shell-side") || document.activeElement === document.body;
          setOpen(false);
          if (inSide) requestAnimationFrame(() => document.querySelector<HTMLElement>(window.matchMedia("(max-width: 760px)").matches ? ".side-toggle" : ".rail-mark")?.focus({ preventScroll: true }));
        }
        setGc(null); setModal(null); setDelId(null); setDelProj(null); setUserMenu(false); setChatMenu(null); setCodeMenu(null); setTitleMenu(false); }
      else if (mod && k === "k") { e.preventDefault(); palBuf.current = ""; palArmed.current = true; setModal("search"); }
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
      const fl = Array.from(e.dataTransfer?.files ?? []); fl.forEach((x) => saveBlob(x.name, x, say)); const f = fl.map((x) => x.name);
      if (f.length) { setFiles((o) => capFiles(o, f, say)); setModal((m) => (m === "upload" ? null : m)); say(`Đã thêm ${f.length} tệp`); }
    };
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragenter", over); window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop); window.addEventListener("dragover", prevent);
    return () => { window.removeEventListener("dragenter", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("dragover", prevent); };
  }, [say]);

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
  useBrainSync(chats, !!me);
  const inboxN = useInboxCount(!!me);
  // Bảng lệnh ⌘K: lệnh nhanh và cách mở từng loại kết quả.
  const paletteCmds: PaletteCmd[] = [
    { id: "new", label: "Đoạn chat mới", icon: <I.Plus size={16} />, keys: "⇧⌘O", hay: "new chat tao moi", run: goNew },
    { id: "inbox", label: "Hộp thư", icon: <I.Inbox size={16} />, hay: "inbox tac vu nen lich hen ket qua", run: () => setView("inbox") },
    { id: "hub", label: "Kho kỹ năng", icon: <I.Plugins size={16} />, hay: "skill hub plugin thu vien", run: goCustom },
    { id: "connectors", label: "Kết nối", icon: <I.Connectors size={16} />, hay: "connectors mcp", run: () => { setCzTab("connectors"); setView("customize"); } },
    ...(caps.art !== false ? [{ id: "artifacts", label: "Artifacts", icon: <I.Shapes size={16} />, hay: "ung dung apps", run: () => setView("artifacts") }] : []),
    { id: "projects", label: "Dự án", icon: <I.Folder size={16} />, hay: "projects", run: () => { setCurProj(null); setView("projects"); } },
    { id: "settings", label: "Cài đặt", icon: <I.Cog size={16} />, keys: "⇧⌘,", hay: "settings", run: () => { setSettingsTab("General"); setModal("settings"); } },
    { id: "theme", label: theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối", icon: theme === "dark" ? <I.M icon="Sun" size={16} /> : <I.M icon="Moon" size={16} />, hay: "theme dark light toi sang", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "sidebar", label: "Ẩn / hiện thanh bên", icon: <I.Panel size={16} />, keys: "⌘.", hay: "sidebar", run: () => setOpen((o) => !o) },
    { id: "keys", label: "Phím tắt", icon: <I.Keyboard size={16} />, keys: "⌘/", hay: "shortcuts", run: () => setModal("keys") },
  ];
  const paletteGo: PaletteGo = {
    chat: (id) => { setCur(id); setView("chat"); },
    artifact: (conv, title) => { const c = chats.find((x) => String(x.id) === conv); if (c) { setCur(c.id); setView("chat"); } else { setTab(0); setArtQ(title); setView("artifacts"); } },
    app: (id) => window.open(`/apps/${id}`, "_blank", "noopener"),
    skillHub: (q) => { if (q) { try { sessionStorage.setItem("hub-q", q); } catch {} } goCustom(); if (q) window.dispatchEvent(new CustomEvent(HUB_SEARCH, { detail: q })); },
    project: (id) => { setCurProj(id); setView("project"); },
    code: (id) => { setCodeCur(id); setView("code"); if (codeList.find((c) => c.id === id)?.archived) codePatch(id, { archived: false }); },
    brain: (title) => window.dispatchEvent(new CustomEvent("synchro:brain", { detail: { title } })),
    inbox: () => setView("inbox"),
    tag: (t) => filterTag(t),
  };
  // Mở kết quả tác vụ nền thành đoạn chat để hỏi tiếp.
  const openAsChat = (title: string, text: string) => {
    const id = Date.now();
    setChats((cs) => [{ id, title: title.slice(0, 40), msgs: [{ role: "user", text: `${tr("Tác vụ nền")}: ${title}`, time: id }, { role: "ai", text, done: true, time: id }] }, ...cs]);
    setCur(id); setView("chat");
  };
  // Gửi tiếp một tin vào đoạn chat có sẵn (tin "gửi sau khi xong"), kể cả khi người dùng đang ở mục khác hay đoạn chat khác.
  const followUp = (id: number, t: string) => {
    const c = chatsRef.current.find((x) => x.id === id);
    if (!c) return;
    if (id === curRef.current) stick.current = true;
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
  const composerProps = { focusKey: `${view}:${cur}:${focusN}:${tplMode}`, onSend: send, busy, onSteer, onStop: stop, say, prefill, files, setFiles, model, setModel, goCustom, goConnectors: () => { setCzTab("connectors"); setView("customize"); }, openUpload: () => setModal("upload"), onVoice: () => { stopSpeak(); setSpeaking(null); setVoiceOn(true); },
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
  const tagsAll = allTags(visible);
  // Thẻ đang lọc không còn đoạn chat nào (vừa gỡ thẻ cuối): thôi lọc.
  const tagOn = tagFilter && tagsAll.some((x) => tagKey(x.tag) === tagKey(tagFilter)) ? tagFilter : null;
  // Chọn hàng loạt ở thanh bên: đoạn chat và phiên code (ghim, đưa vào dự án, lưu trữ, xóa nhiều mục cùng lúc).
  type SideItem = { k: "chat"; c: Chat } | { k: "code"; c: CodeItem };
  const sideItems: SideItem[] = [...codeList.map((c) => ({ k: "code" as const, c })), ...visible.map((c) => ({ k: "chat" as const, c }))];
  const sb = useBulk(sideItems, (x) => `${x.k}:${x.c.id}`);
  // Thanh bên: danh sách dài chia trang gọn (đoạn chat 20 / trang, phiên code 10 / trang), không phải cuộn mãi.
  const pinPj = new Set(projects.filter((x) => x.pinned && !x.archived).map((x) => x.id));
  const pgRest = usePage(visible.filter((c) => !c.pinned && !(c.project !== undefined && pinPj.has(c.project))), 20);
  const pgCode = usePage(codeList.filter((c) => !c.pinned && !c.archived), 10);
  const pgArch = usePage(codeList.filter((c) => c.archived), 10);
  const sidePager = (pg: { page: number; pages: number; from: number; to: number; total: number; setPage: (n: number) => void }) => <Pager compact page={pg.page} pages={pg.pages} from={pg.from} to={pg.to} total={pg.total} onPage={pg.setPage} />;
  const chatsOf = (l: SideItem[]) => l.flatMap((x) => (x.k === "chat" ? [x.c] : []));
  const codesOf = (l: SideItem[]) => l.flatMap((x) => (x.k === "code" ? [x.c] : []));
  const sideActs: BulkAct<SideItem>[] = [
    { id: "pin", label: "Ghim", icon: <I.M icon="Pin" size={15} />, when: (l) => l.some((x) => !x.c.pinned), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((x) => (ids.has(x.id) ? { ...x, pinned: true } : x)));
      for (const c of codesOf(l)) if (!c.pinned) codePatch(c.id, { pinned: true });
      say(`Đã ghim ${l.length} mục`);
    } },
    { id: "unpin", label: "Bỏ ghim", icon: <I.M icon="PinOff" size={15} />, when: (l) => l.some((x) => x.c.pinned), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((x) => (ids.has(x.id) ? { ...x, pinned: false } : x)));
      for (const c of codesOf(l)) if (c.pinned) codePatch(c.id, { pinned: false });
      say(`Đã bỏ ghim ${l.length} mục`);
    } },
    { id: "proj", label: "Thêm vào dự án", icon: <I.FolderPlus size={15} />, when: (l) => chatsOf(l).length > 0 && projects.some((p) => !p.archived),
      choices: () => projects.filter((p) => !p.archived).map((p) => ({ id: String(p.id), label: p.name })),
      run: (l, pid) => { const ids = new Set(chatsOf(l).map((c) => c.id)); const pr = projects.find((p) => String(p.id) === pid); if (!pr) return; setChats((cs) => cs.map((x) => (ids.has(x.id) ? { ...x, project: pr.id } : x))); say(`Đã thêm ${ids.size} đoạn chat vào "${pr.name}"`); } },
    { id: "unproj", label: "Gỡ khỏi dự án", icon: <I.Layers size={15} />, when: (l) => chatsOf(l).some((c) => c.project !== undefined), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((x) => (ids.has(x.id) ? { ...x, project: undefined } : x))); say("Đã gỡ khỏi dự án");
    } },
    { id: "arch", label: "Lưu trữ", icon: <I.Archive size={15} />, when: (l) => codesOf(l).some((c) => !c.archived), run: (l) => { for (const c of codesOf(l)) if (!c.archived) codePatch(c.id, { archived: true }); say("Đã lưu trữ các phiên code đã chọn"); } },
    { id: "unarch", label: "Khôi phục", icon: <I.Restore size={15} />, when: (l) => codesOf(l).some((c) => c.archived), run: (l) => { for (const c of codesOf(l)) if (c.archived) codePatch(c.id, { archived: false }); say("Đã khôi phục các phiên code đã chọn"); } },
    { id: "del", label: "Xóa", icon: <I.Trash size={15} />, danger: true,
      confirm: (l) => { const a = chatsOf(l).length, b = codesOf(l).length; return { title: `Xóa ${l.length} mục?`, text: `${[a ? `${a} đoạn chat` : "", b ? `${b} phiên code` : ""].filter(Boolean).join(" và ")} sẽ bị xóa khỏi mọi thiết bị, cùng với ghi chú trong Bộ não và liên kết chia sẻ. Không hoàn tác được.`, ok: "Xóa" }; },
      run: (l) => {
        const ids = new Set(chatsOf(l).map((c) => c.id)), cids = new Set(codesOf(l).map((c) => c.id));
        if (ids.size) { for (const x of ids) if (running.has(x)) stop(true, x); setChats((cs) => cs.filter((c) => !ids.has(c.id))); chatSync.forget("chat", [...ids]); if (cur !== null && ids.has(cur)) goNew(); }
        if (cids.size) { setCodeList((x) => x.filter((c) => !cids.has(c.id))); for (const id of cids) { ls.remove("codeS:" + id); if (cpPage?.sync) deleteServerSession(id); } if (codeCur !== null && cids.has(codeCur)) setCodeCur(null); }
        say(`Đã xóa ${l.length} mục`);
      } },
  ];
  const [pinOpen, setPinOpen] = usePref("pinOpen", true);
  const [recentOpen, setRecentOpen] = usePref("recentOpen", true);
  const pill = false && (
    <div className="plan-pill">Gói Free · <a onClick={() => setModal("upgrade")}>Nâng cấp</a>{view === "chat" && <button aria-label={tr("Đóng")} onClick={() => setBanner(false)} style={{ display: "grid", marginLeft: 2 }}><I.X size={14} /></button>}</div>
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
    a.download = "synchro-data-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say("Đã xuất dữ liệu");
  };
  // Xóa phiên trên máy chủ. Mặc định dữ liệu của tài khoản vẫn được giữ trên thiết bị (đã tách theo tài khoản) cho lần đăng nhập sau;
  // clear (hộp đăng xuất: "Xóa dữ liệu trên thiết bị này") xóa mọi khóa u:<uid>:* sau khi đã đẩy lên máy chủ (LogoutConfirm), đăng nhập lại thì tải về.
  const logout = (clear = false) => {
    const uid = userScope();
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    flushDirty();
    setUserScope(null); reloadPrefs(); resetCodePrefs(); clearJsonCache(); listAt.current = 0;
    if (clear) clearAccountData(uid);
    // Thôi theo dõi các câu trả lời đang chạy (không hủy ở máy chủ: đăng nhập lại thì trang nối vào lượt đó như khi tải lại).
    gens.current.clear(); runs.current.clear(); setRunning(new Set());
    approvalRef.current?.resolve({ decisions: {} }); setApproval(null);
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
    wipe: (what: "all" | "chats") => { if (saveT.current) { clearTimeout(saveT.current.t); saveT.current = null; } if (what === "all") ls.clear(); else ["chats", "projects", "model", "banner"].forEach((k) => ls.remove(k)); chatSync.wipeAll(chats.filter((c) => !c.inc).map((c) => c.id), projects.map((p) => p.id)); setChats([]); setProjects([]); setBanner(true); goNew(); },
    me: me ?? null, setMe, logout,
  };

  const rowCx = useRef<RowCx | null>(null);
  if (chat) rowCx.current = { model, switchModel, fork, altModels: models.providers.flatMap((p) => p.models).filter((x) => allowsModel(models.allowed, x.key)).length > 1, chat, chats, say, fm, arts, artOpen, artIdent: artSel?.ident, artIndex, openPlugins, openArt, openFile, send: (t) => send(t), copy, speak, like, retry, openProviders: () => { setSettingsTab("Providers"); setModal("settings"); }, edit: (i, text) => { const u = chat.msgs[i]; if (!busy && u?.role === "user") resend(chat, i, { ...u, text, time: Date.now() }); } };
  // Dấu của phần artifact trong một tin: có phiên bản mới, đổi bản đang xem thì dòng tin đó vẽ lại.
  const artSig = (i: number) => arts.at[i]?.map((x) => `${x.ident}:${x.v}:${arts.map.get(x.ident)?.length}:${artOpen && artSel?.ident === x.ident && artIndex === x.v ? 1 : 0}`).join("|") ?? "";

  // Chưa biết đã đăng nhập chưa: người đã đăng nhập lần trước thấy ngay khung app (html[data-sess], layout.tsx), người mới thấy nền trống rồi tới màn hình đăng nhập.
  if (me === undefined || !langReady) return <div className="boot" aria-busy={!bootErr}><BootSkeleton chat={bootChat} />
    {bootErr && <div className="boot-err" role="alert"><Mark size={26} /><b>{tr("Chưa kết nối được tới Synchro")}</b><p>{tr("Đoạn chat và phần bạn đang gõ vẫn còn. Synchro đang tự thử lại.")}</p><button className="btn dark" onClick={() => bootRetry.current()}>{tr("Thử lại")}</button></div>}</div>;
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
          {nav({ v: "inbox", icon: <I.Inbox />, label: "Hộp thư", badge: inboxN })}
          {nav({ v: "brain", icon: <I.Brain />, label: "Bộ não" })}
          {me?.perms.features.code !== false && nav({ v: "code", icon: <I.Code />, label: "Code", onPick: () => {
            // Rời Code khi lượt đang chạy rồi quay lại thì về đúng phiên đó, không phải trang trống. Đang ở trong Code mà bấm lại thì mới là mở phiên mới.
            const live = view !== "code" ? (codeList.find((c) => c.id === codeCur && c.running) ?? codeList.find((c) => c.running)) : undefined;
            setCodeCur(live ? live.id : null);
          } })}
          {me?.perms.features.speech !== false && (speechReady || me?.isAdmin) && nav({ v: "speech", icon: <I.Speech />, label: "Speech", onPick: () => setSpTool("home") })}
          {me?.perms.features.skills !== false && nav({ v: "customize", icon: <I.Plugins />, label: "Kỹ năng", tip: "Kho kỹ năng" })}
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
      <aside className="sidebar">
        <div className="side-top">
          <a className="side-brand" href="/" onClick={(e) => { e.preventDefault(); goNew(); }} aria-label="Synchro"><Wordmark height={17} /></a>
        </div>
        <button className="side-search" onClick={() => setModal("search")}><I.Search size={15} /><span>Tìm đoạn chat, tệp, lệnh…</span><kbd>⌘K</kbd></button>
        {view === "speech" && me?.perms.features.speech !== false && (
          <div className="side-tools">
            <div className="section-label">Công cụ Speech</div>
            <div className="nav-sub" aria-label="Công cụ Speech">
              <button data-nav="sp-home" className={`nav-item ${spTool === "home" ? "active" : ""}`} onClick={() => setSpTool("home")}><I.Speech />Trang chủ Speech</button>
              <SpeechSideTools plan={spPlan} tool={spTool} pick={(k) => { setView("speech"); setSpTool(k); }} />
            </div>
          </div>
        )}
        {(() => {
          countRender("Sidebar");
          const row = (c: Chat) => (
            <div key={c.id} className="chat-wrap" {...bulkRow(sb, { k: "chat", c })}>
              {renaming === c.id ? (
                <input className="field" autoFocus aria-label="Đổi tên" defaultValue={c.title} style={{ margin: 0, height: 32 }}
                  onBlur={(e) => { const v = e.target.value.trim(); setChats((cs) => cs.map((x) => (x.id === c.id && v && v !== x.title ? { ...x, title: v, named: true } : x))); setRenaming(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              ) : (
                <button className={`chat-item ${view === "chat" && cur === c.id ? "active" : ""}`} aria-current={view === "chat" && cur === c.id ? "page" : undefined} onClick={() => { setCur(c.id); setView("chat"); }}>{sb.on && <BulkCheck on={sb.has({ k: "chat", c })} />}<span key={c.title} className="ct-t" data-notr>{c.title}</span>{needYou.has(c.id) ? <span className="ct-need" data-tip={tr("Đang chờ bạn duyệt")}>{tr("Cần bạn")}</span> : running.has(c.id) && <span className="ct-run" role="img" aria-label={tr("Đang trả lời")} data-tip={tr("Đang trả lời")} />}</button>
              )}
              {!sb.on && <button className="dots" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded={chatMenu === c.id} onClick={() => { setChatMenu(chatMenu === c.id ? null : c.id); setPickProj(false); setPickTag(false); setTitleMenu(false); }}>⋮</button>}
                <Menu open={!!(chatMenu === c.id)} className="down" style={{ top: 34, right: 0, width: pickTag ? 240 : 220 }}>
                  {pickTag ? (
                    <TagPicker tags={cleanTags(c.tags)} all={tagsAll} onChange={(t) => setChatTags(c.id, t)} onBack={() => setPickTag(false)} />
                  ) : !pickProj ? (
                    <>
                      <button className="menu-item" onClick={() => { togglePin(c.id); setChatMenu(null); }}>{c.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{c.pinned ? "Bỏ ghim" : "Ghim"}</button>
                      <button className="menu-item" onClick={() => { setRenaming(c.id); setChatMenu(null); }}><I.Pencil />Đổi tên</button>
                      <button className="menu-item" onClick={() => setPickTag(true)}><I.Icon name="Tag" />Gắn thẻ{c.tags?.length ? <span className="sc tag-n">{c.tags.length}</span> : <span className="sc"><I.ChevronR size={16} /></span>}</button>
                      <button className="menu-item" onClick={() => (projects.length ? setPickProj(true) : (say("Hãy tạo dự án trước ở mục Dự án"), setChatMenu(null)))}><I.Layers />Thêm vào dự án<span className="sc"><I.ChevronR size={16} /></span></button>
                      {c.project !== undefined && <button className="menu-item" onClick={() => { setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, project: undefined } : x))); setChatMenu(null); say("Đã gỡ khỏi dự án"); }}><I.Layers />Gỡ khỏi dự án</button>}
                      <hr />
                      <button className="menu-item del" onClick={() => { setDelId(c.id); setChatMenu(null); }}><I.Trash />Xóa</button>
                    </>
                  ) : (
                    projects.map((pr) => (
                      <button key={pr.id} className="menu-item" onClick={() => { setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, project: pr.id } : x))); say(`Đã thêm vào "${pr.name}"`); setChatMenu(null); setPickProj(false); }}><I.Layers />{pr.name}{c.project === pr.id && <span className="ck"><I.Check /></span>}</button>
                    ))
                  )}
                </Menu>
            </div>
          );
          const codeRow = (c: CodeItem) => (
            <div key={"code" + c.id} className="chat-wrap" {...bulkRow(sb, { k: "code", c })}>
              {codeRen === c.id ? (
                <input className="field" autoFocus aria-label="Đổi tên" defaultValue={c.title} style={{ margin: 0, height: 32 }}
                  onBlur={(e) => { codePatch(c.id, { title: e.target.value || c.title }); setCodeRen(null); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              ) : (
                <button className={`chat-item code-item ${view === "code" && codeCur === c.id ? "active" : ""}`} onClick={() => { setCodeCur(c.id); setView("code"); if (c.archived) codePatch(c.id, { archived: false }); }}>
                  {sb.on && <BulkCheck on={sb.has({ k: "code", c })} />}<span className="cv-ell">{c.title}</span><CodeBadge c={c} />
                </button>
              )}
              {!sb.on && <button className="dots" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded={codeMenu === c.id} onClick={() => setCodeMenu(codeMenu === c.id ? null : c.id)}>⋮</button>}
              <Menu open={codeMenu === c.id} className="down" style={{ top: 34, right: 0, width: 220 }}>
                <button className="menu-item" onClick={() => { codePatch(c.id, { pinned: !c.pinned }); setCodeMenu(null); }}>{c.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{c.pinned ? "Bỏ ghim" : "Ghim"}</button>
                <button className="menu-item" onClick={() => { setCodeRen(c.id); setCodeMenu(null); }}><I.Pencil />Đổi tên</button>
                <button className="menu-item" onClick={() => { codePatch(c.id, { archived: !c.archived }); setCodeMenu(null); say(c.archived ? "Đã khôi phục phiên code" : "Đã lưu trữ phiên code"); }}>{c.archived ? <I.M icon="Retry" /> : <I.M icon="Inbox" />}{c.archived ? "Khôi phục" : "Lưu trữ"}</button>
                <hr />
                <button className="menu-item del" onClick={() => { setCodeMenu(null); setGc({ title: "Xóa phiên code?", text: "Phiên code và lịch sử của nó sẽ bị xóa, kể cả trên máy chủ nếu đang bật đồng bộ. Không hoàn tác được.", ok: "Xóa", fn: () => { setCodeList((l) => l.filter((x) => x.id !== c.id)); ls.remove("codeS:" + c.id); if (cpPage?.sync) deleteServerSession(c.id); if (codeCur === c.id) setCodeCur(null); say("Đã xóa phiên code"); } }); }}><I.Trash />Xóa</button>
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
                    <span>{x.name}</span>
                  </button>
                  {/* Nút riêng đặt đè lên biểu tượng, không lồng trong nút của dòng: nút lồng nút thì bàn phím không tới được. */}
                  <button className="pj-tg" aria-label={open ? "Thu gọn" : "Mở rộng"} aria-expanded={open} onClick={() => setPjClosed({ ...pjClosed, [x.id]: open })}><span className={`sec-chev ${open ? "open" : ""}`}><I.Chevron size={14} /></span></button>
                  <button className="dots" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded={sideProj === x.id} onClick={() => setSideProj(sideProj === x.id ? null : x.id)}>⋮</button>
                  {sideProj === x.id && <ProjMenu p={x} open pin style={{ top: 34, right: 0, width: 240 }}
                    onPin={() => { patchProj(x.id, { pinned: false }); setSideProj(null); }}
                    onEdit={() => { setSideProj(null); setEditProj(x.id); }}
                    onArchive={() => { patchProj(x.id, { archived: true }); setSideProj(null); if (view === "project" && curProj === x.id) setView("projects"); say("Đã lưu trữ dự án"); }}
                    onDelete={() => { setSideProj(null); setDelProj(x.id); }} />}
                </div>
                <div className={`fold ${open && kids.length ? "open" : ""}`}><div className="pj-kids">{kids.map(row)}</div></div>
              </div>
            );
          };
          const pinned = visible.filter((c) => c.pinned && !nested(c));
          const rest = visible.filter((c) => !c.pinned && !nested(c));
          const codePinned = codeList.filter((c) => c.pinned && !c.archived);
          const codeRest = codeList.filter((c) => !c.pinned && !c.archived);
          const codeArch = codeList.filter((c) => c.archived);
          if (tagOn) {
            const hit = visible.filter((c) => hasTag(c.tags, tagOn));
            return (
              <div className="chat-scroll">
                <TagFilter all={tagsAll} cur={tagOn} onPick={setTagFilter} />
                <div className="section-label tag-sec"><span><span aria-hidden>#</span><span data-notr>{tagOn}</span> · {hit.length}</span><button className="icon-btn" onClick={() => setTagFilter(null)} aria-label="Bỏ lọc theo thẻ" data-tip="Bỏ lọc theo thẻ"><I.X size={14} /></button></div>
                <div className="chat-list">{hit.map(row)}</div>
              </div>
            );
          }
          return (
            <div className="chat-scroll">
              <TagFilter all={tagsAll} cur={null} onPick={setTagFilter} />
              {(pinned.length > 0 || pinProjs.length > 0 || codePinned.length > 0) && (
                <>
                  <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setPinOpen(!pinOpen)}><span>Đã ghim</span><span className={`sec-chev ${pinOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button></div>
                  <div className={`fold ${pinOpen ? "open" : ""}`}><div className="chat-list">{pinProjs.map(projRow)}{codePinned.map(codeRow)}{pinned.map(row)}</div></div>
                </>
              )}
              {codeRest.length > 0 && (
                <>
                  <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setCodeOpen(!codeOpen)}><span>Code</span><span className={`sec-chev ${codeOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button></div>
                  <div className={`fold ${codeOpen ? "open" : ""}`}><div><div className="chat-list">{pgCode.items.map(codeRow)}</div>{sidePager(pgCode)}</div></div>
                </>
              )}
              {codeArch.length > 0 && (
                <>
                  <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setArchOpen(!archOpen)}><span>Code đã lưu trữ · {codeArch.length}</span><span className={`sec-chev ${archOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button></div>
                  <div className={`fold ${archOpen ? "open" : ""}`}><div><div className="chat-list code-arch">{pgArch.items.map(codeRow)}</div>{sidePager(pgArch)}</div></div>
                </>
              )}
              <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setRecentOpen(!recentOpen)}><span>Đoạn chat và tác vụ</span><span className={`sec-chev ${recentOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button>{sideItems.length > 0 && <button className={`icon-btn bk-side${sb.on ? " on" : ""}`} style={{ width: 24, height: 24 }} aria-pressed={sb.on} aria-label={sb.on ? "Xong" : "Chọn hàng loạt"} data-tip={sb.on ? "Xong" : "Chọn hàng loạt"} onClick={() => (sb.on ? sb.exit() : sb.start())}>{sb.on ? <I.X size={14} /> : <I.ListChecks size={16} />}</button>}<button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Tìm kiếm đoạn chat" data-tip="Tìm kiếm đoạn chat" onClick={() => setModal("search")}><I.Search size={15} /></button></div>
              {/* Danh sách VÀ thanh phân trang nằm trong MỘT div là con duy nhất của .fold (như các khối .fold ở trên): .fold dùng grid-template-rows 0fr chỉ co được một hàng, để hai con thì khi gập, thanh phân trang "1-20/30" vẫn còn. */}
              <div className={`fold ${recentOpen ? "open" : ""}`}>
                <div>
                  <div className="chat-list">
                    {/* Thiết bị mới: danh sách đang về từ máy chủ thì hiện dòng chờ đúng cỡ, chưa nói "chưa có" khi chưa biết. */}
                    {visible.length === 0 && (!chats.length && !syncSt.at && !syncSt.offline ? <ChatListSkeleton /> : <div className="muted" style={{ padding: "6px 10px", fontSize: 13 }}>Chưa có đoạn chat nào</div>)}
                    {pgRest.items.map(row)}
                  </div>
                  {sidePager(pgRest)}
                </div>
              </div>
              <BulkBar b={sb} acts={sideActs} noun="mục" compact />
            </div>
          );
        })()}
      </aside>
      </div>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <main id="main" tabIndex={-1} className={`main ${panelOpen ? `has-art ${artFull ? "art-full" : ""}` : ""}`}>
        <VerifyBanner me={me ?? null} onChange={setMe} />
        <div className="sr-only" role="status" aria-live="polite" data-notr>{sayAt}</div>
        {syncSt.risk && <div className="sync-warn" role="alert"><I.InfoCircle size={16} /><span>{tr("Trình duyệt đã hết chỗ và máy chủ chưa nhận được bản mới nhất của")} {syncSt.pending + syncSt.tooBig} {tr("mục. Đừng đóng trang trước khi xuất dữ liệu.")}</span><button className="btn" onClick={exportData}>{tr("Xuất dữ liệu")}</button></div>}
        {view !== "code" && view !== "speech" && view !== "brain" && <div className="topbar">
          <div className="left">
            {!open && <SideToggle onClick={() => setOpen(true)} />}
            {view === "chat" && chat && (
              <div className="title-wrap" style={{ position: "relative" }}>
                <button className="sel" style={{ fontSize: 14 }} aria-haspopup="menu" aria-expanded={titleMenu} onClick={() => { setTitleMenu(!titleMenu); setPickTag(false); setChatMenu(null); }}><span className="sel-t" data-notr>{chat.title}</span><I.Chevron size={14} /></button>
                  <Menu open={!!(titleMenu)} className="down" style={{ top: 36, left: 0, width: pickTag ? 240 : 200 }}>
                    {pickTag && titleMenu ? <TagPicker tags={cleanTags(chat.tags)} all={tagsAll} onChange={(t) => setChatTags(chat.id, t)} onBack={() => setPickTag(false)} /> : <>
                    <button className="menu-item" onClick={() => { togglePin(chat.id); setTitleMenu(false); }}>{chat.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{chat.pinned ? "Bỏ ghim" : "Ghim"}</button>
                    <button className="menu-item" onClick={() => { setRenaming(chat.id); setOpen(true); setTitleMenu(false); }}><I.Pencil />Đổi tên</button>
                    <button className="menu-item" onClick={() => setPickTag(true)}><I.Icon name="Tag" />Gắn thẻ{chat.tags?.length ? <span className="sc tag-n">{chat.tags.length}</span> : <span className="sc"><I.ChevronR size={16} /></span>}</button>
                    <button className="menu-item" onClick={() => { setTitleMenu(false); autoTitle(chat.id, true); }}><I.Sparkle />Đặt tên tự động</button>
                    <hr />
                    <button className="menu-item del" onClick={() => { setDelId(chat.id); setTitleMenu(false); }}><I.Trash />Xóa</button>
                    </>}
                  </Menu>
              </div>
            )}
            {view === "chat" && chat ? <TagChips tags={cleanTags(chat.tags)} onPick={filterTag} onOpen={() => { setChatMenu(null); setTitleMenu(true); setPickTag(true); }} /> : null}
          </div>
          {(view === "new" || view === "chat") && pill}
          <div className="right">
            {view === "new" && <button className={`icon-btn ${incog ? "ghost-on" : ""}`} onClick={() => { armDraft(); setIncog(!incog); say(incog ? "Đã tắt chế độ ẩn danh" : "Chế độ ẩn danh: không lưu vào lịch sử, không vào Bộ não"); }} aria-label="Ẩn danh" aria-pressed={incog}><I.Ghost /></button>}
            {view === "chat" && products.length > 0 && !panelOpen && <button className="btn prod-btn" onClick={() => products[products.length - 1].open()} title={tr("Xem trước sản phẩm của đoạn chat")}><I.Eye size={15} />{tr("Sản phẩm")}<span className="prod-n">{products.length}</span></button>}
            {view === "chat" && chat && brwOk && <button className={`icon-btn brw-btn ${brwShow ? "on" : ""}`} onClick={() => { setArtSel(null); setFileSel(null); setBrwFor(brwShow ? null : chat.id); }} aria-label={brwShow ? "Đóng trình duyệt" : "Mở trình duyệt"} data-tip={brwShow ? "Đóng trình duyệt" : "Trình duyệt"}><I.Globe size={17} />{chat.browser && <span className="brw-dot" aria-hidden />}</button>}
            {view === "chat" && <button className="btn" onClick={() => setModal("share")}>Chia sẻ</button>}
          </div>
        </div>}

        {view === "new" && (
          <div className="hero" key={String(incog)}>
            <div className="hero-col">
            <div className="hero-date" data-notr>{new Date().toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", { weekday: "long", day: "numeric", month: "long" })}</div>
            <h1 className="greeting">{incog && <I.Ghost size={26} />}<span className="greet-t">{incog ? "Đoạn chat ẩn danh" : <>{greet[0]}{greet[1] && <>, <span data-notr>{greet[1]}</span></>}</>}</span></h1>
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
                {models.providers.some((p) => p.plan && IMAGE_PLANS.has(p.plan.cli)) && <button className="hero-chip" data-tip="Tạo ảnh chụp, tranh, logo, poster bằng gói đã đăng nhập" onClick={() => setPrefill((p) => ({ t: getLang() === "en" ? "Create an image of " : "Tạo ảnh ", n: p.n + 1 }))}><I.Image size={16} /><span>Tạo ảnh</span></button>}
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

        {view === "chat" && chat && (
          <>
            <h1 className="sr-only" data-notr>{chat.title}</h1>
            <div className="thread" ref={threadRef} onScroll={onScroll} onWheel={(e) => { if (e.deltaY < 0) userUp(); }}
              onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? 0; }} onTouchMove={(e) => { if ((e.touches[0]?.clientY ?? 0) - touchY.current > 5) userUp(); }}
              onKeyDown={(e) => { if (["PageUp", "ArrowUp", "Home"].includes(e.key)) userUp(); }}>
              <div className="thread-in">
                {chat.stub && <><span className="sr-only" role="status">{tr("Đang tải đoạn chat từ máy chủ…")}</span><ThreadSkeleton /></>}
                {chat.msgs.map((m, i) => <Boundary key={`${chat.id}-${i}`} compact resetKey={m.text}><MsgRow m={m} i={i} last={i === chat.msgs.length - 1} lang={getLang()} busy={busy} mark={chat.compact?.upto === i} art={caps.art} inl={caps.inl} artSig={artSig(i)}
                  fileActive={m.outs?.length && fileOpen ? fileSel?.file.id : undefined} copied={copied === `${chat.id}-${i}`} speaking={speaking === `${chat.id}-${i}`} chatId={chat.id} cx={rowCx} /></Boundary>)}
                {undoTurn?.chat === chat.id && <div className="msg-notice turn-undo" role="status"><p>{tr("Câu trả lời cũ đã được thay bằng lượt mới.")}</p><div className="msg-notice-act"><button className="lnk" onClick={undoLost}>{tr("Khôi phục bản cũ")}</button></div></div>}
                {approval && approval.chat === chat.id && <ApprovalCard calls={approval.calls} onDone={(d, inputs) => { approval.resolve({ decisions: d, inputs }); setApproval(null); }} />}
                {/* Tin nhắn thêm khi Synchro đang làm: hiện ngay trong đoạn chat (như Claude); model đọc ở bước kế tiếp rồi trả lời tiếp. */}
                {queued.filter((q) => q.chat === chat.id && q.mode === "steer").map((q) => (
                  <div key={q.id} className="user-wrap steer-pending">
                    <span className="steer-tag">{tr("Đã gửi · Synchro đang đọc")}</span>
                    <div className="user-msg"><UserText text={q.text} /></div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            </div>
            {showDown && (busy
              ? <button className="scroll-down gen" onClick={() => { stick.current = true; toBottom(); }} aria-label={tr("Cuộn xuống phần đang tạo")}><I.Chevron size={15} /><span>{tr("Đang tạo tiếp…")}</span></button>
              : <button className="scroll-down" onClick={() => { stick.current = true; toBottom(); }} aria-label="Cuộn xuống cuối"><I.Chevron size={16} /></button>)}
            <Boundary resetKey={`${artSel?.ident}-${fileSel?.file.id}-${brwFor}`}>
            {artOpen && artVersions && (
              <ArtifactPanel versions={artVersions} index={artIndex} setIndex={(v) => setArtSel({ chat: chat.id, ident: artSel!.ident, v, follow: false })} ai={caps.ai} onClose={closeArt}
                expanded={artFull} setExpanded={setArtFull} say={say} switcher={<ProductSwitcher items={products} active={activeProduct} />}
                conv={chat.inc ? undefined : String(chat.id)} extra={(a) => (!chat.inc && PUBLISHABLE.has(a.type) ? <PublishButton conv={String(chat.id)} art={a} say={say} /> : null)}
                onAsk={busy ? undefined : (text) => send(text)}
                criticOf={(a) => chat.critic?.[criticKey(a.ident, a.content)]} onCritic={chat.inc ? undefined : (a) => runCritic(chat.id, a)}
                onApplyFix={busy || chat.inc ? undefined : (a, f) => applyFix(chat.id, a, f)}
                onRestyle={busy || chat.inc ? undefined : (a, preset) => { restyle(chat.id, a, preset).catch(() => {}); }}
                onFix={busy ? undefined : (a, err) => send(`${tr("Artifact")} “${a.title}” ${tr("gặp lỗi")}: ${err}\n${tr("Hãy sửa lỗi này.")}`)} />
            )}
            {brwShow && (
              <div className="brw-panel">
                <BrowserHub ticket={browserTicket} synchro={{ available: !!brw?.available, reason: brw?.reason }} prefer={brwPrefer} visible say={say} onClose={() => setBrwFor(null)} onExpand={() => setArtFull(!artFull)} expanded={artFull} busy={busy}
                  onStop={busy ? () => stop() : undefined} />
              </div>
            )}
            {fileOpen && fileSel && (
              <FilePanel file={fileSel.file} onClose={() => setFileSel(null)} expanded={artFull} setExpanded={setArtFull} say={say} switcher={<ProductSwitcher items={products} active={activeProduct} />} />
            )}
            </Boundary>
            <div className="dock" ref={dockRef}>
              {chat.studio && (() => { const k = (Object.keys(STUDIO_OF) as TplKey[]).find((x) => STUDIO_OF[x] === chat.studio)!; return (
                <div className="dock-mode"><span className={`mode-tag sm mt-${k}`}>{TPLS.find((x) => x.k === k)!.label}<button className="mode-x" aria-label="Bỏ chế độ" data-tip="Bỏ chế độ, để Synchro tự chọn"
                  onClick={() => { setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, studio: undefined } : c))); say("Đã bỏ chế độ. Synchro sẽ tự chọn thư viện skill phù hợp."); }}><I.X size={12} /></button></span></div>); })()}
              <QueueChips items={queued.filter((q) => q.chat === chat.id && q.mode === "later")} onCancel={(qid) => setQueued((q) => q.filter((x) => x.id !== qid))} />
              <Composer {...composerProps} dock extra={<ContextMixer chat={chat} studio={chat.studio} busy={busy} say={say} recentSkills={[...new Set(chat.msgs.filter((m) => m.role === "ai").slice(-2).flatMap((m) => [...(m.libs ?? []).flatMap((l) => l.skills), ...(m.skills ?? [])]))]}
                onChange={(p) => setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, ...p } : c)))} />} />
              <div className="disclaimer dock-note"><span>Synchro là AI và có thể mắc lỗi. Vui lòng kiểm tra kỹ các câu trả lời.</span><ModelPicker model={model} setModel={setModel} /><UsageRing model={model} onDetails={() => { setSettingsTab("Usage"); setModal("settings"); }} /></div>
            </div>
          </>
        )}

        <Boundary resetKey={`${view}-${curProj}`}>
        {view === "projects" && (
          <ProjectsPage projects={projects} chats={chats} say={say} onNew={() => setModal("proj")} onOpen={(id) => { setCurProj(id); setView("project"); }} patch={patchProj} onEdit={(id) => setEditProj(id)} onDelete={(id) => setDelProj(id)}
            onDeleteMany={(ids) => { const del = new Set(ids); setProjects((ps) => ps.filter((x) => !del.has(x.id))); chatSync.forget("project", ids); setChats((cs) => cs.map((c) => (c.project !== undefined && del.has(c.project) ? { ...c, project: undefined } : c))); if (curProj !== null && del.has(curProj)) setCurProj(null); }} />
        )}

        {view === "project" && proj && (
          <ProjectPage proj={proj} chats={chats} say={say} patch={patchProj} onBack={() => setView("projects")} onOpenChat={(id) => { setCur(id); setView("chat"); }} onEdit={() => setEditProj(proj.id)} onDelete={() => setDelProj(proj.id)}
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
              onOpenChat={(conv) => { const c = chats.find((x) => String(x.id) === conv); if (!c) return false; setCur(c.id); setView("chat"); return true; }} />}
          </div></div>
        )}

        {view === "inbox" && <InboxPage say={say} model={model} onOpenChat={openAsChat} />}
        {view === "customize" && <CustomizePage tab={czTab} setTab={setCzTab} connectors={<ConnectorsPanel />} feats={{ skills: me?.perms.features.skills !== false, connectors: me?.perms.features.connectors !== false }} />}
        {view === "code" && <CodeView say={say} onMeta={onCodeMeta} onEmpty={setCodeEmpty} sid={codeCur} title={codeList.find((c) => c.id === codeCur)?.title ?? "Synchro Code"} model={model} modelPicker={<ModelPicker model={model} setModel={setModel} prefix="Model" />} sideOpen={open} onSide={() => setOpen(true)} onNew={() => setCodeCur(null)} onCreate={(id, title) => { setCodeList((l) => [{ id, title }, ...l]); setCodeCur(id); }} />}
        {view === "brain" && <BrainWorkspace initial={brainAt} onInitial={() => setBrainAt(null)} sideOpen={open} onSide={() => setOpen(true)} />}
        {view === "speech" && <SpeechView say={say} tool={spTool} setTool={setSpTool} sideOpen={open} onSide={() => setOpen(true)} />}
        </Boundary>
      </main>

      {drag && <div className="drop"><div className="drop-in"><div className="drop-ic"><I.Image size={30} /><I.Copy size={30} /><I.Folder size={30} /></div><span>Thả tệp vào đây</span></div></div>}
      <Toast text={toast} />
      {voiceOn && <VoiceMode onClose={() => setVoiceOn(false)} onAsk={(t) => send(t)} onTurn={voiceTurn} busy={busy} reply={lastAi ? { text: lastAi.failed ? tr(chatError(lastAi.err).text) : stripAppliedNotes(lastAi.text), time: lastAi.time ?? 0 } : null} rate={VOICE_RATE[vspeed] ?? 1} voice={vvoice} say={say} />}
      <Fade show={!!(modal === "settings")}><Settings initial={settingsTab} onTab={setSettingsTab} onClose={() => setModal(null)} theme={theme} setTheme={setTheme} /></Fade>
      <Fade show={!!(modal === "lang")}><LangModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "search")}><CommandPalette chats={visible} projects={projects} codes={codeList} cmds={paletteCmds} go={paletteGo} seed={palSeed} onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "share" && chat)}>{chat ? <ShareModal chat={chat} onClose={() => setModal(null)} say={say} /> : <></>}</Fade>
      {fm.node}
      <Fade show={!!(modal === "upload")}><UploadModal say={say} onConverted={(f, md) => { saveDoc(f.name, md); saveBlob(f.name, f, say); setFiles((o) => capFiles(o, [f.name], say)); setModal(null); say(`Đã chuyển thành ${f.name}`); }} onClose={() => setModal(null)} onFiles={(f) => { f.forEach((x) => saveBlob(x.name, x, say)); setFiles((o) => [...o, ...f.map((x) => x.name)]); setModal(null); say(`Đã thêm ${f.length} tệp`); }} /></Fade>
      <Fade show={!!(modal === "upgrade")}><UpgradeModal onClose={() => setModal(null)} say={say} /></Fade>
      <Fade show={!!(modal === "keys")}><ShortcutsModal onClose={() => setModal(null)} /></Fade>
      <Fade show={!!(modal === "logout")}><LogoutConfirm localOnly={modal === "logout" && !cpPage?.sync ? ls.keys().filter((k) => k.startsWith("codeS:")).length : 0}
        flush={async () => { flushDirty(); const a = await chatSync.flush(); if (!cpPage?.sync) return a; const codeIds = ls.keys().filter((k) => k.startsWith("codeS:")).map((k) => Number(k.slice(6))).filter((n) => Number.isFinite(n)); return a + await flushAllNow(codeIds); }}
        onCancel={() => setModal(null)} onOk={(clear) => { setModal(null); logout(clear); }} /></Fade>
      <Fade show={!!(delId !== null)}><Confirm title="Xóa đoạn chat?" text="Đoạn chat sẽ bị xóa khỏi mọi thiết bị, cùng với lịch sử phiên của model, ghi chú trong Bộ não, liên kết chia sẻ, và tệp chỉ đoạn chat này dùng. Bản đã có trong sao lưu của máy chủ mất đi theo vòng xoay, tối đa khoảng 5 tuần. Không hoàn tác được." ok="Xóa" onCancel={() => { setDelId(null); setDelArts(false); }} onOk={() => { if (delId !== null) { if (delArts) void fetch(`/api/artifacts?conv=${delId}`, { method: "DELETE" }).catch(() => {}); removeChat(delId); } setDelId(null); setDelArts(false); say("Đã xóa đoạn chat"); }}><label style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 16px", fontSize: 14 }}><input type="checkbox" checked={delArts} onChange={(e) => setDelArts(e.target.checked)} />Xóa cả artifact của đoạn chat này (nếu không, chúng vẫn ở trang Artifacts)</label></Confirm></Fade>
      <Fade show={!!(delProj !== null)}><Confirm title="Xóa dự án?" text="Dự án sẽ bị xóa. Các đoạn chat bên trong vẫn được giữ lại." ok="Xóa" onCancel={() => setDelProj(null)} onOk={() => { setProjects((ps) => ps.filter((x) => x.id !== delProj)); if (delProj !== null) chatSync.forget("project", [delProj]); setChats((cs) => cs.map((c) => (c.project === delProj ? { ...c, project: undefined } : c))); setDelProj(null); say("Đã xóa dự án"); }} /></Fade>
      <Fade show={!!(modal === "proj")}><ProjectModal onClose={() => setModal(null)} onCreate={(n, d) => { const id = Date.now(); setProjects([{ id, name: n, desc: d, upd: id, pinned: true }, ...projects]); setModal(null); setCurProj(id); setView("project"); say("Đã tạo dự án"); }} /></Fade>
      <Fade show={editProj !== null}><ProjectModal title="Chỉnh sửa dự án" ok="Lưu" init={projects.find((x) => x.id === editProj)} onClose={() => setEditProj(null)} onCreate={(n, d) => { if (editProj !== null) patchProj(editProj, { name: n, desc: d }); setEditProj(null); say("Đã cập nhật dự án"); }} /></Fade>
      <Fade show={!!gc}><Confirm title={gc?.title ?? ""} text={gc?.text ?? ""} ok={gc?.ok ?? ""} onCancel={() => setGc(null)} onOk={() => { gc?.fn(); setGc(null); }} /></Fade>
    </div>
    </AppCtx.Provider>
    {authEl}
    {intro && me && <IntroFilm uid={me.id} onCovered={() => setAuthHold(false)} onReveal={() => setReveal("film")}
      onDone={() => { setReveal(""); setIntro(false); }} />}
  </>);
}
