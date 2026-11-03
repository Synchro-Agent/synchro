// Giao diện chung cho mọi "engine" trả lời một lượt chat (ADR 0001): engine CLI chính chủ (claude, codex, agy)
// chạy bằng gói subscription của người dùng, engine khóa API làm dự phòng, và EchoEngine để kiểm thử.
// Mỗi engine nhận một TurnRequest và trả về luồng sự kiện, nên lõi chat không cần biết bên dưới là CLI hay API.

/**
 * Tệp gửi kèm nguyên dạng (ảnh, PDF) để model tự đọc như khi dùng ứng dụng của hãng: n là số thứ tự trong prompt ("[Ảnh đính kèm 1]"),
 * path là bản đã ghi vào thư mục làm việc của engine (cho CLI nhận tệp theo đường dẫn), pages là ảnh từng trang của PDF scan.
 */
export type Attachment = { n: number; kind: "image" | "pdf"; mime: string; data: string; name: string; path?: string; pages?: { mime: string; path?: string; data: string }[] };

export type TurnRequest = {
  prompt: string;
  /** Ảnh, PDF của tin nhắn (và của lịch sử khi mở phiên mới), theo đúng thứ tự nhắc tới trong prompt. */
  attachments?: Attachment[];
  system?: string;
  model?: string;
  /** Mức effort Synchro (low, medium, high, extra, max); mỗi engine đổi sang cách gọi của CLI đó. */
  effort?: string;
  /** Phiên của engine ở lượt trước (để CLI nối tiếp hội thoại), nếu có. */
  sessionId?: string;
  /** Thư mục làm việc riêng của lượt (tệp đính kèm, đầu ra). */
  workdir?: string;
  /** Lịch sử hội thoại cho engine không giữ phiên (khóa API); engine CLI dùng sessionId. */
  history?: { role: "user" | "assistant"; content: unknown }[];
  /** Cầu nối MCP của Synchro cho lượt này (công cụ skill, plugin, connector…); CLI gọi tới địa chỉ nội bộ này. */
  mcp?: { url: string };
  /** Lúc gần nhất lượt còn hoạt động ngoài đầu ra của CLI (đang / vừa chạy công cụ qua cầu nối MCP): CLI in kết quả một lần lúc xong
   *  (Antigravity) không bị coi là treo khi đang làm việc bằng công cụ. */
  alive?: () => number;
  /** Người dùng bật "Tìm kiếm trên web": bật công cụ tìm web dựng sẵn của CLI. */
  web?: boolean;
  /** Biến môi trường thêm cho tiến trình (đã qua bộ lọc của cli_runtime). */
  env?: Record<string, string>;
  signal?: AbortSignal;
};

/** Một cửa sổ hạn mức của gói (vd. phiên 5 giờ, tuần) như CLI báo về: phần trăm đã dùng và lúc đặt lại (ms). */
export type RateWindow = { window: string; usedPct?: number; resetsAt?: number; status?: string };
export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; limits?: RateWindow[] };

/** Mã lỗi: quota (hết hạn mức), auth (cần đăng nhập lại), other, aborted (người dùng bấm Dừng), timeout (CLI im lặng quá lâu hoặc chạm mức trần của lượt). */
export type ErrorCode = "quota" | "auth" | "other" | "aborted" | "timeout";

export type Event =
  | { kind: "text"; text: string }
  /** model: model thật CLI đang dùng khi CLI cho biết (vd. "opus" → "claude-opus-5-5"). */
  | { kind: "session"; id: string; model?: string }
  | { kind: "usage"; usage: Usage }
  /** via: engine thực sự trả lời (vd. "api:anthropic" khi đã chuyển sang khóa API dự phòng). */
  /** denied: công cụ CLI tự chặn trong lượt (agy -p) — lượt dừng sớm; bên gọi nhắc model làm tiếp bằng công cụ được phép. */
  | { kind: "final"; text: string; via?: string; denied?: string[] }
  | { kind: "error"; message: string; code?: ErrorCode }
  /** Luồng đầu ra tới một khối gọi công cụ (Claude Code): chữ viết trước lời gọi đã nhận đủ. */
  | { kind: "tooluse" };

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
