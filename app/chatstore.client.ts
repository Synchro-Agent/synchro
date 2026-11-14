// Kho đoạn chat ở trình duyệt (blueprint B2): danh sách đoạn chat, dự án, đoạn chat đang mở, các đoạn chat đang có câu trả lời chạy
// và tin nhắn chờ gửi. Trước đây là useState của Home, nên mỗi mẩu chữ đang chảy dựng lại cả trang; nay từng phần chỉ đăng ký đúng thứ nó cần.
// Khác app/chatstore.ts (kho SQLite ở máy chủ): "client-only" làm lỗi build ngay nếu tệp này lọt vào mã máy chủ, và ngược lại
// import nhầm "./chatstore" từ trình duyệt sẽ kéo cả sqlite vào gói tải.
// Hàm đặt giá trị nhận giá trị hoặc hàm cập nhật như setState của React, nên mọi chỗ gọi cũ dùng nguyên được.
// Không bao giờ ghi vào kho lúc đang vẽ (Home vẽ cả ở máy chủ): chỉ ghi trong hiệu ứng và hàm xử lý sự kiện.
import "client-only";
import { useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { create } from "zustand";
import type { OutFile } from "./llm";
import type { Chat, Msg, Project } from "./store";
import type { Queued } from "./worklog";

type Setter<T> = (u: SetStateAction<T>) => void;
const next = <T,>(u: SetStateAction<T>, prev: T): T => (typeof u === "function" ? (u as (p: T) => T)(prev) : u);

export type ChatState = {
  chats: Chat[];
  projects: Project[];
  /** Đoạn chat đang mở (null: trang Mới / mục khác). */
  cur: number | null;
  /** Đoạn chat đang có câu trả lời chạy ở máy chủ. */
  running: ReadonlySet<number>;
  /** Tin nhắn gửi trong lúc đang chạy: "steer" chờ ghép vào lượt, "later" gửi thành lượt mới khi xong. */
  queued: Queued[];
  setChats: Setter<Chat[]>;
  setProjects: Setter<Project[]>;
  setCur: Setter<number | null>;
  setRunning: Setter<ReadonlySet<number>>;
  setQueued: Setter<Queued[]>;
  /** Đổi danh sách tin nhắn của một đoạn chat. */
  patch: (id: number, fn: (m: Msg[]) => Msg[]) => void;
  /** Đổi vài trường của một đoạn chat. */
  patchChat: (id: number, p: Partial<Chat>) => void;
  togglePin: (id: number) => void;
  setChatTags: (id: number, tags: string[]) => void;
  /** Bỏ các đoạn chat khỏi danh sách (dừng lượt chạy, báo máy chủ là việc của nơi gọi). */
  removeChats: (ids: number[]) => void;
  /** Bật / tắt dấu "đang chạy" của một đoạn chat. */
  setBusy: (id: number, on: boolean) => void;
  /** Về trạng thái ban đầu (Home gắn lại sau khi đã gỡ khỏi trang). */
  reset: () => void;
};

const EMPTY = { chats: [] as Chat[], projects: [] as Project[], cur: null as number | null, running: new Set<number>() as ReadonlySet<number>, queued: [] as Queued[] };

export const useChatStore = create<ChatState>()((set, get) => {
  // Giá trị không đổi thì không báo cho nơi nào (như setState của React bỏ qua giá trị giống hệt).
  const put = <K extends keyof typeof EMPTY>(k: K) => (u: SetStateAction<ChatState[K]>) => {
    const prev = get()[k], v = next(u, prev);
    if (!Object.is(v, prev)) set({ [k]: v } as Pick<ChatState, K>);
  };
  const setChats = put("chats");
  return {
    ...EMPTY,
    setChats,
    setProjects: put("projects"),
    setCur: put("cur"),
    setRunning: put("running"),
    setQueued: put("queued"),
    patch: (id, fn) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, msgs: fn(c.msgs) } : c))),
    patchChat: (id, p) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c))),
    togglePin: (id) => setChats((cs) => cs.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x))),
    setChatTags: (id, tags) => setChats((cs) => cs.map((x) => (x.id === id ? { ...x, tags: tags.length ? tags : undefined } : x))),
    removeChats: (ids) => { const del = new Set(ids); setChats((cs) => cs.filter((c) => !del.has(c.id))); },
    setBusy: (id, on) => put("running")((s) => { if (s.has(id) === on) return s; const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }),
    reset: () => set({ ...EMPTY, running: new Set<number>() }),
  };
});

