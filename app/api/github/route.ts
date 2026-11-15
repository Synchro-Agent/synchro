import { can, handle, requireUser, sameOrigin } from "../../../server/authstore";
import { getLink, gh, removeLink } from "../../../server/github";
import { configured } from "../../../server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Repo = { full_name: string; private: boolean; default_branch: string; description: string | null; pushed_at: string; html_url: string; permissions?: { push?: boolean } };

// Tệp văn bản trong repo dùng được làm ngữ cảnh (bỏ ảnh, tệp nhị phân, thư mục phụ thuộc và bản build).
const TEXT_RE = /\.(md|mdx|txt|rst|adoc|json|ya?ml|toml|ini|cfg|env\.example|csv|tsv|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|graphql|gql|proto|dart|lua|r|scala|ex|exs|erl|clj|tf|gradle|dockerfile|makefile)$|(^|\/)(Dockerfile|Makefile|README|LICENSE|CHANGELOG)[^/]*$/i;
const SKIP_RE = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.git|coverage|__pycache__|\.venv|venv|target|\.idea|\.vscode)\//;
const repoOk = (s: string) => /^[\w.-]+\/[\w.-]+$/.test(s);

// Trạng thái kết nối GitHub; ?repos=1&q=… liệt kê repo của người dùng (mới cập nhật trước);
// ?tree=owner/repo&ref=nhánh liệt kê tệp văn bản trong repo (để thêm vào ngữ cảnh dự án).
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const l = getLink(user.id);
  const url = new URL(req.url);
  const tree = url.searchParams.get("tree") ?? "";
  if (tree) {
    if (!l) return Response.json({ error: "Chưa kết nối GitHub." }, { status: 400 });
    if (!repoOk(tree)) return Response.json({ error: "Tên repo không hợp lệ." }, { status: 400 });
    const ref = encodeURIComponent(url.searchParams.get("ref") || "HEAD");
    const t = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(l.token, `/repos/${tree}/git/trees/${ref}?recursive=1`);
    const files = t.tree.filter((x) => x.type === "blob" && TEXT_RE.test(x.path) && !SKIP_RE.test(x.path) && (x.size ?? 0) <= 400_000).map((x) => ({ path: x.path, size: x.size ?? 0 })).slice(0, 3000);
    return Response.json({ files, truncated: t.truncated });
  }
  if (url.searchParams.get("repos")) {
    if (!l) return Response.json({ repos: [] });
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const list = await gh<Repo[]>(l.token, "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member");
    return Response.json({
      repos: list.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 50)
        .map((r) => ({ full: r.full_name, private: r.private, branch: r.default_branch, desc: r.description, pushed: r.pushed_at, url: r.html_url, push: !!r.permissions?.push })),
    });
  }
  return Response.json({ configured: configured("github"), allowed: can(user, "code"), linked: !!l && !l.broken, broken: !!l?.broken, login: l?.login ?? null, repoScope: !!l?.scopes.split(/[ ,]/).includes("repo") });
});

// Lấy nội dung các tệp đã chọn (tối đa 80 tệp, 2 MB) để thêm vào ngữ cảnh dự án.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const l = getLink(user.id);
  if (!l) return Response.json({ error: "Chưa kết nối GitHub." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { repo?: string; ref?: string; paths?: unknown };
  const repo = String(b.repo ?? "");
  if (!repoOk(repo)) return Response.json({ error: "Tên repo không hợp lệ." }, { status: 400 });
  const paths = (Array.isArray(b.paths) ? b.paths : []).filter((x): x is string => typeof x === "string" && TEXT_RE.test(x) && !x.includes("..")).slice(0, 80);
  const ref = encodeURIComponent(String(b.ref || "HEAD"));
  const out: { path: string; text: string }[] = [];
  let total = 0;
  for (const p of paths) {
    if (total > 2_000_000) break;
    const f = await gh<{ content?: string; encoding?: string }>(l.token, `/repos/${repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`).catch(() => null);
    if (!f?.content) continue;
    const text = Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    if (text.includes("\u0000")) continue;
    total += text.length;
    out.push({ path: p, text });
  }
  return Response.json({ files: out });
});

// Ngắt kết nối: xóa token trên máy chủ.
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  removeLink(user.id);
  return Response.json({ ok: true });
});
