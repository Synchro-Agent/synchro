// Đội hình model ở bộ chọn model: mỗi hãng chỉ hiện vài bậc đang dùng (nhẹ → chuẩn → khó), như ứng dụng
// của chính hãng, thay vì mọi model gói hay khóa API trả về. Dùng chung cho trình duyệt và kiểm thử; chế độ
// Tự động ở máy chủ vẫn chọn trên cả danh mục.
//  - Mỗi hãng có các ô (slot) theo bậc; dòng model vào ô theo chữ trong mã ("haiku", "luna", "hydrogen"…).
//  - Mỗi ô giữ một model, xét lần lượt: người dùng dùng được (không khóa, không hết hạn mức) trước; dòng chính
//    của bậc (Luna, Hydrogen…) trước dòng phụ cùng ô (mini, flash…), dòng phụ trước dòng lạ chỉ vào ô theo
//    hạng chung; rồi số phiên bản; rồi thứ tự chữ trong ô (Neon đứng trước Argon); rồi ngày ra mắt / lần đầu
//    thấy. Không dựa vào thứ tự hãng liệt kê: API Gemini không xếp theo đời và sổ model có thể ghi cùng một
//    ngày cho mọi model của một lần đọc. Model mới vì thế THAY model cùng ô, không xếp thêm vào cuối;
//    "mới" thôi không đủ để được hiện.
//  - Dòng model lạ của một hãng đã biết chỉ vào ô theo hạng chung (tierOf ở shared/modelrules.ts) khi ô đó
//    không có dòng nào có tên: một bản phụ không tên ("gpt-7") không được đẩy dòng chính ra.
//  - Model còn lại (đời cũ, bản phụ, model điều phối…) vẫn chọn được qua "Xem tất cả model"; model đang
//    chọn luôn hiện.
import { vendorOf } from "./catalog";
import { codeOnly, compareModels, OPEN_WEIGHT, parseId, tierOf, versionCmp, type Tier } from "./modelrules";

export type LineupModel = { key: string; id: string; name: string; since?: number; blockedUntil?: number };
/**
 * words: dòng chính của bậc, theo thứ tự ưu tiên khi cùng phiên bản (tên đời mới đứng trước);
 * alt: dòng phụ cùng bậc, chỉ thắng khi không có dòng chính; base: dòng chính không có chữ chỉ bậc (Grok);
 * tier: hạng chung, dùng cho dòng model lạ của hãng.
 */
type Slot = { id: string; words: string[]; alt?: string[]; base?: boolean; tier?: Tier };
/** hide: dòng đã biết nhưng không thuộc đội hình chính của hãng (chỉ hiện ở "Xem tất cả model"). */
type VendorLineup = { slots: Slot[]; hide?: string[] };

// Thứ tự ô là thứ tự hiện, từ việc nhẹ đến việc khó. Chỉ sửa khi hãng đổi cách đặt tên bậc;
// đời mới của một dòng đã có thì tự thay bản cũ.
export const LINEUPS: Record<string, VendorLineup> = {
  anthropic: { slots: [
    { id: "light", words: ["haiku"], tier: "fast" },
    { id: "standard", words: ["sonnet"], tier: "balanced" },
    { id: "hard", words: ["opus"], tier: "strong" },
    { id: "frontier", words: ["fable", "mythos"] },
  ] },
  // Terra là bản phụ giữa các bậc, ứng dụng của hãng không đưa vào đội hình chính.
  openai: { slots: [
    { id: "light", words: ["luna"], alt: ["mini", "nano"], tier: "fast" },
    { id: "standard", words: ["sol"], tier: "balanced" },
    { id: "hard", words: ["astra"], alt: ["pro"], tier: "strong" },
  ], hide: ["terra"] },
  // Đời 4: Hydrogen (nhẹ), Neon thay Argon (chuẩn), Carbon (khó). Flash / Pro đời trước là dòng phụ cùng ô.
  google: { slots: [
    { id: "light", words: ["hydrogen"], alt: ["flash", "lite"], tier: "fast" },
    { id: "standard", words: ["neon", "argon"], tier: "balanced" },
    { id: "hard", words: ["carbon"], alt: ["pro", "ultra"], tier: "strong" },
  ] },
  xai: { slots: [
    { id: "light", words: ["fast", "mini"], tier: "fast" },
    { id: "standard", words: [], base: true, tier: "balanced" },
    { id: "heavy", words: ["heavy"], tier: "strong" },
  ] },
  deepseek: { slots: [
    { id: "light", words: ["flash"], tier: "fast" },
    { id: "standard", words: ["chat"], tier: "balanced" },
    { id: "hard", words: ["pro", "reasoner"], tier: "strong" },
  ] },
};
/** Ô của model chỉ viết code (grok-build, codex…): chỉ có ở Synchro Code, đứng cuối. */
const CODE_SLOT = "code";
// Tên hãng đứng đầu mã và chữ chỉ cách chạy (không phải bậc) bị bỏ khi xếp ô:
// "grok-4.20-reasoning" là dòng chính của Grok, "claude-opus-4-6-thinking" vẫn là Opus.
const PREFIX = new Set(["claude", "gpt", "gemini", "grok", "deepseek"]);
const QUALIFIERS = new Set(["reasoning", "non", "thinking", "multi", "agent"]);
// Bản phụ cho một việc riêng (bảo mật, tắt suy luận, nhiều tác tử) của mọi hãng: cùng bậc nhưng không phải
// bản ứng dụng của hãng đưa ra cho việc chung, nên chỉ ở "Xem tất cả model".
const SIDE = ["cyber", "non-reasoning", "multi-agent"];
// Model điều phối của gói Gemini không phải một bậc trả lời: chỉ ở "Xem tất cả model".
const NOT_LINEUP = /orchestrator/i;
// Hạng của cách vào ô: dòng chính, dòng phụ, dòng lạ vào theo hạng chung.
const MAIN = 0, ALT = 1, BY_TIER = 2;

