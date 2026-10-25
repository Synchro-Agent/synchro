import { AuthError, handle, requireUser, sameOrigin, type UserRow } from "../../authstore";
import { getLink, gh, gitAuthEnv, parseRepo } from "../../github";
import { agent, exec, fsop, requireWs, sdir, ticket, wsConfigured } from "../../workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trạng thái workspace của tài khoản: có dùng được không, container đang chạy không.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  if (!wsConfigured()) return Response.json({ available: false, reason: "Máy chủ chưa bật workspace." });
  const s = await agent<{ running: boolean; idleMin: number }>("/status", { u: user.id }).catch(() => null);
  return Response.json({ available: !!s, reason: s ? undefined : "Không kết nối được workspace.", running: !!s?.running, idleMin: s?.idleMin });
});

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

// { op, sid, ... }: bật/dừng workspace, vé terminal/trình duyệt, thao tác file và git trong thư mục của phiên.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  requireWs(user);
  const b = (await req.json()) as Record<string, unknown>;
  const op = str(b.op, 20);
  if (op === "stop") { await agent("/stop", { u: user.id }); return Response.json({ ok: true }); }
  const d = sdir(b.sid);
  const u = user.id;
  switch (op) {
    case "ensure": await agent("/ensure", { u }); await exec(u, d, { cmd: "true" }); return Response.json({ ok: true });
    case "ticket": {
      const k = b.kind === "screen" ? "screen" : b.kind === "log" ? "log" : "term";
      await agent("/ensure", { u });
      return Response.json({ url: ticket(req, u, d, k) });
    }
    case "list": return Response.json(await fsop(u, d, "list", str(b.path) || "."));
    case "tree": return Response.json(await fsop(u, d, "tree", str(b.path) || ".", "3000"));
    case "read": return Response.json(await fsop(u, d, "read", str(b.path), "2000000"));
    case "write": {
      if (typeof b.content !== "string" || b.content.length > 5_000_000) throw new AuthError("Nội dung không hợp lệ.", 400);
      return Response.json(await fsop(u, d, "write", str(b.path), undefined, b.content));
    }
    case "mkdir": return Response.json(await fsop(u, d, "mkdir", str(b.path)));
    case "rm": return Response.json(await fsop(u, d, "rm", str(b.path)));
    case "mv": return Response.json(await fsop(u, d, "mv", str(b.path), str(b.to)));
    case "git": return Response.json(await git(user, d, b));
    default: throw new AuthError("Thao tác không hợp lệ.", 400);
  }
});

// ------------------------------------------------------------------ git
type GitFile = { path: string; status: string; add: number; del: number };
const STATUS_SH = `if [ ! -d .git ]; then echo "##NOGIT"; exit 0; fi
echo "##B $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "##R $(git remote get-url origin 2>/dev/null | sed -E 's#https://[^@/]*@#https://#')"
echo "##A $(git rev-list --count @{u}..HEAD 2>/dev/null || echo -)"
git status --porcelain=v1 -uall 2>/dev/null | head -500 | sed 's/^/##S /'
(git diff HEAD --numstat 2>/dev/null || git diff --cached --numstat) | head -500 | sed 's/^/##N /'
git ls-files --others --exclude-standard | head -300 | while IFS= read -r f; do echo "##U $(wc -l < "$f" 2>/dev/null || echo 0)	$f"; done`;

async function status(u: string, d: string) {
  const r = await exec(u, d, { cmd: STATUS_SH, timeout: 30 });
  const lines = r.out.split("\n");
  if (lines.includes("##NOGIT")) return { git: false as const };
  const val = (k: string) => lines.find((l) => l.startsWith(`##${k} `))?.slice(k.length + 3).trim() ?? "";
  const files = new Map<string, GitFile>();
  for (const l of lines) {
    if (l.startsWith("##S ")) {
      const code = l.slice(4, 6), p = l.slice(7).replace(/^.* -> /, "").replace(/^"|"$/g, "");
      files.set(p, { path: p, status: code === "??" ? "A" : code.trim().slice(0, 1) || "M", add: 0, del: 0 });
    } else if (l.startsWith("##N ") || l.startsWith("##U ")) {
      const [a, b2, ...rest] = l.slice(4).split("\t");
      const p = (l.startsWith("##U ") ? [b2, ...rest] : rest).join("\t");
      const f = files.get(p);
      if (f) { f.add = Number(a) || 0; f.del = l.startsWith("##U ") ? 0 : Number(b2) || 0; }
    }
  }
  const remote = val("R");
  return { git: true as const, branch: val("B"), remote, repo: /github\.com[/:]([^/]+\/[^/.]+)/.exec(remote)?.[1] ?? null, ahead: val("A") === "-" ? null : Number(val("A")), files: [...files.values()] };
}

