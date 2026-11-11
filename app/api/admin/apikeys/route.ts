import { audit, clientIp, handle, isOwner, ownerOnly, requireAdmin, requireOwner, sameOrigin, type UserRow } from "../../../authstore";
import { adminList, catalog, defaultModel, mainModels, pickDefault, refreshProvider, removeProvider, saveProvider, setDefaultModel, setMainModels, WorkspaceNeeded } from "../../../providers";
import { credits, setCredit } from "../../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trạng thái đầy đủ cho Cài đặt → Providers và phần Quản trị viên (khóa chỉ trả về dạng che). Quản trị viên không phải chủ sở hữu không
// thấy cả phần che của khóa, địa chỉ API riêng hay workspace (thiết lập mang bí mật chỉ chủ sở hữu xem và đổi).
async function state(u: UserRow) {
  const cat = await catalog();
  const main = mainModels();
  const owner = isOwner(u);
  const providers = (await adminList()).map((p) => (owner ? p : { ...p, keyHint: null, baseUrl: "", workspaceId: "" }));
  return { providers, catalog: cat, main, default: defaultModel() || null, effectiveDefault: pickDefault(cat, main), credits: credits(), owner };
}

export const GET = handle(async (req) => { const { user } = requireAdmin(req); return Response.json(await state(user)); });

// Lưu khóa (kiểm tra với API của hãng trước), làm mới danh sách model, hoặc đổi model hiển thị / mặc định.
// Lưu / thay khóa và số dư đã nạp (tiền): chỉ chủ sở hữu. Làm mới danh sách model, model hiển thị, model mặc định: mọi quản trị viên.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const b = await req.json();
  if (!["refresh", "main", "default"].includes(b.action)) ownerOnly(user);
  try {
    if (b.action === "refresh") {
      const r = await refreshProvider(String(b.id ?? ""));
      if (!r.ok) return Response.json({ error: r.error, ...(await state(user)) }, { status: 400 });
    } else if (b.action === "main") {
      setMainModels(Array.isArray(b.main) ? b.main : []);
      audit("admin_main_models", { actor: user, ip: clientIp(req) });
    } else if (b.action === "credit") {
      // Số dư API đã nạp: { id, amount } đặt lại, { id, add } nạp thêm, { id, amount: null } bỏ theo dõi.
      setCredit(String(b.id ?? ""), { amount: b.amount === null ? null : typeof b.amount === "number" ? b.amount : undefined, add: typeof b.add === "number" ? b.add : undefined });
      audit("admin_api_credit", { actor: user, ip: clientIp(req), detail: `${b.id} ${b.amount ?? `+${b.add}`}` });
    } else if (b.action === "default") {
      setDefaultModel(typeof b.model === "string" ? b.model : "");
      audit("admin_default_model", { actor: user, ip: clientIp(req), detail: String(b.model ?? "") });
    } else {
      const r = await saveProvider({ id: b.id, kind: b.kind, name: b.name, key: b.key, baseUrl: b.baseUrl, workspaceId: b.workspaceId });
      audit("admin_api_key", { actor: user, ip: clientIp(req), detail: r.id });
    }
  } catch (e) {
    if (e instanceof WorkspaceNeeded) return Response.json({ error: e.message, needWorkspace: true, workspaces: e.workspaces }, { status: 400 });
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(await state(user));
});

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireOwner(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!removeProvider(id)) return Response.json({ error: "Không tìm thấy khóa này." }, { status: 404 });
  audit("admin_api_key_removed", { actor: user, ip: clientIp(req), detail: id });
  return Response.json(await state(user));
});
