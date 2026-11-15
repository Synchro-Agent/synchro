// Kiểu sự kiện của agent Synchro Code (server/agentcore.ts phát, ui/wsclient.ts và shared/agentfold.ts đọc) và thẻ hỏi người dùng (server/approvals.ts).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.
import type { CxCard } from "../cxactions";

// Từ server/approvals.ts.
export type AskKind = "edit" | "bash" | "site" | "connector";
// conn, about, destructive: chỉ với công cụ connector (hiện logo, mô tả công cụ, cảnh báo xóa dữ liệu trên thẻ).
// schema: schema tham số của công cụ connector (khi đủ nhỏ) để thẻ duyệt kiểm tra ngay lúc người dùng sửa tham số.
// cx: lời gọi Composio nói bằng thao tác thật (ứng dụng, tài khoản, thao tác, tham số chính; strict: chỉ cho phép một lần).
export type Ask = { id: string; kind: AskKind; tool: string; title: string; detail: string; host?: string; key: string; conn?: { name: string; logo?: string; color?: string; icon?: string }; about?: string; until?: number; destructive?: boolean; schema?: unknown; cx?: CxCard };

// Từ server/agentcore.ts.
export type PlanItem = { content: string; status: "pending" | "in_progress" | "completed" };
export type Pane = "terminal" | "browser" | "files";
export type AgentEvent =
  | { t: "text"; text: string }
  | { t: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { t: "result"; id: string; ok: boolean; summary: string; output?: string; image?: string; diff?: { path: string; add: number; del: number } }
  | { t: "plan"; items: PlanItem[] }
  | { t: "ui"; open: Pane; path?: string; tab?: "log" | "term" }
  | { t: "usage"; input: number; output: number }
  | { t: "steer"; text: string }
  | { t: "done"; text: string; skills: string[]; steer?: string[] }
  // think: suy nghĩ của model (khi model trả về); ask / asked: hỏi người dùng trước khi làm (chế độ quyền, trang web chưa được phép);
  // perm: khóa "luôn cho phép trong phiên này" vừa thêm; meta: trạng thái phiên và gợi ý câu nhắn tiếp sau khi lượt xong.
  | { t: "think"; text: string }
  | ({ t: "ask" } & Ask)
  | { t: "asked"; id: string; ok: boolean; always?: boolean }
  | { t: "perm"; allow: string[] }
  | { t: "meta"; state: string | null; reason: string | null; suggest: string | null }
  | { t: "error"; error: string };
