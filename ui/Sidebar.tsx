"use client";
// Bảng đoạn chat ở thanh bên (blueprint B2): tách khỏi home.tsx thành component memo. Tự đăng ký danh sách đoạn chat rút gọn
// (selectSideList: không có tin nhắn, dòng không đổi thì giữ đúng đối tượng), dự án và trạng thái menu (useSideUi), nên mẩu chữ đang chảy
// không làm nó vẽ lại. Prop là giá trị đơn từ Home cùng một ref hàm (hx: luôn là bản mới nhất của Home, đọc lúc bấm, không lúc vẽ).
// DOM và tên lớp giữ nguyên như khi còn nằm trong home.tsx: CSS của ngăn kéo điện thoại, thanh bên thu gọn và các bài kiểm giao diện dựa vào đó.
// Phần bọc .shell-side (tự đóng ngăn kéo khi chọn mục), thanh điều hướng và lớp phủ tối vẫn ở Home.
import { memo, useMemo, useState } from "react";
import * as I from "./icons";
import { tr, useLangReady } from "./i18n";
import { Menu } from "./ui";
import { Wordmark } from "./brand";
import { BulkBar, BulkCheck, bulkRow, useBulk, type BulkAct } from "./bulk";
import { Pager, usePage } from "./pager";
import { lazyView } from "./lazy";
import { usePref, type Project } from "./store";
import type { SpeechTool } from "../shared/speech/data";
import { usePlan as useSpeechPlan } from "./speech/client";
import { allTags, cleanTags, hasTag, tagKey } from "./chattags";
import { TagFilter, TagPicker } from "./tagsui";
import { ChatListSkeleton } from "./skeleton";
import { useSyncFlag } from "./chatsync";
import { useClickAway } from "./clickaway";
import { countRender } from "./perfmark";
import { sameList, selectSideList, useChatState, useChatStore, useSideUi, type SideChat } from "./chatstore.client";
import type { CodeItem, View } from "./hometypes";

// Công cụ Speech ở thanh bên: danh mục công cụ chỉ tải khi đang ở Speech (blueprint B3.3).
const SpeechSideTools = lazyView(() => import("./speech/sidetools").then((m) => m.SpeechSideTools), null);
const ProjMenu = lazyView(() => import("./projects").then((m) => m.ProjMenu), null);

// Trạng thái phiên: đang chạy, cần bạn (hỏi lại / chờ duyệt / gặp lỗi / bị dừng), chờ xem lại (có thay đổi chưa commit / chưa push / PR chờ duyệt), xong.
function CodeBadge({ c }: { c: CodeItem }) {
  if (c.running && c.state !== "blocked") return <span className="cb run" title={tr("Đang chạy")} aria-label={tr("Đang chạy")}><span className="wl-spin" /></span>;
  if (!c.state) return null;
  const t = tr(c.state === "blocked" ? "Cần bạn" : c.state === "review" ? "Chờ xem lại" : "Xong");
  return <span className={`cb ${c.state}`} title={c.reason ? `${t}: ${c.reason}` : t} aria-label={t} />;
}

/** Các thao tác của Home mà thanh bên gọi (lúc bấm). */
export type SideActs = {
  goNew: () => void; openSearch: () => void; setView: (v: View) => void; setCurProj: (id: number | null) => void;
  setCodeCur: (id: number | null) => void; codePatch: (id: number, p: Partial<CodeItem>) => void; setCodeList: (f: (l: CodeItem[]) => CodeItem[]) => void;
  patchProj: (id: number, f: Partial<Project>) => void; setDelId: (id: number) => void; setDelProj: (id: number) => void; setEditProj: (id: number) => void;
  confirm: (gc: { title: string; text: string; ok: string; fn: () => void }) => void; say: (m: string) => void;
  /** Dừng câu trả lời đang chạy của đoạn chat id (xóa đoạn chat). */
  stop: (id: number) => void;
  /** Báo máy chủ đã xóa (chatsync forget). */
  forget: (ids: number[]) => void;
  /** Xóa phiên code ở máy chủ khi đang bật đồng bộ. */
  dropCode: (id: number) => void;
};

/** Danh sách thẻ của các đoạn chat (bỏ ẩn danh) — thanh bên và menu tiêu đề (Home) dùng chung. */
export function useTagsAll() {
  const list = useChatState(selectSideList, sameList);
  return useMemo(() => allTags(list), [list]);
}

type SideItem = { k: "chat"; c: SideChat } | { k: "code"; c: CodeItem };

