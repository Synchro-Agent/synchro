// Giao việc cho từng thành viên của Orchestra: chọn trưởng nhóm, quản lý, rồi mỗi nhánh việc cho model hợp nhất trong
// các model người dùng đang dùng được. Hàm thuần (danh sách model và hồ sơ năng lực truyền vào) để kiểm thử không cần
// máy chủ. Nguyên tắc: việc nặng, khó cho model lớn; việc nhỏ (kiểm tra, tra cứu, định dạng…) cho model rẻ giỏi đúng
// loại đó, để model lớn không tốn token vào chúng mà chất lượng vẫn giữ được nhờ bước duyệt. Gói subscription đã trả
// tiền đứng trước khóa API (khóa API thường là khóa chung của máy chủ); gói sắp hết hạn mức chỉ nhận việc khi không còn
// ai khác.
import "server-only";
import { fitOf, type Caps, type Skill } from "./profile";
import type { PlanTask, Size } from "./plan";
import type { OrchRole } from "../../shared/orchestra";

/**
 * Một model dùng được trong lượt này. cli: gói nào (null là khóa API); usdPer1k: tiền ước tính mỗi 1.000 token (gói thì
 * 0); low: gói đang gần chạm hạn mức (phần còn lại dành cho tin nhắn của chính người dùng); level: hạng 0 nhanh, 1 cân
 * bằng, 2 mạnh, 3 mạnh nhất.
 */
export type Member = {
  key: string; vendor: string; cli: string | null; level: number; caps: Caps; usdPer1k: number; low: boolean;
  credit: boolean; codeOnly: boolean; steady: boolean;
};
export type Team = { boss: string; manager: string };
export type Assignment = { model: string; alt: string[] };

const NEED: Record<Exclude<OrchRole, "boss">, Record<Size, number>> = {
  manager: { s: 7.5, m: 8, l: 8.5 },
  staff: { s: 6, m: 7, l: 8.2 },
  intern: { s: 5, m: 5.5, l: 6 },
};
// Trọng số chi phí theo vai trò: việc thực tập phải rẻ, việc của quản lý cần chất lượng hơn tiền.
const COST_W: Record<Exclude<OrchRole, "boss">, number> = { manager: 0.15, staff: 0.35, intern: 0.6 };

// Thế mạnh hiếm: model yếu hẳn ở đây thì gần như không làm được nhánh cần nó, dù điểm chung cao.
const RARE = new Set<Skill>(["vision", "search", "longctx"]);

/** Model không bao giờ tự nhận việc: tính tiền thật ngoài gói (usage credits). */
const usable = (m: Member) => !m.credit;

/**
 * Trưởng nhóm: model bộ định tuyến đã chọn cho lượt này (prefer) khi nó đủ mạnh, vì câu trả lời cuối vẫn do nó viết như
 * khi không chia việc, nên Orchestra không làm câu trả lời cuối đắt hơn và vẫn theo mọi luật chọn model sẵn có (gói
 * trước khóa API, hạn mức, chi phí). Phải thay thì gói trước khóa API: model định tuyến chạy trên gói mà không gói nào
 * khác đủ sức thì giữ chính nó, không đẩy câu trả lời cuối (nỗ lực "cao") sang khóa API chung. Khóa API chỉ khi lượt
 * vốn đã chạy bằng khóa API, và khi đó model rẻ nhất đủ hạng đứng trước model mạnh nhất.
 * Quản lý: model hạng cân bằng / mạnh khác trưởng nhóm, ưu tiên hãng khác để bước duyệt nhìn bằng con mắt khác; gói
 * trước khóa API theo cùng luật đó; không có ai thì trưởng nhóm tự duyệt.
 */
export function pickTeam(pool: Member[], prefer?: string): Team | null {
  const all = pool.filter((m) => usable(m) && !m.codeOnly);
  if (!all.length) return null;
  const head = (m: Member) => (m.caps.reason + m.caps.code + m.caps.write_vi) / 3;
  const steady = all.some((m) => m.steady) ? all.filter((m) => m.steady) : all;
  const routedM = all.find((m) => m.key === prefer);
  const strong = (m: Member) => m.level >= 1 && !m.low;
  // Gói: mạnh nhất (không tốn thêm tiền). Khóa API: rẻ nhất trong các model đủ hạng (từ cân bằng trở lên, đúng ngưỡng
  // model định tuyến được giữ làm trưởng nhóm), vì câu trả lời cuối chạy nỗ lực "cao" trên khóa chung.
  const best = (list: Member[]) => [...list].sort((a, b) => (a.cli
    ? b.level - a.level || head(b) - head(a)
    : a.usdPer1k - b.usdPer1k || b.level - a.level || head(b) - head(a)))[0];
  const apiOk = !routedM?.cli;
  const boss = (routedM && strong(routedM) ? routedM : undefined)
    ?? best(steady.filter((m) => strong(m) && !!m.cli))
    ?? (apiOk ? best(steady.filter((m) => strong(m) && !m.cli)) : undefined)
    ?? routedM
    ?? [...steady].sort((a, b) => Number(!a.cli) - Number(!b.cli) || Number(a.low) - Number(b.low)
      || b.level - a.level || head(b) - head(a))[0];
  const others = all.filter((m) => m.key !== boss.key && m.level >= 1);
  const plans = others.filter((m) => m.cli && !m.low);
  // Trưởng nhóm chạy trên gói mà không còn gói nào khác duyệt được: tự duyệt, không gọi khóa API chung chỉ để duyệt.
  const reviewers = plans.length ? plans : boss.cli ? [] : others;
  const mgr = reviewers
    .map((m) => {
      const mid = m.level === 1 || m.level === 2 ? 0.6 : 0, otherVendor = m.vendor !== boss.vendor ? 0.5 : 0;
      return { m, s: head(m) + mid + otherVendor + (m.cli ? 0.4 : 0) - (m.low ? 1.5 : 0) + 0.15 * m.caps.cost };
    })
    .sort((a, b) => b.s - a.s)[0]?.m;
  return { boss: boss.key, manager: mgr?.key ?? boss.key };
}

