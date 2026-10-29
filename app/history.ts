// Lịch sử gửi cho model theo chuẩn Synchro, dùng chung cho lượt chat và bàn trộn ngữ cảnh (để ước tính khớp với lượt thật).
// Câu trả lời kèm dấu vết công cụ; câu trả lời bị dừng ghi rõ là chưa hoàn chỉnh; phần đã nén (compact) không gửi lại.
import type { Chat, Msg } from "./store";
import type { LLMMsg } from "./llm";
import { artBase } from "./vfs";

const STOPPED = { id: "stop", name: "(dừng)", label: "Câu trả lời", input: "", status: "cancelled_by_user" as const, summary: "Người dùng đã bấm Dừng giữa chừng; câu trả lời trên chưa hoàn chỉnh." };

export function chatHistory(msgs: Msg[], compact?: Chat["compact"]): LLMMsg[] {
  const from = compact ? Math.min(Math.max(0, compact.upto), msgs.length) : 0;
  // Câu trả lời bị tách vì người dùng nhắn thêm giữa chừng: phần trước chỉ có lời dẫn (nằm trong nhật ký làm việc).
  const said = (m: Msg) => m.text || (m.parts ?? []).map((p) => (p.k === "say" ? p.text : "")).filter(Boolean).join("\n\n");
  return msgs.slice(from).filter((m) => said(m) || m.stopped || (m.role === "user" && m.files?.length)).map((m): LLMMsg => (m.role === "ai"
    ? { role: "assistant", content: said(m), ...(m.trace?.length || m.stopped ? { trace: [...(m.trace ?? []), ...(m.stopped ? [STOPPED] : [])] } : {}) }
    : { role: "user", content: refs(m) }));
}
// Tệp gửi kèm ở lượt cũ: thẻ tham chiếu (mã tệp trên máy chủ), máy chủ dựng lại nội dung khi gửi cho model (fileproc expandFileRefs).
function refs(m: Msg): LLMMsg["content"] {
  const ids = (m.files ?? []).flatMap((n) => (m.fids?.[n] ? [{ type: "file_ref", id: m.fids[n], name: n }] : []));
  return ids.length ? ([{ type: "text", text: m.text || "Hãy xem các tệp đính kèm." }, ...ids] as unknown as LLMMsg["content"]) : m.text;
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
