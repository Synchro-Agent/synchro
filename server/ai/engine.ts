// Giao diện chung cho mọi "engine" trả lời một lượt chat (ADR 0001): engine CLI chính chủ (claude, codex, agy)
// chạy bằng gói subscription của người dùng, engine khóa API làm dự phòng, và EchoEngine để kiểm thử.
// Mỗi engine nhận một TurnRequest và trả về luồng sự kiện, nên lõi chat không cần biết bên dưới là CLI hay API.

/**
 * Tệp gửi kèm nguyên dạng (ảnh, PDF) để model tự đọc như khi dùng ứng dụng của hãng: n là số thứ tự trong prompt ("[Ảnh đính kèm 1]"),
 * path là bản đã ghi vào thư mục làm việc của engine (cho CLI nhận tệp theo đường dẫn), pages là ảnh từng trang của PDF scan.
 */
import "server-only";
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
  /** Tách phiên mới từ sessionId (phiên ấm đã khởi tạo sẵn), không ghi tiếp vào phiên đó (Claude Code --fork-session). */
  fork?: boolean;
  /** Lượt không có công cụ, được dùng tiến trình Claude Code khởi động sẵn (cli_pool.ts); hỏng thì tự rơi về khởi động mới. */
  pool?: boolean;
  /** Phiên nối tiếp của CLI chỉ nhận hướng dẫn hệ thống ở lượt đầu (Codex, Antigravity): phần hướng dẫn mới so với những gì phiên đã có. */
  sysUpdate?: string;
  /** Thư mục làm việc riêng của lượt (tệp đính kèm, đầu ra). */
  workdir?: string;
  /** Lịch sử hội thoại cho engine không giữ phiên (khóa API); engine CLI dùng sessionId. */
  history?: { role: "user" | "assistant"; content: unknown }[];
  /** Cầu nối MCP của Synchro cho lượt này (công cụ skill, plugin, connector…); CLI gọi tới địa chỉ nội bộ này. */
  /** live: địa chỉ cầu nối sống theo cuộc trò chuyện (mcpbridge.openBridge với conv, G2.2): tiến trình dựng sẵn / thread đã nạp dùng lại được qua nhiều lượt;
   *  key: mã bộ công cụ của lượt (đổi bộ công cụ thì không dùng lại). */
  mcp?: { url: string; onPark?: (f: () => void) => void; live?: { url: string; key: string } };
  /** Lúc gần nhất lượt còn hoạt động ngoài đầu ra của CLI (đang / vừa chạy công cụ qua cầu nối MCP): CLI in kết quả một lần lúc xong
   *  (Antigravity) không bị coi là treo khi đang làm việc bằng công cụ. */
  alive?: () => number;
  /**
   * Điều Synchro đã biết về lượt đang chạy (bước đang làm trong danh sách việc, artifact đã nhận): CLI chỉ in chữ một
   * lần lúc xong (Antigravity) thì dòng "vẫn đang viết" kèm thêm phần này thay vì chỉ đếm giây. Rỗng khi chưa biết gì.
   */
  pulse?: () => string;
  /** Người dùng bật "Tìm kiếm trên web": bật công cụ tìm web dựng sẵn của CLI. */
  web?: boolean;
  /** Chờ lượt khác của cùng tài khoản (Antigravity, Grok chạy lần lượt) tối đa bao lâu; chế độ Tự động chờ ngắn rồi chuyển model. */
  lockMs?: number;
  /** Lượt này đang dừng chờ người dùng duyệt một công cụ: lượt khác đang chờ khóa của tài khoản cần biết để báo đúng lý do và chờ tiếp. */
  awaitingUser?: () => boolean;
  /** Biến môi trường thêm cho tiến trình (đã qua bộ lọc của cli_runtime). */
  env?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * Kênh nhắn thêm giữa lượt của chính CLI (Codex app-server: turn/steer): engine gọi với hàm gửi khi lượt đã chạy,
   * với null khi lượt xong. Hàm gửi trả false khi CLI không nhận (bản cũ, lượt vừa xong): bên gọi tự cắt lượt rồi làm
   * tiếp trong cùng phiên.
   */
  onInject?: (send: ((text: string) => Promise<boolean>) | null) => void;
};

