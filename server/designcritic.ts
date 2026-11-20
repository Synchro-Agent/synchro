// Vòng so với mẫu tham chiếu của sản phẩm thiết kế: đo bản vừa dựng (không gọi model), đặt ảnh bản dựng cạnh ảnh mẫu,
// rồi một model có mắt của hãng khác chấm theo ba vai (đúng brief, chất lượng thiết kế, tác động thị giác) và trả danh
// sách chênh lệch có số đo, không chỉ cho điểm. Danh sách đó thành lời nhắc <design_review> cho model dựng sửa, tối đa
// 2 vòng trong 240 giây. Người chấm không bao giờ chạy trên khóa API dùng chung của máy chủ: chỉ gói subscription của
// chính người dùng; không có ai thì model dựng tự chấm theo cùng bảng tiêu chí.
import "server-only";
import type { UserRow } from "./authstore";
import {
  contrastRatio, fontStack, isHex, KIT_FONTS, type Probe, type ProbeText, type StyleMix, type TurnRef,
} from "../shared/designrefs";
import { shadowLevel } from "../shared/designextract";
import { KEEP } from "../shared/turnfold";
import type { DesignFacts } from "./artcheck";
import { billsCredit, tierOf } from "./router";
import { codeOnly, isFrontier } from "../shared/modelrules";
import { vendorOf } from "../shared/vendor";
import { oneShot, stalledModels, usableModels } from "./ai/anymodel";
import { subCli } from "./ai/subs";
import { seesImages } from "./visioncaps";

export const DIFF_PROPS = [
  "tracking", "shadow", "radius", "contrast", "empty-area", "hierarchy", "font", "image", "color", "layout", "copy",
  "brief",
] as const;
export type DiffProp = (typeof DIFF_PROPS)[number];
export type Severity = "high" | "medium" | "low";
export type Diff = {
  where: string; property: DiffProp; measured: string; target: string; fix: string; severity: Severity; by?: string;
};
export type Critique = { brief: Diff[]; quality: Diff[]; impact: Diff[]; keep: string[] };
/** Trần của cả vòng so với mẫu trong một lượt, và của một lần gọi người chấm. */
export const GATE_MS = 240_000;
export const CRITIC_MS = 90_000;
export const MAX_ROUNDS = 2;

const em = (n: number) => `${Math.round(n * 1000) / 1000}em`;
const px = (n: number) => `${Math.round(n)}px`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
/** Cỡ chữ thân: cỡ có nhiều chữ nhất trong các dòng nhỏ hơn 24px. */
function bodySize(texts: ProbeText[]): number {
  const by = new Map<number, number>();
  for (const t of texts) if (t.size < 24) by.set(Math.round(t.size), (by.get(Math.round(t.size)) ?? 0) + t.chars);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;
}

export type MeasureOpts = { hero: boolean; deck: boolean };
/**
 * Chênh lệch đo được giữa bản dựng và bộ token trộn, kèm con số. probe null (bộ đo token chưa có, trang lỗi): chỉ còn
 * các mục của DESIGN_FACTS (phông đã tải, hình chủ đạo, mảng trống). mix null (lượt không có mẫu): chỉ lỗi cứng.
 */
