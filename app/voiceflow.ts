// Giọng nói hai luồng: nói ngay một câu xác nhận ngắn, việc chính (model chat có công cụ) chạy song song,
// xong thì đọc bản tóm tắt vài câu thay vì đọc nguyên câu trả lời dài; bản đầy đủ nằm trong khung chat.

export const VI = /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i;
export type Lang = "vi" | "en";

// Bỏ artifact, Markdown và khối code trước khi đọc, rồi chia câu để trình duyệt đọc trọn câu dài.
export function toSpeech(md: string) {
  const plain = md.replace(/<!--[\s\S]*?(-->|$)/g, " ").replace(/<artifact\b[\s\S]*?(<\/artifact>|$)/g, " ").replace(/```[\s\S]*?(```|$)/g, " ").replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ")
    // Dòng kẻ của bảng, đường kẻ ngang, dấu đầu dòng: đọc lên chỉ là ký hiệu. Hết ô bảng hay hết dòng thì ngắt câu để giọng đọc nghỉ.
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, " ").replace(/^\s*[-+*]\s+/gm, " ").replace(/^\s*(#{1,6}\s+)(.+)$/gm, "$2.").replace(/^\s*\|\s*/gm, "").replace(/\s*\|\s*(?=\S)/g, ", ")
    .replace(/[*_~]+/g, "").replace(/[#>|]+/g, " ").replace(/\s+/g, " ").replace(/^[\s,]+/, "").trim();
  const parts = plain.match(/[^.!?。…]+[.!?。…]*\s*/g) ?? [plain];
  const out: string[] = [];
  for (const s of parts) { if (out.length && (out[out.length - 1] + s).length < 180) out[out.length - 1] += s; else out.push(s); }
  return out.filter((x) => x.trim());
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
// Lời nhờ làm việc (cần công cụ, tạo sản phẩm, tra cứu): xác nhận ngay. Câu hỏi ngắn thì chỉ xác nhận khi trả lời lâu.
const TASK = /\b(lam|tao|viet|soan|lap|tim|tra cuu|tra giup|phan tich|tom tat|so sanh|dich|tinh toan|thiet ke|kiem tra|liet ke|ke hoach|doc giup|gui|xuat|bao cao|make|create|write|draft|find|search|look up|analy[sz]e|summari[sz]e|compare|translate|calculate|build|design|plan|list|check|report)\b/;
const ACK: Record<Lang, string[]> = {
  vi: ["Được, để mình xem nhé.", "Ừ, mình làm ngay đây.", "Để mình tìm hiểu một chút nhé.", "Được rồi, bạn đợi mình một lát."],
  en: ["Sure, give me a moment.", "On it.", "Let me look into that."],
};
export const ACK_DELAY = 1200;
let turn = 0;
export function ackPlan(q: string, hint?: Lang): { lang: Lang; text: string; now: boolean } {
  const lang: Lang = VI.test(q) ? "vi" : hint ?? (/[a-z]/i.test(q) ? "en" : "vi");
  const now = TASK.test(fold(q)) || q.trim().split(/\s+/).length >= 14;
  const list = ACK[lang];
  return { lang, now, text: list[turn++ % list.length] };
}

// Câu trả lời ngắn, chỉ có chữ: đọc nguyên văn. Có sản phẩm, code, bảng, ảnh hoặc dài: đọc bản tóm tắt.
const RICH = /```|<artifact\b|^\s*\|.+\|\s*$|!\[[^\]]*\]\(/m;
export function spokenPlan(md: string): "direct" | "brief" {
  return !RICH.test(md) && toSpeech(md).join(" ").length <= 320 ? "direct" : "brief";
}
// Dự phòng khi không tóm tắt được bằng model: vài câu đầu và một câu nhắc xem chi tiết trong khung chat.
export function localBrief(md: string, lang: Lang): string {
  let out = "";
  for (const s of toSpeech(md).join(" ").match(/[^.!?。…]+[.!?。…]*\s*/g) ?? []) { if ((out + s).length > 220 && out) break; out += s; }
  return `${out.trim()}${out.trim() ? " " : ""}${lang === "en" ? "The details are in the chat." : "Chi tiết mình để trong khung chat."}`;
}
