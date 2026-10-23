import { getSkill, publicSkill, removeSkill, setEnabled, setProjectEnabled, SkillError } from "../../../skillstore";
import { current, featureGate } from "../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ name: string }> };
const err = (e: unknown) => e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ" }, { status: 500 });

export async function GET(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const s = await getSkill(current(req)!.user.id, (await params).name);
  if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
  return Response.json({ skill: { ...publicSkill(s), body: s.body, files: s.files } });
}

// { enabled } bật/tắt cho cả tài khoản; { project, enabled } bật/tắt riêng trong một dự án.
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id;
  try {
    const { enabled, project } = await req.json();
    const name = (await params).name;
    const s = project !== undefined ? await setProjectEnabled(uid, name, String(project), !!enabled) : await setEnabled(uid, name, !!enabled);
    return Response.json({ skill: publicSkill(s) });
  } catch (e) { return err(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  try { await removeSkill(current(req)!.user.id, (await params).name); return Response.json({ ok: true }); } catch (e) { return err(e); }
}
