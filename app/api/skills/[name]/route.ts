import { getSkill, publicSkill, readSkillRaw, removeSkill, restoreVersion, setEnabled, setProjectEnabled, SkillError, type Skill } from "../../../skillstore";
import { setManual, userKey } from "../../../skillstudio";
import { STUDIO_KINDS } from "../../../studiorules";
import { dropPatches, hashText, listPatches, setPatch } from "../../../skillheal";
import { current, featureGate } from "../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ name: string }> };
const err = (e: unknown) => e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ" }, { status: 500 });

export async function GET(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const s = await getSkill(current(req)!.user.id, (await params).name);
  if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
  return Response.json({ skill: { ...publicSkill(s), body: s.body, files: s.files, patches: await patchesOf(current(req)!.user.id, s) } });
}

// Bản tự sửa script của skill, kèm bản gốc hiện tại để xem khác biệt; bản sửa cho bản gốc cũ (skill đã cập nhật) đánh dấu stale.
async function patchesOf(uid: string, s: Skill) {
  const original: Record<string, string> = {}, hashes: Record<string, string> = {};
  for (const f of s.files.filter((x) => x.kind === "script")) {
    try { const t = (await readSkillRaw(s, f.path)).toString("utf8"); original[f.path] = t; hashes[f.path] = hashText(t); } catch {}
  }
  return listPatches(uid, s.id, hashes, true).map((p) => ({ ...p, original: original[p.path] ?? "" }));
}

// { enabled } bật/tắt cho cả tài khoản; { project, enabled } bật/tắt riêng trong một dự án; { restore: n } quay lại phiên bản n;
// { patch, action } duyệt / bỏ bản tự sửa đang chờ hoặc hoàn tác bản đang dùng;
// { studios: ["docs" | "slides" | "design", …] } tự chọn mục ở trang Artifacts; { studios: null } để Synchro tự nhận diện lại.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id;
  try {
    const { enabled, project, restore, patch, action, studios } = await req.json();
    const name = (await params).name;
    if (studios !== undefined) {
      const sk = await getSkill(uid, name);
      if (!sk) return Response.json({ error: "Không có skill này" }, { status: 404 });
      if (studios !== null && (!Array.isArray(studios) || studios.some((x: unknown) => !STUDIO_KINDS.includes(x as never)))) return Response.json({ error: "Mục không hợp lệ" }, { status: 400 });
      setManual(userKey(sk.id), studios, sk);
      return Response.json({ skill: publicSkill(sk) });
    }
    if (typeof patch === "string") {
      const sk = await getSkill(uid, name);
      if (!sk || !["approve", "reject", "revert"].includes(action)) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
      if (!setPatch(uid, patch, action)) return Response.json({ error: "Bản sửa này không còn ở trạng thái đó." }, { status: 409 });
      return Response.json({ ok: true, patches: await patchesOf(uid, sk) });
    }
    const s = typeof restore === "number" ? await restoreVersion(uid, name, restore)
      : project !== undefined ? await setProjectEnabled(uid, name, String(project), !!enabled) : await setEnabled(uid, name, !!enabled);
    return Response.json({ skill: publicSkill(s) });
  } catch (e) { return err(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id, name = (await params).name;
  try { const sk = await getSkill(uid, name); await removeSkill(uid, name); if (sk) dropPatches(uid, sk.id); return Response.json({ ok: true }); } catch (e) { return err(e); }
}
