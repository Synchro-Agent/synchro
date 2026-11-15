// Dấu vết công cụ của một lượt chat (server/transpile.ts dựng, ui/llm.ts và ui/store.tsx hiện).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.

// Từ server/transpile.ts.
export type TraceStatus = "ok" | "error" | "cancelled_by_user" | "denied";
export type TraceItem = { id: string; name: string; label: string; input: string; status: TraceStatus; summary: string; ref?: string };