/**
 * Hãng thật của một mã model theo tên (model Claude / GPT mà gói Google cung cấp kèm qua Antigravity).
 * "open": model mã nguồn mở (GPT-OSS, Llama…), không thuộc đội hình hãng nào. Không nhận ra thì null.
 */
export function realVendor(id: string): string | null {
  const s = id.toLowerCase().split("/").pop() ?? "";
  if (OPEN_WEIGHT.test(s)) return "open";
  if (/^claude-/.test(s)) return "anthropic";
  if (/^(gpt-|chatgpt|o\d)/.test(s)) return "openai";
  if (/^gemini-/.test(s)) return "google";
  if (/^grok-/.test(s)) return "xai";
  if (/^deepseek-/.test(s)) return "deepseek";
  return null;
}

type Place = { slot: string; via: number; word: number };
/** Ô của một model trong đội hình hãng và cách nó vào ô; null khi chỉ hiện ở "Xem tất cả model". */
function placeOf(m: { key: string; id: string; name?: string }, vendor: string, code: boolean): Place | null {
  const t = LINEUPS[vendor];
  if (!t) return null;
  const p = parseId(m.id);
  if (p.alias || NOT_LINEUP.test(m.id) || NOT_LINEUP.test(m.name ?? "")) return null;
  if (codeOnly(m.key)) return code ? { slot: CODE_SLOT, via: MAIN, word: 0 } : null;
  const fam = `-${p.family}-`;
  if ([...SIDE, ...(t.hide ?? [])].some((h) => fam.includes(`-${h}-`))) return null;
  const words = p.family.split("-").filter((w) => w && !PREFIX.has(w) && !QUALIFIERS.has(w));
  for (const [via, of] of [[MAIN, (s: Slot) => s.words], [ALT, (s: Slot) => s.alt ?? []]] as const) {
    for (const s of t.slots) {
      const word = of(s).findIndex((w) => words.includes(w));
      if (word >= 0) return { slot: s.id, via, word };
    }
  }
  const base = words.length ? null : t.slots.find((s) => s.base);
  if (base) return { slot: base.id, via: MAIN, word: 0 };
  const tier = tierOf(m.key);
  const s = t.slots.find((x) => x.tier === tier);
  return s ? { slot: s.id, via: BY_TIER, word: 0 } : null;
}
/** Ô của một model trong đội hình hãng, hoặc null khi chỉ hiện ở "Xem tất cả model". code: ở Synchro Code. */
export const slotOf = (m: { key: string; id: string; name?: string }, vendor: string, code = false) =>
  placeOf(m, vendor, code)?.slot ?? null;

const order = (vendor: string, slot: string) =>
  (slot === CODE_SLOT ? 99 : LINEUPS[vendor]?.slots.findIndex((s) => s.id === slot) ?? 0);

