import { audit, clientIp, handle, requireAdmin, sameOrigin } from "../../../authstore";
import { activate, autoSettings, discoverModels, forget, listRegistry, queueRetest, setAutoSettings, setHidden, setPinned } from "../../../modelreg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sổ model cho Cài đặt → Providers (chỉ quản trị viên): model hãng vừa ra, kết quả thử, ghim / ẩn, tự nhận model mới bật / tắt.
const state = () => ({ settings: autoSettings(), models: listRegistry() });

export const GET = handle(async (req) => { requireAdmin(req); return Response.json(state()); });

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  const key = typeof b.key === "string" ? b.key.slice(0, 200) : "";
  try {
    if (b.action === "check") {
      // "Kiểm tra ngay": dò mọi hãng, thử các model đang chờ (kể cả model vừa bấm "Thử lại").
      const report = await discoverModels("admin", { force: Array.isArray(b.force) ? b.force.filter((x: unknown) => typeof x === "string").slice(0, 20) : [] });
      audit("admin_models_check", { actor: user, ip: clientIp(req) });
      return Response.json({ ...state(), report });
    }
    if (b.action === "auto") setAutoSettings({ auto: !!b.on });
    else if (b.action === "provider") {
      const id = String(b.id ?? ""), off = autoSettings().off.filter((x) => x !== id);
      setAutoSettings({ off: b.on ? off : [...off, id] });
    } else if (b.action === "pin") setPinned(key, !!b.on);
    else if (b.action === "hide") setHidden(key, !!b.on);
    else if (b.action === "activate") activate(key);
    else if (b.action === "forget") forget(key);
    else if (b.action === "retest") {
      queueRetest(key);
      const report = await discoverModels("admin", { force: [key] });
      return Response.json({ ...state(), report });
    } else return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
    audit("admin_models", { actor: user, ip: clientIp(req), detail: `${b.action} ${key || b.id || ""} ${b.on ?? ""}`.trim() });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  return Response.json(state());
});
