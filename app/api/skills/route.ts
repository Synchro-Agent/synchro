import { listSkills, previewSkill, publicSkill, saveSkill, SkillError } from "../../skillstore";

export const runtime = "nodejs";
const err = (e: unknown) => e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ khi xử lý skill" }, { status: 500 });

export async function GET() {
  return Response.json({ skills: (await listSkills()).map(publicSkill) });
}

// multipart: file (.zip hoặc SKILL.md); dry=1 chỉ kiểm tra + xem trước, không lưu.
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    if (!(f instanceof File)) throw new SkillError("Chưa chọn file");
    const buf = Buffer.from(await f.arrayBuffer());
    if (fd.get("dry")) return Response.json({ preview: await previewSkill(f.name, buf) });
    const { skill, created } = await saveSkill(f.name, buf);
    return Response.json({ skill: publicSkill(skill), created, warnings: skill.warnings });
  } catch (e) { return err(e); }
}
