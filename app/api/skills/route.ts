import { listSkills, previewSkill, publicSkill, saveSkill, skillErr, SkillError } from "../../skillstore";
import { current, featureGate } from "../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  return Response.json({ skills: (await listSkills(current(req)!.user.id)).map(publicSkill) });
}

// multipart: file (.zip hoặc SKILL.md); dry=1 chỉ kiểm tra + xem trước, không lưu; pick = thư mục skill khi gói có nhiều skill.
export async function POST(req: Request) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id;
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    if (!(f instanceof File)) throw new SkillError("Chưa chọn file");
    const buf = Buffer.from(await f.arrayBuffer());
    const pick = typeof fd.get("pick") === "string" ? String(fd.get("pick")) : undefined;
    if (fd.get("dry")) return Response.json({ preview: await previewSkill(uid, f.name, buf, { pick }) });
    const { skill, created } = await saveSkill(uid, f.name, buf, { pick });
    return Response.json({ skill: publicSkill(skill), created, warnings: skill.warnings });
  } catch (e) { return skillErr(e); }
}