export function measuredDiffs(
  probe: Probe | null, facts: DesignFacts | null, mix: StyleMix | null, o: MeasureOpts,
): Diff[] {
  const out: Diff[] = [];
  const add = (d: Omit<Diff, "where" | "by"> & { where?: string }) => {
    out.push({ where: "Khung đầu", by: "Synchro", ...d });
  };
  for (const f of facts?.fonts ?? []) {
    const kit = kitFontByFamily(f.family);
    if (!kit) {
      add({ property: "font", measured: f.family, target: "phông trong bộ của Synchro", severity: "medium",
        fix: `Đổi "${f.family}" sang một phông trong bộ (khối token trộn đã chọn sẵn), không nạp phông ngoài.` });
    } else if (!f.loaded) {
      add({ property: "font", measured: `${f.family} chưa tải (đang hiện phông dự phòng)`, target: `${f.family} đã tải`,
        severity: "high",
        fix: `Dùng đúng font-family: ${fontStack(kit)} và để bộ CSS tự nạp; không tự viết @font-face.` });
    }
  }
  if (o.hero && facts && !facts.hero.marked && !facts.hero.shader && facts.media < 0.25) {
    add({ property: "image", measured: `hình chiếm ${pct(facts.media)} khung đầu`, target: "hình chủ đạo ≥ 25%",
      severity: "high",
      fix: "Thêm một hình chủ đạo lớn ở khung đầu (ảnh, nền shader hoặc minh họa SVG) và đặt data-sx-hero." });
  }
  if (facts) {
    const empty = 1 - facts.content;
    const allowed = Math.min(0.9, 0.4 + (mix?.tokens.layout.emptyShare ?? 0));
    if (o.deck && facts.content < 0.45) {
      add({ property: "empty-area", measured: `nội dung ${pct(facts.content)} khung`, target: "≥ 45%",
        severity: "medium", fix: "Phóng hình, thêm hình chủ đạo hoặc dàn lại bố cục để không bỏ trống nửa khung." });
    } else if (!o.deck && empty > allowed) {
      add({ property: "empty-area", measured: `trống ${pct(empty)} khung đầu`, target: `≤ ${pct(allowed)}`,
        severity: "medium", fix: "Khoảng trống không chủ ý: lấp bằng hình, phóng tiêu đề hoặc thu khoảng cách." });
    }
  }
  if (!probe) return out;
  for (const t of probe.texts) {
    if (!isHex(t.color) || !isHex(t.bg)) continue;
    const need = t.size >= 24 ? 3 : 4.5, got = contrastRatio(t.color, t.bg);
    if (got >= need) continue;
    add({ where: `chữ ${t.tag} ${px(t.size)}`, property: "contrast", measured: `${got.toFixed(2)}:1`,
      target: `${need}:1`, severity: "high", fix: `Đổi màu chữ ${t.color} trên nền ${t.bg} cho đạt ${need}:1.` });
    break;
  }
  if (!mix) return out;
  const T = mix.tokens;
  const big = [...probe.texts].sort((a, b) => b.size - a.size)[0];
  if (big && big.size >= 38 && Math.abs(big.tracking - T.tracking.display) > 0.01) {
    add({ where: `tiêu đề ${px(big.size)}`, property: "tracking", measured: em(big.tracking),
      target: em(T.tracking.display), severity: "medium",
      fix: `letter-spacing: var(--sx-track-display) (${em(T.tracking.display)}) cho tiêu đề lớn.` });
  }
  const shadows = probe.boxes.map((b) => shadowLevel(b.shadow));
  const lvl = shadows.length ? Math.max(...shadows) : 0;
  if (Math.abs(lvl - T.shadow.level) >= 1) {
    add({ property: "shadow", measured: `mức ${lvl}`, target: `mức ${T.shadow.level}`, severity: "medium",
      fix: `box-shadow: var(--sx-shadow) cho thẻ (${T.shadow.css || "không bóng"}).` });
  }
  const radii = probe.boxes.map((b) => b.radius).filter((r) => r < 999);
  const r0 = radii.length ? median(radii) : 0;
  if (radii.length && Math.abs(r0 - T.radius.outer) > 4) {
    add({ property: "radius", measured: px(r0), target: px(T.radius.outer), severity: "medium",
      fix: `border-radius: calc(var(--sx-r) * 1px) cho thẻ ngoài, var(--sx-ri) cho phần tử trong.` });
  }
  if (T.radius.pill && !probe.boxes.some((b) => b.radius >= Math.min(999, b.h / 2))) {
    add({ property: "radius", measured: "nút vuông góc", target: "nút bo tròn hẳn", severity: "low",
      fix: "Nút và nhãn bo tròn hẳn (border-radius: 999px) như mẫu hình khối." });
  }
  const base = bodySize(probe.texts);
  const top = Math.max(...(T.type.sizes.length ? T.type.sizes : [T.type.basePx * T.type.ratio ** 3]));
  const want = top / (T.type.basePx || 16);
  if (big && big.size / base < 0.7 * want) {
    add({ property: "hierarchy", measured: `tiêu đề / thân = ${(big.size / base).toFixed(1)}`,
      target: `≈ ${want.toFixed(1)}`,
      severity: "medium", fix: "Tăng cỡ tiêu đề theo thang của khối token trộn, rút chữ thân." });
  }
  return out;
}
const kitFontByFamily = (family: string) =>
  KIT_FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase())?.id;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Có phải sửa không: một chênh lệch mức cao, hoặc từ 3 chênh lệch mức vừa. */
