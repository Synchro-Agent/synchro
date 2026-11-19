import { handle, requireUser } from "../../../server/authstore";
import { usageState } from "../../../server/usage";
import { isGeminiId, mergedProviders, subCli, subUsage, SUB } from "../../../server/ai/subs";
import { nextAutoModel } from "../../../server/ai/anymodel";
import { vendorOf } from "../../../server/router";
import { AGY_GROUPS, apiPct, planPct, type NextSource, type WinLite } from "../../../shared/usagenext";
import { ALL } from "../../../shared/catalog";
import { catalog, mainModels } from "../../../server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DeepSeek chỉ có khóa API (không có gói đăng nhập).
const VENDORS = [["anthropic", "claude"], ["openai", "codex"], ["google", "agy"], ["xai", "grok"], ["deepseek", null]] as const;

// Mức dùng của tài khoản: giới hạn phiên 5 giờ, giới hạn tuần, hạn mức gọi API và số dư API đã nạp của nhà cung cấp đang chọn (?provider=anthropic).
// Model của gói subscription (?provider=sub-claude): kèm hạn mức của gói (phiên 5 giờ, tuần) do CLI báo về.
// ?all=1: từng hãng (Claude, ChatGPT, Gemini, Grok, DeepSeek) tự nhận đang chạy bằng gói đã đăng nhập hay khóa API, kèm hạn mức tương ứng
// (chế độ Tự động và Cài đặt → Usage), kèm next: nguồn sẽ chạy lượt kế tiếp của chế độ Tự động (null: không còn nguồn
// nào).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams, p = q.get("provider"), fresh = q.get("fresh") === "1", idle = q.get("idle") === "1";
  if (q.get("all") === "1") {
    const main = mainModels();
    const api = (await catalog()).map((x) => ({ ...x, models: main.includes(ALL) ? x.models : x.models.filter((m) => main.includes(m.key)) })).filter((x) => x.models.length);
    const merged = await mergedProviders(user, api).catch(() => api);
    const vendors = await Promise.all(VENDORS.map(async ([vendor, cli]) => {
      const g = merged.find((x) => x.kind === vendor && cli && (x.source === "plan" || x.plan?.cli === cli)) ?? merged.find((x) => x.kind === vendor);
      const base = { vendor, cli, name: cli ? SUB[cli].name : "DeepSeek", models: g?.models.length ?? 0 };
      if (g?.source === "plan" && cli) return { ...base, mode: "plan" as const, provider: null, sub: await subUsage(user, cli, { fresh, idle }) };
      if (g) {
        const st = usageState(user, g.id);
        // Gói đã đăng nhập nhưng người dùng đồng ý tạm dùng khóa API (gói hết hạn mức): báo kèm hạn mức của gói.
        return { ...base, mode: "api" as const, provider: g.id, rate: st.rate, credit: st.credit, usingApiUntil: g.plan?.usingApiUntil ?? null, sub: g.plan && cli ? await subUsage(user, cli) : undefined };
      }
      return { ...base, mode: "none" as const, provider: null };
    }));
    const st = usageState(user);
    // Không tính được thì bỏ trống (vòng tròn hiện như trước), không trả null: null nghĩa là đã hết mọi nguồn và vòng
    // tròn tô đỏ.
    const pick = await nextAutoModel(user).then((m) => ({ m }), (e: Error) => {
      console.warn(`[usage] không tính được nguồn của lượt kế tiếp: ${e.message}`);
      return null;
    });
    const next = pick ? nextSource(pick.m, vendors, st.limits) : undefined;
    return Response.json({ ...st, vendors, next }, { headers: { "cache-control": "no-store" } });
  }
  const provider = p && /^[a-z0-9-]{1,40}$/.test(p) ? p : undefined;
  const cli = provider ? subCli(`${provider}/x`) : null;
  const st = usageState(user, cli ? undefined : provider);
  return Response.json(cli ? { ...st, sub: await subUsage(user, cli, { fresh, idle }) } : st, { headers: { "cache-control": "no-store" } });
});

type VendorRow = {
  vendor: string; cli: string | null; mode: "plan" | "api" | "none"; provider: string | null;
  sub?: { windows: WinLite[] }; rate?: { pct: number } | null; credit?: { pct: number } | null;
};
type LimitRow = { pct: number; limit: number | null };
/**
 * Nguồn của model Tự động sẽ chọn và phần trăm đã dùng của đúng nguồn đó (gói: nhóm hạn mức của model; khóa API: hạn
 * mức chi phí).
 */
function nextSource(model: string | null, vendors: VendorRow[], limits: LimitRow[]): NextSource | null {
  if (!model) return null;
  const cli = subCli(model), id = model.slice(model.indexOf("/") + 1);
  if (cli) {
    const v = vendors.find((x) => x.cli === cli);
    const group = cli === "agy" ? (isGeminiId(id) ? AGY_GROUPS.gemini : AGY_GROUPS.other) : undefined;
    const pct = planPct(v?.sub?.windows ?? [], group);
    return { model, vendor: v?.vendor ?? vendorOf(model), mode: "plan", pct, ...(group ? { group } : {}) };
  }
  const provider = model.split("/")[0];
  const api = vendors.filter((x) => x.mode === "api");
  const v = api.find((x) => x.provider === provider) ?? api.find((x) => x.vendor === vendorOf(model));
  return { model, vendor: v?.vendor ?? vendorOf(model), mode: "api", pct: apiPct(limits, v?.rate, v?.credit) };
}
