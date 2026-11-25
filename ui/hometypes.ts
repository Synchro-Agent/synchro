// Kiểu dùng chung của trang chủ (home.tsx) và các phần tách ra từ đó (Sidebar.tsx, Thread.tsx).
import type { SessionState } from "./codesync";

export type View = "new" | "chat" | "projects" | "project" | "artifacts" | "customize" | "code" | "speech" | "autopilot" | "brain";
export type Say = (m: string) => void;
// Phiên Synchro Code ở thanh bên (danh sách lưu ở trình duyệt, đồng bộ với máy chủ khi bật).
export type CodeItem = { id: number; title: string; pinned?: boolean; archived?: boolean; state?: SessionState; reason?: string | null; running?: boolean; upd?: number; pr?: { number: number; url: string | null; state: string } | null };
