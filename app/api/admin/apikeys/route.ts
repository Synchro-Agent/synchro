import { audit, clientIp, handle, requireUser, sameOrigin } from "../../../authstore";
import { adminList, catalog, defaultModel, mainModels, pickDefault, refreshProvider, removeProvider, saveProvider, setDefaultModel, setMainModels } from "../../../providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trạng thái đầy đủ cho Cài đặt → API (khóa chỉ trả về dạng che).
async function state() {
  const cat = await catalog();
  const main = mainModels();
  return { providers: await adminList(), catalog: cat, main, default: defaultModel() || null, effectiveDefault: pickDefault(cat, main) };
}

export const GET = handle(async (req) => { requireUser(req); return Response.json(await state()); });

// Lưu khóa (kiểm tra với API của hãng trước), làm mới danh sách model, hoặc đổi model hiển thị / mặc định.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json();
  try {
    if (b.action === "refresh") {
      const r = await refreshProvider(String(b.id ?? ""));
      if (!r.ok) return Response.json({ error: r.error, ...(await state()) }, { status: 400 });
    } else if (b.action === "main") {
      setMainModels(Array.isArray(b.main) ? b.main : []);
      audit("admin_main_models", { actor: user, ip: clientIp(req) });
    } else if (b.action === "default") {
      setDefaultModel(typeof b.model === "string" ? b.model : "");
      audit("admin_default_model", { actor: user, ip: clientIp(req), detail: String(b.model ?? "") });
    } else {
      const r = await saveProvider({ id: b.id, kind: b.kind, name: b.name, key: b.key, baseUrl: b.baseUrl });
      audit("admin_api_key", { actor: user, ip: clientIp(req), detail: r.id });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(await state());
});

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!removeProvider(id)) return Response.json({ error: "Không tìm thấy khóa này." }, { status: 404 });
  audit("admin_api_key_removed", { actor: user, ip: clientIp(req), detail: id });
  return Response.json(await state());
});
