// Gọi model như nhau dù người dùng chạy bằng gói subscription hay bằng khóa API: danh sách model dùng được là đúng danh sách
// bộ chọn model đang hiện (nhóm của hãng có gói đã đăng nhập thì là model của gói, không tự chuyển sang khóa API), và lời gọi một lần
// (tóm tắt để đọc to, nén ngữ cảnh, rút bộ nhớ, hội đồng phản biện) chạy qua gói (CLI chính chủ) hoặc qua API tùy model được chọn.
import "server-only";
import { canModel, type UserRow } from "../authstore";
import { ALL } from "../../shared/catalog";
import { catalog, mainModels, resolveModel } from "../providers";
import { billsCredit, hasCheapSide, routeModel, sideModel, tierOf, type RouteInput } from "../router";
import { chatOnce, HttpErr } from "../llmcall";
import { overLimit, withUsage } from "../usage";
import { agyOtherBlock, BUSY, helperRoom, isGeminiId, mergedProviders, subCli, subTurn } from "./subs";
import { THROTTLED_JOBS } from "./helperquota";

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
/** Việc nền chưa chạy được lúc này (model rẻ đang tạm hết hạn mức, hết phần việc nền của giờ này): không phải lỗi, lần sau làm lại. */
export const NO_CHEAP = "no cheap model";
// Tài khoản không hề có model rẻ (chỉ gói Grok, gói chỉ còn hạng mạnh): chờ model rẻ thì không bao giờ tới, bộ nhớ và bộ não ngừng hẳn mà không ai biết.
// Vẫn chạy trên model rẻ nhất của họ ở nỗ lực thấp, nhưng thưa hơn: mỗi giờ tối đa chừng này lời gọi, vì đây là hạn mức đắt của chính họ. Toàn cục vì mỗi route của Next được đóng gói riêng.
const strongBg: Map<string, { n: number; until: number }> = ((globalThis as { __synchroStrongBg?: Map<string, { n: number; until: number }> }).__synchroStrongBg ??= new Map());
const strongBudget = (uid: string) => {
  const now = Date.now(), max = Number(process.env.SYNCHRO_BG_STRONG_PER_HOUR) || 6;
  if (strongBg.size > 5000) strongBg.clear();
  const h = strongBg.get(uid);
  if (!h || h.until < now) { strongBg.set(uid, { n: 1, until: now + 3600_000 }); return true; }
  return h.n < max && !!++h.n;
};

/** Một lời gọi không công cụ bằng model key (gói hoặc khóa API). Hạn mức chi phí API chỉ áp cho model khóa API. */
export async function oneShot(user: UserRow, key: string, system: string, messages: { role: "user" | "assistant"; content: string }[], o: { maxTokens?: number; signal?: AbortSignal; feature?: string; job?: string; bg?: boolean; maxWaitMs?: number } = {}): Promise<string> {
  const cli = subCli(key);
  if (cli) {
    // Việc phụ tự động trên gói của người dùng: gói sắp chạm giới hạn hoặc hết ngân sách việc phụ của hôm nay thì để lần sau (NO_CHEAP),
    // phần còn lại của gói dành cho tin nhắn của chính họ (helperquota.ts).
    if (o.job && THROTTLED_JOBS.has(o.job) && !helperRoom(user.id, cli).ok) throw new OneShotErr(NO_CHEAP, 503);
    // Gói: chạy CLI chính chủ một lượt (phiên mới, không gắn đoạn chat nào), mức nỗ lực thấp cho nhanh.
    const r = await subTurn({ user, model: key, system, messages, effort: "low", signal: o.signal, job: o.job ?? o.feature ?? "side", bg: o.bg, maxWaitMs: o.maxWaitMs });
    const j = r.json as { text?: string; error?: string };
    if (r.status !== 200 || typeof j.text !== "string") throw new OneShotErr(j.error ?? "Gói subscription chưa trả lời được.", r.status === 200 ? 502 : r.status);
    return j.text;
  }
  const over = overLimit(user, "task");
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
 * bg: việc người dùng không chờ (rút bộ nhớ, chưng cất, đánh giá phiên): xếp hàng sau các việc khác. Còn model rẻ mà đang tạm hết hạn mức thì để lần sau; tài khoản không có model rẻ nào thì chạy thưa hơn.
 */
export async function quickCall(user: UserRow, system: string, content: string, o: { maxTokens?: number; signal?: AbortSignal; job?: string; bg?: boolean; maxWaitMs?: number; planOk?: boolean } = {}) {
  const { allowed, usable } = await usableModels(user);
  const list = usable.length ? usable : allowed;
  const model = sideModel(list, { avoid: stalledModels(user.id, list) });
  if (!model) throw new OneShotErr("Synchro chưa được kết nối với model nào (chưa đăng nhập gói hoặc chưa có khóa API).", 503);
  // planOk: false — việc này không đáng một lượt của gói người dùng lúc này (memory.ts: câu không tự nói về mình): model rẻ nhất là của gói
  // thì bỏ, để lần chưng cất đoạn chat của bộ não gom lại sau. Không chuyển sang khóa API: với tài khoản thường đó là khóa chung của máy chủ
  // (tiền thật của máy chủ, và tính vào hạn mức chi phí API của chính người dùng cho một việc họ không yêu cầu).
  if (o.planOk === false && subCli(model)) throw new OneShotErr(NO_CHEAP, 503);
  if (o.bg && (billsCredit(model) || (tierOf(model) === "strong" && (hasCheapSide(allowed) || !strongBudget(user.id))))) throw new OneShotErr(NO_CHEAP, 503);
  // Hàng việc nền đầy hoặc chờ quá lâu cũng chỉ là "chưa tới lượt": không được tính là một lần học thất bại.
  const text = await oneShot(user, model, system, [{ role: "user", content }], o).catch((e) => { throw o.bg && e instanceof OneShotErr && e.message === BUSY ? new OneShotErr(NO_CHEAP, 503) : e; });
  return { text, model };
}
