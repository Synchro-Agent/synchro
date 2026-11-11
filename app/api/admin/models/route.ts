import { audit, clientIp, handle, isOwner, ownerOnly, requireAdmin, sameOrigin, type UserRow } from "../../../authstore";
import { adminList } from "../../../providers";
import { activate, autoSettings, discoverModels, forget, listRegistry, queueRetest, setAutoSettings, setHidden, setPinned } from "../../../modelreg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sổ model cho Cài đặt → Providers (chỉ quản trị viên): model hãng vừa ra, kết quả thử, ghim / ẩn, tự nhận model mới bật / tắt.
// Việc gọi API bằng khóa của chủ máy chủ (bật / tắt tự nhận model mới cả máy chủ hay từng hãng, "Kiểm tra ngay", "Thử lại") chỉ chủ sở hữu;
// ghim / ẩn / dùng ngay / bỏ khỏi danh sách không tốn gì nên mọi quản trị viên làm được.
const SPENDS = new Set(["auto", "provider", "check", "retest"]);
// Khóa API đã gỡ: sổ vẫn giữ model của nó (gắn lại khóa thì không phải thử lại từ đầu) nhưng không hiện ở đây, kể cả nút bật / tắt theo hãng.
const state = async (u: UserRow) => {
  const on = new Set((await adminList()).filter((p) => p.configured).map((p) => p.id));
  return { settings: autoSettings(), models: listRegistry().filter((m) => m.plan || on.has(m.provider)), owner: isOwner(u) };
};

export const GET = handle(async (req) => { const { user } = requireAdmin(req); return Response.json(await state(user)); });

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  const key = typeof b.key === "string" ? b.key.slice(0, 200) : "";
  if (SPENDS.has(b.action)) ownerOnly(user);
  try {
    if (b.action === "check") {
      // "Kiểm tra ngay": dò mọi hãng, thử các model đang chờ (kể cả model vừa bấm "Thử lại").
      const report = await discoverModels("admin", { force: Array.isArray(b.force) ? b.force.filter((x: unknown) => typeof x === "string").slice(0, 20) : [] });
      audit("admin_models_check", { actor: user, ip: clientIp(req) });
      return Response.json({ ...(await state(user)), report });
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
      audit("admin_models", { actor: user, ip: clientIp(req), detail: `retest ${key}` });
      const report = await discoverModels("admin", { force: [key] });
      return Response.json({ ...(await state(user)), report });
    } else return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
    audit("admin_models", { actor: user, ip: clientIp(req), detail: `${b.action} ${key || b.id || ""} ${b.on ?? ""}`.trim() });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  return Response.json(await state(user));
});
