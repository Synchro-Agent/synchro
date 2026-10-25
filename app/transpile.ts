// Chuẩn dữ liệu hội thoại của Synchro (không bao giờ lưu JSON thô của hãng AI) và bộ chuyển lịch sử ở máy chủ.
// Trình duyệt gửi lịch sử theo chuẩn của Synchro: { role, content, trace? }. Trước mỗi lượt, máy chủ:
//   1. Rút gọn artifact: các phiên bản cũ thành thẻ tham chiếu, bản hiện tại gửi một lần ở cuối (vfs.ts).
//   2. Hoạt động công cụ của các lượt trước (trace) thành một đoạn tóm tắt trung tính kèm mã tham chiếu ref_…:
//      model nào đọc cũng hiểu, đổi hãng giữa chừng không bao giờ lỗi 400, và không bơm lại dữ liệu lớn vào ngữ cảnh.
//      Chỉ lượt đang chạy mới dùng khối công cụ gốc của hãng (chatengine.ts).
//   3. Sửa cấu trúc: bỏ tin rỗng, gộp hai tin liền nhau cùng vai trò (Anthropic bắt buộc luân phiên), mở đầu bằng người dùng.
//   4. Tầng động (tri thức tìm theo câu hỏi, artifact hiện tại, khối ngữ cảnh bật tạm) đặt ở cuối tin nhắn mới nhất,
//      để phần đầu (hướng dẫn hệ thống, danh mục skill, lịch sử) giữ nguyên giữa các lượt và đọc được từ bộ nhớ đệm prompt.
import { artState, currentArtifactsBlock, stubArtifacts } from "./vfs";

export type TraceStatus = "ok" | "error" | "cancelled_by_user" | "denied";
export type TraceItem = { id: string; name: string; label: string; input: string; status: TraceStatus; summary: string; ref?: string };
export type CanonMsg = { role: "user" | "assistant"; content: string | Block[]; trace?: TraceItem[] };
type Block = { type: string; text?: string; [k: string]: unknown };

const STATUS: Record<TraceStatus, string> = { ok: "xong", error: "lỗi", cancelled_by_user: "người dùng đã dừng giữa chừng (cancelled_by_user)", denied: "người dùng không cho phép" };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** Làm sạch trace từ trình duyệt (dữ liệu người dùng gửi lên). */
export function cleanTrace(raw: unknown): TraceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const s = (k: string, n: number) => (typeof o[k] === "string" ? clip(o[k] as string, n) : "");
    const status = (["ok", "error", "cancelled_by_user", "denied"] as const).find((v) => v === o.status) ?? "ok";
    const name = s("name", 120);
    if (!name) return [];
    const ref = typeof o.ref === "string" && /^ref_[\w-]{6,40}$/.test(o.ref) ? o.ref : undefined;
    return [{ id: s("id", 80), name, label: s("label", 160) || name, input: s("input", 400), status, summary: s("summary", 900), ...(ref ? { ref } : {}) }];
  });
}

/** Đoạn tóm tắt hoạt động công cụ của một lượt cũ (trung tính với mọi hãng). */
export function traceText(trace: TraceItem[]): string {
  if (!trace.length) return "";
  const rows = trace.map((t) => `- ${t.label} [${t.name}${t.input ? ` ${t.input}` : ""}] → ${STATUS[t.status]}${t.summary ? `: ${t.summary.replace(/\s+/g, " ")}` : ""}${t.ref ? ` (dữ liệu đầy đủ: ${t.ref}, đọc bằng read_ref)` : ""}`);
  return `<tool_activity>\nỞ lượt này bạn đã dùng công cụ (tóm tắt; chỉ là ghi chép, không cần gọi lại nếu đã đủ thông tin):\n${rows.join("\n")}\n</tool_activity>`;
}

