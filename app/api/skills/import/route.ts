import { fetchGithubSkill, getSkill, LIMITS, NoSkillError, parseEntries, type Parsed, previewParsed, previewSkill, publicSkill, saveParsed, saveSkill, setSkillSource, skillErr } from "../../../../server/skillstore";
import { findLinkDup, linkDupMessage, linkKey, type LinkDup } from "../../../../server/plugins";
import { fetchGitRepo, RepoError } from "../../../../server/repofetch";
import { GEN, readRepo, skillFromRepo } from "../../../../server/skillgen";
import { limit } from "../../../../server/authstore";
import { route } from "../../../../server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isGithub = (u: string) => /^https?:\/\/(www\.)?(github\.com|raw\.githubusercontent\.com)\//i.test(u.trim());

// Repo không có SKILL.md: Synchro đọc toàn repo rồi tự viết skill — việc chạy nền (gói subscription có thể mất cả phút, lâu hơn thời gian
// chờ của proxy). Giao diện gửi lại đúng yêu cầu vài giây một lần: đang chạy thì nhận { pending }, xong thì nhận bản xem trước; bấm Thêm
// dùng lại đúng bản đã tạo (không đọc / viết lại lần hai). Giữ 30 phút, tối đa vài bản mỗi lúc.
type Job = { at: number; p?: Parsed; error?: string; status?: number; running: boolean };
const g = globalThis as unknown as { __synchroSkillGen?: Map<string, Job> };
const jobs = (g.__synchroSkillGen ??= new Map());
const KEEP = 30 * 60_000;
function sweep() {
  for (const [k, j] of jobs) if (!j.running && Date.now() - j.at > KEEP) jobs.delete(k);
  while (jobs.size > 8) { const k = [...jobs.keys()].find((x) => !jobs.get(x)!.running); if (!k) break; jobs.delete(k); }
}

const dupRes = (d: LinkDup) => Response.json({ error: linkDupMessage(d), duplicate: d }, { status: 409 });

// { url, pick?, dry? }: nhập skill từ link repo git công khai (GitHub, GitLab, Bitbucket, Codeberg / Gitea, máy chủ git riêng…):
// repo, thư mục hoặc file SKILL.md. Repo / thư mục không có SKILL.md: tạo skill từ toàn bộ nội dung repo.
export const POST = route({ feature: "skills", json: true }, async ({ req, user }) => {
  const uid = user.id;
  try {
    const { url, pick, dry } = await req.json();
    const raw = String(url ?? "");
    // Link đã dùng để thêm skill (của chính mình, hoặc thư viện cho mọi người): báo trùng, không thêm lại.
    const dup = findLinkDup(uid, raw);
    if (dup) return dupRes(dup);
    const source = linkKey(raw);
    sweep();
    const want = typeof pick === "string" ? pick : undefined;
    const key0 = `${uid}|${raw.trim()}|${want ?? ""}`;
    const done = jobs.get(key0);
    if (done) {
      if (done.running) return Response.json({ pending: true });
      if (done.error) { jobs.delete(key0); return Response.json({ error: done.error }, { status: done.status ?? 400 }); }
      if (dry) return Response.json({ preview: { ...(await previewParsed(uid, done.p!)), generated: true } });
      jobs.delete(key0);
      const { skill, created } = await saveParsed(uid, done.p!, true, source);
      return Response.json({ skill: publicSkill(skill), created, warnings: skill.warnings });
    }
    limit("gh-import:" + uid, 40, 3600_000);
    const gh = isGithub(raw);
    const src = gh
      ? await fetchGithubSkill(raw, want).then((x) => ({ ...x, sub: "" }))
      : await fetchGitRepo(raw).then((x) => ({ filename: x.filename, buf: x.buf, pick: want ?? (x.sub || undefined), source: x.source, sub: x.sub }));
    const opts = { pick: src.pick, maxZip: gh ? LIMITS.githubZip : 130 * 1024 * 1024 };
    try {
      if (dry) {
        const pv = await previewSkill(uid, src.filename, src.buf, opts);
        // Skill thêm trước khi Synchro lưu link: nội dung SKILL.md giống hệt bản đang có nghĩa là cùng một link → ghi lại link, báo trùng.
        const cur = pv.exists && source ? await getSkill(uid, pv.name) : null;
        if (cur && !cur.source && cur.body === pv.body) { setSkillSource(cur.id, source!); return dupRes({ name: cur.name, where: "skill" }); }
        return Response.json({ preview: { ...pv, source: src.source, pick: src.pick } });
      }
      const { skill, created } = await saveSkill(uid, src.filename, src.buf, { ...opts, source });
      return Response.json({ skill: publicSkill(skill), created, warnings: skill.warnings });
    } catch (e) { if (!(e instanceof NoSkillError)) throw e; }
    // Không có SKILL.md: đọc toàn bộ repo (hoặc thư mục trong link) ở nền rồi tự viết skill.
    // zip của GitHub có thư mục gốc "<repo>-<nhánh>/": pick đã gồm thư mục đó, readRepo tự bỏ.
    const sub = gh ? (src.pick ?? "").split("/").slice(1).join("/") : src.sub;
    const job: Job = { at: Date.now(), running: true };
    jobs.set(key0, job);
    (async () => {
      try {
        const { files, skipped } = await readRepo(src.buf, sub, { stripTop: gh });
        const repoName = sub ? sub.split("/").filter(Boolean).pop()! : src.filename.replace(/\.zip$/i, "");
        const r = await skillFromRepo(user, files, { repoName, source: `${src.source}${sub ? `/${sub}` : ""}`, skipped });
        job.p = parseEntries(r.entries, r.warnings, GEN.files + 5);
      } catch (e) {
        job.error = e instanceof Error ? e.message : String(e);
        job.status = (e as { status?: number }).status ?? 400;
      } finally { job.running = false; job.at = Date.now(); }
    })();
    return Response.json({ pending: true });
  } catch (e) {
    if (e instanceof RepoError) return Response.json({ error: e.message }, { status: e.status });
    return skillErr(e);
  }
});