export const Sidebar = memo(function Sidebar({ view, cur, curProj, codeCur, codeList, approvalChat, speech, hx }: {
  view: View; cur: number | null; curProj: number | null; codeCur: number | null; codeList: CodeItem[];
  /** Đoạn chat có thẻ duyệt công cụ đang chờ (connector): nhãn "Cần bạn" dù lượt đó đã xong ở máy chủ hay chưa. */
  approvalChat: number | null;
  /** Đang ở Speech và tài khoản được dùng Speech: hiện công cụ Speech. */
  speech: boolean;
  hx: React.RefObject<SideActs>;
}) {
  countRender("Sidebar");
  useLangReady();
  const visible = useChatState(selectSideList, sameList);
  const projects = useChatState((s) => s.projects);
  const noChats = useChatState((s) => !s.chats.length);
  // Thiết bị mới: danh sách đang về từ máy chủ (chưa lần nào hỏi được, không mất mạng) thì hiện dòng chờ.
  const listWait = useSyncFlag((st) => !st.at && !st.offline);
  const { setChats, setCur, togglePin, setChatTags } = useChatStore.getState();
  const { chatMenu, codeMenu, pickTag, pickProj, renaming, tagFilter } = useSideUi();
  const { setChatMenu, setCodeMenu, setPickTag, setPickProj, setRenaming, setTitleMenu, setTagFilter } = useSideUi.getState();
  const [spTool, setSpTool] = usePref<SpeechTool>("spTool", "home");
  const [spOpen] = usePref("spOpen", false);
  // Công cụ Speech ở thanh bên hiện theo gói ElevenLabs (chỉ quét khi đã mở Speech).
  const spPlan = useSpeechPlan(view === "speech" || spOpen);
  const [pjClosed, setPjClosed] = usePref<Record<number, boolean>>("pjClosed", {});
  const [pinOpen, setPinOpen] = usePref("pinOpen", true);
  const [recentOpen, setRecentOpen] = usePref("recentOpen", true);
  const [codeOpen, setCodeOpen] = useState(true);
  const [archOpen, setArchOpen] = useState(false);
  const [codeRen, setCodeRen] = useState<number | null>(null);
  const [sideProj, setSideProj] = useState<number | null>(null);
  const sideRef = useClickAway(() => setSideProj(null));
  const x = () => hx.current!;
  const pickView = (v: View) => x().setView(v);

  const tagsAll = useMemo(() => allTags(visible), [visible]);
  // Thẻ đang lọc không còn đoạn chat nào (vừa gỡ thẻ cuối): thôi lọc.
  const tagOn = tagFilter && tagsAll.some((t) => tagKey(t.tag) === tagKey(tagFilter)) ? tagFilter : null;
  // Chọn hàng loạt ở thanh bên: đoạn chat và phiên code (ghim, đưa vào dự án, lưu trữ, xóa nhiều mục cùng lúc).
  const sideItems: SideItem[] = [...codeList.map((c) => ({ k: "code" as const, c })), ...visible.map((c) => ({ k: "chat" as const, c }))];
  const sb = useBulk(sideItems, (it) => `${it.k}:${it.c.id}`);
  // Thanh bên: danh sách dài chia trang gọn (đoạn chat 20 / trang, phiên code 10 / trang), không phải cuộn mãi.
  const pinPj = new Set(projects.filter((p) => p.pinned && !p.archived).map((p) => p.id));
  const pgRest = usePage(visible.filter((c) => !c.pinned && !(c.project !== undefined && pinPj.has(c.project))), 20);
  const pgCode = usePage(codeList.filter((c) => !c.pinned && !c.archived), 10);
  const pgArch = usePage(codeList.filter((c) => c.archived), 10);
  const sidePager = (pg: { page: number; pages: number; from: number; to: number; total: number; setPage: (n: number) => void }) => <Pager compact page={pg.page} pages={pg.pages} from={pg.from} to={pg.to} total={pg.total} onPage={pg.setPage} />;
  const chatsOf = (l: SideItem[]) => l.flatMap((it) => (it.k === "chat" ? [it.c] : []));
  const codesOf = (l: SideItem[]) => l.flatMap((it) => (it.k === "code" ? [it.c] : []));
  const sideActs: BulkAct<SideItem>[] = [
    { id: "pin", label: "Ghim", icon: <I.M icon="Pin" size={15} />, when: (l) => l.some((it) => !it.c.pinned), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, pinned: true } : c)));
      for (const c of codesOf(l)) if (!c.pinned) x().codePatch(c.id, { pinned: true });
      x().say(`Đã ghim ${l.length} mục`);
    } },
    { id: "unpin", label: "Bỏ ghim", icon: <I.M icon="PinOff" size={15} />, when: (l) => l.some((it) => it.c.pinned), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, pinned: false } : c)));
      for (const c of codesOf(l)) if (c.pinned) x().codePatch(c.id, { pinned: false });
      x().say(`Đã bỏ ghim ${l.length} mục`);
    } },
    { id: "proj", label: "Thêm vào dự án", icon: <I.FolderPlus size={15} />, when: (l) => chatsOf(l).length > 0 && projects.some((p) => !p.archived),
      choices: () => projects.filter((p) => !p.archived).map((p) => ({ id: String(p.id), label: p.name })),
      run: (l, pid) => { const ids = new Set(chatsOf(l).map((c) => c.id)); const pr = projects.find((p) => String(p.id) === pid); if (!pr) return; setChats((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, project: pr.id } : c))); x().say(`Đã thêm ${ids.size} đoạn chat vào "${pr.name}"`); } },
    { id: "unproj", label: "Gỡ khỏi dự án", icon: <I.Layers size={15} />, when: (l) => chatsOf(l).some((c) => c.project !== undefined), run: (l) => {
      const ids = new Set(chatsOf(l).map((c) => c.id)); setChats((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, project: undefined } : c))); x().say("Đã gỡ khỏi dự án");
    } },
    { id: "arch", label: "Lưu trữ", icon: <I.Archive size={15} />, when: (l) => codesOf(l).some((c) => !c.archived), run: (l) => { for (const c of codesOf(l)) if (!c.archived) x().codePatch(c.id, { archived: true }); x().say("Đã lưu trữ các phiên code đã chọn"); } },
    { id: "unarch", label: "Khôi phục", icon: <I.Restore size={15} />, when: (l) => codesOf(l).some((c) => c.archived), run: (l) => { for (const c of codesOf(l)) if (c.archived) x().codePatch(c.id, { archived: false }); x().say("Đã khôi phục các phiên code đã chọn"); } },
    { id: "del", label: "Xóa", icon: <I.Trash size={15} />, danger: true,
      confirm: (l) => { const a = chatsOf(l).length, b = codesOf(l).length; return { title: `Xóa ${l.length} mục?`, text: `${[a ? `${a} đoạn chat` : "", b ? `${b} phiên code` : ""].filter(Boolean).join(" và ")} sẽ bị xóa khỏi mọi thiết bị, cùng với ghi chú trong Bộ não và liên kết chia sẻ. Không hoàn tác được.`, ok: "Xóa" }; },
      run: (l) => {
        const ids = new Set(chatsOf(l).map((c) => c.id)), cids = new Set(codesOf(l).map((c) => c.id));
        if (ids.size) { const run = useChatStore.getState().running; for (const id of ids) if (run.has(id)) x().stop(id); setChats((cs) => cs.filter((c) => !ids.has(c.id))); x().forget([...ids]); if (cur !== null && ids.has(cur)) x().goNew(); }
        if (cids.size) { x().setCodeList((l2) => l2.filter((c) => !cids.has(c.id))); for (const id of cids) x().dropCode(id); if (codeCur !== null && cids.has(codeCur)) x().setCodeCur(null); }
        x().say(`Đã xóa ${l.length} mục`);
      } },
  ];

  const row = (c: SideChat) => (
    <div key={c.id} className="chat-wrap" {...bulkRow(sb, { k: "chat", c })}>
      {renaming === c.id ? (
        <input className="field" autoFocus aria-label="Đổi tên" defaultValue={c.title} style={{ margin: 0, height: 32 }}
          onBlur={(e) => { const v = e.target.value.trim(); setChats((cs) => cs.map((y) => (y.id === c.id && v && v !== y.title ? { ...y, title: v, named: true } : y))); setRenaming(null); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      ) : (
        <button className={`chat-item ${view === "chat" && cur === c.id ? "active" : ""}`} aria-current={view === "chat" && cur === c.id ? "page" : undefined} onClick={() => { setCur(c.id); pickView("chat"); }}>{sb.on && <BulkCheck on={sb.has({ k: "chat", c })} />}<span key={c.title} className="ct-t" data-notr>{c.title}</span>{c.need || approvalChat === c.id ? <span className="ct-need" data-tip={tr("Đang chờ bạn duyệt")}>{tr("Cần bạn")}</span> : c.running && <span className="ct-run" role="img" aria-label={tr("Đang trả lời")} data-tip={tr("Đang trả lời")} />}</button>
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
              <button className="menu-item" onClick={() => (projects.length ? setPickProj(true) : (x().say("Hãy tạo dự án trước ở mục Dự án"), setChatMenu(null)))}><I.Layers />Thêm vào dự án<span className="sc"><I.ChevronR size={16} /></span></button>
              {c.project !== undefined && <button className="menu-item" onClick={() => { setChats((cs) => cs.map((y) => (y.id === c.id ? { ...y, project: undefined } : y))); setChatMenu(null); x().say("Đã gỡ khỏi dự án"); }}><I.Layers />Gỡ khỏi dự án</button>}
              <hr />
              <button className="menu-item del" onClick={() => { x().setDelId(c.id); setChatMenu(null); }}><I.Trash />Xóa</button>
            </>
          ) : (
            projects.map((pr) => (
              <button key={pr.id} className="menu-item" onClick={() => { setChats((cs) => cs.map((y) => (y.id === c.id ? { ...y, project: pr.id } : y))); x().say(`Đã thêm vào "${pr.name}"`); setChatMenu(null); setPickProj(false); }}><I.Layers />{pr.name}{c.project === pr.id && <span className="ck"><I.Check /></span>}</button>
            ))
          )}
        </Menu>
    </div>
  );
  const codeRow = (c: CodeItem) => (
    <div key={"code" + c.id} className="chat-wrap" {...bulkRow(sb, { k: "code", c })}>
      {codeRen === c.id ? (
        <input className="field" autoFocus aria-label="Đổi tên" defaultValue={c.title} style={{ margin: 0, height: 32 }}
          onBlur={(e) => { x().codePatch(c.id, { title: e.target.value || c.title }); setCodeRen(null); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      ) : (
        <button className={`chat-item code-item ${view === "code" && codeCur === c.id ? "active" : ""}`} onClick={() => { x().setCodeCur(c.id); pickView("code"); if (c.archived) x().codePatch(c.id, { archived: false }); }}>
          {sb.on && <BulkCheck on={sb.has({ k: "code", c })} />}<span className="cv-ell">{c.title}</span><CodeBadge c={c} />
        </button>
      )}
      {!sb.on && <button className="dots" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded={codeMenu === c.id} onClick={() => setCodeMenu(codeMenu === c.id ? null : c.id)}>⋮</button>}
      <Menu open={codeMenu === c.id} className="down" style={{ top: 34, right: 0, width: 220 }}>
        <button className="menu-item" onClick={() => { x().codePatch(c.id, { pinned: !c.pinned }); setCodeMenu(null); }}>{c.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{c.pinned ? "Bỏ ghim" : "Ghim"}</button>
        <button className="menu-item" onClick={() => { setCodeRen(c.id); setCodeMenu(null); }}><I.Pencil />Đổi tên</button>
        <button className="menu-item" onClick={() => { x().codePatch(c.id, { archived: !c.archived }); setCodeMenu(null); x().say(c.archived ? "Đã khôi phục phiên code" : "Đã lưu trữ phiên code"); }}>{c.archived ? <I.M icon="Retry" /> : <I.M icon="Inbox" />}{c.archived ? "Khôi phục" : "Lưu trữ"}</button>
        <hr />
        <button className="menu-item del" onClick={() => { setCodeMenu(null); x().confirm({ title: "Xóa phiên code?", text: "Phiên code và lịch sử của nó sẽ bị xóa, kể cả trên máy chủ nếu đang bật đồng bộ. Không hoàn tác được.", ok: "Xóa", fn: () => { x().setCodeList((l) => l.filter((y) => y.id !== c.id)); x().dropCode(c.id); if (codeCur === c.id) x().setCodeCur(null); x().say("Đã xóa phiên code"); } }); }}><I.Trash />Xóa</button>
      </Menu>
    </div>
  );
  const pinProjs = projects.filter((p) => p.pinned && !p.archived);
  const pjIds = new Set(pinProjs.map((p) => p.id));
  const nested = (c: SideChat) => c.project !== undefined && pjIds.has(c.project);
  const projRow = (p: Project) => {
    const kids = visible.filter((c) => c.project === p.id);
    const open = !pjClosed[p.id];
    return (
      <div key={p.id}>
        <div className="chat-wrap" ref={sideProj === p.id ? sideRef : undefined}>
          <button className={`chat-item pj-row ${view === "project" && curProj === p.id ? "active" : ""}`} onClick={() => { x().setCurProj(p.id); pickView("project"); }}>
            <span className="pj-ic"><I.Layers size={15} /></span>
            <span>{p.name}</span>
          </button>
          {/* Nút riêng đặt đè lên biểu tượng, không lồng trong nút của dòng: nút lồng nút thì bàn phím không tới được. */}
          <button className="pj-tg" aria-label={open ? "Thu gọn" : "Mở rộng"} aria-expanded={open} onClick={() => setPjClosed({ ...pjClosed, [p.id]: open })}><span className={`sec-chev ${open ? "open" : ""}`}><I.Chevron size={14} /></span></button>
          <button className="dots" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded={sideProj === p.id} onClick={() => setSideProj(sideProj === p.id ? null : p.id)}>⋮</button>
          {sideProj === p.id && <ProjMenu p={p} open pin style={{ top: 34, right: 0, width: 240 }}
            onPin={() => { x().patchProj(p.id, { pinned: false }); setSideProj(null); }}
            onEdit={() => { setSideProj(null); x().setEditProj(p.id); }}
            onArchive={() => { x().patchProj(p.id, { archived: true }); setSideProj(null); if (view === "project" && curProj === p.id) pickView("projects"); x().say("Đã lưu trữ dự án"); }}
            onDelete={() => { setSideProj(null); x().setDelProj(p.id); }} />}
        </div>
        <div className={`fold ${open && kids.length ? "open" : ""}`}><div className="pj-kids">{kids.map(row)}</div></div>
      </div>
    );
  };
  const list = () => {
    const pinned = visible.filter((c) => c.pinned && !nested(c));
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
        <div className="section-label sec-toggle"><button className="sec-btn" onClick={() => setRecentOpen(!recentOpen)}><span>Đoạn chat và tác vụ</span><span className={`sec-chev ${recentOpen ? "open" : ""}`}><I.Chevron size={14} /></span></button>{sideItems.length > 0 && <button className={`icon-btn bk-side${sb.on ? " on" : ""}`} style={{ width: 24, height: 24 }} aria-pressed={sb.on} aria-label={sb.on ? "Xong" : "Chọn hàng loạt"} data-tip={sb.on ? "Xong" : "Chọn hàng loạt"} onClick={() => (sb.on ? sb.exit() : sb.start())}>{sb.on ? <I.X size={14} /> : <I.ListChecks size={16} />}</button>}<button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Tìm kiếm đoạn chat" data-tip="Tìm kiếm đoạn chat" onClick={() => x().openSearch()}><I.Search size={15} /></button></div>
        {/* Danh sách VÀ thanh phân trang nằm trong MỘT div là con duy nhất của .fold (như các khối .fold ở trên): .fold dùng grid-template-rows 0fr chỉ co được một hàng, để hai con thì khi gập, thanh phân trang "1-20/30" vẫn còn. */}
        <div className={`fold ${recentOpen ? "open" : ""}`}>
          <div>
            <div className="chat-list">
              {/* Thiết bị mới: danh sách đang về từ máy chủ thì hiện dòng chờ đúng cỡ, chưa nói "chưa có" khi chưa biết. */}
              {visible.length === 0 && (noChats && listWait ? <ChatListSkeleton /> : <div className="muted" style={{ padding: "6px 10px", fontSize: 13 }}>Chưa có đoạn chat nào</div>)}
              {pgRest.items.map(row)}
            </div>
            {sidePager(pgRest)}
          </div>
        </div>
        <BulkBar b={sb} acts={sideActs} noun="mục" compact />
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="side-top">
        <a className="side-brand" href="/" onClick={(e) => { e.preventDefault(); x().goNew(); }} aria-label="Synchro"><Wordmark height={17} /></a>
      </div>
      <button className="side-search" onClick={() => x().openSearch()}><I.Search size={15} /><span>Tìm đoạn chat, tệp, lệnh…</span><kbd>⌘K</kbd></button>
      {speech && (
        <div className="side-tools">
          <div className="section-label">Công cụ Speech</div>
          <div className="nav-sub" aria-label="Công cụ Speech">
            <button data-nav="sp-home" className={`nav-item ${spTool === "home" ? "active" : ""}`} onClick={() => setSpTool("home")}><I.Speech />Trang chủ Speech</button>
            <SpeechSideTools plan={spPlan} tool={spTool} pick={(k) => { pickView("speech"); setSpTool(k); }} />
          </div>
        </div>
      )}
      {list()}
    </aside>
  );
});