/**
 * Điểm của một model cho một nhánh việc; load: số nhánh model này đã nhận trong cùng tầng (chia đều để chạy song song).
 */
export function scoreFor(m: Member, t: TaskShape, team: Team, load: number): number {
  const fit = fitOf(m.caps, t.needs);
  const need = NEED[t.role][t.size];
  let s = fit + COST_W[t.role] * m.caps.cost + 0.1 * m.caps.speed + (m.cli ? 0.6 : 0) - load;
  if (fit < need) s -= (need - fit) * 2;
  if (m.low) s -= 1.5;
  // Trưởng nhóm giữ sức cho câu trả lời cuối: chỉ nhận việc nặng của quản lý hoặc nhánh lớn khi không ai đủ sức.
  if (m.key === team.boss && !(t.size === "l" && t.role !== "intern")) s -= 2;
  // Việc thực tập giao cho model hạng trên là phí: trừ theo hạng.
  if (t.role === "intern") s -= 0.6 * m.level;
  // Việc cần thế mạnh hiếm (đọc ảnh, tài liệu dài, tìm web) mà model yếu hẳn ở đó: gần như loại.
  for (const k of t.needs) if (RARE.has(k) && m.caps[k] < 5.5) s -= 3;
  return s;
}
type TaskShape = Pick<PlanTask, "needs" | "role" | "size">;

/**
 * Gói này làm được nhánh này: đủ điểm cho vai và cỡ việc, không yếu hẳn ở thế mạnh hiếm việc cần, chưa gần hết hạn
 * mức.
 */
const planCan = (m: Member, t: TaskShape) => !!m.cli && !m.low && fitOf(m.caps, t.needs) >= NEED[t.role][t.size]
  && t.needs.every((k) => !RARE.has(k) || m.caps[k] >= 5.5);

/**
 * Giao từng nhánh: theo tầng (nhánh cùng tầng chạy song song nên chia cho nhiều model hơn), mỗi nhánh một model chính
 * và tối đa hai model dự phòng (ưu tiên gói / hãng khác model chính, để lỗi của một gói không kéo cả ba lần thử cùng
 * hỏng). Gói đã trả tiền trước: có gói làm được nhánh này thì model khóa API (thường là khóa chung của máy chủ) không
 * vào danh sách, kể cả dự phòng; khóa API chỉ nhận nhánh không gói nào làm được.
 */
export function assign(tasks: PlanTask[], order: string[][], pool: Member[], team: Team): Record<string, Assignment> {
  const fits = (t: PlanTask) => pool.filter((m) => usable(m) && (!m.codeOnly || t.needs.includes("code")));
  const out: Record<string, Assignment> = {};
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const layer of order) {
    const load = new Map<string, number>();
    for (const id of layer) {
      const t = byId.get(id)!;
      const all = fits(t).length ? fits(t) : pool.filter(usable);
      const cands = all.some((m) => planCan(m, t)) ? all.filter((m) => m.cli) : all;
      const ranked = cands.map((m) => ({ m, s: scoreFor(m, t, team, load.get(m.key) ?? 0) })).sort((a, b) => b.s - a.s);
      if (!ranked.length) continue;
      const pick = ranked[0].m;
      load.set(pick.key, (load.get(pick.key) ?? 0) + 1);
      const rest = ranked.slice(1).map((x) => x.m);
      const other = (m: Member) => (m.cli ?? `api:${m.vendor}`) !== (pick.cli ?? `api:${pick.vendor}`);
      const alt = [...rest.filter(other), ...rest.filter((m) => !other(m))].slice(0, 2).map((m) => m.key);
      out[id] = { model: pick.key, alt };
    }
  }
  return out;
}

/** Thế mạnh hiếm trong yêu cầu mà không model nào của người dùng có (để trưởng nhóm biết khi lập kế hoạch). */
export const missing = (pool: Member[], skills: Skill[]) =>
  skills.filter((s) => !pool.some((m) => usable(m) && m.caps[s] >= 6.5));