const textOf = (c: CanonMsg["content"]) => (typeof c === "string" ? c : c.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"));
const isEmpty = (c: CanonMsg["content"]) => (typeof c === "string" ? !c.trim() : !c.some((b) => b.type !== "text" || (b.text ?? "").trim()));
const asBlocks = (c: CanonMsg["content"]): Block[] => (typeof c === "string" ? [{ type: "text", text: c }] : c);
function join(a: CanonMsg["content"], b: CanonMsg["content"]): CanonMsg["content"] {
  if (typeof a === "string" && typeof b === "string") return `${a}\n\n${b}`;
  return [...asBlocks(a), ...asBlocks(b)];
}
function append(c: CanonMsg["content"], extra: string): CanonMsg["content"] {
  if (!extra) return c;
  return typeof c === "string" ? `${c}\n\n${extra}` : [...c, { type: "text", text: extra }];
}

export type Prepared = { messages: { role: "user" | "assistant"; content: string | Block[] }[]; historyEnd: number; stats: { artifacts: number; stubbed: number; traces: number; merged: number } };

/**
 * Lịch sử theo chuẩn Synchro → danh sách tin nhắn sẵn sàng chuyển sang định dạng của từng hãng.
 * dynamic: các khối tầng động ghép vào cuối tin nhắn mới nhất (tri thức, bàn trộn ngữ cảnh…).
 * historyEnd: chỉ số tin cuối cùng của phần lịch sử ổn định (đặt điểm đệm prompt ở đây).
 */
export function prepareHistory(raw: unknown, dynamic: string[] = []): Prepared {
  const list = (Array.isArray(raw) ? raw : []).flatMap((m): CanonMsg[] => {
    const o = (m ?? {}) as { role?: unknown; content?: unknown; trace?: unknown };
    const role = o.role === "assistant" || o.role === "ai" ? "assistant" : o.role === "user" ? "user" : null;
    if (!role) return [];
    const content = typeof o.content === "string" ? o.content : Array.isArray(o.content) ? (o.content as Block[]).filter((b) => b && typeof b.type === "string") : "";
    return [{ role, content, trace: role === "assistant" ? cleanTrace(o.trace) : undefined }];
  });
  const stats = { artifacts: 0, stubbed: 0, traces: 0, merged: 0 };
  // 1. Artifact: trạng thái hiện tại từ mọi câu trả lời, rồi thay nội dung cũ bằng thẻ tham chiếu.
  const st = artState(list.filter((m) => m.role === "assistant").map((m) => textOf(m.content)));
  stats.artifacts = st.size;
  const seen = new Map<string, number>();
  const out: CanonMsg[] = list.map((m) => {
    if (m.role !== "assistant") return m;
    let text = textOf(m.content);
    if (st.size && text.includes("<artifact")) { const s = stubArtifacts(text, st, seen); if (s !== text) stats.stubbed++; text = s; }
    // 2. Hoạt động công cụ của lượt cũ.
    const tr = traceText(m.trace ?? []);
    if (tr) stats.traces++;
    return { role: "assistant", content: tr ? `${tr}\n\n${text}` : text };
  });
  // 3. Sửa cấu trúc.
  const fixed: CanonMsg[] = [];
  for (const m of out) {
    if (isEmpty(m.content)) continue;
    const last = fixed[fixed.length - 1];
    if (last && last.role === m.role) { last.content = join(last.content, m.content); stats.merged++; continue; }
    fixed.push({ ...m });
  }
  if (fixed[0]?.role === "assistant") fixed.unshift({ role: "user", content: "(Tiếp tục cuộc trò chuyện trước.)" });
  if (!fixed.length || fixed[fixed.length - 1].role !== "user") fixed.push({ role: "user", content: "(Tiếp tục.)" });
  // 4. Tầng động ở cuối tin nhắn mới nhất.
  const lastUser = fixed[fixed.length - 1];
  const extra = [...dynamic.filter(Boolean), currentArtifactsBlock(st, textOf(lastUser.content))].filter(Boolean).join("\n\n");
  lastUser.content = append(lastUser.content, extra);
  return { messages: fixed.map(({ role, content }) => ({ role, content })), historyEnd: fixed.length - 2, stats };
}
