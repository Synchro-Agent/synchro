import { getSkill, publicSkill, removeSkill, setEnabled, SkillError } from "../../../skillstore";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ name: string }> };
const err = (e: unknown) => e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ" }, { status: 500 });

export async function GET(_: Request, { params }: Ctx) {
  const s = await getSkill((await params).name);
  if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
  return Response.json({ skill: { ...publicSkill(s), body: s.body, files: s.files } });
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { enabled } = await req.json();
    return Response.json({ skill: publicSkill(await setEnabled((await params).name, !!enabled)) });
  } catch (e) { return err(e); }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try { await removeSkill((await params).name); return Response.json({ ok: true }); } catch (e) { return err(e); }
}
