// Orchestra: nhiều model cùng làm một việc như một công ty (trưởng nhóm lập kế hoạch và viết câu trả lời cuối, quản lý
// duyệt, nhân viên và thực tập làm các nhánh). Tệp này chỉ giữ kiểu dữ liệu và nhãn dùng chung giữa máy chủ
// (server/orchestra/) và giao diện (ui/orchestra.tsx): bản chụp sơ đồ tổ chức mà máy chủ gửi qua sự kiện "orch" của
// lượt chạy.

/**
 * Thẻ của khối kết quả nhóm đính sau tin nhắn mới nhất của người dùng cho trưởng nhóm viết câu trả lời cuối. Đó là dữ
 * liệu Synchro thêm vào, không phải chữ người dùng gõ: chat/prompt.ts lastUserText bỏ khối mở đầu bằng thẻ này.
 */
export const ORCH_TAG = "orchestra_results";

export type OrchRole = "boss" | "manager" | "staff" | "intern";
export const ORCH_ROLES: OrchRole[] = ["boss", "manager", "staff", "intern"];
/** Nhãn tiếng Việt (nguồn i18n); giao diện dịch qua tr(). */
export const ROLE_LABEL: Record<OrchRole, string> = {
  boss: "Trưởng nhóm", manager: "Quản lý", staff: "Nhân viên", intern: "Thực tập",
};

export type OrchPhase = "plan" | "work" | "review" | "final" | "done" | "failed";
export const PHASE_LABEL: Record<OrchPhase, string> = {
  plan: "Trưởng nhóm đang chia việc",
  work: "Cả nhóm đang làm",
  review: "Quản lý đang duyệt",
  final: "Trưởng nhóm đang viết câu trả lời",
  done: "Nhóm đã xong",
  failed: "Nhóm chưa làm xong",
};

export type OrchTaskStatus = "wait" | "run" | "done" | "fail" | "redo" | "skip";
export type OrchMemberStatus = "idle" | "working" | "done" | "failed";

/** Một thành viên của nhóm: một model với một vai trò (một model có thể nhận nhiều việc). */
export type OrchMember = { role: OrchRole; model: string; name: string; status: OrchMemberStatus; tokens: number };
/** Một nhánh việc trong kế hoạch của trưởng nhóm. note: lý do làm lại / bỏ qua / lỗi, ngắn. */
export type OrchTaskView = {
  id: string; title: string; role: OrchRole; model: string; name: string; status: OrchTaskStatus;
  deps: string[]; tokens: number; ms?: number; note?: string; redo?: boolean; via?: string;
};
/**
 * Bản chụp sơ đồ tổ chức của một lượt. tokens là số ước lượng (gói subscription không báo số token thật);
 * usd: tiền khóa API đã tính cho lượt này (gói thì 0).
 */
export type OrchState = {
  v: 1; phase: OrchPhase; members: OrchMember[]; tasks: OrchTaskView[];
  tokens: number; usd: number; started: number; ended?: number;
};

// Đọc bản chụp nằm ở tệp riêng: khung chat cần nó ở phần tải đầu, còn nhãn và vai chỉ thẻ sơ đồ (tải chậm) cần.
export { parseOrch } from "./orchparse";
