// Bản dịch cho Orchestra (sơ đồ tổ chức trong khung chat và Autopilot, dòng tiến trình của máy chủ). Bổ sung vào
// i18n-dict.ts. Nhãn vai và trạng thái là chữ ngắn dễ trùng với nút khác trên trang, nên dịch theo ngữ cảnh (trc,
// khóa "chữ ‹Orchestra›").
const C = (s: string) => `${s} ‹Orchestra›`;
export const ORCH_VI2EN: Record<string, string> = {
  [C("Trưởng nhóm")]: "Lead", [C("Quản lý")]: "Manager", [C("Nhân viên")]: "Staff", [C("Thực tập")]: "Intern",
  [C("Đang chờ")]: "Waiting", [C("Đang làm")]: "Working", [C("Đã xong")]: "Done", [C("Lỗi")]: "Failed",
  [C("Đang làm lại")]: "Redoing", [C("Bỏ qua")]: "Skipped", [C("Đã làm lại")]: "Redone",
  "Trưởng nhóm đang chia việc": "The lead is splitting the work", "Cả nhóm đang làm": "The team is working",
  "Quản lý đang duyệt": "The manager is reviewing",
  "Trưởng nhóm đang viết câu trả lời": "The lead is writing the answer",
  "Nhóm đã xong": "The team is done", "Nhóm chưa làm xong": "The team didn't finish",
  "hết thời gian / lượt gọi": "out of time / calls", "vượt trần chi phí": "over the cost cap",
  "Model trả về câu trả lời trống.": "The model returned an empty answer.",
  "Sơ đồ nhóm": "Team chart", "Phân công việc": "Assignments",
  "{done}/{total} việc": "{done}/{total} tasks", "{n} model cùng làm": "{n} models at work",
};
export const ORCH_RULES_EN: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^Orchestra · (\d+) model · trưởng nhóm (.+) viết câu trả lời$/,
    (m) => `Orchestra · ${m[1]} models · ${m[2]} writes the answer`,
  ],
  [/^Quá (\d+) giây chưa xong\.$/, (m) => `Not done after ${m[1]} seconds.`],
  [/^Gói trả lỗi (\d+)\.$/, (m) => `The plan returned error ${m[1]}.`],
];
