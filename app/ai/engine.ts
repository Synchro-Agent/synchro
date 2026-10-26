// Giao diện chung cho mọi "engine" trả lời một lượt chat (ADR 0001): engine CLI chính chủ (claude, codex, agy)
// chạy bằng gói subscription của người dùng, engine khóa API làm dự phòng, và EchoEngine để kiểm thử.
// Mỗi engine nhận một TurnRequest và trả về luồng sự kiện, nên lõi chat không cần biết bên dưới là CLI hay API.

export type TurnRequest = {
  prompt: string;
  system?: string;
  model?: string;
  /** Phiên của engine ở lượt trước (để CLI nối tiếp hội thoại), nếu có. */
  sessionId?: string;
  /** Thư mục làm việc riêng của lượt (tệp đính kèm, đầu ra). */
  workdir?: string;
  /** Lịch sử hội thoại cho engine không giữ phiên (khóa API); engine CLI dùng sessionId. */
  history?: { role: "user" | "assistant"; content: unknown }[];
  /** Biến môi trường thêm cho tiến trình (đã qua bộ lọc của cli_runtime). */
  env?: Record<string, string>;
  signal?: AbortSignal;
};

/** Một cửa sổ hạn mức của gói (vd. phiên 5 giờ, tuần) như CLI báo về: phần trăm đã dùng và lúc đặt lại (ms). */
export type RateWindow = { window: string; usedPct?: number; resetsAt?: number; status?: string };
export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; limits?: RateWindow[] };

/** Mã lỗi: quota (hết hạn mức), auth (cần đăng nhập lại), other, aborted (người dùng bấm Dừng), timeout (quá 30 phút). */
export type ErrorCode = "quota" | "auth" | "other" | "aborted" | "timeout";

export type Event =
  | { kind: "text"; text: string }
  | { kind: "session"; id: string }
  | { kind: "usage"; usage: Usage }
  /** via: engine thực sự trả lời (vd. "api:anthropic" khi đã chuyển sang khóa API dự phòng). */
  | { kind: "final"; text: string; via?: string }
  | { kind: "error"; message: string; code?: ErrorCode };

export interface Engine {
  readonly id: string;
  runTurn(req: TurnRequest): AsyncIterable<Event>;
}

/** Engine trả lại đúng nội dung được gửi (theo từng đoạn như chữ hiện dần), dùng để kiểm thử lớp engine và bộ chọn. */
export class EchoEngine implements Engine {
  readonly id = "echo";
  constructor(private chunk = 8) {}
  async *runTurn(req: TurnRequest): AsyncIterable<Event> {
    yield { kind: "session", id: req.sessionId ?? `echo-${Date.now().toString(36)}` };
    const text = req.system ? `[${req.system}] ${req.prompt}` : req.prompt;
    for (let i = 0; i < text.length; i += this.chunk) {
      if (req.signal?.aborted) { yield { kind: "error", message: "Đã dừng.", code: "aborted" }; return; }
      yield { kind: "text", text: text.slice(i, i + this.chunk) };
    }
    yield { kind: "usage", usage: { input: req.prompt.length + (req.system?.length ?? 0), output: text.length } };
    yield { kind: "final", text };
  }
}

/** Gom luồng sự kiện thành kết quả cuối (dùng cho lượt gọi một lần và kiểm thử). */
export async function collect(events: AsyncIterable<Event>) {
  let text = "", final: string | null = null, via: string | null = null, session: string | null = null, usage: Usage | null = null, error: { message: string; code?: ErrorCode } | null = null;
  for await (const e of events) {
    if (e.kind === "text") text += e.text;
    else if (e.kind === "session") session = e.id;
    else if (e.kind === "usage") usage = e.usage;
    else if (e.kind === "final") { final = e.text; via = e.via ?? null; }
    else if (e.kind === "error") error = { message: e.message, code: e.code };
  }
  return { text: final ?? text, via, session, usage, error };
}
