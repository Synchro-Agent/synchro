import { ensureStudioTags, listSkills, previewSkill, publicSkill, saveSkill, skillErr, SkillError } from "../../skillstore";
import { current, featureGate } from "../../authstore";
import { refining } from "../../skillstudio";
import { timed } from "../../servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = timed(async (req: Request) => {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id;
  // Skill chưa được xếp vào Tài liệu / Trình bày / Thiết kế (hoặc model chưa xếp lại): xếp ngay, model của người dùng xếp lại ở nền.
  ensureStudioTags(uid);
  return Response.json({ skills: (await listSkills(uid)).map(publicSkill), refining: refining() });
});

// multipart: file (.zip hoặc SKILL.md); dry=1 chỉ kiểm tra + xem trước, không lưu; pick = thư mục skill khi gói có nhiều skill.
export const POST = timed(async (req: Request) => {
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
});
