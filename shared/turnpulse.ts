// Tiến độ của lượt mà CLI chỉ in chữ một lần lúc xong (Antigravity ở chế độ -p): tài khoản miễn phí từng chờ bộ slide
// hơn 4 phút chỉ với dòng "vẫn đang viết, đã N giây". Những gì Synchro đã biết thì nói ra: bước đang làm trong danh
// sách việc (update_plan qua cầu nối), artifact đã nhận ở các lần trả lời trước của lượt (bản đang chờ sửa sau bước tự
// kiểm). Hàm thuần, dịch ở i18n-dict.

export type PulsePlan = { content: string; status: string }[];
const ART = /<artifact\b([^>]*)>([\s\S]*?)(?:<\/artifact>|$)/gi;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * "bước 2/4: Dựng slide · đã nhận “Hồ sơ gọi vốn”, 23.410 ký tự"; rỗng khi chưa biết gì. texts: chữ đã nhận trong lượt.
 */
export function turnPulse(plan: PulsePlan | undefined, texts: string[]): string {
  const bits: string[] = [];
  const items = (plan ?? []).filter((i) => i.content.trim());
  const cur = items.findIndex((i) => i.status === "in_progress");
  const done = items.filter((i) => i.status === "completed").length;
  if (cur >= 0) bits.push(`bước ${cur + 1}/${items.length}: ${clip(items[cur].content.trim(), 60)}`);
  else if (items.length) bits.push(`xong ${done}/${items.length} việc`);
  let chars = 0, title = "";
  for (const t of texts) {
    for (const m of t.matchAll(ART)) {
      chars += m[2].length;
      title = /\btitle\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] ?? title;
    }
  }
  if (chars && title) bits.push(`đã nhận “${clip(title, 40)}”, ${num(chars)} ký tự`);
  else if (chars) bits.push(`đã nhận ${num(chars)} ký tự artifact`);
  return bits.join(" · ");
}
