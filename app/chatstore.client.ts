// Kho đoạn chat ở trình duyệt (blueprint B2): danh sách đoạn chat, dự án, đoạn chat đang mở, các đoạn chat đang có câu trả lời chạy
// và tin nhắn chờ gửi. Trước đây là useState của Home, nên mỗi mẩu chữ đang chảy dựng lại cả trang; nay từng phần chỉ đăng ký đúng thứ nó cần.
// Khác app/chatstore.ts (kho SQLite ở máy chủ): "client-only" làm lỗi build ngay nếu tệp này lọt vào mã máy chủ, và ngược lại
// import nhầm "./chatstore" từ trình duyệt sẽ kéo cả sqlite vào gói tải.
// Hàm đặt giá trị nhận giá trị hoặc hàm cập nhật như setState của React, nên mọi chỗ gọi cũ dùng nguyên được.
// Không bao giờ ghi vào kho lúc đang vẽ (Home vẽ cả ở máy chủ): chỉ ghi trong hiệu ứng và hàm xử lý sự kiện.
import "client-only";
import { useLayoutEffect, useState, type SetStateAction } from "react";
import { create } from "zustand";
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

/** Một phần của kho cho Home, theo đúng nhịp setState của React: kho đổi thì gọi setState ngay trong lời gọi đó, nên lần vẽ được gộp
 *  cùng các useState khác đổi trong cùng hàm xử lý (đổi đoạn chat đang mở và trang đang xem trong một hiệu ứng là một lần vẽ).
 *  useChatStore (useSyncExternalStore) luôn vẽ ở mức ưu tiên đồng bộ, tách khỏi các useState đổi cùng lúc trong hẹn giờ / hiệu ứng:
 *  Home từng thấy một lần vẽ có đoạn chat mới mà trang chưa đổi (địa chỉ #c= bị xóa rồi thêm lại). Phần nhỏ, tách riêng thì dùng useChatStore. */
export function useChatState<T>(pick: (s: ChatState) => T): T {
  const [v, setV] = useState(() => pick(useChatStore.getState()));
  useLayoutEffect(() => {
    const f = () => setV(() => pick(useChatStore.getState()));
    f();
    return useChatStore.subscribe(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** Danh sách đoạn chat cho các phần chỉ hiện khi mở (Cài đặt, bảng lệnh…): vẽ lại khi danh sách đổi. */
export const useChats = () => useChatStore((s) => s.chats);