export const needsFix = (ds: Diff[]) =>
  ds.some((d) => d.severity === "high") || ds.filter((d) => d.severity === "medium").length >= 3;
const HARD = new Set<DiffProp>(["font", "image", "contrast"]);
/** Lỗi cứng: vẫn sửa cả khi model dựng chạy trên khóa dùng chung (không có người chấm, tối đa một vòng). */
export const hardOnly = (ds: Diff[]) =>
  ds.filter((d) => d.severity === "high" && HARD.has(d.property));

// ---------------------------------------------------------------- bảng so sánh
const W = 1600, H = 1000, PAD = 12, LABEL = 26;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Nhãn vẽ trên bảng so sánh, cho người chấm và model dựng đọc (không phải chữ giao diện).
const SHEET_PROMPT = { first: "Bản dựng: khung đầu", later: "Bản dựng: khung sau", one: "Bản dựng" };
/**
 * Bảng so sánh 1600×1000 (JPEG): hàng trên là khung đầu của bản dựng | mẫu chính, hàng dưới là khung sau của bản dựng |
 * hai mẫu còn lại. Người chấm và model dựng cùng nhìn một ảnh.
 */
export async function compareSheet(views: Buffer[], refs: { label: string; jpeg: Buffer }[]): Promise<Buffer | null> {
  const sharp = await import("sharp").then((m) => m.default).catch((e) => {
    console.warn(`[designcritic] không nạp được sharp: ${(e as Error).message}`);
    return null;
  });
  if (!sharp || !views.length) return null;
  const cw = (W - PAD * 3) / 2, ch = (H - PAD * 3) / 2 - LABEL;
  const cells: { img: Buffer; label: string; x: number; y: number; w: number }[] = [];
  const at = (col: number, row: number) => ({ x: PAD + col * (cw + PAD), y: PAD + row * (ch + LABEL + PAD) });
  cells.push({ img: views[0], label: SHEET_PROMPT.first, ...at(0, 0), w: cw });
  if (refs[0]) cells.push({ img: refs[0].jpeg, label: refs[0].label, ...at(1, 0), w: cw });
  const later = views[1] ? SHEET_PROMPT.later : SHEET_PROMPT.one;
  cells.push({ img: views[1] ?? views[0], label: later, ...at(0, 1), w: cw });
  const rest = refs.slice(1, 3), half = (cw - PAD) / 2;
  rest.forEach((r, i) => {
    const w = rest.length > 1 ? half : cw;
    cells.push({ img: r.jpeg, label: r.label, x: at(1, 1).x + i * (half + PAD), y: at(1, 1).y, w });
  });
  const layers = await Promise.all(cells.map(async (c) => {
    const w = Math.round(c.w), h = Math.round(ch);
    const input = await sharp(c.img).resize(w, h, { fit: "contain", background: "#ffffff" })
      .jpeg({ quality: 82 }).toBuffer();
    return { input, left: Math.round(c.x), top: Math.round(c.y + LABEL) };
  }));
  // Chữ 16 px đậm rộng chừng 9 px mỗi ký tự: nhãn dài cắt cho vừa ô, không chờm sang ảnh bên cạnh. Ghi chú trong
  // ngoặc (dành cho model ở tin nhắn) bỏ trước, để ô nhỏ vẫn còn tên mẫu.
  const fit = (label: string, w: number) => {
    const max = Math.max(8, Math.floor(w / 9));
    const short = label.length > max ? label.replace(/\s*\([^)]*\)/, "") : label;
    return short.length > max ? `${short.slice(0, max - 1)}…` : short;
  };
  const labels = cells.map((c) => {
    const text = xml(fit(c.label, c.w));
    return `<text x="${Math.round(c.x)}" y="${Math.round(c.y + 19)}">${text}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<style>text{font:600 16px "Noto Sans",DejaVu Sans,Arial,sans-serif;fill:#1b1b1b}</style>${labels}</svg>`);
  return sharp({ create: { width: W, height: H, channels: 3, background: "#d9d9d9" } })
    .composite([...layers, { input: svg, left: 0, top: 0 }]).jpeg({ quality: 78 }).toBuffer();
}

