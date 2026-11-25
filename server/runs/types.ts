// Kiểu dùng chung của RunService (server/runs/): lượt chat / tác vụ lưu ở SQLite và lượt Code giữ trong bộ nhớ.
import "server-only";
import type { UserRow } from "../authstore";

// say: lời dẫn của model trước khi dùng công cụ (giữ lại, không bị câu trả lời cuối thay mất); tool / res: công cụ đang chạy và kết quả;
// plan: danh sách việc (JSON); steer: tin người dùng nhắn thêm đã được ghép vào lượt đang chạy; step / note: dòng trạng thái.
// ui: yêu cầu giao diện mở một khung (vd. "browser" khi model bắt đầu dùng trình duyệt).
// ask / asked: lượt đang chờ người dùng duyệt (JSON câu hỏi), và câu trả lời (JSON { id, ok, always }).
// orch: bản chụp sơ đồ tổ chức của Orchestra (JSON OrchState ở shared/orchestra.ts), mỗi lần một thành viên đổi
// trạng thái.
export type RunEvent = {
  seq: number; at: number; text: string;
  kind: "step" | "tool" | "note" | "say" | "res" | "plan" | "steer" | "ui" | "ask" | "asked" | "conn" | "link" | "plans"
    | "rate" | "tconn" | "orch";
};
export type RunStatus = "running" | "done" | "error";
export type PublicRun = { id: string; status: RunStatus; conv: string | null; kind: string; events: RunEvent[]; result: unknown; http: number | null; createdAt: number; updatedAt: number };
// delta: chữ model đang viết ở bước hiện tại (s = số thứ tự bước; reset = bước mới bắt đầu, xóa chữ của bước trước).
export type Delta = { s: number; t?: string; reset?: boolean };
export type Exec = (body: Record<string, unknown>, user: UserRow) => Promise<{ http: number; json: unknown }>;
