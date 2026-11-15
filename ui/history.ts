// Lịch sử gửi cho model theo chuẩn Synchro, dùng chung cho lượt chat và bàn trộn ngữ cảnh (để ước tính khớp với lượt thật).
// Câu trả lời kèm dấu vết công cụ; câu trả lời bị dừng ghi rõ là chưa hoàn chỉnh; phần đã nén (compact) không gửi lại.
// Lượt lỗi (failed) không gửi: câu báo lỗi không phải lời của model, model từng đọc nó như câu trả lời của chính mình.
import type { Chat, Msg } from "./store";
import type { LLMMsg } from "./llm";
import { artBase } from "../shared/vfs";
import { stripAppliedNotes } from "../shared/turnctx";

const STOPPED = { id: "stop", name: "(dừng)", label: "Câu trả lời", input: "", status: "cancelled_by_user" as const, summary: "Người dùng đã bấm Dừng giữa chừng; câu trả lời trên chưa hoàn chỉnh." };

const CUT = { id: "cut", name: "(ngắt)", label: "Câu trả lời", input: "", status: "error" as const, summary: "Câu trả lời trên bị ngắt giữa chừng vì lỗi của model; chưa hoàn chỉnh." };

export function chatHistory(msgs: Msg[], compact?: Chat["compact"]): LLMMsg[] {
  const from = compact ? Math.min(Math.max(0, compact.upto), msgs.length) : 0;
  // Câu trả lời bị tách vì người dùng nhắn thêm giữa chừng: phần trước chỉ có lời dẫn (nằm trong nhật ký làm việc).
  // Câu trả lời cũ còn dòng "Đã áp dụng hướng dẫn của bạn: “…”": không gửi lại cho model (model thấy thì bắt chước, trích lại hướng dẫn cá nhân).
  const said = (m: Msg) => (m.role === "ai" ? stripAppliedNotes(m.text) : m.text) || (m.parts ?? []).map((p) => (p.k === "say" ? p.text : "")).filter(Boolean).join("\n\n");
  // Tin chỉ là lời báo lỗi (hết hạn mức, treo…) không phải câu trả lời của model: không gửi lại. Có giữ được phần đã viết thì ghi rõ là chưa xong.
  // Lượt bị ngắt (hết hạn mức…) trước khi viết được chữ nào nhưng đã chạy công cụ: lời báo lỗi vẫn không gửi, chỉ gửi dấu vết công cụ kèm ghi chú
  // "bị ngắt" để lượt "Thử lại / Tiếp tục" làm tiếp từ những gì đã tra cứu thay vì làm lại từ đầu.
  const cutWork = (m: Msg) => m.role === "ai" && !!m.failed && !m.notice?.partial && !!m.trace?.length;
  return msgs.slice(from).filter((m) => cutWork(m) || (!m.notice?.failed && (!m.failed || m.notice?.partial) && (said(m) || m.stopped || (m.role === "user" && m.files?.length)))).map((m): LLMMsg => (cutWork(m)
    ? { role: "assistant", content: "", trace: [...(m.trace ?? []), CUT] }
    : m.role === "ai"
    ? { role: "assistant", content: said(m), ...(m.trace?.length || m.stopped || m.notice?.partial ? { trace: [...(m.trace ?? []), ...(m.stopped ? [STOPPED] : []), ...(m.notice?.partial ? [CUT] : [])] } : {}) }
    : { role: "user", content: refs(m) }));
}
/** Lượt lỗi đã làm được một phần (đã viết dở, đã chạy công cụ, đã tạo tệp): "Thử lại" làm tiếp từ đó thay vì gửi lại câu hỏi từ đầu. */
export function continuable(m?: Msg): boolean {
  return !!m && m.role === "ai" && !!m.failed && !!(m.notice?.partial || m.notice?.work || m.trace?.length || m.outs?.length);
}
// Tệp gửi kèm ở lượt cũ: thẻ tham chiếu (mã tệp trên máy chủ), máy chủ dựng lại nội dung khi gửi cho model (fileproc expandFileRefs).
function refs(m: Msg): LLMMsg["content"] {
  const ids = (m.files ?? []).flatMap((n) => (m.fids?.[n] ? [{ type: "file_ref", id: m.fids[n], name: n }] : []));
  return ids.length ? ([{ type: "text", text: m.text || "Hãy xem các tệp đính kèm." }, ...ids] as unknown as LLMMsg["content"]) : m.text || (m.files?.length ? "Hãy xem các tệp đính kèm." : "");
}

/** Phần thêm vào yêu cầu theo bàn trộn của đoạn chat: khối tắt, số tin gửi, tóm tắt đã nén, tài liệu ghim. */
export function mixExtra(c?: Chat): Record<string, unknown> {
  if (!c) return {};
  return {
    ...(c.mixer ? { mixer: c.mixer } : {}),
    // Phần đã nén không gửi lại: gửi kèm bản hiện tại của artifact trong phần đó để bản sửa phía sau áp đúng.
    ...(c.compact?.text ? { summary: c.compact.text, artBase: artBase(c.msgs.slice(0, c.compact.upto).filter((m) => m.role === "ai").map((m) => m.text)) } : {}),
    ...(c.pins?.length ? { pinned: c.pins.map((p) => ({ name: p.name, text: p.text })) } : {}),
  };
}