// ---------------------------------------------------------------- người chấm
const LEVEL = (k: string) => (isFrontier(k) ? 3 : tierOf(k) === "strong" ? 2 : tierOf(k) === "balanced" ? 1 : 0);
/**
 * Người chấm cho bản dựng của builderKey: model nhìn được ảnh của gói subscription người dùng đã đăng nhập (không bao
 * giờ là khóa API dùng chung, không model tính tiền ngoài gói), khác hãng trước, hạng cao trước. Antigravity xếp sau
 * trong cùng hạng: nó chỉ xem ảnh khi tự mở tệp. null: không có ai, model dựng tự chấm.
 */
export async function pickDesignCritic(user: UserRow, builderKey: string): Promise<string | null> {
  const { usable } = await usableModels(user);
  return orderCritics(usable, builderKey, { sees: seesImages, stalled: stalledModels(user.id, usable) })[0] ?? null;
}
/** Thứ tự người chấm trong các model dùng được (phần thuần của pickDesignCritic, kiểm thử không cần DB). */
export type CriticOpts = { sees: (k: string) => boolean; stalled?: string[] };
export function orderCritics(keys: string[], builderKey: string, o: CriticOpts): string[] {
  const stalled = new Set(o.stalled ?? []);
  const usable = (k: string) => !!subCli(k) && !stalled.has(k) && !billsCredit(k) && !codeOnly(k) && o.sees(k);
  const fits = keys.filter((k) => k !== builderKey && usable(k));
  const own = vendorOf(builderKey);
  const rank = (k: string) => [vendorOf(k) === own ? 1 : 0, -LEVEL(k), subCli(k) === "agy" ? 1 : 0];
  return fits.sort((a, b) => rank(a).reduce((d, v, i) => d || v - rank(b)[i], 0));
}

const ROLES = [
  "Ba vai, mỗi vai một danh sách:",
  "- brief (đúng brief): từng yêu cầu của đề bài đã làm đủ, đúng chưa (nội dung, kích thước, số phần, ràng buộc"
    + ' như "không ảnh AI").',
  "- quality (chất lượng thiết kế): giãn chữ, thứ bậc, lưới, khoảng cách, bo góc, bóng, màu, tương phản so với mẫu"
    + " tham chiếu.",
  "- impact (tác động thị giác): có điểm nhìn chính không, ảnh thu nhỏ 200 px còn đọc được không, có đạt tầm chất"
    + " lượng của mẫu mà không chép mẫu không.",
].join("\n");
const DIFF_SHAPE = '{"where":"chỗ nào","property":"' + DIFF_PROPS.join("|") + '",'
  + '"measured":"đang là","target":"nên là","fix":"cách sửa ngắn, làm được ngay trong HTML/CSS",'
  + '"severity":"high|medium|low"}';
export const CRITIC_SYSTEM = [
  "Bạn là giám khảo thiết kế khó tính. Ảnh đi kèm: bên trái là bản dựng, bên phải là mẫu tham chiếu (chỉ để so"
    + " nguyên tắc, không bắt chép).",
  ROLES,
  `Mỗi mục là một chênh lệch cụ thể có số đo: ${DIFF_SHAPE}.`,
  "Chỉ nêu điều thấy được trên ảnh hoặc trong đề bài; không có thì để danh sách rỗng. Tối đa 6 mục mỗi vai.",
  'Chỉ trả về đúng một đối tượng JSON: {"brief":[…],"quality":[…],"impact":[…],"keep":["điều đã tốt, nên giữ"]}.'
    + " Không viết gì ngoài JSON.",
].join("\n");