const okBranch = (s: string) => /^[A-Za-z0-9._/-]{1,100}$/.test(s) && !s.includes("..") && !s.startsWith("-");
const tokenOf = (u: UserRow, need: boolean) => {
  const l = getLink(u.id);
  if (!l && need) throw new AuthError("Hãy kết nối GitHub trước (nút GitHub bên dưới khung chat).", 400);
  return l;
};
// Tên / email cho commit: theo tài khoản GitHub đã kết nối (email noreply), nếu không thì theo tài khoản Synchro.
const ident = (user: UserRow) => {
  const l = getLink(user.id);
  return { N: l?.login ?? user.name ?? "Synchro", M: l ? `${l.id}+${l.login}@users.noreply.github.com` : user.email };
};
const fail = (r: { code: number; out: string; err: string }, what: string) => {
  if (r.code) throw new AuthError(`${what}: ${(r.err || r.out).trim().split("\n").slice(-4).join(" ").slice(0, 400) || "lỗi " + r.code}`, 400);
};

async function git(user: UserRow, d: string, b: Record<string, unknown>) {
  const u = user.id;
  const sub = str(b.action, 20);
  if (sub === "status") return status(u, d);
  if (sub === "diff") {
    const p = str(b.path, 1000);
    const r = await exec(u, d, { cmd: `if git ls-files --error-unmatch -- "$P" >/dev/null 2>&1; then git diff HEAD -- "$P" 2>/dev/null || git diff --cached -- "$P"; else git diff --no-index -- /dev/null "$P"; fi; true`, env: { P: p }, timeout: 30 });
    return { diff: r.out.slice(0, 400_000) };
  }
  if (sub === "clone") {
    const { owner, name } = parseRepo(b.repo);
    const l = tokenOf(user, false);
    const branch = str(b.branch, 100);
    if (branch && !okBranch(branch)) throw new AuthError("Tên nhánh không hợp lệ.", 400);
    const empty = await exec(u, d, { cmd: "ls -A | head -1", timeout: 10 });
    if (empty.out.trim()) throw new AuthError("Phiên này đã có file. Hãy tạo phiên mới để clone repo khác.", 409);
    const r = await exec(u, d, {
      cmd: `git clone --quiet ${branch ? '--branch "$BR" ' : ""}"https://github.com/$REPO.git" . 2>&1`,
      env: { REPO: `${owner}/${name}`, BR: branch, ...(l ? gitAuthEnv(l.token) : { GIT_TERMINAL_PROMPT: "0" }) }, timeout: 300,
    });
    if (r.code) throw new AuthError(/not found|could not read Username|Authentication/i.test(r.out + r.err) ? (l ? "Không tìm thấy repo hoặc tài khoản GitHub của bạn không có quyền với repo này." : "Repo riêng tư hoặc không tồn tại. Hãy kết nối GitHub để clone repo riêng tư.") : `Clone thất bại: ${(r.out || r.err).trim().slice(-300)}`, 400);
    await exec(u, d, { cmd: 'git config user.name "$N" && git config user.email "$M"', env: ident(user), timeout: 10 });
    return status(u, d);
  }
  if (sub === "init") {
    const r = await exec(u, d, { cmd: `git init -q -b main && git config user.name "$N" && git config user.email "$M" && git add -A && (git commit -qm 'Khởi tạo' || true)`, env: ident(user), timeout: 30 });
    fail(r, "Khởi tạo git");
    return status(u, d);
  }
  if (sub === "commit") {
    const msg = str(b.message, 2000).trim();
    if (!msg) throw new AuthError("Hãy nhập nội dung commit.", 400);
    const r = await exec(u, d, { cmd: 'git add -A && git commit -q -m "$MSG"', env: { MSG: msg }, timeout: 60 });
    fail(r, "Commit");
    return status(u, d);
  }
  if (sub === "branch") {
    const name = str(b.name, 100);
    if (!okBranch(name)) throw new AuthError("Tên nhánh không hợp lệ.", 400);
    const r = await exec(u, d, { cmd: 'git checkout -q -b "$BR" 2>/dev/null || git checkout -q "$BR"', env: { BR: name }, timeout: 30 });
    fail(r, "Đổi nhánh");
    return status(u, d);
  }
  if (sub === "push" || sub === "pull") {
    const l = tokenOf(user, true)!;
    const r = await exec(u, d, { cmd: sub === "push" ? "git push -u origin HEAD 2>&1" : "git pull --ff-only 2>&1", env: gitAuthEnv(l.token), timeout: 180 });
    fail(r, sub === "push" ? "Push" : "Pull");
    return { ...(await status(u, d)), output: r.out.slice(-2000) };
  }
  if (sub === "pr") {
    const l = tokenOf(user, true)!;
    const s = await status(u, d);
    if (!s.git || !s.repo) throw new AuthError("Phiên này chưa gắn với repo GitHub.", 400);
    const repo = await gh<{ default_branch: string }>(l.token, `/repos/${s.repo}`);
    const base = str(b.base, 100) || repo.default_branch;
    if (s.branch === base) throw new AuthError(`Đang ở nhánh ${base}. Hãy tạo nhánh mới trước khi mở pull request.`, 400);
    const pr = await gh<{ html_url: string; number: number }>(l.token, `/repos/${s.repo}/pulls`, { method: "POST", body: JSON.stringify({ title: str(b.title, 200) || s.branch, body: str(b.body, 20_000), head: s.branch, base }) });
    return { ...s, pr: { url: pr.html_url, number: pr.number } };
  }
  throw new AuthError("Thao tác git không hợp lệ.", 400);
}
