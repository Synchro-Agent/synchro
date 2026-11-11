import { current, permsOf } from "../../authstore";
import { ALL } from "../../catalog";
import { catalog, defaultModel, mainModels } from "../../providers";
import { mergedProviders } from "../../ai/subs";
import { isNewModel, replacements } from "../../modelreg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách model cho bộ chọn model: chỉ những model quản trị viên cho hiện ở màn hình chính, kèm quyền của tài khoản.
export async function GET(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const cat = await catalog();
  const main = mainModels();
  const providers = cat.map((p) => ({ ...p, models: main.includes(ALL) ? p.models : p.models.filter((m) => main.includes(m.key)) })).filter((p) => p.models.length);
  const perms = permsOf(c.user);
  // Gộp theo hãng: nhóm Claude / ChatGPT / Gemini hiện model của gói người dùng đã đăng nhập (Cài đặt → Providers), hoặc model của
  // khóa API dùng chung khi chưa đăng nhập gói hay người dùng đã đồng ý dùng API thay gói. Model của gói luôn dùng được với chính họ.
  // Nhãn "Mới" cho cả model của gói (sổ model đọc danh sách gói bằng đăng nhập của quản trị viên).
  const merged = (await mergedProviders(c.user, providers).catch(() => providers)).map((p) => (p.source === "plan" ? { ...p, models: p.models.map((m) => (isNewModel(m.key) ? { ...m, isNew: true } : m)) } : p));
  const subKeys = merged.flatMap((p) => p.plan?.models.map((m) => m.key) ?? []);
  // Người dùng mở trang: khởi động sẵn tiến trình cho câu đầu tiên (không chờ, lỗi cũng không sao).
  void import("../../chatengine").then((m) => m.prewarmChat(c.user)).catch(() => {});
  // default: chỉ model quản trị viên đặt; không đặt thì người dùng mới bắt đầu ở Tự động (models.ts), không phải model đầu danh sách.
  const d = defaultModel();
  // sharedApi: máy chủ có model qua khóa API dùng chung (giao diện chỉ nói về khóa dùng chung khi có thật).
  // replaced: model đã ngừng / đã cũ → bản mới nhất cùng dòng; người đã chọn tay model cũ được chuyển sang và báo một lần (models.ts fitModel).
  const shown = new Set(merged.flatMap((p) => p.models.map((m) => m.key)));
  const replaced = Object.fromEntries(Object.entries(replacements()).filter(([, r]) => shown.has(r.to)));
  return Response.json({ providers: merged, replaced, sharedApi: providers.length > 0, default: d && cat.some((p) => p.models.some((m) => m.key === d)) ? d : null, allowed: perms.models.includes(ALL) ? perms.models : [...perms.models, ...subKeys], effort: perms.effort ?? {} });
}
