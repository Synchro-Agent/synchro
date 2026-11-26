"use client";
// Khung đoạn chat đang mở (blueprint B2): danh sách tin, thẻ duyệt công cụ, tin chờ đọc, nút cuộn xuống, khung artifact / tệp / trình duyệt
// và khối soạn tin ở đáy. Tách khỏi home.tsx thành component memo: chỉ nó đăng ký đoạn chat đang mở (selectCurChat), nên mẩu chữ đang chảy
// vẽ lại khung này và dòng tin cuối (MsgRow memo), không vẽ lại cả trang, thanh bên hay ô soạn tin.
// Home truyền giá trị đơn (busy, model…), phần tử đã memo của khối soạn tin (dock) và một ref hàm (hx: bản mới nhất của Home, đọc lúc bấm).
// Khung đang mở và số sản phẩm được báo lại cho Home qua usePanelUi (lớp has-art của <main>, nút "Sản phẩm" ở thanh trên) trước khi vẽ ra màn hình.
// DOM giữ nguyên như khi còn nằm trong home.tsx (một Fragment ngay trong <main>): CSS, --dock-h trên <main> và các bài kiểm giao diện dựa vào đó.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { getLang, tf, tr, trCx, useLangReady, locale } from "./i18n";
import { resetAt } from "./resetfmt";
import { FileCard } from "./fileicon";
import type { useFileMenu } from "./filemenu";
import { stripAppliedNotes } from "../shared/turnctx";
import { Boundary } from "./ui";
import { chatError, isForeign } from "../shared/chaterror";
import { ModelLogo } from "./brands";
import { lazyView } from "./lazy";
import { answerAsk } from "./codesync";
import { ConnCards, PlanCard, stepsOf, WorkParts, WorkStatus, WorkSummary } from "./worklog";
import { CiteCtx, SourceChips } from "./cites";
import { Markdown, OutsCtx } from "./md";
import type { ApprovalAnswer, ApprovalCall, LibUse, OutFile } from "./llm";
import type { Chat, Msg } from "./store";
import { AUTO, autoPickKey, modelName } from "./models";
import { useCaps } from "./capsclient";
import {
  artKindLabel, artifactsAsCode, hasArtifacts, PUBLISHABLE, splitArtifacts, type ArtBlock,
} from "../shared/artifacts";
import { ArtPanelSkeleton, ThreadSkeleton } from "./skeleton";
import { resolveArt, type ArtVersion } from "../shared/vfs";
import { criticKey, type Finding } from "../shared/critic";
import { ArtifactCard, OutputFiles } from "./artifactcard";
import type { Product } from "./filepreview";
import { rowHeight } from "./rowsize";
import { selectCurChat, useChatState, useChatStore, usePanelUi, type ArtSel } from "./chatstore.client";
import type { Say } from "./hometypes";

