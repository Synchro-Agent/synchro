// Gọi model như nhau dù người dùng chạy bằng gói subscription hay bằng khóa API: danh sách model dùng được là đúng danh sách
// bộ chọn model đang hiện (nhóm của hãng có gói đã đăng nhập thì là model của gói, không tự chuyển sang khóa API), và lời gọi một lần
// (tóm tắt để đọc to, nén ngữ cảnh, rút bộ nhớ, hội đồng phản biện) chạy qua gói (CLI chính chủ) hoặc qua API tùy model được chọn.
import { canModel, type UserRow } from "../authstore";
import { ALL } from "../catalog";
import { catalog, mainModels, resolveModel } from "../providers";
import { routeModel, type RouteInput } from "../router";
import { chatOnce, HttpErr } from "../llmcall";
import { overLimit, withUsage } from "../usage";
import { isGeminiId, mergedProviders, subCli, subTurn } from "./subs";

/** allowed: mọi model bộ chọn model hiện cho người này; usable: bỏ gói đang hết hạn mức hoặc cần đăng nhập lại. */
export async function usableModels(user: UserRow) {
  const cat = await catalog(), main = mainModels();
  const shownApi = cat.map((p) => ({ ...p, models: p.models.filter((m) => main.includes(ALL) || main.includes(m.key)) })).filter((p) => p.models.length);
  const merged = await mergedProviders(user, shownApi).catch(() => shownApi);
  const allowed = merged.flatMap((p) => p.models.map((m) => m.key)).filter((k) => !!subCli(k) || canModel(user, k));
  const blocked = new Set(merged.flatMap((p) => {
    const plan = (p as { plan?: { cli?: string; blockedUntil?: number | null; relogin?: boolean } }).plan;
    if (plan?.relogin) return p.models.map((m) => m.key);
    // Gói Google: hạn mức đang hết là của nhóm Gemini; model Claude / GPT qua Antigravity tính riêng nên vẫn dùng được.
    return plan?.blockedUntil ? p.models.filter((m) => plan.cli !== "agy" || isGeminiId(m.id)).map((m) => m.key) : [];
  }));
  const usable = allowed.filter((k) => !blocked.has(k));
  // groups: model dùng được theo nhóm hãng, kèm tên hiện ở bộ chọn model (hộp chọn model của các việc phụ, ví dụ Quét skill rác).
  const groups = merged.map((p) => ({ name: p.name, models: p.models.filter((m) => usable.includes(m.key)).map((m) => ({ key: m.key, name: m.name })) })).filter((g) => g.models.length);
  return { allowed, usable, groups };
}

/** Model cho một việc phụ: theo độ khó của việc trong các model dùng được (việc phụ thường chọn được model nhanh, rẻ). */
export async function pickModel(user: UserRow, q: RouteInput, o: { exclude?: (k: string) => boolean } = {}) {
  const { allowed, usable } = await usableModels(user);
  const list = (usable.length ? usable : allowed).filter((k) => !o.exclude?.(k));
  return routeModel(q, list);
}

export class OneShotErr extends Error { constructor(m: string, public status: number) { super(m); } }

/** Một lời gọi không công cụ bằng model key (gói hoặc khóa API). Hạn mức chi phí API chỉ áp cho model khóa API. */
export async function oneShot(user: UserRow, key: string, system: string, messages: { role: "user" | "assistant"; content: string }[], o: { maxTokens?: number; signal?: AbortSignal; feature?: string } = {}): Promise<string> {
  if (subCli(key)) {
    // Gói: chạy CLI chính chủ một lượt (phiên mới, không gắn đoạn chat nào), mức nỗ lực thấp cho nhanh.
    const r = await subTurn({ user, model: key, system, messages, effort: "low", signal: o.signal });
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

/** Việc phụ nhanh (tóm tắt, rút ý): chọn model nhanh nhất dùng được rồi gọi một lần. */
export async function quickCall(user: UserRow, system: string, content: string, o: { maxTokens?: number; signal?: AbortSignal } = {}) {
  const pick = await pickModel(user, { text: "tóm tắt", attachments: 0, turns: 1, studio: false });
  if (!pick) throw new OneShotErr("Synchro chưa được kết nối với model nào (chưa đăng nhập gói hoặc chưa có khóa API).", 503);
  const text = await oneShot(user, pick.model, system, [{ role: "user", content }], o);
  return { text, model: pick.model };
}