/** Một phần của kho cho Home, Thanh bên, khung đoạn chat, theo đúng nhịp setState của React: kho đổi thì gọi setState ngay trong lời gọi đó,
 *  nên lần vẽ được gộp cùng các useState khác đổi trong cùng hàm xử lý (đổi đoạn chat đang mở và trang đang xem trong một hiệu ứng là một lần vẽ).
 *  useChatStore (useSyncExternalStore) luôn vẽ ở mức ưu tiên đồng bộ, tách khỏi các useState đổi cùng lúc trong hẹn giờ / hiệu ứng:
 *  Home từng thấy một lần vẽ có đoạn chat mới mà trang chưa đổi (địa chỉ #c= bị xóa rồi thêm lại).
 *  eq: hai giá trị coi là như nhau thì không vẽ lại (mặc định Object.is); phần dẫn xuất (danh sách thanh bên, thông tin đoạn chat đang mở)
 *  truyền sameList / sameFields để mẩu chữ đang chảy không làm nơi đó vẽ lại. pick đọc kho tại lúc gọi, không theo prop. */
export function useChatState<T>(pick: (s: ChatState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const [v, setV] = useState(() => pick(useChatStore.getState()));
  const last = useRef(v);
  useLayoutEffect(() => {
    const f = () => { const n = pick(useChatStore.getState()); if (!eq(last.current, n)) { last.current = n; setV(() => n); } };
    f();
    return useChatStore.subscribe(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** Hai mảng cùng độ dài, từng phần tử là cùng một đối tượng. */
export const sameList = <T,>(a: readonly T[], b: readonly T[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
/** Hai đối tượng phẳng (hoặc cùng undefined) có cùng các trường (Object.is từng trường). */
export function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof T)[];
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
}

/** Đoạn chat đang mở (trọn vẹn, có tin nhắn): chỉ khung đoạn chat và các hộp cần nội dung đăng ký. */
export const selectCurChat = (s: ChatState) => (s.cur === null ? undefined : s.chats.find((c) => c.id === s.cur));

/** Phần của đoạn chat đang mở mà Home cần (thanh tiêu đề, địa chỉ trang, ô soạn tin): không có tin nhắn, nên chữ đang chảy không đổi nó. */
export type ChatMeta = { id: number; title: string; inc?: boolean; pinned?: boolean; tags?: string[]; project?: number; studio?: Chat["studio"]; stub?: boolean; browser?: boolean };
export const selectChatMeta = (s: ChatState): ChatMeta | undefined => {
  const c = selectCurChat(s);
  return c && { id: c.id, title: c.title, inc: c.inc, pinned: c.pinned, tags: c.tags, project: c.project, studio: c.studio, stub: c.stub, browser: c.browser };
};

/** Câu trả lời đang chạy dừng chờ người dùng duyệt công cụ (thẻ hỏi lại ở trạng thái chờ). */
const waitsForYou = (c: Chat) => { const m = c.msgs[c.msgs.length - 1]; return m?.role === "ai" && !m.done && !!m.parts?.some((p) => p.k === "ask" && p.state === "wait"); };
/** Mã các đoạn chat (kể cả ẩn danh) đang chờ bạn duyệt, nối thành chuỗi: so bằng chuỗi nên chữ đang chảy không làm Home vẽ lại. */
export const selectNeedKey = (s: ChatState) => s.chats.filter((c) => s.running.has(c.id) && waitsForYou(c)).map((c) => c.id).join(",");

/** Một dòng đoạn chat ở thanh bên: chỉ những gì dòng đó hiện, không có tin nhắn. */
export type SideChat = { id: number; title: string; pinned?: boolean; project?: number; tags?: string[]; running: boolean; need: boolean };
let side: { chats: Chat[]; running: ReadonlySet<number>; list: SideChat[]; by: Map<number, SideChat> } | null = null;
/** Danh sách đoạn chat (bỏ ẩn danh) cho thanh bên. Dòng không đổi trường nào thì giữ đúng đối tượng cũ, nên mẩu chữ đang chảy cho ra danh sách
 *  sameList với lần trước và thanh bên không vẽ lại; chỉ dựng lại khi danh sách đoạn chat hay tập "đang chạy" đổi. */
export function selectSideList(s: ChatState): SideChat[] {
  if (side && side.chats === s.chats && side.running === s.running) return side.list;
  const prev = side?.by, by = new Map<number, SideChat>(), list: SideChat[] = [];
  for (const c of s.chats) {
    if (c.inc) continue;
    const running = s.running.has(c.id), need = running && waitsForYou(c), o = prev?.get(c.id);
    const x = o && o.title === c.title && o.pinned === c.pinned && o.project === c.project && o.tags === c.tags && o.running === running && o.need === need ? o
      : { id: c.id, title: c.title, pinned: c.pinned, project: c.project, tags: c.tags, running, need };
    by.set(c.id, x);
    list.push(x);
  }
  side = { chats: s.chats, running: s.running, list, by };
  return list;
}

/** Danh sách đoạn chat cho các phần chỉ hiện khi mở (Cài đặt, bảng lệnh…): vẽ lại khi danh sách đổi. */
export const useChats = () => useChatStore((s) => s.chats);

// ---- Trạng thái giao diện dùng chung giữa Home, Thanh bên và khung đoạn chat ----
// Trước đây là useState của Home; nay Thanh bên và khung đoạn chat là component riêng (memo) nên phần cả hai bên cùng đọc / đổi nằm ở đây.
const putter = <S extends object>(set: (p: Partial<S>) => void, get: () => S) => <K extends keyof S>(k: K) => (u: SetStateAction<S[K]>) => {
  const prev = get()[k], v = next(u, prev);
  if (!Object.is(v, prev)) set({ [k]: v } as unknown as Partial<S>);
};

/** Menu ở thanh bên và menu tiêu đề: Esc và bấm ra ngoài (Home) đóng chúng, "Đổi tên" ở menu tiêu đề bắt đầu đổi tên ngay trên dòng ở thanh bên. */
export type SideUi = {
  /** Menu ⋮ của dòng đoạn chat / phiên code đang mở. */
  chatMenu: number | null; codeMenu: number | null;
  /** Menu ở tiêu đề đoạn chat (thanh trên cùng). */
  titleMenu: boolean;
  /** Khung "Gắn thẻ" / danh sách dự án đang mở trong menu ⋮ hay menu tiêu đề. */
  pickTag: boolean; pickProj: boolean;
  /** Dòng đoạn chat đang đổi tên ngay trên thanh bên. */
  renaming: number | null;
  /** Thẻ đang lọc ở thanh bên (null: tất cả). */
  tagFilter: string | null;
  setChatMenu: Setter<number | null>; setCodeMenu: Setter<number | null>; setTitleMenu: Setter<boolean>; setPickTag: Setter<boolean>; setPickProj: Setter<boolean>;
  setRenaming: Setter<number | null>; setTagFilter: Setter<string | null>;
  /** Đóng mọi menu của thanh bên và menu tiêu đề. */
  closeMenus: () => void;
};
const SIDE0 = { chatMenu: null, codeMenu: null, titleMenu: false, pickTag: false, pickProj: false, renaming: null, tagFilter: null };
export const useSideUi = create<SideUi>()((set, get) => {
  const put = putter<SideUi>(set, get);
  return { ...SIDE0, setChatMenu: put("chatMenu"), setCodeMenu: put("codeMenu"), setTitleMenu: put("titleMenu"), setPickTag: put("pickTag"), setPickProj: put("pickProj"),
    setRenaming: put("renaming"), setTagFilter: put("tagFilter"), closeMenus: () => set({ chatMenu: null, codeMenu: null, titleMenu: false }) };
});

/** Khung bên cạnh đoạn chat: artifact, tệp do code tạo, trình duyệt. Home mở khung từ lượt đang chạy (Synchro bắt đầu dùng trình duyệt,
 *  áp bản sửa của hội đồng phản biện); khung đoạn chat (Thread.tsx) vẽ khung và báo lại khung nào đang mở, số sản phẩm (nút "Sản phẩm" ở thanh trên). */
export type ArtSel = { chat: number; ident: string; v: number; follow: boolean };
export type PanelUi = {
  artSel: ArtSel | null; fileSel: { chat: number; file: OutFile } | null;
  /** Đoạn chat đang mở khung trình duyệt. */
  brwFor: number | null;
  /** Synchro vừa bắt đầu làm ở trình duyệt nào (của Synchro / Chrome của bạn): khung trình duyệt chuyển sang đó. */
  brwPrefer: { v: "synchro" | "user"; n: number } | null;
  /** Khung mở rộng hết cột chat. */
  artFull: boolean;
  /** Khung đang hiện (do khung đoạn chat tính và báo lại) và số sản phẩm của đoạn chat đang mở. */
  panel: "art" | "file" | "brw" | null; prodN: number;
  setArtSel: Setter<ArtSel | null>; setFileSel: Setter<{ chat: number; file: OutFile } | null>; setBrwFor: Setter<number | null>;
  setBrwPrefer: Setter<{ v: "synchro" | "user"; n: number } | null>; setArtFull: Setter<boolean>;
};
const PANEL0 = { artSel: null, fileSel: null, brwFor: null, brwPrefer: null, artFull: false, panel: null, prodN: 0 };
export const usePanelUi = create<PanelUi>()((set, get) => {
  const put = putter<PanelUi>(set, get);
  return { ...PANEL0, setArtSel: put("artSel"), setFileSel: put("fileSel"), setBrwFor: put("brwFor"), setBrwPrefer: put("brwPrefer"), setArtFull: put("artFull") };
});
/** Về trạng thái ban đầu cùng kho đoạn chat (Home gắn lại sau khi đã gỡ khỏi trang). */
export const resetUi = () => { useSideUi.setState(SIDE0); usePanelUi.setState(PANEL0); };