// Trình duyệt của Synchro (khung cạnh chat, trang Trình duyệt): vé xem màn hình trực tiếp.
const browserTicket = () => fetch("/api/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "ticket" }) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.error || "Không mở được trình duyệt."); return j.url as string; });

const PublishButton = lazyView(() => import("./appsui").then((m) => m.PublishButton), null);
const BrowserHub = lazyView(() => import("./browserhub").then((m) => m.BrowserHub));
// Khung xem tệp / artifact đang tải phần mã: khung chờ cùng chỗ, cùng bề rộng, có sẵn tên (cột chat không co giãn hai lần).
const FilePanel = lazyView(() => import("./filepreview").then((m) => m.FilePanel), (p) => <ArtPanelSkeleton title={p.file.name} expanded={p.expanded} acts={3} />);
const ArtifactPanel = lazyView(() => import("./artifactui").then((m) => m.ArtifactPanel), (p) => {
  const a = p.versions[p.index] ?? p.versions.at(-1);
  const sub = a ? tr(artKindLabel(a)) : undefined;
  return <ArtPanelSkeleton title={a?.title} sub={sub} tabs={!!a && a.type !== "code"} expanded={p.expanded} acts={6} />;
});
const ProductSwitcher = lazyView(() => import("./filepreview").then((m) => m.ProductSwitcher), null);
const ApprovalCard = lazyView(() => import("./connectorsui").then((m) => m.ApprovalCard), null);
const SaveSkillChip = lazyView(() => import("./saveskill").then((m) => m.SaveSkillChip), null);

// Nhãn công cụ đã dùng: Composio là "<ứng dụng> · <thao tác>", thao tác dịch theo ngôn ngữ giao diện; connector khác giữ nguyên.
const toolChip = (n: string) => { const i = n.indexOf(" · "); return i > 0 ? `${n.slice(0, i)} · ${trCx(n.slice(i + 3))}` : n; };

// Đoạn chat chưa có nội dung ở trang. local: thân nằm trong kho của máy này, đọc về trong vài mili giây, nên khung chờ chỉ hiện sau 150ms
// (bấm mở từ thanh bên / ngăn kéo điện thoại không thấy khung chờ chớp lên rồi tắt). Không thì đang tải từ máy chủ: hiện ngay.
function StubWait({ local }: { local: boolean }) {
  const [show, setShow] = useState(!local);
  useEffect(() => { if (show) return; const t = setTimeout(() => setShow(true), 150); return () => clearTimeout(t); }, [show]);
  return <><span className="sr-only" role="status">{local ? tr("Đang mở đoạn chat…") : tr("Đang tải đoạn chat từ máy chủ…")}</span>{show && <ThreadSkeleton />}</>;
}

// Thư viện skill một câu trả lời đã dùng: chế độ studio người dùng chọn, hoặc thư viện model tự mở, kèm skill đã đọc.
function LibChips({ libs, onOpen }: { libs: LibUse[]; onOpen: () => void }) {
  return <div className="skill-used">{libs.map((l) => (
    <button key={l.key} className="skill-chip lib-chip" onClick={onOpen} title={l.skills.join(", ")}>
      <I.Plugins size={13} /><span>{tr(l.forced ? "Chế độ" : "Thư viện")} <b data-notr={l.key.startsWith("lib-") || undefined}>{l.key.startsWith("lib-") ? l.label : tr(l.label)}</b></span>
      {l.skills.length > 0 && <span className="lib-sk" data-notr>{l.skills.slice(0, 3).join(", ")}{l.skills.length > 3 ? ` +${l.skills.length - 3}` : ""}</span>}
    </button>))}</div>;
}

function ago(t: number): string {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "bây giờ";
  if (m < 60) return `${m} phút trước`;
  return fmt(t);
}
const fmt = (t: number) => new Date(t).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

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
/** Các đoạn chữ / artifact của một tin (dùng chung bộ nhớ đệm với bảng artifact). */
function artSegsOf(m: Msg) {
  let segs = artSegs.get(m);
  if (!segs) { segs = splitArtifacts(m.text); artSegs.set(m, segs); }
  return segs;
}
function scanArts(msgs: Msg[], from: number, base: ArtScan): ArtScan {
  const map: ArtScan["map"] = new Map(), at = { ...base.at };
  for (const [k, v] of base.map) map.set(k, [...v]);
  for (let i = from; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "ai" || !hasArtifacts(m.text)) continue;
    for (const sg of artSegsOf(m)) if (sg.kind === "art") {
      const l = map.get(sg.art.ident) ?? [];
      l.push({ ...resolveArt(l[l.length - 1], sg.art), msg: i });
      map.set(sg.art.ident, l);
      (at[i] = [...(at[i] ?? [])]).push({ ident: sg.art.ident, v: l.length - 1 });
    }
  }
  return { map, at };
}
// Bảng artifact của một danh sách tin, giữ ở mức tệp: khung đoạn chat và bộ theo dõi artifact đang viết (useLiveArtFollow, chạy cả khi khung
// đoạn chat chưa gắn) đọc chung, cùng một mảng tin thì chỉ tách một lần. Quét theo tiền tố: các tin trước tin cuối không đổi trong lúc chữ đang chảy,
// chỉ tin cuối phải tách và áp bản sửa lại.
let artBase: { msgs: Msg[]; scan: ArtScan } | null = null;
let artLast: { msgs: Msg[]; res: ArtScan } | null = null;
function artsOf(ms: Msg[] | undefined, on: boolean): ArtScan {
  if (!ms || !on) return ART_EMPTY;
  if (artLast?.msgs === ms) return artLast.res;
  const n = Math.max(0, ms.length - 1), b = artBase;
  if (!b || b.msgs.length !== n || b.msgs.some((m, k) => m !== ms[k])) artBase = { msgs: ms.slice(0, n), scan: scanArts(ms.slice(0, n), 0, ART_EMPTY) };
  const res = scanArts(ms, n, artBase!.scan);
  artLast = { msgs: ms, res };
  return res;
}
/** Artifact cuối của câu trả lời đang viết (tin cuối chưa xong), nếu có. */
function liveArtOf(chat: Chat | undefined, arts: ArtScan) {
  const lastIdx = chat ? chat.msgs.length - 1 : -1;
  return { lastIdx, liveArt: chat && lastIdx >= 0 && !chat.msgs[lastIdx].done ? arts.at[lastIdx]?.at(-1) : undefined };
}
// Artifact đang viết mà người dùng vừa đóng khung xem (khóa đoạn chat-tin-identifier): không tự mở lại. Ở mức tệp như stick: rời trang chat
// (Dự án, Artifacts…) rồi quay lại trong lúc câu trả lời còn chảy thì khung đã đóng vẫn đóng.
let artDismissed = "";

