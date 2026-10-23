import { getSkill, readSkillFile, SkillError } from "../../../../skillstore";
import { current, featureGate } from "../../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  try {
    const s = await getSkill(current(req)!.user.id, (await params).name);
    if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
    return Response.json(await readSkillFile(s, new URL(req.url).searchParams.get("path") ?? ""));
  } catch (e) { return e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ" }, { status: 500 }); }
}
