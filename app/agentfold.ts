// Gộp sự kiện agent vào một lượt của phiên Code. Dùng chung ở trình duyệt (vẽ dần) và máy chủ (lưu lượt khi trình duyệt đã đi chỗ khác),
// để hai bên ra cùng một kết quả. Không có tác dụng phụ nào ở đây.
import type { AgentEvent } from "./agentcore";

type Step = Record<string, unknown> & { k: string };
export type FoldNode = { ai?: string; steps?: unknown[]; plan?: unknown; usage?: { input: number; output: number }; skills?: string[] };

const WARN = "⚠️ ";
// Lời báo của hệ thống nằm chung với chữ của model trong .ai-msg nên bộ dịch trang bỏ qua, phải tự dịch lúc hiện. Lưu bằng chữ gốc: tin cũ đổi ngôn ngữ vẫn đúng.
export const localizeNote = (text: string, t: (s: string) => string) => (text.startsWith(WARN) ? WARN + t(text.slice(WARN.length)) : text);

const addText = <T extends FoldNode>(n: T, text: string): T => ({ ...n, steps: [...(n.steps ?? []), { k: "text", text }], ai: n.ai ? `${n.ai}\n\n${text}` : text });

export function foldAgentEvent<T extends FoldNode>(n: T, e: AgentEvent): T {
  const steps = (n.steps ?? []) as Step[];
  switch (e.t) {
    case "text": return addText(n, e.text);
    case "think": return { ...n, steps: [...steps, { k: "think", text: e.text }] };
    case "ask": return { ...n, steps: [...steps, { k: "ask", id: e.id, kind: e.kind, title: e.title, detail: e.detail, host: e.host, state: "wait" }] };
    case "asked": return { ...n, steps: steps.map((x) => (x.k === "ask" && x.id === e.id ? { ...x, state: e.ok ? (e.always ? "always" : "ok") : "no" } : x)) };
    case "tool": return { ...n, steps: [...steps, { k: "tool", id: e.id, name: e.name, input: e.input }] };
    case "result": return { ...n, steps: steps.map((x) => (x.k === "tool" && x.id === e.id ? { ...x, done: true, ok: e.ok, summary: e.summary, output: e.output, diff: e.diff, image: e.image } : x)) };
    case "plan": return { ...n, plan: e.items };
    case "usage": return { ...n, usage: { input: e.input, output: (n.usage?.output ?? 0) + e.output } };
    case "steer": return { ...n, steps: [...steps, { k: "steer", text: e.text }] };
    case "done": return e.skills.length ? { ...n, skills: e.skills } : n;
    case "error": return addText(n, WARN + e.error);
    default: return n;
  }
}

/** Lượt chết cùng máy chủ (khởi động lại giữa chừng), không ai báo kết thúc: phải hiện là đã dừng kèm lý do, không được trông như đã xong. */
export const interruptFolded = <T extends FoldNode>(n: T, why: string): T & { done: true; stopped: true } => ({ ...closeFolded(foldAgentEvent(n, { t: "error", error: why })), done: true, stopped: true });

/** Lượt đã kết thúc: công cụ dở coi như xong, câu hỏi duyệt không còn chờ. */
export const closeFolded = <T extends FoldNode>(n: T): T => ({ ...n, steps: ((n.steps ?? []) as Step[]).map((x) => (x.k === "tool" && !x.done ? { ...x, done: true } : x.k === "ask" && x.state === "wait" ? { ...x, state: "gone" } : x)) });