/** Câu trả lời đang viết có artifact: tự mở khung xem và đi theo phiên bản mới nhất (trừ khi người dùng vừa đóng). Home gắn bộ theo dõi này
 *  (không vẽ lại gì) nên nó chạy ở mọi trang như trước khi tách khung đoạn chat: artifact viết xong lúc người dùng ở trang khác thì quay lại
 *  khung xem đã chọn sẵn. Chỉ làm việc khi đoạn chat đang mở, số tin, artifact cuối hoặc phiên bản của nó đổi (như hiệu ứng cũ của Home). */
export function useLiveArtFollow(capsArt: boolean) {
  useEffect(() => { artDismissed = ""; }, []);
  useEffect(() => {
    let prev: string | null = null;
    const f = () => {
      const chat = selectCurChat(useChatStore.getState());
      const { lastIdx, liveArt } = liveArtOf(chat, artsOf(chat?.msgs, capsArt));
      const k = `${chat?.id}|${lastIdx}|${liveArt?.ident}|${liveArt?.v}`;
      if (k === prev) return;
      prev = k;
      if (!chat || !liveArt) return;
      if (artDismissed === `${chat.id}-${lastIdx}-${liveArt.ident}`) return;
      const { artSel, setArtSel, setFileSel } = usePanelUi.getState();
      if (artSel?.chat !== chat.id || artSel.ident !== liveArt.ident || !artSel.follow) { setFileSel(null); setArtSel({ chat: chat.id, ident: liveArt.ident, v: liveArt.v, follow: true }); }
    };
    f();
    return useChatStore.subscribe(f);
  }, [capsArt]);
}

