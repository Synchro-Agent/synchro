// Khóa API dùng chung của máy chủ (Cài đặt → Providers): tài khoản thường (không phải quản trị viên) được dùng tới đâu.
// Quản trị viên đặt ở Quản trị → Hạn mức sử dụng: cho / chặn dùng khóa chung (mặc định và từng người), hạng model cao nhất được chạy trên khóa
// chung (mặc định tới hạng cân bằng: không Opus, không Fable, không model mạnh nhất — lỗi 4 của ma trận H1: tài khoản miễn phí tự chạy
// Claude Opus 5.5 trên khóa chung, $0,45 một lượt). Hạn mức tiền theo ngày nằm ở usage.ts (cùng bảng usage_config / usage_users).
// Model của gói người dùng tự đăng nhập ("sub-…") không bao giờ bị chặn ở đây: đó là gói của chính họ.
// Đọc thẳng bảng (không qua usage.ts) vì users.ts (canModel) dùng mô-đun này, còn usage.ts lại dùng users.ts.
import "server-only";
import { stmt } from "../db/db";
import { isFrontier, tierOf, type Tier } from "../../shared/modelrules";

export const TIERS: Tier[] = ["fast", "balanced", "strong"];
export type SharedRule = { shared: boolean; top: Tier };
export const DEFAULT_SHARED: SharedRule = { shared: true, top: "balanced" };
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as string[]).includes(v);

const json = (s: string | null | undefined): Record<string, unknown> => { try { const v = s ? JSON.parse(s) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; } };
/** Quy tắc mặc định cho mọi tài khoản thường (usage_config.json: sharedKey, sharedTop). */
export function sharedDefault(): SharedRule {
  const c = json((stmt("SELECT json FROM usage_config WHERE id = 1").get() as { json: string } | undefined)?.json);
  return { shared: typeof c.sharedKey === "boolean" ? c.sharedKey : DEFAULT_SHARED.shared, top: isTier(c.sharedTop) ? c.sharedTop : DEFAULT_SHARED.top };
}
/** Quy tắc của một người: phần riêng (usage_users.override: shared, top) thay phần mặc định. */
export function sharedRule(uid: string): SharedRule {
  const d = sharedDefault();
  const o = json((stmt("SELECT override FROM usage_users WHERE user_id = ?").get(uid) as { override: string | null } | undefined)?.override);
  return { shared: typeof o.shared === "boolean" ? o.shared : d.shared, top: isTier(o.top) ? o.top : d.top };
}
/** Hạng của model khi tính quyền: model mạnh nhất của hãng (Fable, Astra…) và hạng mạnh (Opus, Grok 4.7…) đều là "strong". */
export const keyTier = (key: string): Tier => (isFrontier(key) ? "strong" : tierOf(key));

/** Model khóa API này có bị chặn cho người dùng không: "blocked" (không được dùng khóa chung), "tier" (vượt hạng cho phép), hoặc null. */
export function sharedKeyBlock(uid: string, admin: boolean, key: string): "blocked" | "tier" | null {
  if (admin || !key.includes("/") || key.startsWith("sub-")) return null;
  const r = sharedRule(uid);
  if (!r.shared) return "blocked";
  return TIERS.indexOf(keyTier(key)) > TIERS.indexOf(r.top) ? "tier" : null;
}
export const SHARED_BLOCKED_MSG = "Quản trị viên chưa cho tài khoản của bạn dùng khóa API chung của máy chủ. Model của gói bạn tự đăng nhập (Cài đặt → Providers) vẫn dùng được.";
export const SHARED_TIER_MSG = "Model này chỉ chạy được bằng gói bạn tự đăng nhập: trên khóa API chung của máy chủ, quản trị viên chưa cho tài khoản thường dùng model hạng này. Hãy chọn Tự động hoặc một model nhẹ hơn.";
