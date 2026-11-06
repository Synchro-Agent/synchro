// Gọi model như nhau dù người dùng chạy bằng gói subscription hay bằng khóa API: danh sách model dùng được là đúng danh sách
// bộ chọn model đang hiện (nhóm của hãng có gói đã đăng nhập thì là model của gói, không tự chuyển sang khóa API), và lời gọi một lần
// (tóm tắt để đọc to, nén ngữ cảnh, rút bộ nhớ, hội đồng phản biện) chạy qua gói (CLI chính chủ) hoặc qua API tùy model được chọn.
import { canModel, type UserRow } from "../authstore";
import { ALL } from "../catalog";
import { catalog, mainModels, resolveModel } from "../providers";
import { routeModel, sideModel, tierOf, type RouteInput } from "../router";
import { chatOnce, HttpErr } from "../llmcall";
import { overLimit, withUsage } from "../usage";
import { agyOtherBlock, isGeminiId, mergedProviders, subCli, subTurn } from "./subs";

/** allowed: mọi model bộ chọn model hiện cho người này; usable: bỏ gói đang hết hạn mức hoặc cần đăng nhập lại. */
export async function usableModels(user: UserRow) {
  const cat = await catalog(), main = mainModels();
  const shownApi = cat.map((p) => ({ ...p, models: p.models.filter((m) => main.includes(ALL) || main.includes(m.key)) })).filter((p) => p.models.length);
  const merged = await mergedProviders(user, shownApi).catch(() => shownApi);
  const allowed = merged.flatMap((p) => p.models.map((m) => m.key)).filter((k) => !!subCli(k) || canModel(user, k));
  // plansOut: số gói đang hết hạn mức và lúc sớm nhất có gói hồi lại (để báo khi hết cả, không chỉ nêu gói thử sau cùng).
  const plansOut = { count: 0, resets: null as number | null };
  const blocked = new Set(merged.flatMap((p) => {
    const plan = (p as { plan?: { cli?: string; blockedUntil?: number | null; relogin?: boolean } }).plan;
    if (plan?.blockedUntil) { plansOut.count++; plansOut.resets = Math.min(plansOut.resets ?? plan.blockedUntil, plan.blockedUntil); }
    if (plan?.relogin) return p.models.map((m) => m.key);
    // Gói Google: hạn mức đang hết là của nhóm Gemini; model Claude / GPT qua Antigravity tính riêng nên vẫn dùng được.
    // Nhóm Claude / GPT của Antigravity có hạn mức riêng (agyOtherBlock): hết thì bỏ các model đó, nhóm Gemini vẫn dùng được.
    const other = plan?.cli === "agy" && agyOtherBlock(user.id) ? p.models.filter((m) => !isGeminiId(m.id)).map((m) => m.key) : [];
    // Hạn mức riêng của một model (tuần · Opus): chỉ bỏ model đó.
    return [...other, ...p.models.filter((m) => m.blockedUntil).map((m) => m.key), ...(plan?.blockedUntil ? p.models.filter((m) => plan.cli !== "agy" || isGeminiId(m.id)).map((m) => m.key) : [])];
  }));
  const usable = allowed.filter((k) => !blocked.has(k));
  // groups: model dùng được theo nhóm hãng, kèm tên hiện ở bộ chọn model (hộp chọn model của các việc phụ, ví dụ Quét skill rác).
  const groups = merged.map((p) => ({ name: p.name, models: p.models.filter((m) => usable.includes(m.key)).map((m) => ({ key: m.key, name: m.name })) })).filter((g) => g.models.length);
  return { allowed, usable, groups, plansOut };
}

/** Model cho một việc phụ: theo độ khó của việc trong các model dùng được (việc phụ thường chọn được model nhanh, rẻ). */
export async function pickModel(user: UserRow, q: RouteInput, o: { exclude?: (k: string) => boolean } = {}) {
  const { allowed, usable } = await usableModels(user);
  const list = (usable.length ? usable : allowed).filter((k) => !o.exclude?.(k));
  return routeModel(q, list);
}