/** Một cửa sổ hạn mức của gói (vd. phiên 5 giờ, tuần) như CLI báo về: phần trăm đã dùng và lúc đặt lại (ms). */
export type RateWindow = { window: string; usedPct?: number; resetsAt?: number; status?: string };
export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; limits?: RateWindow[] };

/** Mã lỗi: quota (hết hạn mức), rate (giới hạn tốc độ, quá tải ngắn hạn), auth (cần đăng nhập lại), other, aborted (người dùng bấm Dừng),
 *  timeout (CLI im lặng quá lâu hoặc chạm mức trần của lượt), busy (lượt khác của cùng tài khoản đang giữ CLI quá lâu). */
export type ErrorCode = "quota" | "rate" | "auth" | "other" | "aborted" | "timeout" | "busy";

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
  | { kind: "tooluse" }
  /** Model đang làm việc (đang nghĩ, gọi công cụ…) dù chưa có chữ. Sự kiện khởi động của CLI (init, thread.started) không phát cái này:
   *  bộ canh lượt treo chỉ tính hoạt động thật. */
  | { kind: "activity" }
  /** Lượt dùng hồ tiến trình: có sẵn tiến trình đang chờ (hit) hay phải khởi động (cold). Chỉ để đo thời gian. */
  | { kind: "pool"; state: "hit" | "cold" }
  /** Dòng trạng thái cho người dùng (CLI đang thử lại, chờ lượt khác). wait: đang chờ khóa của tài khoản, bộ canh tạm dừng; false: hết chờ. */
  | { kind: "status"; text?: string; wait?: boolean; /** Chỉ báo cho người dùng biết vẫn đang chờ, không phải dấu hiệu CLI còn sống: bộ canh không tính lại. */ tick?: boolean }
  /** CLI đang tìm hoặc đọc web bằng công cụ dựng sẵn. */
  | { kind: "search"; query?: string; url?: string }
  /** Nguồn web CLI vừa nhận được. */
  | { kind: "sources"; items: WebSource[] }
  /** Danh sách việc model cập nhật bằng công cụ dựng sẵn của CLI (update_plan của Codex): hiện như danh sách việc của Synchro. */
  | { kind: "plan"; items: PlanStep[] };

export type PlanStep = { content: string; status: "pending" | "in_progress" | "completed" };
/** Danh sách việc dựng sẵn của Codex → danh sách việc của Synchro. exec --json: mục todo_list { items: [{ text, completed }] } (việc đầu chưa xong là
 *  việc đang làm); app-server: turn/plan/updated { plan: [{ step, status: pending | inProgress | completed }] }. Không đọc được thì null. */
export function cliPlan(raw: unknown): PlanStep[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const rows = raw.slice(0, 12).map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}));
  const text = (r: Record<string, unknown>) => String(r.step ?? r.text ?? r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (rows.some((r) => typeof r.status === "string")) {
    const st = (v: unknown): PlanStep["status"] => (v === "completed" ? "completed" : v === "inProgress" || v === "in_progress" ? "in_progress" : "pending");
    const out = rows.map((r) => ({ content: text(r), status: st(r.status) })).filter((r) => r.content);
    return out.length ? out : null;
  }
  let open = false;
  const out = rows.map((r) => { const done = r.completed === true; const s: PlanStep["status"] = done ? "completed" : open ? "pending" : "in_progress"; if (!done) open = true; return { content: text(r), status: s }; }).filter((r) => r.content);
  return out.length ? out : null;
}

export type WebSource = { title: string; url: string };

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
