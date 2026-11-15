// Kết quả quét skill rác (server/skillscan.ts chạy, ui/skillscanui.tsx hiện).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.
type Lang = "vi" | "en";

// Từ server/skillscan.ts.
export type Verdict = "junk" | "useless" | "ok" | "unknown";
// key: "u:<tên>" (skill của người dùng) hoặc "p:<id thư viện>:<tên>". where: tên thư viện ("" với skill của người dùng).
// manage: người này tắt / bật được (thư viện cho mọi người: chỉ quản trị viên).
export type ScanItem = {
  key: string; name: string; description: string; where: string; kind: "skill" | "personal" | "org"; plugin: string | null;
  enabled: boolean; manage: boolean; verdict: Verdict; field: string; why: string; by: "model" | "rules";
};
export type ScanJob = {
  id: string; status: "running" | "done" | "stopped" | "error"; model: string; modelName: string; lang: Lang;
  total: number; done: number; items: ScanItem[]; started: number; ended: number | null; error: string;
};
