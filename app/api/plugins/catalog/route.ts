import { AuthError, can, handle, isAdmin, requireUser, sameOrigin } from "../../../authstore";
import { altsOf, CD, dirById, dirCounts, dirEntries, dirPage, dirSynced } from "../../../claudedir";
import { blockedLibs, failedLibs, getJob, jobRunning, orgInstalled, startJob, stopJob } from "../../../plugjob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh mục skill của Claude cho tab Khám phá: số thư viện / skill / đã cài mỗi mục, một trang thư viện (lọc mục, từ khóa, đã cài / chưa cài)
// và tiến độ cài hàng loạt. ?cat=engineering&q=pdf&page=0&only=missing
const u_ = (req: Request) => new URL(req.url);
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const u = new URL(req.url);
  const have = orgInstalled(user.id);
  const counts = dirCounts();
  // Thư viện chỉ lúc cài mới biết giấy phép đóng, và thư viện đã cài lỗi từ nguồn của nó: không tính là còn phải cài, ở mọi số đếm và thẻ thư viện.
  // Thư viện đã cài từ trước thì vẫn là đã cài, kể cả khi giờ danh mục coi giấy phép của nó là đóng.
  const blocked = blockedLibs(), failed = failedLibs();
  const isClosed = (id: string) => !have.has(CD + id) && (!!dirById(id)?.closed || blocked.has(CD + id));
  const isFailed = (id: string) => !have.has(CD + id) && !isClosed(id) && failed.has(CD + id);
  for (const c of Object.values(counts)) c.closed = 0;
  const failedIn: Record<string, number> = {};
  for (const e of dirEntries()) { if (isClosed(e.id)) for (const c of e.cats) { if (counts[c]) counts[c].closed++; } else if (isFailed(e.id)) for (const c of e.cats) failedIn[c] = (failedIn[c] ?? 0) + 1; }
  // Quản trị viên lấy danh sách để đưa vào catalog/license-blocked.json, lần chạy scripts/sync-claude-directory.mjs sau ghi hẳn vào danh mục.
  if (u_(req).searchParams.get("blocked") && isAdmin(user)) return Response.json(Object.fromEntries(blocked));
  const done: Record<string, number> = {};
  for (const e of dirEntries()) if (have.has(CD + e.id)) for (const c of e.cats) done[c] = (done[c] ?? 0) + 1;
  const only = u.searchParams.get("only");
  const pg = dirPage({ cat: u.searchParams.get("cat") || undefined, q: u.searchParams.get("q") ?? "", page: Number(u.searchParams.get("page") ?? 0) || 0, size: Number(u.searchParams.get("size") ?? 24) || 24,
    status: (id) => have.get(id), avail: (id) => { const x = id.slice(CD.length); return !isClosed(x) && !isFailed(x); }, only: only === "installed" || only === "missing" || only === "unavailable" ? only : undefined });
  const all = dirEntries();
  return Response.json({
    synced: dirSynced(), admin: isAdmin(user), canInstall: can(user, "skills"),
    totals: { plugins: all.length, skills: all.reduce((a, e) => a + e.skills.length, 0), installed: all.filter((e) => have.has(CD + e.id)).length, closed: all.filter((e) => isClosed(e.id)).length, failed: all.filter((e) => isFailed(e.id)).length },
    cats: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { ...v, installed: done[k] ?? 0, failed: failedIn[k] ?? 0 }])),
    ...pg, items: pg.items.map((e) => ({ id: CD + e.id, name: e.name, summary: e.summary, author: e.author, cats: e.cats, license: e.license, skillCount: e.skills.length, skills: e.skills.slice(0, 8), homepage: e.homepage, verified: e.verified ?? null, installed: have.get(CD + e.id) ?? null,
      closed: isClosed(e.id), closedWhy: blocked.get(CD + e.id)?.reason ?? null, failed: isFailed(e.id), failedWhy: isFailed(e.id) && isAdmin(user) ? failed.get(CD + e.id)?.reason ?? null : null, github: !!e.github, altFor: e.altFor ?? [], altAuto: !e.alt?.length, alt: (isClosed(e.id) || isFailed(e.id) ? altsOf(e) : e.alt ?? []).map((a) => ({ id: CD + a, name: dirById(a)?.name ?? a, installed: have.get(CD + a) ?? null })) })),
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
  // retry: thử lại cả các thư viện đã cài lỗi từ nguồn của chúng.
  if (b.action === "install-all") return Response.json({ job: { ...startJob(user.id, typeof b.cat === "string" && b.cat ? b.cat : null, false, 0, b.retry === true), running: jobRunning() } });
  if (b.action === "stop") return Response.json({ job: { ...stopJob(), running: jobRunning() } });
  return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
});
