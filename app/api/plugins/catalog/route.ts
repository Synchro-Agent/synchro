import { AuthError, can, handle, isAdmin, requireUser, sameOrigin } from "../../../authstore";
import { CD, dirById, dirCounts, dirEntries, dirPage, dirSynced } from "../../../claudedir";
import { getJob, jobRunning, orgInstalled, startJob, stopJob } from "../../../plugjob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh mục skill của Claude cho tab Khám phá: số thư viện / skill / đã cài mỗi mục, một trang thư viện (lọc mục, từ khóa, đã cài / chưa cài)
// và tiến độ cài hàng loạt. ?cat=engineering&q=pdf&page=0&only=missing
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const u = new URL(req.url);
  const have = orgInstalled(user.id);
  const counts = dirCounts();
  const done: Record<string, number> = {};
  for (const e of dirEntries()) if (have.has(CD + e.id)) for (const c of e.cats) done[c] = (done[c] ?? 0) + 1;
  const only = u.searchParams.get("only");
  const pg = dirPage({ cat: u.searchParams.get("cat") || undefined, q: u.searchParams.get("q") ?? "", page: Number(u.searchParams.get("page") ?? 0) || 0, size: Number(u.searchParams.get("size") ?? 24) || 24,
    status: (id) => have.get(id), only: only === "installed" || only === "missing" ? only : undefined });
  const all = dirEntries();
  return Response.json({
    synced: dirSynced(), admin: isAdmin(user), canInstall: can(user, "skills"),
    totals: { plugins: all.length, skills: all.reduce((a, e) => a + e.skills.length, 0), installed: all.filter((e) => have.has(CD + e.id)).length, closed: all.filter((e) => e.closed).length },
    cats: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { ...v, installed: done[k] ?? 0 }])),
    ...pg, items: pg.items.map((e) => ({ id: CD + e.id, name: e.name, summary: e.summary, author: e.author, cats: e.cats, license: e.license, skillCount: e.skills.length, skills: e.skills.slice(0, 8), homepage: e.homepage, verified: e.verified ?? null, installed: have.get(CD + e.id) ?? null,
      closed: !!e.closed, github: !!e.github, altFor: e.altFor ?? [], alt: (e.alt ?? []).map((a) => ({ id: CD + a, name: dirById(a)?.name ?? a, installed: have.get(CD + a) ?? null })) })),
    job: isAdmin(user) ? { ...getJob(), running: jobRunning() } : null,
  });
});

// Quản trị viên: { action: "install-all", cat? } cài mọi thư viện chưa cài (cả danh mục hoặc một mục) vào Thư viện cho mọi người, ở nền;
// { action: "stop" } dừng sau các thư viện đang cài dở.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (!isAdmin(user)) throw new AuthError("Chỉ quản trị viên mới cài hàng loạt cho cả tổ chức.", 403);
  const b = await req.json().catch(() => ({}));
  if (b.action === "install-all") return Response.json({ job: { ...startJob(user.id, typeof b.cat === "string" && b.cat ? b.cat : null), running: jobRunning() } });
  if (b.action === "stop") return Response.json({ job: { ...stopJob(), running: jobRunning() } });
  return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
});
