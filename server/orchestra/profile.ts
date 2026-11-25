// Hồ sơ năng lực của từng model cho Orchestra: chín thế mạnh chấm 0-10, dùng để giao mỗi nhánh việc cho model hợp nhất.
// Điểm gốc là dữ liệu (bảng theo hạng, theo hãng, theo gói bên dưới), giống cách router.ts chấm chất lượng theo loại
// việc; điểm học được từ kết quả thật (việc qua được bước duyệt hay phải làm lại, lỗi, thời gian chạy) cộng thêm lên
// trên, để model hay hỏng một loại việc tự tụt hạng cho loại việc đó mà không ai phải sửa bảng.
import "server-only";
import { codeOnly } from "../../shared/modelrules";
import { profileOf } from "../router";

export const SKILLS = ["reason", "code", "write_vi", "vision", "search", "longctx", "speed", "cost", "tools"] as const;
export type Skill = (typeof SKILLS)[number];
export type Caps = Record<Skill, number>;
export const isSkill = (x: unknown): x is Skill => typeof x === "string" && (SKILLS as readonly string[]).includes(x);

// Hạng của model (như router.ts): model nhanh rẻ, viết tốt việc ngắn; hạng mạnh nhất suy luận và viết code giỏi nhất
// nhưng chậm, đắt.
const TIER: Record<"fast" | "balanced" | "strong" | "frontier", Caps> = {
  fast: { reason: 5.5, code: 5.5, write_vi: 6.2, vision: 5, search: 5, longctx: 6, speed: 9, cost: 9, tools: 5.5 },
  balanced: { reason: 7, code: 7, write_vi: 7.3, vision: 6, search: 5.5, longctx: 7, speed: 7, cost: 7, tools: 7 },
  strong: { reason: 8.6, code: 8.6, write_vi: 8.4, vision: 6.8, search: 6, longctx: 8, speed: 5, cost: 4, tools: 8.3 },
  frontier: {
    reason: 9.3, code: 9.2, write_vi: 8.8, vision: 7.3, search: 6, longctx: 8.5, speed: 4, cost: 2, tools: 8.8,
  },
};
// Thế mạnh của hãng (cùng tinh thần EDGE của router.ts): Claude viết code và dùng công cụ, GPT suy luận, Gemini đọc ảnh
// và tài liệu dài, Grok và Gemini có dữ liệu mới, DeepSeek rẻ mà code / suy luận khá.
const VENDOR: Record<string, Partial<Caps>> = {
  anthropic: { code: 0.7, tools: 0.6, write_vi: 0.4, reason: 0.2, longctx: 0.2 },
  openai: { reason: 0.7, code: 0.4, tools: 0.3, write_vi: 0.2 },
  google: { vision: 2, longctx: 1.2, search: 0.6, speed: 0.4, write_vi: 0.3, reason: 0.2 },
  xai: { reason: 0.4, search: 0.6, speed: 0.3 },
  deepseek: { code: 0.5, reason: 0.5 },
  other: {},
};
// Gói subscription chạy CLI chính chủ có công cụ tìm web dựng sẵn; lời gọi bằng khóa API của Orchestra là lời gọi một
// lần không công cụ, nên việc tra cứu dữ liệu mới nên về tay gói. Antigravity, Codex chỉ trả chữ khi xong nên chậm hơn
// cảm nhận.
const VIA: Record<string, Partial<Caps>> = {
  claude: { search: 2 }, codex: { search: 2, speed: -0.6 }, agy: { search: 2.4, speed: -1 }, grok: { search: 2.4 },
  api: { search: -1.5 },
};

const clamp = (x: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
const cliOf = (key: string) => /^sub-([a-z]+)\//.exec(key)?.[1] ?? null;

/** Điểm gốc của một model (chưa tính phần học được). */
export function baseCaps(key: string): Caps {
  const p = profileOf(key);
  const t = TIER[p.frontier ? "frontier" : p.tier];
  const v = VENDOR[p.vendor] ?? {};
  const via = VIA[cliOf(key) ?? "api"] ?? {};
  const out = {} as Caps;
  for (const s of SKILLS) out[s] = t[s] + (v[s] ?? 0) + (via[s] ?? 0);
  // Chi phí theo đúng bảng của router (gói đã trả theo tháng rẻ hơn khóa API cùng hạng): 10 là gần như không tốn thêm.
  out.cost = clamp(10 - p.cost * 0.75);
  // Model chỉ viết code (grok-build, codex, coder…) không nhận việc khác.
  if (codeOnly(key)) for (const s of SKILLS) if (s !== "code" && s !== "speed" && s !== "cost") out[s] -= 3;
  for (const s of SKILLS) out[s] = Math.round(clamp(out[s]) * 10) / 10;
  return out;
}

/**
 * Thống kê kết quả thật theo model và thế mạnh: n lần, ok lần qua được (không lỗi, không bị duyệt trả lại), ms tổng
 * thời gian.
 */
export type Stat = { n: number; ok: number; ms: number };
export type Learned = Record<string, Partial<Record<Skill, Stat>>>;

/**
 * Hồ sơ đã cộng phần học được. Tỷ lệ qua dưới 85% kéo điểm xuống (tối đa 2 điểm), cao hơn thì cộng nhẹ (tối đa 0,5):
 * bảng gốc vốn đã xếp model mạnh lên trên, kết quả tốt chỉ xác nhận. Ít mẫu thì nhẹ tay (đủ 10 lần mới tính trọn). Tốc
 * độ tính theo thời gian trung bình thật của các nhánh việc.
 */
export function capsOf(key: string, learned?: Learned): Caps {
  const c = baseCaps(key), l = learned?.[key];
  if (!l) return c;
  let n = 0, ms = 0;
  for (const s of SKILLS) {
    const st = l[s];
    if (!st || !st.n) continue;
    n += st.n; ms += st.ms;
    if (s === "speed" || s === "cost") continue;
    const w = Math.min(1, st.n / 10);
    c[s] = Math.round(clamp(c[s] + clamp((st.ok / st.n - 0.85) * 5, -2, 0.5) * w) * 10) / 10;
  }
  if (n >= 3) {
    const avg = ms / n;
    c.speed = Math.round(clamp(c.speed + (avg < 20_000 ? 0.5 : avg > 180_000 ? -2 : avg > 90_000 ? -1 : 0)) * 10) / 10;
  }
  return c;
}

/**
 * Ghi một kết quả vào bảng học (hàm thuần: trả bảng mới). Giữ tối đa 200 lần gần nhất cho mỗi ô để model đã sửa lỗi
 * được tính lại.
 */
export function noteStat(learned: Learned, key: string, needs: Skill[], ok: boolean, ms: number): Learned {
  const row = { ...(learned[key] ?? {}) };
  for (const s of new Set<Skill>([...needs, "speed"])) {
    const st = row[s] ?? { n: 0, ok: 0, ms: 0 };
    const keep = st.n >= 200 ? 199 / st.n : 1;
    row[s] = {
      n: Math.round(st.n * keep) + 1,
      ok: Math.round(st.ok * keep) + (ok ? 1 : 0),
      ms: Math.round(st.ms * keep) + Math.max(0, ms),
    };
  }
  return { ...learned, [key]: row };
}

/** Điểm hợp việc: trung bình các thế mạnh việc cần. */
export const fitOf = (c: Caps, needs: Skill[]) =>
  (needs.length ? needs.reduce((a, s) => a + c[s], 0) / needs.length : c.reason);