// Những gì một dòng tin cần từ trang (luôn là bản mới nhất, đọc qua ref): đổi hàm không làm cả danh sách vẽ lại.
export type RowCx = {
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
const MsgRow = memo(function MsgRow({ m: raw, i, last, busy, mark, art, inl, fileActive, copied, speaking, chatId, cx,
  pending, late }: {
  // lang: đổi ngôn ngữ thì dòng tin đã memo cũng dịch lại các nút và lời báo.
  m: Msg; i: number; last: boolean; lang: string; busy: boolean; mark: boolean; art?: boolean; inl?: boolean; artSig: string; fileActive?: string; copied: boolean; speaking: boolean; chatId: number; cx: React.RefObject<RowCx | null>;
  /** Tin nhắn thêm chưa được ghép (câu trả lời đang chạy): hiện ngay sau phần đã viết, trên dòng trạng thái. */
  pending?: { id: number; text: string }[];
  /** Model đang chạy chỉ đọc tin nhắn thêm khi xong bước của nó (Antigravity, Grok). */
  late?: boolean;
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
        <CiteCtx.Provider value={cites}><OutsCtx.Provider value={m.outs ?? null}><div className={`ai-msg${m.done ? "" : " ai-streaming"}`}>{m.tools?.length ? <div className="skill-used">{m.tools.map((n) => <span key={n} className="skill-chip tool-chip"><I.SetPlug size={13} /><span>{tr("Đã dùng")}</span><span data-notr>{toolChip(n)}</span></span>)}</div> : null}{m.libs?.length ? <LibChips libs={m.libs} onOpen={() => cx.current!.openPlugins()} /> : null}{m.skills?.length ? <div className="skill-used">{m.skills.map((n) => <span key={n} className="skill-chip"><I.Scroll size={13} />{tr("Đang dùng skill")}: {n}</span>)}</div> : null}{m.done ? <WorkSummary parts={m.parts} plan={m.plan} ms={m.dur} stopped={m.stopped} failed={m.failed || !!m.notice?.partial} render={(t) => <Markdown text={t} say={say} />} /> : m.parts?.length ? <WorkParts parts={m.parts} live onAnswer={answerAsk} render={(t) => <Markdown text={t} say={say} />} /> : null}{m.text ? (art && hasArtifacts(m.text) ? artSegsOf(m).map((sg, k, segs) => sg.kind === "text" ? <Markdown key={k} text={sg.text} say={say} viz={inl} live={m.done && last && !busy} streaming={!m.done} /> : (() => {
          // Một thẻ cho mỗi artifact trong một tin: bản đầy đủ rồi bản sửa (mode="patch") cùng identifier trong cùng câu trả lời là hai phiên bản
          // của một artifact. Thẻ đứng ở chỗ artifact xuất hiện lần đầu, ghi phiên bản cuối cùng tin này tạo ra và mở đúng phiên bản đó.
          if (segs.findIndex((x) => x.kind === "art" && x.art.ident === sg.art.ident) !== k) return null;
          const pos = arts.at[i]?.filter((x) => x.ident === sg.art.ident && arts.map.get(x.ident)?.[x.v]?.msg === i).at(-1);
          const total = arts.map.get(sg.art.ident)?.length ?? 1;
          const v = pos?.v ?? 0;
          const active = c.artOpen && c.artIdent === sg.art.ident && c.artIndex === v;
          const full = arts.map.get(sg.art.ident)?.[v];
          return <ArtifactCard key={k} art={full ?? sg.art} version={v + 1} total={total} active={active} fix={full?.fix} onRedo={last && !busy ? () => cx.current!.send(`${tr("Bản sửa")} “${full?.title ?? sg.art.ident}” ${tr("không áp được. Hãy viết lại toàn bộ artifact này (không dùng mode=\"patch\"), giữ các thay đổi tôi vừa yêu cầu.")}`) : undefined} onOpen={() => cx.current!.openArt({ chat: chatId, ident: sg.art.ident, v, follow: false })} />;
        })()) : <Markdown text={hasArtifacts(m.text) ? artifactsAsCode(m.text) : m.text} say={say} viz={inl} live={m.done && last && !busy} streaming={!m.done} />) : null}{m.failed ? <ErrCard raw={m.err} onRetry={last && !busy ? () => cx.current!.retry() : undefined} onProviders={() => cx.current!.openProviders()} /> : null}{m.done && last ? <ConnCards parts={m.parts} text={m.text} /> : null}{!m.done && pending?.length ? <PendingSteer items={pending} late={late} /> : null}{!m.done && m.plan?.length ? <PlanCard plan={m.plan} live /> : null}{!m.done ? <WorkStatus label={m.parts?.some((p) => p.k === "ask" && p.state === "wait") ? tr("Đang chờ bạn duyệt") : m.prog} since={m.time} steps={stepsOf(m.parts)} /> : null}{m.outs?.length ? <OutputFiles files={m.outs} onOpen={(f) => cx.current!.openFile(f)} active={fileActive} /> : null}</div></OutsCtx.Provider></CiteCtx.Provider>
        {m.done && m.stopped && <div className="msg-stopped"><I.Stop size={11} />{tr("Đã dừng · giữ lại phần đã viết")}</div>}
        {m.done && !m.failed && (m.pjApplied || m.insApplied) ? <div className="msg-applied">{m.pjApplied && <span className="skill-chip"><I.Folder size={13} />{tr("Đã áp dụng ngữ cảnh dự án")}</span>}{m.insApplied && <span className="skill-chip"><I.User size={13} />{tr("Đã áp dụng hướng dẫn cá nhân")}</span>}</div> : null}
        {m.done && m.webs?.length ? <SourceChips webs={m.webs} id={citeId} /> : null}
        {m.done && m.notice && ((m.notice.text && !m.failed) || m.notice.work || m.notice.at || m.notice.tried?.length || m.notice.switchTo) ? (
          <div className="msg-notice" role="status">
            {m.notice.text && !m.failed && <p>{tr(m.notice.text)}</p>}
            {m.notice.work && <p>{tr("Model đã làm một phần việc nên Synchro không tự chạy lại, để tránh làm hai lần.")}</p>}
            {m.notice.at && m.notice.at > Date.now() ? <p data-notr>{resetAt(m.notice.at, getLang())}</p> : null}
            {m.notice.tried?.length ? <p data-notr>{tf("Đã thử: {list}", { list: m.notice.tried.join(", ") })}</p> : null}
            {m.notice.switchTo && last && !busy ? (
              <div className="msg-notice-act">
                <button className="btn dark" onClick={() => cx.current!.switchModel(m.notice!.switchTo!.model)} data-notr>{c.model === AUTO ? tr("Thử lại bằng Tự động") : tf("Dùng model khác: {name}", { name: m.notice.switchTo.name })}</button>
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
            {m.via && <span className="via" title={tr("Chế độ Tự động đã chọn model này")} data-notr><ModelLogo k={m.via} size={14} /><span className="via-t">{m.viaTask && autoPickKey(m.viaTask) ? tf(autoPickKey(m.viaTask), { model: modelName(m.via) }) : modelName(m.via)}</span></span>}
            {m.via && last && !busy && c.altModels && <button className="via via-alt" onClick={() => cx.current!.retry(m.via)} title={tr("Vẫn để Tự động, chỉ không dùng model vừa trả lời")}><I.Retry size={12} />{tr("Chạy lại bằng model khác")}</button>}
            <When t={m.time} />
          </div>
        )}
        {m.done && !m.failed && last && !busy && <SaveSkillChip chat={c.chat} all={c.chats} say={say} />}
      </div>
    )}
  </>);
});

// Tự cuộn theo chữ đang viết chỉ khi người dùng đang đứng ở cuối. Một khung đoạn chat tại một lúc, nên giữ ở mức tệp: Home gửi tin / gửi lại
// thì bám đáy lại (stickToBottom) dù khung chưa gắn (gửi từ trang Mới).
const stick = { current: true };
export const stickToBottom = () => { stick.current = true; };
// Sản phẩm mới nhất của đoạn chat đang mở: nút "Sản phẩm" ở thanh trên (Home) mở nó.
let lastProduct: (() => void) | null = null;
export const openLastProduct = () => lastProduct?.();

/** Các thao tác của Home mà khung đoạn chat gọi (lúc bấm, luôn là bản mới nhất). */
export type ThreadActs = {
  say: Say; fm: ReturnType<typeof useFileMenu>; openPlugins: () => void; openProviders: () => void;
  send: (t: string) => void; copy: (key: string, text: string) => void; speak: (key: string, text: string) => void; like: (i: number, v: 1 | -1) => void;
  retry: (avoid?: string) => void; switchModel: (key: string) => void; fork: (i: number) => void; resend: (c: Chat, k: number, u: Msg) => void;
  stop: () => void; undoLost: () => void; approvalDone: (a: ApprovalAnswer) => void;
  runCritic: (id: number, a: ArtBlock) => void; applyFix: (id: number, a: { ident: string; title: string; content: string }, f: Finding) => void;
  restyle: (id: number, a: { ident: string; title: string; content: string }, preset: string) => Promise<void>;
};
export type BrwState = { available: boolean; reason?: string; control?: boolean; ext?: { allowed: boolean; paired: boolean }; target?: "synchro" | "user" };

/** Tin nhắn thêm đang chờ ghép, đặt đúng chỗ nó sẽ nằm sau khi máy chủ báo đã ghép (sau phần đã viết, trước phần trả
 *  lời tiếp theo): lúc ghép chỉ dòng trạng thái chuyển xuống dưới tin, chữ không nhảy. */
function PendingSteer({ items, late }: { items: { id: number; text: string }[]; late?: boolean }) {
  return <>{items.map((q) => (
    <div key={q.id} className="user-wrap steer-pending in-turn">
      <span className="steer-tag">{tr("Nhắn thêm khi Synchro đang làm")}</span>
      <div className="user-msg"><UserText text={q.text} /></div>
      {late && <span className="steer-late">{tr("Sẽ đọc khi xong bước này")}</span>}
    </div>
  ))}</>;
}
// Model chỉ đọc tin nhắn thêm khi CLI xong bước (không có kênh giữa lượt, cắt lượt thì mất phiên).
const LATE_STEER = /^sub-(agy|grok)\//;

export const ChatThread = memo(function ChatThread({ busy, copied, speaking, model, altModels, undoFor, approval, brw, dock, hx }: {
  busy: boolean; copied: string | null; speaking: string | null; model: string; altModels: boolean;
  /** Đoạn chat có lượt cũ vừa bị thay (hiện nút Khôi phục bản cũ). */
  undoFor: number | null;
  approval: { chat: number | null; calls: ApprovalCall[] } | null;
  brw: BrwState | null;
  /** Nội dung khối soạn tin ở đáy (chế độ studio, tin chờ gửi, ô soạn tin, dòng ghi chú): phần tử đã memo ở Home. */
  dock: React.ReactNode;
  hx: React.RefObject<ThreadActs>;
}) {
  // Dòng tin đã memo nhận lang: đổi ngôn ngữ thì khung này vẽ lại để các dòng dịch lại nút và lời báo.
  useLangReady();
  const chat = useChatState(selectCurChat);
  const queued = useChatState((s) => s.queued);
  const { caps } = useCaps();
  const artSel = usePanelUi((s) => s.artSel), fileSel = usePanelUi((s) => s.fileSel), brwFor = usePanelUi((s) => s.brwFor);
  const artFull = usePanelUi((s) => s.artFull), brwPrefer = usePanelUi((s) => s.brwPrefer);
  const { setArtSel, setFileSel, setBrwFor, setArtFull } = usePanelUi.getState();
  const x = () => hx.current!;
  const say = hx.current!.say;
  const arts = useMemo(() => artsOf(chat?.msgs, !!caps.art), [chat?.msgs, caps.art]);
  // Đoạn chat có artifact: tải sẵn khung xem để bấm thẻ là mở ngay.
  useEffect(() => { if (arts.map.size) ArtifactPanel.preload(); }, [arts.map.size]);
  const artVersions = artSel && chat && artSel.chat === chat.id ? arts.map.get(artSel.ident) ?? null : null;
  const artIndex = artVersions ? (artSel!.follow ? artVersions.length - 1 : Math.min(artSel!.v, artVersions.length - 1)) : 0;
  // Tin nhắn thêm chưa ghép của đoạn chat này. Câu trả lời đang chạy là tin cuối: tin chờ nằm trong nó (sau phần đã
  // viết, trên dòng trạng thái); chưa có câu trả lời nào đang chạy thì nằm cuối đoạn chat.
  const steers = useMemo(() => queued.filter((q) => q.chat === chat?.id && q.mode === "steer"), [queued, chat?.id]);
  const tail = chat?.msgs[chat.msgs.length - 1];
  const inTurn = !!tail && tail.role === "ai" && !tail.done;
  const lateSteer = LATE_STEER.test(model);
  const artOpen = !!artVersions?.length;
  // Tự mở khung xem theo artifact đang viết: useLiveArtFollow (Home), chạy cả khi khung này chưa gắn.
  const { lastIdx, liveArt } = liveArtOf(chat, arts);
  const brwOk = !!(brw?.available || brw?.ext?.allowed);
  const fileOpen = !!chat && fileSel?.chat === chat.id && !artOpen;
  const brwShow = !!chat && brwFor === chat.id && !artOpen && !fileOpen && brwOk;
  const panel = artOpen ? "art" : fileOpen ? "file" : brwShow ? "brw" : null;
  const openArt = (s: ArtSel) => { setFileSel(null); setArtSel(s); };
  const openFile = (f: OutFile) => { if (!chat) return; setArtSel(null); setFileSel({ chat: chat.id, file: f }); };
  // Mọi sản phẩm của đoạn chat (artifact bản mới nhất, tệp code đã tạo), để chuyển nhanh trong khung xem trước.
  const products: Product[] = !chat ? [] : [
    ...[...arts.map.entries()].map(([ident, vs]) => { const a = vs[vs.length - 1]; return { key: `a:${ident}`, title: a.title, type: a.type, content: a.content, open: () => openArt({ chat: chat.id, ident, v: vs.length - 1, follow: false }) }; }),
    ...chat.msgs.flatMap((m) => m.outs ?? []).filter((f) => !f.skipped).map((f) => ({ key: `f:${f.id}`, title: f.name, file: f, open: () => openFile(f) })),
  ];
  lastProduct = products.length ? products[products.length - 1].open : null;
  // Báo cho Home trước khi vẽ ra màn hình: lớp has-art của <main> và khung vẽ cùng một khung hình. Gỡ khung (rời đoạn chat) thì không còn khung nào.
  useLayoutEffect(() => {
    const s = usePanelUi.getState();
    if (s.panel !== panel || s.prodN !== products.length) usePanelUi.setState({ panel, prodN: products.length });
  });
  useLayoutEffect(() => () => { lastProduct = null; usePanelUi.setState({ panel: null, prodN: 0 }); }, []);
  const activeProduct = artOpen && artSel ? `a:${artSel.ident}` : fileOpen && fileSel ? `f:${fileSel.file.id}` : "";
  const closeArt = () => {
    if (chat && liveArt) artDismissed = `${chat.id}-${lastIdx}-${liveArt.ident}`;
    setArtSel(null);
  };
  const threadRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Khoảng đệm cuối đoạn chat và nút "cuộn xuống" theo chiều cao thật của khối soạn tin (thẻ chế độ, tin chờ gửi xếp trên ô soạn):
  // tin cuối không bao giờ nằm dưới các thẻ đó.
  // Theo chính phần tử: khối soạn tin có thể gắn lại mà đoạn chat không đổi (phần tải sau, khung bắt lỗi), lúc đó bộ theo dõi cũ nằm trên phần tử đã mất.
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
  }, [chat?.id]);
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
  }, [chat?.id]);

  // Những gì một dòng tin cần (luôn là bản mới nhất, đọc qua ref): đổi hàm không làm cả danh sách vẽ lại.
  const rowCx = useRef<RowCx | null>(null);
  if (chat) rowCx.current = { model, switchModel: (k) => x().switchModel(k), fork: (i) => x().fork(i), altModels, chat, get chats() { return useChatStore.getState().chats; }, say, fm: x().fm, arts, artOpen, artIdent: artSel?.ident, artIndex,
    openPlugins: () => x().openPlugins(), openArt, openFile, send: (t) => x().send(t), copy: (k, t) => x().copy(k, t), speak: (k, t) => x().speak(k, t), like: (i, v) => x().like(i, v), retry: (a) => x().retry(a),
    openProviders: () => x().openProviders(), edit: (i, text) => { const u = chat.msgs[i]; if (!busy && u?.role === "user") x().resend(chat, i, { ...u, text, time: Date.now() }); } };
  // Dấu của phần artifact trong một tin: có phiên bản mới, đổi bản đang xem thì dòng tin đó vẽ lại.
  const artSig = (i: number) => arts.at[i]?.map((a) => `${a.ident}:${a.v}:${arts.map.get(a.ident)?.length}:${artOpen && artSel?.ident === a.ident && artIndex === a.v ? 1 : 0}`).join("|") ?? "";

  if (!chat) return null;
  return (
    <>
      <h1 className="sr-only" data-notr>{chat.title}</h1>
      <div className="thread" ref={threadRef} onScroll={onScroll} onWheel={(e) => { if (e.deltaY < 0) userUp(); }}
        onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? 0; }} onTouchMove={(e) => { if ((e.touches[0]?.clientY ?? 0) - touchY.current > 5) userUp(); }}
        onKeyDown={(e) => { if (["PageUp", "ArrowUp", "Home"].includes(e.key)) userUp(); }}>
        <div className="thread-in">
          {chat.stub && <StubWait key={chat.id} local={!!chat.local} />}
          {chat.msgs.map((m, i) => <Boundary key={`${chat.id}-${i}`} compact resetKey={m.text}><MsgRow m={m} i={i} last={i === chat.msgs.length - 1} lang={getLang()} busy={busy} mark={chat.compact?.upto === i} art={caps.art} inl={caps.inl} artSig={artSig(i)}
            fileActive={m.outs?.length && fileOpen ? fileSel?.file.id : undefined} copied={copied === `${chat.id}-${i}`} speaking={speaking === `${chat.id}-${i}`} chatId={chat.id} cx={rowCx}
            pending={inTurn && i === chat.msgs.length - 1 ? steers : undefined} late={lateSteer} /></Boundary>)}
          {undoFor === chat.id && <div className="msg-notice turn-undo" role="status"><p>{tr("Câu trả lời cũ đã được thay bằng lượt mới.")}</p><div className="msg-notice-act"><button className="lnk" onClick={() => x().undoLost()}>{tr("Khôi phục bản cũ")}</button></div></div>}
          {approval && approval.chat === chat.id && <ApprovalCard calls={approval.calls} onDone={(d, inputs) => x().approvalDone({ decisions: d, inputs })} />}
          {/* Tin nhắn thêm khi chưa có câu trả lời nào đang chạy (lượt vừa bắt đầu): cuối đoạn chat. Có câu trả lời
              đang chạy thì tin nằm trong câu đó (PendingSteer trong MsgRow). */}
          {!inTurn && steers.length ? <PendingSteer items={steers} late={lateSteer} /> : null}
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
          onAsk={busy ? undefined : (text) => x().send(text)}
          criticOf={(a) => chat.critic?.[criticKey(a.ident, a.content)]} onCritic={chat.inc ? undefined : (a) => x().runCritic(chat.id, a)}
          onApplyFix={busy || chat.inc ? undefined : (a, f) => x().applyFix(chat.id, a, f)}
          onRestyle={busy || chat.inc ? undefined : (a, preset) => { x().restyle(chat.id, a, preset).catch(() => {}); }}
          onFix={busy ? undefined : (a, err) => x().send(`${tr("Artifact")} “${a.title}” ${tr("gặp lỗi")}: ${err}\n${tr("Hãy sửa lỗi này.")}`)} />
      )}
      {brwShow && (
        <div className="brw-panel">
          <BrowserHub ticket={browserTicket} synchro={{ available: !!brw?.available, reason: brw?.reason }} prefer={brwPrefer} visible say={say} onClose={() => setBrwFor(null)} onExpand={() => setArtFull(!artFull)} expanded={artFull} busy={busy}
            onStop={busy ? () => x().stop() : undefined} />
        </div>
      )}
      {fileOpen && fileSel && (
        <FilePanel file={fileSel.file} onClose={() => setFileSel(null)} expanded={artFull} setExpanded={setArtFull} say={say} switcher={<ProductSwitcher items={products} active={activeProduct} />} />
      )}
      </Boundary>
      <div className="dock" ref={dockRef}>{dock}</div>
    </>
  );
});
