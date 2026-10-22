import { getSkill, readSkillFile, SkillError } from "../../../../skillstore";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const s = await getSkill((await params).name);
    if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
    return Response.json(await readSkillFile(s, new URL(req.url).searchParams.get("path") ?? ""));
  } catch (e) { return e instanceof SkillError ? Response.json({ error: e.message }, { status: e.status }) : Response.json({ error: "Lỗi máy chủ" }, { status: 500 }); }
}
