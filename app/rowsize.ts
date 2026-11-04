// Chiều cao ước tính của một dòng tin trước khi trình duyệt vẽ thật (content-visibility, globals.css). Mức cố định 160px chênh hàng trăm px với
// tin dài nên lần đầu cuộn ngược lên một đoạn chat cũ thanh cuộn giật. Đo xấp xỉ theo cột mặc định 768px; vẽ thật rồi trình duyệt nhớ số đúng ("auto").
const AI = { chars: 92, line: 27, gap: 14, chrome: 44 };
const USER = { chars: 78, line: 24, gap: 0, chrome: 56 };
const CODE_LINE = 21, CODE_CHROME = 56, ART_CARD = 76, FILE_CARD = 64;

const textH = (t: string, k: typeof AI) => {
  let h = 0;
  for (const l of t.split("\n")) h += l.trim() ? Math.max(1, Math.ceil(l.length / k.chars)) * k.line : k.gap;
  return h;
};

export function rowHeight(m: { role: string; text?: string; files?: unknown[]; outs?: unknown[] }): number {
  const k = m.role === "user" ? USER : AI;
  let t = m.text ?? "", h = k.chrome + ((m.files?.length ?? 0) + (m.outs?.length ?? 0)) * FILE_CARD;
  if (m.role !== "user") {
    // Artifact chỉ hiện thành một thẻ; khối code không xuống dòng theo cột.
    t = t.replace(/<artifact\b[\s\S]*?(?:<\/artifact>|$)/g, () => { h += ART_CARD; return "\n"; });
    t = t.replace(/```[\s\S]*?(?:```|$)/g, (b) => { h += CODE_CHROME + b.split("\n").length * CODE_LINE; return "\n"; });
  }
  return Math.round(h + textH(t, k));
}