export class OneShotErr extends Error { constructor(m: string, public status: number) { super(m); } }

// CLI vừa treo hoặc lỗi phía hãng với tài khoản này: chế độ Tự động và việc phụ tránh trong 5 phút (không gói nào khác thì vẫn dùng). Giữ trong bộ nhớ: khởi động lại thì thử lại từ đầu.
// Toàn cục: mỗi route của Next được đóng gói riêng, việc phụ ở route đặt tên phải thấy CLI vừa treo ở lượt chat.
const STALL_MS = 5 * 60_000;
const stalls: Map<string, number> = ((globalThis as { __synchroStalls?: Map<string, number> }).__synchroStalls ??= new Map());
export const noteStall = (uid: string, cli: string) => { if (stalls.size > 5000) stalls.clear(); stalls.set(`${uid}:${cli}`, Date.now() + STALL_MS); };
export const clearStall = (uid: string, cli: string) => { stalls.delete(`${uid}:${cli}`); };
export const stalledModels = (uid: string, models: string[]) => models.filter((k) => { const cli = subCli(k); return !!cli && (stalls.get(`${uid}:${cli}`) ?? 0) > Date.now(); });
/** Việc nền bị bỏ qua vì chỉ còn model mạnh (hạn mức đắt của người dùng): không phải lỗi, lần sau làm lại. */
export const NO_CHEAP = "no cheap model";

/** Một lời gọi không công cụ bằng model key (gói hoặc khóa API). Hạn mức chi phí API chỉ áp cho model khóa API. */
export async function oneShot(user: UserRow, key: string, system: string, messages: { role: "user" | "assistant"; content: string }[], o: { maxTokens?: number; signal?: AbortSignal; feature?: string; job?: string; bg?: boolean } = {}): Promise<string> {
  if (subCli(key)) {
    // Gói: chạy CLI chính chủ một lượt (phiên mới, không gắn đoạn chat nào), mức nỗ lực thấp cho nhanh.
    const r = await subTurn({ user, model: key, system, messages, effort: "low", signal: o.signal, job: o.job ?? o.feature ?? "side", bg: o.bg });
    const j = r.json as { text?: string; error?: string };
    if (r.status !== 200 || typeof j.text !== "string") throw new OneShotErr(j.error ?? "Gói subscription chưa trả lời được.", r.status === 200 ? 502 : r.status);
    return j.text;
  }
  const over = overLimit(user);
  if (over) throw new OneShotErr(over, 429);
  const t = await resolveModel(key);
  if (!t) throw new OneShotErr("Model này không còn dùng được.", 400);
  try {
    return await withUsage(user.id, o.feature ?? "internal", () => chatOnce(t, system, messages, o.maxTokens ?? 1200, o.signal));
  } catch (e) {
    if (e instanceof HttpErr) throw new OneShotErr(e.message, e.status >= 500 ? 502 : e.status);
    throw e;
  }
}

/**
 * Việc phụ: model rẻ nhất dùng được, gọi một lần ở mức nỗ lực thấp. job: tên việc, ghi vào dòng [timing] để phân biệt với lượt chat.
 * bg: việc người dùng không chờ (rút bộ nhớ, chưng cất, đánh giá phiên): xếp hàng sau các việc khác, và không chạy khi chỉ còn model mạnh.
 */
export async function quickCall(user: UserRow, system: string, content: string, o: { maxTokens?: number; signal?: AbortSignal; job?: string; bg?: boolean } = {}) {
  const { allowed, usable } = await usableModels(user);
  const list = usable.length ? usable : allowed;
  const model = sideModel(list, { avoid: stalledModels(user.id, list) });
  if (!model) throw new OneShotErr("Synchro chưa được kết nối với model nào (chưa đăng nhập gói hoặc chưa có khóa API).", 503);
  if (o.bg && tierOf(model) === "strong") throw new OneShotErr(NO_CHEAP, 503);
  const text = await oneShot(user, model, system, [{ role: "user", content }], o);
  return { text, model };
}
