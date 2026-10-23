import { fetchGithubSkill, LIMITS, previewSkill, publicSkill, saveSkill, skillErr } from "../../../skillstore";
import { current, featureGate, limit } from "../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// { url, pick?, dry? }: nhập skill từ link GitHub công khai (repo, thư mục hoặc file SKILL.md).
export async function POST(req: Request) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const uid = current(req)!.user.id;
  try {
    limit("gh-import:" + uid, 40, 3600_000);
    const { url, pick, dry } = await req.json();
    const g = await fetchGithubSkill(String(url ?? ""), typeof pick === "string" ? pick : undefined);
    const opts = { pick: g.pick, maxZip: LIMITS.githubZip };
    if (dry) return Response.json({ preview: { ...(await previewSkill(uid, g.filename, g.buf, opts)), source: g.source, pick: g.pick } });
    const { skill, created } = await saveSkill(uid, g.filename, g.buf, opts);
    return Response.json({ skill: publicSkill(skill), created, warnings: skill.warnings });
  } catch (e) { return skillErr(e); }
}
