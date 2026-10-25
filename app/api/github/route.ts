import { handle, requireUser, sameOrigin } from "../../authstore";
import { getLink, gh, removeLink } from "../../github";
import { configured } from "../../oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Repo = { full_name: string; private: boolean; default_branch: string; description: string | null; pushed_at: string; html_url: string; permissions?: { push?: boolean } };

// Trạng thái kết nối GitHub; ?repos=1&q=… liệt kê repo của người dùng (mới cập nhật trước).
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const l = getLink(user.id);
  const url = new URL(req.url);
  if (url.searchParams.get("repos")) {
    if (!l) return Response.json({ repos: [] });
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const list = await gh<Repo[]>(l.token, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");
    return Response.json({
      repos: list.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 50)
        .map((r) => ({ full: r.full_name, private: r.private, branch: r.default_branch, desc: r.description, pushed: r.pushed_at, url: r.html_url, push: !!r.permissions?.push })),
    });
  }
  return Response.json({ configured: configured("github"), linked: !!l, login: l?.login ?? null, repoScope: !!l?.scopes.split(/[ ,]/).includes("repo") });
});

// Ngắt kết nối: xóa token trên máy chủ.
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  removeLink(user.id);
  return Response.json({ ok: true });
});