const asDiff = (x: unknown, by: string): Diff | null => {
  const o = (x ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 240) : "");
  const property = (DIFF_PROPS as readonly string[]).includes(s("property")) ? (s("property") as DiffProp) : "layout";
  const severity = (["high", "medium", "low"] as const).find((v) => v === s("severity")) ?? "low";
  if (!s("fix") && !s("measured")) return null;
  const where = s("where") || "Bản dựng";
  return { where, property, measured: s("measured"), target: s("target"), fix: s("fix"), severity, by };
};
/** Đọc JSON của người chấm (chấp nhận chữ thừa quanh JSON, khối ```json). null: không đọc được, giao bản hiện tại. */
export function parseCritique(text: string, by: string): Critique | null {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[designcritic] JSON của người chấm không hợp lệ: ${(e as Error).message}`);
    return null;
  }
  const arr = (k: string) => (Array.isArray(j[k]) ? (j[k] as unknown[]).slice(0, 6) : []);
  const list = (k: string) => arr(k).flatMap((x) => asDiff(x, by) ?? []);
  const keep = arr("keep").filter((x): x is string => typeof x === "string");
  return { brief: list("brief"), quality: list("quality"), impact: list("impact"), keep };
}

export type CritiqueIn = { brief: string; sheet: Buffer; diffs: Diff[]; refs: TurnRef[]; signal?: AbortSignal };
/** Một lời gọi người chấm (≤ CRITIC_MS). null khi lỗi, quá giờ hay trả lời không đọc được: nơi gọi giao bản hiện
 *  tại. */
export async function critiqueDesign(user: UserRow, key: string, i: CritiqueIn): Promise<Critique | null> {
  const rows = i.diffs.map((d) => `- ${d.where}: ${d.property} ${d.measured} → ${d.target}`);
  const measured = rows.length ? `Synchro đã đo được (đưa vào quality nếu bạn đồng ý):\n${rows.join("\n")}` : "";
  const refs = i.refs.map((r, k) => `Mẫu ${k + 1}: ${r.title}`).join("\n");
  const text = [`Đề bài:\n${i.brief.slice(0, 3000)}`, refs, measured].filter(Boolean).join("\n\n");
  const signal = AbortSignal.any([AbortSignal.timeout(CRITIC_MS), ...(i.signal ? [i.signal] : [])]);
  try {
    const out = await oneShot(user, key, CRITIC_SYSTEM, [{ role: "user", content: [
      { type: "text", text }, { type: "image", media_type: "image/jpeg", data: i.sheet.toString("base64") },
    ] }], { maxTokens: 1800, signal, job: "design-critic", maxWaitMs: CRITIC_MS });
    return parseCritique(out, key);
  } catch (e) {
    console.warn(`[designcritic] người chấm ${key} không trả lời được: ${(e as Error).message}`);
    return null;
  }
}

const SEV: Record<Severity, string> = { high: "cao", medium: "vừa", low: "thấp" };
const line = (d: Diff) => `- [${SEV[d.severity]}] ${d.where} · ${d.property}: ${d.measured}`
  + `${d.target ? ` → ${d.target}` : ""}.${d.fix ? ` Sửa: ${d.fix}` : ""}`;
export type ReviewIn = {
  round: number; max: number; diffs: Diff[]; keep: string[]; self: boolean; refs: boolean; mix: string | null;
};
/** Lời nhắc gửi model dựng sau vòng chấm (người dùng không thấy); câu trả lời trước được giữ (tools.ts holdAnswer). */
export function DESIGN_REVIEW(i: ReviewIn): string {
  const order = (["high", "medium", "low"] as const).flatMap((s) => i.diffs.filter((d) => d.severity === s));
  const look = i.refs ? "ảnh đi kèm: trái là bản dựng, phải là mẫu tham chiếu" : "ảnh đi kèm là bản dựng";
  const self = "Không có người chấm khác: tự xem ảnh đi kèm và chấm theo ba vai trên, rồi sửa cả những điểm dưới đây.";
  const keepMix = i.mix ? `; giữ khối <style data-sx-mix="${i.mix}">` : "";
  return [
    `<design_review round="${i.round}/${i.max}">`,
    `Synchro đã chụp bản vừa dựng (${look}) và chấm theo ba vai: đúng brief, chất lượng thiết kế, tác động thị giác.`,
    "Người dùng không thấy tin nhắn này. Câu trả lời bạn vừa viết được giữ nguyên và giao cho họ; lần trả lời này chỉ"
      + " để sửa artifact.",
    i.self ? self : "",
    "Chênh lệch cần sửa:",
    ...order.slice(0, 14).map(line),
    i.keep.length ? `Đã tốt, giữ nguyên: ${i.keep.join("; ")}.` : "",
    `- Sửa được: trả về artifact cùng identifier (bản sửa mode="patch" được), sửa đúng các điểm trên${keepMix}.`,
    "- Điểm nào không sửa được hoặc cố ý: viết một dòng ngắn \"Còn chưa đạt: …\" sau artifact.",
    `- Mọi điểm đều cố ý: chỉ trả lời đúng ${KEEP}, không viết gì thêm.`,
    "</design_review>",
  ].filter(Boolean).join("\n");
}