type At<T> = { m: T; i: number };
type Cand<T> = At<T> & { p: Place; use: number };
/** Bản giữ ô của mỗi ô (thứ tự xét ở đầu tệp), xếp theo thứ tự ô; phần còn lại trả về riêng. */
function pick<T extends LineupModel>(list: At<T>[], vendor: string, code: boolean, ok: (k: string) => boolean) {
  const since = new Map(list.map(({ m }) => [m.key, m.since ?? null]));
  // 0: dùng được ngay; 1: hết hạn mức (tạm thời); 2: quản trị viên chưa cho phép.
  const access = (m: T) => (!ok(m.key) ? 2 : m.blockedUntil ? 1 : 0);
  const better = (a: Cand<T>, b: Cand<T>) =>
    (b.use - a.use) || (b.p.via - a.p.via) || versionCmp(parseId(a.m.id).version, parseId(b.m.id).version)
    || (b.p.word - a.p.word) || compareModels(a.m.key, b.m.key, (k) => since.get(k) ?? null) || (b.i - a.i);
  const best = new Map<string, Cand<T>>();
  const rest: At<T>[] = [];
  for (const x of list) {
    const p = placeOf(x.m, vendor, code);
    if (!p) { rest.push(x); continue; }
    const c = { ...x, p, use: access(x.m) };
    const cur = best.get(p.slot);
    if (!cur) { best.set(p.slot, c); continue; }
    if (better(c, cur) > 0) { rest.push(cur); best.set(p.slot, c); } else rest.push(x);
  }
  const main = [...best.entries()].sort((a, b) => order(vendor, a[0]) - order(vendor, b[0])).map(([, x]) => x);
  return { main, rest };
}

export type Lineup<T> = { main: T[]; via: T[]; rest: T[] };
/**
 * selected: model đang chọn (chat cũ ghim vào model đời trước) luôn ở danh sách chính.
 * code: đang ở Synchro Code (thêm ô model chỉ viết code).
 * ownPlans: các hãng người dùng có gói riêng.
 * kind: loại nhà cung cấp của nhóm (khóa API thứ hai của cùng hãng có mã nhóm khác tên hãng).
 * ok: người dùng được phép dùng model này không (quản trị viên giới hạn model); không có thì coi như được.
 */
export type LineupOpts = {
  selected?: string; code?: boolean; ownPlans?: Set<string>; kind?: string; ok?: (key: string) => boolean;
};
/**
 * Đội hình một nhóm model của bộ chọn (một hãng): main (đội hình), via (model hãng khác đi kèm gói),
 * rest (chỉ ở "Xem tất cả model", theo thứ tự hãng liệt kê).
 * Model hãng khác đi kèm gói (Claude qua Antigravity) chỉ được tách thành mục riêng khi người dùng không có
 * gói của chính hãng đó: đó là cách duy nhất của họ để dùng hãng ấy. Có gói rồi thì nó chỉ làm danh sách dài thêm.
 * Hãng chưa có đội hình (nhà cung cấp tương thích OpenAI…) thì hiện đủ như trước.
 */
export function lineup<T extends LineupModel>(models: T[], o: LineupOpts = {}): Lineup<T> {
  const vendor = o.kind && LINEUPS[o.kind] ? o.kind : models[0] ? vendorOf(models[0].key) : "";
  if (!LINEUPS[vendor]) return { main: [...models], via: [], rest: [] };
  const own: At<T>[] = [], rest: At<T>[] = [], foreign = new Map<string, At<T>[]>();
  models.forEach((m, i) => {
    const rv = realVendor(m.id) ?? vendor;
    if (rv === vendor) own.push({ m, i });
    else if (rv === "open" || !LINEUPS[rv] || o.ownPlans?.has(rv)) rest.push({ m, i });
    else foreign.set(rv, [...(foreign.get(rv) ?? []), { m, i }]);
  });
  const ok = o.ok ?? (() => true);
  const mine = pick(own, vendor, !!o.code, ok);
  rest.push(...mine.rest);
  const via: At<T>[] = [];
  for (const [rv, list] of foreign) {
    const r = pick(list, rv, !!o.code, ok);
    via.push(...r.main);
    rest.push(...r.rest);
  }
  const main = mine.main.map((x) => x.m), viaM = via.map((x) => x.m);
  const restM = rest.sort((a, b) => a.i - b.i).map((x) => x.m);
  const sel = restM.find((m) => m.key === o.selected);
  if (!sel) return { main, via: viaM, rest: restM };
  const others = restM.filter((m) => m !== sel);
  // Model hãng khác đang có mục riêng (Claude đời trước qua Antigravity) đứng trong mục đó, không lẫn vào
  // đội hình của hãng chính.
  if (foreign.has(realVendor(sel.id) ?? vendor)) return { main, via: [...viaM, sel], rest: others };
  return { main: [...main, sel], via: viaM, rest: others };
}
